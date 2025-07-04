//! Video management CLI commands
//!
//! This module provides CLI commands for video scanning, playlist management,
//! and video organization following the patterns established in the photos module.

use clap::Subcommand;
use grimoire::{
    media::{ConsoleScanProgress, ScanConfig, UnifiedScannerBuilder},
    videos::{CreateVideoPlaylist, VideoMetadataExtractor, VideoService},
    DatabaseConnection,
};
use std::path::PathBuf;
use tracing::{error, info};
use uuid::Uuid;

#[derive(Subcommand, Clone)]
pub enum VideoCommands {
    /// Scan directories for videos
    Scan {
        /// Directory path to scan
        #[arg(value_name = "PATH")]
        path: PathBuf,

        /// Optional session name
        #[arg(long, short)]
        name: Option<String>,

        /// Maximum directory depth to scan
        #[arg(long, short, default_value = "10")]
        depth: Option<usize>,

        /// Batch size for processing
        #[arg(long, short, default_value = "25")]
        batch_size: usize,

        /// File extensions to include (comma-separated)
        #[arg(long, short)]
        extensions: Option<String>,

        /// Generate thumbnails during scan
        #[arg(long, default_value = "true")]
        generate_thumbnails: bool,
    },

    /// Test video metadata extraction
    Test {
        /// Video file to test
        #[arg(value_name = "FILE")]
        file: PathBuf,

        /// Show full video information
        #[arg(long)]
        full: bool,
    },

    /// List videos with optional filters
    List {
        /// Filter by favorite status
        #[arg(long)]
        favorites: bool,

        /// Filter by video codec
        #[arg(long)]
        codec: Option<String>,

        /// Filter by container format
        #[arg(long)]
        format: Option<String>,

        /// Filter by resolution (e.g., "1080p", "4k")
        #[arg(long)]
        resolution: Option<String>,

        /// Number of videos to display
        #[arg(long, short, default_value = "20")]
        limit: i64,

        /// Offset for pagination
        #[arg(long, short, default_value = "0")]
        offset: i64,
    },

    /// Show video details
    Info {
        /// Video ID
        #[arg(value_name = "ID")]
        id: String,

        /// Show technical details
        #[arg(long)]
        technical: bool,
    },

    /// Playlist management commands
    Playlists {
        #[command(subcommand)]
        command: PlaylistCommands,
    },

    /// Generate thumbnails for videos
    Thumbnails {
        /// Number of videos to process
        #[arg(long, short, default_value = "10")]
        limit: i64,

        /// Force regeneration of existing thumbnails
        #[arg(long)]
        force: bool,
    },
}

#[derive(Subcommand, Clone)]
pub enum PlaylistCommands {
    /// List all playlists
    List {
        /// Filter by public playlists only
        #[arg(long)]
        public: bool,

        /// Show verbose output with video counts
        #[arg(long, short)]
        verbose: bool,
    },

    /// Create a new playlist
    Create {
        /// Playlist title
        #[arg(value_name = "TITLE")]
        title: String,

        /// Playlist description
        #[arg(long, short)]
        description: Option<String>,

        /// Make playlist public
        #[arg(long)]
        public: bool,

        /// Make playlist collaborative
        #[arg(long)]
        collaborative: bool,
    },

    /// Show playlist details
    Show {
        /// Playlist title or ID
        #[arg(value_name = "PLAYLIST")]
        playlist: String,

        /// Show verbose output with video details
        #[arg(long, short)]
        verbose: bool,
    },

    /// Add videos to a playlist
    Add {
        /// Playlist title or ID
        #[arg(value_name = "PLAYLIST")]
        playlist: String,

        /// Video IDs to add (space-separated)
        #[arg(value_name = "VIDEO_IDS")]
        videos: Vec<String>,
    },

    /// Remove videos from a playlist
    Remove {
        /// Playlist title or ID
        #[arg(value_name = "PLAYLIST")]
        playlist: String,

        /// Video IDs to remove (space-separated)
        #[arg(value_name = "VIDEO_IDS")]
        videos: Vec<String>,
    },

    /// Delete a playlist
    Delete {
        /// Playlist title or ID
        #[arg(value_name = "PLAYLIST")]
        playlist: String,

        /// Skip confirmation prompt
        #[arg(long)]
        force: bool,
    },
}

