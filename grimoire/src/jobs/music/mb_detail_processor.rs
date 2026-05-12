//! musicbrainz album-detail job processor (phase 8)
//!
//! one job per confirmed album. flow:
//! 1. mark `mb_lookup_status = FetchingDetail`.
//! 2. fetch release-group with `+genres+tags+artist-credits`.
//! 3. if a release_id is present, also fetch the release with
//!    `+genres+tags+...`.
//! 4. map MB `Tag`/`Genre` rows -> `FolksonomyTag` and stuff them into a
//!    single `MbFolksonomy` blob (release_genres / release_tags /
//!    release_group_genres / release_group_tags + fetched_at).
//! 5. merge via `patch_mb_folksonomy` so writes stay centralized.
//! 6. flip status to `Enriched` (or `Error` on failure).
//!
//! heuristics like top-K folksonomy summaries are computed at read time
//! by callers; this processor just persists the raw lists.

use crate::config;
use crate::jobs::models::{Job, JobError};
use crate::jobs::{
    create_job, AudioDbAlbumDetailParams, AudioDbArtistDetailParams, CreateJobRequest, JobType,
    LastFmAlbumDetailParams, LastFmArtistDetailParams,
};
use crate::music::entities::albums as albums_repo;
use crate::music::entities::albums::metadata::{self, FolksonomyTag, MbFolksonomy, MbLookupStatus};
use crate::music::musicbrainz::models::{Genre, Tag};
use crate::music::musicbrainz::MusicBrainzClient;
use serde_json::Value;
use tracing::{info, warn};

use super::models::{MbAlbumDetailParams, MbAlbumDetailResult};

/// minimum local_confidence for a sibling release to be considered for
/// the walk-and-union path. matches the auto-confirm threshold ballpark
/// so we only fold in tags from candidates we'd otherwise trust.
const SIBLING_WALK_CONFIDENCE_THRESHOLD: f64 = 0.7;

/// hard cap on how many sibling releases we'll detail-fetch when the
/// auto-confirmed winner has zero tags. mb is rate-limited at 1 req/s,
/// so each sibling adds ~1s of latency to the job.
const SIBLING_WALK_MAX: usize = 5;

