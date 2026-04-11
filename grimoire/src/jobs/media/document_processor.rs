//! document thumbnail generation job processor
//!
//! generates PDF page thumbnails using ImageMagick and extracts basic
//! document metadata (page count) via pdfinfo when available

use crate::blob_data;
use crate::config;
use crate::jobs::{Job, JobError};
use crate::media::documentz;
use crate::media_blobz::BlobType;
use serde_json::{json, Value};
use tracing::{info, warn};

/// process a GenerateDocumentThumbnail job
///
/// renders the first page of a PDF to a PNG via ImageMagick, converts to WebP,
/// creates a child blob with auto-generated sized thumbnails, and attempts to
/// extract page count via pdfinfo (best-effort).
pub async fn process_generate_document_thumbnail_job(job: &Job) -> Result<Option<Value>, JobError> {
    info!("processing GenerateDocumentThumbnail job: {}", job.id);

    let config = config::get_config();

    // parse common media job params
    let params: Value = job.parameters()?;
    let media_params = super::MediaJobParams::from_value(&params)?;
    let blob_id = &media_params.blob_id;
    let entity_id = &media_params.entity_id;

    info!(
        "document thumbnail job: blob_id={}, entity_id={}, mime={}",
        blob_id, entity_id, media_params.mime
    );

    // resolve filesystem path for the source blob
    let (source_path, is_temp) = super::get_source_path(blob_id).await?;

    // run the actual processing, capturing result before cleanup
    let result = generate_thumbnail_and_metadata(
        &config,
        blob_id,
        entity_id,
        &source_path,
        job.created_by.as_deref(),
    )
    .await;

    // always clean up the source temp file
    super::cleanup_temp_file(&source_path, is_temp).await;

    // propagate any error after cleanup
    result
}

/// inner processing logic — separated so cleanup happens regardless of outcome
async fn generate_thumbnail_and_metadata(
    config: &config::GrimoireConfig,
    blob_id: &str,
    entity_id: &str,
    source_path: &str,
    created_by: Option<&str>,
) -> Result<Option<Value>, JobError> {
    // -- step 1: render first page to PNG via ImageMagick --
    let temp_output = format!(
        "/tmp/grimoire_docthumb_{}_{}.png",
        blob_id,
        uuid::Uuid::new_v4()
    );

    let args = super::build_args(
        &config.media.magick_pdf_thumbnail_args,
        &[("{input}", source_path), ("{output}", &temp_output)],
    )?;

    let magick_result = super::run_command(&config.media.magick_path, &args, 60).await;

    // if magick fails, clean up temp output and propagate
    if let Err(e) = &magick_result {
        warn!(
            "ImageMagick failed for blob {}: {}, cleaning up",
            blob_id, e
        );
        let _ = tokio::fs::remove_file(&temp_output).await;
        return Err(JobError::ProcessingFailed {
            reason: format!("ImageMagick PDF thumbnail generation failed: {}", e),
        });
    }

    // -- step 2: read PNG and convert to WebP --
    let png_data = tokio::fs::read(&temp_output)
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("failed to read magick output {}: {}", temp_output, e),
        })?;
    let _ = tokio::fs::remove_file(&temp_output).await;

    let webp_data =
        blob_data::convert_to_webp(&png_data).map_err(|e| JobError::ProcessingFailed {
            reason: format!("webp conversion failed for document thumbnail: {}", e),
        })?;

    info!(
        "generated document thumbnail for blob {}: {} bytes PNG -> {} bytes WebP",
        blob_id,
        png_data.len(),
        webp_data.len()
    );

    // -- step 3: create child blob with sized thumbnails --
    let metadata_json = json!({
        "source": "document_thumbnail",
        "parent_blob_id": blob_id,
        "entity_id": entity_id,
    });

    let resp = blob_data::create_image_blob_from_webp_data(
        webp_data,
        BlobType::Preview,
        Some(blob_id.to_string()),
        metadata_json,
        created_by.map(|s| s.to_string()),
    )
    .await;

    if !resp.success {
        warn!(
            "failed to create preview blob for document {}: thumbnail will be missing",
            blob_id
        );
    }

    let preview_blob_id = resp.data;

    // -- step 4: try to extract page count via pdfinfo (best-effort) --
    let page_count = extract_page_count(source_path).await;

    // -- step 5: update document entity metadata --
    match documentz::repository::update_document_metadata(
        entity_id, None,       // author — not extracted here
        page_count, // page_count from pdfinfo
        None,       // doc_type
        None,       // language
    )
    .await
    {
        Ok(doc) => {
            info!(
                "updated document metadata for {}: page_count={:?}",
                doc.id, page_count
            );
        }
        Err(e) => {
            warn!(
                "failed to update document metadata for {}: {}",
                entity_id, e
            );
        }
    }

    // -- step 6: queue full page rendering job if document has pages --
    if page_count.unwrap_or(0) > 0 {
        let render_params = json!({
            "blob_id": blob_id,
            "entity_id": entity_id,
            "domain": "document",
            "mime": "application/pdf",
        });

        let render_job = crate::jobs::create_job(crate::jobs::CreateJobRequest {
            job_type: crate::jobs::JobType::RenderDocumentPages,
            session_id: None,
            parameters: render_params,
            max_retries: Some(2),
            scheduled_at: None,
            created_by: created_by.map(|s| s.to_string()),
        })
        .await;

        match render_job.data {
            Some(ref job) => info!(
                "queued RenderDocumentPages job {} for blob {}",
                job.id, blob_id
            ),
            None => warn!(
                "failed to queue RenderDocumentPages job for blob {}: {}",
                blob_id, render_job.message
            ),
        }
    }

    info!(
        "GenerateDocumentThumbnail complete for blob {}: preview_blob_id={:?}, page_count={:?}",
        blob_id, preview_blob_id, page_count
    );

    Ok(Some(json!({
        "blob_id": blob_id,
        "entity_id": entity_id,
        "preview_blob_id": preview_blob_id,
        "page_count": page_count,
    })))
}

/// attempt to extract page count from a PDF using pdfinfo
///
/// this is best-effort — if pdfinfo is not installed or fails, returns None
async fn extract_page_count(source_path: &str) -> Option<i64> {
    let args = vec![source_path.to_string()];

    match super::run_command("pdfinfo", &args, 15).await {
        Ok((stdout, _stderr)) => {
            let output = String::from_utf8_lossy(&stdout);
            // pdfinfo outputs lines like "Pages:          42"
            for line in output.lines() {
                if let Some(rest) = line.strip_prefix("Pages:") {
                    if let Ok(count) = rest.trim().parse::<i64>() {
                        return Some(count);
                    }
                }
            }
            warn!(
                "pdfinfo output did not contain a Pages line for {}",
                source_path
            );
            None
        }
        Err(e) => {
            warn!(
                "pdfinfo failed for {} (skipping page count extraction): {}",
                source_path, e
            );
            None
        }
    }
}
