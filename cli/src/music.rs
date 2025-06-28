//! Music CLI commands for scanning and managing music libraries
//!
//! This module provides CLI commands for:
//! - Scanning music directories
//! - Resuming interrupted scans
//! - Checking scan status
//! - Managing music scan sessions

use clap::Subcommand;
use grimoire::media::{CreateMediaBlob, MediaBlobRepository, MediaTypeDetector};
use grimoire::music::{extract_metadata, extract_thumbnail, hash_file, TitleBuilder};
use grimoire::music::{ConsoleScanProgress, MusicService, ScanConfig, ScanProgress, ScannerConfig};
use grimoire::{AppConfig, DatabaseConnection};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::signal;
use uuid::Uuid;

/// Music management commands
#[derive(Debug, Clone, Subcommand)]
pub enum MusicCommands {
    /// Scan a directory for music files
    Scan {
        /// Path to the music directory to scan
        path: PathBuf,

        /// Optional session name for identification
        #[arg(long, short)]
        name: Option<String>,

        /// Maximum depth to scan into subdirectories
        #[arg(long, short)]
        depth: Option<usize>,

        /// Batch size for processing files
        #[arg(long, short, default_value = "50")]
        batch_size: usize,

        /// File extensions to include (comma-separated, e.g. "mp3,flac,wav")
        #[arg(long)]
        extensions: Option<String>,

        /// Skip files larger than this size in MB
        #[arg(long)]
        max_size_mb: Option<u64>,
    },

    /// Resume a previously interrupted scan
    Resume {
        /// Session ID to resume
        session_id: Uuid,
    },

    /// Show status of all music scan sessions
    Status {
        /// Show only active sessions
        #[arg(long, short)]
        active: bool,

        /// Show detailed information
        #[arg(long, short)]
        verbose: bool,
    },

    /// Show detailed information about a specific scan session
    Info {
        /// Session ID to show info for
        session_id: Uuid,
    },

    /// Cancel a running scan session
    Cancel {
        /// Session ID to cancel
        session_id: Uuid,
    },

    /// Clean up old completed scan sessions
    Cleanup {
        /// Number of days to keep (default: 30)
        #[arg(long, short, default_value = "30")]
        days: i32,
    },

    /// Test database connectivity and show record counts
    Test,
}

impl MusicCommands {
    /// Execute the music command
    pub async fn handle(&self, db: &DatabaseConnection) -> Result<(), Box<dyn std::error::Error>> {
        let config = AppConfig::default();
        let service = MusicService::new(db, &config);

        match self {
            Self::Scan {
                path,
                name,
                depth,
                batch_size,
                extensions,
                max_size_mb,
            } => {
                self.handle_scan(
                    &service,
                    path.clone(),
                    name.clone(),
                    *depth,
                    *batch_size,
                    extensions.clone(),
                    *max_size_mb,
                )
                .await
            }
            Self::Resume { session_id } => self.handle_resume(&service, *session_id).await,
            Self::Status { active, verbose } => {
                self.handle_status(&service, *active, *verbose).await
            }
            Self::Info { session_id } => self.handle_info(&service, *session_id).await,
            Self::Cancel { session_id } => self.handle_cancel(&service, *session_id).await,
            Self::Cleanup { days } => self.handle_cleanup(&service, *days).await,
            Self::Test => self.handle_test(&service).await,
        }
    }

