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

use crate::blob_data::get_or_generate_thumbnail;
use crate::database;
use crate::error::GrimoireResult;
use crate::media_blobz::get_media_blob_with_data;
use crate::media_blobz::BlobType;
use crate::media_blobz::MediaBlob;
use std::sync::Arc;
use tracing::{debug, info, warn};

/// hard cap on art payload. anything larger and we skip to the next chain step
/// — the control message is sent on every track change, so we want it small.
/// at 2 MiB raw, base64-encoded inline json is ~2.7 MiB. this is still
/// acceptable for low-frequency track-change metadata while avoiding
/// unnecessary fallback on moderately large cover art.
pub const MAX_ART_BYTES: usize = 2 * 1024 * 1024;

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
    debug!("[radio-art] resolving art for song {song_id}");

    // step 1: song's non-waveform image (primary first, then any)
    if let Some(art) = try_song_non_waveform(song_id).await? {
        info!(
            "[radio-art] resolved from song image for song {song_id}: blob={} mime={} bytes={}",
            art.blob_id,
            art.mime,
            art.bytes.len()
        );
        return Ok(Some(art));
    }

    // step 2 + 3: walk up to album then artist
    let pool = database::connect().await?;
    let album_id: Option<String> = sqlx::query_scalar!(
        "SELECT album_id FROM album_songz WHERE song_id = ?",
        song_id
    )
    .fetch_optional(&pool)
    .await?;

    if let Some(aid) = album_id.as_deref() {
        if let Some(art) = try_album(aid).await? {
            info!(
                "[radio-art] resolved from album image for song {song_id} (album {aid}): blob={} mime={} bytes={}",
                art.blob_id,
                art.mime,
                art.bytes.len()
            );
            return Ok(Some(art));
        }
    }

    let artist_id: Option<String> = sqlx::query_scalar!(
        "SELECT artist_id FROM artist_songz WHERE song_id = ?",
        song_id
    )
    .fetch_optional(&pool)
    .await?;

    if let Some(aid) = artist_id.as_deref() {
        if let Some(art) = try_artist(aid).await? {
            info!(
                "[radio-art] resolved from artist image for song {song_id} (artist {aid}): blob={} mime={} bytes={}",
                art.blob_id,
                art.mime,
                art.bytes.len()
            );
            return Ok(Some(art));
        }
    }

    // step 4: song waveform as last resort (better than nothing visually)
    if let Some(art) = try_song_waveform(song_id).await? {
        info!(
            "[radio-art] resolved from waveform fallback for song {song_id}: blob={} mime={} bytes={}",
            art.blob_id,
            art.mime,
            art.bytes.len()
        );
        return Ok(Some(art));
    }

    debug!("[radio-art] no art found for song {song_id}");
    Ok(None)
}

async fn try_song_non_waveform(song_id: &str) -> GrimoireResult<Option<ResolvedArt>> {
    let pool = database::connect().await?;
    let rows = sqlx::query!(
        "SELECT si.media_blob_id
         FROM song_imagez si
         JOIN media_blobz mb ON mb.id = si.media_blob_id
         WHERE si.song_id = ?
           AND mb.blob_type != 'waveform'
           AND mb.deleted_at IS NULL
         ORDER BY si.is_primary DESC,
                  CASE mb.blob_type
                      WHEN 'thumbnail' THEN 0
                      WHEN 'preview' THEN 1
                      WHEN 'original' THEN 2
                      ELSE 3
                  END ASC",
        song_id
    )
    .fetch_all(&pool)
    .await?;

    first_usable_art(rows.into_iter().map(|r| r.media_blob_id)).await
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
    let rows = sqlx::query!(
        "SELECT ai.media_blob_id
         FROM album_imagez ai
         JOIN media_blobz mb ON mb.id = ai.media_blob_id
         WHERE ai.album_id = ?
           AND mb.blob_type != 'waveform'
           AND mb.deleted_at IS NULL
         ORDER BY ai.is_primary DESC,
                  CASE mb.blob_type
                      WHEN 'thumbnail' THEN 0
                      WHEN 'preview' THEN 1
                      WHEN 'original' THEN 2
                      ELSE 3
                  END ASC",
        album_id
    )
    .fetch_all(&pool)
    .await?;

    first_usable_art(rows.into_iter().map(|r| r.media_blob_id)).await
}

