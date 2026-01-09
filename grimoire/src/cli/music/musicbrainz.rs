//! MusicBrainz API integration commands

use crate::cli::utils::{CommandOutput, OutputFormat};
use crate::error::{GrimoireError, GrimoireResult};
use crate::music::musicbrainz::{
    MusicBrainzClient, MusicBrainzConfig, RecordingSearchQuery, ReleaseSearchQuery,
};
use clap::Subcommand;
use serde::Serialize;

#[derive(Subcommand)]
pub enum MusicBrainzAction {
    /// Search MusicBrainz for song/recording
    SearchSong {
        /// Song title
        #[arg(long)]
        title: String,
        /// Artist name
        #[arg(long)]
        artist: Option<String>,
        /// Album name
        #[arg(long)]
        album: Option<String>,
        /// Maximum number of results
        #[arg(long, default_value = "10")]
        limit: usize,
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },
    /// Search MusicBrainz for album/release
    SearchAlbum {
        /// Search query
        #[arg(long)]
        query: Option<String>,
        /// Artist name
        #[arg(long)]
        artist: Option<String>,
        /// Album name
        #[arg(long)]
        album: Option<String>,
        /// Maximum number of results
        #[arg(long, default_value = "10")]
        limit: usize,
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },
    /// Get recording details by MusicBrainz ID
    GetRecording { recording_id: String },
    /// Get release details by MusicBrainz ID
    GetRelease { release_id: String },
    /// Get cover art for a release
    GetCoverArt { release_id: String },
    /// Search for album with cover art
    SearchAlbumWithArt {
        /// Search query
        #[arg(long)]
        query: Option<String>,
        /// Artist name
        #[arg(long)]
        artist: Option<String>,
        /// Album name
        #[arg(long)]
        album: Option<String>,
        /// Maximum number of results
        #[arg(long, default_value = "5")]
        limit: usize,
    },
    /// Test MusicBrainz configuration
    TestConfig,
}

#[derive(Debug, Clone, Serialize)]
pub struct MusicBrainzSearchResults<T> {
    pub results: Vec<T>,
    pub count: usize,
}

/// Handle MusicBrainz commands
pub async fn handle_command(action: MusicBrainzAction, format: OutputFormat) -> GrimoireResult<()> {
    // Create client with config (enabled for testing)
    let mut config = MusicBrainzConfig::default();
    config.enabled = true;

    let client = MusicBrainzClient::new(config).map_err(|e| GrimoireError::ProcessingFailed {
        message: format!("Failed to create MusicBrainz client: {}", e),
    })?;

    match action {
        MusicBrainzAction::SearchSong {
            title,
            artist,
            album,
            limit,
            json,
        } => {
            let mut query = RecordingSearchQuery::new()
                .title(&title)
                .limit(limit as u32);

            if let Some(ref artist_name) = artist {
                query = query.artist(artist_name);
            }

            if let Some(ref album_name) = album {
                query = query.release(album_name);
            }

            let results = client.search_recordings(&query).await.map_err(|e| {
                GrimoireError::ProcessingFailed {
                    message: format!("Failed to search recordings: {}", e),
                }
            })?;

            let message = format!(
                "Found {} recordings (total: {})",
                results.results.len(),
                results.count
            );
            let output_format = if json { OutputFormat::Json } else { format };
            let output = CommandOutput::success(message, results);
            print!("{}", output.format(output_format));
        }
        MusicBrainzAction::SearchAlbum {
            query: query_text,
            artist,
            album,
            limit,
            json,
        } => {
            let mut query = ReleaseSearchQuery::new().limit(limit as u32);

            if let Some(q) = query_text {
                query = query.param("query", q);
            } else if let (Some(ref artist_name), Some(ref album_name)) = (&artist, &album) {
                query = query.artist(artist_name).release(album_name);
            } else {
                return Err(GrimoireError::ProcessingFailed {
                    message: "Must provide either --query OR both --artist and --album".to_string(),
                });
            }

            let results = client.search_releases(&query).await.map_err(|e| {
                GrimoireError::ProcessingFailed {
                    message: format!("Failed to search releases: {}", e),
                }
            })?;

            let message = format!(
                "Found {} releases (total: {})",
                results.results.len(),
                results.count
            );
            let output_format = if json { OutputFormat::Json } else { format };
            let output = CommandOutput::success(message, results);
            print!("{}", output.format(output_format));
        }
        MusicBrainzAction::GetRecording { recording_id } => {
            let recording = client.get_recording(&recording_id).await.map_err(|e| {
                GrimoireError::ProcessingFailed {
                    message: format!("Failed to fetch recording: {}", e),
                }
            })?;

            let message = format!("Recording: {}", recording.title);
            let output = CommandOutput::success(message, recording);
            print!("{}", output.format(OutputFormat::Json));
        }
        MusicBrainzAction::GetRelease { release_id } => {
            let release = client.get_release(&release_id).await.map_err(|e| {
                GrimoireError::ProcessingFailed {
                    message: format!("Failed to fetch release: {}", e),
                }
            })?;

            let message = format!("Release: {}", release.title);
            let output = CommandOutput::success(message, release);
            print!("{}", output.format(OutputFormat::Json));
        }
        MusicBrainzAction::GetCoverArt { release_id } => {
            let cover_arts = client.get_cover_art(&release_id).await.map_err(|e| {
                GrimoireError::ProcessingFailed {
                    message: format!("Failed to fetch cover art: {}", e),
                }
            })?;

            let message = format!("Found {} cover art images", cover_arts.len());
            let output = CommandOutput::success(message, cover_arts);
            print!("{}", output.format(format));
        }
        MusicBrainzAction::SearchAlbumWithArt {
            query: query_text,
            artist,
            album,
            limit,
        } => {
            let mut query = ReleaseSearchQuery::new().limit(limit as u32);

            if let Some(q) = query_text {
                query = query.param("query", q);
            } else if let (Some(ref artist_name), Some(ref album_name)) = (&artist, &album) {
                query = query.artist(artist_name).release(album_name);
            } else {
                return Err(GrimoireError::ProcessingFailed {
                    message: "Must provide either --query OR both --artist and --album".to_string(),
                });
            }

            let results = client
                .search_releases_with_cover_art(&query)
                .await
                .map_err(|e| GrimoireError::ProcessingFailed {
                    message: format!("Failed to search releases with cover art: {}", e),
                })?;

            let message = format!("Found {} releases with cover art", results.len());
            let output = CommandOutput::success(message, results);
            print!("{}", output.format(format));
        }
        MusicBrainzAction::TestConfig => {
            let config = client.config();
            let config_info = serde_json::json!({
                "enabled": config.enabled,
                "base_url": config.base_url,
                "cover_art_url": config.cover_art_url,
                "rate_limit_ms": config.rate_limit_ms,
                "user_agent": config.user_agent,
                "can_make_request": client.can_make_request().await,
                "time_until_next_request_ms": client.time_until_next_request().await.as_millis(),
            });

            let message = "MusicBrainz configuration is valid";
            let output = CommandOutput::success(message, config_info);
            print!("{}", output.format(format));
        }
    }

    Ok(())
}
