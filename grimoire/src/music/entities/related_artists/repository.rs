//! related-artists repository — see [super] for context.

use super::models::{BandcampAlbumLink, RelatedArtist, UpsertRelatedArtist};
use super::normalize::name_key;
use crate::database;
use crate::error::ErrorDetail;
use crate::response::GrimoireResponse;
use tracing::warn;

/// one row of [`list_incoming_for_artist`] — pairs the raw
/// `related_artistz` row with the source artist's display name and
/// mbid so the http handler can synthesize an "incoming" entry
/// without a follow-up artist lookup.
#[derive(Debug, Clone)]
pub struct IncomingRelatedArtistRow {
    pub row: RelatedArtist,
    /// display name of the artist that *listed* the queried artist
    /// as related (i.e. `source_artist_id`'s artistz.name).
    pub source_name: String,
    /// mbid pulled from `artistz.metadata.musicbrainz.artist_mbid`,
    /// when present.
    pub source_mbid: Option<String>,
}

/// hard cap on bandcamp_album_urlz size per row to keep blob writes
/// cheap. consumers (UI) only need a handful of links.
const BANDCAMP_ALBUMS_CAP: usize = 25;
/// hard cap on external_urlz size per row, same reason.
const EXTERNAL_URLS_CAP: usize = 10;

/// upsert one related-artist row.
///
/// dedup key: `(source_artist_id, related_name_key, source)`. on
/// conflict we OVERWRITE the row (latest data from the source wins),
/// preserving:
///   - `id` and `created_at` (we can't bump those without losing
///     stable references from external systems / future cli),
///   - any manually-set `bandcamp_url` / `bandcamp_album_urlz` /
///     `external_urlz` if the upsert payload doesn't supply them
///     (avoids losing curated links to a routine refetch).
///
/// also runs the cross-ref step: if `related_mbid` matches an active
/// `artistz` row, or if the `name_key` matches one and only one
/// active row, sets `related_artist_id`.
pub async fn upsert_related_artist(
    payload: UpsertRelatedArtist,
) -> GrimoireResponse<RelatedArtist> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => return GrimoireResponse::failure("db connect failed", vec![e.into()]),
    };

    let key = name_key(&payload.related_name);
    if key.is_empty() {
        return GrimoireResponse::failure(
            "related_name normalizes to empty key",
            vec![ErrorDetail::new(
                "invalid_input",
                "invalid related artist name",
                "related_name has no alphanumeric content",
            )],
        );
    }

    // best-effort cross-ref to a local artistz row.
    let resolved_local_id =
        resolve_local_artist(&pool, payload.related_mbid.as_deref(), &key).await;

    // bandcamp_albums: cap, dedup by url, serialize.
    let bandcamp_json =
        serialize_capped_json(payload.bandcamp_albums.iter().take(BANDCAMP_ALBUMS_CAP));
    let external_json = serialize_capped_json(payload.external_urls.iter().take(EXTERNAL_URLS_CAP));
    let source_str = payload.source.as_str();

    // INSERT ... ON CONFLICT ... DO UPDATE pattern. id is generated
    // here so a fresh insert gets a new uuid; on conflict we keep
    // the existing id via excluded.id being ignored.
    let new_id = uuid::Uuid::new_v4().to_string();
    let row = match sqlx::query!(
        r#"
        INSERT INTO related_artistz (
            id, source_artist_id, related_artist_id, related_name,
            related_name_key, related_mbid, source, match_score,
            bandcamp_url, bandcamp_album_urlz, image_url, external_urlz,
            fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (source_artist_id, related_name_key, source) DO UPDATE SET
            related_artist_id = COALESCE(excluded.related_artist_id, related_artistz.related_artist_id),
            related_name      = excluded.related_name,
            related_mbid      = COALESCE(excluded.related_mbid, related_artistz.related_mbid),
            match_score       = COALESCE(excluded.match_score, related_artistz.match_score),
            bandcamp_url      = COALESCE(excluded.bandcamp_url, related_artistz.bandcamp_url),
            bandcamp_album_urlz = COALESCE(excluded.bandcamp_album_urlz, related_artistz.bandcamp_album_urlz),
            image_url         = COALESCE(excluded.image_url, related_artistz.image_url),
            external_urlz     = COALESCE(excluded.external_urlz, related_artistz.external_urlz),
            fetched_at        = excluded.fetched_at,
            updated_at        = unixepoch(),
            deleted_at        = NULL
        RETURNING
            id as "id!", source_artist_id as "source_artist_id!",
            related_artist_id as "related_artist_id?",
            related_name as "related_name!",
            related_name_key as "related_name_key!",
            related_mbid as "related_mbid?",
            source as "source!",
            match_score as "match_score?",
            bandcamp_url as "bandcamp_url?",
            bandcamp_album_urlz as "bandcamp_album_urlz?",
            image_url as "image_url?",
            external_urlz as "external_urlz?",
            status as "status!",
            fetched_at as "fetched_at!", created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at as "deleted_at?"
        "#,
        new_id,
        payload.source_artist_id,
        resolved_local_id,
        payload.related_name,
        key,
        payload.related_mbid,
        source_str,
        payload.match_score,
        payload.bandcamp_url,
        bandcamp_json,
        payload.image_url,
        external_json,
        payload.fetched_at,
    )
    .fetch_one(&pool)
    .await
    {
        Ok(row) => RelatedArtist {
            id: row.id,
            source_artist_id: row.source_artist_id,
            related_artist_id: row.related_artist_id,
            related_name: row.related_name,
            related_name_key: row.related_name_key,
            related_mbid: row.related_mbid,
            source: row.source,
            match_score: row.match_score,
            bandcamp_url: row.bandcamp_url,
            bandcamp_album_urlz: row.bandcamp_album_urlz,
            image_url: row.image_url,
            external_urlz: row.external_urlz,
            status: row.status,
            fetched_at: row.fetched_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
        },
        Err(e) => {
            return GrimoireResponse::failure("failed to upsert related artist", vec![e.into()])
        }
    };

    GrimoireResponse::success("related artist upserted", row)
}

