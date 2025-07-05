//! Music scanning logic and file processing

use crate::music::generation;
use grimoire::media::{CreateMediaBlob, MediaBlobRepository, MediaBlobService, MediaTypeDetector};
use grimoire::music::{
    directory_art::DirectoryArtDetector, extract_basic_metadata, extract_metadata,
    extract_thumbnail, hash_bytes, hash_file, waveform::WaveformGenerator,
};
use grimoire::music::{ConsoleScanProgress, MusicService, ScanConfig, ScanProgress, ScannerConfig};
use grimoire::AppConfig;
use std::collections::HashMap;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio::signal;
use uuid::Uuid;

/// Handle music directory scanning
pub async fn handle_scan(
    service: &MusicService<'_>,
    path: PathBuf,
    name: Option<String>,
    depth: Option<usize>,
    batch_size: usize,
    extensions: Option<String>,
    max_size_mb: Option<u64>,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("🎵 Starting music library scan...");
    println!("📁 Scanning directory: {}", path.display());

    // Configure scanner
    let mut scanner_config = ScannerConfig {
        batch_size,
        max_depth: depth,
        ..Default::default()
    };

    // Parse extensions if provided
    if let Some(ext_str) = extensions {
        let exts: Vec<String> = ext_str
            .split(',')
            .map(|s| s.trim().to_lowercase())
            .collect();
        scanner_config.include_extensions = exts;
    }

    // Create scan configuration
    let scan_config = ScanConfig {
        base_path: path.to_string_lossy().to_string(),
        session_name: name,
        scanner_config,
        max_file_size: max_size_mb.map(|mb| mb * 1024 * 1024), // Convert MB to bytes
        user_id: None,                                         // TODO: Add user context to CLI
    };

    print!("🔍 Counting audio files...");
    io::stdout().flush()?;

    // Start scan using service
    let scan_result = service.start_scan(scan_config).await?;

    println!(" found {} audio files", scan_result.total_files);
    println!("📋 Session ID: {}", scan_result.session_id);
    println!("🏷️  Session Name: {}", scan_result.session_name);

    let session_id = scan_result.session_id;
    let total_files = scan_result.total_files;
    let scanner = service.create_scanner(ScannerConfig {
        batch_size,
        max_depth: depth,
        ..Default::default()
    });

    // Set up graceful shutdown
    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = shutdown.clone();

    let _shutdown_handle = tokio::spawn(async move {
        signal::ctrl_c().await.expect("Failed to listen for ctrl+c");
        println!("\n⚠️  Received interrupt signal, gracefully shutting down...");
        shutdown_clone.store(true, Ordering::Relaxed);
    });

    // Progress tracking
    let mut progress = ConsoleScanProgress::new(10); // Report every 10 files
    let mut processed_count = 0;
    let mut last_processed_path: Option<String> = None;
    let mut songs_added_total = 0;
    let songs_updated_total = 0;
    let songs_skipped_total = 0;
    let mut errors_total = 0;

    // Start scanning
    println!("🚀 Starting scan... (Press Ctrl+C to pause and save progress)");

    let files_iter = scanner.scan_with_resume(&path, None::<&PathBuf>)?;

    // Group files by directory for album art detection
    let mut directory_groups: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();

    for entry in files_iter {
        let file_path = entry.path().to_path_buf();
        if let Some(parent) = file_path.parent() {
            directory_groups
                .entry(parent.to_path_buf())
                .or_insert_with(Vec::new)
                .push(file_path);
        }
    }

    println!(
        "📁 Found {} directories with audio files",
        directory_groups.len()
    );

    // Process files by directory
    for (dir_path, files_in_dir) in directory_groups {
        // Check for shutdown signal
        if shutdown.load(Ordering::Relaxed) {
            println!("💾 Saving progress and pausing scan...");
            break;
        }

        println!("📂 Processing directory: {}", dir_path.display());

        let mut song_ids_in_dir = Vec::new();

        for file_path in &files_in_dir {
            // Check for shutdown signal
            if shutdown.load(Ordering::Relaxed) {
                println!("💾 Saving progress and pausing scan...");
                break;
            }

            processed_count += 1;
            last_processed_path = Some(file_path.to_string_lossy().to_string());

            // Update progress
            progress.on_file_processed(file_path, processed_count);

            // Process the audio file
            match process_audio_file(
                service,
                file_path,
                session_id,
                max_size_mb.map(|mb| mb * 1024 * 1024),
            )
            .await
            {
                Ok(song_id) => {
                    songs_added_total += 1;
                    song_ids_in_dir.push(song_id);
                }
                Err(e) => {
                    eprintln!("Error processing {}: {}", file_path.display(), e);
                    errors_total += 1;
                }
            }

            // Update database progress every batch
            if processed_count % batch_size == 0 {
                service
                    .update_progress(
                        session_id,
                        processed_count as i32,
                        last_processed_path.clone(),
                        songs_added_total,
                        songs_updated_total,
                        songs_skipped_total,
                        errors_total,
                    )
                    .await?;
            }
        }

        // After processing all files in directory, look for directory album art
        if !song_ids_in_dir.is_empty() {
            match process_directory_album_art(service, &dir_path, &files_in_dir, &song_ids_in_dir)
                .await
            {
                Ok(applied_count) => {
                    if applied_count > 0 {
                        println!(
                            "  🖼️  Applied directory album art to {} songs",
                            applied_count
                        );
                    }
                }
                Err(e) => {
                    println!(
                        "  ⚠️  Warning: Failed to process directory album art: {}",
                        e
                    );
                }
            }
        }
    }

    // Final progress update
    service
        .update_progress(
            session_id,
            processed_count as i32,
            last_processed_path,
            songs_added_total,
            songs_updated_total,
            songs_skipped_total,
            errors_total,
        )
        .await?;

    // Complete or pause the session
    let _success = if shutdown.load(Ordering::Relaxed) {
        service.pause_session(session_id).await?
    } else {
        service
            .complete_session(
                session_id,
                grimoire::music::jobs::ScanSessionStatus::Completed,
                None,
            )
            .await?
    };

    progress.on_scan_complete(processed_count);

    if shutdown.load(Ordering::Relaxed) {
        println!("⏸️  Scan paused. Resume with: music resume {}", session_id);
    } else {
        println!("✅ Scan completed successfully!");
    }

    println!("📊 Session Summary:");
    println!("   📁 Files processed: {}/{}", processed_count, total_files);
    println!("   🆔 Session ID: {}", session_id);

    Ok(())
}

