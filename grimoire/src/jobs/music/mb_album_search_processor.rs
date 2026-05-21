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
use crate::music::entities::albums::metadata::{
    self, AlbumMetadata, MbCandidate, MbLastQuery, MbLookupStatus,
};
use crate::music::musicbrainz::{MusicBrainzClient, ReleaseSearchQuery};
use serde_json::Value;
use tracing::info;

use super::models::{MbAlbumSearchParams, MbAlbumSearchResult};

const DEFAULT_LIMIT: u32 = 10;

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
                    let threshold = cfg.musicbrainz.confirmed_pointer_revalidate_threshold;
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

    let mut query = ReleaseSearchQuery::new().release(&title);
    // prefer arid: mbid clause over free-text artist when an artist mbid
    // is available — more precise, avoids false positives on name collisions.
    if let Some(arid) = ids.artist_mbids.first() {
        query = query.arid(arid.clone());
    } else if let Some(a) = artist.as_deref() {
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

    // compute earliest known release year across the result set so we can
    // give a small "earliest pressing wins" boost during scoring. we use
    // year only (not full date) because mb dates are often partial
    // ("1975" vs "1975-04-12") and any finer comparison would be flaky.
    fn parse_year(s: &str) -> Option<u32> {
        s.get(0..4).and_then(|y| y.parse::<u32>().ok())
    }
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
                // check release-group id (audiodb source)
                (!release_group_id_str.is_empty()
                    && ids.release_or_rg_mbids.contains(&release_group_id_str))
                // check release id (lastfm source — album.mbid is a release id)
                || ids.release_or_rg_mbids.contains(&r.id.to_string());
            // cover art: drives the strongest tie-breaker between
            // releases that share artist+title (re-issues, regional
            // pressings). a release with rich cover art is almost
            // always the canonical one we want for downstream
            // enrichment.
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
            // years past the earliest pressing in this result set
            // (None = unknown date). older pressings rank higher,
            // but cover art outweighs date.
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
                cover_art_count,
                has_front_cover,
                years_since_earliest,
                preferred_country.as_str(),
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

    // sort by local_confidence desc so the ui shows best first.
    // when confidences tie (within 1e-6) we apply a deterministic
    // multi-key tiebreaker that mirrors the boost ordering inside
    // compute_local_confidence, so identical-text candidates still
    // surface the canonical pressing first in the ui:
    //   1. cover-art image count (more = better)
    //   2. has-front-cover (true beats false)
    //   3. country priority (XW > preferred > others)
    //   4. format priority (digital > cd > others)
    //   5. earliest first_release_date (older wins)
    let country_rank = |c: Option<&str>| -> u8 {
        match c {
            Some("XW") => 2,
            Some(s) if s == preferred_country.as_str() => 1,
            _ => 0,
        }
    };
    fn format_rank(f: Option<&str>) -> u8 {
        match f.map(|s| s.to_lowercase()) {
            Some(s) if s.contains("digital") => 2,
            Some(s) if s.contains("cd") => 1,
            _ => 0,
        }
    }
    // build a parallel side-table of the tiebreaker fields keyed by
    // release_id so we don't have to extend MbCandidate just for sort.
    use std::collections::HashMap;
    let mut sort_meta: HashMap<String, (u32, bool, u8, u8, Option<u32>)> = HashMap::new();
    for r in &search.results {
        let key = r.id.to_string();
        let caa_count = r.cover_art_archive.as_ref().map(|c| c.count).unwrap_or(0);
        let caa_front = r
            .cover_art_archive
            .as_ref()
            .map(|c| c.front)
            .unwrap_or(false);
        let cr = country_rank(r.country.as_deref());
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
        sort_meta.insert(key, (caa_count, caa_front, cr, fr, yr));
    }
    let mut sorted = candidates.clone();
    sorted.sort_by(|a, b| {
        let ac = a.local_confidence.unwrap_or(0.0);
        let bc = b.local_confidence.unwrap_or(0.0);
        // primary: confidence desc
        match bc.partial_cmp(&ac).unwrap_or(std::cmp::Ordering::Equal) {
            std::cmp::Ordering::Equal => {}
            other if (ac - bc).abs() > 1e-6 => return other,
            _ => {}
        }
        let empty = (0u32, false, 0u8, 0u8, None);
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
        // 1. cover art count desc
        bm.0.cmp(&am.0)
            // 2. has front cover desc (true > false)
            .then_with(|| bm.1.cmp(&am.1))
            // 3. country rank desc (XW > US > 0)
            .then_with(|| bm.2.cmp(&am.2))
            // 4. format rank desc (digital > cd > 0)
            .then_with(|| bm.3.cmp(&am.3))
            // 5. earliest year asc (older wins). unknown years sort last.
            .then_with(|| match (am.4, bm.4) {
                (Some(ay), Some(by)) => ay.cmp(&by),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal,
            })
    });

    let last_query = MbLastQuery {
        artist: artist.clone().unwrap_or_default(),
        release: title.clone(),
        tracks: None,
        stage: None,
    };

    // step 5: merge into metadata
    //
    // re-querying may invalidate any previous confirmation pointer:
    // the new top candidate may not match the previously-confirmed
    // release, in which case the stored `release_id` /
    // `release_group_id` would mis-highlight a non-top candidate as
    // "current" in the review ui. clear stale pointers up front;
    // the auto-confirm branch below will re-set them when appropriate.
    let new_top_release_id = sorted.first().and_then(|c| c.release_id.clone());
    let new_top_release_group_id = sorted.first().map(|c| c.release_group_id.clone());
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
    let mut patch = metadata::patch_mb_search_result(&sorted, &last_query);
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
    let top_conf = sorted.first().and_then(|c| c.local_confidence);
    const AUTO_CONFIRM_MARGIN: f64 = 0.05;
    let top_val = top_conf.unwrap_or(0.0);

    // tiebreaker keys for the leader vs runner-up, in priority order:
    // (cover_count, has_front, country_rank, format_rank, neg_year)
    // higher is better for the first four; year is compared so that
    // smaller (older) wins, which we express via Reverse on year only.
    let lookup_meta = |c: &MbCandidate| -> (u32, bool, u8, u8, Option<u32>) {
        c.release_id
            .as_deref()
            .and_then(|k| sort_meta.get(k))
            .copied()
            .unwrap_or((0, false, 0, 0, None))
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
                });
        ord == std::cmp::Ordering::Less
    };

    // count candidates within the auto-confirm margin of the leader.
    let near_top_count = sorted
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
    const DECISIVE_GAP: f64 = 0.03;
    let strict_winner = match (sorted.first(), sorted.get(1)) {
        (Some(top), Some(second)) => {
            let sc = second.local_confidence.unwrap_or(0.0);
            let gap = top_val - sc;
            let in_band = gap.abs() < AUTO_CONFIRM_MARGIN;
            near_top_count == 1
                || gap >= DECISIVE_GAP
                || (in_band && strictly_better_tiebreak(top, second))
        }
        (Some(_), None) => true,
        _ => false,
    };

    let mut auto_confirmed_release_id: Option<String> = None;
    let mut auto_confirmed_release_group_id: Option<String> = None;
    let final_status = if sorted.is_empty() {
        MbLookupStatus::NoMatch
    } else if let (Some(threshold), Some(top)) = (params.auto_confirm_threshold, sorted.first()) {
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
    const IDENTITY_CAP: f64 = 0.85;

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

    let identity = identity.min(IDENTITY_CAP);

    // ── tier 2: structural tiebreakers ───────────────────────────────
    // only applied when identity is already in the ballpark so a junk
    // match can't be tipped over auto-confirm thresholds by happening
    // to be a worldwide cd with rich cover art. these are the signals
    // that pick the canonical release within an already-identified
    // release-group.
    let mut tiebreak: f64 = 0.0;
    if identity >= 0.5 {
        // cover art — strongest tiebreaker per product spec.
        if has_front_cover {
            tiebreak += 0.04;
        }
        if cover_art_count > 0 {
            // per-extra-image bonus, capped. cover_art_count of 1 just
            // means "has front" so no extra; 2+ images progressively
            // reward richer cover-art coverage.
            let extras = ((cover_art_count.saturating_sub(1)) as f64 * 0.008).min(0.04);
            tiebreak += extras;
        }

        // country — XW (worldwide) > preferred > others. policy choice.
        match country {
            Some("XW") => tiebreak += 0.05,
            Some(c) if c == preferred_country => tiebreak += 0.04,
            _ => {}
        }

        // format — digital > cd > vinyl/cassette/other.
        if let Some(fmt) = media_format {
            let f = fmt.to_lowercase();
            if f.contains("digital") {
                tiebreak += 0.04;
            } else if f.contains("cd") {
                tiebreak += 0.03;
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
            tiebreak += boost;
        }

        // tags — applies at detail-time re-rank when tag_count is
        // known. search-time passes None so this is a no-op.
        match tag_count {
            Some(n) if n >= 5 => tiebreak += 0.04,
            Some(n) if n > 0 => tiebreak += 0.02,
            Some(0) => tiebreak -= 0.04,
            _ => {}
        }
    }

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
        assert!(c >= 0.84 && c <= 0.86, "expected ~0.85, got {}", c);
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
            canonical - sibling >= 0.10,
            "canonical pressing should beat sibling by >=0.10; got {} vs {}",
            canonical,
            sibling
        );
        assert!(
            sibling <= 0.90,
            "sibling pressing should not also saturate to 1.0, got {}",
            sibling
        );
    }
}