/// list every active related-artist row for a given local artist,
/// ordered by in-library first, then `match_score DESC NULLS LAST`,
/// then `related_name`.
///
/// when `include_pending` is true, both `accepted` and `pending`
/// rows are returned (the http handler exposes this behind an opt-in
/// flag so legacy callers — and the enrichment review panel — keep
/// their current accepted-only behaviour).
pub async fn list_related_for_artist(
    artist_id: &str,
    include_pending: bool,
) -> GrimoireResponse<Vec<RelatedArtist>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => return GrimoireResponse::failure("db connect failed", vec![e.into()]),
    };

    // status filter as a json array — same `json_each` trick we use
    // elsewhere for variable-length IN lists. avoids two near-
    // identical SQL strings.
    let status_json = if include_pending {
        r#"["accepted","pending"]"#
    } else {
        r#"["accepted"]"#
    };

    let rows = match sqlx::query_as!(
        RelatedArtist,
        r#"
        SELECT
            id as "id!", source_artist_id as "source_artist_id!",
            related_artist_id as "related_artist_id?",
            related_name as "related_name!",
            related_name_key as "related_name_key!",
            related_mbid as "related_mbid?",
            source as "source!",
            match_score as "match_score?",
            bandcamp_url as "bandcamp_url?",
            bandcamp_album_urlz as "bandcamp_album_urlz?",
            image_url as "image_url?",
            external_urlz as "external_urlz?",
            status as "status!",
            fetched_at as "fetched_at!", created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at as "deleted_at?"
        FROM related_artistz
        WHERE source_artist_id = ?
          AND deleted_at IS NULL
          AND status IN (SELECT value FROM json_each(?))
        ORDER BY
          (related_artist_id IS NOT NULL) DESC,
          (status = 'accepted') DESC,
          match_score DESC NULLS LAST,
          related_name COLLATE NOCASE ASC
        "#,
        artist_id,
        status_json,
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => return GrimoireResponse::failure("failed to list related", vec![e.into()]),
    };

    GrimoireResponse::success("ok", rows)
}

