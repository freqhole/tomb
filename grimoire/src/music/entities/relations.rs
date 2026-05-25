//! cross-remote relation/walk repository functions — phase 11.
//!
//! provides the read-side primitives that power the graph visualization's
//! cross-remote walk machinery:
//!
//! * [`list_albums_by_taxon_value`] — find all (non-deleted) albums
//!   that share a (taxon-kind, taxon-value) pair. used by the graph
//!   when the user drills into a relation hub and we need to fetch
//!   that hub's full member set from a remote.
//!
//! * [`get_album_taxons_batch`] — batched taxon lookup for many
//!   album ids in one round-trip. used when the graph expands a
//!   cluster of newly-fetched albums and needs to draw edges to all
//!   the relation hubs they touch.
//!
//! * [`find_albums_by_merged_key`] / [`find_artists_by_merged_key`] —
//!   resolve a canonical `(artist_lower, title_lower)` (album) or
//!   `name_lower` (artist) merge key to local entities. used by the
//!   cross-remote entity-merge phase so the client can fold remote
//!   entities into their local counterparts.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

use crate::database;
use crate::error::ErrorDetail;
use crate::music::crud::{apply_user_preferences_albums, AlbumQueryResult, AlbumViewRow};
use crate::music::entities::albums::Album;
use crate::music::entities::artists::Artist;
use crate::music::entities::taxonomy::TaxonRef;
use crate::response::GrimoireResponse;
use crate::JsonVec;

/// list all (non-deleted) albums linked to a taxon identified by
/// `(kind_slug, value)`. `value` matches against either the taxon's
/// slug or its label (case-insensitive) so callers can pass the
/// pre-normalized `value_norm` they're already using on the client.
///
/// returns the rich `AlbumQueryResult` shape (album + artist +
/// images + user favorite/rating context) so the graph view can
/// render walk-pulled albums without an extra round-trip per item.
///
/// ordering is `created_at DESC` so the most recently ingested
/// albums show up first when a hub is expanded.
pub async fn list_albums_by_taxon_value(
    kind_slug: &str,
    value: &str,
    limit: Option<u32>,
    offset: Option<u32>,
    user_id: Option<&str>,
) -> GrimoireResponse<Vec<AlbumQueryResult>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let limit = limit.unwrap_or(200).min(1000) as i64;
    let offset = offset.unwrap_or(0) as i64;

    // use the same view + row mapping as `query_albums` so callers
    // get the enriched (album + artist + images + tags + favorites)
    // shape. selecting `v.*` works because `AlbumViewRow` derives
    // `FromRow` against the view's exact column names.
    let sql = r#"SELECT v.*
        FROM album_query_view v
        WHERE v.album_id IN (
          SELECT DISTINCT at.album_id
            FROM album_taxonz at
            JOIN taxonz t       ON t.id = at.taxon_id
            JOIN taxon_kindz k  ON k.id = t.kind_id
           WHERE k.slug = ?1
             AND (t.slug = ?2 OR LOWER(t.label) = LOWER(?2))
             AND t.deleted_at IS NULL
             AND k.deleted_at IS NULL
        )
          AND v.album_deleted_at IS NULL
        ORDER BY v.album_created_at DESC
        LIMIT ?3 OFFSET ?4"#;

    let rows: Vec<AlbumViewRow> = match sqlx::query_as::<_, AlbumViewRow>(sql)
        .bind(kind_slug)
        .bind(value)
        .bind(limit)
        .bind(offset)
        .fetch_all(&pool)
        .await
    {
        Ok(a) => a,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to list albums by taxon value",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let mut albums: Vec<AlbumQueryResult> = rows
        .into_iter()
        .map(|r| r.to_album_query_result(user_id))
        .collect();

    if let Some(uid) = user_id {
        apply_user_preferences_albums(&mut albums, uid).await;
    }

    GrimoireResponse::success("albums by taxon value retrieved", albums)
}

/// list the N most-recently-added albums on this remote, in the same
/// enriched shape as [`list_albums_by_taxon_value`]. used by the
/// graph view's synthesized "recently added" first-order hub
/// (phase 22).
pub async fn list_recently_added_albums(
    limit: Option<u32>,
    user_id: Option<&str>,
) -> GrimoireResponse<Vec<AlbumQueryResult>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let limit = limit.unwrap_or(32).clamp(1, 256) as i64;

    let sql = r#"SELECT v.*
        FROM album_query_view v
        WHERE v.album_deleted_at IS NULL
        ORDER BY v.album_created_at DESC
        LIMIT ?1"#;

    let rows: Vec<AlbumViewRow> = match sqlx::query_as::<_, AlbumViewRow>(sql)
        .bind(limit)
        .fetch_all(&pool)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to list recently added albums",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let mut albums: Vec<AlbumQueryResult> = rows
        .into_iter()
        .map(|r| r.to_album_query_result(user_id))
        .collect();

    if let Some(uid) = user_id {
        apply_user_preferences_albums(&mut albums, uid).await;
    }

    GrimoireResponse::success("recently added albums retrieved", albums)
}

