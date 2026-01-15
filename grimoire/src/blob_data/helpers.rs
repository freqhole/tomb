//! helper functions for creating thumbnails and waveforms as binary blobs
//! all output is standardized to WebP format for optimal compression and quality

use crate::config::GrimoireConfig;
use crate::error::{ErrorDetail, GrimoireError};
use crate::media_blobz::{self, BlobType, CreateMediaBlobRequest};
use crate::response::GrimoireResponse;
use image::ImageOutputFormat;
use sha2::{Digest, Sha256};
use std::io::Cursor;
use std::path::Path;
use std::process::Stdio;

/// Create a media blob record from an audio file path
///
/// Creates a media blob entry that references a local file.
/// This is used during audio file import to track the original file location.
///
/// Note: This calculates SHA256 hash of the file PATH (not contents) for performance.
pub async fn create_media_blob_from_file(
    file_path: &str,
    file_size: u64,
) -> GrimoireResponse<String> {
    let file_name = Path::new(file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");

    let mime_type = mime_guess::from_path(file_path)
        .first()
        .map(|m| m.to_string())
        .unwrap_or_else(|| "application/octet-stream".to_string());

    // Calculate SHA256 hash of the file path (not contents for performance)
    let mut hasher = Sha256::new();
    hasher.update(file_path.as_bytes());
    let sha256 = format!("{:x}", hasher.finalize());

    let request = CreateMediaBlobRequest {
        sha256,
        size: Some(file_size as i64),
        mime: Some(mime_type.clone()),
        source_client_id: Some("job_processor".to_string()),
        local_path: Some(file_path.to_string()),
        parent_blob_id: None,
        blob_type: Some(BlobType::Original),
        metadata: serde_json::json!({
            "file_name": file_name,
            "file_size": file_size,
            "mime_type": mime_type,
        }),
        created_by: Some("job_processor".to_string()),
        data: None, // Store as file reference
    };

    match media_blobz::create_media_blob(request).await {
        Ok(blob) => GrimoireResponse::success("Media blob created from file", blob.id),
        Err(e) => {
            GrimoireResponse::failure("Failed to create media blob from file", vec![e.into()])
        }
    }
}

/// create a thumbnail blob from audio file using ffmpeg
/// returns error if no album art found (no fallbacks/placeholders)
pub async fn create_audio_thumbnail_blob(
    source_blob_id: &str,
    audio_file_path: &str,
    config: &GrimoireConfig,
) -> GrimoireResponse<String> {
    // Try extracting embedded album art first
    match extract_album_art_to_webp(audio_file_path, config).await {
        Ok(webp_data) => {
            return create_thumbnail_blob_from_webp_data(source_blob_id, webp_data, "album_art")
                .await;
        }
        Err(_) => {
            // Continue to next method
        }
    }

    // Try finding album art in directory
    match find_album_art_in_directory_to_webp(audio_file_path).await {
        Ok(webp_data) => {
            return create_thumbnail_blob_from_webp_data(
                source_blob_id,
                webp_data,
                "directory_art",
            )
            .await;
        }
        Err(_) => {
            // Continue to error
        }
    }

    // No album art found - fail cleanly
    GrimoireResponse::failure(
        "No album art found in file or directory",
        vec![ErrorDetail::new(
            "no_album_art",
            "No Album Art",
            "No album art found in file or directory",
        )],
    )
}

/// create a waveform blob from audio file using ffmpeg
pub async fn create_audio_waveform_blob(
    source_blob_id: &str,
    audio_file_path: &str,
    config: &GrimoireConfig,
) -> GrimoireResponse<String> {
    let webp_data = match generate_waveform_to_webp(audio_file_path, config).await {
        Ok(data) => data,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to generate waveform",
                vec![ErrorDetail::new(
                    "waveform_generation_failed",
                    "Waveform Generation Failed",
                    e.to_string(),
                )],
            )
        }
    };
    create_waveform_blob_from_webp_data(source_blob_id, webp_data).await
}

