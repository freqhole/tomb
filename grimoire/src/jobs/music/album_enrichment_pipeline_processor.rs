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
use crate::database;
use crate::jobs::models::{Job, JobError};
use crate::jobs::{
    create_job, AudioDbAlbumDetailParams, AudioDbArtistDetailParams, CreateJobRequest,
    EnrichmentSource, JobType, LastFmAlbumDetailParams, LastFmArtistDetailParams,
    MbAlbumSearchParams,
};
use crate::music::entities::albums as albums_repo;
use crate::music::entities::artists::metadata::ArtistMetadata;
use crate::music::lastfm::lastfm_is_configured;

use super::models::{AlbumEnrichmentPipelineParams, AlbumEnrichmentPipelineResult};

/// 7 days. arbitrary but matches the ui's "stale" badge threshold.
const FRESHNESS_WINDOW_SECS: i64 = 7 * 24 * 60 * 60;

pub async fn process_album_enrichment_pipeline_job(job: &Job) -> Result<Option<Value>, JobError> {
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

    for source in &sources {
        let source = *source;
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

    // ---- artist-side enrichment (phase 11 / slice 4a + 4b) -----------------
    // for the album's primary artist(s), enqueue lastfm + audiodb
    // artist-detail jobs so that the bulk-review wizard's bio +
    // artist-image panels have data to surface. mb has no artist
    // detail processor today, so it's skipped. honours the same
    // freshness window against `artistz.metadata.{lastfm,audiodb}`.
    if let Ok(pool) = database::connect().await {
        let artist_ids: Vec<String> = match sqlx::query_scalar!(
            r#"SELECT DISTINCT artist_songz.artist_id as "artist_id!"
               FROM album_songz
               JOIN artist_songz ON artist_songz.song_id = album_songz.song_id
               WHERE album_songz.album_id = ?"#,
            album_id
        )
        .fetch_all(&pool)
        .await
        {
            Ok(rows) => rows,
            Err(e) => {
                warn!("  failed to resolve artists for album: {}", e);
                Vec::new()
            }
        };

        for artist_id in artist_ids {
            // load artist metadata once for freshness checks + mbid hint.
            let artist_meta_raw = match sqlx::query_scalar!(
                r#"SELECT metadata FROM artistz WHERE id = ? AND deleted_at IS NULL"#,
                artist_id
            )
            .fetch_optional(&pool)
            .await
            {
                Ok(Some(raw)) => raw,
                Ok(None) => continue, // artist soft-deleted / missing
                Err(e) => {
                    warn!("  failed to load artist metadata: {}", e);
                    continue;
                }
            };
            let artist_meta = ArtistMetadata::parse(artist_meta_raw.as_deref());
            // best-effort artist mbid hint: try the audiodb album
            // snapshot's `musicbrainz_artist_id`, then the audiodb
            // artist snapshot. mb itself doesn't expose artist_mbid
            // on `MbMetadata` (release-scoped only).
            let artist_mbid = meta
                .as_ref()
                .and_then(|m| m.audiodb.as_ref())
                .and_then(|a| a.album.as_ref())
                .and_then(|al| al.musicbrainz_artist_id.clone())
                .or_else(|| {
                    artist_meta
                        .audiodb
                        .as_ref()
                        .and_then(|a| a.artist.as_ref())
                        .and_then(|ar| ar.musicbrainz_artist_id.clone())
                });

            for source in &sources {
                let source = *source;
                // mb has no artist-detail processor; skip silently.
                if matches!(source, EnrichmentSource::Mb) {
                    continue;
                }
                if !params.force && is_artist_fresh(&artist_meta, source, now) {
                    info!("  skip artist {:?} (fresh within window)", source);
                    continue;
                }
                if matches!(source, EnrichmentSource::Lastfm)
                    && !lastfm_is_configured(&config::get_config().lastfm)
                {
                    continue;
                }

                let (job_type, parameters) = match source {
                    EnrichmentSource::Lastfm => {
                        let p = LastFmArtistDetailParams {
                            artist_id: artist_id.clone(),
                            mbid: artist_mbid.clone(),
                            artist_override: None,
                        };
                        match serde_json::to_value(&p) {
                            Ok(v) => (JobType::LastFmArtistDetail, v),
                            Err(_) => continue,
                        }
                    }
                    EnrichmentSource::Audiodb => {
                        let p = AudioDbArtistDetailParams {
                            artist_id: artist_id.clone(),
                            mbid: artist_mbid.clone(),
                            artist_override: None,
                        };
                        match serde_json::to_value(&p) {
                            Ok(v) => (JobType::AudioDbArtistDetail, v),
                            Err(_) => continue,
                        }
                    }
                    EnrichmentSource::Mb => unreachable!(),
                };

                let req = CreateJobRequest {
                    job_type,
                    session_id: job.session_id.clone(),
                    parameters,
                    max_retries: Some(2),
                    scheduled_at: None,
                    created_by: job.created_by.clone(),
                    priority: None,
                };
                let resp = create_job(req).await;
                match resp.data {
                    Some(j) => result.enqueued_job_ids.push(j.id),
                    None => warn!("  failed to enqueue artist {:?}: {}", source, resp.message),
                }
            }
        }
    }

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

fn is_artist_fresh(meta: &ArtistMetadata, source: EnrichmentSource, now: i64) -> bool {
    let fetched_at = match source {
        EnrichmentSource::Lastfm => meta.lastfm.as_ref().and_then(|l| l.fetched_at),
        EnrichmentSource::Audiodb => meta.audiodb.as_ref().and_then(|a| a.fetched_at),
        EnrichmentSource::Mb => return false,
    };
    matches!(fetched_at, Some(ts) if now - ts < FRESHNESS_WINDOW_SECS)
}