pub async fn process_mb_album_detail_job(job: &Job) -> Result<Option<Value>, JobError> {
    let params: MbAlbumDetailParams =
        serde_json::from_str(&job.parameters).map_err(|e| JobError::ProcessingFailed {
            reason: format!("invalid parameters: {}", e),
        })?;

    let album_id = params.album_id.clone();
    info!(
        "mb album-detail starting for album {} rg={} release={:?}",
        album_id, params.release_group_id, params.release_id
    );

    // step 1: mark fetching (best-effort)
    let _ = albums_repo::update_mb_lookup_status(
        &album_id,
        MbLookupStatus::FetchingDetail,
        job.created_by.as_deref(),
    )
    .await;

    // step 2: build client
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

    // step 3: fetch release-group
    crate::jobs::rate_limit::acquire(crate::jobs::rate_limit::Source::Mb).await;
    let rg_resp = client.get_release_group(&params.release_group_id).await;
    if !rg_resp.success {
        let _ = albums_repo::update_mb_lookup_status(
            &album_id,
            MbLookupStatus::Error,
            job.created_by.as_deref(),
        )
        .await;
        return Err(JobError::ProcessingFailed {
            reason: format!("mb release-group fetch failed: {}", rg_resp.message),
        });
    }
    let rg = rg_resp.data.ok_or_else(|| JobError::ProcessingFailed {
        reason: "mb release-group response empty".to_string(),
    })?;

    let release_group_genres = map_genres(rg.genres.as_deref());
    let release_group_tags = map_tags(rg.tags.as_deref());

    // collect official MB genre names from the release-group up front so we
    // can use them later when auto-filling album columns.
    let mut mb_genre_names: Vec<String> = rg
        .genres
        .as_deref()
        .map(|g| g.iter().map(|x| x.name.clone()).collect())
        .unwrap_or_default();
    let rg_first_release_date = rg.first_release_date.clone();

    info!(
        "mb release-group {} title={:?} primary_type={:?} secondary_types={:?} first_release_date={:?} artist_credits={}",
        rg.id,
        rg.title,
        rg.primary_type,
        rg.secondary_types,
        rg.first_release_date,
        format_artist_credits(rg.artist_credit.as_deref()),
    );
    info!(
        "  rg genres ({}): {}",
        release_group_genres.len(),
        format_folksonomy_top(&release_group_genres, 10)
    );
    info!(
        "  rg tags ({}): {}",
        release_group_tags.len(),
        format_folksonomy_top(&release_group_tags, 10)
    );

    // step 4: optionally fetch release
    let mut release_date_for_apply: Option<String> = None;
    let mut release_label_for_apply: Option<String> = None;
    let (mut release_genres, mut release_tags) = if let Some(release_id) =
        params.release_id.as_deref()
    {
        crate::jobs::rate_limit::acquire(crate::jobs::rate_limit::Source::Mb).await;
        let r_resp = client.get_release(release_id).await;
        if r_resp.success {
            let r = r_resp.data.unwrap();
            let r_genres = map_genres(r.genres.as_deref());
            let r_tags = map_tags(r.tags.as_deref());
            info!(
                "mb release {} title={:?} status={:?} packaging={:?} country={:?} date={:?} text_repr={:?}",
                r.id,
                r.title,
                r.status,
                r.packaging,
                r.country,
                r.date,
                r.text_representation,
            );
            info!(
                "  release labels: {}",
                format_label_info(r.label_info.as_deref())
            );
            info!("  release media: {}", format_media(r.media.as_deref()));
            info!("  release cover_art: {:?}", r.cover_art_archive);
            info!(
                "  release genres ({}): {}",
                r_genres.len(),
                format_folksonomy_top(&r_genres, 10)
            );
            info!(
                "  release tags ({}): {}",
                r_tags.len(),
                format_folksonomy_top(&r_tags, 10)
            );
            // capture for auto-apply: prefer release.date over rg.first_release_date
            release_date_for_apply = r.date.clone();
            release_label_for_apply = r
                .label_info
                .as_ref()
                .and_then(|li| li.first())
                .and_then(|li| li.label.as_ref())
                .map(|l| l.name.clone());
            // merge release-level genres into the names pool (deduped lowercase)
            if let Some(gs) = r.genres.as_deref() {
                for g in gs {
                    if !mb_genre_names
                        .iter()
                        .any(|n| n.eq_ignore_ascii_case(&g.name))
                    {
                        mb_genre_names.push(g.name.clone());
                    }
                }
            }
            (r_genres, r_tags)
        } else {
            // release fetch failure is non-fatal; we still have release-group
            // data. log and continue.
            info!(
                "mb release fetch failed for {} (continuing with rg-only): {}",
                release_id, r_resp.message
            );
            (Vec::new(), Vec::new())
        }
    } else {
        (Vec::new(), Vec::new())
    };

    // step 4b (phase 14.1): walk-and-union. when the auto-confirmed winner
    // has zero release-level tags, walk down sibling candidates with
    // confidence >= SIBLING_WALK_CONFIDENCE_THRESHOLD (sorted desc, capped
    // at SIBLING_WALK_MAX) and union their release tags. tracks which
    // release_ids contributed so the review ui can surface provenance.
    let mut tag_source_release_ids: Vec<String> = Vec::new();
    if let Some(primary_rid) = params.release_id.as_deref() {
        // primary release contributed iff it had any tags to begin with.
        if !release_genres.is_empty() || !release_tags.is_empty() {
            tag_source_release_ids.push(primary_rid.to_string());
        }
    }
    if release_genres.is_empty() && release_tags.is_empty() {
        let extra =
            walk_sibling_releases_for_tags(&client, &album_id, params.release_id.as_deref()).await;
        if !extra.contributing_release_ids.is_empty() {
            info!(
                "mb walk-and-union: folded tags from {} sibling release(s) for album {}",
                extra.contributing_release_ids.len(),
                album_id,
            );
        }
        merge_folksonomy_into(&mut release_genres, extra.genres);
        merge_folksonomy_into(&mut release_tags, extra.tags);
        for rid in extra.contributing_release_ids {
            if !tag_source_release_ids.contains(&rid) {
                tag_source_release_ids.push(rid);
            }
        }
    }

    let folksonomy = MbFolksonomy {
        release_genres,
        release_tags,
        release_group_genres,
        release_group_tags,
        fetched_at: Some(time::OffsetDateTime::now_utc().unix_timestamp()),
    };

    // mb has no dedicated "mood" field — moods live in the same folksonomy
    // tag pool as everything else. surface them so we can see what's
    // available before deciding whether to extract them into a first-class
    // dimension. matches against a (deliberately-loose) list of common mood
    // tags applied to releases on musicbrainz.
    let mood_hits = collect_mood_hits(&folksonomy);
    if !mood_hits.is_empty() {
        info!(
            "  mood-like tags ({}): {}",
            mood_hits.len(),
            format_folksonomy_top(&mood_hits, mood_hits.len())
        );
    } else {
        info!("  mood-like tags: (none detected)");
    }

    let result_summary = MbAlbumDetailResult {
        album_id: album_id.clone(),
        release_genre_count: folksonomy.release_genres.len() as u64,
        release_tag_count: folksonomy.release_tags.len() as u64,
        release_group_genre_count: folksonomy.release_group_genres.len() as u64,
        release_group_tag_count: folksonomy.release_group_tags.len() as u64,
        final_status: MbLookupStatus::Enriched.as_str().to_string(),
    };

    // step 5: merge folksonomy patch
    let patch = metadata::patch_mb_folksonomy(&folksonomy);
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

    // step 5a: persist which release_ids contributed to the folksonomy
    // snapshot. always written (may be empty) so a re-run cleanly overwrites
    // an earlier walk-and-union from a previous detail pass.
    let sources_patch = metadata::patch_mb_tag_sources(&tag_source_release_ids);
    let _ = albums_repo::merge_album_metadata(&album_id, &sources_patch).await;

    // step 5b: auto-apply year/label/genres to album columns where currently
    // empty. user-facing convention: never overwrite hand-edited values.
    // never touches title/artist/track-level fields (those need explicit
    // user opt-in via ui).
    let release_date_to_apply = release_date_for_apply.or(rg_first_release_date);
    let apply_summary = apply_mb_album_columns_if_empty(
        &album_id,
        release_date_to_apply.as_deref(),
        release_label_for_apply.as_deref(),
        &mb_genre_names,
    )
    .await;
    info!(
        "mb auto-apply for {}: year={} label={} genres_added={}",
        album_id, apply_summary.year_set, apply_summary.label_set, apply_summary.genres_added
    );

    // step 6: flip status to enriched
    let _ = albums_repo::update_mb_lookup_status(
        &album_id,
        MbLookupStatus::Enriched,
        job.created_by.as_deref(),
    )
    .await;

    // phase 13c: auto-chain lastfm + audiodb detail jobs.
    // we now have a confirmed MBID for this album, which is the
    // cheapest+highest-quality lookup key for both downstream sources.
    // chain only when the source is config-enabled and the album has an
    // mbid. respects existing per-source throttles via the runner's rate
    // limiter; deduped by the freshness check on `AlbumEnrichmentPipeline`
    // when invoked through that path, but here we go direct so the user
    // sees richer data immediately after the mb confirm flow.
    chain_external_enrichment(job, &album_id, &params.release_group_id).await;

    info!(
        "mb album-detail complete for {}: rg_genres={} rg_tags={} r_genres={} r_tags={}",
        album_id,
        result_summary.release_group_genre_count,
        result_summary.release_group_tag_count,
        result_summary.release_genre_count,
        result_summary.release_tag_count,
    );

    Ok(Some(serde_json::to_value(result_summary).map_err(|e| {
        JobError::ProcessingFailed {
            reason: format!("serialize result: {}", e),
        }
    })?))
}