/// Handle resume scan command
pub async fn handle_resume(
    service: &MusicService<'_>,
    session_id: Uuid,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("🔄 Resuming scan session: {}", session_id);

    // Get session details
    let session = service.get_session(session_id).await?;
    println!(
        "📋 Session: {}",
        session
            .session_name
            .unwrap_or_else(|| "Unnamed".to_string())
    );
    println!("📁 Base path: {}", session.base_path);
    println!(
        "📊 Progress: {}/{}",
        session.processed_files,
        session.total_files.unwrap_or(0)
    );

    // Create scanner configuration
    let scanner_config = ScannerConfig {
        batch_size: 50, // Default batch size
        max_depth: None,
        ..Default::default()
    };

    // Resume the scan
    let base_path = PathBuf::from(&session.base_path);
    let resume_path = session.last_processed_path.as_ref().map(PathBuf::from);

    let scanner = service.create_scanner(scanner_config);
    let files_iter = scanner.scan_with_resume(&base_path, resume_path.as_ref())?;

    // Set up graceful shutdown
    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = shutdown.clone();

    let _shutdown_handle = tokio::spawn(async move {
        signal::ctrl_c().await.expect("Failed to listen for ctrl+c");
        println!("\n⚠️  Received interrupt signal, gracefully shutting down...");
        shutdown_clone.store(true, Ordering::Relaxed);
    });

    // Progress tracking
    let mut progress = ConsoleScanProgress::new(10);
    let mut processed_count = session.processed_files;
    let mut last_processed_path = session.last_processed_path.clone();
    let mut songs_added_total = session.songs_added;
    let songs_updated_total = session.songs_updated;
    let songs_skipped_total = session.songs_skipped;
    let mut errors_total = session.errors_encountered;

    println!("🚀 Resuming scan... (Press Ctrl+C to pause and save progress)");

    // Process remaining files
    for entry in files_iter {
        // Check for shutdown signal
        if shutdown.load(Ordering::Relaxed) {
            println!("💾 Saving progress and pausing scan...");
            break;
        }

        let file_path = entry.path();
        processed_count += 1;
        last_processed_path = Some(file_path.to_string_lossy().to_string());

        // Update progress
        progress.on_file_processed(file_path, processed_count as usize);

        // Process the audio file
        match process_audio_file(service, file_path, session_id, None).await {
            Ok(_song_id) => {
                songs_added_total += 1;
            }
            Err(e) => {
                eprintln!("Error processing {}: {}", file_path.display(), e);
                errors_total += 1;
            }
        }

        // Update database progress every 50 files
        if processed_count % 50 == 0 {
            service
                .update_progress(
                    session_id,
                    processed_count as i32,
                    last_processed_path.clone(),
                    songs_added_total,
                    songs_updated_total,
                    songs_skipped_total,
                    errors_total,
                )
                .await?;
        }
    }

    // Final progress update
    service
        .update_progress(
            session_id,
            processed_count as i32,
            last_processed_path,
            songs_added_total,
            songs_updated_total,
            songs_skipped_total,
            errors_total,
        )
        .await?;

    // Complete or pause the session
    let _success = if shutdown.load(Ordering::Relaxed) {
        service.pause_session(session_id).await?
    } else {
        service
            .complete_session(
                session_id,
                grimoire::music::jobs::ScanSessionStatus::Completed,
                None,
            )
            .await?
    };

    progress.on_scan_complete(processed_count as usize);

    if shutdown.load(Ordering::Relaxed) {
        println!("⏸️  Scan paused. Resume with: music resume {}", session_id);
    } else {
        println!("✅ Scan completed successfully!");
    }

    println!("📊 Session Summary:");
    println!("   📁 Files processed: {}", processed_count);
    println!("   🆔 Session ID: {}", session_id);

    Ok(())
}

