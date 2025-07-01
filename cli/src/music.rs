//! Music CLI commands for scanning and managing music libraries
//!
//! This module provides CLI commands for:
//! - Scanning music directories
//! - Resuming interrupted scans
//! - Checking scan status
//! - Managing music scan sessions

use clap::Subcommand;
use colored::*;
use console::measure_text_width;
use grimoire::media::{CreateMediaBlob, MediaBlobRepository, MediaTypeDetector};
use grimoire::music::{extract_metadata, extract_thumbnail, hash_bytes, hash_file, TitleBuilder};
use grimoire::music::{ConsoleScanProgress, MusicService, ScanConfig, ScanProgress, ScannerConfig};
use grimoire::music::{CreatePlaylist, MusicRepository, PlaylistQuery, PlaylistService, SongQuery};
use grimoire::{AppConfig, DatabaseConnection};
use image::io::Reader as ImageReader;
use inquire::{
    ui::{Color, RenderConfig, StyleSheet, Styled},
    Select, Text,
};
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

    /// Play a single song
    PlaySong {
        /// Song ID to play
        song_id: String,

        /// Show visualizer (requires cava)
        #[arg(long, short)]
        visualize: bool,
    },

    /// Play a playlist
    PlayPlaylist {
        /// Playlist ID or title
        playlist: String,

        /// Shuffle playback
        #[arg(long, short)]
        shuffle: bool,
    },

    /// Interactive playlist selection and playback
    Play {
        /// Shuffle playback
        #[arg(long, short)]
        shuffle: bool,
    },

    /// Play playlist without interactive picker (better terminal control)
    PlayDirect {
        /// Playlist ID or title
        playlist: String,

        /// Shuffle playback
        #[arg(long, short)]
        shuffle: bool,
    },
}

