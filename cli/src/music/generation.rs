//! Waveform and directory art generation functions for the music module

use legacylib::media::{CreateMediaBlob, MediaBlobRepository, MediaBlobService};
use legacylib::music::{
    directory_art::DirectoryArtDetector, waveform::WaveformGenerator, MusicRepository,
    MusicService, Song,
};
use sha2::{Digest, Sha256};
use std::io::Cursor;
use std::path::Path;

/// Handle generate waveforms command
pub async fn handle_generate_waveforms(
    service: &MusicService<'_>,
    limit: u32,
    force: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    println!(
        "🌊 Generating waveforms (limit: {}, force: {})",
        limit, force
    );

    let repository = MusicRepository::new(service.db().pool().clone());

    // Get songs without waveforms or all songs if force is true
    let songs = if force {
        println!("🔄 Force mode: regenerating waveforms for all songs");
        get_songs_for_waveform_generation(&repository, limit as i32, true).await?
    } else {
        println!("📊 Finding songs without waveforms...");
        get_songs_for_waveform_generation(&repository, limit as i32, false).await?
    };

    if songs.is_empty() {
        println!("✅ No songs need waveform generation");
        return Ok(());
    }

    println!("🎵 Found {} songs for waveform generation", songs.len());

    let mut generated_count = 0;
    let mut failed_count = 0;

    for song in songs {
        match generate_waveform_for_song(&repository, &song).await {
            Ok(()) => {
                println!("  ✅ Generated waveform for: {}", song.title);
                generated_count += 1;
            }
            Err(e) => {
                println!("  ❌ Failed to generate waveform for {}: {}", song.title, e);
                failed_count += 1;
            }
        }
    }

    println!(
        "🌊 Waveform generation complete: {} generated, {} failed",
        generated_count, failed_count
    );

    Ok(())
}

/// Handle backfill waveforms command
pub async fn handle_backfill_waveforms(
    service: &MusicService<'_>,
    batch_size: u32,
    force: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    println!(
        "🌊 Backfilling waveforms (batch: {}, force: {})",
        batch_size, force
    );

    let repository = MusicRepository::new(service.db().pool().clone());

    let mut total_processed = 0;
    let mut total_generated = 0;
    let mut total_failed = 0;

    loop {
        // Get next batch of songs
        let songs =
            get_songs_for_waveform_generation(&repository, batch_size as i32, force).await?;

        if songs.is_empty() {
            break;
        }

        println!("📦 Processing batch of {} songs", songs.len());

        let mut batch_generated = 0;
        let mut batch_failed = 0;

        for song in songs {
            match generate_waveform_for_song(&repository, &song).await {
                Ok(()) => {
                    println!("  ✅ Generated waveform for: {}", song.title);
                    batch_generated += 1;
                }
                Err(e) => {
                    println!("  ❌ Failed to generate waveform for {}: {}", song.title, e);
                    batch_failed += 1;
                }
            }
        }

        total_processed += batch_generated + batch_failed;
        total_generated += batch_generated;
        total_failed += batch_failed;

        println!(
            "📊 Batch complete: {} generated, {} failed (Total: {} processed)",
            batch_generated, batch_failed, total_processed
        );
    }

    println!(
        "🌊 Backfill complete: {} total generated, {} failed",
        total_generated, total_failed
    );

    Ok(())
}

/// Handle generate directory art command
pub async fn handle_generate_directory_art(
    service: &MusicService<'_>,
    limit: u32,
    force: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    println!(
        "🖼️  Generating directory art (limit: {}, force: {})",
        limit, force
    );

    let repository = MusicRepository::new(service.db().pool().clone());

    // Get songs without thumbnails or all songs if force is true
    let songs = if force {
        println!("🔄 Force mode: regenerating directory art for all songs");
        get_songs_for_directory_art_generation(&repository, limit as i32, true).await?
    } else {
        println!("📊 Finding songs without album art...");
        get_songs_for_directory_art_generation(&repository, limit as i32, false).await?
    };

    if songs.is_empty() {
        println!("✅ No songs need directory art generation");
        return Ok(());
    }

    println!(
        "🎵 Found {} songs for directory art generation",
        songs.len()
    );

    let detector = DirectoryArtDetector::new();
    let mut generated_count = 0;
    let mut failed_count = 0;

    for song in songs {
        match generate_directory_art_for_song(&detector, &repository, &song).await {
            Ok(()) => {
                println!("  ✅ Generated directory art for: {}", song.title);
                generated_count += 1;
            }
            Err(e) => {
                println!(
                    "  ❌ Failed to generate directory art for {}: {}",
                    song.title, e
                );
                failed_count += 1;
            }
        }
    }

    println!(
        "🖼️  Directory art generation complete: {} generated, {} failed",
        generated_count, failed_count
    );

    Ok(())
}

