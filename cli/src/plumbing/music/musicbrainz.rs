//! MusicBrainz API integration commands

use grimoire::plumbing::utils::CommandOutput;
use grimoire::error::GrimoireError;
use grimoire::music::musicbrainz::{
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
pub async fn handle_command(action: MusicBrainzAction) -> CommandOutput<serde_json::Value> {
    // Create client with config (enabled for testing)
    let mut config = MusicBrainzConfig::default();
    config.enabled = true;

    let client = match MusicBrainzClient::new(config) {
        Ok(c) => c,
        Err(e) => {
            return CommandOutput::failure(
                "Failed to create MusicBrainz client",
                vec![GrimoireError::ProcessingFailed {
                    message: e.to_string(),
                }
                .into()],
                (),
            )
        }
    };

    match action {
        MusicBrainzAction::SearchSong {
            title,
            artist,
            album,
            limit,
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

            let response = client.search_recordings(&query).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(results) = response.data else {
                return CommandOutput::failure("No search results data returned", vec![], ());
            };

            let message = format!(
                "Found {} recordings (total: {})",
                results.results.len(),
                results.count
            );
            CommandOutput::success(message, results)
        }
        MusicBrainzAction::SearchAlbum {
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
                return CommandOutput::failure(
                    "Must provide either --query OR both --artist and --album",
                    vec![],
                    (),
                );
            }

            let response = client.search_releases(&query).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(results) = response.data else {
                return CommandOutput::failure("No search results data returned", vec![], ());
            };

            let message = format!(
                "Found {} releases (total: {})",
                results.results.len(),
                results.count
            );
            CommandOutput::success(message, results)
        }
        MusicBrainzAction::GetRecording { recording_id } => {
            let response = client.get_recording(&recording_id).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(recording) = response.data else {
                return CommandOutput::failure("No recording data returned", vec![], ());
            };

            let message = format!("Recording: {}", recording.title);
            CommandOutput::success(message, recording)
        }
        MusicBrainzAction::GetRelease { release_id } => {
            let response = client.get_release(&release_id).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(release) = response.data else {
                return CommandOutput::failure("No release data returned", vec![], ());
            };

            let message = format!("Release: {}", release.title);
            CommandOutput::success(message, release)
        }
        MusicBrainzAction::GetCoverArt { release_id } => {
            let response = client.get_cover_art(&release_id).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(cover_arts) = response.data else {
                return CommandOutput::failure("No cover art data returned", vec![], ());
            };

            let message = format!("Found {} cover art images", cover_arts.len());
            CommandOutput::success(message, cover_arts)
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
                return CommandOutput::failure(
                    "Must provide either --query OR both --artist and --album",
                    vec![],
                    (),
                );
            }

            let response = client.search_releases_with_cover_art(&query).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(results) = response.data else {
                return CommandOutput::failure("No search results data returned", vec![], ());
            };

            let message = format!("Found {} releases with cover art", results.len());
            CommandOutput::success(message, results)
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
            CommandOutput::success(message, config_info)
        }
    }
}