/// Process a single audio file
async fn process_audio_file(
    service: &MusicService<'_>,
    file_path: &Path,
    _session_id: Uuid,
    max_file_size: Option<u64>,
) -> Result<Uuid, Box<dyn std::error::Error>> {
    // Check file size if limit is set
    if let Some(max_size) = max_file_size {
        if let Ok(metadata) = std::fs::metadata(file_path) {
            if metadata.len() > max_size {
                return Err(format!("File too large: {} bytes", metadata.len()).into());
            }
        }
    }

    // Extract metadata
    let metadata = extract_metadata(file_path).await?;
    let _basic_metadata = extract_basic_metadata(file_path).await?;

    // Hash the file
    let file_hash = hash_file(file_path).await?;

    // Create song repository directly
    let repository = grimoire::music::MusicRepository::new(service.db().pool().clone());

    // Create media blob
    let media_repository = MediaBlobRepository::new(service.db().pool().clone());
    let file_metadata = std::fs::metadata(file_path)?;
    let file_size = file_metadata.len() as i64;

    // Detect MIME type
    let config = AppConfig::default();
    let type_detector = MediaTypeDetector::from_config(&config);
    let mime_type = type_detector
        .get_mime_type(file_path)
        .unwrap_or_else(|_| "audio/mpeg".to_string());

    let create_blob = CreateMediaBlob {
        data: None, // Original audio files are stored on filesystem, not in database
        sha256: file_hash.clone(),
        size: Some(file_size),
        mime: Some(mime_type),
        source_client_id: Some("music-cli".to_string()),
        local_path: Some(file_path.to_string_lossy().to_string()),
        parent_blob_id: None, // This is an original audio file, not a thumbnail
        blob_type: Some("original".to_string()),
        metadata: serde_json::json!({
            "audio_metadata": metadata,
            "scan_source": "cli",
            "filename": file_path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|s| s.to_string()),
            "storage_type": "filesystem"
        }),
    };

    let media_blob = media_repository.create(create_blob).await?;

    // Extract thumbnail if available
    let thumbnail_blob_id = match extract_thumbnail(file_path).await {
        Ok(Some(extracted_image)) => {
            // Create thumbnail media blob
            let thumbnail_hash = hash_bytes(&extracted_image.data);

            let thumbnail_create_blob = CreateMediaBlob {
                data: Some(extracted_image.data.clone()),
                sha256: thumbnail_hash.clone(),
                size: Some(extracted_image.data.len() as i64),
                mime: Some(extracted_image.format.content_type().to_string()),
                source_client_id: Some("music-cli-thumbnail".to_string()),
                local_path: None,
                parent_blob_id: Some(media_blob.id.clone()),
                blob_type: Some("thumbnail".to_string()),
                metadata: serde_json::json!({
                    "thumbnail_source": "embedded_album_art",
                    "extracted_from": file_path.to_string_lossy(),
                    "image_format": format!("{:?}", extracted_image.format),
                    "dimensions": extracted_image.dimensions
                }),
            };

            // Try to create the thumbnail blob or get existing one if duplicate
            match media_repository.create(thumbnail_create_blob).await {
                Ok(thumbnail_blob) => {
                    println!("  🖼️  Extracted album art thumbnail: {}", thumbnail_blob.id);
                    Some(thumbnail_blob.id)
                }
                Err(e) if e.to_string().contains("duplicate key") => {
                    // Find the existing blob by SHA256 hash
                    let media_blob_service = MediaBlobService::new(MediaBlobRepository::new(
                        media_repository.pool().clone(),
                    ));
                    match media_blob_service
                        .get_media_blob_by_sha256(&thumbnail_hash)
                        .await
                    {
                        Ok(existing_blob) => {
                            println!(
                                "  ♻️  Using existing embedded thumbnail: {}",
                                existing_blob.id
                            );
                            Some(existing_blob.id)
                        }
                        Err(_) => {
                            eprintln!("  ⚠️  Failed to find existing thumbnail: {}", e);
                            None
                        }
                    }
                }
                Err(e) => {
                    eprintln!("  ⚠️  Failed to save thumbnail: {}", e);
                    None
                }
            }
        }
        Ok(None) => None,
        Err(e) => {
            eprintln!("  ⚠️  Error extracting thumbnail: {}", e);
            None
        }
    };

    // Generate waveform visualization
    let waveform_blob_id =
        generate_waveform_for_audio_file(&media_repository, &media_blob.id, file_path).await?;

    // Build smart title using TitleBuilder
    let title_builder = grimoire::music::TitleBuilder::new();
    let audio_meta = grimoire::music::AudioMetadata::new(
        metadata.tags.tags.clone(),
        file_path.to_string_lossy().to_string(),
    );
    let smart_title = title_builder.build_title(&audio_meta);

    // Extract individual metadata fields
    let artist = metadata
        .tags
        .tags
        .get("Artist")
        .or_else(|| metadata.tags.tags.get("ARTIST"))
        .cloned();
    let album = metadata
        .tags
        .tags
        .get("Album")
        .or_else(|| metadata.tags.tags.get("ALBUM"))
        .cloned();
    let album_artist = metadata
        .tags
        .tags
        .get("AlbumArtist")
        .or_else(|| metadata.tags.tags.get("ALBUMARTIST"))
        .cloned();
    let track_number = metadata
        .tags
        .tags
        .get("TrackNumber")
        .or_else(|| metadata.tags.tags.get("TRACKNUMBER"))
        .and_then(|s| s.parse::<i32>().ok());
    let disc_number = metadata
        .tags
        .tags
        .get("DiscNumber")
        .or_else(|| metadata.tags.tags.get("DISCNUMBER"))
        .and_then(|s| s.parse::<i32>().ok());
    let genre = metadata
        .tags
        .tags
        .get("Genre")
        .or_else(|| metadata.tags.tags.get("GENRE"))
        .cloned();
    let year = metadata
        .tags
        .tags
        .get("Year")
        .or_else(|| metadata.tags.tags.get("DATE"))
        .and_then(|s| s.parse::<i32>().ok());

    let metadata_json = serde_json::json!({
        "audio_properties": metadata.properties,
        "original_tags": metadata.tags.tags,
        "processing_info": {
            "processed_at": "now",
            "processor": "music-cli",
            "file_path": file_path.to_string_lossy()
        },
        "duration_seconds": metadata.properties.duration_seconds,
        "has_embedded_thumbnail": thumbnail_blob_id.is_some()
    });

    // Create song record using MusicRepository with waveform
    let song_id = repository
        .create_song_with_waveform_metadata(
            &media_blob.id,
            thumbnail_blob_id.as_deref(),
            waveform_blob_id.as_deref(),
            smart_title,
            artist,
            album,
            album_artist,
            track_number,
            disc_number,
            genre,
            year,
            metadata_json,
        )
        .await?;

    let song = repository.get_song(song_id).await?;
    println!("  ✅ Added: {}", song.title);
    Ok(song_id)
}

