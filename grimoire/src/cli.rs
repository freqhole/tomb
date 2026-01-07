//! Simple CLI for testing the job queue system and unified database
//! Temporary implementation for development and testing purposes

use clap::{Parser, Subcommand};
use serde_json::json;
use sqlx::Row;

use crate::error::GrimoireResult;
use crate::jobs::{
    create_job, create_job_session, get_queue_stats, list_jobs, CreateJobRequest,
    CreateJobSessionRequest, JobType, ScanDirectoryParams,
};
use crate::wordlist::{
    generate_word_code, initialize_wordlist, is_initialized, ManagementWordlistConfig,
    WordlistConfig, WordlistService,
};

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Job queue management
    Jobs {
        #[command(subcommand)]
        action: JobAction,
    },
    /// Database operations
    Database {
        #[command(subcommand)]
        action: DatabaseAction,
    },
    /// Music query operations
    Music {
        #[command(subcommand)]
        action: MusicAction,
    },
    /// Wordlist operations
    Wordlist {
        #[command(subcommand)]
        action: WordlistAction,
    },
    /// User management operations
    Users {
        #[command(subcommand)]
        action: UserAction,
    },
}

#[derive(Subcommand)]
pub enum JobAction {
    /// List jobs in the queue
    List {
        /// Filter by session ID
        #[arg(long)]
        session_id: Option<String>,
        /// Maximum number of jobs to show
        #[arg(long, default_value = "20")]
        limit: u32,
    },
    /// Show queue statistics
    Stats,
    /// Create a directory scan job
    Scan {
        /// Directory path to scan
        path: String,
        /// Scan recursively
        #[arg(long)]
        recursive: Option<bool>,
        /// Maximum depth for recursive scanning
        #[arg(long)]
        max_depth: Option<u32>,
    },
    /// Create a file processing job
    ProcessFile {
        /// File path to process
        path: String,
    },
    /// Run the job processor to process pending jobs
    RunProcessor {
        /// Maximum number of jobs to process (0 for unlimited)
        #[arg(long, default_value = "0")]
        max_jobs: u32,
        /// Stop after processing all pending jobs
        #[arg(long)]
        once: bool,
    },
}

#[derive(Subcommand)]
pub enum DatabaseAction {
    /// Test database connection
    Test,
    /// Show database info
    Info,
}

#[derive(Subcommand)]
pub enum MusicAction {
    /// Query songs with filters and pagination
    QuerySongs {
        /// Search query
        #[arg(long)]
        search: Option<String>,
        /// Sort by field (title, artist, album, year, created_at)
        #[arg(long)]
        sort_by: Option<String>,
        /// Sort direction (asc, desc)
        #[arg(long)]
        sort_direction: Option<String>,
        /// Limit number of results
        #[arg(long, default_value = "10")]
        limit: u32,
        /// Offset for pagination
        #[arg(long, default_value = "0")]
        offset: u32,
        /// User ID for user-specific filtering
        #[arg(long)]
        user_id: Option<String>,
        /// Show only favorited songs (requires user-id)
        #[arg(long)]
        favorites_only: bool,
        /// Show only songs rated >= this value (requires user-id)
        #[arg(long)]
        min_rating: Option<i32>,
    },
    /// Query artists
    QueryArtists {
        /// Search query
        #[arg(long)]
        search: Option<String>,
        /// Filter by first letter (A-Z or # for non-alphabetic)
        #[arg(long)]
        starts_with: Option<String>,
        /// Sort by field (name, song_count, album_count)
        #[arg(long)]
        sort_by: Option<String>,
        /// Sort direction (asc, desc)
        #[arg(long)]
        sort_direction: Option<String>,
        /// Limit number of results
        #[arg(long, default_value = "10")]
        limit: u32,
        /// Offset for pagination
        #[arg(long, default_value = "0")]
        offset: u32,
    },
    /// Query albums
    QueryAlbums {
        /// Search query
        #[arg(long)]
        search: Option<String>,
        /// Sort by field (title, artist, year, song_count)
        #[arg(long)]
        sort_by: Option<String>,
        /// Sort direction (asc, desc)
        #[arg(long)]
        sort_direction: Option<String>,
        /// Limit number of results
        #[arg(long, default_value = "10")]
        limit: u32,
        /// Offset for pagination
        #[arg(long, default_value = "0")]
        offset: u32,
    },
    /// Query genres
    QueryGenres {
        /// Search query
        #[arg(long)]
        search: Option<String>,
        /// Sort by field (name)
        #[arg(long)]
        sort_by: Option<String>,
        /// Sort direction (asc, desc)
        #[arg(long)]
        sort_direction: Option<String>,
        /// Limit number of results
        #[arg(long, default_value = "10")]
        limit: u32,
        /// Offset for pagination
        #[arg(long, default_value = "0")]
        offset: u32,
    },
    /// Query playlists
    QueryPlaylists {
        /// Search query
        #[arg(long)]
        search: Option<String>,
        /// Sort by field (title, created_at, updated_at, song_count, duration)
        #[arg(long)]
        sort_by: Option<String>,
        /// Sort direction (asc, desc)
        #[arg(long)]
        sort_direction: Option<String>,
        /// Filter by public/private (true for public only, false for private only)
        #[arg(long)]
        is_public: Option<bool>,
        /// Limit number of results
        #[arg(long, default_value = "10")]
        limit: u32,
        /// Offset for pagination
        #[arg(long, default_value = "0")]
        offset: u32,
    },
    /// Query songs in a playlist
    QueryPlaylistSongs {
        /// Playlist ID
        #[arg(long)]
        playlist_id: String,
        /// Search query within playlist
        #[arg(long)]
        search: Option<String>,
        /// Sort by field (position, added_at, title, artist)
        #[arg(long)]
        sort_by: Option<String>,
        /// Sort direction (asc, desc)
        #[arg(long)]
        sort_direction: Option<String>,
        /// Limit number of results
        #[arg(long, default_value = "20")]
        limit: u32,
        /// Offset for pagination
        #[arg(long, default_value = "0")]
        offset: u32,
    },
    /// Create a new playlist
    CreatePlaylist {
        /// Playlist title
        #[arg(long)]
        title: String,
        /// Playlist description
        #[arg(long)]
        description: Option<String>,
        /// Make playlist public (default: private)
        #[arg(long)]
        public: bool,
    },
    /// Add songs to a playlist
    AddSongsToPlaylist {
        /// Playlist ID
        #[arg(long)]
        playlist_id: String,
        /// Song IDs to add (comma-separated)
        #[arg(long)]
        song_ids: String,
    },
    /// Update song position in playlist
    UpdateSongPosition {
        /// Playlist ID
        #[arg(long)]
        playlist_id: String,
        /// Song IDs to move (comma-separated)
        #[arg(long)]
        song_ids: String,
        /// New position (1-based)
        #[arg(long)]
        new_position: i64,
    },
    /// Delete playlist
    DeletePlaylist {
        /// Playlist ID
        #[arg(long)]
        playlist_id: String,
    },
    /// Update playlist metadata
    UpdatePlaylist {
        /// Playlist ID
        #[arg(long)]
        playlist_id: String,
        /// New title
        #[arg(long)]
        title: Option<String>,
        /// New description
        #[arg(long)]
        description: Option<String>,
        /// Set as public
        #[arg(long)]
        public: bool,
        /// Set as private
        #[arg(long)]
        private: bool,
        /// Path to thumbnail image file
        #[arg(long)]
        thumbnail_path: Option<String>,
        /// Existing media blob ID to use as thumbnail
        #[arg(long)]
        thumbnail_blob_id: Option<String>,
    },
    /// Remove playlist thumbnail
    RemovePlaylistThumbnail {
        /// Playlist ID
        #[arg(long)]
        playlist_id: String,
        /// Also delete the media blob if no other references exist
        #[arg(long)]
        cleanup_blob: bool,
    },
    /// Check media blob references
    CheckBlobReferences {
        /// Media blob ID to check
        #[arg(long)]
        blob_id: String,
    },
    /// Clean up orphaned media blobs
    CleanupOrphanedBlobs {
        /// Only clean up blobs older than this many days
        #[arg(long)]
        min_age_days: Option<f64>,
        /// Run in dry-run mode (don't actually delete)
        #[arg(long)]
        dry_run: bool,
    },
    /// Hard delete old soft-deleted records
    HardDeleteOldRecords {
        /// Retention period in days (default: 30)
        #[arg(long, default_value = "30")]
        retention_days: u32,
        /// Don't delete blob_data
        #[arg(long)]
        keep_blob_data: bool,
        /// Run in dry-run mode (don't actually delete)
        #[arg(long)]
        dry_run: bool,
    },
    /// Run full maintenance (orphaned blobs + hard delete)
    RunMaintenance {
        /// Retention period in days (default: 30)
        #[arg(long, default_value = "30")]
        retention_days: u32,
        /// Run in dry-run mode (don't actually delete)
        #[arg(long)]
        dry_run: bool,
    },
    /// List recent songs
    RecentSongs {
        /// Limit number of results
        #[arg(long, default_value = "10")]
        limit: u32,
    },
}

