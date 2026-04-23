//! album art resolution for the now-playing display.
//!
//! given a song id, picks the best image to show by walking a fallback chain:
//!
//! 1. song's non-waveform images (prefer `is_primary = 1`)
//! 2. album's primary image
//! 3. artist's primary image
//! 4. song's waveform image
//! 5. nothing — caller shows a placeholder
//!
//! the resulting bytes are wrapped in `Arc` so the broadcaster can fan them
//! out across many listeners without copying.

use crate::database;
use crate::error::GrimoireResult;
use crate::media_blobz::get_media_blob_with_data;
use std::sync::Arc;
use tracing::{debug, warn};

/// hard cap on art payload. anything larger and we skip to the next chain step
/// — the control message is sent on every track change, so we want it small.
/// at 256 kB raw, base64-encoded inline json is ~340 kB, still fine.
pub const MAX_ART_BYTES: usize = 256 * 1024;

/// resolved art for one track. `bytes` is `Arc`-wrapped because every listener
/// receives the same image; we encode once per track and clone the Arc.
#[derive(Debug, Clone)]
pub struct ResolvedArt {
    pub blob_id: String,
    pub mime: String,
    pub bytes: Arc<Vec<u8>>,
}

/// run the fallback chain for `song_id`. returns `Ok(None)` if no usable image
/// was found anywhere in the chain (rare but valid — empty libraries, songs
/// with no metadata at all).
pub async fn resolve_track_art(song_id: &str) -> GrimoireResult<Option<ResolvedArt>> {
    // step 1: song's non-waveform image (primary first, then any)
    if let Some(art) = try_song_non_waveform(song_id).await? {
        return Ok(Some(art));
    }

    // step 2 + 3: walk up to album then artist
    let pool = database::connect().await?;
    let album_id: Option<String> =
        sqlx::query_scalar!("SELECT album_id FROM album_songz WHERE song_id = ?", song_id)
            .fetch_optional(&pool)
            .await?;

    if let Some(aid) = album_id.as_deref() {
        if let Some(art) = try_album(aid).await? {
            return Ok(Some(art));
        }
    }

    let artist_id: Option<String> =
        sqlx::query_scalar!("SELECT artist_id FROM artist_songz WHERE song_id = ?", song_id)
            .fetch_optional(&pool)
            .await?;

    if let Some(aid) = artist_id.as_deref() {
        if let Some(art) = try_artist(aid).await? {
            return Ok(Some(art));
        }
    }

    // step 4: song waveform as last resort (better than nothing visually)
    if let Some(art) = try_song_waveform(song_id).await? {
        return Ok(Some(art));
    }

    debug!("[radio-art] no art found for song {song_id}");
    Ok(None)
}

async fn try_song_non_waveform(song_id: &str) -> GrimoireResult<Option<ResolvedArt>> {
    let pool = database::connect().await?;
    let row = sqlx::query!(
        "SELECT si.media_blob_id
         FROM song_imagez si
         JOIN media_blobz mb ON mb.id = si.media_blob_id
         WHERE si.song_id = ?
           AND mb.blob_type != 'waveform'
           AND mb.deleted_at IS NULL
         ORDER BY si.is_primary DESC
         LIMIT 1",
        song_id
    )
    .fetch_optional(&pool)
    .await?;

    match row.map(|r| r.media_blob_id) {
        Some(blob_id) => fetch_blob_as_art(&blob_id).await,
        None => Ok(None),
    }
}

async fn try_song_waveform(song_id: &str) -> GrimoireResult<Option<ResolvedArt>> {
    let pool = database::connect().await?;
    let row = sqlx::query!(
        "SELECT si.media_blob_id
         FROM song_imagez si
         JOIN media_blobz mb ON mb.id = si.media_blob_id
         WHERE si.song_id = ?
           AND mb.blob_type = 'waveform'
           AND mb.deleted_at IS NULL
         LIMIT 1",
        song_id
    )
    .fetch_optional(&pool)
    .await?;

    match row.map(|r| r.media_blob_id) {
        Some(blob_id) => fetch_blob_as_art(&blob_id).await,
        None => Ok(None),
    }
}

async fn try_album(album_id: &str) -> GrimoireResult<Option<ResolvedArt>> {
    let pool = database::connect().await?;
    let row = sqlx::query!(
        "SELECT ai.media_blob_id
         FROM album_imagez ai
         JOIN media_blobz mb ON mb.id = ai.media_blob_id
         WHERE ai.album_id = ?
           AND mb.blob_type != 'waveform'
           AND mb.deleted_at IS NULL
         ORDER BY ai.is_primary DESC
         LIMIT 1",
        album_id
    )
    .fetch_optional(&pool)
    .await?;

    match row.map(|r| r.media_blob_id) {
        Some(blob_id) => fetch_blob_as_art(&blob_id).await,
        None => Ok(None),
    }
}

async fn try_artist(artist_id: &str) -> GrimoireResult<Option<ResolvedArt>> {
    let pool = database::connect().await?;
    let row = sqlx::query!(
        "SELECT ai.media_blob_id
         FROM artist_imagez ai
         JOIN media_blobz mb ON mb.id = ai.media_blob_id
         WHERE ai.artist_id = ?
           AND mb.blob_type != 'waveform'
           AND mb.deleted_at IS NULL
         ORDER BY ai.is_primary DESC
         LIMIT 1",
        artist_id
    )
    .fetch_optional(&pool)
    .await?;

    match row.map(|r| r.media_blob_id) {
        Some(blob_id) => fetch_blob_as_art(&blob_id).await,
        None => Ok(None),
    }
}

/// fetch raw bytes for a blob. handles both filesystem (`local_path`) and
/// `blob_data` table storage. returns `None` if the blob exceeds
/// [`MAX_ART_BYTES`] so the caller can fall through to the next chain step.
async fn fetch_blob_as_art(blob_id: &str) -> GrimoireResult<Option<ResolvedArt>> {
    let (blob, maybe_data) = match get_media_blob_with_data(blob_id).await {
        Ok(t) => t,
        Err(e) => {
            warn!("[radio-art] failed to fetch blob {blob_id}: {e}");
            return Ok(None);
        }
    };

    let bytes = match maybe_data {
        Some(b) => b,
        None => {
            // blob lives on the filesystem
            let path = match blob.local_path.as_deref() {
                Some(p) => p,
                None => {
                    warn!("[radio-art] blob {blob_id} has neither blob_data nor local_path");
                    return Ok(None);
                }
            };
            match tokio::fs::read(path).await {
                Ok(b) => b,
                Err(e) => {
                    warn!("[radio-art] failed to read art file {path}: {e}");
                    return Ok(None);
                }
            }
        }
    };

    if bytes.len() > MAX_ART_BYTES {
        debug!(
            "[radio-art] blob {blob_id} too large ({} bytes > {MAX_ART_BYTES}); falling through",
            bytes.len()
        );
        return Ok(None);
    }

    let mime = blob
        .mime
        .clone()
        .filter(|m: &String| !m.is_empty())
        .unwrap_or_else(|| "image/webp".to_string());

    Ok(Some(ResolvedArt {
        blob_id: blob.id,
        mime,
        bytes: Arc::new(bytes),
    }))
}