async fn try_artist(artist_id: &str) -> GrimoireResult<Option<ResolvedArt>> {
    let pool = database::connect().await?;
    let rows = sqlx::query!(
        "SELECT ai.media_blob_id
         FROM artist_imagez ai
         JOIN media_blobz mb ON mb.id = ai.media_blob_id
         WHERE ai.artist_id = ?
           AND mb.blob_type != 'waveform'
           AND mb.deleted_at IS NULL
         ORDER BY ai.is_primary DESC,
                  CASE mb.blob_type
                      WHEN 'thumbnail' THEN 0
                      WHEN 'preview' THEN 1
                      WHEN 'original' THEN 2
                      ELSE 3
                  END ASC",
        artist_id
    )
    .fetch_all(&pool)
    .await?;

    first_usable_art(rows.into_iter().map(|r| r.media_blob_id)).await
}

async fn first_usable_art<I>(blob_ids: I) -> GrimoireResult<Option<ResolvedArt>>
where
    I: IntoIterator<Item = String>,
{
    for blob_id in blob_ids {
        debug!("[radio-art] trying candidate blob {blob_id}");
        if let Some(art) = fetch_blob_as_art(&blob_id).await? {
            return Ok(Some(art));
        }
        debug!("[radio-art] candidate blob {blob_id} unusable, trying next");
    }

    Ok(None)
}

/// fetch raw bytes for a blob. handles both filesystem (`local_path`) and
/// `blob_data` table storage. returns `None` if the blob exceeds
/// [`MAX_ART_BYTES`] so the caller can fall through to the next chain step.
async fn fetch_blob_as_art(blob_id: &str) -> GrimoireResult<Option<ResolvedArt>> {
    let (blob, bytes) = match load_blob_and_bytes(blob_id).await? {
        Some(v) => v,
        None => return Ok(None),
    };

    if bytes.len() > MAX_ART_BYTES {
        info!(
            "[radio-art] blob {blob_id} too large ({} bytes > {MAX_ART_BYTES}); falling through",
            bytes.len()
        );

        // oversized originals/waveforms can still be turned into small
        // display-friendly art by using a generated thumbnail child.
        if blob.blob_type == BlobType::Original || blob.blob_type == BlobType::Waveform {
            match get_or_generate_thumbnail(&blob.id, 200, None).await {
                Ok(thumb_blob_id) if thumb_blob_id != blob.id => {
                    info!(
                        "[radio-art] trying thumbnail fallback for blob {blob_id}: thumb={thumb_blob_id}"
                    );
                    if let Some((thumb_blob, thumb_bytes)) =
                        load_blob_and_bytes(&thumb_blob_id).await?
                    {
                        if thumb_bytes.len() <= MAX_ART_BYTES {
                            let thumb_mime = thumb_blob
                                .mime
                                .clone()
                                .filter(|m: &String| !m.is_empty())
                                .unwrap_or_else(|| "image/webp".to_string());

                            return Ok(Some(ResolvedArt {
                                blob_id: thumb_blob.id,
                                mime: thumb_mime,
                                bytes: Arc::new(thumb_bytes),
                            }));
                        }
                        info!(
                            "[radio-art] thumbnail fallback blob {thumb_blob_id} also too large ({} bytes > {MAX_ART_BYTES})",
                            thumb_bytes.len()
                        );
                    }
                    info!(
                        "[radio-art] thumbnail fallback for blob {blob_id} was unusable, continuing"
                    );
                }
                Ok(_) => {
                    debug!(
                        "[radio-art] thumbnail fallback for blob {blob_id} returned parent blob id"
                    );
                }
                Err(e) => {
                    warn!("[radio-art] failed to generate/find thumbnail for blob {blob_id}: {e}");
                }
            }
        }

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

async fn load_blob_and_bytes(blob_id: &str) -> GrimoireResult<Option<(MediaBlob, Vec<u8>)>> {
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

    Ok(Some((blob, bytes)))
}
