//! PDF page rendering job processor
//!
//! renders all pages of a PDF document to individual WebP image files using
//! ImageMagick, creates media blobs for each page, and tracks them in
//! the document_imagez table.

use crate::blobz::compute_blake3_from_bytes;
use crate::config;
use crate::jobs::{Job, JobError};
use crate::media::documentz;
use crate::media_blobz::{self, BlobType, CreateMediaBlobRequest};
use serde_json::{json, Value as JsonValue};
use sha2::{Digest, Sha256};
use tracing::{debug, info, warn};

/// process a RenderDocumentPages job
///
/// renders every page of a PDF to an individual WebP image using ImageMagick,
/// stores each as a media blob, and links them to the document via document_imagez
/// with image_type = 'page_render' and the appropriate page_number / total_pages.
pub async fn process_render_document_pages_job(job: &Job) -> Result<Option<JsonValue>, JobError> {
    info!("processing RenderDocumentPages job: {}", job.id);

    let config = config::get_config();
    let params: JsonValue = job.parameters()?;
    let media_params = super::MediaJobParams::from_value(&params)?;

    let blob_id = &media_params.blob_id;
    let entity_id = &media_params.entity_id;

    // get the document entity to check page_count
    let document = documentz::repository::get_document_by_id(entity_id)
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("failed to get document entity {}: {}", entity_id, e),
        })?;

    let page_count = document.page_count.unwrap_or(0);
    if page_count <= 0 {
        // page_count should have been set by GenerateDocumentThumbnail already,
        // but handle the case where it wasn't — we'll count the output files instead
        warn!(
            "document {} has no page_count, will count output files",
            entity_id
        );
    }

    // resolve source path
    let (source_path, is_temp) = super::get_source_path(blob_id).await?;

    let result = render_all_pages(
        &config,
        blob_id,
        entity_id,
        &source_path,
        job.created_by.as_deref(),
    )
    .await;

    super::cleanup_temp_file(&source_path, is_temp).await;

    result
}