/// Handle backfill directory art command
pub async fn handle_backfill_directory_art(
    service: &MusicService<'_>,
    batch_size: u32,
    force: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    println!(
        "🖼️  Backfilling directory art (batch: {}, force: {})",
        batch_size, force
    );

    let repository = MusicRepository::new(service.db().pool().clone());
    let detector = DirectoryArtDetector::new();

    let mut total_processed = 0;
    let mut total_generated = 0;
    let mut total_failed = 0;

    loop {
        // Get next batch of songs
        let songs =
            get_songs_for_directory_art_generation(&repository, batch_size as i32, force).await?;

        if songs.is_empty() {
            break;
        }

        println!("📦 Processing batch of {} songs", songs.len());

        let mut batch_generated = 0;
        let mut batch_failed = 0;

        for song in songs {
            match generate_directory_art_for_song(&detector, &repository, &song).await {
                Ok(()) => {
                    println!("  ✅ Generated directory art for: {}", song.title);
                    batch_generated += 1;
                }
                Err(e) => {
                    println!(
                        "  ❌ Failed to generate directory art for {}: {}",
                        song.title, e
                    );
                    batch_failed += 1;
                }
            }
        }

        total_processed += batch_generated + batch_failed;
        total_generated += batch_generated;
        total_failed += batch_failed;

        println!(
            "📊 Batch complete: {} generated, {} failed (Total: {} processed)",
            batch_generated, batch_failed, total_processed
        );
    }

    println!(
        "🖼️  Backfill complete: {} total generated, {} failed",
        total_generated, total_failed
    );

    Ok(())
}

/// Handle backfill metadata command
pub async fn handle_backfill_metadata(
    service: &MusicService<'_>,
    batch_size: u32,
    force: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    println!(
        "🏷️  Backfilling metadata (batch: {}, force: {})",
        batch_size, force
    );

    let repository = legacylib::music::MusicRepository::new(service.db().pool().clone());
    let mut offset = 0;
    let mut total_updated = 0;
    let mut total_failed = 0;

    loop {
        // Get batch of songs that need metadata updates
        let songs = if force {
            // If force, get all songs
            repository
                .get_songs_paginated(batch_size as i64, offset)
                .await?
        } else {
            // Otherwise, get songs with missing or poor metadata
            repository
                .get_songs_with_missing_metadata(batch_size as i64, offset)
                .await?
        };

        if songs.is_empty() {
            break;
        }

        println!(
            "📊 Processing batch of {} songs (offset: {})...",
            songs.len(),
            offset
        );

        for song in songs {
            match backfill_song_metadata(service, &song).await {
                Ok(updated) => {
                    if updated {
                        total_updated += 1;
                        println!("  ✅ Updated: {}", song.title);
                    } else {
                        println!("  ⏭️  Skipped: {}", song.title);
                    }
                }
                Err(e) => {
                    total_failed += 1;
                    eprintln!("  ❌ Failed to update {}: {}", song.title, e);
                }
            }
        }

        offset += batch_size as i64;
    }

    println!(
        "🏷️  Backfill complete: {} total updated, {} failed",
        total_updated, total_failed
    );

    Ok(())
}

