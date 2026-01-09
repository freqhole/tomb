//! Music operations CLI commands
//!
//! This module is further divided into:
//! - query: Query commands (songs, artists, albums, genres, playlists)
//! - playlists: Playlist management (create, update, delete, etc)
//! - songs: Song operations (recent, update)
//! - maintenance: Maintenance operations (blob cleanup, hard delete)
//! - musicbrainz: MusicBrainz API integration

use crate::cli::output::{FormatOutput, OutputFormat};
use clap::Subcommand;

mod maintenance;
mod musicbrainz;
mod playlists;
mod query;
mod songs;

pub use musicbrainz::MusicBrainzAction;

#[derive(Subcommand)]
pub enum MusicAction {
    /// Query songs with filters and sorting
    QuerySongs {
        /// Search term for title, artist, album
        #[arg(long)]
        search: Option<String>,
        /// Sort field (title, artist, album, duration, etc)
        #[arg(long)]
        sort_by: Option<String>,
        /// Sort direction (asc, desc)
        #[arg(long)]
        sort_direction: Option<String>,
        /// Maximum number of results
        #[arg(long, default_value = "50")]
        limit: i64,
        /// Offset for pagination
        #[arg(long, default_value = "0")]
        offset: i64,
        /// Filter by user ID
        #[arg(long)]
        user_id: Option<String>,
        /// Show only favorites
        #[arg(long)]
        favorites_only: bool,
        /// Minimum rating filter
        #[arg(long)]
        min_rating: Option<i32>,
    },
    /// Query artists
    QueryArtists {
        /// Search term
        #[arg(long)]
        search: Option<String>,
        /// Filter artists starting with letter
        #[arg(long)]
        starts_with: Option<String>,
        /// Sort field
        #[arg(long)]
        sort_by: Option<String>,
        /// Sort direction
        #[arg(long)]
        sort_direction: Option<String>,
        /// Maximum number of results
        #[arg(long, default_value = "50")]
        limit: i64,
        /// Offset for pagination
        #[arg(long, default_value = "0")]
        offset: i64,
    },
    /// Query albums
    QueryAlbums {
        /// Search term
        #[arg(long)]
        search: Option<String>,
        /// Sort field
        #[arg(long)]
        sort_by: Option<String>,
        /// Sort direction
        #[arg(long)]
        sort_direction: Option<String>,
        /// Maximum number of results
        #[arg(long, default_value = "50")]
        limit: i64,
        /// Offset for pagination
        #[arg(long, default_value = "0")]
        offset: i64,
    },
    /// Query genres
    QueryGenres {
        /// Search term
        #[arg(long)]
        search: Option<String>,
        /// Sort field
        #[arg(long)]
        sort_by: Option<String>,
        /// Sort direction
        #[arg(long)]
        sort_direction: Option<String>,
        /// Maximum number of results
        #[arg(long, default_value = "50")]
        limit: i64,
        /// Offset for pagination
        #[arg(long, default_value = "0")]
        offset: i64,
    },
    /// Query playlists
    QueryPlaylists {
        /// Search term
        #[arg(long)]
        search: Option<String>,
        /// Sort field
        #[arg(long)]
        sort_by: Option<String>,
        /// Sort direction
        #[arg(long)]
        sort_direction: Option<String>,
        /// Filter by public/private
        #[arg(long)]
        is_public: Option<bool>,
        /// Maximum number of results
        #[arg(long, default_value = "50")]
        limit: i64,
        /// Offset for pagination
        #[arg(long, default_value = "0")]
        offset: i64,
    },
    /// Query songs in a playlist
    QueryPlaylistSongs {
        /// Playlist ID
        #[arg(long)]
        playlist_id: String,
        /// Search term
        #[arg(long)]
        search: Option<String>,
        /// Sort field
        #[arg(long)]
        sort_by: Option<String>,
        /// Sort direction
        #[arg(long)]
        sort_direction: Option<String>,
        /// Maximum number of results
        #[arg(long, default_value = "50")]
        limit: i64,
        /// Offset for pagination
        #[arg(long, default_value = "0")]
        offset: i64,
    },
    /// Create a new playlist
    CreatePlaylist {
        /// Provide request as JSON (overrides individual fields)
        #[arg(long)]
        json_input: Option<String>,

        /// Individual fields
        #[command(flatten)]
        request: crate::music::CreatePlaylistRequest,
    },
    /// Add songs to a playlist
    AddSongsToPlaylist {
        /// Provide request as JSON (overrides individual fields)
        #[arg(long)]
        json_input: Option<String>,

        /// Individual fields
        #[command(flatten)]
        request: crate::music::AddSongsToPlaylistRequest,
    },
    /// Update song position in playlist
    UpdateSongPosition {
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
        /// Playlist ID
        #[arg(long)]
        playlist_id: String,

        /// Provide request as JSON (overrides individual fields)
        #[arg(long)]
        json_input: Option<String>,

        /// Individual fields
        #[command(flatten)]
        request: crate::music::UpdatePlaylistRequest,
    },
    /// Remove playlist thumbnail
    RemovePlaylistThumbnail {
        /// Playlist ID
        #[arg(long)]
        playlist_id: String,
        /// Also cleanup the blob data
        #[arg(long)]
        cleanup_blob: bool,
    },
    /// Check what references a blob
    CheckBlobReferences {
        /// Blob ID to check
        #[arg(long)]
        blob_id: String,
    },
    /// Cleanup orphaned blobs
    CleanupOrphanedBlobs {
        /// Minimum age in days before cleanup
        #[arg(long, default_value = "7")]
        min_age_days: i64,
        /// Show what would be deleted without deleting
        #[arg(long)]
        dry_run: bool,
    },
    /// Hard delete old records
    HardDeleteOldRecords {
        /// Retention period in days
        #[arg(long, default_value = "90")]
        retention_days: i64,
        /// Keep blob data even if deleting records
        #[arg(long)]
        keep_blob_data: bool,
        /// Show what would be deleted without deleting
        #[arg(long)]
        dry_run: bool,
    },
    /// Run all maintenance operations
    RunMaintenance {
        /// Retention period in days
        #[arg(long, default_value = "90")]
        retention_days: i64,
        /// Show what would be done without doing it
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

        /// Individual fields
        #[command(flatten)]
        request: crate::music::crud::UpdateSongsRequest,
    },
    /// MusicBrainz operations
    MusicBrainz {
        #[command(subcommand)]
        action: MusicBrainzAction,
    },

