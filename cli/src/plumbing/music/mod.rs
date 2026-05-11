//! Music operations CLI commands
//!
//! Uses offal dispatch for most routes. Custom submodules for:
//! - maintenance: Blob cleanup, hard delete (no offal routes)
//! - scan: Directory scanning (no offal routes)

use crate::plumbing::dispatch::dispatch_to_offal;
use crate::plumbing::utils::{resolve_request, CommandOutput};
use clap::Subcommand;
use grimoire::music::crud::QueryParams;
use serde_json::json;

mod fetch;
mod images;
mod maintenance;
mod musicbrainz;
mod scan;
mod taxonomy;
mod user_favorites;
mod user_ratings;

pub use fetch::FetchAction;
pub use images::ImageAction;
pub use musicbrainz::MusicBrainzAction;
pub use scan::ScanAction;
pub use taxonomy::TaxonomyAction;
pub use user_favorites::FavoritesAction;
pub use user_ratings::RatingsAction;

#[derive(Subcommand)]
pub enum MusicAction {
    /// Query songs with filters and sorting
    QuerySongs {
        #[command(flatten)]
        params: QueryParams,
    },
    /// Query artists
    QueryArtists {
        #[command(flatten)]
        params: QueryParams,
    },
    /// Query albums
    QueryAlbums {
        #[command(flatten)]
        params: QueryParams,
    },
    /// Query genres
    QueryGenres {
        #[command(flatten)]
        params: QueryParams,
    },
    /// Query playlists
    QueryPlaylists {
        #[command(flatten)]
        params: QueryParams,
    },
    /// Query songs in a playlist
    QueryPlaylistSongs {
        /// Playlist ID
        #[arg(long)]
        playlist_id: String,
        #[command(flatten)]
        params: QueryParams,
    },
    /// Create a new playlist
    CreatePlaylist {
        /// Provide request as JSON (overrides individual fields)
        #[arg(long)]
        json_input: Option<String>,
        #[command(flatten)]
        request: grimoire::music::CreatePlaylistRequest,
    },
    /// Add songs to a playlist
    AddSongsToPlaylist {
        /// Provide request as JSON (overrides individual fields)
        #[arg(long)]
        json_input: Option<String>,
        #[command(flatten)]
        request: grimoire::music::AddSongsToPlaylistRequest,
    },
    /// Update song positions in playlist
    ReorderPlaylist {
        /// Playlist ID
        #[arg(long)]
        playlist_id: String,
        /// Song IDs in new order (comma-separated)
        #[arg(long, value_delimiter = ',')]
        song_ids: Vec<String>,
        /// New position (0-based index)
        #[arg(long)]
        new_position: i32,
    },
    /// Delete a playlist
    DeletePlaylist {
        /// Playlist ID
        #[arg(long)]
        playlist_id: String,
    },
    /// Update playlist metadata
    UpdatePlaylist {
        /// Provide request as JSON (overrides individual fields)
        #[arg(long)]
        json_input: Option<String>,
        #[command(flatten)]
        request: grimoire::music::UpdatePlaylistRequest,
    },
    /// Remove songs from playlist
    RemoveSongsFromPlaylist {
        /// Playlist ID
        #[arg(long)]
        playlist_id: String,
        /// Song IDs to remove (comma-separated)
        #[arg(long, value_delimiter = ',')]
        song_ids: Vec<String>,
    },

    // Maintenance commands (custom - no offal routes)
    /// Check what references a blob
    CheckBlobReferences {
        #[arg(long)]
        blob_id: String,
    },
    /// Cleanup orphaned blobs
    CleanupOrphanedBlobs {
        #[arg(long, default_value = "7")]
        min_age_days: i64,
        #[arg(long)]
        dry_run: bool,
    },
    /// Hard delete old records
    HardDeleteOldRecords {
        #[arg(long, default_value = "90")]
        retention_days: i64,
        #[arg(long)]
        keep_blob_data: bool,
        #[arg(long)]
        dry_run: bool,
    },
    /// Run all maintenance operations
    RunMaintenance {
        #[arg(long, default_value = "90")]
        retention_days: i64,
        #[arg(long)]
        dry_run: bool,
    },

    /// Show recently added songs
    RecentSongs {
        #[arg(long, default_value = "20")]
        limit: i64,
    },
    /// Update song metadata
    UpdateSongs {
        /// Provide request as JSON (overrides individual fields)
        #[arg(long)]
        json_input: Option<String>,
        #[command(flatten)]
        request: grimoire::music::crud::UpdateSongsRequest,
    },
    /// Delete song
    DeleteSong {
        #[arg(long)]
        song_id: String,
    },

