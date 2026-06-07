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
use crate::jobs::job_events;
use crate::jobs::models::{Job, JobError};
use crate::music::entities::albums as albums_repo;
use crate::music::entities::albums::metadata::{
    self, AlbumMetadata, MbCandidate, MbLastQuery, MbLookupStatus,
};
use crate::music::musicbrainz::{MusicBrainzClient, ReleaseSearchQuery};
use serde_json::Value;
use tracing::info;

use super::models::{MbAlbumSearchParams, MbAlbumSearchResult};

const DEFAULT_LIMIT: u32 = 10;
const FALLBACK_TRIGGER: f64 = 0.5;
const FALLBACK_LIMIT: u32 = 25;
const DIVERSITY_REVIEW_THRESHOLD: usize = 4;
const CONFIRMED_POINTER_REVALIDATE_THRESHOLD: f64 = 0.85;

/// mbids collected from non-MB enrichment sources.
///
/// used to:
///   • boost candidates: check `release_or_rg_mbids` against both the
///     candidate's `release_id` AND `release_group_id`.
///   • narrow queries: attach `arid:<uuid>` instead of free-text
///     artist clause when `artist_mbids` is non-empty.
struct CrossApiIds {
    /// release ids (lastfm `album.mbid`) and release-group ids
    /// (audiodb `musicbrainz_release_group_id`) combined into one set.
    release_or_rg_mbids: std::collections::HashSet<String>,
    /// artist mbids from external sources (for `arid:` query narrowing).
    artist_mbids: Vec<String>,
}

/// collect cross-api mbids from all enrichment sources present in metadata.
fn collect_cross_api_ids(meta: &AlbumMetadata) -> CrossApiIds {
    let mut release_or_rg_mbids = std::collections::HashSet::new();
    let artist_mbids = Vec::new();
    // lastfm album.mbid is a release id (not a release-group id).
    if let Some(lf) = meta.lastfm.as_ref().and_then(|l| l.album.as_ref()) {
        if let Some(m) = lf.mbid.as_ref().filter(|s| !s.is_empty()) {
            release_or_rg_mbids.insert(m.clone());
        }
    }
    // audiodb supplies a release-group id.
    if let Some(adb) = meta.audiodb.as_ref().and_then(|a| a.album.as_ref()) {
        if let Some(m) = adb
            .musicbrainz_release_group_id
            .as_ref()
            .filter(|s| !s.is_empty())
        {
            release_or_rg_mbids.insert(m.clone());
        }
    }
    CrossApiIds {
        release_or_rg_mbids,
        artist_mbids,
    }
}

/// holds the output of a single mb release-search stage (query, score, sort).
struct StageResult {
    sorted: Vec<MbCandidate>,
    last_query: MbLastQuery,
    sort_meta: std::collections::HashMap<String, (u32, bool, u8, u8, Option<u32>, u8)>,
    /// distinct primary-artist names (lowercased) seen in this result set.
    distinct_artist_count: usize,
}

fn parse_year(s: &str) -> Option<u32> {
    s.get(0..4).and_then(|y| y.parse::<u32>().ok())
}

fn country_rank(c: Option<&str>, preferred: &str) -> u8 {
    match c {
        Some("XW") => 2,
        Some(s) if s == preferred => 1,
        _ => 0,
    }
}

fn format_rank(f: Option<&str>) -> u8 {
    match f.map(|s| s.to_lowercase()) {
        Some(s) if s.contains("digital") => 2,
        Some(s) if s.contains("cd") => 1,
        _ => 0,
    }
}

/// number of '-' separators in a date string: 0 = year-only, 1 = year-month, 2 = full date.
/// used as a tiebreaker: more specific date wins (higher value preferred).
fn date_precision(s: &str) -> u8 {
    s.bytes().filter(|&b| b == b'-').count().min(2) as u8
}

/// synthesize an `MbCandidate` from a direct release-group lookup.
/// `cross_api_mbid_match` is always `true` for direct lookups — the caller
/// must pass `true` when invoking `compute_local_confidence`.
fn candidate_from_rg(rg: &crate::music::musicbrainz::models::ReleaseGroup) -> MbCandidate {
    let primary_artist = rg
        .artist_credit
        .as_ref()
        .and_then(|ac| ac.first())
        .map(|ac| ac.name.clone())
        .unwrap_or_default();
    MbCandidate {
        release_group_id: rg.id.to_string(),
        release_id: None,
        title: rg.title.clone(),
        artist: primary_artist,
        first_release_date: rg.first_release_date.clone(),
        track_count: None,
        country: None,
        primary_type: rg.primary_type.clone(),
        secondary_types: rg.secondary_types.clone().unwrap_or_default(),
        media: None,
        mb_score: rg.score.map(|s| s as i32),
        local_confidence: None,
        cover_art_count: None,
        has_front_cover: None,
    }
}