    // Album operations
    /// List all albums
    ListAlbums {
        #[arg(long)]
        limit: Option<u32>,
        #[arg(long)]
        offset: Option<u32>,
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
        #[arg(long)]
        deleted_by: Option<String>,
    },
    /// Get tags for an album
    GetAlbumTags {
        #[arg(long)]
        album_id: String,
    },

    // Artist operations
    /// List all artists
    ListArtists {
        #[arg(long)]
        limit: Option<u32>,
        #[arg(long)]
        offset: Option<u32>,
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
        #[arg(long)]
        deleted_by: Option<String>,
    },

    // Song operations
    /// List all songs
    ListSongs {
        #[arg(long)]
        limit: Option<u32>,
        #[arg(long)]
        offset: Option<u32>,
    },
    /// Delete song
    DeleteSong {
        #[arg(long)]
        song_id: String,
        #[arg(long)]
        deleted_by: Option<String>,
    },

    // Playlist operations (additional)
    /// List all playlists
    ListPlaylists,
    /// List playlists for a user
    ListUserPlaylists {
        #[arg(long)]
        user_id: String,
        #[arg(long, default_value = "50")]
        limit: u32,
        #[arg(long, default_value = "0")]
        offset: u32,
    },
    /// Search playlists by name
    SearchPlaylists {
        #[arg(long)]
        query: String,
        #[arg(long, default_value = "50")]
        limit: u32,
        #[arg(long, default_value = "0")]
        offset: u32,
    },

    // Genre operations
    /// List all genres
    ListGenres,
    /// Get genre by ID
    GetGenre {
        #[arg(long)]
        genre_id: String,
    },
    /// Get genre statistics
    GetGenreStats {
        #[arg(long)]
        genre_id: String,
    },

    // Sub-genre operations
    /// List all sub-genres
    ListSubGenres,
    /// List sub-genres for a genre
    ListSubGenresForGenre {
        #[arg(long)]
        genre_id: String,
    },
    /// Get sub-genre by ID
    GetSubGenre {
        #[arg(long)]
        sub_genre_id: String,
    },
    /// Delete sub-genre
    DeleteSubGenre {
        #[arg(long)]
        sub_genre_id: String,
    },
    /// Find or create sub-genre
    FindOrCreateSubGenre {
        #[arg(long)]
        name: String,
        #[arg(long)]
        genre_id: String,
    },

    // Tag operations
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
    /// Search/query tags by name
    QueryTagsSearch {
        #[arg(long)]
        search: String,
    },

    // Additional query operations
    /// Search/query genres by name
    QueryGenresSearch {
        #[arg(long)]
        search: String,
    },
    /// Search/query sub-genres by name
    QuerySubGenresSearch {
        #[arg(long)]
        search: String,
    },
}

