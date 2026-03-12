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
use tokio::io::AsyncReadExt;

/// get directory image blob IDs from scan cache (database-backed)
async fn get_cached_directory_images(session_id: &str, dir_path: &str) -> Option<Vec<String>> {
    let pool = crate::database::connect().await.ok()?;

    let result = sqlx::query!(
        "SELECT cache_value FROM scan_cache WHERE session_id = ? AND cache_key = ?",
        session_id,
        dir_path
    )
    .fetch_optional(&pool)
    .await
    .ok()?;

    if let Some(row) = result {
        serde_json::from_str(&row.cache_value).ok()
    } else {
        None
    }
}

/// store directory image blob IDs in scan cache (database-backed)
async fn cache_directory_images(session_id: &str, dir_path: &str, blob_ids: &[String]) {
    if let Ok(pool) = crate::database::connect().await {
        let value = serde_json::to_string(blob_ids).unwrap_or_default();
        let _ = sqlx::query!(
            "INSERT OR REPLACE INTO scan_cache (session_id, cache_key, cache_value) VALUES (?, ?, ?)",
            session_id,
            dir_path,
            value
        )
        .execute(&pool)
        .await;
    }
}

/// clear scan cache for a session (call at end of scan)
pub async fn clear_scan_cache(session_id: &str) {
    if let Ok(pool) = crate::database::connect().await {
        match sqlx::query!("DELETE FROM scan_cache WHERE session_id = ?", session_id)
            .execute(&pool)
            .await
        {
            Ok(result) => {
                tracing::info!(
                    "cleared scan cache for session {} ({} entries)",
                    session_id,
                    result.rows_affected()
                );
            }
            Err(e) => {
                tracing::warn!("failed to clear scan cache: {}", e);
            }
        }
    }
}

