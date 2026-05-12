//! last.fm album-detail job processor (phase 13)
//!
//! one job per album. fetches:
//!   - `album.getInfo` (artist+album or mbid) — wiki summary, top tags
//!   - `artist.getInfo` (artist or artist mbid) — bio, similar artists
//!
//! results are persisted into `albums.metadata.lastfm.*` via
//! `albums_repo::merge_album_metadata` so the writes stay centralized and
//! parallel jobs touching unrelated sub-trees compose cleanly.
//!
//! errors do NOT flip `mb_lookup_status` — last.fm enrichment is a
//! sideshow, never gates the MB lifecycle. on api failure we still write
//! a `LastFmMetadata { error, fetched_at }` so the ui can surface it.

use crate::config;
use crate::database;
use crate::jobs::models::{Job, JobError};
use crate::music::entities::albums as albums_repo;
use crate::music::entities::albums::metadata::{
    self, LastFmAlbumSnapshot, LastFmArtistSnapshot, LastFmMetadata, LastFmSimilarArtistRef,
    LastFmTagRef,
};
use crate::music::lastfm::models::{LastFmAlbumInfo, LastFmArtistInfo};
use crate::music::lastfm::LastFmClient;
use serde_json::Value;
use tracing::{info, warn};

use super::models::{LastFmAlbumDetailParams, LastFmAlbumDetailResult};

pub async fn process_lastfm_album_detail_job(job: &Job) -> Result<Option<Value>, JobError> {
    let params: LastFmAlbumDetailParams =
        serde_json::from_str(&job.parameters).map_err(|e| JobError::ProcessingFailed {
            reason: format!("invalid parameters: {}", e),
        })?;

    let album_id = params.album_id.clone();
    info!(
        "lastfm album-detail starting for album {} mbid={:?}",
        album_id, params.mbid
    );

    // read album title + primary artist
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

    let title = match row {
        Some(r) if r.deleted_at.is_none() => r.title,
        _ => {
            return Err(JobError::ProcessingFailed {
                reason: format!("album {} not found or deleted", album_id),
            });
        }
    };
    // requery overrides win over db-derived values (phase 14.5).
    let title = params.title_override.clone().unwrap_or(title);

    let artist_name: Option<String> = sqlx::query_scalar!(
        r#"SELECT art.name FROM artist_albumz aa
           JOIN artistz art ON art.id = aa.artist_id
           WHERE aa.album_id = ?
           LIMIT 1"#,
        album_id
    )
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();
    let artist_name = params.artist_override.clone().or(artist_name);

    // build client (env-var fallback handled inside `LastFmClient::new`)
    let cfg = config::get_config();
    let client = match LastFmClient::new(cfg.lastfm.clone()) {
        Ok(c) => c,
        Err(e) => {
            return Err(JobError::ProcessingFailed {
                reason: format!("last.fm client unavailable: {}", e),
            });
        }
    };

    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let mut snapshot = LastFmMetadata {
        fetched_at: Some(now),
        ..Default::default()
    };

    let artist_for_query = artist_name.clone().unwrap_or_default();

    // step 1: album.getInfo
    crate::jobs::rate_limit::acquire(crate::jobs::rate_limit::Source::Lastfm).await;
    let album_resp = client
        .album_get_info(&artist_for_query, &title, params.mbid.as_deref())
        .await;
    let album_fetched = if album_resp.success {
        if let Some(info) = album_resp.data {
            snapshot.album = Some(map_album(info));
        }
        true
    } else {
        warn!("lastfm album.getInfo failed: {}", album_resp.message);
        snapshot.error = Some(format!("album.getInfo: {}", album_resp.message));
        false
    };

    // step 2: artist.getInfo (only if we have an artist name to query with)
    let artist_fetched = if !artist_for_query.is_empty() {
        // re-use mbid from album response if present, otherwise none
        let artist_mbid_hint = snapshot.album.as_ref().and_then(|a| a.mbid.clone());
        crate::jobs::rate_limit::acquire(crate::jobs::rate_limit::Source::Lastfm).await;
        let resp = client
            .artist_get_info(&artist_for_query, artist_mbid_hint.as_deref())
            .await;
        if resp.success {
            if let Some(info) = resp.data {
                snapshot.artist = Some(map_artist(info));
            }
            true
        } else {
            warn!("lastfm artist.getInfo failed: {}", resp.message);
            // append to error string but don't overwrite existing one
            let prev = snapshot.error.take().unwrap_or_default();
            let new_err = if prev.is_empty() {
                format!("artist.getInfo: {}", resp.message)
            } else {
                format!("{}; artist.getInfo: {}", prev, resp.message)
            };
            snapshot.error = Some(new_err);
            false
        }
    } else {
        info!(
            "lastfm: skipping artist.getInfo for album {} (no primary artist)",
            album_id
        );
        false
    };

    let album_tag_count = snapshot
        .album
        .as_ref()
        .map(|a| a.tags.len() as u64)
        .unwrap_or(0);
    let artist_tag_count = snapshot
        .artist
        .as_ref()
        .map(|a| a.tags.len() as u64)
        .unwrap_or(0);
    let similar_artist_count = snapshot
        .artist
        .as_ref()
        .map(|a| a.similar.len() as u64)
        .unwrap_or(0);

    // persist snapshot (always — even on error, so the ui can surface it)
    let patch = metadata::patch_lastfm(&snapshot);
    let merge_resp = albums_repo::merge_album_metadata(&album_id, &patch).await;
    if !merge_resp.success {
        return Err(JobError::ProcessingFailed {
            reason: format!("metadata merge failed: {}", merge_resp.message),
        });
    }

    info!(
        "lastfm album-detail complete for {}: album_tags={} artist_tags={} similar={}",
        album_id, album_tag_count, artist_tag_count, similar_artist_count
    );

    let result = LastFmAlbumDetailResult {
        album_id: album_id.clone(),
        album_fetched,
        artist_fetched,
        album_tag_count,
        artist_tag_count,
        similar_artist_count,
    };

    Ok(Some(serde_json::to_value(result).map_err(|e| {
        JobError::ProcessingFailed {
            reason: format!("serialize result: {}", e),
        }
    })?))
}

fn map_album(info: LastFmAlbumInfo) -> LastFmAlbumSnapshot {
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
    let (wiki_summary, wiki_published) = info
        .wiki
        .map(|w| (w.summary, w.published))
        .unwrap_or((None, None));
    LastFmAlbumSnapshot {
        name: info.name,
        artist: info.artist,
        mbid: info.mbid,
        url: info.url,
        listeners: info.listeners,
        playcount: info.playcount,
        tags,
        wiki_summary,
        wiki_published,
    }
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