/// Handle music commands
pub async fn handle_command(action: MusicAction, json: bool) -> crate::error::GrimoireResult<()> {
    let format = OutputFormat::from_json_flag(json);

    match action {
        // Query commands (still using old style - will update these later)
        MusicAction::QuerySongs { .. } => query::handle_query_songs(action).await,
        MusicAction::QueryArtists { .. } => query::handle_query_artists(action).await,
        MusicAction::QueryAlbums { .. } => query::handle_query_albums(action).await,
        MusicAction::QueryGenres { .. } => query::handle_query_genres(action).await,
        MusicAction::QueryPlaylists { .. } => query::handle_query_playlists(action).await,
        MusicAction::QueryPlaylistSongs { .. } => query::handle_query_playlist_songs(action).await,

        // Playlist commands
        MusicAction::CreatePlaylist { .. } => {
            let output = playlists::handle_create_playlist(action).await?;
            print!("{}", output.format(format));
            Ok(())
        }
        MusicAction::AddSongsToPlaylist { .. } => playlists::handle_add_songs(action, format).await,
        MusicAction::UpdateSongPosition { .. } => playlists::handle_update_position(action).await,
        MusicAction::DeletePlaylist { .. } => playlists::handle_delete_playlist(action).await,
        MusicAction::UpdatePlaylist { .. } => {
            playlists::handle_update_playlist(action, format).await
        }
        MusicAction::RemovePlaylistThumbnail { .. } => {
            playlists::handle_remove_thumbnail(action).await
        }

        // Maintenance commands
        MusicAction::CheckBlobReferences { .. } => {
            maintenance::handle_check_blob_references(action).await
        }
        MusicAction::CleanupOrphanedBlobs { .. } => {
            maintenance::handle_cleanup_orphaned_blobs(action).await
        }
        MusicAction::HardDeleteOldRecords { .. } => {
            maintenance::handle_hard_delete_old_records(action).await
        }
        MusicAction::RunMaintenance { .. } => maintenance::handle_run_maintenance(action).await,

        // Song commands
        MusicAction::RecentSongs { .. } => songs::handle_recent_songs(action).await,
        MusicAction::UpdateSongs { .. } => songs::handle_update_songs(action, format).await,

        // MusicBrainz commands
        MusicAction::MusicBrainz { action } => musicbrainz::handle_command(action).await,

        // Album commands
        MusicAction::ListAlbums { .. } => {
            let output = query::handle_list_albums(action).await?;
            print!("{}", output.format(format));
            Ok(())
        }
        MusicAction::GetAlbum { .. } => query::handle_get_album(action).await,
        MusicAction::DeleteAlbum { .. } => query::handle_delete_album(action).await,
        MusicAction::GetAlbumTags { .. } => query::handle_get_album_tags(action).await,

        // Artist commands
        MusicAction::ListArtists { .. } => {
            let output = query::handle_list_artists(action).await?;
            print!("{}", output.format(format));
            Ok(())
        }
        MusicAction::GetArtist { .. } => query::handle_get_artist(action).await,
        MusicAction::DeleteArtist { .. } => query::handle_delete_artist(action).await,

        // Song commands
        MusicAction::ListSongs { .. } => {
            let output = query::handle_list_songs(action).await?;
            print!("{}", output.format(format));
            Ok(())
        }
        MusicAction::DeleteSong { .. } => query::handle_delete_song(action).await,

        // Additional playlist commands
        MusicAction::ListPlaylists => {
            let output = playlists::handle_list_playlists(action).await?;
            print!("{}", output.format(format));
            Ok(())
        }
        MusicAction::ListUserPlaylists { .. } => {
            playlists::handle_list_user_playlists(action).await
        }
        MusicAction::SearchPlaylists { .. } => playlists::handle_search_playlists(action).await,

        // Genre commands
        MusicAction::ListGenres => {
            let output = query::handle_list_genres(action).await?;
            print!("{}", output.format(format));
            Ok(())
        }
        MusicAction::GetGenre { .. } => query::handle_get_genre(action).await,
        MusicAction::GetGenreStats { .. } => query::handle_get_genre_stats(action).await,

        // Sub-genre commands
        MusicAction::ListSubGenres => {
            let output = query::handle_list_sub_genres(action).await?;
            print!("{}", output.format(format));
            Ok(())
        }
        MusicAction::ListSubGenresForGenre { .. } => {
            query::handle_list_sub_genres_for_genre(action).await
        }
        MusicAction::GetSubGenre { .. } => query::handle_get_sub_genre(action).await,
        MusicAction::DeleteSubGenre { .. } => query::handle_delete_sub_genre(action).await,
        MusicAction::FindOrCreateSubGenre { .. } => {
            query::handle_find_or_create_sub_genre(action).await
        }

        // Tag commands
        MusicAction::ListTags => {
            let output = query::handle_list_tags(action).await?;
            print!("{}", output.format(format));
            Ok(())
        }
        MusicAction::GetTag { .. } => query::handle_get_tag(action).await,
        MusicAction::DeleteTag { .. } => query::handle_delete_tag(action).await,
        MusicAction::QueryTagsSearch { .. } => query::handle_query_tags_search(action).await,

        // Additional query commands
        MusicAction::QueryGenresSearch { .. } => query::handle_query_genres_search(action).await,
        MusicAction::QuerySubGenresSearch { .. } => {
            query::handle_query_sub_genres_search(action).await
        }
    }
}
