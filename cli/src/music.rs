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
use grimoire::music::{CreatePlaylist, MusicRepository, PlaylistQuery, PlaylistService, SongQuery};
use grimoire::{AppConfig, DatabaseConnection};
use std::io::{self, Write};
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

    /// List all songs with their IDs and titles
    Songs {
        /// Show only favorites
        #[arg(long, short)]
        favorites: bool,

        /// Filter by artist (partial match)
        #[arg(long, short)]
        artist: Option<String>,

        /// Filter by album (partial match)
        #[arg(long)]
        album: Option<String>,

        /// Limit number of results
        #[arg(long, short, default_value = "50")]
        limit: i64,

        /// Offset for pagination
        #[arg(long, short)]
        offset: Option<i64>,
    },

    /// List all playlists
    Playlists {
        /// Show only public playlists
        #[arg(long, short)]
        public: bool,

        /// Show detailed information
        #[arg(long, short)]
        verbose: bool,
    },

    /// Create a new playlist
    CreatePlaylist {
        /// Playlist title
        title: String,

        /// Optional description
        #[arg(long, short)]
        description: Option<String>,

        /// Make playlist public
        #[arg(long, short)]
        public: bool,

        /// Song IDs to add to playlist (comma-separated)
        #[arg(long)]
        songs: Option<String>,
    },

    /// Add songs to an existing playlist
    AddToPlaylist {
        /// Playlist title (or ID if exact match not found)
        playlist: String,

        /// Song IDs to add (comma-separated)
        songs: String,
    },

    /// Add songs to playlist by title (creates if not found)
    AddToPlaylistByTitle {
        /// Playlist title to find or create
        title: String,

        /// Song IDs to add (comma-separated)
        songs: String,

        /// Description for new playlist (if created)
        #[arg(long, short)]
        description: Option<String>,

        /// Make new playlist public (if created)
        #[arg(long, short)]
        public: bool,
    },

    /// Remove songs from a playlist
    RemoveFromPlaylist {
        /// Playlist title (or ID if exact match not found)
        playlist: String,

        /// Song IDs to remove (comma-separated)
        songs: String,
    },

    /// Show songs in a playlist
    ShowPlaylist {
        /// Playlist title (or ID if exact match not found)
        playlist: String,

        /// Show detailed song information
        #[arg(long, short)]
        verbose: bool,
    },

    /// Delete a playlist
    DeletePlaylist {
        /// Playlist title (or ID if exact match not found)
        playlist: String,

        /// Skip confirmation prompt
        #[arg(long, short)]
        force: bool,
    },

    /// Move song to different position in playlist
    MoveSong {
        /// Playlist title (or ID if exact match not found)
        playlist: String,

        /// Song ID to move
        song_id: Uuid,

        /// New position (1-based)
        position: i32,
    },

    /// Reorder entire playlist
    ReorderPlaylist {
        /// Playlist title (or ID if exact match not found)
        playlist: String,

        /// Song IDs in new order (comma-separated)
        song_ids: String,
    },

    /// Show playlist summaries
    PlaylistSummaries {
        /// Limit number of results
        #[arg(long, short, default_value = "20")]
        limit: i64,
    },

    /// Show album summaries
    Albums {
        /// Limit number of results
        #[arg(long, short, default_value = "20")]
        limit: i64,
    },

    /// Show album tracks
    AlbumTracks {
        /// Album name
        album: String,

        /// Artist name (optional for filtering)
        #[arg(long, short)]
        artist: Option<String>,
    },

    /// Show artist albums
    ArtistAlbums {
        /// Artist name
        artist: String,

        /// Maximum number of albums
        #[arg(long, short, default_value = "20")]
        limit: i32,
    },

    /// Create playlist from album
    PlaylistFromAlbum {
        /// Album name
        album: String,

        /// Artist name (optional for filtering)
        #[arg(long, short)]
        artist: Option<String>,

        /// Playlist title (defaults to album name)
        #[arg(long, short)]
        title: Option<String>,

        /// Make playlist public
        #[arg(long, short)]
        public: bool,
    },
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
            Self::Songs {
                favorites,
                artist,
                album,
                limit,
                offset,
            } => {
                self.handle_songs(
                    &service,
                    *favorites,
                    artist.clone(),
                    album.clone(),
                    *limit,
                    *offset,
                )
                .await
            }
            Self::Playlists { public, verbose } => {
                self.handle_playlists(&service, *public, *verbose).await
            }
            Self::CreatePlaylist {
                title,
                description,
                public,
                songs,
            } => {
                self.handle_create_playlist(
                    &service,
                    title.clone(),
                    description.clone(),
                    *public,
                    songs.clone(),
                )
                .await
            }
            Self::AddToPlaylist { playlist, songs } => {
                self.handle_add_to_playlist(&service, playlist.clone(), songs.clone())
                    .await
            }
            Self::AddToPlaylistByTitle {
                title,
                songs,
                description,
                public,
            } => {
                self.handle_add_to_playlist_by_title(
                    &service,
                    title.clone(),
                    songs.clone(),
                    description.clone(),
                    *public,
                )
                .await
            }
            Self::RemoveFromPlaylist { playlist, songs } => {
                self.handle_remove_from_playlist(&service, playlist.clone(), songs.clone())
                    .await
            }
            Self::ShowPlaylist { playlist, verbose } => {
                self.handle_show_playlist(&service, playlist.clone(), *verbose)
                    .await
            }
            Self::DeletePlaylist { playlist, force } => {
                self.handle_delete_playlist(&service, playlist.clone(), *force)
                    .await
            }
            Self::MoveSong {
                playlist,
                song_id,
                position,
            } => {
                self.handle_move_song(&service, playlist.clone(), *song_id, *position)
                    .await
            }
            Self::ReorderPlaylist { playlist, song_ids } => {
                self.handle_reorder_playlist(&service, playlist.clone(), song_ids.clone())
                    .await
            }
            Self::PlaylistSummaries { limit } => {
                self.handle_playlist_summaries(&service, *limit).await
            }
            Self::Albums { limit } => self.handle_albums(&service, *limit).await,
            Self::AlbumTracks { album, artist } => {
                self.handle_album_tracks(&service, album.clone(), artist.clone())
                    .await
            }
            Self::ArtistAlbums { artist, limit } => {
                self.handle_artist_albums(&service, artist.clone(), *limit)
                    .await
            }
            Self::PlaylistFromAlbum {
                album,
                artist,
                title,
                public,
            } => {
                self.handle_playlist_from_album(
                    &service,
                    album.clone(),
                    artist.clone(),
                    title.clone(),
                    *public,
                )
                .await
            }
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

    /// Handle listing songs command
    async fn handle_songs(
        &self,
        service: &MusicService<'_>,
        favorites: bool,
        artist: Option<String>,
        album: Option<String>,
        limit: i64,
        offset: Option<i64>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🎵 Songs:");
        println!("=========");

        let repository = MusicRepository::new(service.db().pool().clone());
        let playlist_service = PlaylistService::new(repository);

        let query = SongQuery {
            favorites_only: if favorites { Some(true) } else { None },
            artist,
            album,
            limit: Some(limit),
            offset,
            ..Default::default()
        };

        let songs = playlist_service.query_songs(query).await?;

        if songs.is_empty() {
            println!("No songs found.");
            return Ok(());
        }

        for song in songs {
            let favorite_indicator = if song.is_favorite { " ⭐" } else { "" };
            println!(
                "  {} | {}{}",
                song.id,
                song.detailed_display_title(),
                favorite_indicator
            );
        }

        Ok(())
    }

    /// Handle listing playlists command
    async fn handle_playlists(
        &self,
        service: &MusicService<'_>,
        public: bool,
        verbose: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("📋 Playlists:");
        println!("=============");

        let repository = MusicRepository::new(service.db().pool().clone());
        let playlist_service = PlaylistService::new(repository);

        let query = PlaylistQuery {
            public_only: if public { Some(true) } else { None },
            ..Default::default()
        };

        let playlists = playlist_service.query_playlists(query).await?;

        if playlists.is_empty() {
            println!("No playlists found.");
            return Ok(());
        }

        for playlist_with_count in playlists {
            let playlist = &playlist_with_count.playlist;
            let song_count = playlist_with_count.song_count;
            let visibility = playlist.visibility_string();

            if verbose {
                println!(
                    "  {} | {} ({} songs) [{}]",
                    playlist.id, playlist.title, song_count, visibility
                );
                if let Some(ref desc) = playlist.description {
                    println!("    Description: {}", desc);
                }
            } else {
                println!(
                    "  {} | {} ({} songs)",
                    playlist.id, playlist.title, song_count
                );
            }
        }

        Ok(())
    }

    /// Handle creating a new playlist
    async fn handle_create_playlist(
        &self,
        service: &MusicService<'_>,
        title: String,
        description: Option<String>,
        public: bool,
        songs: Option<String>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("📝 Creating playlist: {}", title);

        let repository = MusicRepository::new(service.db().pool().clone());
        let playlist_service = PlaylistService::new(repository);

        let create_params = CreatePlaylist {
            title: title.clone(),
            description,
            client_id: Some("cli".to_string()),
            is_public: Some(public),
            is_collaborative: Some(false),
            metadata: None,
        };

        let song_ids = if let Some(song_ids_str) = songs {
            match playlist_service.parse_song_ids(&song_ids_str) {
                Ok(ids) => Some(ids),
                Err(e) => {
                    println!("❌ Error parsing song IDs: {}", e);
                    None
                }
            }
        } else {
            None
        };

        match playlist_service
            .create_playlist_with_songs(create_params, song_ids, Some("cli".to_string()))
            .await
        {
            Ok((playlist, added_song_ids)) => {
                println!(
                    "✅ Created playlist: {} (ID: {})",
                    playlist.title, playlist.id
                );

                for song_id in added_song_ids {
                    println!("  ➕ Added song {}", song_id);
                }
            }
            Err(e) => {
                println!("❌ Failed to create playlist: {}", e);
            }
        }

        Ok(())
    }

    /// Handle adding songs to playlist
    async fn handle_add_to_playlist(
        &self,
        service: &MusicService<'_>,
        playlist_input: String,
        songs_input: String,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repository = MusicRepository::new(service.db().pool().clone());
        let playlist_service = PlaylistService::new(repository);

        // Parse song IDs
        let song_ids = match playlist_service.parse_song_ids(&songs_input) {
            Ok(ids) => ids,
            Err(e) => {
                println!("❌ Error parsing song IDs: {}", e);
                return Ok(());
            }
        };

        match playlist_service
            .add_songs_to_playlist_by_title_or_id(
                &playlist_input,
                song_ids,
                Some("cli".to_string()),
            )
            .await
        {
            Ok((playlist, added, skipped)) => {
                println!("📋 Adding songs to playlist: {}", playlist.title);

                for song_id in added {
                    println!("  ➕ Added song {}", song_id);
                }

                for song_id in skipped {
                    println!(
                        "⚠️  Song {} not found or already in playlist, skipping",
                        song_id
                    );
                }
            }
            Err(e) => {
                println!("❌ Failed to add songs to playlist: {}", e);
            }
        }

        Ok(())
    }

    /// Handle adding songs to playlist by title (creates if not found)
    async fn handle_add_to_playlist_by_title(
        &self,
        service: &MusicService<'_>,
        title: String,
        songs_input: String,
        description: Option<String>,
        public: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repository = MusicRepository::new(service.db().pool().clone());
        let playlist_service = PlaylistService::new(repository);

        // Parse song IDs
        let song_ids = match playlist_service.parse_song_ids(&songs_input) {
            Ok(ids) => ids,
            Err(e) => {
                println!("❌ Error parsing song IDs: {}", e);
                return Ok(());
            }
        };

        // Find playlists by exact title match
        let repository = playlist_service.repository();
        let existing_playlists = match repository.find_playlists_by_title(&title, true).await {
            Ok(playlists) => playlists,
            Err(e) => {
                println!("❌ Error searching for playlists: {}", e);
                return Ok(());
            }
        };

        let playlist = match existing_playlists.len() {
            0 => {
                // No playlist found - create new one
                println!(
                    "📋 No playlist found with title '{}', creating new playlist...",
                    title
                );

                let create_params = grimoire::music::models::CreatePlaylist {
                    title: title.clone(),
                    description,
                    client_id: Some("cli".to_string()),
                    is_public: Some(public),
                    is_collaborative: Some(false),
                    metadata: None,
                };

                match repository.create_playlist(create_params).await {
                    Ok(playlist) => {
                        println!("✅ Created new playlist: {}", playlist.title);
                        playlist
                    }
                    Err(e) => {
                        println!("❌ Failed to create playlist: {}", e);
                        return Ok(());
                    }
                }
            }
            1 => {
                // Exactly one playlist found
                let playlist = existing_playlists.into_iter().next().unwrap();
                println!("📋 Found existing playlist: {}", playlist.title);
                playlist
            }
            _ => {
                // Multiple playlists found
                println!(
                    "❌ Multiple playlists found with title '{}'. Please be more specific:",
                    title
                );
                for playlist in existing_playlists {
                    println!("  - {} (ID: {})", playlist.title, playlist.id);
                }
                return Ok(());
            }
        };

        // Add songs to the playlist individually
        println!("📋 Adding songs to playlist: {}", playlist.title);

        // Get current max position to determine where to start adding
        let current_songs = match repository.get_playlist_songs(playlist.id).await {
            Ok(songs) => songs,
            Err(_) => Vec::new(),
        };

        let mut next_position = current_songs.len() as i32 + 1;
        let mut added_count = 0;
        let mut skipped_count = 0;

        for song_id in song_ids {
            // Check if song exists
            match repository.get_song(song_id).await {
                Ok(_) => {
                    // Song exists, check if already in playlist
                    match repository.is_song_in_playlist(playlist.id, song_id).await {
                        Ok(true) => {
                            println!("  ⚠️  Song {} already in playlist, skipping", song_id);
                            skipped_count += 1;
                        }
                        Ok(false) => {
                            // Add song to playlist
                            match repository
                                .add_song_at_position(
                                    playlist.id,
                                    song_id,
                                    next_position,
                                    Some("cli".to_string()),
                                )
                                .await
                            {
                                Ok(playlist_song) => {
                                    println!(
                                        "  ➕ Added song {} at position {}",
                                        song_id, playlist_song.position
                                    );
                                    added_count += 1;
                                    next_position += 1;
                                }
                                Err(e) => {
                                    println!("  ❌ Failed to add song {}: {}", song_id, e);
                                    skipped_count += 1;
                                }
                            }
                        }
                        Err(e) => {
                            println!(
                                "  ❌ Error checking if song {} is in playlist: {}",
                                song_id, e
                            );
                            skipped_count += 1;
                        }
                    }
                }
                Err(_) => {
                    println!("  ❌ Song {} not found, skipping", song_id);
                    skipped_count += 1;
                }
            }
        }

        println!(
            "✅ Added {} songs, skipped {} songs",
            added_count, skipped_count
        );

        Ok(())
    }

    /// Handle removing songs from playlist
    async fn handle_remove_from_playlist(
        &self,
        service: &MusicService<'_>,
        playlist_input: String,
        songs_input: String,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repository = MusicRepository::new(service.db().pool().clone());
        let playlist_service = PlaylistService::new(repository);

        // Parse song IDs
        let song_ids = match playlist_service.parse_song_ids(&songs_input) {
            Ok(ids) => ids,
            Err(e) => {
                println!("❌ Error parsing song IDs: {}", e);
                return Ok(());
            }
        };

        match playlist_service
            .remove_songs_from_playlist_by_title_or_id(&playlist_input, song_ids)
            .await
        {
            Ok((playlist, removed_count, not_found)) => {
                println!("📋 Removing songs from playlist: {}", playlist.title);

                if removed_count > 0 {
                    println!("  ➖ Removed {} song(s)", removed_count);
                }

                for song_id in not_found {
                    println!("⚠️  Song {} not found in playlist", song_id);
                }
            }
            Err(e) => {
                println!("❌ Failed to remove songs from playlist: {}", e);
            }
        }

        Ok(())
    }

    /// Handle showing playlist contents
    async fn handle_show_playlist(
        &self,
        service: &MusicService<'_>,
        playlist_input: String,
        verbose: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repository = MusicRepository::new(service.db().pool().clone());
        let playlist_service = PlaylistService::new(repository);

        match playlist_service
            .get_playlist_songs_by_title_or_id(&playlist_input)
            .await
        {
            Ok(playlist_songs) => {
                // We need to get the playlist title separately since get_playlist_songs_by_title_or_id
                // returns the songs but we need the playlist info too
                let playlist = playlist_service
                    .find_playlist_by_title_or_id(&playlist_input)
                    .await?;

                println!("📋 Playlist: {}", playlist.title);
                println!("{}", "=".repeat(playlist.title.len() + 12));

                if playlist_songs.is_empty() {
                    println!("Empty playlist.");
                    return Ok(());
                }

                for playlist_song in playlist_songs {
                    let song = &playlist_song.song;

                    if verbose {
                        let duration_str = song
                            .formatted_duration()
                            .unwrap_or_else(|| "Unknown".to_string());
                        let favorite_indicator = if song.is_favorite { " ⭐" } else { "" };
                        println!(
                            "  {}. {} | {} [{}]{}",
                            playlist_song.position,
                            song.id,
                            song.detailed_display_title(),
                            duration_str,
                            favorite_indicator
                        );
                    } else {
                        println!(
                            "  {}. {} | {}",
                            playlist_song.position,
                            song.id,
                            song.detailed_display_title()
                        );
                    }
                }
            }
            Err(e) => {
                println!("❌ Failed to show playlist: {}", e);
            }
        }

        Ok(())
    }

    /// Handle deleting a playlist
    async fn handle_delete_playlist(
        &self,
        service: &MusicService<'_>,
        playlist_input: String,
        force: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repository = MusicRepository::new(service.db().pool().clone());
        let playlist_service = PlaylistService::new(repository);

        // Find the playlist first
        let playlist = match playlist_service
            .find_playlist_by_title_or_id(&playlist_input)
            .await
        {
            Ok(playlist) => playlist,
            Err(e) => {
                println!("❌ Playlist '{}' not found: {}", playlist_input, e);
                return Ok(());
            }
        };

        if !force {
            // Check song count
            let song_count = playlist_service
                .get_playlist_song_count(playlist.id)
                .await?;

            println!(
                "⚠️  About to delete playlist '{}' with {} songs.",
                playlist.title, song_count
            );
            print!("Are you sure? (y/N): ");
            io::stdout().flush()?;

            let mut input = String::new();
            io::stdin().read_line(&mut input)?;

            if !input.trim().to_lowercase().starts_with('y') {
                println!("Cancelled.");
                return Ok(());
            }
        }

        match playlist_service.delete_playlist(playlist.id, None).await {
            Ok(_) => {
                println!("✅ Deleted playlist: {}", playlist.title);
            }
            Err(e) => {
                println!("❌ Failed to delete playlist: {}", e);
            }
        }

        Ok(())
    }

    /// Handle moving song in playlist
    async fn handle_move_song(
        &self,
        service: &MusicService<'_>,
        playlist_input: String,
        song_id: Uuid,
        position: i32,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repository = MusicRepository::new(service.db().pool().clone());
        let playlist_service = PlaylistService::new(repository);

        match playlist_service
            .move_playlist_song_by_title_or_id(&playlist_input, song_id, position)
            .await
        {
            Ok(playlist) => {
                println!(
                    "✅ Moved song {} to position {} in playlist '{}'",
                    song_id, position, playlist.title
                );
            }
            Err(e) => {
                println!("❌ Failed to move song: {}", e);
            }
        }

        Ok(())
    }

    /// Handle reordering playlist
    async fn handle_reorder_playlist(
        &self,
        service: &MusicService<'_>,
        playlist_input: String,
        song_ids_str: String,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repository = MusicRepository::new(service.db().pool().clone());
        let playlist_service = PlaylistService::new(repository);

        // Parse song IDs
        let song_ids = match playlist_service.parse_song_ids(&song_ids_str) {
            Ok(ids) => ids,
            Err(e) => {
                println!("❌ Error parsing song IDs: {}", e);
                return Ok(());
            }
        };

        match playlist_service
            .reorder_playlist_by_title_or_id(&playlist_input, &song_ids)
            .await
        {
            Ok(playlist) => {
                println!(
                    "✅ Reordered {} songs in playlist '{}'",
                    song_ids.len(),
                    playlist.title
                );
            }
            Err(e) => {
                println!("❌ Failed to reorder playlist: {}", e);
            }
        }

        Ok(())
    }

    /// Handle playlist summaries
    async fn handle_playlist_summaries(
        &self,
        service: &MusicService<'_>,
        limit: i64,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("📋 Playlist Summaries:");
        println!("======================");

        let repository = MusicRepository::new(service.db().pool().clone());
        let playlist_service = PlaylistService::new(repository);

        match playlist_service.get_playlist_summaries(Some(limit)).await {
            Ok(summaries) => {
                if summaries.is_empty() {
                    println!("No playlists found.");
                    return Ok(());
                }

                for summary in summaries {
                    let duration = summary
                        .formatted_total_duration()
                        .unwrap_or_else(|| "Unknown".to_string());
                    let visibility = summary.visibility_string();

                    println!(
                        "  {} | {} ({} songs, {}) [{}]",
                        summary.id, summary.title, summary.song_count, duration, visibility
                    );

                    if let Some(ref description) = summary.description {
                        println!("    Description: {}", description);
                    }

                    let preview = summary.song_preview();
                    if preview != "Empty playlist" {
                        println!("    Songs: {}", preview);
                    }

                    println!();
                }
            }
            Err(e) => {
                println!("❌ Failed to get playlist summaries: {}", e);
            }
        }

        Ok(())
    }

    /// Handle albums command
    async fn handle_albums(
        &self,
        service: &MusicService<'_>,
        limit: i64,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("💿 Albums:");
        println!("==========");

        let repository = MusicRepository::new(service.db().pool().clone());
        let playlist_service = PlaylistService::new(repository);

        match playlist_service.get_album_summaries(Some(limit)).await {
            Ok(albums) => {
                if albums.is_empty() {
                    println!("No albums found.");
                    return Ok(());
                }

                for album in albums {
                    let artist = album
                        .primary_artist()
                        .map(|a| a.as_str())
                        .unwrap_or("Unknown Artist");
                    let duration = album
                        .formatted_total_duration()
                        .unwrap_or_else(|| "Unknown".to_string());

                    println!(
                        "  {} - {} ({} tracks, {})",
                        artist,
                        album.display_name(),
                        album.track_count,
                        duration
                    );

                    if let Some(ref genres) = album.genres {
                        println!("    Genres: {}", genres);
                    }

                    if album.avg_rating.is_some() || album.favorite_count > 0 {
                        let rating = album
                            .avg_rating
                            .map(|r| format!("{:.1}★", r))
                            .unwrap_or_else(|| "Unrated".to_string());
                        println!("    Rating: {}, {} favorites", rating, album.favorite_count);
                    }

                    println!();
                }
            }
            Err(e) => {
                println!("❌ Failed to get albums: {}", e);
            }
        }

        Ok(())
    }

    /// Handle album tracks command
    async fn handle_album_tracks(
        &self,
        service: &MusicService<'_>,
        album: String,
        artist: Option<String>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🎵 Album Tracks: {}", album);
        if let Some(ref artist) = artist {
            println!("   by {}", artist);
        }
        println!("{}", "=".repeat(album.len() + 16));

        let repository = MusicRepository::new(service.db().pool().clone());
        let playlist_service = PlaylistService::new(repository);

        match playlist_service
            .get_album_tracks(&album, artist.as_deref())
            .await
        {
            Ok(tracks) => {
                if tracks.is_empty() {
                    println!("No tracks found for this album.");
                    return Ok(());
                }

                for track in tracks {
                    let duration = track
                        .formatted_duration()
                        .unwrap_or_else(|| "Unknown".to_string());
                    let favorite = if track.is_favorite { " ⭐" } else { "" };
                    let rating = track
                        .rating
                        .map(|r| format!(" ({}★)", r))
                        .unwrap_or_default();

                    println!(
                        "  {} | {} [{}]{}{}",
                        track.song_id,
                        track.track_display(),
                        duration,
                        rating,
                        favorite
                    );
                }
            }
            Err(e) => {
                println!("❌ Failed to get album tracks: {}", e);
            }
        }

        Ok(())
    }

    /// Handle artist albums command
    async fn handle_artist_albums(
        &self,
        service: &MusicService<'_>,
        artist: String,
        limit: i32,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🎤 {}'s Albums:", artist);
        println!("{}", "=".repeat(artist.len() + 11));

        let repository = MusicRepository::new(service.db().pool().clone());
        let playlist_service = PlaylistService::new(repository);

        match playlist_service
            .get_artist_albums(&artist, Some(limit))
            .await
        {
            Ok(albums) => {
                if albums.is_empty() {
                    println!("No albums found for this artist.");
                    return Ok(());
                }

                for album in albums {
                    let duration = album
                        .formatted_total_duration()
                        .unwrap_or_else(|| "Unknown".to_string());
                    let rating = album
                        .avg_rating
                        .map(|r| format!(" ({:.1}★)", r))
                        .unwrap_or_default();

                    println!(
                        "  {} ({} tracks, {}){}",
                        album.display_name(),
                        album.track_count,
                        duration,
                        rating
                    );
                }
            }
            Err(e) => {
                println!("❌ Failed to get artist albums: {}", e);
            }
        }

        Ok(())
    }

    /// Handle creating playlist from album
    async fn handle_playlist_from_album(
        &self,
        service: &MusicService<'_>,
        album: String,
        artist: Option<String>,
        title: Option<String>,
        public: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repository = MusicRepository::new(service.db().pool().clone());
        let playlist_service = PlaylistService::new(repository);

        let playlist_title = title.unwrap_or_else(|| match &artist {
            Some(artist) => format!("{} - {}", artist, album),
            None => album.clone(),
        });

        println!("📝 Creating playlist from album: {}", album);
        if let Some(ref artist) = artist {
            println!("   by {}", artist);
        }

        match playlist_service
            .create_playlist_from_album(
                playlist_title,
                &album,
                artist.as_deref(),
                Some(public),
                Some("cli".to_string()),
            )
            .await
        {
            Ok(playlist) => {
                println!(
                    "✅ Created playlist: {} (ID: {})",
                    playlist.title, playlist.id
                );

                // Show the songs that were added
                if let Ok(songs) = playlist_service.get_playlist_songs(playlist.id).await {
                    println!("   Added {} songs:", songs.len());
                    for song in songs.iter().take(5) {
                        println!("     {}. {}", song.position, song.display_title());
                    }
                    if songs.len() > 5 {
                        println!("     ... and {} more", songs.len() - 5);
                    }
                }
            }
            Err(e) => {
                println!("❌ Failed to create playlist from album: {}", e);
            }
        }

        Ok(())
    }
}