/// phase 13c — enqueue lastfm + audiodb album-detail jobs after a
/// successful mb enrichment. silent no-op when the source is disabled,
/// or job-creation fails (we don't want a downstream queueing hiccup to
/// fail the mb job itself). dedup against fresh-window data is not done
/// here — `AlbumEnrichmentPipeline` is the path for skip-if-fresh; this
/// chain fires every time the user explicitly confirms an mb match so
/// they get richer data without an extra click.
async fn chain_external_enrichment(job: &Job, album_id: &str, release_group_id: &str) {
    let cfg = config::get_config();

    if cfg.lastfm.enabled {
        let p = LastFmAlbumDetailParams {
            album_id: album_id.to_string(),
            mbid: Some(release_group_id.to_string()),
            artist_override: None,
            title_override: None,
        };
        match serde_json::to_value(&p) {
            Ok(parameters) => {
                let req = CreateJobRequest {
                    job_type: JobType::LastFmAlbumDetail,
                    session_id: job.session_id.clone(),
                    parameters,
                    max_retries: Some(2),
                    scheduled_at: None,
                    created_by: job.created_by.clone(),
                    priority: None,
                };
                let resp = create_job(req).await;
                if resp.data.is_none() {
                    warn!(
                        "mb-detail chain: failed to enqueue lastfm for {}: {}",
                        album_id, resp.message
                    );
                } else {
                    info!("mb-detail chain: enqueued lastfm for {}", album_id);
                }
            }
            Err(e) => warn!("mb-detail chain: serialize lastfm params: {}", e),
        }
    }

    if cfg.audiodb.enabled {
        let p = AudioDbAlbumDetailParams {
            album_id: album_id.to_string(),
            mbid: Some(release_group_id.to_string()),
            artist_mbid: None,
            artist_override: None,
            title_override: None,
        };
        match serde_json::to_value(&p) {
            Ok(parameters) => {
                let req = CreateJobRequest {
                    job_type: JobType::AudioDbAlbumDetail,
                    session_id: job.session_id.clone(),
                    parameters,
                    max_retries: Some(2),
                    scheduled_at: None,
                    created_by: job.created_by.clone(),
                    priority: None,
                };
                let resp = create_job(req).await;
                if resp.data.is_none() {
                    warn!(
                        "mb-detail chain: failed to enqueue audiodb for {}: {}",
                        album_id, resp.message
                    );
                } else {
                    info!("mb-detail chain: enqueued audiodb for {}", album_id);
                }
            }
            Err(e) => warn!("mb-detail chain: serialize audiodb params: {}", e),
        }
    }

    // phase 13h — also enqueue artist-detail jobs for the album's
    // primary artist. lastfm fires unconditionally (its lookup tolerates
    // a missing mbid via text search); audiodb only fires when the
    // artist already has a stored mbid (its text fallback is weaker and
    // we don't want to burn its tighter daily quota on long-shot misses).
    chain_artist_enrichment(job, album_id).await;
}

