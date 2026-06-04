//! sized thumbnail generation for images and waveforms
//!
//! generates square thumbnails from parent blobs with resize strategy based on source type:
//! - album art / regular images: center-crop (may lose edges)
//! - waveforms: squish (preserve all content, distort aspect ratio)
//!
//! thumbnail sizes are configurable via `media.thumbnail_sizes` (default: [50, 200])

use crate::blob_data::get_blob_data;
use crate::config;
use crate::database;
use crate::error::{ErrorDetail, GrimoireError, GrimoireResult};
use crate::media_blobz::{self, BlobType, CreateMediaBlobRequest, MediaBlob};
use crate::response::GrimoireResponse;
use image::{imageops::FilterType, DynamicImage, GenericImageView, ImageOutputFormat};
use sha2::{Digest, Sha256};
use std::io::Cursor;

/// default thumbnail sizes (used when config is unavailable)
pub const DEFAULT_THUMBNAIL_SIZES: &[u32] = &[50, 200];

/// get configured thumbnail sizes, falls back to defaults if config unavailable
pub fn get_thumbnail_sizes() -> Vec<u32> {
    if config::is_config_initialized() {
        config::get_config().media.thumbnail_sizes.clone()
    } else {
        DEFAULT_THUMBNAIL_SIZES.to_vec()
    }
}

/// check if on-demand thumbnail generation is enabled
pub fn is_on_demand_enabled() -> bool {
    if config::is_config_initialized() {
        config::get_config().media.thumbnail_on_demand_enabled
    } else {
        false
    }
}

/// check if a size is valid (in configured sizes)
pub fn is_valid_size(size: u32) -> bool {
    get_thumbnail_sizes().contains(&size)
}

/// resize strategy for thumbnails
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResizeMode {
    /// center-crop to square (for album art - preserves detail, may lose edges)
    CenterCrop,
    /// squish to square (for waveforms - preserves all content, distorts aspect ratio)
    Squish,
}

impl ResizeMode {
    /// determine resize mode from blob type
    pub fn from_blob_type(blob_type: &BlobType) -> Self {
        match blob_type {
            BlobType::Waveform => ResizeMode::Squish,
            _ => ResizeMode::CenterCrop,
        }
    }
}

/// generated thumbnail result
#[derive(Debug)]
pub struct GeneratedThumbnail {
    pub blob_id: String,
    pub width: u32,
    pub height: u32,
}

/// resize an image to a square using the specified mode
fn resize_to_square(img: &DynamicImage, size: u32, mode: ResizeMode) -> DynamicImage {
    match mode {
        ResizeMode::CenterCrop => {
            // center-crop: take the largest centered square, then resize
            let (w, h) = img.dimensions();
            let square_size = w.min(h);
            let x = (w - square_size) / 2;
            let y = (h - square_size) / 2;
            let cropped = img.crop_imm(x, y, square_size, square_size);
            cropped.resize_exact(size, size, FilterType::Lanczos3)
        }
        ResizeMode::Squish => {
            // squish: resize directly to square (distorts aspect ratio)
            img.resize_exact(size, size, FilterType::Lanczos3)
        }
    }
}

/// convert image to webp bytes
fn image_to_webp(img: &DynamicImage) -> GrimoireResult<Vec<u8>> {
    let mut webp_data = Vec::new();
    let mut cursor = Cursor::new(&mut webp_data);
    img.write_to(&mut cursor, ImageOutputFormat::WebP)
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to encode webp: {}", e),
        })?;
    Ok(webp_data)
}

/// resize image data to a square webp of the specified size
///
/// uses center-crop to preserve the most important part of the image
/// (cuts edges rather than distorting aspect ratio)
///
/// # arguments
/// * `image_data` - raw image bytes (any format supported by `image` crate)
/// * `size` - target width and height in pixels
///
/// # returns
/// webp-encoded bytes of the resized square image
pub fn resize_to_square_webp(image_data: &[u8], size: u32) -> GrimoireResult<Vec<u8>> {
    let img = image::load_from_memory(image_data).map_err(|e| GrimoireError::ProcessingFailed {
        message: format!("failed to decode image: {}", e),
    })?;
    let resized = resize_to_square(&img, size, ResizeMode::CenterCrop);
    image_to_webp(&resized)
}

