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

/// list (non-deleted) albums whose `release_date` year falls inside
/// `[min_year, max_year]` (both inclusive). used by the graph view
/// to lazy-fan-out an era bin value node into its member albums when
/// the user pivots into the bin.
///
/// returns the same enriched `AlbumQueryResult` shape as
/// `list_albums_by_taxon_value` so the client can reuse one adapter
/// for all walk-pulled albums.
pub async fn list_albums_in_era_bin(
    min_year: i32,
    max_year: i32,
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
    let min = min_year as i64;
    let max = max_year as i64;

    // parse year from leading 4 chars of release_date (same approach
    // as the histogram pass in list_era_bins) and filter inclusive.
    let sql = r#"SELECT v.*
        FROM album_query_view v
        WHERE v.album_deleted_at IS NULL
          AND v.album_release_date IS NOT NULL
          AND v.album_release_date != ''
          AND CAST(SUBSTR(v.album_release_date, 1, 4) AS INTEGER) BETWEEN ?1 AND ?2
        ORDER BY v.album_created_at DESC
        LIMIT ?3 OFFSET ?4"#;

    let rows: Vec<AlbumViewRow> = match sqlx::query_as::<_, AlbumViewRow>(sql)
        .bind(min)
        .bind(max)
        .bind(limit)
        .bind(offset)
        .fetch_all(&pool)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to list albums in era bin",
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

    GrimoireResponse::success("albums in era bin retrieved", albums)
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
/// greedy decade-aware binning over `album_query_view`:
/// 1. aggregate non-deleted albums by release year (parsed from the
///    leading 4 chars of `album_release_date`).
/// 2. walk years ascending, accumulating into a working bin. emit
///    when the bin reaches `target_min` (default 10). a single year
///    whose count meets or exceeds `target_max` (default 32) becomes
///    a singleton bin so dense epochs stay year-granular.
/// 3. label heuristic: singleton year → `"1995"`, decade-aligned 10y
///    span → `"1990s"`, anything else → `"1990-1994"`.
///
/// `target_min` / `target_max` are advisory hints; both clamp to a
/// sensible floor so callers can't degenerate the algorithm.
pub async fn list_era_bins(
    target_min: Option<u32>,
    target_max: Option<u32>,
) -> GrimoireResponse<Vec<EraBin>> {
    let target_min = target_min.unwrap_or(10).max(1);
    let target_max = target_max.unwrap_or(32).max(target_min);

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    // year histogram from the view. cast the leading 4 chars of the
    // release-date string to integer; sqlite returns 0 for unparseable
    // strings which we filter out via the outer HAVING. wrap in a
    // subquery so the GROUP BY / HAVING can reference the aliased
    // column (sqlite doesn't allow alias refs in HAVING otherwise).
    let rows = match sqlx::query!(
        r#"
        SELECT year as "year!: i64", COUNT(*) as "count!: i64"
        FROM (
            SELECT CAST(SUBSTR(album_release_date, 1, 4) AS INTEGER) as year
            FROM album_query_view
            WHERE album_release_date IS NOT NULL
              AND album_release_date != ''
              AND album_deleted_at IS NULL
        )
        WHERE year > 0
        GROUP BY year
        ORDER BY year ASC
        "#,
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to query year histogram",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let histogram: Vec<(i32, u32)> = rows
        .into_iter()
        .map(|r| (r.year as i32, r.count as u32))
        .collect();

    let bins = bin_years(&histogram, target_min, target_max);
    GrimoireResponse::success("era bins retrieved", bins)
}

/// pure greedy binning pass over `(year, count)` pairs, ascending by
/// year. exposed for unit tests; production callers go through
/// `list_era_bins`.
///
/// invariants:
/// - input must be sorted by year ascending and have unique years.
/// - empty input produces empty output.
/// - every input album lands in exactly one bin.
fn bin_years(histogram: &[(i32, u32)], target_min: u32, target_max: u32) -> Vec<EraBin> {
    if histogram.is_empty() {
        return Vec::new();
    }

    let mut bins: Vec<EraBin> = Vec::new();
    let mut cur_min: Option<i32> = None;
    let mut cur_max: i32 = 0;
    let mut cur_count: u32 = 0;

    let flush = |bins: &mut Vec<EraBin>, min: i32, max: i32, count: u32| {
        let label = label_for_span(min, max);
        bins.push(EraBin {
            value_norm: label.clone(),
            label,
            count,
            min_year: Some(min),
            max_year: Some(max),
        });
    };

    for &(year, count) in histogram {
        // singleton: a year so dense it deserves its own bin. flush
        // any in-progress bin first so ordering stays consistent.
        if count >= target_max {
            if let Some(min) = cur_min {
                flush(&mut bins, min, cur_max, cur_count);
                cur_min = None;
                cur_count = 0;
            }
            flush(&mut bins, year, year, count);
            continue;
        }

        // start or extend the working bin.
        if cur_min.is_none() {
            cur_min = Some(year);
        }
        cur_max = year;
        cur_count += count;

        if cur_count >= target_min {
            if let Some(min) = cur_min {
                flush(&mut bins, min, cur_max, cur_count);
            }
            cur_min = None;
            cur_count = 0;
        }
    }

    // trailing under-target bin: merge into the previous bin if there
    // is one (avoids orphans), otherwise emit as-is.
    if let Some(min) = cur_min {
        if let Some(last) = bins.last_mut() {
            let merged_min = last.min_year.unwrap_or(min);
            let merged_max = cur_max;
            let merged_count = last.count + cur_count;
            let label = label_for_span(merged_min, merged_max);
            last.value_norm = label.clone();
            last.label = label;
            last.count = merged_count;
            last.min_year = Some(merged_min);
            last.max_year = Some(merged_max);
        } else {
            flush(&mut bins, min, cur_max, cur_count);
        }
    }

    bins
}

/// label/value-norm rule for an era bin spanning `min..=max`:
/// - same year → `"1995"`.
/// - exactly 10 years aligned to a decade → `"1990s"`.
/// - otherwise → `"1990-1994"`.
fn label_for_span(min: i32, max: i32) -> String {
    if min == max {
        return min.to_string();
    }
    if max - min == 9 && min % 10 == 0 {
        return format!("{}s", min);
    }
    format!("{}-{}", min, max)
}

#[cfg(test)]
mod era_bin_tests {
    use super::*;

    #[test]
    fn empty_input_yields_empty_bins() {
        assert!(bin_years(&[], 10, 32).is_empty());
    }

    #[test]
    fn dense_year_becomes_singleton_bin() {
        let bins = bin_years(&[(1995, 50)], 10, 32);
        assert_eq!(bins.len(), 1);
        assert_eq!(bins[0].label, "1995");
        assert_eq!(bins[0].count, 50);
    }

    #[test]
    fn decade_aligned_span_gets_decade_label() {
        let hist: Vec<(i32, u32)> = (1990..=1999).map(|y| (y, 1)).collect();
        let bins = bin_years(&hist, 10, 32);
        assert_eq!(bins.len(), 1);
        assert_eq!(bins[0].label, "1990s");
        assert_eq!(bins[0].count, 10);
    }

    #[test]
    fn sparse_years_merge_into_wide_bin() {
        let bins = bin_years(&[(1930, 1), (1945, 2), (1969, 3)], 10, 32);
        // trailing under-target merges into the (only) prior bin —
        // which itself is the only entry here since we never hit
        // target_min. single emit covers the full span.
        assert_eq!(bins.len(), 1);
        assert_eq!(bins[0].min_year, Some(1930));
        assert_eq!(bins[0].max_year, Some(1969));
        assert_eq!(bins[0].label, "1930-1969");
        assert_eq!(bins[0].count, 6);
    }

    #[test]
    fn singleton_flushes_in_progress_bin_first() {
        let hist = vec![(1990, 5), (1991, 4), (1995, 100)];
        let bins = bin_years(&hist, 10, 32);
        // 1990+1991 (under target_min=10, only 9) → flushed-via-merge
        // into the singleton's leftover-merge path? actually: the
        // 1995 singleton emits first AFTER flushing the in-progress
        // bin as its own span. so we get 2 bins: 1990-1991 then 1995.
        assert_eq!(bins.len(), 2);
        assert_eq!(bins[0].label, "1990-1991");
        assert_eq!(bins[0].count, 9);
        assert_eq!(bins[1].label, "1995");
        assert_eq!(bins[1].count, 100);
    }
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
