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
        /// Song ID to move
        #[arg(long)]
        song_id: String,
        /// New position (1-based)
        #[arg(long)]
        new_position: i64,
    },
    /// List recent songs
    RecentSongs {
        /// Limit number of results
        #[arg(long, default_value = "10")]
        limit: u32,
    },
}

pub async fn run_cli() -> GrimoireResult<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Jobs { action } => handle_job_command(action).await,
        Commands::Database { action } => handle_database_command(action).await,
        Commands::Music { action } => handle_music_command(action).await,
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
    use crate::music::crud::{
        add_songs_to_playlist, create_playlist, get_or_create_playlist_by_name, list_recent_songs,
        query_albums, query_artists, query_genres, query_playlist_songs, query_playlists,
        query_songs, update_song_position, CreatePlaylistRequest, QueryParams,
    };
    use std::collections::HashMap;

    match action {
        MusicAction::QuerySongs {
            search,
            sort_by,
            sort_direction,
            limit,
            offset,
        } => {
            println!("querying songs...");
            let params = QueryParams {
                q: search,
                search_fields: None,
                filters: HashMap::new(),
                sort_by,
                sort_direction,
                limit: Some(limit),
                offset: Some(offset),
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
                filters,
                sort_by,
                sort_direction,
                limit: Some(limit),
                offset: Some(offset),
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
                filters: HashMap::new(),
                sort_by,
                sort_direction,
                limit: Some(limit),
                offset: Some(offset),
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
                filters: HashMap::new(),
                sort_by,
                sort_direction,
                limit: Some(limit),
                offset: Some(offset),
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
                filters,
                sort_by,
                sort_direction,
                limit: Some(limit),
                offset: Some(offset),
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
                created_by_rowid: None, // TODO: add user management
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
            song_id,
            new_position,
        } => {
            println!("updating song position in playlist...");
            match update_song_position(&playlist_id, &song_id, new_position).await {
                Ok(()) => {
                    println!(
                        "successfully moved song {} to position {} in playlist {}",
                        song_id, new_position, playlist_id
                    );
                }
                Err(e) => {
                    eprintln!("failed to update song position: {}", e);
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
