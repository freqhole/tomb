//! related-artist proposals (slice 4c).
//!
//! the lastfm / audiodb / mb processors write rows into `related_artistz`
//! with `status = 'pending'`. the bulk enrichment review wizard surfaces
//! those pending rows through `propose_related_artists` and the user
//! flips them to `accepted` (or soft-deletes them) via
//! `apply_related_artists`.
//!
//! read-only against `related_artistz` for the propose half; the apply
//! half issues a single batched UPDATE per (accept / reject) bucket.
//!
//! request shape mirrors `bio_proposals`: accepts `artist_id` OR
//! `album_id` and resolves album → primary artist server-side via
//! `album_songz JOIN artist_songz LIMIT 1`.

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

use crate::database;
use crate::error::ErrorDetail;
use crate::response::GrimoireResponse;

/// one pending related-artist row the user can accept or reject.
///
/// `id` is the `related_artistz.id` (uuid). the apply step references
/// rows by id rather than by name/source so that multiple pending
/// rows for the same related-name from different sources are
/// individually selectable.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct RelatedArtistProposal {
    pub id: String,
    pub related_name: String,
    /// when the related artist already exists in our local library this
    /// points at the local row. ui can render an "in library" badge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub related_artist_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub related_mbid: Option<String>,
    /// stored as the source enum's lowercase string ("lastfm" |
    /// "audiodb" | "mb"). kept as a plain string to avoid a churn of
    /// re-deriving the source enum here.
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub match_score: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
    pub fetched_at: i64,
}

/// request body for `propose_related_artists`. exactly one of
/// `artist_id` or `album_id` must be provided.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct ProposeRelatedArtistsRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album_id: Option<String>,
}

/// response wrapper — includes the resolved `artist_id` so callers
/// that passed `album_id` can drive the subsequent
/// `apply_related_artists` call without a separate lookup.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct ProposeRelatedArtistsResponse {
    pub artist_id: String,
    pub proposals: Vec<RelatedArtistProposal>,
}

/// request body for `apply_related_artists`. accept ids are flipped
/// `pending` -> `accepted`; reject ids are soft-deleted (we don't
/// actually want to lose the row in case the source returns it again
/// — soft-delete keeps the unique constraint slot but hides it from
/// future proposals).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct ApplyRelatedArtistsRequest {
    pub artist_id: String,
    #[serde(default)]
    pub accept_ids: Vec<String>,
    #[serde(default)]
    pub reject_ids: Vec<String>,
}

/// summary returned by `apply_related_artists`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct ApplyRelatedArtistsResult {
    pub artist_id: String,
    pub accepted: u64,
    pub rejected: u64,
}

/// list every `pending` row for the resolved artist.
pub async fn propose_related_artists(
    req: ProposeRelatedArtistsRequest,
) -> GrimoireResponse<ProposeRelatedArtistsResponse> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let artist_id =
        match resolve_artist_id(&pool, req.artist_id.as_deref(), req.album_id.as_deref()).await {
            Ok(id) => id,
            Err(resp) => return resp,
        };

    let rows = match sqlx::query!(
        r#"SELECT
            id as "id!",
            related_artist_id as "related_artist_id?",
            related_name as "related_name!",
            related_mbid as "related_mbid?",
            source as "source!",
            match_score as "match_score?",
            image_url as "image_url?",
            fetched_at as "fetched_at!"
        FROM related_artistz
        WHERE source_artist_id = ?
          AND status = 'pending'
          AND deleted_at IS NULL
        ORDER BY match_score DESC NULLS LAST, related_name COLLATE NOCASE ASC"#,
        artist_id,
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to list related-artist proposals",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let proposals = rows
        .into_iter()
        .map(|r| RelatedArtistProposal {
            id: r.id,
            related_name: r.related_name,
            related_artist_id: r.related_artist_id,
            related_mbid: r.related_mbid,
            source: r.source,
            match_score: r.match_score,
            image_url: r.image_url,
            fetched_at: r.fetched_at,
        })
        .collect();

    GrimoireResponse::success(
        "related-artist proposals",
        ProposeRelatedArtistsResponse {
            artist_id,
            proposals,
        },
    )
}

