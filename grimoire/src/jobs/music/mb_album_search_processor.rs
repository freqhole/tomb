//! musicbrainz album-search job processor
//!
//! one job per album. flow:
//! 1. mark `mb_lookup_status = Searching`.
//! 2. read the album row + its primary artist (via `artist_albumz` join).
//! 3. call MB `/release` search (artist + title).
//! 4. map results to `MbCandidate` rows; compute `local_confidence` from a
//!    cheap title/artist token-overlap heuristic on top of MB's lucene score.
//! 5. merge candidates + last_query into the album metadata blob.
//! 6. choose final status:
//!      - `Confirmed`  if exactly one strong candidate >= auto_confirm_threshold
//!                     AND a threshold was provided.
//!      - `NeedsReview` if multiple strong candidates.
//!      - `Candidates`  if at least one candidate but nothing strong.
//!      - `NoMatch`     if zero results.
//!      - `Error`       on api/network failure (kept for retry by the runner).
//!
//! schema/json side effects go through `albums::repository::merge_album_metadata`
//! and `update_mb_lookup_status` so all metadata writers stay centralized.

use crate::config;
use crate::database;
use crate::jobs::models::{Job, JobError};
use crate::music::entities::albums as albums_repo;
use crate::music::entities::albums::metadata::{self, MbCandidate, MbLastQuery, MbLookupStatus};
use crate::music::musicbrainz::{MusicBrainzClient, ReleaseSearchQuery};
use serde_json::Value;
use tracing::info;

use super::models::{MbAlbumSearchParams, MbAlbumSearchResult};

const DEFAULT_LIMIT: u32 = 10;