#[derive(Subcommand)]
pub enum UserAction {
    /// Create a new user
    Create {
        /// Username
        #[arg(long)]
        username: String,
        /// User role (admin, member)
        #[arg(long)]
        role: Option<String>,
        /// Invite code to use for registration
        #[arg(long)]
        invite_code: Option<String>,
        /// Bootstrap first admin user (bypasses invite code requirement)
        #[arg(long)]
        bootstrap: bool,
    },
    /// List users
    List {
        /// Filter by role
        #[arg(long)]
        role: Option<String>,
        /// Include deleted users
        #[arg(long)]
        include_deleted: bool,
        /// Limit number of results
        #[arg(long, default_value = "20")]
        limit: u32,
        /// Offset for pagination
        #[arg(long, default_value = "0")]
        offset: u32,
    },
    /// Update a user
    Update {
        /// User ID
        #[arg(long)]
        user_id: String,
        /// New role (admin, member)
        #[arg(long)]
        role: Option<String>,
    },
    /// Delete a user (soft delete)
    Delete {
        /// User ID
        #[arg(long)]
        user_id: String,
    },
    /// Generate invite codes
    GenerateInvites {
        /// Number of codes to generate
        #[arg(long, default_value = "1")]
        count: u32,
        /// Number of words per code
        #[arg(long, default_value = "3")]
        word_count: usize,
        /// Code type (invite, account-link)
        #[arg(long)]
        code_type: Option<String>,
        /// Expiration in hours
        #[arg(long)]
        expires_hours: Option<u32>,
    },
    /// List invite codes
    ListInvites {
        /// Show only active codes
        #[arg(long)]
        active_only: bool,
    },
    /// Deactivate an invite code
    DeactivateInvite {
        /// Invite code to deactivate
        code: String,
    },
    /// Set or update a favorite
    SetFavorite {
        /// User ID
        #[arg(long)]
        user_id: String,
        /// Target type (song, artist, album)
        #[arg(long)]
        target_type: String,
        /// Target ID
        #[arg(long)]
        target_id: String,
    },
    /// Remove a favorite
    RemoveFavorite {
        /// User ID
        #[arg(long)]
        user_id: String,
        /// Target type (song, artist, album)
        #[arg(long)]
        target_type: String,
        /// Target ID
        #[arg(long)]
        target_id: String,
    },
    /// List favorites for a user
    ListFavorites {
        /// User ID
        #[arg(long)]
        user_id: String,
        /// Filter by target type (song, artist, album)
        #[arg(long)]
        target_type: Option<String>,
        /// Limit number of results
        #[arg(long, default_value = "20")]
        limit: u32,
    },
    /// Set or update a rating
    SetRating {
        /// User ID
        #[arg(long)]
        user_id: String,
        /// Target type (song, artist, album)
        #[arg(long)]
        target_type: String,
        /// Target ID
        #[arg(long)]
        target_id: String,
        /// Rating value (1-5)
        #[arg(long)]
        rating: i32,
    },
    /// Remove a rating
    RemoveRating {
        /// User ID
        #[arg(long)]
        user_id: String,
        /// Target type (song, artist, album)
        #[arg(long)]
        target_type: String,
        /// Target ID
        #[arg(long)]
        target_id: String,
    },
    /// Get rating statistics for a target
    RatingStats {
        /// Target type (song, artist, album)
        #[arg(long)]
        target_type: String,
        /// Target ID
        #[arg(long)]
        target_id: String,
    },
    /// Get top-rated items
    TopRated {
        /// Target type (song, artist, album)
        #[arg(long)]
        target_type: String,
        /// Minimum number of ratings required
        #[arg(long, default_value = "1")]
        min_ratings: u64,
        /// Maximum number of results
        #[arg(long, default_value = "20")]
        limit: u64,
    },
}

#[derive(Subcommand)]
pub enum WordlistAction {
    /// Generate a wordlist using built-in categories
    Generate {
        /// Number of words to generate
        #[arg(long, default_value = "100")]
        count: usize,
        /// Include silly words
        #[arg(long)]
        include_silly: bool,
        /// Include animal words
        #[arg(long)]
        include_animals: bool,
        /// Include food words
        #[arg(long)]
        include_food: bool,
        /// Mix words randomly from all categories
        #[arg(long)]
        mixed: bool,
        /// Output file path (optional, prints to stdout if not provided)
        #[arg(long)]
        output: Option<String>,
    },
    /// Validate a wordlist file
    Validate {
        /// Path to wordlist file
        file_path: String,
    },
    /// Get statistics for a wordlist file
    Stats {
        /// Path to wordlist file
        file_path: String,
    },
    /// Generate word-based invite codes
    GenerateCode {
        /// Number of words in the code
        #[arg(long, default_value = "3")]
        word_count: usize,
        /// Number of codes to generate
        #[arg(long, default_value = "1")]
        count: usize,
        /// Wordlist file to use
        #[arg(long)]
        wordlist_file: Option<String>,
    },
}

pub async fn run_cli() -> GrimoireResult<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Jobs { action } => handle_job_command(action).await,
        Commands::Database { action } => handle_database_command(action).await,
        Commands::Music { action } => handle_music_command(action).await,
        Commands::Wordlist { action } => handle_wordlist_command(action).await,
        Commands::Users { action } => handle_user_command(action).await,
    }
}