/// batched variant of [`list_related_for_artist`] — returns rows for
/// many source artists in a single query, grouped by `source_artist_id`.
///
/// uses the `json_each(?)` trick for variable-length `IN`-lists (same
/// pattern as `media_blobz::build_atlas_response`). callers that pass
/// an empty slice get an empty map back without touching the db.
pub async fn list_related_for_artists(
    artist_ids: &[String],
    include_pending: bool,
) -> GrimoireResponse<std::collections::HashMap<String, Vec<RelatedArtist>>> {
    if artist_ids.is_empty() {
        return GrimoireResponse::success("ok", std::collections::HashMap::new());
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => return GrimoireResponse::failure("db connect failed", vec![e.into()]),
    };

    let ids_json = serde_json::to_string(artist_ids).unwrap_or_else(|_| "[]".to_string());
    let status_json = if include_pending {
        r#"["accepted","pending"]"#
    } else {
        r#"["accepted"]"#
    };

    let rows = match sqlx::query_as!(
        RelatedArtist,
        r#"
        SELECT
            id as "id!", source_artist_id as "source_artist_id!",
            related_artist_id as "related_artist_id?",
            related_name as "related_name!",
            related_name_key as "related_name_key!",
            related_mbid as "related_mbid?",
            source as "source!",
            match_score as "match_score?",
            bandcamp_url as "bandcamp_url?",
            bandcamp_album_urlz as "bandcamp_album_urlz?",
            image_url as "image_url?",
            external_urlz as "external_urlz?",
            status as "status!",
            fetched_at as "fetched_at!", created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at as "deleted_at?"
        FROM related_artistz
        WHERE source_artist_id IN (SELECT value FROM json_each(?))
          AND deleted_at IS NULL
          AND status IN (SELECT value FROM json_each(?))
        ORDER BY
          (related_artist_id IS NOT NULL) DESC,
          (status = 'accepted') DESC,
          match_score DESC NULLS LAST,
          related_name COLLATE NOCASE ASC
        "#,
        ids_json,
        status_json,
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => return GrimoireResponse::failure("failed to list related", vec![e.into()]),
    };

    let mut grouped: std::collections::HashMap<String, Vec<RelatedArtist>> =
        std::collections::HashMap::with_capacity(artist_ids.len());
    // seed with empty vecs so requesters always see a key for every
    // input id (callers can distinguish "no rows" from "id wasn't in
    // the request"). seed only requested ids so a row with a stale
    // source_artist_id doesn't leak into the response.
    for id in artist_ids {
        grouped.entry(id.clone()).or_insert_with(Vec::new);
    }
    for row in rows {
        if let Some(bucket) = grouped.get_mut(&row.source_artist_id) {
            bucket.push(row);
        }
    }

    GrimoireResponse::success("ok", grouped)
}