/// one synthesized era bin — used by the graph view's first-order
/// "era" hub fan-out (phase 22). bins are computed server-side from
/// `release_date`-derived years using a greedy hysteresis pass so
/// dense decades stay year-granular while sparse stretches collapse
/// into wider buckets.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, FromRow)]
pub struct EraBin {
    /// stable normalized key for this bin, used as the hub value.
    /// e.g. `"1995"`, `"1930-1969"`, `"2000s"`.
    pub value_norm: String,
    /// human-readable label for the bin.
    pub label: String,
    /// number of (non-deleted) albums whose `release_date` year
    /// falls inside this bin.
    pub count: u32,
    /// inclusive lower year of the bin (None if the bin has no
    /// year-bearing albums).
    pub min_year: Option<i32>,
    /// inclusive upper year of the bin.
    pub max_year: Option<i32>,
}

/// compute synthesized era bins for the remote's album corpus.
///
/// **stub:** the binning algorithm (greedy growth, target 10..32
/// albums per bin, decade-snap boundaries) hasn't landed yet. for
/// now this returns an empty vec so the offal route + client wiring
/// can ship alongside the rest of phase 22 without blocking on the
/// binning heuristic. tracked in phase 22 of the graph viz plan.
///
/// `target_min` / `target_max` are advisory bin-size hints (default
/// 10..32) for the future implementation; currently ignored.
pub async fn list_era_bins(
    _target_min: Option<u32>,
    _target_max: Option<u32>,
) -> GrimoireResponse<Vec<EraBin>> {
    // TODO(phase 22): implement greedy decade-aware binning.
    // sketch:
    //   1. SELECT CAST(SUBSTR(release_date,1,4) AS INTEGER) AS year,
    //      COUNT(*) FROM album_query_view WHERE release_date IS NOT
    //      NULL AND album_deleted_at IS NULL GROUP BY year ORDER BY
    //      year ASC.
    //   2. greedy pass: accumulate years into a bin until count
    //      reaches `target_min`; emit and start fresh. if a single
    //      year exceeds `target_max`, that year is its own bin.
    //   3. snap bin boundaries to decade edges when the span is
    //      wider than one decade so labels read "1990s" not
    //      "1991-2003".
    //   4. label single-year bins as the year, multi-year as
    //      `min-max` or `decade + "s"`.
    GrimoireResponse::success("era bins (stub: not yet implemented)", Vec::new())
}