impl MusicCommands {
    /// Execute the music command
    pub async fn handle(&self, db: &DatabaseConnection) -> Result<(), Box<dyn std::error::Error>> {
        // Load config from file instead of using defaults
        let (config, _secrets) = match AppConfig::from_files("assets/config/config.jsonc", None) {
            Ok((config, secrets)) => (config, secrets),
            Err(_) => {
                println!("⚠️  Could not load config file, using defaults");
                (AppConfig::default(), None)
            }
        };
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
            Self::PlaySong { song_id, visualize } => {
                self.handle_play_song(&service, song_id.clone(), *visualize)
                    .await
            }
            Self::PlayPlaylist { playlist, shuffle } => {
                self.handle_play_playlist(&service, playlist.clone(), *shuffle)
                    .await
            }
            Self::Play { shuffle } => self.handle_interactive_play(&service, *shuffle).await,
            Self::PlayDirect { playlist, shuffle } => {
                self.handle_direct_play(&service, playlist.clone(), *shuffle)
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

        // Use MusicRepository for database stats
        let repository = grimoire::music::MusicRepository::new(service.db().pool().clone());

        // Get comprehensive database stats
        let stats = repository.get_database_stats().await?;

        println!("📊 Database Record Counts:");
        println!("   🎵 Songs: {}", stats.song_count);
        println!("   📁 Media Blobs (music-cli): {}", stats.media_blob_count);
        println!("   🖼️  Thumbnail Blobs: {}", stats.thumbnail_blob_count);
        println!("   📋 Scan Sessions: {}", stats.scan_session_count);

        // Show recent songs with thumbnail status
        let recent_songs = repository.get_recent_songs_with_thumbnails(5).await?;

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

                // Show ASCII art for songs with thumbnails
                if let Some(thumbnail_blob_id) = &song.thumbnail_blob_id {
                    println!("     🖼️  ASCII Art Preview:");
                    if let Some(ascii_art) = self
                        .generate_ascii_art(thumbnail_blob_id, service.db().pool())
                        .await
                    {
                        for line in ascii_art.lines() {
                            if !line.trim().is_empty() {
                                println!("     {}", line.bright_white());
                            }
                        }
                        println!("     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                    }
                    println!(); // Extra spacing between songs
                }
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
                let thumbnail_hash = hash_bytes(&extracted_image.data);

                let thumbnail_create_blob = CreateMediaBlob {
                    data: Some(extracted_image.data.clone()),
                    sha256: thumbnail_hash,
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

        // Create song record using MusicRepository
        let repository = grimoire::music::MusicRepository::new(music_service.db().pool().clone());

        let metadata_json = serde_json::json!({
            "audio_properties": audio_metadata.properties,
            "original_tags": audio_metadata.tags.tags,
            "processing_info": {
                "processed_at": time::OffsetDateTime::now_utc(),
                "processor": "music-cli",
                "file_path": file_path.to_string_lossy()
            },
            "duration_seconds": audio_metadata.properties.duration_seconds,
            "has_embedded_thumbnail": thumbnail_blob_id.is_some()
        });

        let song_id = repository
            .create_song_with_metadata(
                &media_blob.id,
                thumbnail_blob_id.as_deref(),
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

        let thumbnail_info = if thumbnail_blob_id.is_some() {
            " + Thumbnail"
        } else {
            ""
        };

        println!(
            "✅ Processed: {} -> Song ID: {} (Media Blob: {}{})",
            file_path.display(),
            song_id,
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

    /// Handle playing a single song
    async fn handle_play_song(
        &self,
        service: &MusicService<'_>,
        song_id: String,
        visualize: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repository = MusicRepository::new(service.db().pool().clone());

        // Parse song ID
        let uuid = song_id
            .parse::<uuid::Uuid>()
            .map_err(|_| "Invalid song ID format")?;

        // Get song details with media info
        let song = repository.get_song_with_media(uuid).await?;

        println!("🎵 Playing: {}", song.display_title());

        // Check if local_path is available
        let file_path = song.local_path.ok_or("Song file path not available")?;

        // Get audio playback config
        let config = service.config();
        let playback_config = &config.media.playback;

        // Build command
        let player_cmd = if let Some(path) = &playback_config.player_path {
            path.clone()
        } else {
            playback_config.player_command.clone()
        };

        if visualize {
            // Play with visualizer (requires cava)
            let cmd = format!(
                "{} {} '{}' & cava",
                player_cmd,
                playback_config.player_args.join(" "),
                file_path
            );
            std::process::Command::new("sh")
                .arg("-c")
                .arg(&cmd)
                .spawn()?;
        } else {
            // Execute player directly to hand over terminal control
            let status = std::process::Command::new(&player_cmd)
                .args(&playback_config.player_args)
                .arg(&file_path)
                .status()?;

            if !status.success() {
                println!("⚠️  Playback failed");
            }
        }

        Ok(())
    }

    /// Handle playing a playlist
    async fn handle_play_playlist(
        &self,
        service: &MusicService<'_>,
        playlist_input: String,
        shuffle: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repository = MusicRepository::new(service.db().pool().clone());
        let playlist_service = PlaylistService::new(repository);

        // Find playlist by title or ID
        let playlist = playlist_service
            .find_playlist_by_title_or_id(&playlist_input)
            .await?;

        // Get playlist songs with media info (create new repository instance)
        let repository2 = MusicRepository::new(service.db().pool().clone());
        let mut songs = repository2
            .get_playlist_songs_with_media(playlist.id)
            .await?;

        if shuffle {
            use rand::seq::SliceRandom;
            let mut rng = rand::thread_rng();
            songs.shuffle(&mut rng);
        }

        println!(
            "🎵 Playing playlist: {} ({} songs)",
            playlist.title,
            songs.len()
        );
        println!("⌨️  Controls: Space=pause/play, q/n=next song, ←/→=seek, 9/0=volume, Ctrl+C=stop playlist");
        println!();

        // Get audio playback config
        let config = service.config();
        let playback_config = &config.media.playback;

        // Build base command
        let player_cmd = if let Some(path) = &playback_config.player_path {
            path.clone()
        } else {
            playback_config.player_command.clone()
        };

        for (index, song) in songs.iter().enumerate() {
            println!(
                "▶️  [{}/{}] {} {}",
                index + 1,
                songs.len(),
                song.display_title(),
                if let Some(duration) = &song.duration {
                    let total_seconds = duration.microseconds / 1_000_000;
                    let minutes = total_seconds / 60;
                    let seconds = total_seconds % 60;
                    format!("({}:{:02})", minutes, seconds)
                } else {
                    String::new()
                }
            );

            // Check if local_path is available
            if let Some(file_path) = &song.local_path {
                println!("   📁 {}", file_path);

                // Simple direct execution now that config loading is fixed
                let status = std::process::Command::new(&player_cmd)
                    .args(&playback_config.player_args)
                    .arg(file_path)
                    .status();

                match status {
                    Ok(exit_status) => {
                        if !exit_status.success() {
                            println!("⚠️  Playback failed, skipping to next song...");
                            continue;
                        }
                    }
                    Err(e) => {
                        println!("⚠️  Error starting player: {}, skipping...", e);
                        continue;
                    }
                }
            } else {
                println!("⚠️  No file path available for song, skipping...");
                continue;
            }
        }

        println!("✅ Playlist finished");
        Ok(())
    }

    /// Handle interactive playlist selection and playback
    async fn handle_interactive_play(
        &self,
        service: &MusicService<'_>,
        shuffle: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // Show the epic FREQHOLE banner
        self.show_freqhole_banner();

        // Configure custom theme with magenta highlights
        let render_config = RenderConfig::default()
            .with_highlighted_option_prefix(Styled::new("🎵 ").with_fg(Color::LightMagenta))
            .with_selected_option(Some(StyleSheet::new().with_fg(Color::LightMagenta)));

        loop {
            // Let user choose between playlists and songs
            let mode_options = vec![
                "🎵 Browse Playlists".to_string(),
                "🎶 Browse All Songs".to_string(),
            ];

            let mode_selection = Select::new(
                &"Choose your music source:"
                    .bright_magenta()
                    .bold()
                    .to_string(),
                mode_options,
            )
            .with_help_message("↑↓ to navigate, Enter to select, Esc to cancel")
            .with_render_config(render_config.clone())
            .prompt();

            match mode_selection {
                Ok(selected) if selected.contains("Playlists") => {
                    match self.handle_playlist_selection(service, shuffle).await {
                        Ok(_) => return Ok(()),
                        Err(e) => {
                            println!("❌ Error: {}", e);
                            continue; // Back to main menu
                        }
                    }
                }
                Ok(selected) if selected.contains("Songs") => {
                    match self.handle_all_songs_selection(service, shuffle).await {
                        Ok(_) => return Ok(()),
                        Err(e) => {
                            println!("❌ Error: {}", e);
                            continue; // Back to main menu
                        }
                    }
                }
                Ok(_) => {
                    println!("❌ Unknown selection");
                    continue;
                }
                Err(inquire::InquireError::OperationCanceled) => {
                    println!("🚫 Cancelled");
                    return Ok(());
                }
                Err(e) => {
                    println!("❌ Error: {}", e);
                    return Ok(());
                }
            }
        }
    }

    async fn handle_playlist_selection(
        &self,
        service: &MusicService<'_>,
        shuffle: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // Configure custom theme with magenta highlights
        let render_config = RenderConfig::default()
            .with_highlighted_option_prefix(Styled::new("🎵 ").with_fg(Color::LightMagenta))
            .with_selected_option(Some(StyleSheet::new().with_fg(Color::LightMagenta)));

        let repository = MusicRepository::new(service.db().pool().clone());

        // Get playlist summaries
        let summaries = repository.get_playlist_summaries(Some(100)).await?;

        if summaries.is_empty() {
            println!("📭 No playlists found. Create one first with:");
            println!("   cli music create-playlist \"My Playlist\"");
            return Ok(());
        }

        // Create display options for inquire
        let options: Vec<String> = summaries
            .iter()
            .map(|playlist| {
                let duration_str = if let Some(duration) = &playlist.total_duration {
                    let total_seconds = duration.microseconds / 1_000_000;
                    let minutes = total_seconds / 60;
                    let seconds = total_seconds % 60;
                    format!(" ({}:{:02})", minutes, seconds)
                } else {
                    String::new()
                };

                format!(
                    "{} - {} songs{}",
                    playlist.title, playlist.song_count, duration_str
                )
            })
            .collect();

        // Loop to allow returning to playlist selection after playback
        loop {
            // Use inquire for interactive selection with keyboard navigation
            let prompt_text = if shuffle {
                "🎶 Select a playlist to play (shuffled):"
                    .bright_magenta()
                    .bold()
                    .to_string()
            } else {
                "🎶 Select a playlist to play:"
                    .bright_magenta()
                    .bold()
                    .to_string()
            };

            let mut playlist_options = vec!["⚙️ Reorder Playlist Songs".to_string()];
            playlist_options.extend(options.clone());

            let selection = Select::new(&prompt_text, playlist_options)
                .with_help_message("↑↓ to navigate, Enter to select, Esc to go back")
                .with_render_config(render_config.clone())
                .prompt();

            match selection {
                Ok(selected_option) => {
                    if selected_option.contains("Reorder Playlist Songs") {
                        // Handle playlist reordering
                        self.handle_playlist_reorder_menu(service).await?;
                    } else {
                        // Handle regular playlist selection - need to adjust index since reorder is first
                        let selected_index = options
                            .iter()
                            .position(|option| option == &selected_option)
                            .unwrap_or(0);

                        let selected_playlist = &summaries[selected_index];
                        println!(
                            "{}",
                            format!("🎵 Selected: {}", selected_playlist.title)
                                .bright_cyan()
                                .bold()
                        );

                        // Call the direct play method
                        self.handle_direct_play(service, selected_playlist.id.to_string(), shuffle)
                            .await?;

                        // After playlist finishes, continue loop to show selection again
                        println!("\n🔄 Returning to playlist selection...\n");
                    }
                }
                Err(inquire::InquireError::OperationCanceled) => {
                    return Err("cancelled".into()); // Signal to go back to main menu
                }
                Err(e) => {
                    return Err(e.into());
                }
            }
        }
    }

    async fn handle_all_songs_selection(
        &self,
        service: &MusicService<'_>,
        shuffle: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // Configure custom theme with magenta highlights
        let render_config = RenderConfig::default()
            .with_highlighted_option_prefix(Styled::new("🎵 ").with_fg(Color::LightMagenta))
            .with_selected_option(Some(StyleSheet::new().with_fg(Color::LightMagenta)));

        let repository = MusicRepository::new(service.db().pool().clone());

        // Get all songs
        let songs_result = repository
            .query_songs(SongQuery {
                limit: Some(1000), // Reasonable limit
                ..Default::default()
            })
            .await?;

        if songs_result.is_empty() {
            println!("📭 No songs found in the database.");
            return Ok(());
        }

        println!(
            "{}",
            format!("🎵 {} songs available", songs_result.len()).bright_cyan()
        );

        // Create display options for all songs
        let song_options: Vec<String> = songs_result
            .iter()
            .map(|song| {
                let artist = song.artist.as_deref().unwrap_or("Unknown Artist");
                let album = song.album.as_deref().unwrap_or("Unknown Album");
                format!("{} - {} ({})", song.title, artist, album)
            })
            .collect();

        // Loop to allow returning to song selection after playback
        loop {
            let song_selection = Select::new(
                &format!(
                    "🎶 Select a song to play{}:",
                    if shuffle { " (shuffled)" } else { "" }
                ),
                song_options.clone(),
            )
            .with_help_message("↑↓ to navigate, type to filter, Enter to select, Esc to go back")
            .with_render_config(render_config.clone())
            .prompt();

            match song_selection {
                Ok(selected_option) => {
                    let selected_index = song_options
                        .iter()
                        .position(|option| option == &selected_option)
                        .unwrap_or(0);

                    let selected_song = &songs_result[selected_index];

                    // Show action menu for selected song
                    let action_result = self
                        .handle_song_action_menu(service, selected_song, shuffle)
                        .await?;

                    if action_result {
                        // Song was played, show return message
                        println!("\n🔄 Returning to song selection...\n");
                    }
                    // If song was added to playlist, just continue the loop
                }
                Err(inquire::InquireError::OperationCanceled) => {
                    return Err("cancelled".into()); // Signal to go back to main menu
                }
                Err(e) => {
                    return Err(e.into());
                }
            }
        }
    }

    async fn handle_single_song_play(
        &self,
        service: &MusicService<'_>,
        song: &grimoire::music::Song,
        _shuffle: bool, // Not relevant for single song
    ) -> Result<(), Box<dyn std::error::Error>> {
        // Show now playing banner for single song
        println!(
            "{}",
            "┌─────────────────────────────────────────────────────────────────────────────┐"
                .bright_cyan()
        );
        println!(
            "{}",
            "│                              🎵 NOW PLAYING 🎵                              │"
                .bright_cyan()
        );
        println!(
            "{}",
            "├─────────────────────────────────────────────────────────────────────────────┤"
                .bright_cyan()
        );

        let song_info = format!("🎶 Song: {}", song.title);
        let info_width = measure_text_width(&song_info);
        let content_width = 75;
        let padding = if info_width < content_width {
            content_width - info_width
        } else {
            0
        };
        println!(
            "{}{}{}{}",
            "│ ".bright_cyan(),
            song_info.white().bold(),
            " ".repeat(padding),
            "│".bright_cyan()
        );

        let controls_info = "⌨️  Controls: Space=pause/play, q=quit, ←/→=seek, 9/0=volume";
        let controls_width = measure_text_width(controls_info);
        let controls_padding = if controls_width < content_width {
            content_width - controls_width
        } else {
            0
        };
        println!(
            "{}{}{}{}",
            "│ ".bright_cyan(),
            controls_info.white(),
            " ".repeat(controls_padding),
            "│".bright_cyan()
        );

        println!(
            "{}",
            "└─────────────────────────────────────────────────────────────────────────────┘"
                .bright_cyan()
        );
        println!();

        // Create a temporary playlist with just this song
        let repository = MusicRepository::new(service.db().pool().clone());
        let _playlist_service = PlaylistService::new(repository);

        // Use the existing direct play method by creating a single-song playlist ID
        println!("{}", format!("🎶 {}", song.title).bright_magenta().bold());

        // Show ASCII art thumbnail if available
        if let Some(thumbnail_id) = &song.thumbnail_blob_id {
            if let Some(ascii_art) = self
                .generate_ascii_art(thumbnail_id, service.db().pool())
                .await
            {
                println!("   🖼️  Album Art:");
                for line in ascii_art.lines() {
                    if !line.trim().is_empty() {
                        println!("   {}", line.bright_white());
                    }
                }
            }
        }

        println!(
            "{}",
            "   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━".bright_yellow()
        );

        // Get media blob to find local path
        let media_blob_id = &song.media_blob_id;
        let media_repository = MediaBlobRepository::new(service.db().pool().clone());
        if let Ok(blob) = media_repository.find_by_id(media_blob_id).await {
            if let Some(file_path) = &blob.local_path {
                // Get audio config and play
                let config = service.config();
                let playback_config = &config.media.playback;
                let player_cmd = if let Some(path) = &playback_config.player_path {
                    path.clone()
                } else {
                    playback_config.player_command.clone()
                };

                let status = std::process::Command::new(&player_cmd)
                    .args(&playback_config.player_args)
                    .arg(file_path)
                    .status()?;

                if !status.success() {
                    println!("⚠️ Playback may have been interrupted");
                }
            } else {
                println!("❌ No local file path found for song");
            }
        } else {
            println!("❌ Could not retrieve media blob for song");
        }

        Ok(())
    }

    async fn handle_song_action_menu(
        &self,
        service: &MusicService<'_>,
        song: &grimoire::music::Song,
        shuffle: bool,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        // Configure custom theme
        let render_config = RenderConfig::default()
            .with_highlighted_option_prefix(Styled::new("🎵 ").with_fg(Color::LightMagenta))
            .with_selected_option(Some(StyleSheet::new().with_fg(Color::LightMagenta)));

        let action_options = vec!["🎵 Play Song".to_string(), "📋 Add to Playlist".to_string()];

        println!(
            "{}",
            format!("🎶 Selected: {}", song.title).bright_cyan().bold()
        );

        let action_selection = Select::new("Choose action:", action_options)
            .with_help_message("↑↓ to navigate, Enter to select, Esc to go back")
            .with_render_config(render_config)
            .prompt();

        match action_selection {
            Ok(selected_action) if selected_action.contains("Play Song") => {
                // Play the song
                self.handle_single_song_play(service, song, shuffle).await?;
                Ok(true) // Indicate song was played
            }
            Ok(selected_action) if selected_action.contains("Add to Playlist") => {
                // Show playlist selection for adding
                self.handle_add_song_to_playlist_menu(service, song).await?;
                Ok(false) // Indicate song was added to playlist, not played
            }
            Ok(_) => Ok(false),
            Err(inquire::InquireError::OperationCanceled) => Ok(false),
            Err(e) => Err(e.into()),
        }
    }

    async fn handle_add_song_to_playlist_menu(
        &self,
        service: &MusicService<'_>,
        song: &grimoire::music::Song,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // Configure custom theme
        let render_config = RenderConfig::default()
            .with_highlighted_option_prefix(Styled::new("🎵 ").with_fg(Color::LightMagenta))
            .with_selected_option(Some(StyleSheet::new().with_fg(Color::LightMagenta)));

        let repository = MusicRepository::new(service.db().pool().clone());
        let playlist_service =
            PlaylistService::new(MusicRepository::new(service.db().pool().clone()));

        // Get all playlists
        let playlists = repository.get_playlist_summaries(Some(100)).await?;

        let mut playlist_options = vec!["➕ Create New Playlist".to_string()];

        if !playlists.is_empty() {
            let existing_playlists: Vec<String> = playlists
                .iter()
                .map(|p| format!("📋 {} ({} songs)", p.title, p.song_count))
                .collect();
            playlist_options.extend(existing_playlists);
        }

        let playlist_selection = Select::new(
            &format!("Add '{}' to which playlist?", song.title),
            playlist_options.clone(),
        )
        .with_help_message("↑↓ to navigate, Enter to select, Esc to cancel")
        .with_render_config(render_config)
        .prompt();

        match playlist_selection {
            Ok(selected_option) => {
                if selected_option.contains("Create New Playlist") {
                    // Handle creating new playlist
                    self.handle_create_new_playlist_and_add_song(service, song)
                        .await?;
                } else {
                    // Handle adding to existing playlist
                    let selected_index = playlists
                        .iter()
                        .position(|p| {
                            let playlist_option =
                                format!("📋 {} ({} songs)", p.title, p.song_count);
                            playlist_option == selected_option
                        })
                        .unwrap_or(0);

                    let selected_playlist = &playlists[selected_index];

                    // Add song to playlist
                    match playlist_service
                        .add_songs_to_playlist(
                            selected_playlist.id,
                            vec![song.id],
                            Some("music-cli".to_string()),
                        )
                        .await
                    {
                        Ok(_) => {
                            println!(
                                "{}",
                                format!(
                                    "✅ Added '{}' to playlist '{}'",
                                    song.title, selected_playlist.title
                                )
                                .bright_green()
                            );
                        }
                        Err(e) => {
                            println!("❌ Failed to add song to playlist: {}", e);
                        }
                    }
                }
            }
            Err(inquire::InquireError::OperationCanceled) => {
                println!("🚫 Cancelled adding to playlist");
            }
            Err(e) => {
                println!("❌ Error: {}", e);
            }
        }

        Ok(())
    }

    async fn handle_create_new_playlist_and_add_song(
        &self,
        service: &MusicService<'_>,
        song: &grimoire::music::Song,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // Configure custom theme
        let render_config = RenderConfig::default()
            .with_highlighted_option_prefix(Styled::new("🎵 ").with_fg(Color::LightMagenta))
            .with_selected_option(Some(StyleSheet::new().with_fg(Color::LightMagenta)));

        // Prompt for playlist name
        let playlist_name = Text::new(&format!("Enter name for new playlist:"))
            .with_help_message("Type playlist name, Enter to confirm, Esc to cancel")
            .with_render_config(render_config)
            .prompt();

        let name = match playlist_name {
            Ok(name) => {
                if name.trim().is_empty() {
                    println!("❌ Playlist name cannot be empty");
                    return Ok(());
                }
                name.trim().to_string()
            }
            Err(inquire::InquireError::OperationCanceled) => {
                println!("🚫 Cancelled creating playlist");
                return Ok(());
            }
            Err(e) => {
                println!("❌ Error: {}", e);
                return Ok(());
            }
        };

        // Prompt for playlist description (optional)
        let playlist_description = Text::new("Enter description (optional):")
            .with_help_message("Type description or leave empty, Enter to confirm, Esc to skip")
            .prompt();

        let description = match playlist_description {
            Ok(desc) => {
                if desc.trim().is_empty() {
                    None
                } else {
                    Some(desc.trim().to_string())
                }
            }
            Err(inquire::InquireError::OperationCanceled) => None, // Skip description
            Err(_) => None,                                        // Skip description on error
        };

        // Create the playlist
        let repository = MusicRepository::new(service.db().pool().clone());
        let playlist_service = PlaylistService::new(repository);

        let create_playlist = CreatePlaylist {
            title: name.clone(),
            description,
            is_public: Some(false),
            is_collaborative: Some(false),
            client_id: Some("music-cli".to_string()),
            metadata: Some(serde_json::json!({})),
        };

        match playlist_service.create_playlist(create_playlist).await {
            Ok(new_playlist) => {
                println!(
                    "{}",
                    format!("✅ Created playlist: {}", new_playlist.title).bright_green()
                );

                // Add the song to the new playlist
                match playlist_service
                    .add_songs_to_playlist(
                        new_playlist.id,
                        vec![song.id],
                        Some("music-cli".to_string()),
                    )
                    .await
                {
                    Ok(_) => {
                        println!(
                            "{}",
                            format!(
                                "✅ Added '{}' to new playlist '{}'",
                                song.title, new_playlist.title
                            )
                            .bright_green()
                        );
                    }
                    Err(e) => {
                        println!("❌ Failed to add song to new playlist: {}", e);
                    }
                }
            }
            Err(e) => {
                println!("❌ Failed to create playlist: {}", e);
            }
        }

        Ok(())
    }

    async fn handle_playlist_reorder_menu(
        &self,
        service: &MusicService<'_>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // Configure custom theme
        let render_config = RenderConfig::default()
            .with_highlighted_option_prefix(Styled::new("🎵 ").with_fg(Color::LightMagenta))
            .with_selected_option(Some(StyleSheet::new().with_fg(Color::LightMagenta)));

        let repository = MusicRepository::new(service.db().pool().clone());

        // Get all playlists
        let playlists = repository.get_playlist_summaries(Some(100)).await?;

        if playlists.is_empty() {
            println!("📭 No playlists found.");
            return Ok(());
        }

        let playlist_options: Vec<String> = playlists
            .iter()
            .map(|p| format!("📋 {} ({} songs)", p.title, p.song_count))
            .collect();

        let playlist_selection =
            Select::new("Select playlist to reorder:", playlist_options.clone())
                .with_help_message("↑↓ to navigate, Enter to select, Esc to go back")
                .with_render_config(render_config.clone())
                .prompt();

        match playlist_selection {
            Ok(selected_option) => {
                let selected_index = playlist_options
                    .iter()
                    .position(|option| option == &selected_option)
                    .unwrap_or(0);

                let selected_playlist = &playlists[selected_index];

                // Get playlist songs
                let songs = repository
                    .get_playlist_songs_with_media(selected_playlist.id)
                    .await?;

                if songs.len() < 2 {
                    println!("⚠️ Playlist needs at least 2 songs to reorder.");
                    return Ok(());
                }

                self.handle_song_reorder_interface(service, selected_playlist, songs)
                    .await?;
            }
            Err(inquire::InquireError::OperationCanceled) => {
                // Just return, user cancelled
            }
            Err(e) => {
                println!("❌ Error: {}", e);
            }
        }

        Ok(())
    }

    async fn handle_song_reorder_interface(
        &self,
        service: &MusicService<'_>,
        playlist: &grimoire::music::PlaylistSummary,
        mut songs: Vec<grimoire::music::PlaylistSongWithMedia>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let render_config = RenderConfig::default()
            .with_highlighted_option_prefix(Styled::new("🎵 ").with_fg(Color::LightMagenta))
            .with_selected_option(Some(StyleSheet::new().with_fg(Color::LightMagenta)));

        loop {
            // Show current order
            println!("\n🎵 Current order for '{}':", playlist.title);
            for (i, song) in songs.iter().enumerate() {
                println!("  {}. {}", i + 1, song.display_title());
            }

            // Create options for moving songs
            let mut reorder_options: Vec<String> = songs
                .iter()
                .enumerate()
                .map(|(i, song)| format!("🔄 Move #{}: {}", i + 1, song.display_title()))
                .collect();

            reorder_options.push("✅ Save Changes".to_string());
            reorder_options.push("🚫 Cancel".to_string());

            let selection = Select::new("Select song to move or save changes:", reorder_options)
                .with_help_message("↑↓ to navigate, Enter to select")
                .with_render_config(render_config.clone())
                .prompt();

            match selection {
                Ok(selected) if selected.contains("Save Changes") => {
                    // Apply the new order to database
                    self.save_playlist_order(service, playlist, &songs).await?;
                    println!("✅ Playlist order saved!");
                    break;
                }
                Ok(selected) if selected.contains("Cancel") => {
                    println!("🚫 Changes cancelled");
                    break;
                }
                Ok(selected) if selected.contains("Move #") => {
                    // Extract song index and handle moving
                    if let Some(song_index) = selected
                        .split("Move #")
                        .nth(1)
                        .and_then(|s| s.chars().next())
                        .and_then(|c| c.to_digit(10))
                        .map(|d| d as usize - 1)
                    {
                        if song_index < songs.len() {
                            self.move_song_in_list(&mut songs, song_index).await?;
                        }
                    }
                }
                Ok(_) => continue,
                Err(inquire::InquireError::OperationCanceled) => {
                    println!("🚫 Reordering cancelled");
                    break;
                }
                Err(e) => {
                    println!("❌ Error: {}", e);
                    break;
                }
            }
        }

        Ok(())
    }

    async fn move_song_in_list(
        &self,
        songs: &mut Vec<grimoire::music::PlaylistSongWithMedia>,
        song_index: usize,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let render_config = RenderConfig::default()
            .with_highlighted_option_prefix(Styled::new("🎵 ").with_fg(Color::LightMagenta))
            .with_selected_option(Some(StyleSheet::new().with_fg(Color::LightMagenta)));

        let song_title = &songs[song_index].display_title();
        println!("\n🔄 Moving: {}", song_title);

        // Create position options
        let position_options: Vec<String> = (1..=songs.len())
            .map(|i| {
                if i - 1 == song_index {
                    format!("{}. {} (current)", i, songs[i - 1].display_title())
                } else {
                    format!("{}. {}", i, songs[i - 1].display_title())
                }
            })
            .collect();

        let position_selection = Select::new(
            &format!("Move '{}' to which position?", song_title),
            position_options,
        )
        .with_help_message("↑↓ to navigate, Enter to select, Esc to cancel")
        .with_render_config(render_config)
        .prompt();

        match position_selection {
            Ok(selected) => {
                if let Some(new_position) = selected
                    .split('.')
                    .next()
                    .and_then(|s| s.parse::<usize>().ok())
                    .map(|p| p - 1)
                {
                    if new_position != song_index && new_position < songs.len() {
                        // Move the song to new position
                        let song = songs.remove(song_index);
                        songs.insert(new_position, song);
                        println!("✅ Moved to position {}", new_position + 1);
                    }
                }
            }
            Err(inquire::InquireError::OperationCanceled) => {
                // User cancelled, do nothing
            }
            Err(e) => {
                println!("❌ Error: {}", e);
            }
        }

        Ok(())
    }

    async fn save_playlist_order(
        &self,
        service: &MusicService<'_>,
        playlist: &grimoire::music::PlaylistSummary,
        songs: &[grimoire::music::PlaylistSongWithMedia],
    ) -> Result<(), Box<dyn std::error::Error>> {
        // Use MusicRepository for safe reordering
        let repository = grimoire::music::MusicRepository::new(service.db().pool().clone());
        let song_ids: Vec<uuid::Uuid> = songs.iter().map(|s| s.song_id).collect();

        repository
            .reorder_playlist_by_function(playlist.id, &song_ids)
            .await?;

        println!("✅ Playlist order saved successfully!");
        Ok(())
    }

    fn show_freqhole_banner(&self) {
        let banner = r#"
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║  ███████╗██████╗ ███████╗ ██████╗ ██╗  ██╗ ██████╗ ██╗     ███████╗          ║
║  ██╔════╝██╔══██╗██╔════╝██╔═══██╗██║  ██║██╔═══██╗██║     ██╔════╝          ║
║  █████╗  ██████╔╝█████╗  ██║   ██║███████║██║   ██║██║     █████╗            ║
║  ██╔══╝  ██╔══██╗██╔══╝  ██║▄▄ ██║██╔══██║██║   ██║██║     ██╔══╝            ║
║  ██║     ██║  ██║███████╗╚██████╔╝██║  ██║╚██████╔╝███████╗███████╗          ║
║  ╚═╝     ╚═╝  ╚═╝╚══════╝ ╚══▀▀═╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝          ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
"#;

        println!("{}", banner.bright_magenta().bold());
        println!(
            "{}",
            "🌈✨ Welcome to the audio dimension ✨🌈"
                .bright_magenta()
                .italic()
        );
        println!();
    }

    async fn generate_ascii_art(
        &self,
        thumbnail_blob_id: &str,
        db_pool: &sqlx::PgPool,
    ) -> Option<String> {
        // Get the thumbnail blob data
        let media_repository = MediaBlobRepository::new(db_pool.clone());

        let blob = match media_repository.find_by_id(thumbnail_blob_id).await {
            Ok(blob) => blob,
            _ => return None,
        };

        let image_data = blob.data?;

        // Load the image
        let img = match ImageReader::new(std::io::Cursor::new(&image_data)).with_guessed_format() {
            Ok(reader) => match reader.decode() {
                Ok(img) => img,
                Err(_) => return None,
            },
            Err(_) => return None,
        };

        // Resize to fit in terminal (10 lines high, maintain aspect ratio)
        let target_height = 10;
        let target_width = (target_height * img.width() * 2) / img.height(); // *2 because chars are taller than wide
        let target_width = target_width.min(60); // Don't make it too wide

        let resized = img.resize(
            target_width,
            target_height,
            image::imageops::FilterType::Nearest,
        );

        // Convert to grayscale and then to ASCII
        let gray_img = resized.to_luma8();
        let mut ascii_art = String::new();

        // ASCII characters from darkest to lightest
        let chars = [' ', '.', ':', '-', '=', '+', '*', '#', '%', '@'];

        for y in 0..gray_img.height() {
            for x in 0..gray_img.width() {
                let pixel = gray_img.get_pixel(x, y)[0];
                let char_index = (pixel as usize * (chars.len() - 1)) / 255;
                ascii_art.push(chars[char_index]);
            }
            ascii_art.push('\n');
        }

        Some(ascii_art)
    }

    /// Handle direct playlist playback without interactive picker
    async fn handle_direct_play(
        &self,
        service: &MusicService<'_>,
        playlist_input: String,
        shuffle: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repository = MusicRepository::new(service.db().pool().clone());
        let playlist_service = PlaylistService::new(repository);

        // Find playlist by title or ID
        let playlist = playlist_service
            .find_playlist_by_title_or_id(&playlist_input)
            .await?;

        // Get playlist songs with media info
        let repository2 = MusicRepository::new(service.db().pool().clone());
        let mut songs = repository2
            .get_playlist_songs_with_media(playlist.id)
            .await?;

        if shuffle {
            use rand::seq::SliceRandom;
            let mut rng = rand::thread_rng();
            songs.shuffle(&mut rng);
        }

        // Get audio config
        let config = service.config();
        let playback_config = &config.media.playback;
        let player_cmd = if let Some(path) = &playback_config.player_path {
            path.clone()
        } else {
            playback_config.player_command.clone()
        };

        // Show now playing banner
        println!(
            "{}",
            "┌─────────────────────────────────────────────────────────────────────────────┐"
                .bright_cyan()
        );
        println!(
            "{}",
            "│                              🎵 NOW PLAYING 🎵                              │"
                .bright_cyan()
        );
        println!(
            "{}",
            "├─────────────────────────────────────────────────────────────────────────────┤"
                .bright_cyan()
        );

        let playlist_info = format!("📀 Playlist: {} ({} songs)", playlist.title, songs.len());
        let content_width = 75; // 79 total - 4 for borders

        let info_width = measure_text_width(&playlist_info);
        let info_padding = if info_width < content_width {
            content_width - info_width
        } else {
            0
        };
        println!(
            "{}{}{}{}",
            "│ ".bright_cyan(),
            playlist_info.white().bold(),
            " ".repeat(info_padding),
            "│".bright_cyan()
        );

        let controls_info = "⌨️  Controls: Space=pause/play, q/n=next song, ←/→=seek, 9/0=volume";
        let controls_width = measure_text_width(controls_info);
        let controls_padding = if controls_width < content_width {
            content_width - controls_width
        } else {
            0
        };
        println!(
            "{}{}{}{}",
            "│ ".bright_cyan(),
            controls_info.white(),
            " ".repeat(controls_padding),
            "│".bright_cyan()
        );

        println!(
            "{}",
            "└─────────────────────────────────────────────────────────────────────────────┘"
                .bright_cyan()
        );
        println!();

        // Play songs sequentially
        for (index, song) in songs.iter().enumerate() {
            if let Some(file_path) = &song.local_path {
                let duration_str = if let Some(duration) = &song.duration {
                    let total_seconds = duration.microseconds / 1_000_000;
                    let minutes = total_seconds / 60;
                    let seconds = total_seconds % 60;
                    format!("({}:{:02})", minutes, seconds)
                } else {
                    String::new()
                };

                // Show current song with fancy formatting
                println!(
                    "{}",
                    format!(
                        "🎶 [{}/{}] {}",
                        index + 1,
                        songs.len(),
                        song.display_title()
                    )
                    .bright_magenta()
                    .bold()
                );
                println!(
                    "{}{}",
                    "   ⏱️  Duration: ".bright_cyan(),
                    duration_str.white()
                );

                // Show ASCII art thumbnail if available
                // Get thumbnail directly using song_id since playlist mapping is broken
                println!(
                    "   🔍 Debug: Looking for thumbnail for song ID: {}",
                    song.song_id
                );

                let repository = grimoire::music::MusicRepository::new(service.db().pool().clone());
                match repository.get_song_thumbnail_id(song.song_id).await {
                    Ok(Some(thumbnail_id)) => {
                        println!("   🔍 Debug: Found thumbnail_id: {}", thumbnail_id);
                        if let Some(ascii_art) = self
                            .generate_ascii_art(&thumbnail_id, service.db().pool())
                            .await
                        {
                            println!("   🖼️  Album Art:");
                            for line in ascii_art.lines() {
                                if !line.trim().is_empty() {
                                    println!("   {}", line.bright_white());
                                }
                            }
                        } else {
                            println!("   ❌ Debug: Failed to generate ASCII art");
                        }
                    }
                    Ok(None) => {
                        println!("   🔍 Debug: Song has no thumbnail_blob_id in database");
                    }
                    Err(e) => {
                        println!("   ❌ Debug: Query failed: {:?}", e);
                    }
                }

                println!(
                    "{}",
                    "   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━".bright_yellow()
                );

                let status = std::process::Command::new(&player_cmd)
                    .args(&playback_config.player_args)
                    .arg(file_path)
                    .status();

                match status {
                    Ok(exit_status) => {
                        if !exit_status.success() {
                            println!("⚠️  Playback failed, skipping to next song...");
                            continue;
                        }
                    }
                    Err(e) => {
                        println!("⚠️  Error starting player: {}, skipping...", e);
                        continue;
                    }
                }
            } else {
                println!("⚠️  No file path available for song, skipping...");
                continue;
            }
        }

        println!("✅ Playlist finished");
        Ok(())
    }
}