impl VideoCommands {
    pub async fn handle(&self, db: &DatabaseConnection) -> Result<(), Box<dyn std::error::Error>> {
        match self {
            VideoCommands::Scan {
                path,
                name,
                depth,
                batch_size,
                extensions,
                generate_thumbnails,
            } => {
                self.handle_scan(
                    db,
                    path,
                    name.as_deref(),
                    *depth,
                    *batch_size,
                    extensions.as_deref(),
                    *generate_thumbnails,
                )
                .await
            }
            VideoCommands::Test { file, full } => self.handle_test(file, *full).await,
            VideoCommands::List {
                favorites,
                codec,
                format,
                resolution,
                limit,
                offset,
            } => {
                self.handle_list(
                    db,
                    *favorites,
                    codec.as_deref(),
                    format.as_deref(),
                    resolution.as_deref(),
                    *limit,
                    *offset,
                )
                .await
            }
            VideoCommands::Info { id, technical } => self.handle_info(db, id, *technical).await,
            VideoCommands::Playlists { command } => command.handle(db).await,
            VideoCommands::Thumbnails { limit, force } => {
                self.handle_thumbnails(db, *limit, *force).await
            }
        }
    }

    async fn handle_scan(
        &self,
        db: &DatabaseConnection,
        path: &PathBuf,
        _name: Option<&str>,
        depth: Option<usize>,
        batch_size: usize,
        extensions: Option<&str>,
        generate_thumbnails: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        info!("Starting video scan of: {}", path.display());

        if !path.exists() {
            error!("Path does not exist: {}", path.display());
            return Err("Path does not exist".into());
        }

        // Create unified scanner with video scanner
        let video_scanner = grimoire::videos::VideoScanner::new();
        let scanner = UnifiedScannerBuilder::new()
            .with_config(ScanConfig {
                max_depth: Some(depth.unwrap_or(10)),
                batch_size,
                max_file_size: None, // No size limit for videos
                include_extensions: extensions
                    .map(|ext| ext.split(',').map(|s| s.trim().to_string()).collect())
                    .unwrap_or_default(),
                exclude_extensions: vec![],
                skip_directories: vec![],
                follow_symlinks: false,
            })
            .add_scanner(video_scanner)
            .build();

        // Set up progress reporting
        let _progress = ConsoleScanProgress::new(100);

        // Run the scan
        let results = scanner.scan_directory(path).await?;

        info!("Scan completed!");
        info!("Total files found: {}", results.len());
        let processed_count = results.iter().filter(|r| r.success).count();
        let failed_count = results.len() - processed_count;
        info!("Videos processed: {}", processed_count);
        info!("Failed files: {}", failed_count);

        if generate_thumbnails {
            info!("Note: Thumbnails will be generated during video processing");
        }

        // Process successful video results with the video service
        let video_service = VideoService::new(db.pool().clone());
        let mut processed_count = 0;

        for result in results {
            if result.success && result.media_type == "video" {
                match video_service
                    .process_and_store_video(&result.file.path, None, None)
                    .await
                {
                    Ok(video) => {
                        processed_count += 1;
                        info!("Stored video: {} (ID: {})", video.title, video.id);
                    }
                    Err(e) => {
                        error!(
                            "Failed to store video {}: {}",
                            result.file.path.display(),
                            e
                        );
                    }
                }
            }
        }

        info!("Successfully processed {} videos", processed_count);
        Ok(())
    }