async fn handle_job_command(action: JobAction) -> GrimoireResult<()> {
    match action {
        JobAction::List { session_id, limit } => {
            println!("listing jobs...");

            let jobs = list_jobs(session_id.as_deref(), None, Some(limit), None)
                .await
                .map_err(|e| crate::error::GrimoireError::Config {
                    message: format!("Failed to list jobs: {}", e),
                })?;

            if jobs.is_empty() {
                println!("No jobs found.");
            } else {
                println!("Found {} jobs:\n", jobs.len());
                println!(
                    "{:<16} {:<20} {:<12} {:<15} {:<20}",
                    "ID", "Type", "Status", "Retry Count", "Created"
                );
                println!("{}", "-".repeat(85));

                for job in jobs {
                    let job_type = job.job_type().unwrap_or_else(|_| JobType::ProcessFile);
                    let status = job
                        .status()
                        .unwrap_or_else(|_| crate::jobs::JobStatus::Pending);

                    // Format timestamp
                    let created_time = format_timestamp(job.scheduled_at);

                    println!(
                        "{:<16} {:<20} {:<12} {:<15} {:<20}",
                        &job.id[..8], // Show first 8 chars of ID
                        format!("{:?}", job_type),
                        format!("{:?}", status),
                        format!("{}/{}", job.retry_count, job.max_retries),
                        created_time
                    );
                }
            }
        }

        JobAction::Stats => {
            println!("queue statistics:");

            let stats =
                get_queue_stats()
                    .await
                    .map_err(|e| crate::error::GrimoireError::Config {
                        message: format!("Failed to get stats: {}", e),
                    })?;

            println!("  Pending Jobs:   {}", stats.pending_jobs);
            println!("  Running Jobs:   {}", stats.running_jobs);
            println!("  Completed Jobs: {}", stats.completed_jobs);
            println!("  Failed Jobs:    {}", stats.failed_jobs);
            println!("  Active Sessions: {}", stats.active_sessions);
            println!();

            let total_jobs =
                stats.pending_jobs + stats.running_jobs + stats.completed_jobs + stats.failed_jobs;
            if total_jobs > 0 {
                let success_rate = (stats.completed_jobs as f64 / total_jobs as f64) * 100.0;
                println!("  Success Rate: {:.1}%", success_rate);
            }
        }

        JobAction::Scan {
            path,
            recursive,
            max_depth,
        } => {
            println!("creating directory scan job for: {}", path);

            // First create a job session for the scan
            let session_request = CreateJobSessionRequest {
                job_type: JobType::ScanDirectory,
                batch_size: Some(100),
                created_by: Some("cli".to_string()),
            };

            let session = create_job_session(session_request).await.map_err(|e| {
                crate::error::GrimoireError::Config {
                    message: format!("Failed to create job session: {}", e),
                }
            })?;

            println!("created job session: {}", session.id);

            // Create the scan job
            let scan_params = ScanDirectoryParams {
                directory_path: path.clone(),
                recursive: recursive.unwrap_or(true),
                max_depth,
                file_extensions: None, // Use default audio extensions
            };

            let job_request = CreateJobRequest {
                job_type: JobType::ScanDirectory,
                session_id: Some(session.id.clone()),
                parameters: json!(scan_params),
                max_retries: Some(3),
                scheduled_at: None, // Immediate
                created_by: Some("cli".to_string()),
            };

            let job =
                create_job(job_request)
                    .await
                    .map_err(|e| crate::error::GrimoireError::Config {
                        message: format!("Failed to create scan job: {}", e),
                    })?;

            println!("created scan job: {}", job.id);
            println!("   Session: {}", session.id);
            println!("   Path: {}", path);
            println!("   Recursive: {}", recursive.unwrap_or(true));
            if let Some(depth) = max_depth {
                println!("   Max Depth: {}", depth);
            }

            println!(
                "\nuse 'grimoire jobs list --session-id {}' to check progress",
                session.id
            );
        }

        JobAction::ProcessFile { path } => {
            println!("creating file processing job for: {}", path);

            let job_request = CreateJobRequest {
                job_type: JobType::ProcessFile,
                session_id: None,
                parameters: json!({
                    "file_path": path,
                    "extract_metadata": true,
                    "generate_thumbnail": true,
                    "generate_waveform": false
                }),
                max_retries: Some(3),
                scheduled_at: None,
                created_by: Some("cli".to_string()),
            };

            let job =
                create_job(job_request)
                    .await
                    .map_err(|e| crate::error::GrimoireError::Config {
                        message: format!("Failed to create process file job: {}", e),
                    })?;

            println!("created process file job: {}", job.id);
            println!("   File: {}", path);

            println!("\nuse 'grimoire jobs list' to check progress");
        }

        JobAction::RunProcessor { max_jobs, once } => {
            println!("starting job processor...");
            if once {
                println!("   mode: process all pending jobs and exit");
            } else {
                println!("   mode: continuous processing");
            }
            if max_jobs > 0 {
                println!("   max jobs: {}", max_jobs);
            }
            println!();

            let result = if once {
                crate::jobs::run_job_processor_once(max_jobs).await
            } else {
                crate::jobs::run_job_processor().await
            };

            match result {
                Ok(_) => {
                    if once {
                        println!("finished processing all pending jobs");
                    }
                }
                Err(e) => {
                    println!("job processor error: {}", e);
                    return Err(crate::error::GrimoireError::Config {
                        message: format!("Job processor failed: {}", e),
                    });
                }
            }
        }
    }

    Ok(())
}

async fn handle_database_command(action: DatabaseAction) -> GrimoireResult<()> {
    match action {
        DatabaseAction::Test => {
            println!("testing database connection...");

            let pool = crate::database::connect().await?;

            // Test basic query
            let result: (i64,) = sqlx::query_as("SELECT 1").fetch_one(&pool).await?;

            if result.0 == 1 {
                println!("database connection successful");
            } else {
                println!("database connection test failed");
            }

            // Test tables exist
            println!("\nchecking tables:");
            let tables = vec![
                "media_blobz",
                "blob_data",
                "songz",
                "artistz",
                "albumz",
                "genrez",
                "jobz",
                "job_sessionz",
            ];

            for table in tables {
                let count_result = sqlx::query(&format!("SELECT COUNT(*) as count FROM {}", table))
                    .fetch_one(&pool)
                    .await;

                match count_result {
                    Ok(row) => {
                        let count: i64 = row.get("count");
                        println!("  {}: {} records", table, count);
                    }
                    Err(_) => {
                        println!("  {}: table not found or error", table);
                    }
                }
            }
        }

        DatabaseAction::Info => {
            println!("database information:");

            let config = crate::config::AppConfig::default();
            let db_path = config.database_file_path();

            println!("  database url: {}", config.database.database_url);
            println!("  database file: {}", db_path);

            // Check if file exists and get size
            if let Ok(metadata) = std::fs::metadata(&db_path) {
                println!("  file size: {:.2} mb", metadata.len() as f64 / 1_024_000.0);
                println!("  file exists: yes");
            } else {
                println!("  file exists: no");
            }

            // Test connection and get SQLite info
            if let Ok(pool) = crate::database::connect().await {
                if let Ok(row) = sqlx::query("SELECT sqlite_version()")
                    .fetch_one(&pool)
                    .await
                {
                    let version: String = row.get(0);
                    println!("  sqlite version: {}", version);
                }

                if let Ok(row) = sqlx::query("PRAGMA journal_mode").fetch_one(&pool).await {
                    let journal_mode: String = row.get(0);
                    println!("  journal mode: {}", journal_mode);
                }

                if let Ok(row) = sqlx::query("PRAGMA foreign_keys").fetch_one(&pool).await {
                    let foreign_keys: i64 = row.get(0);
                    println!(
                        "  foreign keys: {}",
                        if foreign_keys == 1 { "on" } else { "off" }
                    );
                }
            }
        }
    }

    Ok(())
}

