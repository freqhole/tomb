//! shared image-payload resolution for every sync route.

use crate::error::GrimoireResult;
use crate::media_blobz::{create_media_blob, BlobType, CreateMediaBlobRequest};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock, Weak};

use super::models::SyncImageRef;

type ArtistImageLock = tokio::sync::Mutex<()>;
static ARTIST_IMAGE_LOCKS: OnceLock<Mutex<HashMap<String, Weak<ArtistImageLock>>>> =
    OnceLock::new();

fn artist_image_lock(artist_id: &str) -> Arc<ArtistImageLock> {
    let mut locks = ARTIST_IMAGE_LOCKS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(artist_id).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(ArtistImageLock::new(()));
    locks.insert(artist_id.to_string(), Arc::downgrade(&lock));
    lock
}

pub(super) async fn sync_artist_images(
    artist_id: &str,
    images: &[SyncImageRef],
    source_node_id: &str,
) -> (i64, Vec<String>) {
    if images.is_empty() {
        return (0, Vec::new());
    }
    let lock = artist_image_lock(artist_id);
    let _guard = lock.lock().await;
    let mut linked = 0;
    let mut missing = Vec::new();
    let has_primary = images.iter().any(|img| img.is_primary);
    for (idx, img) in images.iter().enumerate() {
        // artist images are independent artwork: the source's derived blob
        // parent isn't part of this request, just as with an image upload.
        let mut artwork = img.clone();
        artwork.blob_type = Some("original".to_string());
        let blob_id = match resolve_sync_image_ref(
            &artwork,
            source_node_id,
            &format!("artist-{artist_id}-{idx}"),
            None,
        )
        .await
        {
            Ok(Some(id)) => id,
            Ok(None) => {
                missing.push(img.blake3.clone());
                continue;
            }
            Err(error) => {
                tracing::warn!(artist_id, blake3 = %img.blake3, %error, "failed to import artist image");
                missing.push(img.blake3.clone());
                continue;
            }
        };
        let is_primary = img.is_primary || (!has_primary && idx == 0);
        let result = crate::music::entities::artists::add_artist_image(
            artist_id, &blob_id, is_primary, None,
        )
        .await;
        if result.success {
            linked += 1;
        } else {
            tracing::warn!(artist_id, blake3 = %img.blake3, error = %result.message, "failed to link artist image");
            missing.push(img.blake3.clone());
        }
    }
    (linked, missing)
}