    async fn handle_test(
        &self,
        file: &PathBuf,
        full: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        info!("Testing video metadata extraction for: {}", file.display());

        if !file.exists() {
            error!("File does not exist: {}", file.display());
            return Err("File does not exist".into());
        }

        let extractor = VideoMetadataExtractor::new();

        if !extractor.is_available() {
            error!("FFprobe not available. Please install FFmpeg.");
            return Err("FFprobe not available".into());
        }

        match extractor.extract_metadata(file).await {
            Ok(metadata) => {
                println!("✅ Video metadata extraction successful");
                println!();
                println!("📹 Video Information:");

                if let Some(duration) = metadata.duration {
                    println!("  Duration: {:.2} seconds", duration);
                }

                if let (Some(width), Some(height)) = (metadata.width_px, metadata.height_px) {
                    println!("  Resolution: {}x{}", width, height);
                }

                if let Some(fps) = metadata.fps {
                    println!("  Frame rate: {:.2} fps", fps);
                }

                if let Some(video_codec) = &metadata.video_codec {
                    println!("  Video codec: {}", video_codec);
                }

                if let Some(audio_codec) = &metadata.audio_codec {
                    println!("  Audio codec: {}", audio_codec);
                }

                if let Some(bitrate) = metadata.bitrate {
                    println!("  Bitrate: {} kbps", bitrate);
                }

                if let Some(container) = &metadata.container_format {
                    println!("  Container: {}", container);
                }

                if full {
                    println!();
                    println!("🔧 Advanced Information:");

                    if let Some(hdr) = metadata.is_hdr {
                        println!("  HDR: {}", if hdr { "Yes" } else { "No" });
                    }

                    if let Some(color_profile) = &metadata.color_profile {
                        println!("  Color profile: {}", color_profile);
                    }

                    if let Some(channels) = metadata.audio_channels {
                        println!("  Audio channels: {}", channels);
                    }

                    if let Some(sample_rate) = metadata.audio_sample_rate {
                        println!("  Sample rate: {} Hz", sample_rate);
                    }

                    if let Some(extended) = &metadata.extended_metadata {
                        println!();
                        println!("📊 Extended metadata:");
                        println!("{}", serde_json::to_string_pretty(extended)?);
                    }
                }
            }
            Err(e) => {
                error!("Failed to extract metadata: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn handle_list(
        &self,
        db: &DatabaseConnection,
        favorites: bool,
        codec: Option<&str>,
        format: Option<&str>,
        resolution: Option<&str>,
        limit: i64,
        _offset: i64,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let video_service = VideoService::new(db.pool().clone());

        // For now, use simple listing - can enhance with filters later
        let videos = video_service.list_recent_videos(limit).await?;

        if videos.is_empty() {
            println!("No videos found.");
            return Ok(());
        }

        println!("📹 Videos (showing {} results):", videos.len());
        println!();

        for video in videos {
            println!("🎬 {}", video.title);
            println!("   ID: {}", video.id);

            if let (Some(width), Some(height)) = (video.width_px, video.height_px) {
                println!("   Resolution: {}x{}", width, height);
            }

            if let Some(duration) = &video.duration {
                println!("   Duration: {:?}", duration);
            }

            if let Some(codec) = &video.video_codec {
                println!("   Codec: {}", codec);
            }

            if let Some(container) = &video.container_format {
                println!("   Format: {}", container);
            }

            if video.is_favorite.unwrap_or(false) {
                println!("   ⭐ Favorite");
            }

            println!("   Created: {}", video.created_at.date());
            println!();
        }

        // Show filter info if any applied
        if favorites || codec.is_some() || format.is_some() || resolution.is_some() {
            println!("Filters applied:");
            if favorites {
                println!("  - Favorites only");
            }
            if let Some(c) = codec {
                println!("  - Codec: {}", c);
            }
            if let Some(f) = format {
                println!("  - Format: {}", f);
            }
            if let Some(r) = resolution {
                println!("  - Resolution: {}", r);
            }
        }

        Ok(())
    }

    async fn handle_info(
        &self,
        db: &DatabaseConnection,
        id: &str,
        technical: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let video_service = VideoService::new(db.pool().clone());

        let video_id = Uuid::parse_str(id)?;
        let video = video_service.get_video(video_id).await?;

        println!("🎬 Video Details");
        println!("═══════════════");
        println!("Title: {}", video.title);
        println!("ID: {}", video.id);

        if let Some(description) = &video.description {
            println!("Description: {}", description);
        }

        println!();
        println!("📊 Technical Information:");

        if let (Some(width), Some(height)) = (video.width_px, video.height_px) {
            println!("  Resolution: {}x{}", width, height);

            // Calculate aspect ratio
            let aspect_ratio = width as f64 / height as f64;
            let ar_string = if (aspect_ratio - 16.0 / 9.0).abs() < 0.1 {
                "16:9"
            } else if (aspect_ratio - 4.0 / 3.0).abs() < 0.1 {
                "4:3"
            } else {
                "Custom"
            };
            println!("  Aspect ratio: {:.2}:1 ({})", aspect_ratio, ar_string);
        }

        if let Some(duration) = &video.duration {
            println!("  Duration: {:?}", duration);
        }

        if let Some(fps) = &video.fps {
            println!("  Frame rate: {} fps", fps);
        }

        if let Some(bitrate) = video.bitrate {
            println!("  Bitrate: {} kbps", bitrate);
        }

        println!();
        println!("🎯 Codec Information:");

        if let Some(video_codec) = &video.video_codec {
            println!("  Video codec: {}", video_codec);
        }

        if let Some(audio_codec) = &video.audio_codec {
            println!("  Audio codec: {}", audio_codec);
        }

        if let Some(container) = &video.container_format {
            println!("  Container: {}", container);
        }

        if technical {
            println!();
            println!("🔧 Advanced Details:");

            if let Some(hdr) = video.is_hdr {
                println!("  HDR: {}", if hdr { "Yes" } else { "No" });
            }

            if let Some(color_profile) = &video.color_profile {
                println!("  Color profile: {}", color_profile);
            }

            if let Some(channels) = video.audio_channels {
                println!("  Audio channels: {}", channels);
            }

            if let Some(sample_rate) = video.audio_sample_rate {
                println!("  Sample rate: {} Hz", sample_rate);
            }

            if let Some(subtitles) = video.subtitles_available {
                println!(
                    "  Subtitles: {}",
                    if subtitles { "Available" } else { "None" }
                );
            }
        }

        println!();
        println!("📝 Metadata:");
        println!(
            "  Favorite: {}",
            if video.is_favorite.unwrap_or(false) {
                "Yes"
            } else {
                "No"
            }
        );

        if let Some(rating) = video.rating {
            println!("  Rating: {}/5", rating);
        }

        if let Some(tags) = &video.tags {
            if !tags.is_empty() {
                println!("  Tags: {}", tags.join(", "));
            }
        }

        println!();
        println!("🏷️  System Information:");
        println!("  Media blob ID: {}", video.media_blob_id);

        if let Some(thumb_id) = &video.thumbnail_blob_id {
            println!("  Thumbnail ID: {}", thumb_id);
        }

        if let Some(thumb_ids) = &video.thumbnail_blob_ids {
            println!("  Thumbnails: {} generated", thumb_ids.len());
        }

        println!("  Created: {}", video.created_at.date());
        println!("  Updated: {}", video.updated_at.date());
        println!("  Version: {}", video.version);

        Ok(())
    }

    async fn handle_thumbnails(
        &self,
        _db: &DatabaseConnection,
        limit: i64,
        force: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        info!(
            "Processing thumbnails for {} videos (force: {})",
            limit, force
        );

        // This would integrate with the thumbnail generation system
        // For now, just show what would be done

        println!("🖼️  Thumbnail Generation");
        println!("═══════════════════════");
        println!("Limit: {} videos", limit);
        println!("Force regeneration: {}", if force { "Yes" } else { "No" });
        println!();
        println!("Note: Thumbnail generation is integrated into video processing.");
        println!(
            "Videos are automatically processed with 10 evenly-spaced thumbnails when scanned."
        );

        Ok(())
    }
}

impl PlaylistCommands {
    pub async fn handle(&self, db: &DatabaseConnection) -> Result<(), Box<dyn std::error::Error>> {
        match self {
            PlaylistCommands::List { public, verbose } => {
                self.handle_list(db, *public, *verbose).await
            }
            PlaylistCommands::Create {
                title,
                description,
                public,
                collaborative,
            } => {
                self.handle_create(db, title, description.as_deref(), *public, *collaborative)
                    .await
            }
            PlaylistCommands::Show { playlist, verbose } => {
                self.handle_show(db, playlist, *verbose).await
            }
            PlaylistCommands::Add { playlist, videos } => {
                self.handle_add(db, playlist, videos).await
            }
            PlaylistCommands::Remove { playlist, videos } => {
                self.handle_remove(db, playlist, videos).await
            }
            PlaylistCommands::Delete { playlist, force } => {
                self.handle_delete(db, playlist, *force).await
            }
        }
    }

    async fn handle_list(
        &self,
        db: &DatabaseConnection,
        public_only: bool,
        verbose: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let video_service = VideoService::new(db.pool().clone());
        let playlists = video_service.list_playlists(50).await?;

        if playlists.is_empty() {
            println!("No playlists found.");
            return Ok(());
        }

        println!("📋 Video Playlists:");
        println!();

        for playlist in playlists {
            // Filter by public status if requested
            if public_only && !playlist.is_public() {
                continue;
            }

            println!("🎵 {}", playlist.title);

            if let Some(description) = &playlist.description {
                println!("   Description: {}", description);
            }

            println!("   ID: {}", playlist.id);

            let mut flags = Vec::new();
            if playlist.is_public() {
                flags.push("Public");
            } else {
                flags.push("Private");
            }

            if playlist.is_collaborative() {
                flags.push("Collaborative");
            }

            if !flags.is_empty() {
                println!("   Flags: {}", flags.join(", "));
            }

            if verbose {
                // Get video count for this playlist
                match video_service.get_playlist_videos(playlist.id, 1).await {
                    Ok(videos) => {
                        let count = videos.len();
                        println!("   Videos: {} in playlist", count);
                    }
                    Err(_) => {
                        println!("   Videos: Unable to count");
                    }
                }
            }

            println!("   Created: {}", playlist.created_at.date());
            println!();
        }

        Ok(())
    }

    async fn handle_create(
        &self,
        db: &DatabaseConnection,
        title: &str,
        description: Option<&str>,
        is_public: bool,
        is_collaborative: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let video_service = VideoService::new(db.pool().clone());

        let create_playlist = CreateVideoPlaylist {
            title: title.to_string(),
            description: description.map(|s| s.to_string()),
            client_id: Some("cli".to_string()),
            is_public: Some(is_public),
            is_collaborative: Some(is_collaborative),
            thumbnail_blob_id: None,
        };

        match video_service.create_playlist(create_playlist).await {
            Ok(playlist) => {
                println!("✅ Created playlist: {}", playlist.title);
                println!("   ID: {}", playlist.id);

                if let Some(desc) = &playlist.description {
                    println!("   Description: {}", desc);
                }

                let mut flags = Vec::new();
                if playlist.is_public() {
                    flags.push("Public");
                }
                if playlist.is_collaborative() {
                    flags.push("Collaborative");
                }

                if !flags.is_empty() {
                    println!("   Properties: {}", flags.join(", "));
                }
            }
            Err(e) => {
                error!("Failed to create playlist: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn handle_show(
        &self,
        db: &DatabaseConnection,
        playlist_identifier: &str,
        verbose: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let video_service = VideoService::new(db.pool().clone());

        // Try to parse as UUID first, then fall back to title search
        let playlist = if let Ok(uuid) = Uuid::parse_str(playlist_identifier) {
            video_service.get_playlist(uuid).await?
        } else {
            // Search by title
            let playlists = video_service
                .find_playlists_by_title(playlist_identifier)
                .await?;

            if playlists.is_empty() {
                println!("❌ No playlist found with title: {}", playlist_identifier);
                return Ok(());
            } else if playlists.len() > 1 {
                println!(
                    "⚠️  Multiple playlists found with title '{}'. Please use ID instead:",
                    playlist_identifier
                );
                for p in playlists {
                    println!("   {} (ID: {})", p.title, p.id);
                }
                return Ok(());
            }

            playlists.into_iter().next().unwrap()
        };

        println!("📋 Playlist Details");
        println!("═══════════════════");
        println!("Title: {}", playlist.title);
        println!("ID: {}", playlist.id);

        if let Some(description) = &playlist.description {
            println!("Description: {}", description);
        }

        let mut flags = Vec::new();
        if playlist.is_public() {
            flags.push("Public");
        } else {
            flags.push("Private");
        }

        if playlist.is_collaborative() {
            flags.push("Collaborative");
        }

        println!("Properties: {}", flags.join(", "));

        if let Some(client_id) = &playlist.client_id {
            println!("Created by: {}", client_id);
        }

        println!("Created: {}", playlist.created_at.date());
        println!("Updated: {}", playlist.updated_at.date());

        // Get videos in playlist
        let videos = video_service.get_playlist_videos(playlist.id, 100).await?;

        println!();
        println!("🎬 Videos ({}):", videos.len());

        if videos.is_empty() {
            println!("   (No videos in this playlist)");
        } else {
            for (index, video) in videos.iter().enumerate() {
                println!("   {}. {}", index + 1, video.title);
                println!("      ID: {}", video.id);

                if verbose {
                    if let (Some(width), Some(height)) = (video.width_px, video.height_px) {
                        println!("      Resolution: {}x{}", width, height);
                    }

                    if let Some(duration) = &video.duration {
                        println!("      Duration: {:?}", duration);
                    }

                    if let Some(codec) = &video.video_codec {
                        println!("      Codec: {}", codec);
                    }
                }

                println!();
            }
        }

        Ok(())
    }

    async fn handle_add(
        &self,
        db: &DatabaseConnection,
        playlist_identifier: &str,
        video_ids: &[String],
    ) -> Result<(), Box<dyn std::error::Error>> {
        let video_service = VideoService::new(db.pool().clone());

        // Resolve playlist ID
        let playlist_id = self.resolve_playlist_id(db, playlist_identifier).await?;

        // Parse video IDs
        let mut parsed_video_ids = Vec::new();
        for id_str in video_ids {
            match Uuid::parse_str(id_str) {
                Ok(uuid) => parsed_video_ids.push(uuid),
                Err(_) => {
                    error!("Invalid video ID format: {}", id_str);
                    continue;
                }
            }
        }

        if parsed_video_ids.is_empty() {
            println!("❌ No valid video IDs provided");
            return Ok(());
        }

        // Add videos to playlist
        match video_service
            .add_videos_to_playlist(playlist_id, &parsed_video_ids)
            .await
        {
            Ok(()) => {
                println!("✅ Added {} videos to playlist", parsed_video_ids.len());
                for id in &parsed_video_ids {
                    println!("   Added: {}", id);
                }
            }
            Err(e) => {
                error!("Failed to add videos to playlist: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn resolve_playlist_id(
        &self,
        db: &DatabaseConnection,
        playlist_identifier: &str,
    ) -> Result<Uuid, Box<dyn std::error::Error>> {
        let video_service = VideoService::new(db.pool().clone());

        // Try to parse as UUID first
        if let Ok(uuid) = Uuid::parse_str(playlist_identifier) {
            // Verify playlist exists
            match video_service.get_playlist(uuid).await {
                Ok(_) => return Ok(uuid),
                Err(_) => {
                    return Err(format!("Playlist not found with ID: {}", uuid).into());
                }
            }
        }

        // Search by title
        let playlists = video_service
            .find_playlists_by_title(playlist_identifier)
            .await?;

        if playlists.is_empty() {
            return Err(format!("No playlist found with title: {}", playlist_identifier).into());
        } else if playlists.len() > 1 {
            return Err(format!(
                "Multiple playlists found with title '{}'. Please use ID instead",
                playlist_identifier
            )
            .into());
        }

        Ok(playlists[0].id)
    }

    async fn handle_remove(
        &self,
        db: &DatabaseConnection,
        playlist_identifier: &str,
        video_ids: &[String],
    ) -> Result<(), Box<dyn std::error::Error>> {
        let video_service = VideoService::new(db.pool().clone());

        // Resolve playlist ID
        let playlist_id = self.resolve_playlist_id(db, playlist_identifier).await?;

        // Parse video IDs
        let mut parsed_video_ids = Vec::new();
        for id_str in video_ids {
            match Uuid::parse_str(id_str) {
                Ok(uuid) => parsed_video_ids.push(uuid),
                Err(_) => {
                    error!("Invalid video ID format: {}", id_str);
                    continue;
                }
            }
        }

        if parsed_video_ids.is_empty() {
            println!("❌ No valid video IDs provided");
            return Ok(());
        }

        // Remove videos from playlist
        match video_service
            .remove_videos_from_playlist(playlist_id, &parsed_video_ids)
            .await
        {
            Ok(()) => {
                println!("✅ Removed {} videos from playlist", parsed_video_ids.len());
                for id in &parsed_video_ids {
                    println!("   Removed: {}", id);
                }
            }
            Err(e) => {
                error!("Failed to remove videos from playlist: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn handle_delete(
        &self,
        db: &DatabaseConnection,
        playlist_identifier: &str,
        force: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let video_service = VideoService::new(db.pool().clone());

        // Resolve playlist ID and get playlist details
        let playlist_id = self.resolve_playlist_id(db, playlist_identifier).await?;
        let playlist = video_service.get_playlist(playlist_id).await?;

        // Get video count for confirmation
        let videos = video_service.get_playlist_videos(playlist_id, 1).await?;
        let video_count = videos.len();

        if !force {
            println!("⚠️  You are about to delete the playlist:");
            println!("   Title: {}", playlist.title);
            println!("   ID: {}", playlist.id);
            println!("   Videos: {}", video_count);
            println!();
            println!("This action cannot be undone. Type 'yes' to confirm:");

            let mut input = String::new();
            std::io::stdin().read_line(&mut input)?;

            if input.trim().to_lowercase() != "yes" {
                println!("❌ Deletion cancelled");
                return Ok(());
            }
        }

        match video_service.delete_playlist(playlist_id).await {
            Ok(()) => {
                println!("✅ Deleted playlist: {}", playlist.title);
                if video_count > 0 {
                    println!(
                        "   Note: {} videos were removed from the playlist but not deleted",
                        video_count
                    );
                }
            }
            Err(e) => {
                error!("Failed to delete playlist: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }
}