async fn handle_music_command(action: MusicAction) -> GrimoireResult<()> {
    use crate::blob_data::cleanup_orphaned_media_blobs;
    use crate::maintenance::{
        cleanup_orphaned_media_blobs_older_than, run_full_maintenance_with_options,
        HardDeleteOptions,
    };
    use crate::music::crud::create_thumbnail_from_file;
    use crate::music::crud::{
        add_songs_to_playlist, create_playlist, delete_playlist, get_or_create_playlist_by_name,
        list_recent_songs, query_albums, query_artists, query_genres, query_playlist_songs,
        query_playlists, query_songs, remove_playlist_thumbnail, update_playlist,
        update_songs_position, CreatePlaylistRequest, QueryParams, UpdatePlaylistRequest,
    };
    use std::collections::HashMap;

    match action {
        MusicAction::QuerySongs {
            search,
            sort_by,
            sort_direction,
            limit,
            offset,
            user_id,
            favorites_only,
            min_rating,
        } => {
            println!("querying songs...");
            let params = QueryParams {
                q: search,
                search_fields: None,
                filters: std::collections::HashMap::new(),
                sort_by,
                sort_direction,
                limit: Some(limit),
                offset: Some(offset),
                user_id,
                favorites_only: if favorites_only { Some(true) } else { None },
                min_rating,
            };

            match query_songs(params).await {
                Ok(result) => {
                    println!(
                        "found {} songs (total: {})",
                        result.items.len(),
                        result.total_count
                    );
                    for song in result.items {
                        let track_info = format!(
                            "D{:02}T{:02}",
                            song.song.disc_number, song.song.track_number
                        );
                        let track_display = format!("[{}]", track_info);

                        println!(
                            "  {}{} - {} ({})",
                            track_display,
                            song.artist
                                .as_ref()
                                .map(|a| a.name.clone())
                                .unwrap_or("Unknown".to_string()),
                            song.song.title,
                            song.album
                                .as_ref()
                                .map(|a| a.title.clone())
                                .unwrap_or("No Album".to_string())
                        );
                    }
                    if result.has_more {
                        println!(
                            "...more results available (use --offset {})",
                            offset + limit
                        );
                    }
                }
                Err(e) => {
                    eprintln!("failed to query songs: {}", e);
                }
            }
        }
        MusicAction::QueryArtists {
            search,
            starts_with,
            sort_by,
            sort_direction,
            limit,
            offset,
        } => {
            println!("querying artists...");
            let mut filters = HashMap::new();
            if let Some(starts_with) = starts_with {
                filters.insert(
                    "starts_with".to_string(),
                    serde_json::Value::String(starts_with),
                );
            }
            let params = QueryParams {
                q: search,
                search_fields: None,
                filters: std::collections::HashMap::new(),
                sort_by,
                sort_direction,
                limit: Some(limit),
                offset: Some(offset),
                user_id: None,
                favorites_only: None,
                min_rating: None,
            };

            match query_artists(params).await {
                Ok(result) => {
                    println!(
                        "found {} artists (total: {})",
                        result.items.len(),
                        result.total_count
                    );
                    for artist in result.items {
                        println!(
                            "  {} ({} songs, {} albums)",
                            artist.artist.name, artist.song_count, artist.album_count
                        );
                    }
                    if result.has_more {
                        println!(
                            "...more results available (use --offset {})",
                            offset + limit
                        );
                    }
                }
                Err(e) => {
                    eprintln!("failed to query artists: {}", e);
                }
            }
        }
        MusicAction::QueryAlbums {
            search,
            sort_by,
            sort_direction,
            limit,
            offset,
        } => {
            println!("querying albums...");
            let params = QueryParams {
                q: search,
                search_fields: None,
                filters: std::collections::HashMap::new(),
                sort_by,
                sort_direction,
                limit: Some(limit),
                offset: Some(offset),
                user_id: None,
                favorites_only: None,
                min_rating: None,
            };

            match query_albums(params).await {
                Ok(result) => {
                    println!(
                        "found {} albums (total: {})",
                        result.items.len(),
                        result.total_count
                    );
                    for album in result.items {
                        println!(
                            "  {} - {} ({} songs)",
                            album
                                .artist
                                .as_ref()
                                .map(|a| a.name.clone())
                                .unwrap_or("Unknown".to_string()),
                            album.album.title,
                            album.album.song_count
                        );
                    }
                    if result.has_more {
                        println!(
                            "...more results available (use --offset {})",
                            offset + limit
                        );
                    }
                }
                Err(e) => {
                    eprintln!("failed to query albums: {}", e);
                }
            }
        }
        MusicAction::QueryGenres {
            search,
            sort_by,
            sort_direction,
            limit,
            offset,
        } => {
            println!("querying genres...");
            let params = QueryParams {
                q: search,
                search_fields: None,
                filters: std::collections::HashMap::new(),
                sort_by,
                sort_direction,
                limit: Some(limit),
                offset: Some(offset),
                user_id: None,
                favorites_only: None,
                min_rating: None,
            };

            match query_genres(params).await {
                Ok(result) => {
                    println!(
                        "found {} genres (total: {})",
                        result.items.len(),
                        result.total_count
                    );
                    for genre in result.items {
                        println!("  {}", genre.genre.name);
                    }
                    if result.has_more {
                        println!(
                            "...more results available (use --offset {})",
                            offset + limit
                        );
                    }
                }
                Err(e) => {
                    eprintln!("failed to query genres: {}", e);
                }
            }
        }
        MusicAction::QueryPlaylists {
            search,
            sort_by,
            sort_direction,
            is_public,
            limit,
            offset,
        } => {
            println!("querying playlists...");
            let mut filters = HashMap::new();
            if let Some(public) = is_public {
                filters.insert("is_public".to_string(), serde_json::Value::Bool(public));
            }

            let params = QueryParams {
                q: search,
                search_fields: None,
                filters: std::collections::HashMap::new(),
                sort_by,
                sort_direction,
                limit: Some(limit),
                offset: Some(offset),
                user_id: None,
                favorites_only: None,
                min_rating: None,
            };

            match query_playlists(params).await {
                Ok(result) => {
                    println!(
                        "found {} playlists (total: {})",
                        result.items.len(),
                        result.total_count
                    );
                    for playlist in result.items {
                        let public_status = if playlist.playlist.is_public == 1 {
                            "public"
                        } else {
                            "private"
                        };
                        println!(
                            "  {} ({} songs, {}) - {}",
                            playlist.playlist.title,
                            playlist.song_count,
                            public_status,
                            playlist
                                .playlist
                                .description
                                .unwrap_or_else(|| "No description".to_string())
                        );
                    }
                    if result.has_more {
                        println!(
                            "...more results available (use --offset {})",
                            offset + limit
                        );
                    }
                }
                Err(e) => {
                    eprintln!("failed to query playlists: {}", e);
                }
            }
        }
        MusicAction::QueryPlaylistSongs {
            playlist_id,
            search,
            sort_by,
            sort_direction,
            limit,
            offset,
        } => {
            println!("querying playlist songs...");
            let params = QueryParams {
                q: search,
                search_fields: None,
                filters: HashMap::new(),
                sort_by,
                sort_direction,
                limit: Some(limit),
                offset: Some(offset),
                user_id: None,
                favorites_only: None,
                min_rating: None,
            };

            match query_playlist_songs(&playlist_id, params).await {
                Ok(result) => {
                    println!(
                        "found {} songs in playlist (total: {})",
                        result.items.len(),
                        result.total_count
                    );
                    for song in result.items {
                        let track_info = format!(
                            "D{:02}T{:02}",
                            song.song.disc_number, song.song.track_number
                        );
                        println!(
                            "  [{}] {} - {} ({})",
                            track_info,
                            song.artist
                                .as_ref()
                                .map(|a| a.name.clone())
                                .unwrap_or("Unknown".to_string()),
                            song.song.title,
                            song.album
                                .as_ref()
                                .map(|a| a.title.clone())
                                .unwrap_or("Unknown".to_string())
                        );
                    }
                    if result.has_more {
                        println!(
                            "...more results available (use --offset {})",
                            offset + limit
                        );
                    }
                }
                Err(e) => {
                    eprintln!("failed to query playlist songs: {}", e);
                }
            }
        }
        MusicAction::CreatePlaylist {
            title,
            description,
            public,
        } => {
            println!("creating playlist...");
            let req = CreatePlaylistRequest {
                title: title.clone(),
                description,
                is_public: Some(public),
                created_by_id: None, // TODO: add user management
            };

            match create_playlist(req).await {
                Ok(playlist) => {
                    println!("created playlist: {} (ID: {})", playlist.title, playlist.id);
                    if playlist.is_public == 1 {
                        println!("  visibility: public");
                    } else {
                        println!("  visibility: private");
                    }
                    if let Some(desc) = &playlist.description {
                        println!("  description: {}", desc);
                    }
                }
                Err(e) => {
                    eprintln!("failed to create playlist: {}", e);
                }
            }
        }
        MusicAction::AddSongsToPlaylist {
            playlist_id,
            song_ids,
        } => {
            println!("adding songs to playlist...");
            let song_id_list: Vec<String> = song_ids
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();

            if song_id_list.is_empty() {
                eprintln!("no valid song IDs provided");
                return Ok(());
            }

            match add_songs_to_playlist(&playlist_id, &song_id_list).await {
                Ok(()) => {
                    println!(
                        "successfully added {} songs to playlist {}",
                        song_id_list.len(),
                        playlist_id
                    );
                    println!("song IDs: {:?}", song_id_list);
                }
                Err(e) => {
                    eprintln!("failed to add songs to playlist: {}", e);
                }
            }
        }
        MusicAction::UpdateSongPosition {
            playlist_id,
            song_ids,
            new_position,
        } => {
            println!("updating song position(s) in playlist...");
            let song_id_list: Vec<&str> = song_ids.split(',').map(|s| s.trim()).collect();
            match update_songs_position(&playlist_id, &song_id_list, new_position).await {
                Ok(()) => {
                    println!(
                        "successfully moved {} song(s) to position {} in playlist {}",
                        song_id_list.len(),
                        new_position,
                        playlist_id
                    );
                }
                Err(e) => {
                    eprintln!("failed to update song position: {}", e);
                    return Err(e.into());
                }
            }
        }
        MusicAction::DeletePlaylist { playlist_id } => {
            println!("deleting playlist...");
            match delete_playlist(&playlist_id, None).await {
                Ok(()) => {
                    println!("successfully deleted playlist {}", playlist_id);
                }
                Err(e) => {
                    eprintln!("failed to delete playlist: {}", e);
                    return Err(e.into());
                }
            }
        }
        MusicAction::UpdatePlaylist {
            playlist_id,
            title,
            description,
            public,
            private,
            thumbnail_path,
            thumbnail_blob_id,
        } => {
            println!("updating playlist metadata...");

            // Handle public/private flags
            let is_public = if public && private {
                eprintln!("error: cannot specify both --public and --private flags");
                return Ok(());
            } else if public {
                Some(true)
            } else if private {
                Some(false)
            } else {
                None
            };

            // Handle thumbnail options (mutually exclusive)
            let final_thumbnail_blob_id = if thumbnail_path.is_some() && thumbnail_blob_id.is_some()
            {
                eprintln!("error: cannot specify both --thumbnail-path and --thumbnail-blob-id");
                return Ok(());
            } else if let Some(path) = thumbnail_path {
                println!("creating thumbnail from file: {}", path);
                match create_thumbnail_from_file(&path, None).await {
                    Ok(blob_id) => {
                        println!("  created thumbnail blob: {}", blob_id);
                        Some(blob_id)
                    }
                    Err(e) => {
                        eprintln!("failed to create thumbnail from file: {}", e);
                        return Err(e.into());
                    }
                }
            } else if let Some(blob_id) = thumbnail_blob_id {
                println!("using existing thumbnail blob: {}", blob_id);
                Some(blob_id)
            } else {
                None
            };

            let req = UpdatePlaylistRequest {
                title: title.clone(),
                description: description.clone(),
                is_public,
                thumbnail_blob_id: final_thumbnail_blob_id,
                updated_by: None, // TODO: add user management
            };

            match update_playlist(&playlist_id, req).await {
                Ok(playlist) => {
                    println!("successfully updated playlist: {}", playlist.title);
                    if let Some(new_title) = &title {
                        println!("  title: {}", new_title);
                    }
                    if let Some(new_desc) = &description {
                        println!("  description: {}", new_desc);
                    }
                    if let Some(public) = is_public {
                        println!(
                            "  visibility: {}",
                            if public { "public" } else { "private" }
                        );
                    }
                    if let Some(blob_id) = &playlist.thumbnail_blob_id {
                        println!("  thumbnail blob: {}", blob_id);
                    }
                }
                Err(e) => {
                    eprintln!("failed to update playlist: {}", e);
                    return Err(e.into());
                }
            }
        }
        MusicAction::RemovePlaylistThumbnail {
            playlist_id,
            cleanup_blob,
        } => {
            println!("removing playlist thumbnail...");
            match remove_playlist_thumbnail(&playlist_id, cleanup_blob, None).await {
                Ok(playlist) => {
                    println!(
                        "successfully removed thumbnail from playlist: {}",
                        playlist.title
                    );
                    if cleanup_blob {
                        println!("  checked for unused media blob cleanup");
                    }
                }
                Err(e) => {
                    eprintln!("failed to remove playlist thumbnail: {}", e);
                    return Err(e.into());
                }
            }
        }
        MusicAction::CheckBlobReferences { blob_id } => {
            println!("checking references for media blob: {}", blob_id);
            use crate::media_blobz::find_media_blob_references;
            match find_media_blob_references(&blob_id).await {
                Ok(refs) => {
                    println!("Media blob {} reference summary:", blob_id);
                    println!("  Song media references: {}", refs.song_media_references);
                    println!(
                        "  Song thumbnail references: {}",
                        refs.song_thumbnail_references
                    );
                    println!(
                        "  Song waveform references: {}",
                        refs.song_waveform_references
                    );
                    println!(
                        "  Playlist thumbnail references: {}",
                        refs.playlist_thumbnail_references
                    );
                    println!(
                        "  Playlist image references: {}",
                        refs.playlist_image_references
                    );
                    println!(
                        "  Artist image references: {}",
                        refs.artist_image_references
                    );
                    println!("  Album image references: {}", refs.album_image_references);
                    println!("  Song image references: {}", refs.song_image_references);
                    println!("  Child blob references: {}", refs.child_blob_references);
                    println!("  Total references: {}", refs.total_references());
                    println!("  Can be safely deleted: {}", !refs.has_references());
                }
                Err(e) => {
                    eprintln!("failed to check blob references: {}", e);
                    return Err(e.into());
                }
            }
        }
        MusicAction::CleanupOrphanedBlobs {
            min_age_days,
            dry_run,
        } => {
            println!("cleaning up orphaned media blobs...");
            if dry_run {
                println!("DRY RUN MODE: No blobs will actually be deleted");
            }

            let result = if let Some(min_age) = min_age_days {
                cleanup_orphaned_media_blobs_older_than(min_age).await
            } else {
                cleanup_orphaned_media_blobs().await
            };

            match result {
                Ok(summary) => {
                    println!("Orphaned blob cleanup completed:");
                    println!("  Found {} orphaned blobs", summary.orphaned_blobs_found);
                    println!("  Deleted {} blobs", summary.orphaned_blobs_deleted);
                    println!("  Failed {} deletions", summary.deletion_failures);
                    println!("  Freed {} bytes", summary.bytes_freed);
                    println!("  Duration: {}ms", summary.duration_ms);
                }
                Err(e) => {
                    eprintln!("failed to cleanup orphaned blobs: {}", e);
                    return Err(e.into());
                }
            }
        }
        MusicAction::HardDeleteOldRecords {
            retention_days,
            keep_blob_data,
            dry_run,
        } => {
            println!("hard deleting old soft-deleted records...");
            if dry_run {
                println!("DRY RUN MODE: No records will actually be deleted");
            }

            let options = HardDeleteOptions {
                retention_days,
                delete_blob_data: !keep_blob_data,
                dry_run,
            };

            use crate::maintenance::hard_delete_old_records;
            match hard_delete_old_records(options).await {
                Ok(summary) => {
                    println!("Hard deletion completed:");
                    println!("  Songs deleted: {}", summary.songs_deleted);
                    println!("  Playlists deleted: {}", summary.playlists_deleted);
                    println!("  Artists deleted: {}", summary.artists_deleted);
                    println!("  Albums deleted: {}", summary.albums_deleted);
                    println!("  Media blobs deleted: {}", summary.media_blobs_deleted);
                    println!("  Blob data deleted: {}", summary.blob_data_deleted);
                    println!("  Total records deleted: {}", summary.total_records_deleted);
                    println!("  Duration: {}ms", summary.duration_ms);
                }
                Err(e) => {
                    eprintln!("failed to hard delete old records: {}", e);
                    return Err(e.into());
                }
            }
        }
        MusicAction::RunMaintenance {
            retention_days,
            dry_run,
        } => {
            println!("running full maintenance...");
            if dry_run {
                println!("DRY RUN MODE: No records will actually be deleted");
            }

            let options = HardDeleteOptions {
                retention_days,
                delete_blob_data: true,
                dry_run,
            };

            match run_full_maintenance_with_options(options).await {
                Ok(result) => {
                    println!("Full maintenance completed:");
                    println!();
                    println!("Orphaned blob cleanup:");
                    println!(
                        "  Found {} orphaned blobs",
                        result.orphaned_blobs_cleaned.orphaned_blobs_found
                    );
                    println!(
                        "  Deleted {} blobs",
                        result.orphaned_blobs_cleaned.orphaned_blobs_deleted
                    );
                    println!(
                        "  Freed {} bytes",
                        result.orphaned_blobs_cleaned.bytes_freed
                    );
                    println!();
                    println!("Hard deletion:");
                    println!(
                        "  Songs deleted: {}",
                        result.hard_delete_summary.songs_deleted
                    );
                    println!(
                        "  Playlists deleted: {}",
                        result.hard_delete_summary.playlists_deleted
                    );
                    println!(
                        "  Artists deleted: {}",
                        result.hard_delete_summary.artists_deleted
                    );
                    println!(
                        "  Albums deleted: {}",
                        result.hard_delete_summary.albums_deleted
                    );
                    println!(
                        "  Media blobs deleted: {}",
                        result.hard_delete_summary.media_blobs_deleted
                    );
                    println!(
                        "  Blob data deleted: {}",
                        result.hard_delete_summary.blob_data_deleted
                    );
                    println!();
                    println!("Total duration: {}ms", result.total_duration_ms);
                }
                Err(e) => {
                    eprintln!("failed to run maintenance: {}", e);
                    return Err(e.into());
                }
            }
        }
        MusicAction::RecentSongs { limit } => {
            println!("listing recent songs...");
            match list_recent_songs(Some(limit)).await {
                Ok(result) => {
                    println!("found {} recent songs", result.items.len());
                    for song in result.items {
                        println!(
                            "  {} - {} ({})",
                            song.artist
                                .as_ref()
                                .map(|a| a.name.clone())
                                .unwrap_or("Unknown".to_string()),
                            song.song.title,
                            song.album
                                .as_ref()
                                .map(|a| a.title.clone())
                                .unwrap_or("No Album".to_string())
                        );
                    }
                }
                Err(e) => {
                    eprintln!("failed to list recent songs: {}", e);
                }
            }
        }
    }

    Ok(())
}