/// Backfill metadata for a single song
async fn backfill_song_metadata(
    service: &MusicService<'_>,
    song: &legacylib::music::Song,
) -> Result<bool, Box<dyn std::error::Error>> {
    // Get the media blob to find the local path
    let media_repository = legacylib::media::MediaBlobRepository::new(service.db().pool().clone());
    let media_blob = media_repository.find_by_id(&song.media_blob_id).await?;

    let local_path = match media_blob.local_path {
        Some(path) => path,
        None => {
            return Err("Song has no local path".into());
        }
    };

    let file_path = std::path::Path::new(&local_path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", local_path).into());
    }

    // Extract fresh metadata
    let standard_fields = legacylib::music::extract_standard_fields(file_path).await?;

    // Check if we need to update anything
    let needs_update = song.artist.is_none()
        || song.album.is_none()
        || song.duration.is_none()
        || standard_fields.artist.is_some() && song.artist != standard_fields.artist
        || standard_fields.album.is_some() && song.album != standard_fields.album
        || standard_fields.duration_seconds.is_some() && song.duration.is_none();

    if !needs_update {
        return Ok(false);
    }

    // Update song with new metadata
    let repository = legacylib::music::MusicRepository::new(service.db().pool().clone());

    // Use repository method to update song metadata
    repository
        .update_song_metadata(
            song.id,
            standard_fields.artist.as_deref(),
            standard_fields.album.as_deref(),
            standard_fields.album_artist.as_deref(),
            standard_fields.track_number.map(|n| n as i32),
            standard_fields.disc_number.map(|n| n as i32),
            standard_fields
                .duration_seconds
                .map(|secs| std::time::Duration::from_secs(secs)),
            standard_fields.genre.as_deref(),
            standard_fields.year.map(|n| n as i32),
        )
        .await?;

    Ok(true)
}

/// Get songs that need waveform generation
async fn get_songs_for_waveform_generation(
    repository: &MusicRepository,
    limit: i32,
    force: bool,
) -> Result<Vec<Song>, Box<dyn std::error::Error>> {
    let songs = repository
        .get_songs_for_waveform_generation(limit, force)
        .await
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

    Ok(songs)
}

/// Get songs that need directory art generation
async fn get_songs_for_directory_art_generation(
    repository: &MusicRepository,
    limit: i32,
    force: bool,
) -> Result<Vec<Song>, Box<dyn std::error::Error>> {
    let songs = repository
        .get_songs_for_directory_art_generation(limit, force)
        .await
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

    Ok(songs)
}

/// Generate waveform for a single song
async fn generate_waveform_for_song(
    repository: &MusicRepository,
    song: &Song,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("    🔄 Generating waveform for song: {}", song.title);

    // Create waveform generator
    let generator = WaveformGenerator::new();

    // Get the media blob service to access the original audio file
    let media_blob_repository = MediaBlobRepository::new(repository.pool().clone());
    let media_blob_service = MediaBlobService::new(media_blob_repository);

    // Get the original audio file's blob metadata
    let audio_blob = media_blob_service
        .get_media_blob(&song.media_blob_id)
        .await?;

    // Audio files should be stored on filesystem (local_path), not in database
    let audio_path = audio_blob
        .local_path
        .ok_or("Audio file has no local path")?;

    // Generate waveform using the WaveformGenerator
    let waveform_data = generator.generate_waveform(&audio_path).await?;

    // Convert waveform PNG to WebP format for storage
    let webp_data = convert_image_to_webp(&waveform_data.png_data)?;

    // Create SHA256 hash for the WebP data
    let hash = hash_bytes(&webp_data);

    // Create a new media blob for the waveform (stored in database as WebP)
    let waveform_blob = CreateMediaBlob {
        data: Some(webp_data.clone()),
        sha256: hash,
        size: Some(webp_data.len() as i64),
        mime: Some("image/webp".to_string()),
        source_client_id: Some("music-cli-waveform".to_string()),
        local_path: None, // Store in database, not filesystem
        parent_blob_id: Some(song.media_blob_id.clone()),
        blob_type: Some("waveform".to_string()),
        content_id: None,
        metadata: serde_json::json!({
            "waveform_source": "grimoire_waveform_generator",
            "original_audio": audio_path,
            "dimensions": {
                "width": waveform_data.config.width,
                "height": waveform_data.config.height
            },
            "converted_to_webp": true,
            "duration_seconds": waveform_data.duration_seconds
        }),
    };

    // Save the waveform blob
    let saved_blob = media_blob_service.create_media_blob(waveform_blob).await?;

    // Update the song record with the waveform blob ID
    repository
        .update_song_waveform_blob_id(song.id, &saved_blob.id)
        .await
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

    println!("    ✅ Generated waveform: {}", saved_blob.id);
    Ok(())
}