    /// Get album by ID
    GetAlbum {
        #[arg(long)]
        album_id: String,
    },
    /// Delete album
    DeleteAlbum {
        #[arg(long)]
        album_id: String,
    },
    /// Get tags for an album
    GetAlbumTags {
        #[arg(long)]
        album_id: String,
    },

    /// Get artist by ID
    GetArtist {
        #[arg(long)]
        artist_id: String,
    },
    /// Delete artist
    DeleteArtist {
        #[arg(long)]
        artist_id: String,
    },

    /// Get genre by ID
    GetGenre {
        #[arg(long)]
        genre_id: String,
    },

    /// List all tags
    ListTags,
    /// Get tag by ID
    GetTag {
        #[arg(long)]
        tag_id: String,
    },
    /// Delete tag
    DeleteTag {
        #[arg(long)]
        tag_id: String,
    },

    /// MusicBrainz operations
    MusicBrainz {
        #[command(subcommand)]
        action: MusicBrainzAction,
    },
    /// Image management operations
    Images {
        #[command(subcommand)]
        action: ImageAction,
    },
    /// User favorites operations
    Favorites {
        #[command(subcommand)]
        action: FavoritesAction,
    },
    /// User ratings operations
    Ratings {
        #[command(subcommand)]
        action: RatingsAction,
    },
    /// Fetch media from external sources
    Fetch {
        #[command(subcommand)]
        action: FetchAction,
    },
    /// Scan and directory management
    Scan {
        #[command(subcommand)]
        action: ScanAction,
    },
    /// Cross-kind taxonomy operations (genre / mood / instrument / era /
    /// key / location / label / bpm / loudness_db / energy / ...)
    Taxonomy {
        #[command(subcommand)]
        action: TaxonomyAction,
    },
}