pub async fn process_mb_album_search_job(job: &Job) -> Result<Option<Value>, JobError> {
    let params: MbAlbumSearchParams =
        serde_json::from_str(&job.parameters).map_err(|e| JobError::ProcessingFailed {
            reason: format!("invalid parameters: {}", e),
        })?;

    let album_id = params.album_id.clone();
    info!("mb album-search starting for album {}", album_id);

    // step 1: mark searching (best-effort; don't fail the job on a write error)
    let _ = albums_repo::update_mb_lookup_status(
        &album_id,
        MbLookupStatus::Searching,
        job.created_by.as_deref(),
    )
    .await;

    // step 2: read album row + primary artist
    let pool = database::connect()
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("db connect: {}", e),
        })?;

    let row = sqlx::query!(
        r#"SELECT title as "title!", deleted_at FROM albumz WHERE id = ?"#,
        album_id
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| JobError::ProcessingFailed {
        reason: format!("read album: {}", e),
    })?;

    let row = match row {
        Some(r) if r.deleted_at.is_none() => r,
        _ => {
            // mark error so the ui surfaces this; don't retry forever
            let _ = albums_repo::update_mb_lookup_status(
                &album_id,
                MbLookupStatus::Error,
                job.created_by.as_deref(),
            )
            .await;
            return Err(JobError::ProcessingFailed {
                reason: format!("album {} not found or deleted", album_id),
            });
        }
    };

    let title = params
        .title_override
        .clone()
        .unwrap_or_else(|| row.title.clone());

    let artist = if let Some(a) = params.artist_override.clone() {
        Some(a)
    } else {
        sqlx::query_scalar!(
            r#"SELECT art.name FROM artist_albumz aa
               JOIN artistz art ON art.id = aa.artist_id
               WHERE aa.album_id = ?
               LIMIT 1"#,
            album_id
        )
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten()
    };

    // step 3: call MB
    let cfg = config::get_config();
    let client = match MusicBrainzClient::new(cfg.musicbrainz.clone()) {
        Ok(c) => c,
        Err(e) => {
            let _ = albums_repo::update_mb_lookup_status(
                &album_id,
                MbLookupStatus::Error,
                job.created_by.as_deref(),
            )
            .await;
            return Err(JobError::ProcessingFailed {
                reason: format!("musicbrainz client unavailable: {}", e),
            });
        }
    };

    let mut query = ReleaseSearchQuery::new().release(&title);
    if let Some(a) = artist.as_deref() {
        if !a.is_empty() {
            query = query.artist(a);
        }
    }
    query = query.limit(DEFAULT_LIMIT);

    info!(
        "mb album-search querying: artist={:?} title={}",
        artist, title
    );
    let resp = client.search_releases(&query).await;
    if !resp.success {
        let _ = albums_repo::update_mb_lookup_status(
            &album_id,
            MbLookupStatus::Error,
            job.created_by.as_deref(),
        )
        .await;
        return Err(JobError::ProcessingFailed {
            reason: format!("mb search failed: {}", resp.message),
        });
    }
    let search = resp
        .data
        .unwrap_or(crate::music::musicbrainz::models::SearchResult {
            results: vec![],
            count: 0,
            offset: 0,
        });

    // step 4: map + score candidates
    let candidates: Vec<MbCandidate> = search
        .results
        .iter()
        .map(|r| {
            let primary_artist = r.primary_artist_name().unwrap_or_default();
            let track_count = r.media.as_ref().and_then(|media| {
                media
                    .iter()
                    .filter_map(|m| m.tracks.as_ref().map(|t| t.len() as i64))
                    .next()
            });
            let local_confidence = compute_local_confidence(
                &title,
                artist.as_deref(),
                &r.title,
                &primary_artist,
                r.score,
            );
            MbCandidate {
                release_group_id: r
                    .release_group
                    .as_ref()
                    .map(|rg| rg.id.to_string())
                    .unwrap_or_default(),
                release_id: Some(r.id.to_string()),
                title: r.title.clone(),
                artist: primary_artist,
                first_release_date: r.date.clone().or_else(|| {
                    r.release_group
                        .as_ref()
                        .and_then(|rg| rg.first_release_date.clone())
                }),
                track_count,
                country: r.country.clone(),
                primary_type: r
                    .release_group
                    .as_ref()
                    .and_then(|rg| rg.primary_type.clone()),
                secondary_types: r
                    .release_group
                    .as_ref()
                    .and_then(|rg| rg.secondary_types.clone())
                    .unwrap_or_default(),
                mb_score: r.score.map(|s| s as i32),
                local_confidence: Some(local_confidence),
            }
        })
        .collect();

    // sort by local_confidence desc so the ui shows best first
    let mut sorted = candidates.clone();
    sorted.sort_by(|a, b| {
        b.local_confidence
            .unwrap_or(0.0)
            .partial_cmp(&a.local_confidence.unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let last_query = MbLastQuery {
        artist: artist.clone().unwrap_or_default(),
        release: title.clone(),
        tracks: None,
    };

    // step 5: merge into metadata
    let patch = metadata::patch_mb_search_result(&sorted, &last_query);
    let merge_resp = albums_repo::merge_album_metadata(&album_id, &patch).await;
    if !merge_resp.success {
        let _ = albums_repo::update_mb_lookup_status(
            &album_id,
            MbLookupStatus::Error,
            job.created_by.as_deref(),
        )
        .await;
        return Err(JobError::ProcessingFailed {
            reason: format!("metadata merge failed: {}", merge_resp.message),
        });
    }

    // step 6: pick final status
    let top_conf = sorted.first().and_then(|c| c.local_confidence);
    let strong_count = sorted
        .iter()
        .filter(|c| c.local_confidence.unwrap_or(0.0) >= 0.85)
        .count();

    let mut auto_confirmed_release_id: Option<String> = None;
    let final_status = if sorted.is_empty() {
        MbLookupStatus::NoMatch
    } else if let (Some(threshold), Some(top)) = (params.auto_confirm_threshold, sorted.first()) {
        let conf = top.local_confidence.unwrap_or(0.0);
        if conf >= threshold && strong_count == 1 {
            // auto-confirm: write the confirmation patch too
            let confirmed_at = time::OffsetDateTime::now_utc().unix_timestamp();
            let confirm_patch = metadata::patch_mb_confirmation(
                &top.release_group_id,
                top.release_id.as_deref(),
                confirmed_at,
                job.created_by.as_deref(),
            );
            let _ = albums_repo::merge_album_metadata(&album_id, &confirm_patch).await;
            auto_confirmed_release_id = top.release_id.clone();
            MbLookupStatus::Confirmed
        } else if strong_count > 1 {
            MbLookupStatus::NeedsReview
        } else {
            MbLookupStatus::Candidates
        }
    } else if strong_count > 1 {
        MbLookupStatus::NeedsReview
    } else {
        MbLookupStatus::Candidates
    };

    let _ =
        albums_repo::update_mb_lookup_status(&album_id, final_status, job.created_by.as_deref())
            .await;

    info!(
        "mb album-search done album={} status={} candidates={} top_local_confidence={:?} mb_score_top={:?} auto_confirmed={:?}",
        album_id,
        final_status.as_str(),
        sorted.len(),
        top_conf,
        sorted.first().and_then(|c| c.mb_score),
        auto_confirmed_release_id,
    );

    let result = MbAlbumSearchResult {
        album_id: album_id.clone(),
        candidate_count: sorted.len() as u64,
        top_local_confidence: top_conf,
        auto_confirmed_release_id,
        final_status: final_status.as_str().to_string(),
    };

    info!(
        "mb album-search complete for {}: status={} candidates={} top_conf={:?}",
        album_id,
        final_status.as_str(),
        result.candidate_count,
        result.top_local_confidence,
    );

    Ok(Some(serde_json::to_value(result).map_err(|e| {
        JobError::ProcessingFailed {
            reason: format!("serialize result: {}", e),
        }
    })?))
}

/// cheap, deterministic confidence score in [0.0, 1.0].
/// blends MB's lucene score (when present) with token-overlap on title
/// + artist. exact normalised matches on both fields cap at 1.0.
fn compute_local_confidence(
    query_title: &str,
    query_artist: Option<&str>,
    cand_title: &str,
    cand_artist: &str,
    mb_score: Option<u32>,
) -> f64 {
    let title_overlap = token_jaccard(query_title, cand_title);
    let artist_overlap = match query_artist {
        Some(a) if !a.is_empty() => token_jaccard(a, cand_artist),
        _ => 0.5, // unknown artist on our side: don't penalise hard
    };
    let mb_norm = mb_score
        .map(|s| (s as f64 / 100.0).clamp(0.0, 1.0))
        .unwrap_or(0.5);

    // weights: title 0.45, artist 0.35, mb 0.20
    let blended = 0.45 * title_overlap + 0.35 * artist_overlap + 0.20 * mb_norm;
    blended.clamp(0.0, 1.0)
}

fn token_jaccard(a: &str, b: &str) -> f64 {
    let na = normalise(a);
    let nb = normalise(b);
    if na.is_empty() || nb.is_empty() {
        return 0.0;
    }
    if na == nb {
        return 1.0;
    }
    let ta: std::collections::HashSet<&str> = na.split_whitespace().collect();
    let tb: std::collections::HashSet<&str> = nb.split_whitespace().collect();
    if ta.is_empty() || tb.is_empty() {
        return 0.0;
    }
    let inter = ta.intersection(&tb).count() as f64;
    let union = ta.union(&tb).count() as f64;
    if union == 0.0 {
        0.0
    } else {
        inter / union
    }
}

fn normalise(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jaccard_identical_strings_score_one() {
        assert_eq!(token_jaccard("Kid A", "kid a"), 1.0);
    }

    #[test]
    fn jaccard_no_overlap_scores_zero() {
        assert_eq!(token_jaccard("apple", "banana"), 0.0);
    }

    #[test]
    fn jaccard_partial_overlap_between_zero_and_one() {
        let s = token_jaccard("dark side of the moon", "dark side");
        assert!(s > 0.0 && s < 1.0);
    }

    #[test]
    fn confidence_combines_signals() {
        let c =
            compute_local_confidence("Kid A", Some("Radiohead"), "Kid A", "Radiohead", Some(100));
        assert!(c >= 0.95);
    }

    #[test]
    fn confidence_low_when_nothing_matches() {
        let c = compute_local_confidence("foo", Some("bar"), "baz", "qux", Some(0));
        assert!(c < 0.3);
    }
}