/// decode image bytes, downscale so that the longer edge is at most
/// `max_dim` pixels (preserving aspect ratio; never upscales), and
/// encode as webp. returns (webp_bytes, width, height) of the result.
///
/// used at ingest time to normalize remote/user-provided art into a
/// reasonably-sized webp original so we don't persist multi-megabyte
/// jpegs from sources like cover art archive.
pub fn resize_to_max_dim_webp(
    image_data: &[u8],
    max_dim: u32,
) -> GrimoireResult<(Vec<u8>, u32, u32)> {
    let img = image::load_from_memory(image_data).map_err(|e| GrimoireError::ProcessingFailed {
        message: format!("failed to decode image: {}", e),
    })?;
    let (w, h) = img.dimensions();
    let resized = if w.max(h) > max_dim {
        // `resize` preserves aspect ratio and fits within the bounding box
        img.resize(max_dim, max_dim, FilterType::Lanczos3)
    } else {
        img
    };
    let (rw, rh) = resized.dimensions();
    let bytes = image_to_webp(&resized)?;
    Ok((bytes, rw, rh))
}

/// generate sized thumbnails for a parent blob
///
/// creates thumbnails for each size in THUMBNAIL_SIZES (50, 200)
/// returns list of generated thumbnail blob IDs
///
/// # arguments
/// * `parent_blob_id` - ID of the source image/waveform blob
/// * `created_by` - user ID for audit
///
/// # returns
/// list of generated thumbnails with their blob IDs and dimensions
pub async fn generate_sized_thumbnails(
    parent_blob_id: &str,
    created_by: Option<String>,
) -> GrimoireResponse<Vec<GeneratedThumbnail>> {
    // get parent blob metadata
    let parent_blob = match media_blobz::get_media_blob(parent_blob_id).await {
        Ok(blob) => blob,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to get parent blob",
                vec![ErrorDetail::new(
                    "parent_not_found",
                    "Parent Blob Not Found",
                    format!("blob {} not found: {}", parent_blob_id, e),
                )],
            )
        }
    };

    // only generate thumbnails for original images and waveforms
    let blob_type = parent_blob.blob_type;
    if blob_type != BlobType::Original && blob_type != BlobType::Waveform {
        return GrimoireResponse::failure(
            "invalid parent blob type",
            vec![ErrorDetail::new(
                "invalid_blob_type",
                "Invalid Blob Type",
                format!(
                    "can only generate thumbnails from original or waveform blobs, got: {}",
                    blob_type
                ),
            )],
        );
    }

    // get parent image data
    let parent_data = match get_blob_data(parent_blob_id).await.data {
        Some(data) => data,
        None => {
            return GrimoireResponse::failure(
                "failed to get parent blob data",
                vec![ErrorDetail::new(
                    "data_not_found",
                    "Data Not Found",
                    format!("no data found for blob {}", parent_blob_id),
                )],
            )
        }
    };

    // load and decode the image
    let img = match image::load_from_memory(&parent_data) {
        Ok(i) => i,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to decode parent image",
                vec![ErrorDetail::new(
                    "decode_failed",
                    "Decode Failed",
                    format!("failed to decode image from blob {}: {}", parent_blob_id, e),
                )],
            )
        }
    };

    let resize_mode = ResizeMode::from_blob_type(&blob_type);
    let mut generated = Vec::new();
    let sizes = get_thumbnail_sizes();

    for size in sizes {
        // check if thumbnail already exists
        if let Some(existing) = find_existing_thumbnail(parent_blob_id, size).await {
            generated.push(GeneratedThumbnail {
                blob_id: existing.id,
                width: size,
                height: size,
            });
            continue;
        }

        // generate the thumbnail
        let thumb_img = resize_to_square(&img, size, resize_mode);
        let webp_data = match image_to_webp(&thumb_img) {
            Ok(d) => d,
            Err(e) => {
                return GrimoireResponse::failure(
                    "failed to encode thumbnail",
                    vec![ErrorDetail::new(
                        "encode_failed",
                        "Encode Failed",
                        format!("failed to encode {}px thumbnail: {}", size, e),
                    )],
                )
            }
        };

        // create the thumbnail blob record
        let mut hasher = Sha256::new();
        hasher.update(&webp_data);
        let sha256 = format!("{:x}", hasher.finalize());

        let request = CreateMediaBlobRequest {
            sha256,
            size: Some(webp_data.len() as i64),
            mime: Some("image/webp".to_string()),
            source_client_id: created_by.clone(),
            local_path: None,
            filename: None,
            parent_blob_id: Some(parent_blob_id.to_string()),
            blob_type: Some(BlobType::Thumbnail),
            metadata: serde_json::json!({
                "type": "sized_thumbnail",
                "parent_blob_id": parent_blob_id,
                "dimensions": {"width": size, "height": size},
                "resize_mode": format!("{:?}", resize_mode),
                "format": "webp"
            }),
            created_by: created_by.clone(),
            data: Some(webp_data.into()),
            width: Some(size as i64),
            height: Some(size as i64),
            blake3: None, // not needed for thumbnails
        };

        match media_blobz::create_media_blob(request).await {
            Ok(blob) => {
                generated.push(GeneratedThumbnail {
                    blob_id: blob.id,
                    width: size,
                    height: size,
                });
            }
            Err(e) => {
                return GrimoireResponse::failure(
                    "failed to create thumbnail blob",
                    vec![ErrorDetail::new(
                        "create_failed",
                        "Create Failed",
                        format!("failed to create {}px thumbnail: {}", size, e),
                    )],
                )
            }
        }
    }

    GrimoireResponse::success(
        &format!(
            "generated {} thumbnails for blob {}",
            generated.len(),
            parent_blob_id
        ),
        generated,
    )
}

