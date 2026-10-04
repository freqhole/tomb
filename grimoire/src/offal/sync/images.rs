//! shared image-payload resolution for every sync route.

use crate::error::GrimoireResult;
use crate::media_blobz::{create_media_blob, BlobType, CreateMediaBlobRequest};

use super::models::SyncImageRef;

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
    let ext = crate::offal::upload::detect_extension(&img.mime_type, "");
    let blob = create_media_blob(CreateMediaBlobRequest {
        sha256: None,
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
        blake3: Some(img.blake3.clone()),
        delete_duplicate_local_path: false,
    })
    .await?;
    Ok(Some(blob.id))
}