/// flip pending rows to accepted / soft-deleted in two batched
/// UPDATEs. ids must belong to the given `artist_id` (defense in
/// depth — the WHERE clause includes `source_artist_id` so an attacker
/// can't pass another artist's row id and have it accepted under
/// theirs).
pub async fn apply_related_artists(
    req: ApplyRelatedArtistsRequest,
) -> GrimoireResponse<ApplyRelatedArtistsResult> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    if req.accept_ids.is_empty() && req.reject_ids.is_empty() {
        return GrimoireResponse::success(
            "nothing to apply",
            ApplyRelatedArtistsResult {
                artist_id: req.artist_id,
                accepted: 0,
                rejected: 0,
            },
        );
    }

    let mut accepted: u64 = 0;
    if !req.accept_ids.is_empty() {
        let placeholders = vec!["?"; req.accept_ids.len()].join(",");
        let sql = format!(
            "UPDATE related_artistz \
             SET status = 'accepted', updated_at = unixepoch() \
             WHERE source_artist_id = ? \
               AND status = 'pending' \
               AND deleted_at IS NULL \
               AND id IN ({})",
            placeholders
        );
        let mut q = sqlx::query(&sql).bind(&req.artist_id);
        for id in &req.accept_ids {
            q = q.bind(id);
        }
        match q.execute(&pool).await {
            Ok(r) => accepted = r.rows_affected(),
            Err(e) => {
                return GrimoireResponse::failure(
                    "failed to accept related-artist rows",
                    vec![ErrorDetail::from(e)],
                )
            }
        }
    }

    let mut rejected: u64 = 0;
    if !req.reject_ids.is_empty() {
        let placeholders = vec!["?"; req.reject_ids.len()].join(",");
        let sql = format!(
            "UPDATE related_artistz \
             SET deleted_at = unixepoch(), updated_at = unixepoch() \
             WHERE source_artist_id = ? \
               AND status = 'pending' \
               AND deleted_at IS NULL \
               AND id IN ({})",
            placeholders
        );
        let mut q = sqlx::query(&sql).bind(&req.artist_id);
        for id in &req.reject_ids {
            q = q.bind(id);
        }
        match q.execute(&pool).await {
            Ok(r) => rejected = r.rows_affected(),
            Err(e) => {
                return GrimoireResponse::failure(
                    "failed to reject related-artist rows",
                    vec![ErrorDetail::from(e)],
                )
            }
        }
    }

    GrimoireResponse::success(
        "related-artist proposals applied",
        ApplyRelatedArtistsResult {
            artist_id: req.artist_id,
            accepted,
            rejected,
        },
    )
}

/// shared helper for both endpoints. mirrors the `bio_proposals` rule:
/// prefer `artist_id`; otherwise look up `album_id`'s primary artist
/// via `album_songz JOIN artist_songz LIMIT 1`.
async fn resolve_artist_id(
    pool: &sqlx::SqlitePool,
    artist_id: Option<&str>,
    album_id: Option<&str>,
) -> Result<String, GrimoireResponse<ProposeRelatedArtistsResponse>> {
    match (artist_id, album_id) {
        (Some(a), _) if !a.is_empty() => Ok(a.to_string()),
        (_, Some(album_id)) if !album_id.is_empty() => {
            match sqlx::query_scalar!(
                r#"SELECT artist_songz.artist_id as "artist_id!"
                   FROM album_songz
                   JOIN artist_songz ON artist_songz.song_id = album_songz.song_id
                   WHERE album_songz.album_id = ?
                   LIMIT 1"#,
                album_id
            )
            .fetch_optional(pool)
            .await
            {
                Ok(Some(id)) => Ok(id),
                Ok(None) => Err(GrimoireResponse::failure(
                    "no artist for album",
                    vec![ErrorDetail::new(
                        "not_found",
                        "not found",
                        "no artist linked to album",
                    )],
                )),
                Err(e) => Err(GrimoireResponse::failure(
                    "failed to resolve artist for album",
                    vec![ErrorDetail::from(e)],
                )),
            }
        }
        _ => Err(GrimoireResponse::failure(
            "bad request",
            vec![ErrorDetail::new(
                "bad_request",
                "bad request",
                "one of artist_id or album_id is required",
            )],
        )),
    }
}
