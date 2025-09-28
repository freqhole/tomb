//! MusicBrainz CLI module
//!
//! Provides command line interface for testing MusicBrainz integration
//! including song search, metadata preview, and bulk operations.

mod batch;
mod metadata;
mod search;
mod status;
mod utils;

use clap::{Args, Subcommand};
use grimoire::config::AppConfig;

// Re-export public types
pub use utils::get_musicbrainz_config;

#[derive(Debug, Clone, Args)]
pub struct MusicBrainzArgs {
    #[command(subcommand)]
    pub command: MusicBrainzCommands,
}

#[derive(Debug, Clone, Subcommand)]
pub enum MusicBrainzCommands {
    /// Search for a song on MusicBrainz
    SearchSong {
        /// Song title (optional)
        #[arg(short, long)]
        title: Option<String>,
        /// Artist name (optional)
        #[arg(short, long)]
        artist: Option<String>,
        /// Album name (optional)
        #[arg(short = 'l', long)]
        album: Option<String>,
        /// Duration in seconds (optional)
        #[arg(short, long)]
        duration: Option<u32>,
        /// Maximum results to return
        #[arg(long, default_value = "10")]
        limit: u32,
    },
    /// Search for albums/releases on MusicBrainz
    SearchAlbum {
        /// Artist name (optional)
        #[arg(short, long)]
        artist: Option<String>,
        /// Album/release title (optional)
        #[arg(short = 'l', long)]
        album: Option<String>,
        /// Release date (optional, format: YYYY or YYYY-MM or YYYY-MM-DD)
        #[arg(short, long)]
        date: Option<String>,
        /// Country code (optional)
        #[arg(short, long)]
        country: Option<String>,
        /// Maximum results to return
        #[arg(long, default_value = "10")]
        limit: u32,
    },
    /// Search MusicBrainz for songs in database
    SearchDatabase {
        /// Song ID to search for
        #[arg(short, long)]
        song_id: Option<String>,
        /// Limit number of songs to process
        #[arg(short, long, default_value = "10")]
        limit: i64,
        /// Show detailed results
        #[arg(short, long)]
        verbose: bool,
    },
    /// Preview metadata changes for a song
    PreviewMetadata {
        /// Song ID
        song_id: String,
        /// MusicBrainz recording ID
        recording_id: String,
    },
    /// Apply metadata changes to a song
    ApplyMetadata {
        /// Song ID
        song_id: String,
        /// MusicBrainz recording ID
        recording_id: String,
        /// Apply changes without confirmation
        #[arg(short, long)]
        force: bool,
    },
    /// Test MusicBrainz configuration
    TestConfig,
    /// Test MusicBrainz functionality with direct API calls
    TestDirect {
        /// Song ID to test with
        song_id: String,
    },
    /// Directly apply metadata from MusicBrainz recording
    ApplyDirect {
        /// Song ID to update
        song_id: String,
        /// MusicBrainz recording ID
        recording_id: String,
    },
    /// Batch process songs from an album with guided workflow
    BatchAlbum {
        /// Album name to search for in database
        album: String,
        /// Artist name to filter by (optional)
        #[arg(short, long)]
        artist: Option<String>,
        /// Auto-apply high confidence matches without confirmation
        #[arg(long)]
        auto_apply: bool,
        /// Minimum confidence threshold for auto-apply (0-100)
        #[arg(long, default_value = "85")]
        confidence_threshold: f32,
        /// Dry run mode - show changes without applying
        #[arg(long)]
        dry_run: bool,
    },
    /// Batch scan songs in database for MusicBrainz metadata
    BatchScan {
        /// Batch size for processing
        #[arg(long, default_value = "50")]
        batch_size: u32,
        /// Only scan songs that haven't been scanned before
        #[arg(long)]
        unscanned_only: bool,
        /// Rescan songs that have been updated since last scan
        #[arg(long)]
        rescan_updated: bool,
        /// Force rescan all songs regardless of previous scans
        #[arg(long)]
        force_rescan: bool,
        /// Search query to filter songs (e.g., "artist:amy" or "album:null")
        #[arg(long)]
        query: Option<String>,
        /// Artist filter (partial match)
        #[arg(long)]
        artist: Option<String>,
        /// Album filter (partial match)
        #[arg(long)]
        album: Option<String>,
        /// Only scan songs missing specific metadata
        #[arg(long)]
        missing_metadata: Option<String>, // e.g., "genre", "album", "artist"
        /// Auto-apply high confidence matches without confirmation
        #[arg(long)]
        auto_apply: bool,
        /// Minimum confidence threshold for auto-apply (0-100)
        #[arg(long, default_value = "85")]
        confidence_threshold: f32,
        /// Dry run mode - scan and store results without applying metadata
        #[arg(long)]
        dry_run: bool,
        /// Maximum number of songs to process (0 = no limit)
        #[arg(long, default_value = "0")]
        limit: u32,
    },
    /// Guided workflow for single song metadata update
    UpdateSong {
        /// Song ID or search term
        song: String,
        /// Skip confirmation prompts
        #[arg(short, long)]
        force: bool,
    },
    /// Show processing status and progress
    Status {
        /// Show detailed progress information
        #[arg(short, long)]
        detailed: bool,
        /// Filter by processing status
        #[arg(short, long)]
        filter: Option<String>,
    },
}