/// Process directory album art for songs that don't have embedded thumbnails
async fn process_directory_album_art(
    music_service: &MusicService<'_>,
    directory: &Path,
    audio_files: &[PathBuf],
    song_ids: &[Uuid],
) -> Result<usize, Box<dyn std::error::Error>> {
    // Create directory art detector
    let detector = DirectoryArtDetector::new();

    // Extract basic metadata from audio files for album detection
    let mut metadata = Vec::new();
    for file_path in audio_files {
        match extract_basic_metadata(file_path).await {
            Ok(meta) => metadata.push(meta),
            Err(e) => {
                println!(
                    "  ⚠️  Failed to extract metadata from {}: {}",
                    file_path.display(),
                    e
                );
                continue;
            }
        }
    }

    // Check if this directory appears to be an album
    if !detector.is_likely_album(&grimoire::music::DirectoryContext {
        path: directory.to_path_buf(),
        audio_files: audio_files.to_vec(),
        metadata,
    }) {
        return Ok(0);
    }

    println!("  📀 Directory appears to be an album, looking for directory art...");

    // Find potential album art images
    let directory_images = detector.find_directory_images(directory).await?;

    if directory_images.is_empty() {
        return Ok(0);
    }

    println!(
        "  📸 Found {} potential album art images",
        directory_images.len()
    );

    // Get songs without thumbnails in this directory
    let songs_without_thumbnails = get_songs_without_thumbnails(music_service, song_ids).await?;

    if songs_without_thumbnails.is_empty() {
        println!("  ℹ️  All songs already have thumbnails");
        return Ok(0);
    }

    println!(
        "  🎵 {} songs need directory art",
        songs_without_thumbnails.len()
    );

    // Get the first song's media blob ID to use as parent for directory art
    let first_song_media_blob_id =
        get_song_media_blob_id(music_service, songs_without_thumbnails[0]).await?;

    // Create shared directory art blobs once
    let mut created_blob_ids = Vec::new();
    let media_repository = MediaBlobRepository::new(music_service.db().pool().clone());
    let media_blob_service = MediaBlobService::new(media_repository);

    for image in &directory_images {
        // Load image data
        let image_data = std::fs::read(&image.path)?;

        // Convert to WebP format for storage
        let webp_data = generation::convert_image_to_webp(&image_data)?;

        // Create directory art blob (will be shared across songs)
        let thumbnail_hash = generation::hash_bytes(&webp_data);

        // Check if we already have this blob
        let blob_id = match media_blob_service
            .get_media_blob_by_sha256(&thumbnail_hash)
            .await
        {
            Ok(existing_blob) => {
                println!(
                    "  🔄 Using existing directory art blob: {}",
                    existing_blob.id
                );
                existing_blob.id
            }
            Err(_) => {
                let thumbnail_create_blob = CreateMediaBlob {
                    data: Some(webp_data.clone()),
                    sha256: thumbnail_hash.clone(),
                    size: Some(webp_data.len() as i64),
                    mime: Some("image/webp".to_string()),
                    source_client_id: Some("music-cli-directory-art".to_string()),
                    local_path: None,
                    parent_blob_id: Some(first_song_media_blob_id.clone()),
                    blob_type: Some("thumbnail".to_string()),
                    metadata: serde_json::json!({
                        "thumbnail_source": "directory_album_art",
                        "source_directory": directory.to_string_lossy(),
                        "source_filename": image.filename,
                        "priority": image.priority,
                        "converted_to_webp": true,
                        "shared_directory_art": true
                    }),
                };

                match media_blob_service
                    .create_media_blob(thumbnail_create_blob)
                    .await
                {
                    Ok(thumbnail_blob) => {
                        let blob_id = thumbnail_blob.id.clone();
                        println!("  🖼️  Created shared directory art blob: {}", blob_id);
                        blob_id
                    }
                    Err(e) => {
                        println!("  ⚠️  Failed to create directory art blob: {}", e);
                        continue;
                    }
                }
            }
        };

        created_blob_ids.push(blob_id);
    }

    if created_blob_ids.is_empty() {
        println!("  ❌ No directory art blobs could be created");
        return Ok(0);
    }

    // Apply directory art to all songs without thumbnails
    let mut applied_count = 0;
    let music_repository = grimoire::music::MusicRepository::new(music_service.db().pool().clone());

    for song_id in songs_without_thumbnails {
        // Update the primary thumbnail_blob_id if it's null
        let primary_update_result = sqlx::query(
            "UPDATE songs SET thumbnail_blob_id = $2, updated_at = NOW() WHERE id = $1 AND thumbnail_blob_id IS NULL"
        )
        .bind(song_id)
        .bind(&created_blob_ids[0])
        .execute(music_service.db().pool())
        .await;

        match primary_update_result {
            Ok(result) => {
                if result.rows_affected() > 0 {
                    println!("  ✅ Updated primary thumbnail for song {}", song_id);
                } else {
                    println!("  ℹ️  Song {} already has primary thumbnail", song_id);
                }
            }
            Err(e) => {
                println!(
                    "  ⚠️  Failed to update primary thumbnail for song {}: {}",
                    song_id, e
                );
                continue;
            }
        }

        // Update thumbnail_blob_ids array with remaining images (excluding primary)
        let remaining_blob_ids: Vec<String> = if created_blob_ids.len() > 1 {
            created_blob_ids[1..].to_vec()
        } else {
            Vec::new()
        };

        if !remaining_blob_ids.is_empty() {
            if let Err(e) = music_repository
                .update_song_thumbnail_blob_ids(song_id, &remaining_blob_ids)
                .await
            {
                println!(
                    "  ⚠️  Failed to update thumbnail array for song {}: {}",
                    song_id, e
                );
            } else {
                println!(
                    "  📸 Applied {} additional directory images to song {}",
                    remaining_blob_ids.len(),
                    song_id
                );
            }
        }

        applied_count += 1;
    }

    Ok(applied_count)
}

