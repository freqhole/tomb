//! album enrichment pipeline (phase 14.4)
//!
//! orchestrator job: takes one album_id and a list of enrichment sources,
//! enqueues per-source detail jobs (mb-search if no rg yet, lastfm,
//! audiodb), and returns the spawned child job ids.
//!
//! freshness check: when `force=false` (default), each source is skipped if
//! its `metadata.<source>.fetched_at` is within `FRESHNESS_WINDOW_SECS` of
//! now. when true, every selected source re-runs.
//!
//! the pipeline job itself does NOT wait for child jobs — the priority
//! queue + per-source rate limiters take care of pacing. for "did this
//! album finish?" the ui polls `get_enrichment_progress` (14.4e).

use serde_json::Value;
use tracing::{info, warn};

use crate::config;
use crate::jobs::models::{Job, JobError};
use crate::jobs::{
    create_job, AudioDbAlbumDetailParams, CreateJobRequest, EnrichmentSource, JobType,
    LastFmAlbumDetailParams, MbAlbumSearchParams,
};
use crate::music::entities::albums as albums_repo;
use crate::music::lastfm::lastfm_is_configured;

use super::models::{AlbumEnrichmentPipelineParams, AlbumEnrichmentPipelineResult};

/// 7 days. arbitrary but matches the ui's "stale" badge threshold.
const FRESHNESS_WINDOW_SECS: i64 = 7 * 24 * 60 * 60;

pub async fn process_album_enrichment_pipeline_job(
    job: &Job,
) -> Result<Option<Value>, JobError> {
    let params: AlbumEnrichmentPipelineParams =
        serde_json::from_str(&job.parameters).map_err(|e| JobError::ProcessingFailed {
            reason: format!("invalid parameters: {}", e),
        })?;

    let album_id = params.album_id.clone();
    let sources = if params.sources.is_empty() {
        vec![
            EnrichmentSource::Mb,
            EnrichmentSource::Lastfm,
            EnrichmentSource::Audiodb,
        ]
    } else {
        params.sources.clone()
    };

    info!(
        "enrichment-pipeline starting album={} sources={:?} force={}",
        album_id, sources, params.force
    );

    // single read of metadata for freshness checks + mbid hints.
    let meta = albums_repo::read_album_metadata(&album_id).await.data;
    let now = time::OffsetDateTime::now_utc().unix_timestamp();

    let mut result = AlbumEnrichmentPipelineResult {
        album_id: album_id.clone(),
        enqueued_job_ids: Vec::new(),
        skipped_sources: Vec::new(),
    };

    for source in sources {
        if !params.force && is_fresh(&meta, source, now) {
            info!("  skip {:?} (fresh within window)", source);
            result.skipped_sources.push(source.as_str().to_string());
            continue;
        }

        // skip sources whose api credentials aren't configured. enqueuing
        // a dead job just wastes retries and clutters the queue ui.
        if matches!(source, EnrichmentSource::Lastfm)
            && !lastfm_is_configured(&config::get_config().lastfm)
        {
            info!("  skip {:?} (not configured)", source);
            result.skipped_sources.push(source.as_str().to_string());
            continue;
        }

        let (job_type, parameters) = match source {
            EnrichmentSource::Mb => {
                let p = MbAlbumSearchParams {
                    album_id: album_id.clone(),
                    artist_override: None,
                    title_override: None,
                    auto_confirm_threshold: None,
                };
                match serde_json::to_value(&p) {
                    Ok(v) => (JobType::MbAlbumSearch, v),
                    Err(_) => continue,
                }
            }
            EnrichmentSource::Lastfm => {
                let mbid = meta
                    .as_ref()
                    .and_then(|m| m.musicbrainz.as_ref())
                    .and_then(|mb| mb.release_group_id.clone());
                let p = LastFmAlbumDetailParams {
                    album_id: album_id.clone(),
                    mbid,
                    artist_override: None,
                    title_override: None,
                };
                match serde_json::to_value(&p) {
                    Ok(v) => (JobType::LastFmAlbumDetail, v),
                    Err(_) => continue,
                }
            }
            EnrichmentSource::Audiodb => {
                let mbid = meta
                    .as_ref()
                    .and_then(|m| m.musicbrainz.as_ref())
                    .and_then(|mb| mb.release_group_id.clone());
                let p = AudioDbAlbumDetailParams {
                    album_id: album_id.clone(),
                    mbid,
                    artist_mbid: None,
                    artist_override: None,
                    title_override: None,
                };
                match serde_json::to_value(&p) {
                    Ok(v) => (JobType::AudioDbAlbumDetail, v),
                    Err(_) => continue,
                }
            }
        };

        let req = CreateJobRequest {
            job_type,
            session_id: job.session_id.clone(),
            parameters,
            max_retries: Some(2),
            scheduled_at: None,
            created_by: job.created_by.clone(),
            // child jobs inherit the orchestrator's priority so a
            // user-initiated pipeline finishes ahead of background fills.
            // (priority is read from the parent job row.)
            priority: None,
        };
        let resp = create_job(req).await;
        match resp.data {
            Some(j) => result.enqueued_job_ids.push(j.id),
            None => warn!("  failed to enqueue {:?}: {}", source, resp.message),
        }
    }

    info!(
        "enrichment-pipeline album={} enqueued={} skipped={:?}",
        album_id,
        result.enqueued_job_ids.len(),
        result.skipped_sources
    );

    serde_json::to_value(&result)
        .map(Some)
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("serialize result: {}", e),
        })
}

fn is_fresh(
    meta: &Option<crate::music::entities::albums::metadata::AlbumMetadata>,
    source: EnrichmentSource,
    now: i64,
) -> bool {
    let Some(meta) = meta else {
        return false;
    };
    let fetched_at = match source {
        EnrichmentSource::Mb => meta
            .folksonomy
            .as_ref()
            .and_then(|f| f.musicbrainz.as_ref())
            .and_then(|mb| mb.fetched_at),
        EnrichmentSource::Lastfm => meta.lastfm.as_ref().and_then(|l| l.fetched_at),
        EnrichmentSource::Audiodb => meta.audiodb.as_ref().and_then(|a| a.fetched_at),
    };
    matches!(fetched_at, Some(ts) if now - ts < FRESHNESS_WINDOW_SECS)
}