/// extract album art from audio file and convert to webp
async fn extract_album_art_to_webp(
    input_path: &str,
    config: &GrimoireConfig,
) -> Result<Vec<u8>, GrimoireError> {
    let temp_file = format!("/tmp/thumb_{}.jpg", uuid::Uuid::new_v4());

    // Build command from config
    let args_str = config
        .media
        .extract_album_art_args
        .replace("{input}", input_path)
        .replace("{output}", &temp_file);

    let args = shell_words::split(&args_str).map_err(|e| GrimoireError::ProcessingFailed {
        message: format!("Failed to parse ffmpeg args: {}", e),
    })?;

    let mut cmd = tokio::process::Command::new(&config.media.ffmpeg_path);
    cmd.args(args).stdout(Stdio::null()).stderr(Stdio::null());

    let output = tokio::time::timeout(tokio::time::Duration::from_secs(30), cmd.output())
        .await
        .map_err(|_| GrimoireError::ProcessingFailed {
            message: "Album art extraction timed out".to_string(),
        })?
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("Failed to run ffmpeg: {}", e),
        })?;

    if !output.status.success() {
        return Err(GrimoireError::ProcessingFailed {
            message: "ffmpeg failed to extract album art".to_string(),
        });
    }

    // Read and convert to WebP
    let jpeg_data =
        tokio::fs::read(&temp_file)
            .await
            .map_err(|_| GrimoireError::ProcessingFailed {
                message: "No album art found in audio file".to_string(),
            })?;

    // Clean up temp file
    let _ = tokio::fs::remove_file(&temp_file).await;

    if jpeg_data.is_empty() {
        return Err(GrimoireError::ProcessingFailed {
            message: "Extracted album art file is empty".to_string(),
        });
    }

    // Convert JPEG to WebP
    convert_to_webp(&jpeg_data)
}

/// find album art image file in directory and convert to webp
/// #todo: this could be improved, art_filenames prolly not needed, like any image in the dir should work BUT we should take
/// some care to not over-apply an image, like if there's lots of songs in a dir, as in they're different albums, then we should not apply the image
async fn find_album_art_in_directory_to_webp(
    audio_file_path: &str,
) -> Result<Vec<u8>, crate::error::GrimoireError> {
    let dir = std::path::Path::new(audio_file_path)
        .parent()
        .ok_or_else(|| crate::error::GrimoireError::ProcessingFailed {
            message: "Could not get directory from audio file path".to_string(),
        })?;

    // Common album art filenames
    let art_filenames = [
        "folder.jpg",
        "folder.jpeg",
        "folder.png",
        "folder.webp",
        "cover.jpg",
        "cover.jpeg",
        "cover.png",
        "cover.webp",
        "album.jpg",
        "album.jpeg",
        "album.png",
        "album.webp",
        "art.jpg",
        "art.jpeg",
        "art.png",
        "art.webp",
    ];

    for filename in &art_filenames {
        let art_path = dir.join(filename);
        if art_path.exists() {
            match tokio::fs::read(&art_path).await {
                Ok(data) if !data.is_empty() => {
                    // Convert to WebP if needed
                    return convert_to_webp(&data);
                }
                _ => continue,
            }
        }
    }

    Err(GrimoireError::ProcessingFailed {
        message: "No album art found in directory".to_string(),
    })
}