async fn chain_artist_enrichment(job: &Job, album_id: &str) {
    let cfg = config::get_config();
    if !cfg.lastfm.enabled && !cfg.audiodb.enabled {
        return;
    }

    let pool = match crate::database::connect().await {
        Ok(p) => p,
        Err(e) => {
            warn!("mb-detail chain: db connect for artist lookup failed: {}", e);
            return;
        }
    };

    let row = match sqlx::query!(
        r#"SELECT
            ar.id as "id!",
            ar.name as "name!",
            CAST(json_extract(ar.metadata, '$.musicbrainz.artist_mbid') AS TEXT) as "artist_mbid?: String"
           FROM artist_albumz aa
           JOIN artistz ar ON ar.id = aa.artist_id
           WHERE aa.album_id = ? AND ar.deleted_at IS NULL
           LIMIT 1"#,
        album_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(r)) => r,
        Ok(None) => return,
        Err(e) => {
            warn!("mb-detail chain: artist lookup failed for {}: {}", album_id, e);
            return;
        }
    };

    let artist_id = row.id;
    let artist_mbid = row.artist_mbid;

    if cfg.lastfm.enabled {
        let p = LastFmArtistDetailParams {
            artist_id: artist_id.clone(),
            mbid: artist_mbid.clone(),
            artist_override: None,
        };
        match serde_json::to_value(&p) {
            Ok(parameters) => {
                let req = CreateJobRequest {
                    job_type: JobType::LastFmArtistDetail,
                    session_id: job.session_id.clone(),
                    parameters,
                    max_retries: Some(2),
                    scheduled_at: None,
                    created_by: job.created_by.clone(),
                    priority: None,
                };
                let resp = create_job(req).await;
                if resp.data.is_none() {
                    warn!(
                        "mb-detail chain: failed to enqueue lastfm-artist for {}: {}",
                        artist_id, resp.message
                    );
                } else {
                    info!("mb-detail chain: enqueued lastfm-artist for {}", artist_id);
                }
            }
            Err(e) => warn!("mb-detail chain: serialize lastfm-artist params: {}", e),
        }
    }

    if cfg.audiodb.enabled {
        if let Some(mbid) = artist_mbid {
            let p = AudioDbArtistDetailParams {
                artist_id: artist_id.clone(),
                mbid: Some(mbid),
                artist_override: None,
            };
            match serde_json::to_value(&p) {
                Ok(parameters) => {
                    let req = CreateJobRequest {
                        job_type: JobType::AudioDbArtistDetail,
                        session_id: job.session_id.clone(),
                        parameters,
                        max_retries: Some(2),
                        scheduled_at: None,
                        created_by: job.created_by.clone(),
                        priority: None,
                    };
                    let resp = create_job(req).await;
                    if resp.data.is_none() {
                        warn!(
                            "mb-detail chain: failed to enqueue audiodb-artist for {}: {}",
                            artist_id, resp.message
                        );
                    } else {
                        info!("mb-detail chain: enqueued audiodb-artist for {}", artist_id);
                    }
                }
                Err(e) => {
                    warn!("mb-detail chain: serialize audiodb-artist params: {}", e)
                }
            }
        } else {
            info!(
                "mb-detail chain: skipping audiodb-artist for {} (no mbid)",
                artist_id
            );
        }
    }
}