    /// Handle music directory scan command
    async fn handle_scan(
        &self,
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
        std::io::Write::flush(&mut std::io::stdout())?;

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
            progress.on_file_processed(file_path, processed_count);

            // Process the audio file
            match self
                .process_audio_file(
                    &service,
                    file_path,
                    session_id,
                    max_size_mb.map(|mb| mb * 1024 * 1024),
                )
                .await
            {
                Ok(_) => {
                    // File processed successfully - count as added
                    songs_added_total += 1;
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
    async fn handle_resume(
        &self,
        service: &MusicService<'_>,
        session_id: Uuid,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🔄 Resuming scan session: {}", session_id);

        let session = service.get_session(session_id).await?;

        if !session.can_resume() {
            return Err(format!("Session cannot be resumed. Status: {}", session.status).into());
        }

        println!("📋 Resuming: {}", session.session_name.unwrap_or_default());
        println!("📁 Directory: {}", session.base_path);
        println!(
            "📊 Progress: {}/{}",
            session.processed_files,
            session.total_files.unwrap_or(0)
        );

        let scan_result = service.resume_session(session_id).await?;
        println!(
            "✅ Session resumed successfully: {}",
            scan_result.session_name
        );

        // TODO: Implement actual resume logic by calling handle_scan with resume_from parameter
        println!("🚧 Full resume functionality will be implemented in the next iteration");

        Ok(())
    }

    /// Handle status command
    async fn handle_status(
        &self,
        service: &MusicService<'_>,
        active_only: bool,
        verbose: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let sessions = service.list_sessions(active_only).await?;

        if sessions.is_empty() {
            if active_only {
                println!("No active scan sessions found.");
            } else {
                println!("No scan sessions found.");
            }
            return Ok(());
        }

        println!("🎵 Music Scan Sessions:");
        println!();

        for session in sessions {
            println!(
                "📋 Session: {}",
                session.session_name.unwrap_or("Unnamed".to_string())
            );
            println!("   🆔 ID: {}", session.id);
            println!("   📁 Path: {}", session.base_path);
            println!("   📊 Status: {}", session.status);

            if let Some(total) = session.total_files {
                let percentage = if total > 0 {
                    (session.processed_files as f32 / total as f32) * 100.0
                } else {
                    0.0
                };
                println!(
                    "   🎯 Progress: {}/{} ({:.1}%)",
                    session.processed_files, total, percentage
                );
            } else {
                println!(
                    "   🎯 Progress: {} files processed",
                    session.processed_files
                );
            }

            if verbose {
                println!("   ➕ Songs added: {}", session.songs_added);
                println!("   🔄 Songs updated: {}", session.songs_updated);
                println!("   ⏭️  Songs skipped: {}", session.songs_skipped);
                println!("   ❌ Errors: {}", session.errors_encountered);
            }

            println!();
        }

        Ok(())
    }

    /// Handle info command
    async fn handle_info(
        &self,
        service: &MusicService<'_>,
        session_id: Uuid,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let stats = service.get_session_stats(session_id).await?;

        println!("🎵 Music Scan Session Details");
        println!();
        println!("🆔 Session ID: {}", session_id);
        println!("📁 Base Path: {}", stats.base_path);
        println!("📊 Status: {}", stats.status.as_str());

        if let Some(total) = stats.total_files {
            let percentage = if total > 0 {
                (stats.processed_files as f32 / total as f32) * 100.0
            } else {
                0.0
            };
            println!(
                "🎯 Progress: {}/{} ({:.1}%)",
                stats.processed_files, total, percentage
            );
        }

        if let Some(elapsed) = stats.elapsed_time_minutes {
            println!("⏱️  Elapsed Time: {} minutes", elapsed);
        }

        if let Some(remaining) = stats.estimated_remaining_minutes {
            println!("⏳ Estimated Remaining: {} minutes", remaining);
        }

        println!();
        println!("📈 Statistics:");
        println!("   ➕ Songs Added: {}", stats.songs_added);
        println!("   🔄 Songs Updated: {}", stats.songs_updated);
        println!("   ⏭️  Songs Skipped: {}", stats.songs_skipped);
        println!("   ❌ Errors: {}", stats.errors_encountered);

        println!();
        println!("💼 Job Queue Status:");
        println!("   ⏳ Pending Jobs: {}", stats.jobs_pending);
        println!("   🔄 In Progress: {}", stats.jobs_in_progress);
        println!("   ✅ Completed: {}", stats.jobs_completed);
        println!("   ❌ Failed: {}", stats.jobs_failed);

        Ok(())
    }

    /// Handle cancel command
    async fn handle_cancel(
        &self,
        service: &MusicService<'_>,
        session_id: Uuid,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🛑 Cancelling scan session: {}", session_id);

        let success = service.cancel_session(session_id).await?;

        if success {
            println!("✅ Session cancelled successfully");
        } else {
            println!("❌ Failed to cancel session (it may not exist or already be completed)");
        }

        Ok(())
    }

    /// Handle cleanup command
    async fn handle_cleanup(
        &self,
        service: &MusicService<'_>,
        days: i32,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🧹 Cleaning up scan sessions older than {} days...", days);

        let result = service.cleanup_old_sessions(days).await?;

        println!("✅ Cleanup completed:");
        println!("   🗑️  Sessions deleted: {}", result.sessions_deleted);
        println!("   🗑️  Jobs deleted: {}", result.jobs_deleted);

        Ok(())
    }

    /// Handle test command - show database record counts
    async fn handle_test(
        &self,
        service: &MusicService<'_>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🧪 Testing database connectivity and showing record counts...");

        // Count media blobs
        let media_blob_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM media_blobs WHERE source_client_id = 'music-cli'",
        )
        .fetch_one(service.db().pool())
        .await?;

        // Count thumbnail blobs
        let thumbnail_blob_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM media_blobs WHERE source_client_id = 'music-cli-thumbnail'",
        )
        .fetch_one(service.db().pool())
        .await?;

        // Count songs
        let song_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM songs")
            .fetch_one(service.db().pool())
            .await?;

        // Count scan sessions
        let session_count =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM music_scan_sessions")
                .fetch_one(service.db().pool())
                .await?;

        println!("📊 Database Record Counts:");
        println!("   🎵 Songs: {}", song_count);
        println!("   📁 Media Blobs (music-cli): {}", media_blob_count);
        println!("   🖼️  Thumbnail Blobs: {}", thumbnail_blob_count);
        println!("   📋 Scan Sessions: {}", session_count);

        // Show recent songs with thumbnail status
        let recent_songs = sqlx::query!(
            r#"
            SELECT id, title, artist, album, thumbnail_blob_id
            FROM songs
            ORDER BY created_at DESC
            LIMIT 5
            "#
        )
        .fetch_all(service.db().pool())
        .await?;

        if !recent_songs.is_empty() {
            println!("\n🎼 Recent Songs:");
            for song in recent_songs {
                let thumbnail_status = if song.thumbnail_blob_id.is_some() {
                    " 🖼️"
                } else {
                    ""
                };
                println!(
                    "   • {} by {} (Album: {}{})",
                    song.title,
                    song.artist.unwrap_or("Unknown Artist".to_string()),
                    song.album.unwrap_or("Unknown Album".to_string()),
                    thumbnail_status
                );
            }
        }

        Ok(())
    }

    /// Process a single audio file - extract metadata, create media blob and song record
    async fn process_audio_file(
        &self,
        music_service: &MusicService<'_>,
        file_path: &std::path::Path,
        _session_id: Uuid,
        max_size_bytes: Option<u64>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // Check file size if limit is set
        if let Some(max_bytes) = max_size_bytes {
            let metadata = std::fs::metadata(file_path)?;

            if metadata.len() > max_bytes {
                let size_mb = metadata.len() / (1024 * 1024);
                let max_mb = max_bytes / (1024 * 1024);
                return Err(
                    format!("File too large: {} MB (limit: {} MB)", size_mb, max_mb).into(),
                );
            }
        }

        // Extract audio metadata
        let audio_metadata = extract_metadata(file_path).await?;

        // Generate file hash
        let file_hash = hash_file(file_path).await?;

        // Create media blob repository
        let media_repository = MediaBlobRepository::new(music_service.db().pool().clone());

        // Check if file already exists by hash
        // TODO: Add duplicate checking once MediaBlobService supports it

        // Read file content
        let file_content = tokio::fs::read(file_path).await?;
        let file_size = file_content.len() as i64;

        // Detect MIME type
        let config = AppConfig::default();
        let type_detector = MediaTypeDetector::from_config(&config);
        let mime_type = type_detector
            .get_mime_type(file_path)
            .unwrap_or_else(|_| "audio/mpeg".to_string());

        // Create media blob
        let create_blob = CreateMediaBlob {
            data: Some(file_content),
            sha256: file_hash.clone(),
            size: Some(file_size),
            mime: Some(mime_type.clone()),
            source_client_id: Some("music-cli".to_string()),
            local_path: Some(file_path.to_string_lossy().to_string()),
            parent_blob_id: None, // This is an original audio file, not a thumbnail
            blob_type: Some("original".to_string()),
            metadata: serde_json::json!({
                "audio_metadata": audio_metadata,
                "scan_source": "cli",
                "filename": file_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|s| s.to_string())
            }),
        };

        let media_blob = media_repository.create(create_blob).await?;

        // Try to extract embedded album art thumbnail
        let thumbnail_blob_id = match extract_thumbnail(file_path).await {
            Ok(Some(extracted_image)) => {
                // Create thumbnail media blob
                let thumbnail_hash = format!("{}_thumbnail", file_hash);

                let thumbnail_create_blob = CreateMediaBlob {
                    data: Some(extracted_image.data.clone()),
                    sha256: thumbnail_hash,
                    size: Some(extracted_image.data.len() as i64),
                    mime: Some(extracted_image.format.content_type().to_string()),
                    source_client_id: Some("music-cli-thumbnail".to_string()),
                    local_path: None,
                    parent_blob_id: Some(media_blob.id),
                    blob_type: Some("thumbnail".to_string()),
                    metadata: serde_json::json!({
                        "thumbnail_source": "embedded_album_art",
                        "extracted_from": file_path.to_string_lossy(),
                        "image_format": format!("{:?}", extracted_image.format),
                        "dimensions": extracted_image.dimensions
                    }),
                };

                match media_repository.create(thumbnail_create_blob).await {
                    Ok(thumbnail_blob) => {
                        println!("  🖼️  Extracted album art thumbnail: {}", thumbnail_blob.id);
                        Some(thumbnail_blob.id)
                    }
                    Err(e) => {
                        eprintln!("  ⚠️  Failed to save thumbnail: {}", e);
                        None
                    }
                }
            }
            Ok(None) => {
                println!("  📷 No embedded album art found");
                None
            }
            Err(e) => {
                eprintln!("  ⚠️  Error extracting thumbnail: {}", e);
                None
            }
        };

        // Build smart title using TitleBuilder
        let title_builder = TitleBuilder::new();
        let audio_meta = grimoire::music::AudioMetadata::new(
            audio_metadata.tags.tags.clone(),
            file_path.to_string_lossy().to_string(),
        );
        let smart_title = title_builder.build_title(&audio_meta);

        // Extract individual metadata fields
        let artist = audio_metadata
            .tags
            .tags
            .get("Artist")
            .or_else(|| audio_metadata.tags.tags.get("ARTIST"))
            .cloned();
        let album = audio_metadata
            .tags
            .tags
            .get("Album")
            .or_else(|| audio_metadata.tags.tags.get("ALBUM"))
            .cloned();
        let album_artist = audio_metadata
            .tags
            .tags
            .get("AlbumArtist")
            .or_else(|| audio_metadata.tags.tags.get("ALBUMARTIST"))
            .cloned();
        let track_number = audio_metadata
            .tags
            .tags
            .get("TrackNumber")
            .or_else(|| audio_metadata.tags.tags.get("TRACKNUMBER"))
            .and_then(|s| s.parse::<i32>().ok());
        let disc_number = audio_metadata
            .tags
            .tags
            .get("DiscNumber")
            .or_else(|| audio_metadata.tags.tags.get("DISCNUMBER"))
            .and_then(|s| s.parse::<i32>().ok());
        let genre = audio_metadata
            .tags
            .tags
            .get("Genre")
            .or_else(|| audio_metadata.tags.tags.get("GENRE"))
            .cloned();
        let year = audio_metadata
            .tags
            .tags
            .get("Year")
            .or_else(|| audio_metadata.tags.tags.get("DATE"))
            .and_then(|s| s.parse::<i32>().ok());

        // Create song record (skip duration for now due to interval type complexity)
        let song_result = sqlx::query!(
            r#"
            INSERT INTO songs (
                media_blob_id, thumbnail_blob_id, title, artist, album, album_artist,
                track_number, disc_number, genre, year,
                metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id
            "#,
            media_blob.id,
            thumbnail_blob_id,
            smart_title,
            artist,
            album,
            album_artist,
            track_number,
            disc_number.unwrap_or(1),
            genre,
            year,
            serde_json::json!({
                "audio_properties": audio_metadata.properties,
                "original_tags": audio_metadata.tags.tags,
                "processing_info": {
                    "processed_at": time::OffsetDateTime::now_utc(),
                    "processor": "music-cli",
                    "file_path": file_path.to_string_lossy()
                },
                "duration_seconds": audio_metadata.properties.duration_seconds,
                "has_embedded_thumbnail": thumbnail_blob_id.is_some()
            })
        )
        .fetch_one(music_service.db().pool())
        .await?;

        let thumbnail_info = if thumbnail_blob_id.is_some() {
            " + Thumbnail"
        } else {
            ""
        };

        println!(
            "✅ Processed: {} -> Song ID: {} (Media Blob: {}{})",
            file_path.display(),
            song_result.id,
            media_blob.id,
            thumbnail_info
        );

        // TODO: Queue waveform generation job

        Ok(())
    }
}