/// generate waveform visualization and convert to webp
async fn generate_waveform_to_webp(
    input_path: &str,
    config: &GrimoireConfig,
) -> Result<Vec<u8>, GrimoireError> {
    let temp_file = format!("/tmp/wave_{}.png", uuid::Uuid::new_v4());

    // Build command from config
    let args_str = config
        .media
        .generate_waveform_args
        .replace("{input}", input_path)
        .replace("{output}", &temp_file);

    let args = shell_words::split(&args_str).map_err(|e| GrimoireError::ProcessingFailed {
        message: format!("Failed to parse ffmpeg args: {}", e),
    })?;

    let mut cmd = tokio::process::Command::new(&config.media.ffmpeg_path);
    cmd.args(args).stdout(Stdio::null()).stderr(Stdio::null());

    let output = tokio::time::timeout(tokio::time::Duration::from_secs(60), cmd.output())
        .await
        .map_err(|_| GrimoireError::ProcessingFailed {
            message: "Waveform generation timed out".to_string(),
        })?
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("Failed to run ffmpeg: {}", e),
        })?;

    if !output.status.success() {
        return Err(GrimoireError::ProcessingFailed {
            message: "ffmpeg failed to generate waveform".to_string(),
        });
    }

    // Read PNG and convert to WebP
    let png_data =
        tokio::fs::read(&temp_file)
            .await
            .map_err(|e| GrimoireError::ProcessingFailed {
                message: format!("Waveform file not created: {}", e),
            })?;

    // Clean up temp file
    let _ = tokio::fs::remove_file(&temp_file).await;

    // Convert PNG to WebP
    convert_to_webp(&png_data)
}

/// convert any image format to webp
pub fn convert_to_webp(image_data: &[u8]) -> Result<Vec<u8>, GrimoireError> {
    // Try to detect and load the image
    let img = image::load_from_memory(image_data).map_err(|e| GrimoireError::ProcessingFailed {
        message: format!("Failed to decode image: {}", e),
    })?;

    // Convert to WebP
    let mut webp_data = Vec::new();
    let mut cursor = Cursor::new(&mut webp_data);

    img.write_to(&mut cursor, ImageOutputFormat::WebP)
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("Failed to convert to WebP: {}", e),
        })?;

    Ok(webp_data)
}

/// create an image blob from webp data with flexible options
pub async fn create_image_blob_from_webp_data(
    webp_data: Vec<u8>,
    blob_type: BlobType,
    parent_blob_id: Option<String>,
    metadata: serde_json::Value,
    created_by: Option<String>,
) -> GrimoireResponse<String> {
    let mut hasher = Sha256::new();
    hasher.update(&webp_data);
    let sha256 = format!("{:x}", hasher.finalize());

    let request = CreateMediaBlobRequest {
        sha256,
        size: Some(webp_data.len() as i64),
        mime: Some("image/webp".to_string()),
        source_client_id: created_by.clone(),
        local_path: None, // Store as binary data
        parent_blob_id,
        blob_type: Some(blob_type),
        metadata,
        created_by,
        data: Some(webp_data.into()), // Store as binary data
    };

    match media_blobz::create_media_blob(request).await {
        Ok(blob) => GrimoireResponse::success("Image blob created from WebP data", blob.id),
        Err(e) => {
            GrimoireResponse::failure("Failed to create image blob from WebP data", vec![e.into()])
        }
    }
}

/// create a thumbnail blob from webp data (for audio thumbnails)
async fn create_thumbnail_blob_from_webp_data(
    source_blob_id: &str,
    webp_data: Vec<u8>,
    art_type: &str,
) -> GrimoireResponse<String> {
    let metadata = serde_json::json!({
        "type": "thumbnail",
        "art_type": art_type,
        "source_blob_id": source_blob_id,
        "format": "webp",
        "generated_with": "grimoire"
    });

    create_image_blob_from_webp_data(
        webp_data,
        BlobType::Thumbnail,
        Some(source_blob_id.to_string()),
        metadata,
        Some("job_processor".to_string()),
    )
    .await
}

/// create a waveform blob from webp data
async fn create_waveform_blob_from_webp_data(
    source_blob_id: &str,
    webp_data: Vec<u8>,
) -> GrimoireResponse<String> {
    let metadata = serde_json::json!({
        "type": "waveform",
        "source_blob_id": source_blob_id,
        "dimensions": {"width": 800, "height": 200},
        "format": "webp",
        "generated_with": "grimoire"
    });

    create_image_blob_from_webp_data(
        webp_data,
        BlobType::Waveform,
        Some(source_blob_id.to_string()),
        metadata,
        Some("job_processor".to_string()),
    )
    .await
}