fn map_tags(src: Option<&[Tag]>) -> Vec<FolksonomyTag> {
    src.map(|list| {
        list.iter()
            .map(|t| FolksonomyTag {
                name: t.name.clone(),
                count: t.count.unwrap_or(0) as i32,
            })
            .collect()
    })
    .unwrap_or_default()
}

fn map_genres(src: Option<&[Genre]>) -> Vec<FolksonomyTag> {
    src.map(|list| {
        list.iter()
            .map(|g| FolksonomyTag {
                name: g.name.clone(),
                count: g.count.unwrap_or(0) as i32,
            })
            .collect()
    })
    .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// walk-and-union helpers (phase 14.1)
// ---------------------------------------------------------------------------

struct WalkResult {
    genres: Vec<FolksonomyTag>,
    tags: Vec<FolksonomyTag>,
    contributing_release_ids: Vec<String>,
}

/// fetch sibling release candidates for an album and union their
/// release-level genres+tags. returns empty if there are no candidates,
/// no metadata, or no candidate clears the confidence threshold.
///
/// reads the album's `metadata.musicbrainz.candidates` list, filters to
/// `local_confidence >= SIBLING_WALK_CONFIDENCE_THRESHOLD`, sorts desc,
/// skips the primary release_id, caps at SIBLING_WALK_MAX, and detail-
/// fetches each. each fetch is naturally rate-limited by the global mb
/// throttle (1 req/s).
async fn walk_sibling_releases_for_tags(
    client: &MusicBrainzClient,
    album_id: &str,
    primary_release_id: Option<&str>,
) -> WalkResult {
    let mut out = WalkResult {
        genres: Vec::new(),
        tags: Vec::new(),
        contributing_release_ids: Vec::new(),
    };

    let meta_resp = albums_repo::read_album_metadata(album_id).await;
    if !meta_resp.success {
        info!(
            "walk-and-union: read_album_metadata failed for {}: {}",
            album_id, meta_resp.message
        );
        return out;
    }
    let meta = match meta_resp.data {
        Some(m) => m,
        None => return out,
    };
    let mb = match meta.musicbrainz {
        Some(m) => m,
        None => return out,
    };

    // collect siblings: confidence >= threshold, has a release_id, not the
    // primary. sort desc by confidence so we walk the most-likely-to-have-
    // -tags releases first.
    let mut siblings: Vec<(f64, String)> = mb
        .candidates
        .iter()
        .filter_map(|c| {
            let conf = c.local_confidence?;
            if conf < SIBLING_WALK_CONFIDENCE_THRESHOLD {
                return None;
            }
            let rid = c.release_id.as_ref()?.clone();
            if Some(rid.as_str()) == primary_release_id {
                return None;
            }
            Some((conf, rid))
        })
        .collect();
    siblings.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    siblings.truncate(SIBLING_WALK_MAX);

    if siblings.is_empty() {
        info!(
            "walk-and-union: no eligible sibling releases for album {} (winner has no tags)",
            album_id
        );
        return out;
    }

    info!(
        "walk-and-union: trying {} sibling release(s) for album {} (winner has no tags)",
        siblings.len(),
        album_id
    );

    for (conf, rid) in siblings {
        crate::jobs::rate_limit::acquire(crate::jobs::rate_limit::Source::Mb).await;
        let resp = client.get_release(&rid).await;
        if !resp.success {
            info!(
                "  sibling {} (conf={:.2}) fetch failed: {}",
                rid, conf, resp.message
            );
            continue;
        }
        let r = match resp.data {
            Some(r) => r,
            None => continue,
        };
        let g = map_genres(r.genres.as_deref());
        let t = map_tags(r.tags.as_deref());
        if g.is_empty() && t.is_empty() {
            info!("  sibling {} (conf={:.2}): no tags", rid, conf);
            continue;
        }
        info!(
            "  sibling {} (conf={:.2}): +{} genres, +{} tags",
            rid,
            conf,
            g.len(),
            t.len()
        );
        merge_folksonomy_into(&mut out.genres, g);
        merge_folksonomy_into(&mut out.tags, t);
        out.contributing_release_ids.push(rid);
    }

    out
}

/// merge a batch of folksonomy tags into a destination vec, summing counts
/// for entries that match by case-insensitive name.
fn merge_folksonomy_into(dst: &mut Vec<FolksonomyTag>, src: Vec<FolksonomyTag>) {
    for tag in src {
        if let Some(existing) = dst
            .iter_mut()
            .find(|t| t.name.eq_ignore_ascii_case(&tag.name))
        {
            existing.count = existing.count.saturating_add(tag.count);
        } else {
            dst.push(tag);
        }
    }
}

// ---------------------------------------------------------------------------
// log formatting helpers (info-level only, no debug! per ux directive)
// ---------------------------------------------------------------------------

fn format_folksonomy_top(tags: &[FolksonomyTag], n: usize) -> String {
    if tags.is_empty() {
        return "(none)".to_string();
    }
    let mut sorted: Vec<&FolksonomyTag> = tags.iter().collect();
    sorted.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
    sorted
        .into_iter()
        .take(n)
        .map(|t| format!("{}({})", t.name, t.count))
        .collect::<Vec<_>>()
        .join(", ")
}

fn format_artist_credits(
    src: Option<&[crate::music::musicbrainz::models::ArtistCredit]>,
) -> String {
    match src {
        None => "(none)".to_string(),
        Some(list) => list
            .iter()
            .map(|c| {
                let join = c.joinphrase.clone().unwrap_or_default();
                format!("{}{}", c.name, join)
            })
            .collect::<String>(),
    }
}

fn format_label_info(src: Option<&[crate::music::musicbrainz::models::LabelInfo]>) -> String {
    match src {
        None => "(none)".to_string(),
        Some(list) if list.is_empty() => "(none)".to_string(),
        Some(list) => list
            .iter()
            .map(|li| {
                let label = li.label.as_ref().map(|l| l.name.as_str()).unwrap_or("?");
                let cat = li.catalog_number.as_deref().unwrap_or("-");
                format!("{} [{}]", label, cat)
            })
            .collect::<Vec<_>>()
            .join(", "),
    }
}

fn format_media(src: Option<&[crate::music::musicbrainz::models::Medium]>) -> String {
    match src {
        None => "(none)".to_string(),
        Some(list) if list.is_empty() => "(none)".to_string(),
        Some(list) => list
            .iter()
            .map(|m| {
                let format = m.format.as_deref().unwrap_or("?");
                let count = m
                    .track_count
                    .or_else(|| m.tracks.as_ref().map(|t| t.len() as u32))
                    .unwrap_or(0);
                format!("{}x{}", format, count)
            })
            .collect::<Vec<_>>()
            .join(", "),
    }
}

/// rough mood detector. mb's folksonomy is freeform so this is a best-effort
/// match against common mood vocabulary; misses are expected.
fn collect_mood_hits(folksonomy: &MbFolksonomy) -> Vec<FolksonomyTag> {
    const MOOD_TERMS: &[&str] = &[
        "angry",
        "atmospheric",
        "calm",
        "cathartic",
        "cheerful",
        "chill",
        "contemplative",
        "dark",
        "dreamy",
        "driving",
        "energetic",
        "epic",
        "ethereal",
        "euphoric",
        "feelgood",
        "happy",
        "haunting",
        "hopeful",
        "hypnotic",
        "introspective",
        "laid-back",
        "lonely",
        "longing",
        "melancholic",
        "melancholy",
        "mellow",
        "meditative",
        "moody",
        "nostalgic",
        "ominous",
        "peaceful",
        "playful",
        "reflective",
        "relaxing",
        "romantic",
        "sad",
        "sensual",
        "sentimental",
        "serene",
        "soothing",
        "spacey",
        "spiritual",
        "sweet",
        "tense",
        "trippy",
        "uplifting",
        "warm",
        "yearning",
    ];
    let mut hits: Vec<FolksonomyTag> = Vec::new();
    let mut seen: std::collections::HashMap<String, i32> = std::collections::HashMap::new();
    let pools = [
        &folksonomy.release_tags,
        &folksonomy.release_group_tags,
        &folksonomy.release_genres,
        &folksonomy.release_group_genres,
    ];
    for pool in pools {
        for tag in pool.iter() {
            let key = tag.name.to_lowercase();
            if MOOD_TERMS.contains(&key.as_str()) {
                let entry = seen.entry(key.clone()).or_insert(0);
                *entry += tag.count.max(1);
            }
        }
    }
    for (name, count) in seen {
        hits.push(FolksonomyTag { name, count });
    }
    hits.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
    hits
}

// ---------------------------------------------------------------------------
// auto-apply mb-derived data to album columns (year/label/genres only)
// ---------------------------------------------------------------------------

#[derive(Debug, Default)]
struct ApplySummary {
    year_set: bool,
    label_set: bool,
    genres_added: usize,
}

/// fill `release_date` and `label` columns only when currently NULL/empty,
/// and link any new genres into `album_taxonz` (existing links untouched).
/// never updates title, album_type, artist, or song-level data.
async fn apply_mb_album_columns_if_empty(
    album_id: &str,
    release_date: Option<&str>,
    label: Option<&str>,
    genre_names: &[String],
) -> ApplySummary {
    use crate::database;
    let mut summary = ApplySummary::default();
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("auto-apply: db connect failed: {}", e);
            return summary;
        }
    };

    // read current values from album_query_view (label and release_date
    // are now synthesized from `album_taxonz`).
    let current = match sqlx::query!(
        r#"SELECT
            v.album_release_date as "release_date?: String",
            v.album_label as "label?: String"
             FROM albumz a
             LEFT JOIN album_query_view v ON v.album_id = a.id
            WHERE a.id = ? AND a.deleted_at IS NULL"#,
        album_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(row)) => Some((row.release_date, row.label)),
        Ok(None) => None,
        Err(e) => {
            tracing::warn!("auto-apply: read album failed: {}", e);
            None
        }
    };

    let (cur_date, cur_label) = current.unwrap_or((None, None));

    // release_date: only fill when empty
    let new_date = release_date
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .filter(|_| {
            cur_date
                .as_deref()
                .map(|s| s.trim().is_empty())
                .unwrap_or(true)
        });

    // label: only fill when empty
    let new_label = label
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .filter(|_| {
            cur_label
                .as_deref()
                .map(|s| s.trim().is_empty())
                .unwrap_or(true)
        });

    // route the legacy `release_date` / `label` columns through the
    // taxonomy. add_album_taxon with origin='musicbrainz' so the link
    // can be distinguished from user-set values.
    if let Some(date) = new_date {
        let resp =
            crate::music::entities::taxonomy::find_or_create_taxon("release_date", date).await;
        if let Some(taxon) = resp.data {
            let _ = crate::music::entities::taxonomy::add_album_taxon(
                crate::music::entities::taxonomy::AddAlbumTaxonRequest {
                    album_id: album_id.to_string(),
                    taxon_id: taxon.id,
                    origin: "musicbrainz".to_string(),
                    confidence: None,
                },
            )
            .await;
            summary.year_set = true;
            // bump updated_at so cache invalidation triggers
            let _ = sqlx::query!(
                "UPDATE albumz SET updated_at = unixepoch() WHERE id = ?",
                album_id
            )
            .execute(&pool)
            .await;
        }
    }
    if let Some(label_val) = new_label {
        let resp = crate::music::entities::taxonomy::find_or_create_taxon("label", label_val).await;
        if let Some(taxon) = resp.data {
            let _ = crate::music::entities::taxonomy::add_album_taxon(
                crate::music::entities::taxonomy::AddAlbumTaxonRequest {
                    album_id: album_id.to_string(),
                    taxon_id: taxon.id,
                    origin: "musicbrainz".to_string(),
                    confidence: None,
                },
            )
            .await;
            summary.label_set = true;
            let _ = sqlx::query!(
                "UPDATE albumz SET updated_at = unixepoch() WHERE id = ?",
                album_id
            )
            .execute(&pool)
            .await;
        }
    }

    // genres: add any that aren't already linked. find_or_create_taxon handles
    // case-insensitive dedupe at the taxonomy table level.
    for raw_name in genre_names {
        let name = raw_name.trim();
        if name.is_empty() {
            continue;
        }
        let resp = crate::music::entities::taxonomy::find_or_create_taxon("genre", name).await;
        let taxon = match resp.data {
            Some(t) => t,
            None => continue,
        };
        match sqlx::query!(
            r#"INSERT OR IGNORE INTO album_taxonz (album_id, taxon_id, origin) VALUES (?, ?, 'musicbrainz')"#,
            album_id,
            taxon.id,
        )
        .execute(&pool)
        .await
        {
            Ok(res) if res.rows_affected() > 0 => summary.genres_added += 1,
            Ok(_) => {}
            Err(e) => {
                tracing::warn!("auto-apply: link genre {} failed: {}", taxon.id, e);
            }
        }
    }

    summary
}
