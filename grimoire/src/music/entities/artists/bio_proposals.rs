//! artist bio proposal synthesis (slice 4a).
//!
//! reads an artist's `bio` + `metadata` blob (lastfm + audiodb snapshots)
//! and projects each available bio text into a `BioProposal` the user can
//! review + accept in the bulk enrichment review wizard.
//!
//! this module is **read-only** for `propose_artist_bios` — it never writes
//! to the database. `apply_artist_bio` writes the chosen text back to
//! `artistz.bio`.
//!
//! dedup: proposals are deduplicated by trimmed text. when the same text
//! comes from multiple sources, the first source seen wins (priority order:
//! user > lastfm > audiodb). `is_current = true` flags whichever proposal
//! matches the current persisted bio (after trim).

use serde::{Deserialize, Serialize};
use zod_gen::ZodSchema as ZodSchemaTrait;
use zod_gen_derive::ZodSchema;

use crate::database;
use crate::error::ErrorDetail;
use crate::response::GrimoireResponse;

use super::metadata::ArtistMetadata;

/// where a single bio proposal originated. `User` represents the
/// current persisted `artistz.bio` value (typically a previous accept,
/// possibly hand-edited).
///
/// note: `ZodSchema` is implemented manually below because the derive
/// does not honor `#[serde(rename_all = ...)]`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BioSource {
    User,
    Lastfm,
    Audiodb,
}

impl ZodSchemaTrait for BioSource {
    fn zod_schema() -> String {
        r#"z.union([z.literal("user"), z.literal("lastfm"), z.literal("audiodb")])"#.to_string()
    }
}

/// a single proposed bio the user can accept (as-is or after editing).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct BioProposal {
    pub source: BioSource,
    pub text: String,
    /// unix timestamp the source bio was fetched (lastfm/audiodb). `None`
    /// for the `User` proposal since `artistz` doesn't track bio mtime
    /// separately from row updated_at.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetched_at: Option<i64>,
    /// true if the trimmed text matches the current persisted `artistz.bio`.
    /// the ui dims these (already accepted) but still allows re-selection
    /// for trivial source-of-truth changes.
    pub is_current: bool,
}

/// request body for `propose_artist_bios`. exactly one of `artist_id`
/// or `album_id` must be provided. when `album_id` is given, the server
/// resolves it to the album's primary artist (first linked artist via
/// `album_songz` -> `artist_songz`). this lets the bulk review wizard
/// stay album-keyed without having to fetch songs to find the artist.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct ProposeArtistBiosRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album_id: Option<String>,
}

/// response wrapper for `propose_artist_bios` — includes the resolved
/// `artist_id` so callers that passed `album_id` know which artist the
/// proposals belong to (and can use it for the subsequent
/// `apply_artist_bio` call).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct ProposeArtistBiosResponse {
    pub artist_id: String,
    pub proposals: Vec<BioProposal>,
}

/// request body for `apply_artist_bio`. `text` is the final value the
/// user wants persisted (may differ from any of the source bios because
/// of inline editing).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct ApplyArtistBioRequest {
    pub artist_id: String,
    pub source: BioSource,
    pub text: String,
}

/// summary returned by `apply_artist_bio`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct ApplyArtistBioResult {
    pub artist_id: String,
    pub source: BioSource,
    pub bio: String,
}

