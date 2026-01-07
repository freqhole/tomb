//! helper functions for creating thumbnails and waveforms as binary blobs
//! all output is standardized to WebP format for optimal compression and quality

use crate::error::{GrimoireError, GrimoireResult};
use crate::media_blobz::{self, CreateMediaBlobRequest};
use image::ImageOutputFormat;
use sha2::{Digest, Sha256};
use std::io::Cursor;
use std::process::Stdio;

/// create a thumbnail blob from audio file using ffmpeg
/// returns error if no album art found (no fallbacks/placeholders)
pub async fn create_audio_thumbnail_blob(
    source_blob_id: &str,
    audio_file_path: &str,
) -> GrimoireResult<String> {
    // Try extracting embedded album art first
    if let Ok(webp_data) = extract_album_art_to_webp(audio_file_path).await {
        return create_thumbnail_blob_from_webp_data(source_blob_id, webp_data, "album_art").await;
    }

    // Try finding album art in directory
    if let Ok(webp_data) = find_album_art_in_directory_to_webp(audio_file_path).await {
        return create_thumbnail_blob_from_webp_data(source_blob_id, webp_data, "directory_art")
            .await;
    }

    // No album art found - fail cleanly
    Err(GrimoireError::ProcessingFailed {
        message: "No album art found in file or directory".to_string(),
    })
}

/// create a waveform blob from audio file using ffmpeg
pub async fn create_audio_waveform_blob(
    source_blob_id: &str,
    audio_file_path: &str,
) -> GrimoireResult<String> {
    let webp_data = generate_waveform_to_webp(audio_file_path).await?;
    create_waveform_blob_from_webp_data(source_blob_id, webp_data).await
}

/// extract album art from audio file and convert to webp
async fn extract_album_art_to_webp(input_path: &str) -> GrimoireResult<Vec<u8>> {
    let temp_file = format!("/tmp/thumb_{}.jpg", uuid::Uuid::new_v4());

    let mut cmd = tokio::process::Command::new("ffmpeg");
    cmd.args([
        "-i", input_path, "-an", // no audio
        "-vcodec", "mjpeg", "-vframes", "1", // extract first frame
        "-q:v", "2",  // high quality
        "-y", // overwrite output
        &temp_file,
    ])
    .stdout(Stdio::null())
    .stderr(Stdio::null());

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
async fn find_album_art_in_directory_to_webp(audio_file_path: &str) -> GrimoireResult<Vec<u8>> {
    let dir = std::path::Path::new(audio_file_path)
        .parent()
        .ok_or_else(|| GrimoireError::ProcessingFailed {
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
async fn generate_waveform_to_webp(input_path: &str) -> GrimoireResult<Vec<u8>> {
    let temp_file = format!("/tmp/wave_{}.png", uuid::Uuid::new_v4());

    let mut cmd = tokio::process::Command::new("ffmpeg");
    cmd.args([
        "-i",
        input_path,
        "-filter_complex",
        "showwavespic=s=800x200:colors=0x3b82f6",
        "-frames:v",
        "1",
        "-y", // overwrite output
        &temp_file,
    ])
    .stdout(Stdio::null())
    .stderr(Stdio::null());

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
fn convert_to_webp(image_data: &[u8]) -> GrimoireResult<Vec<u8>> {
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

/// create a thumbnail blob from webp data
async fn create_thumbnail_blob_from_webp_data(
    source_blob_id: &str,
    webp_data: Vec<u8>,
    art_type: &str,
) -> GrimoireResult<String> {
    let mut hasher = Sha256::new();
    hasher.update(&webp_data);
    let sha256 = format!("{:x}", hasher.finalize());

    let metadata = serde_json::json!({
        "type": "thumbnail",
        "art_type": art_type,
        "source_blob_id": source_blob_id,
        "format": "webp",
        "generated_with": "grimoire"
    });

    let request = CreateMediaBlobRequest {
        sha256,
        size: Some(webp_data.len() as i64),
        mime: Some("image/webp".to_string()),
        source_client_id: Some("job_processor".to_string()),
        local_path: None, // Important: no local path for thumbnails
        parent_blob_id: Some(source_blob_id.to_string()),
        blob_type: Some("thumbnail".to_string()),
        metadata,
        created_by: Some("job_processor".to_string()),
        data: Some(webp_data), // Store as binary data
    };

    let blob = media_blobz::create_media_blob(request).await?;
    Ok(blob.id)
}

/// create a waveform blob from webp data
async fn create_waveform_blob_from_webp_data(
    source_blob_id: &str,
    webp_data: Vec<u8>,
) -> GrimoireResult<String> {
    let mut hasher = Sha256::new();
    hasher.update(&webp_data);
    let sha256 = format!("{:x}", hasher.finalize());

    let metadata = serde_json::json!({
        "type": "waveform",
        "source_blob_id": source_blob_id,
        "dimensions": {"width": 800, "height": 200},
        "format": "webp",
        "generated_with": "grimoire"
    });

    let request = CreateMediaBlobRequest {
        sha256,
        size: Some(webp_data.len() as i64),
        mime: Some("image/webp".to_string()),
        source_client_id: Some("job_processor".to_string()),
        local_path: None, // Important: no local path for waveforms
        parent_blob_id: Some(source_blob_id.to_string()),
        blob_type: Some("waveform".to_string()),
        metadata,
        created_by: Some("job_processor".to_string()),
        data: Some(webp_data), // Store as binary data
    };

    let blob = media_blobz::create_media_blob(request).await?;
    Ok(blob.id)
}
