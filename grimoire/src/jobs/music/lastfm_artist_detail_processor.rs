//! last.fm artist-detail job processor (phase 13h)
//!
//! one job per artist. fetches `artist.getInfo` (bio + tags + similar)
//! and persists:
//!   - the typed snapshot into `artistz.metadata.lastfm.*` via
//!     `artists_repo::merge_artist_metadata`
//!   - one `related_artistz` row per similar artist (lazy cross-ref to a
//!     local `artistz.id` happens inside `upsert_related_artist`).
//!
//! errors do NOT fail-loud — we still write a snapshot with `error` set
//! so the ui can surface what went wrong, and we return Ok with a
//! result envelope. only structural failures (db, parameter parse,
//! lastfm client init) bubble up as `JobError`.

use crate::config;
use crate::database;
use crate::jobs::models::{Job, JobError};
use crate::music::entities::albums::metadata::{
    LastFmArtistSnapshot, LastFmSimilarArtistRef, LastFmTagRef,
};
use crate::music::entities::artists as artists_repo;
use crate::music::entities::artists::ArtistLastFmMetadata;
use crate::music::entities::related_artists::{
    upsert_related_artist, RelatedArtistSource, UpsertRelatedArtist,
};
use crate::music::lastfm::models::LastFmArtistInfo;
use crate::music::lastfm::LastFmClient;
use serde_json::{json, Value};
use tracing::{info, warn};

use super::models::{LastFmArtistDetailParams, LastFmArtistDetailResult};

pub async fn process_lastfm_artist_detail_job(job: &Job) -> Result<Option<Value>, JobError> {
    let params: LastFmArtistDetailParams =
        serde_json::from_str(&job.parameters).map_err(|e| JobError::ProcessingFailed {
            reason: format!("invalid parameters: {}", e),
        })?;

    let artist_id = params.artist_id.clone();
    info!(
        "lastfm artist-detail starting for artist {} mbid={:?}",
        artist_id, params.mbid
    );

    let pool = database::connect()
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("db connect: {}", e),
        })?;

    let row = sqlx::query!(
        r#"SELECT name as "name!", deleted_at FROM artistz WHERE id = ?"#,
        artist_id
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| JobError::ProcessingFailed {
        reason: format!("read artist: {}", e),
    })?;

    let name = match row {
        Some(r) if r.deleted_at.is_none() => r.name,
        _ => {
            return Err(JobError::ProcessingFailed {
                reason: format!("artist {} not found or deleted", artist_id),
            });
        }
    };
    let name = params.artist_override.clone().unwrap_or(name);

    let cfg = config::get_config();
    let client = match LastFmClient::new(cfg.lastfm.clone()) {
        Ok(c) => c,
        Err(e) => {
            // last.fm not configured: bail cleanly with an empty result
            // instead of an error so we don't loop on retries.
            info!(
                "lastfm artist-detail skipped for {}: {} (treating as no-op)",
                artist_id, e
            );
            let result = LastFmArtistDetailResult {
                artist_id: artist_id.clone(),
                artist_fetched: false,
                tag_count: 0,
                similar_count: 0,
                related_upserted: 0,
            };
            return serde_json::to_value(&result).map(Some).map_err(|e| {
                JobError::ProcessingFailed {
                    reason: format!("serialize result: {}", e),
                }
            });
        }
    };

    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let mut snapshot = ArtistLastFmMetadata {
        fetched_at: Some(now),
        ..Default::default()
    };

    crate::jobs::rate_limit::acquire(crate::jobs::rate_limit::Source::Lastfm).await;
    let resp = client.artist_get_info(&name, params.mbid.as_deref()).await;

    let (artist_fetched, similar_refs): (bool, Vec<LastFmSimilarArtistRef>) = if resp.success {
        if let Some(info) = resp.data {
            let mapped = map_artist(info);
            let similar = mapped.similar.clone();
            snapshot.artist = Some(mapped);
            (true, similar)
        } else {
            (false, Vec::new())
        }
    } else {
        warn!("lastfm artist.getInfo failed: {}", resp.message);
        snapshot.error = Some(format!("artist.getInfo: {}", resp.message));
        (false, Vec::new())
    };

    let tag_count = snapshot
        .artist
        .as_ref()
        .map(|a| a.tags.len() as u64)
        .unwrap_or(0);
    let similar_count = similar_refs.len() as u64;

    // persist artist snapshot first (always, even on error).
    let patch = json!({ "lastfm": snapshot });
    let merge_resp = artists_repo::merge_artist_metadata(&artist_id, &patch).await;
    if !merge_resp.success {
        return Err(JobError::ProcessingFailed {
            reason: format!("artist metadata merge failed: {}", merge_resp.message),
        });
    }

    // upsert each similar artist as a related row. lastfm's
    // `artist.getInfo.similar` doesn't carry mbid or a numeric match
    // score; the dedicated `artist.getSimilar?limit=50` endpoint does
    // and is a future enrichment.
    let mut related_upserted: u64 = 0;
    for sim in similar_refs.into_iter() {
        if sim.name.trim().is_empty() {
            continue;
        }
        let external_urls = sim
            .url
            .as_ref()
            .map(|u| {
                vec![crate::music::entities::related_artists::ExternalUrl {
                    name: "last.fm".to_string(),
                    url: u.clone(),
                }]
            })
            .unwrap_or_default();
        let payload = UpsertRelatedArtist {
            source_artist_id: artist_id.clone(),
            related_name: sim.name,
            related_mbid: None,
            source: RelatedArtistSource::Lastfm,
            match_score: None,
            bandcamp_url: None,
            bandcamp_albums: Vec::new(),
            image_url: None,
            external_urls,
            fetched_at: now,
        };
        let r = upsert_related_artist(payload).await;
        if r.success {
            related_upserted += 1;
        } else {
            warn!(
                "lastfm related upsert failed for artist {}: {}",
                artist_id, r.message
            );
        }
    }

    info!(
        "lastfm artist-detail complete for {}: fetched={} tags={} similar={} related_upserted={}",
        artist_id, artist_fetched, tag_count, similar_count, related_upserted
    );

    let result = LastFmArtistDetailResult {
        artist_id,
        artist_fetched,
        tag_count,
        similar_count,
        related_upserted,
    };

    Ok(Some(serde_json::to_value(result).map_err(|e| {
        JobError::ProcessingFailed {
            reason: format!("serialize result: {}", e),
        }
    })?))
}

fn map_artist(info: LastFmArtistInfo) -> LastFmArtistSnapshot {
    let tags = info
        .tags
        .map(|w| {
            w.tag
                .into_iter()
                .map(|t| LastFmTagRef {
                    name: t.name,
                    url: t.url,
                })
                .collect()
        })
        .unwrap_or_default();
    let similar = info
        .similar
        .map(|w| {
            w.artist
                .into_iter()
                .map(|a| LastFmSimilarArtistRef {
                    name: a.name,
                    url: a.url,
                })
                .collect()
        })
        .unwrap_or_default();
    let (listeners, playcount) = info
        .stats
        .map(|s| (s.listeners, s.playcount))
        .unwrap_or((None, None));
    let (bio_summary, bio_published) = info
        .bio
        .map(|b| (b.summary, b.published))
        .unwrap_or((None, None));
    LastFmArtistSnapshot {
        name: info.name,
        mbid: info.mbid,
        url: info.url,
        listeners,
        playcount,
        tags,
        similar,
        bio_summary,
        bio_published,
    }
}