/// inner processing logic — separated so cleanup happens regardless of outcome
async fn render_all_pages(
    config: &config::GrimoireConfig,
    blob_id: &str,
    entity_id: &str,
    source_path: &str,
    created_by: Option<&str>,
) -> Result<Option<JsonValue>, JobError> {
    // create a unique temp output directory for page images
    let run_id = uuid::Uuid::new_v4();
    let temp_dir = format!("/tmp/grimoire_pdf_pages_{}_{}", blob_id, run_id);

    tokio::fs::create_dir_all(&temp_dir)
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("failed to create temp dir {}: {}", temp_dir, e),
        })?;

    let output_pattern = format!("{}/page-%03d.webp", temp_dir);

    // run magick to render all pages
    let args = super::build_args(
        &config.media.magick_pdf_pages_args,
        &[("{input}", source_path), ("{output}", &output_pattern)],
    )?;

    // 300s timeout — large PDFs can take a while
    let magick_result = super::run_command(&config.media.magick_path, &args, 300).await;

    if let Err(e) = &magick_result {
        warn!(
            "ImageMagick PDF page rendering failed for blob {}: {}",
            blob_id, e
        );
        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
        return Err(JobError::ProcessingFailed {
            reason: format!("ImageMagick PDF page rendering failed: {}", e),
        });
    }

    // scan the output directory for generated page files
    let mut page_files: Vec<String> = Vec::new();
    let mut entries =
        tokio::fs::read_dir(&temp_dir)
            .await
            .map_err(|e| JobError::ProcessingFailed {
                reason: format!("failed to read temp dir {}: {}", temp_dir, e),
            })?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("failed to read dir entry: {}", e),
        })?
    {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("webp") {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                page_files.push(name.to_string());
            }
        }
    }

    // sort by filename to ensure correct page order (page-000.webp, page-001.webp, ...)
    page_files.sort();

    let total_pages = page_files.len() as i64;
    info!("rendered {} pages for blob {}", total_pages, blob_id);

    if total_pages == 0 {
        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
        return Err(JobError::ProcessingFailed {
            reason: format!("no pages rendered for blob {}", blob_id),
        });
    }

    // determine permanent storage directory for page images
    // use the same date-organized layout as other files, in a subfolder
    let output_dir = config
        .server
        .as_ref()
        .and_then(|s| s.fetch_music.as_ref())
        .and_then(|f| f.output_dir.as_ref())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| config.data_dir.join("fetch"));

    let now = time::OffsetDateTime::now_utc();
    let year = now.year();
    let month = now.month() as u8;

    // create a subdirectory named after the blob id to avoid collisions
    let pages_dir = output_dir.join(format!("{:04}/{:02}/{}_pages", year, month, blob_id));
    tokio::fs::create_dir_all(&pages_dir)
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("failed to create pages dir {}: {}", pages_dir.display(), e),
        })?;

    let mut created_blob_ids: Vec<String> = Vec::new();

    // process each page file
    for (page_num, filename) in page_files.iter().enumerate() {
        let temp_path = format!("{}/{}", temp_dir, filename);

        // read the webp data
        let webp_data =
            tokio::fs::read(&temp_path)
                .await
                .map_err(|e| JobError::ProcessingFailed {
                    reason: format!("failed to read page file {}: {}", temp_path, e),
                })?;

        if webp_data.is_empty() {
            warn!("skipping empty page file: {}", filename);
            continue;
        }

        // compute hashes
        let sha256 = format!("{:x}", Sha256::digest(&webp_data));
        let blake3_hash = compute_blake3_from_bytes(&webp_data);

        // copy the file to permanent storage
        let dest_filename = format!("page-{:03}.webp", page_num);
        let dest_path = pages_dir.join(&dest_filename);
        tokio::fs::copy(&temp_path, &dest_path)
            .await
            .map_err(|e| JobError::ProcessingFailed {
                reason: format!("failed to copy page to storage: {}", e),
            })?;

        debug!("stored page {} at {}", page_num, dest_path.display());

        // create a media blob for this page
        let page_blob = media_blobz::create_media_blob(CreateMediaBlobRequest {
            sha256,
            size: Some(webp_data.len() as i64),
            mime: Some("image/webp".to_string()),
            source_client_id: created_by.map(|s| s.to_string()),
            local_path: Some(dest_path.to_string_lossy().to_string()),
            filename: Some(dest_filename),
            parent_blob_id: Some(blob_id.to_string()),
            blob_type: Some(BlobType::Preview),
            metadata: json!({
                "source": "pdf_page_render",
                "page_number": page_num,
                "total_pages": total_pages,
                "parent_blob_id": blob_id,
            }),
            created_by: created_by.map(|s| s.to_string()),
            data: None,
            width: None,
            height: None,
            blake3: Some(blake3_hash),
        })
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("failed to create page blob for page {}: {}", page_num, e),
        })?;

        // insert into document_imagez
        if let Err(e) = documentz::repository::insert_document_image(
            entity_id,
            &page_blob.id,
            "page_render",
            Some(page_num as i64),
            Some(total_pages),
            page_num == 0, // first page is primary
        )
        .await
        {
            warn!(
                "failed to insert document_imagez row for page {}: {}",
                page_num, e
            );
        }

        created_blob_ids.push(page_blob.id);
    }

    // update document page_count if it wasn't set or has changed
    if let Err(e) = documentz::repository::update_document_metadata(
        entity_id,
        None,
        Some(total_pages),
        None,
        None,
    )
    .await
    {
        warn!("failed to update document page_count: {}", e);
    }

    // clean up temp directory
    let _ = tokio::fs::remove_dir_all(&temp_dir).await;

    info!(
        "RenderDocumentPages complete for blob {}: {} pages, {} blobs created",
        blob_id,
        total_pages,
        created_blob_ids.len()
    );

    Ok(Some(json!({
        "blob_id": blob_id,
        "entity_id": entity_id,
        "total_pages": total_pages,
        "page_blob_ids": created_blob_ids,
    })))
}