/// project the artist's bio + metadata snapshots into a deduplicated
/// list of `BioProposal`s ordered: user > lastfm > audiodb.
///
/// resolves `album_id` -> `artist_id` server-side when the request uses
/// the album-keyed form. returns the resolved `artist_id` in the
/// response so callers can drive `apply_artist_bio` without a separate
/// lookup.
pub async fn propose_artist_bios(
    req: ProposeArtistBiosRequest,
) -> GrimoireResponse<ProposeArtistBiosResponse> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // resolve to an artist_id. prefer explicit artist_id; otherwise
    // look up the album's first linked artist.
    let artist_id = match (req.artist_id.as_deref(), req.album_id.as_deref()) {
        (Some(a), _) if !a.is_empty() => a.to_string(),
        (_, Some(album_id)) if !album_id.is_empty() => {
            match sqlx::query_scalar!(
                r#"SELECT artist_songz.artist_id as "artist_id!"
                   FROM album_songz
                   JOIN artist_songz ON artist_songz.song_id = album_songz.song_id
                   WHERE album_songz.album_id = ?
                   LIMIT 1"#,
                album_id
            )
            .fetch_optional(&pool)
            .await
            {
                Ok(Some(id)) => id,
                Ok(None) => {
                    return GrimoireResponse::failure(
                        "no artist for album",
                        vec![ErrorDetail::new(
                            "not_found",
                            "not found",
                            "no artist linked to album",
                        )],
                    )
                }
                Err(e) => {
                    return GrimoireResponse::failure(
                        "failed to resolve artist for album",
                        vec![ErrorDetail::from(e)],
                    )
                }
            }
        }
        _ => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    "one of artist_id or album_id is required",
                )],
            )
        }
    };

    let row = match sqlx::query!(
        r#"SELECT bio, metadata FROM artistz WHERE id = ? AND deleted_at IS NULL"#,
        artist_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(r)) => r,
        Ok(None) => {
            return GrimoireResponse::failure(
                "artist not found",
                vec![ErrorDetail::new(
                    "not_found",
                    "not found",
                    "artist not found",
                )],
            )
        }
        Err(e) => {
            return GrimoireResponse::failure("failed to load artist", vec![ErrorDetail::from(e)])
        }
    };

    let current_bio = row.bio.unwrap_or_default();
    let current_trim = current_bio.trim();
    let meta = ArtistMetadata::parse(row.metadata.as_deref());

    // collect raw (source, text, fetched_at) candidates.
    let mut raw: Vec<(BioSource, String, Option<i64>)> = Vec::new();

    if !current_trim.is_empty() {
        raw.push((BioSource::User, current_bio.clone(), None));
    }

    if let Some(lf) = meta.lastfm.as_ref() {
        if let Some(artist) = lf.artist.as_ref() {
            if let Some(text) = artist.bio_summary.as_ref() {
                if !text.trim().is_empty() {
                    raw.push((BioSource::Lastfm, text.clone(), lf.fetched_at));
                }
            }
        }
    }

    if let Some(ad) = meta.audiodb.as_ref() {
        if let Some(artist) = ad.artist.as_ref() {
            if let Some(text) = artist.biography_en.as_ref() {
                if !text.trim().is_empty() {
                    raw.push((BioSource::Audiodb, text.clone(), ad.fetched_at));
                }
            }
        }
    }

    // dedup by trimmed text; keep first occurrence (priority order above).
    let mut seen = std::collections::HashSet::<String>::new();
    let mut out: Vec<BioProposal> = Vec::with_capacity(raw.len());
    for (source, text, fetched_at) in raw {
        let key = text.trim().to_string();
        if !seen.insert(key.clone()) {
            continue;
        }
        let is_current = !current_trim.is_empty() && current_trim == text.trim();
        out.push(BioProposal {
            source,
            text,
            fetched_at,
            is_current,
        });
    }

    GrimoireResponse::success(
        "artist bio proposals",
        ProposeArtistBiosResponse {
            artist_id,
            proposals: out,
        },
    )
}

/// write the chosen bio text to `artistz.bio`. preserves the rest of
/// the row + metadata blob untouched.
pub async fn apply_artist_bio(
    req: ApplyArtistBioRequest,
) -> GrimoireResponse<ApplyArtistBioResult> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // confirm the artist exists (avoid silently no-op'ing on a stale id).
    let exists: bool = match sqlx::query_scalar!(
        "SELECT 1 as 'exists: i64' FROM artistz WHERE id = ? AND deleted_at IS NULL",
        req.artist_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(v) => v.is_some(),
        Err(e) => {
            return GrimoireResponse::failure("failed to load artist", vec![ErrorDetail::from(e)])
        }
    };
    if !exists {
        return GrimoireResponse::failure(
            "artist not found",
            vec![ErrorDetail::new(
                "not_found",
                "not found",
                "artist not found",
            )],
        );
    }

    if let Err(e) = sqlx::query!(
        r#"UPDATE artistz SET bio = ?, updated_at = unixepoch() WHERE id = ?"#,
        req.text,
        req.artist_id,
    )
    .execute(&pool)
    .await
    {
        return GrimoireResponse::failure(
            "failed to update artist bio",
            vec![ErrorDetail::from(e)],
        );
    }

    GrimoireResponse::success(
        "artist bio updated",
        ApplyArtistBioResult {
            artist_id: req.artist_id,
            source: req.source,
            bio: req.text,
        },
    )
}