/// find an existing thumbnail for a parent blob at a specific size
pub async fn find_existing_thumbnail(parent_blob_id: &str, width: u32) -> Option<MediaBlob> {
    let pool = database::connect().await.ok()?;
    let width_i64 = width as i64;

    sqlx::query_as!(
        MediaBlob,
        "SELECT
            id as \"id!\",
            sha256 as \"sha256!\",
            size,
            mime,
            source_client_id,
            local_path,
            filename,
            parent_blob_id,
            blob_type as \"blob_type!\",
            metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at,
            deleted_by,
            created_by,
            updated_by,
            width,
            height,
            blake3
         FROM media_blobz
         WHERE parent_blob_id = ?
           AND blob_type = 'thumbnail'
           AND width = ?
           AND deleted_at IS NULL
         LIMIT 1",
        parent_blob_id,
        width_i64
    )
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten()
}

/// get or generate a thumbnail for a blob at a specific size
///
/// returns the thumbnail blob ID if it exists or can be generated
/// falls back to parent blob ID if thumbnail generation fails
pub async fn get_or_generate_thumbnail(
    parent_blob_id: &str,
    size: u32,
    created_by: Option<String>,
) -> GrimoireResult<String> {
    // Check for existing thumbnail first
    if let Some(existing) = find_existing_thumbnail(parent_blob_id, size).await {
        return Ok(existing.id);
    }

    // Generate thumbnails (will create all sizes)
    let result = generate_sized_thumbnails(parent_blob_id, created_by).await;

    if let Some(thumbnails) = result.data {
        // Find the thumbnail at the requested size
        if let Some(thumb) = thumbnails.iter().find(|t| t.width == size) {
            return Ok(thumb.blob_id.clone());
        }
    }

    // Fall back to parent blob if generation failed
    // This allows the client to still render something
    Ok(parent_blob_id.to_string())
}

/// default batch size for fetching blobs needing thumbnails
const BATCH_SIZE: i64 = 100;

/// get a batch of blobs that need thumbnails generated (original images and waveforms without children)
///
/// internal function - always returns at most BATCH_SIZE rows to avoid loading too much into memory.
/// also excludes blobs whose sha256 matches another blob that already has thumbnails
/// (since dedup would just return the existing thumbnail, creating an infinite loop).
async fn get_blobs_needing_thumbnails_batch() -> GrimoireResponse<Vec<MediaBlob>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => return GrimoireResponse::failure("failed to connect", vec![e.into()]),
    };

    // find original and waveform blobs that don't have any thumbnail children
    // also excludes blobs whose content (sha256) matches a sibling blob that already has thumbnails
    // (since thumbnail dedup would just return the sibling's thumbnail, causing infinite loop)
    let blobs = match sqlx::query_as!(
        MediaBlob,
        "SELECT
            b.id as \"id!\",
            b.sha256 as \"sha256!\",
            b.size,
            b.mime,
            b.source_client_id,
            b.local_path,
            b.filename,
            b.parent_blob_id,
            b.blob_type as \"blob_type!\",
            b.metadata,
            b.created_at as \"created_at!\",
            b.updated_at as \"updated_at!\",
            b.deleted_at,
            b.deleted_by,
            b.created_by,
            b.updated_by,
            b.width,
            b.height,
            b.blake3
         FROM media_blobz b
         WHERE b.blob_type IN ('original', 'waveform')
           AND b.mime LIKE 'image/%'
           AND b.deleted_at IS NULL
           AND NOT EXISTS (
               SELECT 1 FROM media_blobz t
               WHERE t.parent_blob_id = b.id
                 AND t.blob_type = 'thumbnail'
                 AND t.deleted_at IS NULL
           )
           AND NOT EXISTS (
               -- exclude if a sibling blob (same sha256) already has thumbnails
               -- since dedup would return that sibling's thumbnail anyway
               SELECT 1 FROM media_blobz sibling
               WHERE sibling.sha256 = b.sha256
                 AND sibling.id != b.id
                 AND sibling.deleted_at IS NULL
                 AND EXISTS (
                     SELECT 1 FROM media_blobz t2
                     WHERE t2.parent_blob_id = sibling.id
                       AND t2.blob_type = 'thumbnail'
                       AND t2.deleted_at IS NULL
                 )
           )
         ORDER BY b.created_at DESC
         LIMIT ?",
        BATCH_SIZE
    )
    .fetch_all(&pool)
    .await
    {
        Ok(b) => b,
        Err(e) => return GrimoireResponse::failure("failed to query blobs", vec![e.into()]),
    };

    GrimoireResponse::success(
        &format!("found {} blobs needing thumbnails", blobs.len()),
        blobs,
    )
}