/// Main command handler dispatcher
pub async fn handle_musicbrainz_command(
    args: MusicBrainzArgs,
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        MusicBrainzCommands::SearchSong {
            title,
            artist,
            album,
            duration,
            limit,
        } => search::handle_search_song(title, artist, album, duration, limit, config).await,

        MusicBrainzCommands::SearchAlbum {
            artist,
            album,
            date,
            country,
            limit,
        } => search::handle_search_album(artist, album, date, country, limit, config).await,

        MusicBrainzCommands::SearchDatabase {
            song_id,
            limit,
            verbose,
        } => search::handle_search_database(song_id, limit, verbose, config).await,

        MusicBrainzCommands::PreviewMetadata {
            song_id,
            recording_id,
        } => metadata::handle_preview_metadata(song_id, recording_id, config).await,

        MusicBrainzCommands::ApplyMetadata {
            song_id,
            recording_id,
            force,
        } => metadata::handle_apply_metadata(song_id, recording_id, force, config).await,

        MusicBrainzCommands::TestConfig => utils::handle_test_config(config).await,

        MusicBrainzCommands::TestDirect { song_id } => {
            metadata::handle_test_direct(song_id, config).await
        }

        MusicBrainzCommands::ApplyDirect {
            song_id,
            recording_id,
        } => metadata::handle_apply_direct(song_id, recording_id, config).await,

        MusicBrainzCommands::BatchAlbum {
            album,
            artist,
            auto_apply,
            confidence_threshold,
            dry_run,
        } => {
            batch::handle_batch_album(
                &album,
                artist.as_deref(),
                auto_apply,
                confidence_threshold,
                dry_run,
                config,
            )
            .await
        }

        MusicBrainzCommands::BatchScan {
            batch_size,
            unscanned_only,
            rescan_updated,
            force_rescan,
            query,
            artist,
            album,
            missing_metadata,
            auto_apply,
            confidence_threshold,
            dry_run,
            limit,
        } => {
            batch::handle_batch_scan(
                batch_size,
                unscanned_only,
                rescan_updated,
                force_rescan,
                query,
                artist,
                album,
                missing_metadata,
                auto_apply,
                confidence_threshold,
                dry_run,
                limit,
                config,
            )
            .await
        }

        MusicBrainzCommands::UpdateSong { song, force } => {
            metadata::handle_update_song(&song, force, config).await
        }

        MusicBrainzCommands::Status { detailed, filter } => {
            status::handle_status(detailed, filter.as_deref(), config).await
        }
    }
}