/// synthesize an `MbCandidate` from a direct release lookup (fallback when
/// the cross-api mbid is a release id rather than a release-group id).
fn candidate_from_release(rel: &crate::music::musicbrainz::models::Release) -> MbCandidate {
    let primary_artist = rel
        .artist_credit
        .as_ref()
        .and_then(|ac| ac.first())
        .map(|ac| ac.name.clone())
        .unwrap_or_default();
    let rg = rel.release_group.as_ref();
    let media_format = rel
        .media
        .as_ref()
        .and_then(|m| m.first())
        .and_then(|m| m.format.clone());
    let track_count = rel.media.as_ref().and_then(|media| {
        media
            .iter()
            .filter_map(|m| m.tracks.as_ref().map(|t| t.len() as i64))
            .next()
    });
    MbCandidate {
        release_group_id: rg.map(|r| r.id.to_string()).unwrap_or_default(),
        release_id: Some(rel.id.to_string()),
        title: rel.title.clone(),
        artist: primary_artist,
        first_release_date: rel
            .date
            .clone()
            .or_else(|| rg.and_then(|r| r.first_release_date.clone())),
        track_count,
        country: rel.country.clone(),
        primary_type: rg.and_then(|r| r.primary_type.clone()),
        secondary_types: rg
            .and_then(|r| r.secondary_types.clone())
            .unwrap_or_default(),
        media: media_format,
        mb_score: rel.score.map(|s| s as i32),
        local_confidence: None,
        cover_art_count: rel.cover_art_archive.as_ref().map(|c| c.count),
        has_front_cover: rel.cover_art_archive.as_ref().map(|c| c.front),
    }
}

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

    // read album metadata once. reused for:
    //   • entry short-circuit (confirmed pointer revalidation)
    //   • cross_api_mbids collection
    //   • prev_confirmation pointer capture
    let initial_metadata = albums_repo::read_album_metadata(&album_id).await;

    // entry short-circuit: if a confirmed pointer already exists and the
    // previously-confirmed candidate still scores at or above the
    // revalidation threshold, skip the cascade entirely. just stamp
    // match_revalidated_at and exit. this avoids burning rate-limit budget
    // on albums that are already correctly matched.
    if let Some(meta) = initial_metadata.data.as_ref() {
        if let Some(mb) = meta.musicbrainz.as_ref() {
            if let (Some(rg_id), Some(_confirmed_at)) =
                (mb.release_group_id.as_deref(), mb.match_confirmed_at)
            {
                let top = mb
                    .candidates
                    .iter()
                    .find(|c| c.release_group_id.as_str() == rg_id);
                if let Some(top) = top {
                    let threshold = CONFIRMED_POINTER_REVALIDATE_THRESHOLD;
                    if top.local_confidence.unwrap_or(0.0) >= threshold {
                        let revalidated_at = time::OffsetDateTime::now_utc().unix_timestamp();
                        let patch = serde_json::json!({
                            "musicbrainz": { "match_revalidated_at": revalidated_at }
                        });
                        let _ = albums_repo::merge_album_metadata(&album_id, &patch).await;
                        let _ = albums_repo::update_mb_lookup_status(
                            &album_id,
                            MbLookupStatus::Confirmed,
                            job.created_by.as_deref(),
                        )
                        .await;
                        let result = MbAlbumSearchResult {
                            album_id: album_id.clone(),
                            candidate_count: mb.candidates.len() as u64,
                            top_local_confidence: top.local_confidence,
                            auto_confirmed_release_id: mb.release_id.clone(),
                            final_status: "confirmed".to_string(),
                        };
                        return Ok(Some(serde_json::to_value(result).map_err(|e| {
                            JobError::ProcessingFailed {
                                reason: format!("serialize revalidated result: {}", e),
                            }
                        })?));
                    }
                }
            }
        }
    }
    let preferred_country = cfg.musicbrainz.preferred_country.clone();
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

    // collect cross-api mbids from prior enrichment runs. used for:
    //   • candidate mbid_match boost (release_id OR release_group_id)
    //   • arid: query narrowing when artist mbids are available
    let ids = initial_metadata
        .data
        .as_ref()
        .map(collect_cross_api_ids)
        .unwrap_or_else(|| CrossApiIds {
            release_or_rg_mbids: Default::default(),
            artist_mbids: vec![],
        });

    // capture any previously stored confirmation pointer so we can
    // decide whether re-querying invalidates it (see step 5 below).
    let prev_confirmation: (Option<String>, Option<String>) = initial_metadata
        .data
        .as_ref()
        .and_then(|m| m.musicbrainz.as_ref())
        .map(|mb| (mb.release_id.clone(), mb.release_group_id.clone()))
        .unwrap_or((None, None));

    // compute local song summary before the mb call (uses pool; no rate limit).
    let local_song_summary: Option<(usize, u64)> = {
        let row = sqlx::query!(
            r#"SELECT COUNT(*) as "n!", COALESCE(SUM(s.duration), 0) as "secs!"
               FROM album_songz aas
               JOIN songz s ON s.id = aas.song_id
               WHERE aas.album_id = ? AND s.deleted_at IS NULL"#,
            album_id
        )
        .fetch_one(&pool)
        .await
        .ok();
        row.map(|r| (r.n as usize, r.secs as u64))
    };

    // phase 5 — direct mbid lookup short-circuit.
    // when a cross-api source (last.fm album.mbid, audiodb musicbrainz_release_group_id)
    // has provided a release or release-group mbid, look it up directly in mb.
    // this short-circuits the text cascade when confidence is high enough.
    if !ids.release_or_rg_mbids.is_empty() {
        job_events::emit_stage_from_job(
            job,
            "direct_lookup",
            Some("trying direct mbid lookup from cross-api sources"),
        );
        let mut sorted_mbids: Vec<&String> = ids.release_or_rg_mbids.iter().collect();
        sorted_mbids.sort();
        'direct: for mbid in sorted_mbids {
            // try release-group endpoint first (audiodb provides rg ids directly)
            crate::jobs::rate_limit::acquire(crate::jobs::rate_limit::Source::Mb).await;
            let rg_resp = client.lookup_release_group_search(mbid).await;
            let direct_cand: Option<MbCandidate> = if let Some(rg) = rg_resp.data.as_ref() {
                Some(candidate_from_rg(rg))
            } else {
                // rg lookup failed: mbid may be a release id (e.g. from last.fm)
                crate::jobs::rate_limit::acquire(crate::jobs::rate_limit::Source::Mb).await;
                let rel_resp = client.lookup_release_search(mbid).await;
                rel_resp.data.as_ref().map(|r| candidate_from_release(r))
            };
            let Some(mut direct_cand) = direct_cand else {
                continue 'direct;
            };
            let conf = compute_local_confidence(
                &title,
                artist.as_deref(),
                &direct_cand.title,
                &direct_cand.artist,
                direct_cand.mb_score.map(|s| s.max(0) as u32),
                direct_cand.country.as_deref(),
                direct_cand.media.as_deref(),
                None,
                local_song_summary,
                None,
                true, // always true: this mbid came from a cross-api source
                direct_cand.cover_art_count.unwrap_or(0),
                direct_cand.has_front_cover.unwrap_or(false),
                None, // no result set → no earliest-year comparison
                &preferred_country,
            );
            direct_cand.local_confidence = Some(conf);
            if conf < FALLBACK_TRIGGER {
                tracing::warn!(
                    "mb direct lookup: album {} mbid={} confidence {:.2} too low, falling through to cascade",
                    album_id, mbid, conf
                );
                continue 'direct;
            }
            // write candidate so the ui has something to show regardless of outcome
            let direct_query = MbLastQuery {
                artist: artist.as_deref().unwrap_or_default().to_string(),
                release: title.clone(),
                tracks: None,
                stage: Some("direct_lookup".to_string()),
            };
            let patch =
                metadata::patch_mb_search_result(std::slice::from_ref(&direct_cand), &direct_query);
            let merge_resp = albums_repo::merge_album_metadata(&album_id, &patch).await;
            if !merge_resp.success {
                tracing::warn!(
                    "mb direct lookup metadata merge failed for album {}: {}",
                    album_id,
                    merge_resp.message
                );
                break 'direct; // continue to cascade
            }
            let threshold = params.auto_confirm_threshold.unwrap_or(f64::MAX);
            if conf >= threshold {
                let confirmed_at = time::OffsetDateTime::now_utc().unix_timestamp();
                let confirm_patch = metadata::patch_mb_confirmation(
                    &direct_cand.release_group_id,
                    direct_cand.release_id.as_deref(),
                    confirmed_at,
                    job.created_by.as_deref(),
                );
                let _ = albums_repo::merge_album_metadata(&album_id, &confirm_patch).await;
                let _ = albums_repo::update_mb_lookup_status(
                    &album_id,
                    MbLookupStatus::Confirmed,
                    job.created_by.as_deref(),
                )
                .await;
                if !direct_cand.release_group_id.is_empty() {
                    let detail_params = crate::jobs::MbAlbumDetailParams {
                        album_id: album_id.clone(),
                        release_group_id: direct_cand.release_group_id.clone(),
                        release_id: direct_cand.release_id.clone(),
                    };
                    if let Ok(parameters) = serde_json::to_value(&detail_params) {
                        let req = crate::jobs::CreateJobRequest {
                            job_type: crate::jobs::JobType::MbAlbumDetail,
                            session_id: job.session_id.clone(),
                            parameters,
                            max_retries: Some(2),
                            scheduled_at: None,
                            created_by: job.created_by.clone(),
                            priority: None,
                        };
                        let chain_resp = crate::jobs::create_job(req).await;
                        if chain_resp.data.is_none() {
                            tracing::warn!(
                                "mb direct lookup: failed to chain detail for album {}: {}",
                                album_id,
                                chain_resp.message
                            );
                        }
                    }
                }
                info!(
                    "mb album-search direct lookup confirmed album={} mbid={} conf={:.2}",
                    album_id, mbid, conf
                );
                let result = MbAlbumSearchResult {
                    album_id: album_id.clone(),
                    candidate_count: 1,
                    top_local_confidence: Some(conf),
                    auto_confirmed_release_id: direct_cand.release_id.clone(),
                    final_status: MbLookupStatus::Confirmed.as_str().to_string(),
                };
                return Ok(Some(serde_json::to_value(result).map_err(|e| {
                    JobError::ProcessingFailed {
                        reason: format!("serialize result: {}", e),
                    }
                })?));
            }
            // conf is in [FALLBACK_TRIGGER, threshold): candidate was written;
            // cascade proceeds and may surface a better or confirming result.
            info!(
                "mb album-search direct lookup: mbid={} conf={:.2} below auto-confirm threshold, continuing to cascade",
                mbid, conf
            );
            break 'direct;
        }
    }

    job_events::emit_stage_from_job(
        job,
        "strict_search",
        Some("strict artist+title musicbrainz search"),
    );
    let stage1 = match run_release_search(
        &client,
        &title,
        artist.as_deref(),
        &ids,
        DEFAULT_LIMIT,
        local_song_summary,
        &preferred_country,
        true,
        true,
        "strict",
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            let _ = albums_repo::update_mb_lookup_status(
                &album_id,
                MbLookupStatus::Error,
                job.created_by.as_deref(),
            )
            .await;
            return Err(e);
        }
    };

    // stage 2 — artist-only fallback.
    // runs when strict stage returned no results or top confidence is below
    // FALLBACK_TRIGGER. omitting the release text recovers from title
    // misspellings or partial-title collisions.
    let need_stage2 = stage1.sorted.is_empty()
        || stage1
            .sorted
            .first()
            .and_then(|c| c.local_confidence)
            .unwrap_or(0.0)
            < FALLBACK_TRIGGER;
    let stage2: Option<StageResult> = if need_stage2
        && (!ids.artist_mbids.is_empty()
            || artist.as_deref().map(|s| !s.is_empty()).unwrap_or(false))
    {
        job_events::emit_stage_from_job(
            job,
            "artist_only_fallback",
            Some("strict search low-confidence; falling back to artist-only"),
        );
        match run_release_search(
            &client,
            &title,
            artist.as_deref(),
            &ids,
            FALLBACK_LIMIT,
            local_song_summary,
            &preferred_country,
            false,
            true,
            "artist_only",
        )
        .await
        {
            Ok(r) => Some(r),
            Err(e) => {
                tracing::warn!(
                    "mb album-search artist-only stage failed for album {}: {}",
                    album_id,
                    e
                );
                None
            }
        }
    } else {
        None
    };
    let adopted = pick_adopted(stage1, stage2);

    // stage 3 — album-only fallback.
    // runs when the adopted result from stages 1+2 still has low confidence.
    // omitting the artist entirely recovers from artist disambiguation issues
    // (various artists releases, compilations, split releases, etc.).
    let need_stage3 = adopted
        .sorted
        .first()
        .and_then(|c| c.local_confidence)
        .unwrap_or(0.0)
        < FALLBACK_TRIGGER;
    let stage3: Option<StageResult> = if need_stage3 {
        job_events::emit_stage_from_job(
            job,
            "album_only_fallback",
            Some("prior stages low-confidence; falling back to album-only"),
        );
        match run_release_search(
            &client,
            &title,
            artist.as_deref(),
            &ids,
            FALLBACK_LIMIT,
            local_song_summary,
            &preferred_country,
            true,
            false,
            "album_only",
        )
        .await
        {
            Ok(r) => Some(r),
            Err(e) => {
                tracing::warn!(
                    "mb album-search album-only stage failed for album {}: {}",
                    album_id,
                    e
                );
                None
            }
        }
    } else {
        None
    };
    let adopted = pick_adopted(adopted, stage3);

    job_events::emit_stage_from_job(
        job,
        "scoring_candidates",
        Some("merging cascade results and scoring candidates"),
    );

    // step 5: merge into metadata
    //
    // re-querying may invalidate any previous confirmation pointer:
    // the new top candidate may not match the previously-confirmed
    // release, in which case the stored `release_id` /
    // `release_group_id` would mis-highlight a non-top candidate as
    // "current" in the review ui. clear stale pointers up front;
    // the auto-confirm branch below will re-set them when appropriate.
    let new_top_release_id = adopted.sorted.first().and_then(|c| c.release_id.clone());
    let new_top_release_group_id = adopted.sorted.first().map(|c| c.release_group_id.clone());
    let prev_matches_new_top = match (&prev_confirmation.0, &prev_confirmation.1) {
        // if a release_id was previously stored, require an exact match
        // on the new top's release_id (otherwise the user's pick — or
        // a stale auto-confirm — points at a different pressing).
        (Some(prev_rid), _) => new_top_release_id.as_ref() == Some(prev_rid),
        // no release_id but a release_group_id: match on rg only.
        (None, Some(prev_rgid)) => new_top_release_group_id.as_ref() == Some(prev_rgid),
        // nothing stored — nothing to invalidate.
        (None, None) => true,
    };
    let mut patch = metadata::patch_mb_search_result(&adopted.sorted, &adopted.last_query);
    if !prev_matches_new_top {
        // explicit nulls so deep_merge replaces the previous values.
        if let Some(mb) = patch.get_mut("musicbrainz").and_then(|v| v.as_object_mut()) {
            mb.insert("release_id".into(), Value::Null);
            mb.insert("release_group_id".into(), Value::Null);
            mb.insert("match_confirmed_at".into(), Value::Null);
            mb.insert("match_confirmed_by".into(), Value::Null);
        }
    }
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
    //
    // we have two distinct cases of "tied at the top":
    //   a) candidates with confidence within AUTO_CONFIRM_MARGIN of
    //      the leader (the usual case). this is enough to auto-confirm
    //      iff exactly one candidate is in the band.
    //   b) candidates with EXACTLY the same confidence as the leader
    //      (typical when the tier-1 identity score clamps and several
    //      release-group siblings differ only by tier-2 amounts that
    //      still round to the same number). in this case the sort
    //      comparator has already broken the tie deterministically
    //      using cover-art / country / format / earliness; if the
    //      leader is STRICTLY better in those keys than the runner-up
    //      we treat it as a clear winner and auto-confirm.
    let top_conf = adopted.sorted.first().and_then(|c| c.local_confidence);
    const AUTO_CONFIRM_MARGIN: f64 = 0.05;
    let top_val = top_conf.unwrap_or(0.0);

    // tiebreaker keys for the leader vs runner-up, in priority order:
    // (cover_count, has_front, country_rank, format_rank, neg_year, date_precision)
    // higher is better for first four and last; year is compared so that
    // smaller (older) wins, which we express via Reverse on year only.
    let lookup_meta = |c: &MbCandidate| -> (u32, bool, u8, u8, Option<u32>, u8) {
        c.release_id
            .as_deref()
            .and_then(|k| adopted.sort_meta.get(k))
            .copied()
            .unwrap_or((0, false, 0, 0, None, 0))
    };
    let strictly_better_tiebreak = |a: &MbCandidate, b: &MbCandidate| -> bool {
        let am = lookup_meta(a);
        let bm = lookup_meta(b);
        // same comparator as the sort step. `Greater` means `a` ranks
        // before `b` (since sort uses bm.cmp(&am) for descending).
        let ord =
            bm.0.cmp(&am.0)
                .then_with(|| bm.1.cmp(&am.1))
                .then_with(|| bm.2.cmp(&am.2))
                .then_with(|| bm.3.cmp(&am.3))
                .then_with(|| match (am.4, bm.4) {
                    (Some(ay), Some(by)) => ay.cmp(&by),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => std::cmp::Ordering::Equal,
                })
                .then_with(|| bm.5.cmp(&am.5)); // higher date precision preferred
        ord == std::cmp::Ordering::Less
    };

    // count candidates within the auto-confirm margin of the leader.
    let near_top_count = adopted
        .sorted
        .iter()
        .filter(|c| {
            let cv = c.local_confidence.unwrap_or(0.0);
            cv >= 0.85 && (top_val - cv) < AUTO_CONFIRM_MARGIN
        })
        .count();

    // "is there a strict winner?" — true when either:
    //   * only one candidate is within the margin band, OR
    //   * the leader is at least DECISIVE_GAP ahead of the runner-up
    //     (a real, observable lead rather than a near-tie), OR
    //   * multiple candidates land within the margin band, but the
    //     leader is strictly better than the runner-up on the
    //     structural tiebreaker keys (cover art / country / format /
    //     earliness). this catches the saturation case where every
    //     release-group sibling clamps to ~1.0 and only structural
    //     signals separate them.
    //
    // a small TIE_EPS-only check is too narrow: when tier-2 boosts
    // separate two siblings by 0.04 but the leader still clamps to
    // 1.0, the runner-up sits at 0.96 — far from `close` under
    // TIE_EPS but well within the margin band. we want to auto-
    // confirm those cases as long as the leader truly dominates.
    //
    // additional case: if every candidate in the near-top band shares
    // the same release group, the album identity is unambiguous — we
    // just need to pick the best pressing. auto-confirm in this case.
    const DECISIVE_GAP: f64 = 0.03;
    let all_same_release_group = {
        let groups = adopted
            .sorted
            .iter()
            .filter(|c| {
                let cv = c.local_confidence.unwrap_or(0.0);
                cv >= 0.85 && (top_val - cv) < AUTO_CONFIRM_MARGIN
            })
            .map(|c| c.release_group_id.as_str())
            .collect::<std::collections::HashSet<_>>();
        groups.len() == 1
    };
    let strict_winner = match (adopted.sorted.first(), adopted.sorted.get(1)) {
        (Some(top), Some(second)) => {
            let sc = second.local_confidence.unwrap_or(0.0);
            let gap = top_val - sc;
            let in_band = gap.abs() < AUTO_CONFIRM_MARGIN;
            near_top_count == 1
                || gap >= DECISIVE_GAP
                || (in_band && strictly_better_tiebreak(top, second))
                || all_same_release_group
        }
        (Some(_), None) => true,
        _ => false,
    };

    let mut auto_confirmed_release_id: Option<String> = None;
    let mut auto_confirmed_release_group_id: Option<String> = None;
    let mut final_status = if adopted.sorted.is_empty() {
        MbLookupStatus::NoMatch
    } else if let (Some(threshold), Some(top)) =
        (params.auto_confirm_threshold, adopted.sorted.first())
    {
        let conf = top.local_confidence.unwrap_or(0.0);
        if conf >= threshold && strict_winner {
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
            auto_confirmed_release_group_id = Some(top.release_group_id.clone());
            MbLookupStatus::Confirmed
        } else if near_top_count > 1 {
            MbLookupStatus::NeedsReview
        } else {
            MbLookupStatus::Candidates
        }
    } else if near_top_count > 1 && !strict_winner {
        MbLookupStatus::NeedsReview
    } else {
        MbLookupStatus::Candidates
    };

    // diversity gate: if the album-only stage won the cascade but produced
    // a diverse result set (many distinct primary artists), force NeedsReview
    // unless confidence is very high — high diversity likely means a title
    // collision rather than a genuine match.
    if adopted.last_query.stage.as_deref() == Some("album_only")
        && adopted.distinct_artist_count >= DIVERSITY_REVIEW_THRESHOLD
        && !adopted
            .sorted
            .first()
            .map(|c| c.local_confidence.unwrap_or(0.0) >= 0.95)
            .unwrap_or(false)
        && matches!(
            final_status,
            MbLookupStatus::Confirmed | MbLookupStatus::Candidates
        )
    {
        final_status = MbLookupStatus::NeedsReview;
        auto_confirmed_release_id = None;
        auto_confirmed_release_group_id = None;
    }

    let _ =
        albums_repo::update_mb_lookup_status(&album_id, final_status, job.created_by.as_deref())
            .await;

    job_events::emit_stage_from_job(
        job,
        "resolved",
        Some(match final_status {
            MbLookupStatus::Confirmed => "auto-confirmed top candidate",
            MbLookupStatus::NeedsReview => "needs manual review",
            MbLookupStatus::Candidates => "candidates available for review",
            MbLookupStatus::NoMatch => "no matching releases found",
            _ => "resolved",
        }),
    );

    // chain to detail when we auto-confirmed a top match. without this,
    // re-running enrich on previously-confirmed albums never re-fetches
    // detail (so newly-added detail-side fields like artist url-rels
    // never land). mirrors what `confirm_mb_match` does for the manual
    // single-album review path.
    if let Some(rg_id) = auto_confirmed_release_group_id.as_deref() {
        let detail_params = crate::jobs::MbAlbumDetailParams {
            album_id: album_id.clone(),
            release_group_id: rg_id.to_string(),
            release_id: auto_confirmed_release_id.clone(),
        };
        if let Ok(parameters) = serde_json::to_value(&detail_params) {
            let req = crate::jobs::CreateJobRequest {
                job_type: crate::jobs::JobType::MbAlbumDetail,
                session_id: job.session_id.clone(),
                parameters,
                max_retries: Some(2),
                scheduled_at: None,
                created_by: job.created_by.clone(),
                priority: None,
            };
            let chain_resp = crate::jobs::create_job(req).await;
            if chain_resp.data.is_some() {
                info!(
                    "mb album-search: auto-chained detail job for album {}",
                    album_id
                );
            } else {
                tracing::warn!(
                    "mb album-search: failed to chain detail for album {}: {}",
                    album_id,
                    chain_resp.message
                );
            }
        }
    }

    info!(
        "mb album-search done album={} status={} candidates={} top_local_confidence={:?} mb_score_top={:?} auto_confirmed={:?}",
        album_id,
        final_status.as_str(),
        adopted.sorted.len(),
        top_conf,
        adopted.sorted.first().and_then(|c| c.mb_score),
        auto_confirmed_release_id,
    );

    let result = MbAlbumSearchResult {
        album_id: album_id.clone(),
        candidate_count: adopted.sorted.len() as u64,
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

fn pick_adopted(stage1: StageResult, stage2: Option<StageResult>) -> StageResult {
    let conf1 = stage1
        .sorted
        .first()
        .and_then(|c| c.local_confidence)
        .unwrap_or(0.0);
    if conf1 >= FALLBACK_TRIGGER {
        return stage1;
    }
    if let Some(s2) = stage2 {
        let conf2 = s2
            .sorted
            .first()
            .and_then(|c| c.local_confidence)
            .unwrap_or(0.0);
        if conf2 >= FALLBACK_TRIGGER || conf2 > conf1 {
            return s2;
        }
    }
    stage1
}

async fn run_release_search(
    client: &MusicBrainzClient,
    title: &str,
    artist: Option<&str>,
    ids: &CrossApiIds,
    limit: u32,
    local_song_summary: Option<(usize, u64)>,
    preferred_country: &str,
    include_title_in_query: bool,
    include_artist_in_query: bool,
    stage_label: &'static str,
) -> Result<StageResult, JobError> {
    let mut query = ReleaseSearchQuery::new();
    if include_title_in_query {
        query = query.release(title);
    }
    if include_artist_in_query {
        if let Some(arid) = ids.artist_mbids.first() {
            query = query.arid(arid.clone());
        } else if let Some(a) = artist.filter(|s| !s.is_empty()) {
            query = query.artist(a);
        }
    }
    query = query.limit(limit);

    info!(
        "mb album-search stage={} querying: artist={:?} title={}",
        stage_label, artist, title
    );
    crate::jobs::rate_limit::acquire(crate::jobs::rate_limit::Source::Mb).await;
    let resp = client.search_releases(&query).await;
    if !resp.success {
        return Err(JobError::ProcessingFailed {
            reason: format!("mb search failed (stage={}): {}", stage_label, resp.message),
        });
    }
    let search = resp
        .data
        .unwrap_or(crate::music::musicbrainz::models::SearchResult {
            results: vec![],
            count: 0,
            offset: 0,
        });

    let earliest_year: Option<u32> = search
        .results
        .iter()
        .filter_map(|r| {
            r.date
                .as_deref()
                .or_else(|| {
                    r.release_group
                        .as_ref()
                        .and_then(|rg| rg.first_release_date.as_deref())
                })
                .and_then(parse_year)
        })
        .min();

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
            let media_format = r
                .media
                .as_ref()
                .and_then(|m| m.first())
                .and_then(|m| m.format.clone());
            let track_lens_ms: Vec<u32> = r
                .media
                .as_ref()
                .map(|media| {
                    media
                        .iter()
                        .flat_map(|m| m.tracks.as_ref().into_iter().flatten())
                        .filter_map(|t| t.length)
                        .collect()
                })
                .unwrap_or_default();
            let release_group_id_str = r
                .release_group
                .as_ref()
                .map(|rg| rg.id.to_string())
                .unwrap_or_default();
            let mbid_match = (!release_group_id_str.is_empty()
                && ids.release_or_rg_mbids.contains(&release_group_id_str))
                || ids.release_or_rg_mbids.contains(&r.id.to_string());
            let cover_art_count = r
                .cover_art_archive
                .as_ref()
                .map(|caa| caa.count)
                .unwrap_or(0);
            let has_front_cover = r
                .cover_art_archive
                .as_ref()
                .map(|caa| caa.front)
                .unwrap_or(false);
            let cand_year = r
                .date
                .as_deref()
                .or_else(|| {
                    r.release_group
                        .as_ref()
                        .and_then(|rg| rg.first_release_date.as_deref())
                })
                .and_then(parse_year);
            let years_since_earliest = match (cand_year, earliest_year) {
                (Some(cy), Some(ey)) if cy >= ey => Some(cy - ey),
                _ => None,
            };
            let local_confidence = compute_local_confidence(
                title,
                artist,
                &r.title,
                &primary_artist,
                r.score,
                r.country.as_deref(),
                media_format.as_deref(),
                None,
                local_song_summary,
                if track_lens_ms.is_empty() {
                    None
                } else {
                    Some(track_lens_ms.as_slice())
                },
                mbid_match,
                cover_art_count,
                has_front_cover,
                years_since_earliest,
                preferred_country,
            );
            MbCandidate {
                release_group_id: release_group_id_str,
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
                media: media_format.clone(),
                mb_score: r.score.map(|s| s as i32),
                local_confidence: Some(local_confidence),
                cover_art_count: Some(cover_art_count),
                has_front_cover: Some(has_front_cover),
            }
        })
        .collect();

    use std::collections::HashMap;
    let mut sort_meta: HashMap<String, (u32, bool, u8, u8, Option<u32>, u8)> = HashMap::new();
    for r in &search.results {
        let key = r.id.to_string();
        let caa_count = r.cover_art_archive.as_ref().map(|c| c.count).unwrap_or(0);
        let caa_front = r
            .cover_art_archive
            .as_ref()
            .map(|c| c.front)
            .unwrap_or(false);
        let cr = country_rank(r.country.as_deref(), preferred_country);
        let fr = format_rank(
            r.media
                .as_ref()
                .and_then(|m| {
                    m.first()
                        .and_then(|m0| m0.format.as_deref().map(|s| s.to_string()))
                })
                .as_deref(),
        );
        let yr = r
            .date
            .as_deref()
            .or_else(|| {
                r.release_group
                    .as_ref()
                    .and_then(|rg| rg.first_release_date.as_deref())
            })
            .and_then(parse_year);
        let dp = r
            .date
            .as_deref()
            .or_else(|| {
                r.release_group
                    .as_ref()
                    .and_then(|rg| rg.first_release_date.as_deref())
            })
            .map(date_precision)
            .unwrap_or(0);
        sort_meta.insert(key, (caa_count, caa_front, cr, fr, yr, dp));
    }
    let mut sorted = candidates;
    sorted.sort_by(|a, b| {
        let ac = a.local_confidence.unwrap_or(0.0);
        let bc = b.local_confidence.unwrap_or(0.0);
        match bc.partial_cmp(&ac).unwrap_or(std::cmp::Ordering::Equal) {
            std::cmp::Ordering::Equal => {}
            other if (ac - bc).abs() > 1e-6 => return other,
            _ => {}
        }
        let empty = (0u32, false, 0u8, 0u8, None, 0u8);
        let am = a
            .release_id
            .as_deref()
            .and_then(|k| sort_meta.get(k))
            .copied()
            .unwrap_or(empty);
        let bm = b
            .release_id
            .as_deref()
            .and_then(|k| sort_meta.get(k))
            .copied()
            .unwrap_or(empty);
        bm.0.cmp(&am.0)
            .then_with(|| bm.1.cmp(&am.1))
            .then_with(|| bm.2.cmp(&am.2))
            .then_with(|| bm.3.cmp(&am.3))
            .then_with(|| match (am.4, bm.4) {
                (Some(ay), Some(by)) => ay.cmp(&by),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal,
            })
            .then_with(|| bm.5.cmp(&am.5)) // higher precision = more specific date = preferred
    });

    let last_query = MbLastQuery {
        artist: artist.unwrap_or_default().to_string(),
        release: title.to_string(),
        tracks: None,
        stage: Some(stage_label.to_string()),
    };

    let distinct_artist_count = {
        let mut seen = std::collections::HashSet::new();
        for c in &sorted {
            seen.insert(c.artist.to_lowercase());
        }
        seen.len()
    };

    Ok(StageResult {
        sorted,
        last_query,
        sort_meta,
        distinct_artist_count,
    })
}

