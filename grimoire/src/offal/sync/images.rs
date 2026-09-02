//! shared image-payload resolution for every sync route.

use base64::Engine;
use sha2::{Digest, Sha256};

use crate::error::{GrimoireError, GrimoireResult};
use crate::media_blobz::{create_media_blob, BlobType, CreateMediaBlobRequest};

use super::models::SyncImageRef;

/// resolve a `SyncImageRef` to a media_blob id.
///
/// - inline `data_base64`: decode, verify sha256 matches `content_sha256`,
///   then create the blob (or dedupe to an existing one). returns `Ok(Some(id))`.
/// - omitted `data_base64`: look up an existing blob by sha256.
///     - found → `Ok(Some(id))`.
///     - missing → `Ok(None)` (caller treats as "skipped, not fatal").
/// - decode/hash mismatch → `Err`.
///
/// `parent_blob_id` is required for non-`Original` blob types (e.g. waveforms,
/// thumbnails, previews) — the schema CHECK constraint enforces that derived
/// blobs carry a pointer to their source. for song-image sync, this should be
/// the just-pulled audio blob's id. ignored for `Original` blobs.
pub(super) async fn resolve_sync_image_ref(
    img: &SyncImageRef,
    name_prefix: &str,
    parent_blob_id: Option<&str>,
) -> GrimoireResult<Option<String>> {
    if let Some(data_b64) = &img.data_base64 {
        // inline path: decode, verify, create-or-dedupe
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data_b64)
            .map_err(|e| GrimoireError::ProcessingFailed {
                message: format!("invalid base64 image data for {}: {}", name_prefix, e),
            })?;

        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let computed = format!("{:x}", hasher.finalize());
        if computed != img.content_sha256 {
            return Err(GrimoireError::ProcessingFailed {
                message: format!(
                    "image sha256 mismatch for {}: claimed {}, computed {}",
                    name_prefix, img.content_sha256, computed
                ),
            });
        }

        let resolved_blob_type = match img.blob_type.as_deref() {
            Some("thumbnail") => BlobType::Thumbnail,
            Some("waveform") => BlobType::Waveform,
            Some("preview") => BlobType::Preview,
            _ => BlobType::Original,
        };
        // non-original blobs must carry parent_blob_id (db CHECK constraint).
        // original blobs must NOT carry one. callers without a parent for a
        // derived blob get a clear error rather than a CHECK constraint panic
        // surfaced as opaque sqlite text.
        let parent_for_create = match resolved_blob_type {
            BlobType::Original => None,
            _ => match parent_blob_id {
                Some(p) => Some(p.to_string()),
                None => {
                    return Err(GrimoireError::ProcessingFailed {
                        message: format!(
                            "non-original image (blob_type={:?}) for {} requires a parent_blob_id",
                            resolved_blob_type, name_prefix
                        ),
                    });
                }
            },
        };
        // dedupe via create_media_blob (sha256 unique constraint)
        let ext = crate::offal::upload::detect_extension(&img.mime_type, "");
        let blob = create_media_blob(CreateMediaBlobRequest {
            sha256: img.content_sha256.clone(),
            size: Some(bytes.len() as i64),
            mime: Some(img.mime_type.clone()),
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
            blake3: None,
            delete_duplicate_local_path: false,
        })
        .await?;
        Ok(Some(blob.id))
    } else {
        // reference-only path: look up by sha256
        match crate::media_blobz::get_media_blob_by_sha256(&img.content_sha256).await {
            Ok(blob) => Ok(Some(blob.id)),
            Err(_) => Ok(None),
        }
    }
}
