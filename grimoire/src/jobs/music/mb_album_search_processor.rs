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
    crate::jobs::rate_limit::acquire(crate::jobs::rate_limit::Source::Mb).await;
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
    //
    // before scoring, gather two pieces of side-context that the scorer
    // can fold into its boosts:
    //   1. cross-api mbids — when a previous lastfm/audiodb run has
    //      surfaced a release-group mbid for this album, candidates whose
    //      `release_group_id` matches get the largest single boost
    //      (third-party agreement is a very strong identity signal).
    //   2. local song summary — for the "single long song that should
    //      match a multi-track release" case (dj sets, side-long suites).
    //      we compare local total duration vs. summed mb track durations
    //      with a per-track tolerance.
    let cross_api_mbids: std::collections::HashSet<String> = {
        let mut set = std::collections::HashSet::new();
        let md = albums_repo::read_album_metadata(&album_id).await;
        if let Some(meta) = md.data {
            if let Some(lf) = meta.lastfm.as_ref().and_then(|l| l.album.as_ref()) {
                if let Some(m) = lf.mbid.as_ref().filter(|s| !s.is_empty()) {
                    set.insert(m.clone());
                }
            }
            if let Some(adb) = meta.audiodb.as_ref().and_then(|a| a.album.as_ref()) {
                if let Some(m) = adb
                    .musicbrainz_release_group_id
                    .as_ref()
                    .filter(|s| !s.is_empty())
                {
                    set.insert(m.clone());
                }
            }
        }
        set
    };

    let local_song_summary: Option<(usize, u64)> = {
        // single COUNT(*) + SUM(duration) — keeps this cheap even for
        // big libraries.
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
            // grab the first medium's format (cd, digital media, vinyl, ...)
            let media_format = r
                .media
                .as_ref()
                .and_then(|m| m.first())
                .and_then(|m| m.format.clone());
            // candidate's track durations (ms) for the long-song case.
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
            let mbid_match =
                !release_group_id_str.is_empty() && cross_api_mbids.contains(&release_group_id_str);
            let local_confidence = compute_local_confidence(
                &title,
                artist.as_deref(),
                &r.title,
                &primary_artist,
                r.score,
                r.country.as_deref(),
                media_format.as_deref(),
                None, // tag_count unknown at search time (tags arrive on detail-fetch)
                local_song_summary,
                if track_lens_ms.is_empty() {
                    None
                } else {
                    Some(track_lens_ms.as_slice())
                },
                mbid_match,
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
    let mut auto_confirmed_release_group_id: Option<String> = None;
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
            auto_confirmed_release_group_id = Some(top.release_group_id.clone());
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
/// + artist, then applies small additive boosts for canonical release
/// shapes (worldwide / digital / cd) — these are weak signals that one
/// release is more likely to be the canonical one than a regional pressing.
///
/// optional inputs (pass `None`/`false` when unavailable):
///   * `tag_count` — number of tags MB exposes for this release/release-group.
///     present (>0) → small boost; explicitly empty (Some(0)) → small
///     penalty (we strongly prefer candidates that ship folksonomy tags so
///     the album review surfaces are useful out of the box).
///   * `local_song_summary` — `(local_song_count, local_total_seconds)` —
///     used together with `cand_track_lengths_ms` to handle the
///     "local album is one long track that should match a multi-track
///     mb release" case (long live mixes, dj sets, side-long suites).
///     when the local side is exactly one song longer than ~10 minutes,
///     we compare the candidate's summed track durations with a tolerance
///     of ±5s per track. close match → big boost (+0.15).
///   * `cand_track_lengths_ms` — durations (ms) for the candidate's tracks.
///   * `cross_api_mbid_match` — true when this candidate's
///     `release_group_id` matches an mbid surfaced by last.fm or audiodb
///     for the same album (cross-source agreement is a very strong signal).
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
    let mut blended = 0.45 * title_overlap + 0.35 * artist_overlap + 0.20 * mb_norm;

    // small additive boosts for canonical release shapes. capped at 1.0
    // and only applied when the base score is already in the ballpark
    // (>=0.5) so a low-quality match doesn't tip across thresholds just
    // because it happens to be a worldwide cd.
    if blended >= 0.5 {
        // ── country boosts ─────────────────────────────────────────────
        // policy: prefer worldwide ("XW") releases first, then US
        // pressings as a fallback. this is intentionally biased toward
        // the canonical "global digital" + "us cd" shapes that produce
        // the richest folksonomy on last.fm + audiodb in our corpus.
        // this is a POLICY CHOICE, not an objective ranking — if the
        // priority order ever changes (say, prefer the artist's home
        // country, or prefer the original-pressing country), edit here.
        match country {
            Some("XW") => blended += 0.05,
            Some("US") => blended += 0.04, // slightly less than XW
            _ => {}
        }
        if let Some(fmt) = media_format {
            let f = fmt.to_lowercase();
            if f.contains("cd") || f.contains("digital") {
                blended += 0.03;
            }
        }
    }

    // ── tag presence (post-detail re-rank) ───────────────────────────
    // tags drive the album-review modals; candidates without any
    // tags are functionally useless for downstream enrichment, so
    // bias against them strongly enough to break ties but not so
    // hard that a clear identity match gets buried.
    match tag_count {
        Some(n) if n >= 5 => blended += 0.06,
        Some(n) if n > 0 => blended += 0.03,
        Some(0) => blended -= 0.05,
        _ => {} // None = unknown (search-time) — don't move the needle
    }

    // ── cross-api mbid agreement ─────────────────────────────────────
    // when last.fm or audiodb reported the same release-group mbid for
    // this album, that's an independent third-party confirmation. apply
    // the largest single boost in this function.
    if cross_api_mbid_match {
        blended += 0.15;
    }

    // ── single-long-song-as-album case ───────────────────────────────
    // a local side with exactly ONE track longer than ~10 minutes is
    // probably a single rip of a multi-track album (dj mixes, mahler
    // symphonies, side-long prog suites). compare the candidate's
    // summed track durations against the local single-song duration
    // with a per-track tolerance.
    if let (Some((local_count, local_total)), Some(track_lens)) =
        (local_song_summary, cand_track_lengths_ms)
    {
        if local_count == 1 && local_total > 600 && !track_lens.is_empty() {
            let mb_total_secs: u64 = track_lens.iter().map(|ms| (*ms as u64) / 1000).sum();
            // tolerance = ±5s per mb track (so a 6-track album allows
            // ±30s of drift, which covers gapless-vs-gapped rips, missed
            // pre-rolls, fade-outs, etc.).
            let tolerance = 5u64 * track_lens.len() as u64;
            let diff = local_total.abs_diff(mb_total_secs);
            if diff <= tolerance {
                blended += 0.15;
            } else if diff <= tolerance * 2 {
                // not a perfect duration match but plausible — small nudge
                blended += 0.05;
            }
        }
    }

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
        );
        assert!(c >= 0.95);
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
        );
        assert!(
            with_mbid - base >= 0.14,
            "expected +0.15 mbid boost, got {} -> {}",
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
        );
        assert!(c < 0.3);
    }
}