/// cheap, deterministic confidence score in [0.0, 1.0].
///
/// design: two-tier score so structural tiebreakers always survive
/// even when the "identity" signals (text overlap, mb lucene score,
/// cross-api mbid agreement, long-song duration match) saturate.
///
///   tier 1 — IDENTITY (max 0.85, clamped):
///     0.40 * title_jaccard + 0.30 * artist_jaccard + 0.15 * mb_norm
///     + 0.10 if cross-api mbid agrees
///     + 0.15 (or 0.05) if local single-long-song matches mb track sum
///     clamped to IDENTITY_CAP (0.85) so tier-2 has guaranteed room.
///
///   tier 2 — TIEBREAKERS (max ~0.24, only applied when identity >= 0.5):
///     cover art (front cover + per-image bonus, max +0.08)
///     country  (XW=+0.05, US=+0.04, other=0)
///     format   (digital=+0.04, cd=+0.03, vinyl/cassette/other=0)
///     earliness (earliest pressing in result set = +0.03, decays)
///     tags     (>=5 → +0.04, >0 → +0.02, =0 → -0.04, None → no movement)
///
/// the cap on tier 1 is the crucial change. without it, identical-text
/// candidates from the same release-group (cd / vinyl / digital
/// pressings) all hit 1.0 once the mbid boost lands, and every
/// downstream tiebreaker gets clamped away. with it, the tier-2 budget
/// of ~0.24 is always available to differentiate.
///
/// ordering of importance (largest deltas first):
///   cross-api mbid agreement > long-song duration match > cover art
///   > country > format > earliest pressing > tags.
/// cover art intentionally outranks release date per product spec.
///
/// optional inputs (pass `None`/`false`/`0` when unavailable):
///   * `tag_count` — MB tags on this release/release-group. Some(0) =
///     known-empty (small penalty). None = unknown (no movement —
///     this is the search-time default; detail-time re-rank fills in).
///   * `local_song_summary` — `(local_song_count, local_total_seconds)`,
///     used together with `cand_track_lengths_ms` for the
///     "local album is one long track that should match a multi-track
///     mb release" case (long live mixes, dj sets, side-long suites).
///   * `cand_track_lengths_ms` — durations (ms) for the candidate's tracks.
///   * `cross_api_mbid_match` — true when this candidate's
///     `release_group_id` matches an mbid surfaced by last.fm or audiodb.
///     NB: this is per-release-group, so MANY candidates in the same
///     release-group will all set this true. that's why the boost is
///     bounded and tier-1 is capped — otherwise they'd all saturate.
///   * `cover_art_count` — number of cover-art images on coverartarchive.
///   * `has_front_cover` — front cover present on coverartarchive.
///   * `years_since_earliest` — years past the earliest pressing in the
///     result set; 0 = earliest, None = unknown.
#[allow(clippy::too_many_arguments)]
fn smoothstep(edge0: f64, edge1: f64, x: f64) -> f64 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn compute_local_confidence(
    query_title: &str,
    query_artist: Option<&str>,
    cand_title: &str,
    cand_artist: &str,
    mb_score: Option<u32>,
    country: Option<&str>,
    media_format: Option<&str>,
    tag_count: Option<usize>,
    local_song_summary: Option<(usize, u64)>,
    cand_track_lengths_ms: Option<&[u32]>,
    cross_api_mbid_match: bool,
    cover_art_count: u32,
    has_front_cover: bool,
    years_since_earliest: Option<u32>,
    preferred_country: &str,
) -> f64 {
    // hard cap on the identity tier. leaves at least (1.0 - IDENTITY_CAP)
    // of headroom for tier-2 tiebreakers to always show through.
    // when cross_api_mbid_match is true, the cap is raised to 0.92: an
    // mbid agreement is stronger evidence than text alone, so the extra
    // headroom is warranted (and the +0.10 boost is no longer wasted when
    // text already saturates the base cap).
    const IDENTITY_CAP: f64 = 0.85;
    const MBID_IDENTITY_CAP: f64 = 0.92;

    let title_overlap = token_jaccard(query_title, cand_title);
    let artist_overlap = match query_artist {
        Some(a) if !a.is_empty() => token_jaccard(a, cand_artist),
        _ => 0.5, // unknown artist on our side: don't penalise hard
    };
    let mb_norm = mb_score
        .map(|s| (s as f64 / 100.0).clamp(0.0, 1.0))
        .unwrap_or(0.5);

    // ── tier 1: identity ─────────────────────────────────────────────
    // weights total 0.85 max, before cross-source confirmations.
    let text_score = 0.40 * title_overlap + 0.30 * artist_overlap + 0.15 * mb_norm;
    let mut identity = text_score;

    // cross-api mbid agreement: an independent confirmation that this
    // release-group is the right ALBUM. magnitude is intentionally
    // modest (0.10, was 0.15) because: (a) when text already maxes
    // out, +0.15 just clamps to 1.0 across all release-group siblings;
    // (b) tier-2 tiebreakers should remain the deciders within a
    // release-group, since they answer the different question of
    // which RELEASE within the group to pick.
    if cross_api_mbid_match {
        identity += 0.10;
    }

    // single-long-song-as-album: when the local side is exactly one
    // track longer than 10 minutes and the candidate's summed track
    // durations match within ±5s per track, this is genuine
    // identity-level evidence (the rip really is this multi-track
    // album), so it goes in tier 1, not tier 2.
    if let (Some((local_count, local_total)), Some(track_lens)) =
        (local_song_summary, cand_track_lengths_ms)
    {
        if local_count == 1 && local_total > 600 && !track_lens.is_empty() {
            let mb_total_secs: u64 = track_lens.iter().map(|ms| (*ms as u64) / 1000).sum();
            let tolerance = 5u64 * track_lens.len() as u64;
            let diff = local_total.abs_diff(mb_total_secs);
            if diff <= tolerance {
                identity += 0.15;
            } else if diff <= tolerance * 2 {
                identity += 0.05;
            }
        }
    }

    let identity = identity.min(if cross_api_mbid_match {
        MBID_IDENTITY_CAP
    } else {
        IDENTITY_CAP
    });

    // ── tier 2: structural tiebreakers ───────────────────────────────
    // smoothly weighted by identity so a junk match (identity << 0.5) can't
    // be tipped over auto-confirm thresholds by structural boosts. weight
    // ramps from 0 at identity=0.40 to 1 at identity=0.60, eliminating the
    // old hard cliff at 0.5.
    let tiebreak_weight = smoothstep(0.40, 0.60, identity);
    let mut raw_tiebreak: f64 = 0.0;
    {
        // cover art — strongest tiebreaker per product spec.
        if has_front_cover {
            raw_tiebreak += 0.04;
        }
        if cover_art_count > 0 {
            // per-extra-image bonus, capped. cover_art_count of 1 just
            // means "has front" so no extra; 2+ images progressively
            // reward richer cover-art coverage.
            let extras = ((cover_art_count.saturating_sub(1)) as f64 * 0.008).min(0.04);
            raw_tiebreak += extras;
        }

        // country — XW (worldwide) > preferred > others. policy choice.
        match country {
            Some("XW") => raw_tiebreak += 0.05,
            Some(c) if c == preferred_country => raw_tiebreak += 0.04,
            _ => {}
        }

        // format — digital > cd > vinyl/cassette/other.
        if let Some(fmt) = media_format {
            let f = fmt.to_lowercase();
            if f.contains("digital") {
                raw_tiebreak += 0.04;
            } else if f.contains("cd") {
                raw_tiebreak += 0.03;
            }
        }

        // earliness — earliest pressing in the result set wins a
        // small boost, decaying with delta-years. bounded strictly
        // below the cover-art boost so cover art always wins ties.
        if let Some(delta) = years_since_earliest {
            let boost = match delta {
                0 => 0.03,
                1..=2 => 0.02,
                3..=5 => 0.01,
                _ => 0.0,
            };
            raw_tiebreak += boost;
        }

        // tags — applies at detail-time re-rank when tag_count is
        // known. search-time passes None so this is a no-op.
        match tag_count {
            Some(n) if n >= 5 => raw_tiebreak += 0.04,
            Some(n) if n > 0 => raw_tiebreak += 0.02,
            Some(0) => raw_tiebreak -= 0.04,
            _ => {}
        }
    }

    let tiebreak = raw_tiebreak * tiebreak_weight;
    (identity + tiebreak).clamp(0.0, 1.0)
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
        // base weights total 0.85 (the remaining 0.15 of headroom is
        // reserved for structural boosts so identical-text candidates
        // can still differentiate). a perfect title+artist+mb_score
        // match with no structural boosts should land at exactly 0.85.
        let c = compute_local_confidence(
            "Kid A",
            Some("Radiohead"),
            "Kid A",
            "Radiohead",
            Some(100),
            None,
            None,
            None,
            None,
            None,
            false,
            0,
            false,
            None,
            "US",
        );
        assert!((0.84..=0.86).contains(&c), "expected ~0.85, got {}", c);
    }

    #[test]
    fn confidence_low_when_nothing_matches() {
        let c = compute_local_confidence(
            "foo",
            Some("bar"),
            "baz",
            "qux",
            Some(0),
            None,
            None,
            None,
            None,
            None,
            false,
            0,
            false,
            None,
            "US",
        );
        assert!(c < 0.3);
    }

    #[test]
    fn confidence_boosts_xw_and_cd() {
        let base = compute_local_confidence(
            "Kid A",
            Some("Radiohead"),
            "Kid A",
            "Radiohead",
            Some(50),
            None,
            None,
            None,
            None,
            None,
            false,
            0,
            false,
            None,
            "US",
        );
        let boosted = compute_local_confidence(
            "Kid A",
            Some("Radiohead"),
            "Kid A",
            "Radiohead",
            Some(50),
            Some("XW"),
            Some("CD"),
            None,
            None,
            None,
            false,
            0,
            false,
            None,
            "US",
        );
        assert!(boosted > base);
    }

    #[test]
    fn confidence_us_country_boost_is_smaller_than_xw() {
        let xw = compute_local_confidence(
            "Kid A",
            Some("Radiohead"),
            "Kid A",
            "Radiohead",
            Some(50),
            Some("XW"),
            None,
            None,
            None,
            None,
            false,
            0,
            false,
            None,
            "US",
        );
        let us = compute_local_confidence(
            "Kid A",
            Some("Radiohead"),
            "Kid A",
            "Radiohead",
            Some(50),
            Some("US"),
            None,
            None,
            None,
            None,
            false,
            0,
            false,
            None,
            "US",
        );
        assert!(xw > us);
        assert!(us > xw - 0.05);
    }

    #[test]
    fn confidence_cross_api_mbid_match_is_largest_boost() {
        // partial title overlap so we have room under the 1.0 clamp.
        let base = compute_local_confidence(
            "the moon",
            Some("floyd"),
            "the moon",
            "floyd",
            Some(20),
            None,
            None,
            None,
            None,
            None,
            false,
            0,
            false,
            None,
            "US",
        );
        let with_mbid = compute_local_confidence(
            "the moon",
            Some("floyd"),
            "the moon",
            "floyd",
            Some(20),
            None,
            None,
            None,
            None,
            None,
            true,
            0,
            false,
            None,
            "US",
        );
        assert!(
            with_mbid - base >= 0.09,
            "expected +0.10 mbid boost, got {} -> {}",
            base,
            with_mbid
        );
    }

    #[test]
    fn confidence_tag_count_present_boosts_absent_penalises() {
        let none = compute_local_confidence(
            "Kid A",
            Some("Radiohead"),
            "Kid A",
            "Radiohead",
            Some(50),
            None,
            None,
            None,
            None,
            None,
            false,
            0,
            false,
            None,
            "US",
        );
        let with_tags = compute_local_confidence(
            "Kid A",
            Some("Radiohead"),
            "Kid A",
            "Radiohead",
            Some(50),
            None,
            None,
            Some(8),
            None,
            None,
            false,
            0,
            false,
            None,
            "US",
        );
        let no_tags = compute_local_confidence(
            "Kid A",
            Some("Radiohead"),
            "Kid A",
            "Radiohead",
            Some(50),
            None,
            None,
            Some(0),
            None,
            None,
            false,
            0,
            false,
            None,
            "US",
        );
        assert!(with_tags > none);
        assert!(no_tags < none);
    }

    #[test]
    fn confidence_single_long_song_matches_multitrack_album() {
        // local: one rip totaling ~2400s. mb candidate: 6 tracks summing
        // to ~2398s. should land within ±5s/track tolerance.
        let track_lens_ms: Vec<u32> = vec![400_000, 410_000, 380_000, 420_000, 395_000, 393_000];
        let total_secs: u64 = track_lens_ms.iter().map(|m| (*m as u64) / 1000).sum();
        // partial overlap so the boost isn't swallowed by the 1.0 clamp.
        let base = compute_local_confidence(
            "live set",
            Some("some dj"),
            "live set extended",
            "some dj",
            Some(20),
            None,
            None,
            None,
            None,
            None,
            false,
            0,
            false,
            None,
            "US",
        );
        let boosted = compute_local_confidence(
            "live set",
            Some("some dj"),
            "live set extended",
            "some dj",
            Some(20),
            None,
            None,
            None,
            Some((1, total_secs + 10)),
            Some(track_lens_ms.as_slice()),
            false,
            0,
            false,
            None,
            "US",
        );
        assert!(
            boosted > base + 0.1,
            "expected +0.15 long-song boost, got {} -> {}",
            base,
            boosted
        );
    }

    #[test]
    fn boosts_dont_apply_to_low_quality_matches() {
        let c = compute_local_confidence(
            "foo",
            Some("bar"),
            "baz",
            "qux",
            Some(0),
            Some("XW"),
            Some("CD"),
            None,
            None,
            None,
            false,
            5,
            true,
            Some(0),
            "US",
        );
        assert!(c < 0.3);
    }

    // ── new ranking tests ──────────────────────────────────────────────

    fn perfect(
        country: Option<&str>,
        media: Option<&str>,
        cover_count: u32,
        front: bool,
        years_since_earliest: Option<u32>,
    ) -> f64 {
        compute_local_confidence(
            "Kid A",
            Some("Radiohead"),
            "Kid A",
            "Radiohead",
            Some(50),
            country,
            media,
            None,
            None,
            None,
            false,
            cover_count,
            front,
            years_since_earliest,
            "US",
        )
    }

    #[test]
    fn confidence_cover_art_outranks_release_date() {
        // candidate A: oldest pressing, no cover art
        let oldest_no_art = perfect(None, None, 0, false, Some(0));
        // candidate B: re-issue 5 years later WITH front cover + extras
        let reissue_with_art = perfect(None, None, 4, true, Some(5));
        assert!(
            reissue_with_art > oldest_no_art,
            "cover art should outweigh earliest-pressing boost: {} vs {}",
            reissue_with_art,
            oldest_no_art
        );
    }

    #[test]
    fn confidence_digital_outranks_cd() {
        let cd = perfect(None, Some("CD"), 0, false, None);
        let digital = perfect(None, Some("Digital Media"), 0, false, None);
        assert!(
            digital > cd,
            "digital ({}) should beat cd ({})",
            digital,
            cd
        );
    }

    #[test]
    fn confidence_cd_outranks_vinyl() {
        let vinyl = perfect(None, Some("12\" Vinyl"), 0, false, None);
        let cd = perfect(None, Some("CD"), 0, false, None);
        assert!(cd > vinyl, "cd ({}) should beat vinyl ({})", cd, vinyl);
    }

    #[test]
    fn confidence_oldest_release_wins_when_other_signals_equal() {
        let oldest = perfect(None, None, 0, false, Some(0));
        let reissue = perfect(None, None, 0, false, Some(8));
        assert!(
            oldest > reissue,
            "oldest pressing ({}) should beat re-issue ({})",
            oldest,
            reissue
        );
    }

    #[test]
    fn confidence_xw_outranks_us_outranks_other() {
        let xw = perfect(Some("XW"), None, 0, false, None);
        let us = perfect(Some("US"), None, 0, false, None);
        let de = perfect(Some("DE"), None, 0, false, None);
        assert!(
            xw > us && us > de,
            "expected XW > US > other; got {} {} {}",
            xw,
            us,
            de
        );
    }

    #[test]
    fn confidence_perfect_match_leaves_headroom_for_tiebreakers() {
        // a perfect text+mb_score match with NO structural boosts should
        // not saturate at 1.0 — there must be headroom for cover art,
        // country, format, date, mbid to differentiate ties.
        let plain = perfect(None, None, 0, false, None);
        assert!(plain <= 0.86, "base must leave headroom, got {}", plain);
        // and the same match WITH all positive structural boosts must
        // sort strictly higher.
        let loaded = perfect(Some("XW"), Some("Digital Media"), 6, true, Some(0));
        assert!(
            loaded > plain + 0.10,
            "boosts should add measurable lift: {} -> {}",
            plain,
            loaded
        );
    }

    #[test]
    fn confidence_mbid_match_does_not_swallow_tiebreakers() {
        // regression: when every candidate in a release-group has the
        // same cross_api_mbid_match=true and perfect text overlap, the
        // identity-tier cap MUST leave room for tier-2 tiebreakers to
        // produce a measurable gap. without the cap, both candidates
        // saturated at 1.0 and the leader could not auto-confirm.
        let canonical = compute_local_confidence(
            "Kid A",
            Some("Radiohead"),
            "Kid A",
            "Radiohead",
            Some(100),
            Some("XW"),
            Some("Digital Media"),
            None,
            None,
            None,
            true,
            8,
            true,
            Some(0),
            "US",
        );
        let sibling = compute_local_confidence(
            "Kid A",
            Some("Radiohead"),
            "Kid A",
            "Radiohead",
            Some(100),
            Some("DE"),
            Some("12\" Vinyl"),
            None,
            None,
            None,
            true,
            0,
            false,
            Some(8),
            "US",
        );
        assert!(
            canonical > sibling,
            "canonical pressing should beat sibling; got {} vs {}",
            canonical,
            sibling
        );
        assert!(
            canonical - sibling >= 0.07,
            "gap should be >=0.07 (tiebreakers still differentiate); got {} vs {}",
            canonical,
            sibling
        );
        assert!(
            sibling < 1.0,
            "sibling pressing should not saturate to 1.0, got {}",
            sibling
        );
    }

    // ── pick_adopted tests ────────────────────────────────────────────

    #[test]
    fn cross_api_mbid_match_lands_above_identity_cap() {
        // with cross_api_mbid_match=true, identity is capped at 0.92 (not
        // 0.85), so a perfect text match + mbid boost should exceed 0.85.
        let without_mbid = compute_local_confidence(
            "Kid A",
            Some("Radiohead"),
            "Kid A",
            "Radiohead",
            Some(100),
            None,
            None,
            None,
            None,
            None,
            false,
            0,
            false,
            None,
            "US",
        );
        let with_mbid = compute_local_confidence(
            "Kid A",
            Some("Radiohead"),
            "Kid A",
            "Radiohead",
            Some(100),
            None,
            None,
            None,
            None,
            None,
            true,
            0,
            false,
            None,
            "US",
        );
        // without mbid: identity capped at 0.85. with mbid: identity = 0.95
        // capped at 0.92, so the boost is not wasted by the base cap.
        assert!(
            without_mbid <= 0.86,
            "non-mbid match should be capped at IDENTITY_CAP (~0.85), got {}",
            without_mbid
        );
        assert!(
            with_mbid > 0.90,
            "mbid match should exceed the base identity cap; got {}",
            with_mbid
        );
        assert!(
            with_mbid <= 0.93,
            "mbid match should be capped at MBID_IDENTITY_CAP (~0.92), got {}",
            with_mbid
        );
    }

    #[test]
    fn tier2_ramp_is_smooth_around_0_5() {
        // a candidate at identity ≈ 0.43 (below the old hard cliff) should
        // receive partial — not zero — tier-2 credit. two candidates at low
        // vs high identity should differ smoothly.
        //
        // "moon" vs "the moon" ≈ 0.5 title overlap; "floyd" vs "pink floyd"
        // ≈ 0.5 artist overlap; mb_score=50 → 0.5 norm.
        // text_score ≈ 0.40*0.5 + 0.30*0.5 + 0.15*0.5 = 0.425 → below 0.5.
        let low_no_boost = compute_local_confidence(
            "moon",
            Some("floyd"),
            "the moon",
            "pink floyd",
            Some(50),
            None,
            None,
            None,
            None,
            None,
            false,
            0,
            false,
            None,
            "US",
        );
        let low_with_boost = compute_local_confidence(
            "moon",
            Some("floyd"),
            "the moon",
            "pink floyd",
            Some(50),
            Some("XW"),
            Some("Digital Media"),
            None,
            None,
            None,
            false,
            3,
            true,
            Some(0),
            "US",
        );
        // with smoothstep the boost is partial but non-zero (old cliff gave 0)
        assert!(
            low_with_boost > low_no_boost,
            "partial tier-2 credit should apply at identity ≈ 0.43; \
             no_boost={} with_boost={}",
            low_no_boost,
            low_with_boost
        );
        // high-identity candidate with same boosts should receive more lift
        let high_with_boost = compute_local_confidence(
            "Kid A",
            Some("Radiohead"),
            "Kid A",
            "Radiohead",
            Some(100),
            Some("XW"),
            Some("Digital Media"),
            None,
            None,
            None,
            false,
            3,
            true,
            Some(0),
            "US",
        );
        assert!(
            high_with_boost > low_with_boost,
            "higher identity should produce more tier-2 lift; got {} vs {}",
            high_with_boost,
            low_with_boost
        );
    }

    fn stub_stage(conf: Option<f64>, stage: &str) -> StageResult {
        let sorted = match conf {
            Some(c) => vec![MbCandidate {
                release_group_id: "rg-test".to_string(),
                release_id: Some("r-test".to_string()),
                title: "test album".to_string(),
                artist: "test artist".to_string(),
                first_release_date: None,
                track_count: None,
                country: None,
                primary_type: None,
                secondary_types: vec![],
                media: None,
                mb_score: None,
                local_confidence: Some(c),
                cover_art_count: None,
                has_front_cover: None,
            }],
            None => vec![],
        };
        StageResult {
            sorted,
            last_query: MbLastQuery {
                artist: "test artist".to_string(),
                release: "test album".to_string(),
                tracks: None,
                stage: Some(stage.to_string()),
            },
            sort_meta: std::collections::HashMap::new(),
            distinct_artist_count: 0,
        }
    }

    #[test]
    fn pick_adopted_keeps_stage1_when_above_fallback_trigger() {
        // stage1 clears the bar — returned even though stage2 is higher.
        let adopted = pick_adopted(
            stub_stage(Some(0.9), "strict"),
            Some(stub_stage(Some(0.95), "artist_only")),
        );
        assert_eq!(adopted.last_query.stage.as_deref(), Some("strict"));
    }

    #[test]
    fn pick_adopted_uses_stage2_when_stage1_empty() {
        // stage1 returned nothing; stage2 has a candidate.
        let adopted = pick_adopted(
            stub_stage(None, "strict"),
            Some(stub_stage(Some(0.7), "artist_only")),
        );
        assert_eq!(adopted.last_query.stage.as_deref(), Some("artist_only"));
    }

    #[test]
    fn pick_adopted_stays_with_stage1_when_no_stage2() {
        // stage2 was skipped (no artist info); stage1 is always the fallback.
        let adopted = pick_adopted(stub_stage(Some(0.3), "strict"), None);
        assert_eq!(adopted.last_query.stage.as_deref(), Some("strict"));
    }

    // ── diversity gate tests ───────────────────────────────────────────

    /// build a StageResult with a specific confidence, stage, and number
    /// of distinct artists (simulating what run_release_search computes).
    fn stub_stage_with_artists(
        conf: Option<f64>,
        stage: &str,
        distinct_artists: usize,
    ) -> StageResult {
        let mut s = stub_stage(conf, stage);
        s.distinct_artist_count = distinct_artists;
        s
    }

    fn apply_diversity_gate(
        adopted: &StageResult,
        mut final_status: MbLookupStatus,
        mut auto_confirmed_release_id: Option<String>,
        mut auto_confirmed_release_group_id: Option<String>,
    ) -> (MbLookupStatus, Option<String>, Option<String>) {
        if adopted.last_query.stage.as_deref() == Some("album_only")
            && adopted.distinct_artist_count >= DIVERSITY_REVIEW_THRESHOLD
            && !adopted
                .sorted
                .first()
                .map(|c| c.local_confidence.unwrap_or(0.0) >= 0.95)
                .unwrap_or(false)
            && matches!(
                final_status,
                MbLookupStatus::Confirmed | MbLookupStatus::Candidates
            )
        {
            final_status = MbLookupStatus::NeedsReview;
            auto_confirmed_release_id = None;
            auto_confirmed_release_group_id = None;
        }
        (
            final_status,
            auto_confirmed_release_id,
            auto_confirmed_release_group_id,
        )
    }

    #[test]
    fn diversity_gate_forces_needs_review_when_many_artists_in_album_only() {
        // album_only stage, 4+ distinct artists, confidence below 0.95 →
        // gate should flip Candidates to NeedsReview.
        let adopted = stub_stage_with_artists(Some(0.7), "album_only", DIVERSITY_REVIEW_THRESHOLD);
        let (status, rid, rgid) = apply_diversity_gate(
            &adopted,
            MbLookupStatus::Candidates,
            Some("r-1".to_string()),
            Some("rg-1".to_string()),
        );
        assert_eq!(status, MbLookupStatus::NeedsReview);
        assert!(rid.is_none(), "auto_confirmed_release_id should be cleared");
        assert!(
            rgid.is_none(),
            "auto_confirmed_release_group_id should be cleared"
        );
    }

    #[test]
    fn diversity_gate_not_triggered_below_threshold() {
        // album_only stage but only 3 distinct artists (< 4 threshold) →
        // gate must not fire; status stays as-is.
        let adopted =
            stub_stage_with_artists(Some(0.7), "album_only", DIVERSITY_REVIEW_THRESHOLD - 1);
        let (status, _, _) = apply_diversity_gate(&adopted, MbLookupStatus::Candidates, None, None);
        assert_eq!(status, MbLookupStatus::Candidates);
    }

    #[test]
    fn diversity_gate_not_triggered_for_strict_stage() {
        // strict stage with many artists shouldn't trigger the gate —
        // diversity is only concerning when artist was excluded from query.
        let adopted = stub_stage_with_artists(Some(0.7), "strict", DIVERSITY_REVIEW_THRESHOLD + 2);
        let (status, _, _) = apply_diversity_gate(&adopted, MbLookupStatus::Candidates, None, None);
        assert_eq!(status, MbLookupStatus::Candidates);
    }

    #[test]
    fn diversity_gate_not_triggered_when_confidence_very_high() {
        // album_only + many artists but confidence >= 0.95: confident enough
        // that the match is real even with a diverse set.
        let adopted = stub_stage_with_artists(Some(0.97), "album_only", DIVERSITY_REVIEW_THRESHOLD);
        let (status, _, _) = apply_diversity_gate(&adopted, MbLookupStatus::Candidates, None, None);
        assert_eq!(status, MbLookupStatus::Candidates);
    }

    // ── direct lookup synthesis tests ─────────────────────────────────

    fn make_rg(
        id: &str,
        title: &str,
        artist: &str,
        first_release_date: Option<&str>,
        primary_type: Option<&str>,
    ) -> crate::music::musicbrainz::models::ReleaseGroup {
        crate::music::musicbrainz::models::ReleaseGroup {
            id: uuid::Uuid::parse_str(id).unwrap(),
            title: title.to_string(),
            primary_type: primary_type.map(|s| s.to_string()),
            secondary_types: None,
            first_release_date: first_release_date.map(|s| s.to_string()),
            artist_credit: Some(vec![crate::music::musicbrainz::models::ArtistCredit {
                artist: None,
                name: artist.to_string(),
                joinphrase: None,
            }]),
            genres: None,
            tags: None,
            relations: None,
            score: None,
        }
    }

    #[test]
    fn candidate_from_rg_extracts_core_fields() {
        let rg = make_rg(
            "11111111-1111-1111-1111-111111111111",
            "OK Computer",
            "Radiohead",
            Some("1997-05-28"),
            Some("Album"),
        );
        let cand = candidate_from_rg(&rg);
        assert_eq!(cand.title, "OK Computer");
        assert_eq!(cand.artist, "Radiohead");
        assert_eq!(cand.first_release_date.as_deref(), Some("1997-05-28"));
        assert_eq!(cand.primary_type.as_deref(), Some("Album"));
        assert_eq!(
            cand.release_group_id,
            "11111111-1111-1111-1111-111111111111"
        );
        assert!(cand.release_id.is_none());
        assert!(
            cand.local_confidence.is_none(),
            "confidence not set by synthesis"
        );
    }

    #[test]
    fn candidate_from_rg_empty_artist_credit_yields_empty_string() {
        let mut rg = make_rg(
            "22222222-2222-2222-2222-222222222222",
            "Various Artists Vol. 1",
            "Various Artists",
            None,
            None,
        );
        rg.artist_credit = None;
        let cand = candidate_from_rg(&rg);
        assert_eq!(cand.artist, "");
    }

    #[test]
    fn candidate_from_release_inherits_rg_fields() {
        let rg = make_rg(
            "33333333-3333-3333-3333-333333333333",
            "OK Computer",
            "Radiohead",
            Some("1997-05-28"),
            Some("Album"),
        );
        let rel = crate::music::musicbrainz::models::Release {
            id: uuid::Uuid::parse_str("44444444-4444-4444-4444-444444444444").unwrap(),
            title: "OK Computer".to_string(),
            date: Some("1997-06-16".to_string()),
            country: Some("US".to_string()),
            artist_credit: Some(vec![crate::music::musicbrainz::models::ArtistCredit {
                artist: None,
                name: "Radiohead".to_string(),
                joinphrase: None,
            }]),
            media: Some(vec![crate::music::musicbrainz::models::Medium {
                position: None,
                title: None,
                format: Some("CD".to_string()),
                tracks: Some(vec![]),
                track_count: Some(12),
            }]),
            cover_art_archive: None,
            score: None,
            status: None,
            packaging: None,
            text_representation: None,
            release_group: Some(rg),
            label_info: None,
            genres: None,
            tags: None,
            relations: None,
        };
        let cand = candidate_from_release(&rel);
        assert_eq!(cand.title, "OK Computer");
        assert_eq!(cand.artist, "Radiohead");
        assert_eq!(cand.country.as_deref(), Some("US"));
        assert_eq!(
            cand.release_group_id,
            "33333333-3333-3333-3333-333333333333"
        );
        assert_eq!(
            cand.release_id.as_deref(),
            Some("44444444-4444-4444-4444-444444444444")
        );
        assert_eq!(cand.media.as_deref(), Some("CD"));
        // date from the release itself, not the rg
        assert_eq!(cand.first_release_date.as_deref(), Some("1997-06-16"));
    }
}