async fn handle_wordlist_command(action: WordlistAction) -> GrimoireResult<()> {
    match action {
        WordlistAction::Generate {
            count,
            include_silly,
            include_animals,
            include_food,
            mixed,
            output,
        } => {
            println!("generating wordlist...");

            let config = WordlistConfig {
                count,
                include_silly,
                include_animals,
                include_food,
                mixed,
            };

            let service = WordlistService::new();
            match service.generate_wordlist(&config) {
                Ok(result) => {
                    let content = service.generate_wordlist_content(&config).map_err(|e| {
                        crate::error::GrimoireError::Config {
                            message: format!("Failed to generate wordlist content: {}", e),
                        }
                    })?;

                    if let Some(output_path) = output {
                        std::fs::write(&output_path, &content).map_err(|e| {
                            crate::error::GrimoireError::Config {
                                message: format!(
                                    "Failed to write wordlist to {}: {}",
                                    output_path, e
                                ),
                            }
                        })?;
                        println!("wordlist written to: {}", output_path);
                    } else {
                        println!("{}", content);
                    }

                    println!("generation result: {}", result);
                }
                Err(e) => {
                    eprintln!("failed to generate wordlist: {}", e);
                }
            }
        }
        WordlistAction::Validate { file_path } => {
            println!("validating wordlist: {}", file_path);

            let service = WordlistService::new();
            match service.validate_wordlist_file(&file_path) {
                Ok(result) => {
                    println!("{}", result);
                    if !result.is_valid {
                        std::process::exit(1);
                    }
                }
                Err(e) => {
                    eprintln!("failed to validate wordlist: {}", e);
                    std::process::exit(1);
                }
            }
        }
        WordlistAction::Stats { file_path } => {
            println!("analyzing wordlist: {}", file_path);

            let service = WordlistService::new();
            match service.get_wordlist_stats_file(&file_path) {
                Ok(stats) => {
                    println!("{}", stats);
                }
                Err(e) => {
                    eprintln!("failed to get wordlist stats: {}", e);
                    std::process::exit(1);
                }
            }
        }
        WordlistAction::GenerateCode {
            word_count,
            count,
            wordlist_file,
        } => {
            println!(
                "generating {} invite codes with {} words each...",
                count, word_count
            );

            if let Some(file_path) = wordlist_file {
                // Initialize wordlist from file
                let config = ManagementWordlistConfig {
                    file_path,
                    ..Default::default()
                };

                if let Err(e) = initialize_wordlist(&config) {
                    eprintln!("failed to initialize wordlist: {}", e);
                    std::process::exit(1);
                }
            } else if !is_initialized() {
                eprintln!("no wordlist initialized and no file provided");
                eprintln!("either provide --wordlist-file or initialize a wordlist first");
                std::process::exit(1);
            }

            for i in 1..=count {
                match generate_word_code(word_count) {
                    Ok(code) => {
                        if count > 1 {
                            println!("{}: {}", i, code);
                        } else {
                            println!("{}", code);
                        }
                    }
                    Err(e) => {
                        eprintln!("failed to generate code {}: {}", i, e);
                    }
                }
            }
        }
    }

    Ok(())
}