/// Get songs without thumbnails from a list of song IDs
async fn get_songs_without_thumbnails(
    music_service: &MusicService<'_>,
    song_ids: &[Uuid],
) -> Result<Vec<Uuid>, Box<dyn std::error::Error>> {
    let mut songs_without_thumbnails = Vec::new();

    for &song_id in song_ids {
        let has_thumbnail = sqlx::query_scalar::<_, bool>(
            "SELECT thumbnail_blob_id IS NOT NULL FROM songs WHERE id = $1",
        )
        .bind(song_id)
        .fetch_one(music_service.db().pool())
        .await?;

        if !has_thumbnail {
            songs_without_thumbnails.push(song_id);
        }
    }

    Ok(songs_without_thumbnails)
}

/// Get the media blob ID for a song
async fn get_song_media_blob_id(
    music_service: &MusicService<'_>,
    song_id: Uuid,
) -> Result<String, Box<dyn std::error::Error>> {
    let media_blob_id =
        sqlx::query_scalar::<_, String>("SELECT media_blob_id FROM songs WHERE id = $1")
            .bind(song_id)
            .fetch_one(music_service.db().pool())
            .await?;

    Ok(media_blob_id)
}

/// Generate waveform for a single audio file during scan
async fn generate_waveform_for_audio_file(
    media_repository: &MediaBlobRepository,
    audio_blob_id: &str,
    file_path: &std::path::Path,
) -> Result<Option<String>, Box<dyn std::error::Error>> {
    // Create waveform generator
    let generator = WaveformGenerator::new();

    // Generate waveform from audio file
    let waveform_data = match generator.generate_waveform(file_path).await {
        Ok(data) => data,
        Err(e) => {
            println!("  ⚠️  Failed to generate waveform: {}", e);
            return Ok(None);
        }
    };

    // Convert waveform PNG to WebP format for storage
    let webp_data = match generation::convert_image_to_webp(&waveform_data.png_data) {
        Ok(data) => data,
        Err(e) => {
            println!("  ⚠️  Failed to convert waveform to WebP: {}", e);
            return Ok(None);
        }
    };

    // Create SHA256 hash for the WebP data
    let hash = generation::hash_bytes(&webp_data);

    // Create a new media blob for the waveform (stored in database as WebP)
    let waveform_blob = CreateMediaBlob {
        data: Some(webp_data.clone()),
        sha256: hash,
        size: Some(webp_data.len() as i64),
        mime: Some("image/webp".to_string()),
        source_client_id: Some("music-cli-waveform".to_string()),
        local_path: None, // Store in database, not filesystem
        parent_blob_id: Some(audio_blob_id.to_string()),
        blob_type: Some("waveform".to_string()),
        metadata: serde_json::json!({
            "waveform_source": "scan_process",
            "original_audio": file_path.to_string_lossy(),
            "dimensions": {
                "width": waveform_data.config.width,
                "height": waveform_data.config.height
            },
            "converted_to_webp": true,
            "duration_seconds": waveform_data.duration_seconds
        }),
    };

    // Save the waveform blob
    match media_repository.create(waveform_blob).await {
        Ok(saved_blob) => {
            println!("  🌊 Generated waveform: {}", saved_blob.id);
            Ok(Some(saved_blob.id))
        }
        Err(e) => {
            println!("  ⚠️  Failed to save waveform: {}", e);
            Ok(None)
        }
    }
}