/// Generate directory art for a single song
async fn generate_directory_art_for_song(
    detector: &DirectoryArtDetector,
    repository: &MusicRepository,
    song: &Song,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("    🔄 Generating directory art for song: {}", song.title);

    // Get the media blob service to access the original audio file
    let media_blob_repository = MediaBlobRepository::new(repository.pool().clone());
    let media_blob_service = MediaBlobService::new(media_blob_repository);

    // Get the original audio file's blob metadata
    let audio_blob = media_blob_service
        .get_media_blob(&song.media_blob_id)
        .await?;

    // Audio files should be stored on filesystem (local_path)
    let audio_path = audio_blob
        .local_path
        .ok_or("Audio file has no local path")?;
    let audio_dir = Path::new(&audio_path)
        .parent()
        .ok_or("Cannot get parent directory")?;

    // Find directory images using the detector
    let directory_images = detector.find_directory_images(audio_dir).await?;

    if directory_images.is_empty() {
        return Err("No suitable directory images found".into());
    }

    println!("    📸 Found {} directory images", directory_images.len());

    // Process all images and create blobs
    let mut created_blob_ids = Vec::new();

    for (_i, image) in directory_images.iter().enumerate() {
        // Read the image data
        let image_data = std::fs::read(&image.path)?;

        // Convert image to WebP format for storage
        let webp_data = convert_image_to_webp(&image_data)?;

        // Create SHA256 hash for the WebP data
        let hash = hash_bytes(&webp_data);

        // Create a new media blob for the directory art (stored in database as WebP)
        let thumbnail_blob = CreateMediaBlob {
            data: Some(webp_data.clone()),
            sha256: hash.clone(),
            size: Some(webp_data.len() as i64),
            mime: Some("image/webp".to_string()),
            source_client_id: Some("music-cli-directory-art".to_string()),
            local_path: None, // Store in database, not filesystem
            parent_blob_id: Some(song.media_blob_id.clone()),
            blob_type: Some("thumbnail".to_string()),
            content_id: None,
            metadata: serde_json::json!({
                "art_source": "directory_art_detector",
                "original_audio": audio_path,
                "source_image": image.path.to_string_lossy(),
                "directory_scanned": audio_dir.to_string_lossy(),
                "converted_to_webp": true,
                "image_priority": image.priority,
                "filename": image.filename
            }),
        };

        // Save the thumbnail blob or get existing one if duplicate
        let blob_id = match media_blob_service.create_media_blob(thumbnail_blob).await {
            Ok(saved_blob) => {
                println!(
                    "    ✅ Created directory art {}: {}",
                    image.filename, saved_blob.id
                );
                saved_blob.id
            }
            Err(e) if e.to_string().contains("already exists") => {
                // Extract the SHA256 from the error and find the existing blob
                if let Ok(existing_blob) = media_blob_service.get_media_blob_by_sha256(&hash).await
                {
                    println!(
                        "    ♻️ Using existing directory art {}: {}",
                        image.filename, existing_blob.id
                    );
                    existing_blob.id
                } else {
                    return Err(format!("Failed to find existing blob: {}", e).into());
                }
            }
            Err(e) => return Err(e.into()),
        };

        created_blob_ids.push(blob_id);
    }

    if created_blob_ids.is_empty() {
        return Err("No directory art blobs could be created".into());
    }

    // Update the primary thumbnail_blob_id (first/best image)
    let primary_blob_id = &created_blob_ids[0];
    repository
        .update_song_thumbnail_blob_id_if_null(song.id, primary_blob_id)
        .await
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

    // Update thumbnail_blob_ids array with remaining images (excluding primary)
    let remaining_blob_ids: Vec<String> = if created_blob_ids.len() > 1 {
        created_blob_ids[1..].to_vec()
    } else {
        Vec::new()
    };

    if !remaining_blob_ids.is_empty() {
        repository
            .update_song_thumbnail_blob_ids(song.id, &remaining_blob_ids)
            .await?;
    }

    println!(
        "    ✅ Applied {} directory images to song (primary: {}, array: {})",
        created_blob_ids.len(),
        primary_blob_id,
        remaining_blob_ids.len()
    );

    Ok(())
}

/// Convert image data to WebP format
pub fn convert_image_to_webp(image_data: &[u8]) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    use image::ImageFormat;

    // Load the image from memory
    let img = image::load_from_memory(image_data)?;

    // Convert to WebP format
    let mut webp_data = Vec::new();
    let mut cursor = Cursor::new(&mut webp_data);

    img.write_to(&mut cursor, ImageFormat::WebP)?;

    Ok(webp_data)
}

/// Create SHA256 hash of byte data
pub fn hash_bytes(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}