/// stream SHA256 hash of a file by reading in chunks (avoids loading entire file into memory)
async fn stream_sha256_hash(file_path: &str) -> Result<String, std::io::Error> {
    let mut file = tokio::fs::File::open(file_path).await?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 8192]; // 8KB chunks

    loop {
        let bytes_read = file.read(&mut buffer).await?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

/// Create a media blob record from an audio file path
///
/// Creates a media blob entry that references a local file.
/// This is used during audio file import to track the original file location.
///
/// Creates a media blob record from an audio file path.
/// Calculates SHA256 hash of the actual file contents for deduplication.
pub async fn create_media_blob_from_file(
    file_path: &str,
    file_size: u64,
    file_modified_at: i64,
    created_by: Option<String>,
) -> GrimoireResponse<String> {
    let file_name = Path::new(file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");

    let mime_type = mime_guess::from_path(file_path)
        .first()
        .map(|m| m.to_string())
        .unwrap_or_else(|| "application/octet-stream".to_string());

    // Calculate SHA256 hash by streaming the file instead of loading it all into memory
    let sha256 = match stream_sha256_hash(file_path).await {
        Ok(hash) => hash,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to hash file",
                vec![ErrorDetail::new(
                    "file_hash_error",
                    "File Hash Error",
                    format!("Failed to hash file {}: {}", file_path, e),
                )],
            )
        }
    };

    let request = CreateMediaBlobRequest {
        sha256,
        size: Some(file_size as i64),
        mime: Some(mime_type.clone()),
        source_client_id: created_by.clone(),
        local_path: Some(file_path.to_string()),
        filename: Some(file_name.to_string()),
        parent_blob_id: None,
        blob_type: Some(BlobType::Original),
        metadata: serde_json::json!({
            "file_name": file_name,
            "file_size": file_size,
            "mime_type": mime_type,
            "file_modified_at": file_modified_at,
        }),
        created_by,
        data: None, // Store as file reference
        width: None,
        height: None,
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
    _source_blob_id: &str, // kept for API compatibility but no longer used
    audio_file_path: &str,
    config: &GrimoireConfig,
    created_by: Option<String>,
) -> GrimoireResponse<String> {
    // Try extracting embedded album art first
    match extract_album_art_to_webp(audio_file_path, config).await {
        Ok(webp_data) => {
            return create_album_art_blob(webp_data, "embedded_album_art", created_by).await;
        }
        Err(_) => {
            // Continue to next method
        }
    }

    // Try finding album art in directory
    match find_album_art_in_directory_to_webp(audio_file_path).await {
        Ok(webp_data) => {
            return create_album_art_blob(webp_data, "directory_art", created_by).await;
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
    created_by: Option<String>,
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
    create_waveform_blob_from_webp_data(source_blob_id, webp_data, created_by).await
}

/// extract album art from audio file and convert to webp
async fn extract_album_art_to_webp(
    input_path: &str,
    config: &GrimoireConfig,
) -> Result<Vec<u8>, GrimoireError> {
    let temp_file = format!("/tmp/thumb_{}.jpg", uuid::Uuid::new_v4());

    // Build command from config - parse args first, then replace placeholders
    let mut args = shell_words::split(&config.media.extract_album_art_args).map_err(|e| {
        GrimoireError::ProcessingFailed {
            message: format!("Failed to parse ffmpeg args: {}", e),
        }
    })?;

    // Replace {input} and {output} placeholders in parsed args
    for arg in args.iter_mut() {
        if arg.contains("{input}") {
            *arg = arg.replace("{input}", input_path);
        }
        if arg.contains("{output}") {
            *arg = arg.replace("{output}", &temp_file);
        }
    }

    let mut cmd = tokio::process::Command::new(&config.media.ffmpeg_path);
    cmd.args(args).stdout(Stdio::null()).stderr(Stdio::piped());

    let output = tokio::time::timeout(tokio::time::Duration::from_secs(30), cmd.output())
        .await
        .map_err(|_| GrimoireError::ProcessingFailed {
            message: "Album art extraction timed out".to_string(),
        })?
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("Failed to run ffmpeg: {}", e),
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GrimoireError::ProcessingFailed {
            message: format!(
                "ffmpeg failed to extract album art. Exit code: {:?}. Error: {}",
                output.status.code(),
                stderr
            ),
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
/// first tries common album art filenames, then falls back to any image file in directory
async fn find_album_art_in_directory_to_webp(
    audio_file_path: &str,
) -> Result<Vec<u8>, crate::error::GrimoireError> {
    let dir = std::path::Path::new(audio_file_path)
        .parent()
        .ok_or_else(|| crate::error::GrimoireError::ProcessingFailed {
            message: "could not get directory from audio file path".to_string(),
        })?;

    // common album art filenames (prioritized)
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

    // try each known filename first
    for filename in &art_filenames {
        let path = dir.join(filename);
        if path.exists() {
            let image_data = tokio::fs::read(&path).await.map_err(|e| {
                crate::error::GrimoireError::ProcessingFailed {
                    message: format!("failed to read album art: {}", e),
                }
            })?;
            return convert_to_webp(&image_data);
        }
    }

    // fallback: find any image file in directory
    let mut entries = tokio::fs::read_dir(dir).await.map_err(|e| {
        crate::error::GrimoireError::ProcessingFailed {
            message: format!("failed to read directory: {}", e),
        }
    })?;

    let image_extensions = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];

    while let Some(entry) =
        entries
            .next_entry()
            .await
            .map_err(|e| crate::error::GrimoireError::ProcessingFailed {
                message: format!("failed to read directory entry: {}", e),
            })?
    {
        let path = entry.path();
        if let Some(ext) = path.extension() {
            if let Some(ext_str) = ext.to_str() {
                if image_extensions.contains(&ext_str.to_lowercase().as_str()) {
                    let image_data = tokio::fs::read(&path).await.map_err(|e| {
                        crate::error::GrimoireError::ProcessingFailed {
                            message: format!("failed to read image file: {}", e),
                        }
                    })?;
                    return convert_to_webp(&image_data);
                }
            }
        }
    }

    Err(GrimoireError::ProcessingFailed {
        message: "no album art found in directory".to_string(),
    })
}

/// generate waveform visualization and convert to webp
async fn generate_waveform_to_webp(
    input_path: &str,
    config: &GrimoireConfig,
) -> Result<Vec<u8>, GrimoireError> {
    let temp_file = format!("/tmp/wave_{}.png", uuid::Uuid::new_v4());

    // Build command from config - parse args first, then replace placeholders
    let mut args = shell_words::split(&config.media.generate_waveform_args).map_err(|e| {
        GrimoireError::ProcessingFailed {
            message: format!("Failed to parse ffmpeg args: {}", e),
        }
    })?;

    // Replace {input} and {output} placeholders in parsed args
    for arg in args.iter_mut() {
        if arg.contains("{input}") {
            *arg = arg.replace("{input}", input_path);
        }
        if arg.contains("{output}") {
            *arg = arg.replace("{output}", &temp_file);
        }
    }

    let mut cmd = tokio::process::Command::new(&config.media.ffmpeg_path);
    cmd.args(args).stdout(Stdio::null()).stderr(Stdio::piped());

    let output = tokio::time::timeout(tokio::time::Duration::from_secs(60), cmd.output())
        .await
        .map_err(|_| GrimoireError::ProcessingFailed {
            message: "Waveform generation timed out".to_string(),
        })?
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("Failed to run ffmpeg: {}", e),
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GrimoireError::ProcessingFailed {
            message: format!(
                "ffmpeg failed to generate waveform. Exit code: {:?}. Error: {}",
                output.status.code(),
                stderr
            ),
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
/// automatically generates sized thumbnails for Original and Waveform blobs
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
        filename: None,   // No filename for binary data
        parent_blob_id,
        blob_type: Some(blob_type),
        metadata,
        created_by: created_by.clone(),
        data: Some(webp_data.into()), // Store as binary data
        width: None,
        height: None,
    };

    match media_blobz::create_media_blob(request).await {
        Ok(blob) => {
            let blob_id = blob.id.clone();

            // generate sized thumbnails for Original and Waveform blobs
            // (not for Thumbnails - that would cause infinite recursion)
            if blob_type == BlobType::Original || blob_type == BlobType::Waveform {
                let thumb_result =
                    super::thumbnails::generate_sized_thumbnails(&blob_id, created_by).await;
                if !thumb_result.success {
                    tracing::warn!(
                        "failed to generate thumbnails for blob {}: {}",
                        blob_id,
                        thumb_result.message
                    );
                } else if let Some(thumbs) = thumb_result.data {
                    tracing::debug!("generated {} thumbnails for blob {}", thumbs.len(), blob_id);
                }
            }

            GrimoireResponse::success("Image blob created from WebP data", blob_id)
        }
        Err(e) => {
            GrimoireResponse::failure("Failed to create image blob from WebP data", vec![e.into()])
        }
    }
}

/// create an album art blob from webp data
/// these are standalone images (BlobType::Original) - not sized thumbnails
/// the relationship to songs is tracked via song_imagez junction table
async fn create_album_art_blob(
    webp_data: Vec<u8>,
    art_type: &str,
    created_by: Option<String>,
) -> GrimoireResponse<String> {
    let metadata = serde_json::json!({
        "type": "album_art",
        "art_type": art_type,
        "format": "webp",
        "generated_with": "grimoire"
    });

    create_image_blob_from_webp_data(
        webp_data,
        BlobType::Original,
        None, // standalone image, no parent
        metadata,
        created_by,
    )
    .await
}

/// create a waveform blob from webp data
async fn create_waveform_blob_from_webp_data(
    source_blob_id: &str,
    webp_data: Vec<u8>,
    created_by: Option<String>,
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
        created_by,
    )
    .await
}

/// result of collecting images for a song
#[derive(Debug, Clone)]
pub struct CollectedImages {
    /// embedded art blob id (if extracted from audio file)
    pub embedded_art_blob_id: Option<String>,
    /// directory image blob ids (in order found)
    pub directory_image_blob_ids: Vec<String>,
    /// true if embedded art or known filename was found (good match for album art)
    pub has_good_match: bool,
}

/// collect all images for a song: embedded art + all directory images
/// creates blobs for each image found (uses database cache to avoid re-processing directory images)
/// requires session_id to use the cache
pub async fn collect_song_images(
    _source_blob_id: &str, // kept for API compatibility but no longer used
    audio_file_path: &str,
    config: &GrimoireConfig,
    session_id: Option<&str>,
    created_by: Option<String>,
) -> GrimoireResponse<CollectedImages> {
    let mut embedded_art_blob_id = None;
    let mut directory_image_blob_ids = Vec::new();
    let mut has_good_match = false;

    // step 1: try to extract embedded art
    match extract_album_art_to_webp(audio_file_path, config).await {
        Ok(webp_data) => {
            let blob_response =
                create_album_art_blob(webp_data, "embedded_album_art", created_by.clone()).await;

            if blob_response.success {
                if let Some(blob_id) = blob_response.data {
                    embedded_art_blob_id = Some(blob_id);
                    has_good_match = true;
                }
            }
        }
        Err(_) => {
            // no embedded art, continue to directory images
        }
    }

    // step 2: get directory and check cache
    let dir = match std::path::Path::new(audio_file_path).parent() {
        Some(d) => d,
        None => {
            // if we at least got embedded art, return that
            if embedded_art_blob_id.is_some() {
                return GrimoireResponse::success(
                    "Collected embedded art only",
                    CollectedImages {
                        embedded_art_blob_id,
                        directory_image_blob_ids,
                        has_good_match,
                    },
                );
            }
            return GrimoireResponse::failure(
                "Could not get directory from audio file path",
                vec![],
            );
        }
    };

    let dir_path = dir.to_string_lossy().to_string();

    // check cache first - if we've already processed this directory's images, reuse them
    if let Some(sid) = session_id {
        if let Some(cached_blob_ids) = get_cached_directory_images(sid, &dir_path).await {
            // cache hit! reuse blob IDs
            tracing::debug!(
                "CACHE HIT! reusing {} directory images from database cache for: {}",
                cached_blob_ids.len(),
                dir_path
            );
            directory_image_blob_ids = cached_blob_ids;

            // determine has_good_match based on cached results
            if !directory_image_blob_ids.is_empty() {
                has_good_match = true;
            }

            return GrimoireResponse::success(
                "Collected song images (from cache)",
                CollectedImages {
                    embedded_art_blob_id,
                    directory_image_blob_ids,
                    has_good_match,
                },
            );
        } else {
            tracing::debug!(
                "CACHE MISS: processing directory images for first time: {}",
                dir_path
            );
        }
    }

    // cache miss - process directory images
    // known album art filenames (prioritized)
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

    let mut known_filename_found = false;
    let mut processed_paths = std::collections::HashSet::new();

    // step 3: process known filenames first
    for filename in &art_filenames {
        let path = dir.join(filename);
        if path.exists() {
            if let Some(path_str) = path.to_str() {
                if processed_paths.insert(path_str.to_string()) {
                    match process_directory_image(&path, created_by.clone()).await {
                        Ok(blob_id) => {
                            directory_image_blob_ids.push(blob_id);
                            known_filename_found = true;
                        }
                        Err(e) => {
                            tracing::warn!("failed to process known image {}: {}", filename, e);
                        }
                    }
                }
            }
        }
    }

    // if we found a known filename, that's a good match for album art
    if known_filename_found {
        has_good_match = true;
    }

    // step 4: sweep for all other images in directory
    let image_extensions = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];

    if let Ok(mut entries) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if let Some(ext) = path.extension() {
                if let Some(ext_str) = ext.to_str() {
                    if image_extensions.contains(&ext_str.to_lowercase().as_str()) {
                        if let Some(path_str) = path.to_str() {
                            // skip if already processed
                            if processed_paths.insert(path_str.to_string()) {
                                match process_directory_image(&path, created_by.clone()).await {
                                    Ok(blob_id) => {
                                        directory_image_blob_ids.push(blob_id);
                                    }
                                    Err(e) => {
                                        tracing::warn!(
                                            "failed to process directory image {}: {}",
                                            path_str,
                                            e
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // store in cache for next song in this directory
    if let Some(sid) = session_id {
        tracing::debug!(
            "caching {} directory images for: {}",
            directory_image_blob_ids.len(),
            dir_path
        );
        cache_directory_images(sid, &dir_path, &directory_image_blob_ids).await;
    }

    GrimoireResponse::success(
        "Collected song images",
        CollectedImages {
            embedded_art_blob_id,
            directory_image_blob_ids,
            has_good_match,
        },
    )
}

/// process a single directory image: read, convert to webp, create blob
async fn process_directory_image(
    image_path: &std::path::Path,
    created_by: Option<String>,
) -> Result<String, GrimoireError> {
    let image_data =
        tokio::fs::read(image_path)
            .await
            .map_err(|e| GrimoireError::ProcessingFailed {
                message: format!("failed to read image file: {}", e),
            })?;

    let webp_data = convert_to_webp(&image_data)?;

    let filename = image_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");

    let blob_response = create_album_art_blob(
        webp_data,
        &format!("directory_image_{}", filename),
        created_by,
    )
    .await;

    if blob_response.success {
        blob_response
            .data
            .ok_or_else(|| GrimoireError::ProcessingFailed {
                message: "blob created but no id returned".to_string(),
            })
    } else {
        Err(GrimoireError::ProcessingFailed {
            message: format!("failed to create blob: {}", blob_response.message),
        })
    }
}