/// Handle music commands
pub async fn handle_command(action: MusicAction) -> CommandOutput<serde_json::Value> {
    match action {
        // Query commands - all use offal dispatch
        MusicAction::QuerySongs { params } => {
            dispatch_to_offal("/api/songs/query", serde_json::to_value(params).unwrap()).await
        }
        MusicAction::QueryArtists { params } => {
            dispatch_to_offal("/api/artists/query", serde_json::to_value(params).unwrap()).await
        }
        MusicAction::QueryAlbums { params } => {
            dispatch_to_offal("/api/albums/query", serde_json::to_value(params).unwrap()).await
        }
        MusicAction::QueryGenres { params } => {
            dispatch_to_offal("/api/genres/query", serde_json::to_value(params).unwrap()).await
        }
        MusicAction::QueryPlaylists { params } => {
            dispatch_to_offal(
                "/api/music/playlists/list",
                serde_json::to_value(params).unwrap(),
            )
            .await
        }
        MusicAction::QueryPlaylistSongs {
            playlist_id,
            params,
        } => {
            let mut body = serde_json::to_value(params).unwrap();
            body["playlist_id"] = json!(playlist_id);
            dispatch_to_offal("/api/playlists/songs", body).await
        }

        // Song commands
        MusicAction::RecentSongs { limit } => {
            dispatch_to_offal("/api/songs/recent", json!({ "limit": limit })).await
        }
        MusicAction::UpdateSongs {
            json_input,
            request,
        } => {
            let req = match resolve_request(json_input, request) {
                Ok(r) => r,
                Err(e) => {
                    return CommandOutput::failure(
                        "invalid request",
                        vec![grimoire::error::ErrorDetail::from(&e)],
                        (),
                    )
                }
            };
            dispatch_to_offal("/api/songs/update", serde_json::to_value(req).unwrap()).await
        }
        MusicAction::DeleteSong { song_id } => {
            dispatch_to_offal("/api/songs/delete", json!({ "id": song_id })).await
        }

        // Album commands
        MusicAction::GetAlbum { album_id } => {
            dispatch_to_offal("/api/albums/get", json!({ "id": album_id })).await
        }
        MusicAction::DeleteAlbum { album_id } => {
            dispatch_to_offal("/api/albums/delete", json!({ "id": album_id })).await
        }
        MusicAction::GetAlbumTags { album_id } => {
            dispatch_to_offal("/api/tags/albums/get", json!({ "album_ids": [album_id] })).await
        }

        // Artist commands
        MusicAction::GetArtist { artist_id } => {
            dispatch_to_offal("/api/artists/get", json!({ "id": artist_id })).await
        }
        MusicAction::DeleteArtist { artist_id } => {
            dispatch_to_offal("/api/artists/delete", json!({ "id": artist_id })).await
        }

        // Genre commands
        MusicAction::GetGenre { genre_id } => {
            dispatch_to_offal("/api/genres/get", json!({ "id": genre_id })).await
        }

        // Tag commands
        MusicAction::ListTags => dispatch_to_offal("/api/tags/list", json!({})).await,
        MusicAction::GetTag { tag_id } => {
            dispatch_to_offal("/api/tags/get", json!({ "id": tag_id })).await
        }
        MusicAction::DeleteTag { tag_id } => {
            dispatch_to_offal("/api/tags/delete", json!({ "id": tag_id })).await
        }

        // Playlist commands
        MusicAction::CreatePlaylist {
            json_input,
            request,
        } => {
            let req = match resolve_request(json_input, request) {
                Ok(r) => r,
                Err(e) => {
                    return CommandOutput::failure(
                        "invalid request",
                        vec![grimoire::error::ErrorDetail::from(&e)],
                        (),
                    )
                }
            };
            dispatch_to_offal("/api/music/playlists", serde_json::to_value(req).unwrap()).await
        }
        MusicAction::AddSongsToPlaylist {
            json_input,
            request,
        } => {
            let req = match resolve_request(json_input, request) {
                Ok(r) => r,
                Err(e) => {
                    return CommandOutput::failure(
                        "invalid request",
                        vec![grimoire::error::ErrorDetail::from(&e)],
                        (),
                    )
                }
            };
            dispatch_to_offal(
                "/api/playlists/add-songs",
                serde_json::to_value(req).unwrap(),
            )
            .await
        }
        MusicAction::ReorderPlaylist {
            playlist_id,
            song_ids,
            new_position,
        } => {
            dispatch_to_offal(
                "/api/playlists/reorder",
                json!({
                    "playlist_id": playlist_id,
                    "song_ids": song_ids,
                    "new_position": new_position
                }),
            )
            .await
        }
        MusicAction::DeletePlaylist { playlist_id } => {
            dispatch_to_offal("/api/playlists/delete", json!({ "id": playlist_id })).await
        }
        MusicAction::UpdatePlaylist {
            json_input,
            request,
        } => {
            let req = match resolve_request(json_input, request) {
                Ok(r) => r,
                Err(e) => {
                    return CommandOutput::failure(
                        "invalid request",
                        vec![grimoire::error::ErrorDetail::from(&e)],
                        (),
                    )
                }
            };
            dispatch_to_offal("/api/playlists/update", serde_json::to_value(req).unwrap()).await
        }
        MusicAction::RemoveSongsFromPlaylist {
            playlist_id,
            song_ids,
        } => {
            dispatch_to_offal(
                "/api/playlists/remove-songs",
                json!({ "playlist_id": playlist_id, "song_ids": song_ids }),
            )
            .await
        }

        // Maintenance commands - custom (no offal routes)
        MusicAction::CheckBlobReferences { blob_id } => {
            maintenance::handle_check_blob_references(blob_id).await
        }
        MusicAction::CleanupOrphanedBlobs {
            min_age_days,
            dry_run,
        } => maintenance::handle_cleanup_orphaned_blobs(min_age_days, dry_run).await,
        MusicAction::HardDeleteOldRecords {
            retention_days,
            keep_blob_data,
            dry_run,
        } => {
            maintenance::handle_hard_delete_old_records(retention_days, keep_blob_data, dry_run)
                .await
        }
        MusicAction::RunMaintenance {
            retention_days,
            dry_run,
        } => maintenance::handle_run_maintenance(retention_days, dry_run).await,

        // Subcommand modules
        MusicAction::MusicBrainz { action } => musicbrainz::handle_command(action).await,
        MusicAction::Images { action } => action.execute().await,
        MusicAction::Favorites { action } => user_favorites::handle_command(action).await,
        MusicAction::Ratings { action } => user_ratings::handle_command(action).await,
        MusicAction::Fetch { action } => fetch::handle_command(action).await,
        MusicAction::Scan { action } => scan::handle_command(action).await,
        MusicAction::Taxonomy { action } => taxonomy::handle_command(action).await,
    }
}