/// resolve a `SyncImageRef` to a media_blob id.
///
/// 1. already-local shortcut: dedupe by blake3 against anything this
///    instance already has, no network involved.
/// 2. otherwise, pull the blob from `source_node_id` via the same
///    iroh-blobs verified-streaming mechanism as the main audio/video blob
///    (small enough to hold in memory - these are images, not media files).
///    a pull failure (peer unreachable, blob genuinely gone, etc) is
///    recorded as "missing" rather than failing the whole sync - a missing
///    thumbnail/cover shouldn't block the entity it belongs to from syncing.
///
/// `parent_blob_id` is required for non-`Original` blob types (e.g. waveforms,
/// thumbnails, previews) — the schema CHECK constraint enforces that derived
/// blobs carry a pointer to their source. for song-image sync, this should be
/// the just-pulled audio blob's id. ignored for `Original` blobs.
pub(super) async fn resolve_sync_image_ref(
    img: &SyncImageRef,
    source_node_id: &str,
    name_prefix: &str,
    parent_blob_id: Option<&str>,
) -> GrimoireResult<Option<String>> {
    // 1. already-local shortcut - no reason to re-pull bytes we already have.
    if let Ok(existing) = crate::media_blobz::get_media_blob_by_blake3(&img.blake3).await {
        return Ok(Some(existing.id));
    }

    // a queued image can legitimately name this same instance as its own
    // source (see `is_self_peer`'s doc comment) - if we don't have it
    // locally (checked above), there's truly nothing else to pull.
    if crate::federation::p2p_client::is_self_peer(source_node_id) {
        tracing::debug!(
            "resolve_sync_image_ref: {} is self-peer and blake3 {} isn't local - skipping (not fatal)",
            name_prefix,
            &img.blake3[..16.min(img.blake3.len())],
        );
        return Ok(None);
    }

    let bytes = match crate::federation::p2p_client::fetch_blob_verified_with_ensure(
        source_node_id,
        &img.blake3,
    )
    .await
    {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!(
                "resolve_sync_image_ref: failed to pull image blake3={} for {} from {}: {} (skipped, not fatal)",
                &img.blake3[..16.min(img.blake3.len())],
                name_prefix,
                &source_node_id[..16.min(source_node_id.len())],
                e,
            );
            return Ok(None);
        }
    };

    let resolved_blob_type = match img.blob_type.as_deref() {
        Some("thumbnail") => BlobType::Thumbnail,
        Some("waveform") => BlobType::Waveform,
        Some("preview") => BlobType::Preview,
        _ => BlobType::Original,
    };
    if reliquary::hash_bytes(&bytes) != img.blake3 {
        return Err(crate::error::GrimoireError::Validation {
            field: "blake3".to_string(),
            message: "content hash does not match image bytes".to_string(),
        });
    }
    let (bytes, mime_type) = if resolved_blob_type == BlobType::Original {
        crate::offal::upload::mime::normalize_image_upload(bytes, &img.mime_type).await?
    } else {
        (
            crate::offal::upload::mime::validate_image_bytes(bytes, &img.mime_type).await?,
            img.mime_type.clone(),
        )
    };
    let blake3 = reliquary::hash_bytes(&bytes);
    // non-original blobs must carry parent_blob_id (db CHECK constraint).
    // original blobs must NOT carry one. callers without a parent for a
    // derived blob get a clear error rather than a CHECK constraint panic
    // surfaced as opaque sqlite text.
    let parent_for_create = match resolved_blob_type {
        BlobType::Original => None,
        _ => match parent_blob_id {
            Some(p) => Some(p.to_string()),
            None => {
                return Err(crate::error::GrimoireError::ProcessingFailed {
                    message: format!(
                        "non-original image (blob_type={:?}) for {} requires a parent_blob_id",
                        resolved_blob_type, name_prefix
                    ),
                });
            }
        },
    };
    let ext = crate::offal::upload::detect_extension(&mime_type, "");
    let blob = create_media_blob(CreateMediaBlobRequest {
        size: Some(bytes.len() as i64),
        mime: Some(mime_type),
        source_client_id: None,
        local_path: None,
        filename: Some(format!("{}.{}", name_prefix, ext)),
        parent_blob_id: parent_for_create,
        blob_type: Some(resolved_blob_type),
        metadata: serde_json::json!({}),
        created_by: None,
        data: Some(crate::Bytes(bytes)),
        width: None,
        height: None,
        blake3: Some(blake3),
        delete_duplicate_local_path: false,
    })
    .await?;
    Ok(Some(blob.id))
}