/// reverse lookup: every active row that points AT the given local
/// artist — i.e. other local artists who list this one as related,
/// either via an explicit `related_artist_id` link or via a
/// `related_name_key` match against the queried artist's name.
///
/// each returned row is paired with the source artist's display
/// name + mbid (pulled from `artistz` via a left join) so the
/// caller can synthesize an "incoming" api entry without a follow-
/// up artist fetch.
///
/// `include_pending` mirrors [`list_related_for_artist`].
pub async fn list_incoming_for_artist(
    artist_id: &str,
    artist_name: &str,
    include_pending: bool,
) -> GrimoireResponse<Vec<IncomingRelatedArtistRow>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => return GrimoireResponse::failure("db connect failed", vec![e.into()]),
    };

    let key = name_key(artist_name);
    let status_json = if include_pending {
        r#"["accepted","pending"]"#
    } else {
        r#"["accepted"]"#
    };

    // join artistz to pull the source artist's display name + mbid.
    // we filter out rows whose source artist has been soft-deleted
    // or no longer exists (left join + IS NOT NULL) to avoid
    // surfacing dangling links.
    let rows = match sqlx::query!(
        r#"
        SELECT
            ra.id as "id!", ra.source_artist_id as "source_artist_id!",
            ra.related_artist_id as "related_artist_id?",
            ra.related_name as "related_name!",
            ra.related_name_key as "related_name_key!",
            ra.related_mbid as "related_mbid?",
            ra.source as "source!",
            ra.match_score as "match_score?",
            ra.bandcamp_url as "bandcamp_url?",
            ra.bandcamp_album_urlz as "bandcamp_album_urlz?",
            ra.image_url as "image_url?",
            ra.external_urlz as "external_urlz?",
            ra.status as "status!",
            ra.fetched_at as "fetched_at!", ra.created_at as "created_at!",
            ra.updated_at as "updated_at!",
            ra.deleted_at as "deleted_at?",
            a.name as "source_name!",
            json_extract(a.metadata, '$.musicbrainz.artist_mbid') as "source_mbid?: String"
        FROM related_artistz ra
        INNER JOIN artistz a ON a.id = ra.source_artist_id AND a.deleted_at IS NULL
        WHERE (ra.related_artist_id = ?1 OR (ra.related_artist_id IS NULL AND ra.related_name_key = ?2))
          AND ra.source_artist_id != ?1
          AND ra.deleted_at IS NULL
          AND ra.status IN (SELECT value FROM json_each(?3))
        ORDER BY
          (ra.status = 'accepted') DESC,
          ra.match_score DESC NULLS LAST,
          a.name COLLATE NOCASE ASC
        "#,
        artist_id,
        key,
        status_json,
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => return GrimoireResponse::failure("failed to list incoming", vec![e.into()]),
    };

    let out: Vec<IncomingRelatedArtistRow> = rows
        .into_iter()
        .map(|r| IncomingRelatedArtistRow {
            row: RelatedArtist {
                id: r.id,
                source_artist_id: r.source_artist_id,
                related_artist_id: r.related_artist_id,
                related_name: r.related_name,
                related_name_key: r.related_name_key,
                related_mbid: r.related_mbid,
                source: r.source,
                match_score: r.match_score,
                bandcamp_url: r.bandcamp_url,
                bandcamp_album_urlz: r.bandcamp_album_urlz,
                image_url: r.image_url,
                external_urlz: r.external_urlz,
                status: r.status,
                fetched_at: r.fetched_at,
                created_at: r.created_at,
                updated_at: r.updated_at,
                deleted_at: r.deleted_at,
            },
            source_name: r.source_name,
            source_mbid: r.source_mbid,
        })
        .collect();

    GrimoireResponse::success("ok", out)
}

/// admin/manual: attach or replace bandcamp links on an existing
/// related-artist row.
pub async fn set_related_bandcamp(
    id: &str,
    bandcamp_url: Option<String>,
    bandcamp_albums: Vec<BandcampAlbumLink>,
) -> GrimoireResponse<RelatedArtist> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => return GrimoireResponse::failure("db connect failed", vec![e.into()]),
    };

    let bandcamp_json = serialize_capped_json(bandcamp_albums.iter().take(BANDCAMP_ALBUMS_CAP));

    let row = match sqlx::query_as!(
        RelatedArtist,
        r#"
        UPDATE related_artistz
        SET bandcamp_url = ?, bandcamp_album_urlz = ?, updated_at = unixepoch()
        WHERE id = ? AND deleted_at IS NULL
        RETURNING
            id as "id!", source_artist_id as "source_artist_id!",
            related_artist_id as "related_artist_id?",
            related_name as "related_name!",
            related_name_key as "related_name_key!",
            related_mbid as "related_mbid?",
            source as "source!",
            match_score as "match_score?",
            bandcamp_url as "bandcamp_url?",
            bandcamp_album_urlz as "bandcamp_album_urlz?",
            image_url as "image_url?",
            external_urlz as "external_urlz?",
            status as "status!",
            fetched_at as "fetched_at!", created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at as "deleted_at?"
        "#,
        bandcamp_url,
        bandcamp_json,
        id,
    )
    .fetch_one(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => return GrimoireResponse::failure("failed to set bandcamp", vec![e.into()]),
    };

    GrimoireResponse::success("bandcamp links updated", row)
}