/// count total blobs needing thumbnails (for dry-run / progress reporting)
pub async fn count_blobs_needing_thumbnails() -> GrimoireResponse<u32> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => return GrimoireResponse::failure("failed to connect", vec![e.into()]),
    };

    let count: i64 = match sqlx::query_scalar!(
        "SELECT COUNT(*) FROM media_blobz b
         WHERE b.blob_type IN ('original', 'waveform')
           AND b.mime LIKE 'image/%'
           AND b.deleted_at IS NULL
           AND NOT EXISTS (
               SELECT 1 FROM media_blobz t
               WHERE t.parent_blob_id = b.id
                 AND t.blob_type = 'thumbnail'
                 AND t.deleted_at IS NULL
           )
           AND NOT EXISTS (
               SELECT 1 FROM media_blobz sibling
               WHERE sibling.sha256 = b.sha256
                 AND sibling.id != b.id
                 AND sibling.deleted_at IS NULL
                 AND EXISTS (
                     SELECT 1 FROM media_blobz t2
                     WHERE t2.parent_blob_id = sibling.id
                       AND t2.blob_type = 'thumbnail'
                       AND t2.deleted_at IS NULL
                 )
           )"
    )
    .fetch_one(&pool)
    .await
    {
        Ok(c) => c,
        Err(e) => return GrimoireResponse::failure("failed to count blobs", vec![e.into()]),
    };

    GrimoireResponse::success(&format!("{} blobs need thumbnails", count), count as u32)
}

/// backfill thumbnails for all blobs that need them
///
/// processes blobs in batches of 100 to avoid memory issues with large datasets.
/// if limit is specified, stops after processing that many blobs.
pub async fn backfill_thumbnails(
    limit: Option<u32>,
    created_by: Option<String>,
) -> GrimoireResponse<BackfillResult> {
    let mut result = BackfillResult {
        processed: 0,
        succeeded: 0,
        failed: 0,
        errors: vec![],
    };

    let max_to_process = limit.unwrap_or(u32::MAX);

    // process in batches until done or limit reached
    loop {
        // check if we've hit the limit
        if result.processed >= max_to_process {
            break;
        }

        // fetch next batch
        let blobs = match get_blobs_needing_thumbnails_batch().await.data {
            Some(b) if !b.is_empty() => b,
            _ => break, // no more blobs need processing
        };

        // process this batch
        for blob in blobs {
            // respect limit even mid-batch
            if result.processed >= max_to_process {
                break;
            }

            result.processed += 1;

            let gen_result = generate_sized_thumbnails(&blob.id, created_by.clone()).await;
            if gen_result.success {
                result.succeeded += 1;
            } else {
                result.failed += 1;
                result
                    .errors
                    .push(format!("blob {}: {}", blob.id, gen_result.message));
            }
        }

        // log progress every batch
        tracing::info!(
            "backfill progress: {} processed, {} succeeded, {} failed",
            result.processed,
            result.succeeded,
            result.failed
        );
    }

    GrimoireResponse::success(
        &format!(
            "backfill complete: {} processed, {} succeeded, {} failed",
            result.processed, result.succeeded, result.failed
        ),
        result,
    )
}

/// result of backfill operation
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BackfillResult {
    pub processed: u32,
    pub succeeded: u32,
    pub failed: u32,
    pub errors: Vec<String>,
}