#[cfg(test)]
mod tests {
    use crate::offal::caller::Caller;
    use crate::offal::sync::{sync_album, sync_song_by_blake3_impl, SyncSongByBlake3Request};

    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singleton"]
    async fn artist_images_sync_for_existing_songs_and_albums() {
        let tmp = tempfile::tempdir().unwrap();
        let config = tmp.path().join("freqhole-config.toml");
        std::fs::write(
            &config,
            format!(
                "data_dir = \"{}\"\n[database]\nfilename = \"grimoire.db\"\n\
                 [media]\nmax_fs_file_size = 104857600\nsupported_audio_formats = [\"mp3\", \"flac\"]\n\
                 [musicbrainz]\nenabled = false\n[logging]\nlevel = \"warn\"\n",
                tmp.path().display()
            ),
        )
        .unwrap();
        std::fs::write(tmp.path().join("grimoire.db"), b"").unwrap();
        crate::config::init_config(Some(config)).unwrap();
        crate::database::run_migrations().await.unwrap();
        let pool = crate::database::connect().await.unwrap();
        sqlx::query("INSERT INTO artistz (id, name) VALUES ('artist-a', 'artist a'), ('artist-b', 'artist b')")
            .execute(&pool).await.unwrap();
        let audio_hash = "a".repeat(64);
        let image_hash = "b".repeat(64);
        sqlx::query("INSERT INTO media_blobz (id, size, mime, blob_type, blake3, local_path) VALUES ('audio-id', 1, 'audio/mpeg', 'original', ?, 'audio.mp3'), ('image-id', 1, 'image/png', 'original', ?, NULL)")
            .bind(&audio_hash).bind(&image_hash).execute(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO songz (id, media_blob_id, media_blob_blake3, title) VALUES ('song-id', 'audio-id', ?, 'song')",
        )
        .bind(&audio_hash)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO artist_songz (artist_id, song_id) VALUES ('artist-b', 'song-id')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO media_blobz (id, size, mime, blob_type, parent_blob_id) VALUES ('wave-id', 1, 'image/png', 'waveform', 'audio-id')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO song_imagez (song_id, media_blob_id, is_primary) VALUES ('song-id', 'wave-id', 0)")
            .execute(&pool).await.unwrap();

        let caller = Caller::new("user", "user", crate::users::UserRole::Member);
        let image = serde_json::json!({
            "blake3": image_hash, "mime_type": "image/png",
            "is_primary": true, "blob_type": "thumbnail"
        });
        let song: SyncSongByBlake3Request = serde_json::from_value(serde_json::json!({
            "blake3": audio_hash, "filename": "song.mp3", "source_node_id": "unavailable",
            "remote_name": "source", "title": "song", "artist_name": "artist a",
            "album_title": "album", "track_number": 1, "disc_number": 1,
            "artist_images": [image.clone()]
        }))
        .unwrap();
        let first = sync_song_by_blake3_impl(&caller, song.clone(), None).await;
        assert!(first.success, "{}", first.message);
        let result = first.data.unwrap();
        assert_eq!(result["artist_id"], "artist-a");
        assert_eq!(result["images_linked"], 1);
        assert_eq!(result["missing_image_blake3s"], serde_json::json!([]));

        let album = serde_json::json!({
            "source_node_id": "unavailable", "remote_album_id": "album",
            "title": "album", "artist_name": "artist a", "remote_name": "source",
            "artist_images": [image]
        });
        let (song_retry, album_retry) = tokio::join!(
            sync_song_by_blake3_impl(&caller, song, None),
            sync_album(&caller, album)
        );
        assert!(song_retry.success, "{}", song_retry.message);
        assert!(album_retry.success, "{}", album_retry.message);
        assert_eq!(album_retry.data.unwrap()["images_linked"], 1);
        let links: Vec<(String, String, i64)> = sqlx::query_as(
            "SELECT artist_id, media_blob_id, is_primary FROM artist_imagez ORDER BY artist_id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(links, vec![("artist-a".into(), "image-id".into(), 1)]);

        let missing_hash = "c".repeat(64);
        let missing = sync_album(
            &caller,
            serde_json::json!({
                "source_node_id": "unavailable", "remote_album_id": "album",
                "title": "album", "artist_name": "artist a", "remote_name": "source",
                "artist_images": [{
                    "blake3": missing_hash, "mime_type": "image/png",
                    "is_primary": false, "blob_type": "original"
                }]
            }),
        )
        .await;
        assert!(missing.success, "{}", missing.message);
        let data = missing.data.unwrap();
        assert_eq!(data["images_linked"], 0);
        assert_eq!(
            data["missing_image_blake3s"],
            serde_json::json!([missing_hash])
        );
    }
}