async fn handle_user_command(action: UserAction) -> GrimoireResult<()> {
    use crate::users::{
        CreateInviteCodeRequest, CreateUserRequest, FavoriteTarget, RatingTarget,
        SetFavoriteRequest, SetRatingRequest, UpdateUserRequest, UserQueryParams, UserRepository,
        UserRole, UserService,
    };

    let service = UserService::new();

    match action {
        UserAction::Create {
            username,
            role,
            invite_code,
            bootstrap,
        } => {
            println!("creating user: {}", username);

            let user_role = role.map(|r| match r.to_lowercase().as_str() {
                "admin" => UserRole::Admin,
                _ => UserRole::Member,
            });

            let request = CreateUserRequest {
                username: username.clone(),
                role: user_role,
                invite_code: if bootstrap { None } else { invite_code },
            };

            // Use bootstrap user creation for first admin, regular registration otherwise
            let result = if bootstrap {
                if user_role != Some(UserRole::Admin) {
                    eprintln!("bootstrap flag can only be used with --role admin");
                    std::process::exit(1);
                }
                // Directly use repository to bypass invite code validation for bootstrap
                let repository = UserRepository::new();
                repository.create_user(&request).await
            } else {
                service.register_user(&request).await
            };

            match result {
                Ok(user) => {
                    println!("user created successfully:");
                    println!("  ID: {}", user.id);
                    println!("  Username: {}", user.username);
                    println!("  Role: {}", user.role);
                    println!("  Created: {}", format_timestamp(user.created_at));
                }
                Err(e) => {
                    eprintln!("failed to create user: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::List {
            role,
            include_deleted,
            limit,
            offset,
        } => {
            println!("listing users...");

            let user_role = role.map(|r| match r.to_lowercase().as_str() {
                "admin" => UserRole::Admin,
                _ => UserRole::Member,
            });

            let params = UserQueryParams {
                username: None,
                role: user_role,
                include_deleted: Some(include_deleted),
                limit: Some(limit),
                offset: Some(offset),
            };

            // For CLI, we'll create a dummy admin user for authorization
            let admin_user = crate::users::User {
                id: "cli-admin".to_string(),
                username: "cli".to_string(),
                role: UserRole::Admin,
                created_at: 0,
                updated_at: 0,
                deleted_at: None,
            };

            match service.list_users(&params, &admin_user).await {
                Ok(users) => {
                    if users.is_empty() {
                        println!("no users found");
                    } else {
                        println!("found {} users:", users.len());
                        for user in users {
                            let status = if user.is_deleted() { " (DELETED)" } else { "" };
                            println!(
                                "  {} - {} ({}){}",
                                user.id, user.username, user.role, status
                            );
                        }
                    }
                }
                Err(e) => {
                    eprintln!("failed to list users: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::Update { user_id, role } => {
            println!("updating user: {}", user_id);

            let user_role = role.map(|r| match r.to_lowercase().as_str() {
                "admin" => UserRole::Admin,
                _ => UserRole::Member,
            });

            let request = UpdateUserRequest { role: user_role };

            let admin_user = crate::users::User {
                id: "cli-admin".to_string(),
                username: "cli".to_string(),
                role: UserRole::Admin,
                created_at: 0,
                updated_at: 0,
                deleted_at: None,
            };

            match service.update_user(&user_id, &request, &admin_user).await {
                Ok(user) => {
                    println!("user updated successfully:");
                    println!("  ID: {}", user.id);
                    println!("  Username: {}", user.username);
                    println!("  Role: {}", user.role);
                    println!("  Updated: {}", format_timestamp(user.updated_at));
                }
                Err(e) => {
                    eprintln!("failed to update user: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::Delete { user_id } => {
            println!("deleting user: {}", user_id);

            let admin_user = crate::users::User {
                id: "cli-admin".to_string(),
                username: "cli".to_string(),
                role: UserRole::Admin,
                created_at: 0,
                updated_at: 0,
                deleted_at: None,
            };

            match service.delete_user(&user_id, &admin_user).await {
                Ok(()) => {
                    println!("user deleted successfully");
                }
                Err(e) => {
                    eprintln!("failed to delete user: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::GenerateInvites {
            count,
            word_count,
            code_type,
            expires_hours,
        } => {
            println!(
                "generating {} invite codes with {} words each...",
                count, word_count
            );

            // Initialize wordlist if not already done - CLI responsibility
            if !crate::wordlist::is_initialized() {
                let config = crate::wordlist::ManagementWordlistConfig::default();
                if let Err(e) = crate::wordlist::initialize_wordlist(&config) {
                    eprintln!("failed to initialize wordlist: {}", e);
                    eprintln!("ensure wordlist file exists at: {}", config.file_path);
                    std::process::exit(1);
                }
            }

            let invite_type = code_type
                .map(|ct| match ct.to_lowercase().as_str() {
                    "account-link" => crate::users::InviteCodeType::AccountLink,
                    _ => crate::users::InviteCodeType::Invite,
                })
                .unwrap_or_default();

            let request = CreateInviteCodeRequest {
                code_type: Some(invite_type),
                link_for_user_id: None,
                expires_hours,
            };

            let admin_user = crate::users::User {
                id: "cli-admin".to_string(),
                username: "cli".to_string(),
                role: UserRole::Admin,
                created_at: 0,
                updated_at: 0,
                deleted_at: None,
            };

            match service
                .generate_invite_codes(&request, count, word_count, &admin_user)
                .await
            {
                Ok(codes) => {
                    println!("generated {} invite codes:", codes.len());
                    for (i, code) in codes.iter().enumerate() {
                        println!("  {}: {}", i + 1, code.code);
                        if let Some(expires) = code.link_expires_at {
                            println!("    Expires: {}", format_timestamp(expires));
                        }
                    }
                }
                Err(e) => {
                    eprintln!("failed to generate invite codes: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::ListInvites { active_only } => {
            println!("listing invite codes...");

            let admin_user = crate::users::User {
                id: "cli-admin".to_string(),
                username: "cli".to_string(),
                role: UserRole::Admin,
                created_at: 0,
                updated_at: 0,
                deleted_at: None,
            };

            match service.list_invite_codes(active_only, &admin_user).await {
                Ok(codes) => {
                    if codes.is_empty() {
                        println!("no invite codes found");
                    } else {
                        println!("found {} invite codes:", codes.len());
                        for code in codes {
                            let status = if code.used_at.is_some() {
                                " (USED)"
                            } else if !code.is_active {
                                " (INACTIVE)"
                            } else if code.is_expired() {
                                " (EXPIRED)"
                            } else {
                                ""
                            };
                            println!(
                                "  {} - {} ({}){}",
                                code.id, code.code, code.code_type, status
                            );
                        }
                    }
                }
                Err(e) => {
                    eprintln!("failed to list invite codes: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::DeactivateInvite { code } => {
            println!("deactivating invite code: {}", code);

            let admin_user = crate::users::User {
                id: "cli-admin".to_string(),
                username: "cli".to_string(),
                role: UserRole::Admin,
                created_at: 0,
                updated_at: 0,
                deleted_at: None,
            };

            match service.deactivate_invite_code(&code, &admin_user).await {
                Ok(()) => {
                    println!("invite code deactivated successfully");
                }
                Err(e) => {
                    eprintln!("failed to deactivate invite code: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::SetFavorite {
            user_id,
            target_type,
            target_id,
        } => {
            println!(
                "setting favorite: {} {} for user {}",
                target_type, target_id, user_id
            );

            let favorite_target = match target_type.to_lowercase().as_str() {
                "song" => FavoriteTarget::Song,
                "artist" => FavoriteTarget::Artist,
                "album" => FavoriteTarget::Album,
                "genre" => FavoriteTarget::Genre,
                "playlist" => FavoriteTarget::Playlist,
                _ => {
                    eprintln!(
                        "invalid target type: {}. Must be 'song', 'artist', 'album', 'genre', or 'playlist'",
                        target_type
                    );
                    std::process::exit(1);
                }
            };

            let favorites_service = crate::users::favorites::FavoritesService::new();
            let request = SetFavoriteRequest {
                user_id: user_id.clone(),
                target_type: favorite_target,
                target_id: target_id.clone(),
                is_favorite: true,
            };

            match favorites_service.set_favorite(&request).await {
                Ok(()) => {
                    println!("favorite set successfully");
                }
                Err(e) => {
                    eprintln!("failed to set favorite: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::RemoveFavorite {
            user_id,
            target_type,
            target_id,
        } => {
            println!(
                "removing favorite: {} {} for user {}",
                target_type, target_id, user_id
            );

            let favorite_target = match target_type.to_lowercase().as_str() {
                "song" => FavoriteTarget::Song,
                "artist" => FavoriteTarget::Artist,
                "album" => FavoriteTarget::Album,
                "genre" => FavoriteTarget::Genre,
                "playlist" => FavoriteTarget::Playlist,
                _ => {
                    eprintln!(
                        "invalid target type: {}. Must be 'song', 'artist', 'album', 'genre', or 'playlist'",
                        target_type
                    );
                    std::process::exit(1);
                }
            };

            let favorites_service = crate::users::favorites::FavoritesService::new();
            let request = SetFavoriteRequest {
                user_id: user_id.clone(),
                target_type: favorite_target,
                target_id: target_id.clone(),
                is_favorite: false,
            };

            match favorites_service.set_favorite(&request).await {
                Ok(()) => {
                    println!("favorite removed successfully");
                }
                Err(e) => {
                    eprintln!("failed to remove favorite: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::ListFavorites {
            user_id,
            target_type,
            limit,
        } => {
            println!("listing favorites for user: {}", user_id);

            let target_filter = target_type.map(|t| match t.to_lowercase().as_str() {
                "song" => FavoriteTarget::Song,
                "artist" => FavoriteTarget::Artist,
                "album" => FavoriteTarget::Album,
                "genre" => FavoriteTarget::Genre,
                "playlist" => FavoriteTarget::Playlist,
                _ => {
                    eprintln!(
                        "invalid target type: {}. Must be 'song', 'artist', 'album', 'genre', or 'playlist'",
                        t
                    );
                    std::process::exit(1);
                }
            });

            let favorites_service = crate::users::favorites::FavoritesService::new();

            match favorites_service
                .get_user_favorites(&user_id, target_filter, Some(limit), None)
                .await
            {
                Ok(favorites) => {
                    if favorites.is_empty() {
                        println!("no favorites found");
                    } else {
                        for favorite in favorites {
                            println!(
                                "  {} {}: {} (created: {})",
                                favorite.target_type,
                                favorite.target_id,
                                match favorite.target_type {
                                    FavoriteTarget::Song => "♪",
                                    FavoriteTarget::Artist => "👤",
                                    FavoriteTarget::Album => "💿",
                                    FavoriteTarget::Genre => "🏷️",
                                    FavoriteTarget::Playlist => "📂",
                                },
                                format_timestamp(favorite.created_at)
                            );
                        }
                    }
                }
                Err(e) => {
                    eprintln!("failed to list favorites: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::SetRating {
            user_id,
            target_type,
            target_id,
            rating,
        } => {
            if rating < 1 || rating > 5 {
                eprintln!("rating must be between 1 and 5");
                std::process::exit(1);
            }

            println!(
                "setting rating: {} {} = {} stars for user {}",
                target_type, target_id, rating, user_id
            );

            let rating_target = match target_type.to_lowercase().as_str() {
                "song" => RatingTarget::Song,
                "artist" => RatingTarget::Artist,
                "album" => RatingTarget::Album,
                _ => {
                    eprintln!(
                        "invalid target type: {}. Must be 'song', 'artist', or 'album'",
                        target_type
                    );
                    std::process::exit(1);
                }
            };

            let ratings_service = crate::users::ratings::RatingsService::new();
            let request = SetRatingRequest {
                user_id: user_id.clone(),
                target_type: rating_target,
                target_id: target_id.clone(),
                rating,
            };

            match ratings_service.set_rating(&request).await {
                Ok(_rating) => {
                    println!("rating set successfully");
                }
                Err(e) => {
                    eprintln!("failed to set rating: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::RemoveRating {
            user_id,
            target_type,
            target_id,
        } => {
            println!(
                "removing rating: {} {} for user {}",
                target_type, target_id, user_id
            );

            let rating_target = match target_type.to_lowercase().as_str() {
                "song" => RatingTarget::Song,
                "artist" => RatingTarget::Artist,
                "album" => RatingTarget::Album,
                _ => {
                    eprintln!(
                        "invalid target type: {}. Must be 'song', 'artist', or 'album'",
                        target_type
                    );
                    std::process::exit(1);
                }
            };

            let ratings_service = crate::users::ratings::RatingsService::new();

            match ratings_service
                .remove_rating(&user_id, rating_target, &target_id)
                .await
            {
                Ok(_removed) => {
                    println!("rating removed successfully");
                }
                Err(e) => {
                    eprintln!("failed to remove rating: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::RatingStats {
            target_type,
            target_id,
        } => {
            println!(
                "getting rating statistics for: {} {}",
                target_type, target_id
            );

            let rating_target = match target_type.to_lowercase().as_str() {
                "song" => RatingTarget::Song,
                "artist" => RatingTarget::Artist,
                "album" => RatingTarget::Album,
                _ => {
                    eprintln!(
                        "invalid target type: {}. Must be 'song', 'artist', or 'album'",
                        target_type
                    );
                    std::process::exit(1);
                }
            };

            let ratings_service = crate::users::ratings::RatingsService::new();

            match ratings_service
                .get_rating_stats(rating_target, &target_id)
                .await
            {
                Ok(stats) => {
                    println!("  Target: {} {}", stats.target_type, stats.target_id);
                    println!("  Total ratings: {}", stats.total_ratings);
                    println!("  Average rating: {:.1} stars", stats.average_rating);
                    println!("  Rating distribution:");
                    for (rating, count) in stats.rating_distribution {
                        let stars = "★".repeat(rating as usize);
                        println!("    {} ({}): {}", stars, rating, count);
                    }
                }
                Err(e) => {
                    eprintln!("failed to get rating statistics: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::TopRated {
            target_type,
            min_ratings,
            limit,
        } => {
            println!("getting top rated {} items...", target_type);

            let rating_target = match target_type.to_lowercase().as_str() {
                "song" => RatingTarget::Song,
                "artist" => RatingTarget::Artist,
                "album" => RatingTarget::Album,
                _ => {
                    eprintln!(
                        "invalid target type: {}. Must be 'song', 'artist', or 'album'",
                        target_type
                    );
                    std::process::exit(1);
                }
            };

            let ratings_service = crate::users::ratings::RatingsService::new();

            match ratings_service
                .get_top_rated(rating_target, Some(min_ratings), Some(limit as u32))
                .await
            {
                Ok(items) => {
                    if items.is_empty() {
                        println!("no rated items found");
                    } else {
                        for (i, item) in items.iter().enumerate() {
                            println!(
                                "{}. {} {} - {:.1} stars ({} ratings)",
                                i + 1,
                                if item.target_type == RatingTarget::Song {
                                    "♪"
                                } else if item.target_type == RatingTarget::Artist {
                                    "👤"
                                } else {
                                    "💿"
                                },
                                item.target_id,
                                item.average_rating,
                                item.total_ratings
                            );
                        }
                    }
                }
                Err(e) => {
                    eprintln!("failed to get top rated items: {}", e);
                    std::process::exit(1);
                }
            }
        }
    }

    Ok(())
}

fn format_timestamp(timestamp: i64) -> String {
    use std::time::UNIX_EPOCH;

    if let Some(duration) = UNIX_EPOCH.checked_add(std::time::Duration::from_secs(timestamp as u64))
    {
        let datetime = humantime::format_rfc3339_seconds(duration).to_string();
        // Simple format: just show date and time without timezone
        if let Some(t_pos) = datetime.find('T') {
            let date_part = &datetime[..t_pos];
            let time_part = &datetime[t_pos + 1..];
            if let Some(z_pos) = time_part.find('Z') {
                let time_clean = &time_part[..z_pos];
                return format!("{} {}", date_part, time_clean);
            }
        }
    }

    // Fallback to timestamp
    timestamp.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cli_parsing() {
        // Test that the CLI structure parses correctly
        let cli = Cli::try_parse_from(&["grimoire", "jobs", "stats"]);
        assert!(cli.is_ok());

        let cli = Cli::try_parse_from(&["grimoire", "database", "test"]);
        assert!(cli.is_ok());
    }
}