/// batched taxon lookup for many album ids. for each requested id
/// returns its `TaxonRef`s (or an empty vec if the album has none /
/// doesn't exist). missing ids are simply absent from the returned
/// map so callers can do their own diffing.
///
/// the taxons come from `album_query_view.album_taxons` which is
/// already a json array shaped like `TaxonRef`.
pub async fn get_album_taxons_batch(
    album_ids: &[String],
) -> GrimoireResponse<HashMap<String, Vec<TaxonRef>>> {
    if album_ids.is_empty() {
        return GrimoireResponse::success("no album ids requested", HashMap::new());
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    // serialize ids as a json array and use json_each so we don't
    // have to build a dynamic IN clause (and stay friendly to the
    // sqlx prepared-statement cache).
    let ids_json = match serde_json::to_string(album_ids) {
        Ok(s) => s,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to serialize album ids",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            );
        }
    };

    let rows = match sqlx::query!(
        r#"SELECT
            v.album_id      as "album_id!",
            v.album_taxons  as "album_taxons?"
           FROM album_query_view v
           JOIN json_each(?1) j ON j.value = v.album_id
           WHERE v.album_deleted_at IS NULL"#,
        ids_json
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to batch-load album taxons",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let mut out: HashMap<String, Vec<TaxonRef>> = HashMap::with_capacity(rows.len());
    for r in rows {
        let taxons: Vec<TaxonRef> = r
            .album_taxons
            .as_deref()
            .and_then(|s| serde_json::from_str::<Vec<TaxonRef>>(s).ok())
            .unwrap_or_default();
        out.insert(r.album_id, taxons);
    }

    GrimoireResponse::success("album taxons retrieved", out)
}

/// find albums whose canonical merge key matches `(artist_lower, title_lower)`.
///
/// the merge key is computed in sqlite as
/// `LOWER(artist_name) || '::' || LOWER(album_title)` and compared
/// against the json-encoded list of caller-supplied keys via
/// `json_each`. albums with no associated artist are excluded (their
/// merge key is undefined).
///
/// returns a map `merged_key -> Vec<Album>`. an id may appear under
/// multiple keys if the library has duplicate-artist edge cases; the
/// vec is `Vec` rather than `Option` so callers can distinguish
/// "exactly one match" from "ambiguous".
pub async fn find_albums_by_merged_key(
    keys: &[String],
) -> GrimoireResponse<HashMap<String, Vec<Album>>> {
    if keys.is_empty() {
        return GrimoireResponse::success("no keys requested", HashMap::new());
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let keys_json = match serde_json::to_string(keys) {
        Ok(s) => s,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to serialize keys",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            );
        }
    };

    // join album_query_view to artist_albumz->artistz to derive the
    // merge key, then intersect with caller-supplied keys via
    // json_each. select all view columns so we can rebuild an `Album`.
    let rows = match sqlx::query!(
        r#"SELECT
            CAST(j.value AS TEXT) as "merged_key!: String",
            v.album_id              as "id!",
            v.album_title           as "title!",
            v.album_album_type      as "album_type!",
            v.album_release_date    as "release_date?",
            v.album_label           as "label?",
            v.album_genres          as "genres?",
            v.album_taxons          as "taxons?",
            v.album_song_count      as "song_count!",
            v.album_total_duration  as "total_duration!",
            v.album_created_at      as "created_at!",
            v.album_updated_at      as "updated_at!",
            v.album_deleted_at      as "deleted_at?",
            v.album_deleted_by      as "deleted_by?",
            v.album_created_by      as "created_by?",
            v.album_updated_by      as "updated_by?",
            v.album_created_by_username as "created_by_username?",
            v.album_updated_by_username as "updated_by_username?",
            v.album_images          as "images?",
            v.album_metadata        as "metadata?",
            v.album_mb_lookup_status as "mb_lookup_status?",
            v.album_mb_lookup_at    as "mb_lookup_at?",
            v.album_mb_lookup_by    as "mb_lookup_by?"
           FROM album_query_view v
           JOIN artist_albumz aa ON aa.album_id = v.album_id
           JOIN artistz ar       ON ar.id = aa.artist_id
           JOIN json_each(?1) j  ON j.value = LOWER(ar.name) || '::' || LOWER(v.album_title)
           WHERE v.album_deleted_at IS NULL
             AND ar.deleted_at IS NULL"#,
        keys_json
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to find albums by merged key",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let mut out: HashMap<String, Vec<Album>> = HashMap::new();
    for r in rows {
        let genres = r
            .genres
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .map(JsonVec);
        let taxons = r
            .taxons
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .map(JsonVec);
        let images = r
            .images
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .map(JsonVec);

        let album = Album {
            id: r.id,
            title: r.title,
            album_type: r.album_type,
            release_date: r.release_date,
            label: r.label,
            genres,
            taxons,
            images,
            urls: None,
            song_count: r.song_count,
            total_duration: r.total_duration,
            created_at: r.created_at,
            updated_at: r.updated_at,
            deleted_at: r.deleted_at,
            deleted_by: r.deleted_by,
            created_by: r.created_by,
            updated_by: r.updated_by,
            created_by_username: r.created_by_username,
            updated_by_username: r.updated_by_username,
            metadata: r.metadata,
            mb_lookup_status: r.mb_lookup_status,
            mb_lookup_at: r.mb_lookup_at,
            mb_lookup_by: r.mb_lookup_by,
        };
        out.entry(r.merged_key).or_default().push(album);
    }

    GrimoireResponse::success("albums by merged key retrieved", out)
}

/// find artists whose canonical merge key (`LOWER(name)`) matches
/// one of the caller-supplied keys. returns a map
/// `merged_key -> Vec<Artist>` so callers can detect ambiguity.
pub async fn find_artists_by_merged_key(
    keys: &[String],
) -> GrimoireResponse<HashMap<String, Vec<Artist>>> {
    if keys.is_empty() {
        return GrimoireResponse::success("no keys requested", HashMap::new());
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let keys_json = match serde_json::to_string(keys) {
        Ok(s) => s,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to serialize keys",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            );
        }
    };

    let rows = match sqlx::query!(
        r#"SELECT
            CAST(j.value AS TEXT)    as "merged_key!: String",
            ar.id                    as "id!",
            ar.name                  as "name!",
            ar.bio                   as "bio?",
            ar.created_at            as "created_at!",
            ar.updated_at            as "updated_at!",
            ar.deleted_at            as "deleted_at?",
            ar.deleted_by            as "deleted_by?",
            ar.created_by            as "created_by?",
            ar.updated_by            as "updated_by?"
           FROM artistz ar
           JOIN json_each(?1) j ON j.value = LOWER(ar.name)
           WHERE ar.deleted_at IS NULL"#,
        keys_json
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to find artists by merged key",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let mut out: HashMap<String, Vec<Artist>> = HashMap::new();
    for r in rows {
        out.entry(r.merged_key).or_default().push(Artist {
            id: r.id,
            name: r.name,
            bio: r.bio,
            images: None,
            urls: None,
            created_at: r.created_at,
            updated_at: r.updated_at,
            deleted_at: r.deleted_at,
            deleted_by: r.deleted_by,
            created_by: r.created_by,
            updated_by: r.updated_by,
        });
    }

    GrimoireResponse::success("artists by merged key retrieved", out)
}