/// when a new local artist lands, sweep through `related_artistz` and
/// stamp `related_artist_id = artist_id` on rows that match by mbid
/// or name_key. idempotent. returns the number of rows updated.
pub async fn backfill_related_artist_for_local(
    artist_id: &str,
    artist_mbid: Option<&str>,
    artist_name: &str,
) -> GrimoireResponse<u64> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => return GrimoireResponse::failure("db connect failed", vec![e.into()]),
    };

    let key = name_key(artist_name);
    let mut total: u64 = 0;

    // mbid matches first — strongest signal, no false positives.
    if let Some(mbid) = artist_mbid {
        match sqlx::query!(
            r#"
            UPDATE related_artistz
            SET related_artist_id = ?, updated_at = unixepoch()
            WHERE related_mbid = ?
              AND related_artist_id IS NULL
              AND deleted_at IS NULL
            "#,
            artist_id,
            mbid,
        )
        .execute(&pool)
        .await
        {
            Ok(r) => total += r.rows_affected(),
            Err(e) => warn!("backfill mbid update failed: {}", e),
        }
    }

    // name_key fallback. only run if we have a non-empty key.
    if !key.is_empty() {
        match sqlx::query!(
            r#"
            UPDATE related_artistz
            SET related_artist_id = ?, updated_at = unixepoch()
            WHERE related_name_key = ?
              AND related_artist_id IS NULL
              AND deleted_at IS NULL
            "#,
            artist_id,
            key,
        )
        .execute(&pool)
        .await
        {
            Ok(r) => total += r.rows_affected(),
            Err(e) => warn!("backfill name_key update failed: {}", e),
        }
    }

    GrimoireResponse::success("backfill complete", total)
}

// --- internal helpers ---

/// best-effort lookup of a local `artistz.id` for a related artist.
/// preference order: mbid -> unique name_key match -> none.
///
/// note: the `name_key` here is a soft heuristic computed from
/// `artistz.name`. we intentionally do NOT add a `name_key` column
/// to `artistz` (yet) — running [name_key] over the name on the fly
/// is cheap at our scale (< 1k artists). if we hit perf issues this
/// becomes a maintained generated column.
async fn resolve_local_artist(
    pool: &sqlx::SqlitePool,
    mbid: Option<&str>,
    name_key_value: &str,
) -> Option<String> {
    if let Some(_mbid) = mbid {
        // we don't currently store mbid as a first-class column on
        // artistz — only inside `metadata.musicbrainz.artist_mbid`
        // when the lastfm/audiodb processors land it. cross-ref by
        // mbid is a json_extract scan; cheap at our scale.
        // schema field placement: see ArtistMetadata::musicbrainz.
        if let Ok(Some(row)) = sqlx::query!(
            r#"
            SELECT id as "id!" FROM artistz
            WHERE deleted_at IS NULL
              AND json_extract(metadata, '$.musicbrainz.artist_mbid') = ?
            LIMIT 1
            "#,
            _mbid,
        )
        .fetch_optional(pool)
        .await
        {
            return Some(row.id);
        }
    }

    // soft name match. only count it when EXACTLY one row matches —
    // multiple matches mean we can't pick safely without user input.
    if !name_key_value.is_empty() {
        // we don't have a stored name_key, so this is a load-and-filter
        // pass. fine at < 1k artists; revisit if we cross 10k.
        if let Ok(rows) = sqlx::query!(
            r#"SELECT id as "id!", name as "name!" FROM artistz WHERE deleted_at IS NULL"#,
        )
        .fetch_all(pool)
        .await
        {
            let mut hits: Vec<String> = rows
                .into_iter()
                .filter(|r| name_key(&r.name) == name_key_value)
                .map(|r| r.id)
                .collect();
            if hits.len() == 1 {
                return hits.pop();
            }
        }
    }

    None
}

/// serialize a small list to a json string suitable for a TEXT
/// column. returns None when the iterator is empty so we don't
/// store `"[]"` blobs everywhere.
fn serialize_capped_json<T: serde::Serialize>(it: impl IntoIterator<Item = T>) -> Option<String> {
    let v: Vec<T> = it.into_iter().collect();
    if v.is_empty() {
        return None;
    }
    serde_json::to_string(&v).ok()
}
