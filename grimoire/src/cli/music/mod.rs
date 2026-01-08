//! Music operations CLI commands
//!
//! This module is further divided into:
//! - query: Query commands (songs, artists, albums, genres, playlists)
//! - playlists: Playlist management (create, update, delete, etc)
//! - songs: Song operations (recent, update)
//! - maintenance: Maintenance operations (blob cleanup, hard delete)
//! - musicbrainz: MusicBrainz API integration

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
        /// Playlist title
        #[arg(long)]
        title: String,
        /// Playlist description
        #[arg(long)]
        description: Option<String>,
        /// Make playlist public
        #[arg(long)]
        public: bool,
    },
    /// Add songs to a playlist
    AddSongsToPlaylist {
        /// Playlist ID
        #[arg(long)]
        playlist_id: String,
        /// Song IDs to add (comma-separated)
        #[arg(long, value_delimiter = ',')]
        song_ids: Vec<String>,
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
        /// New title
        #[arg(long)]
        title: Option<String>,
        /// New description
        #[arg(long)]
        description: Option<String>,
        /// Make public
        #[arg(long)]
        public: bool,
        /// Make private
        #[arg(long)]
        private: bool,
        /// Path to thumbnail image file
        #[arg(long)]
        thumbnail_path: Option<String>,
        /// Blob ID for thumbnail
        #[arg(long)]
        thumbnail_blob_id: Option<String>,
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
        /// Song IDs (comma-separated)
        #[arg(long, value_delimiter = ',')]
        song_ids: Vec<String>,
        /// User ID performing the update
        #[arg(long)]
        user_id: String,
        /// Updated by (defaults to user_id)
        #[arg(long)]
        updated_by: Option<String>,
        /// New title
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        track_number: Option<i32>,
        #[arg(long)]
        disc_number: Option<i32>,
        #[arg(long)]
        year: Option<i32>,
        #[arg(long)]
        bpm: Option<i32>,
        #[arg(long)]
        key_signature: Option<String>,
        #[arg(long)]
        lyrics: Option<String>,
        /// Artist name
        #[arg(long)]
        artist: Option<String>,
        #[arg(long)]
        album: Option<String>,
        #[arg(long)]
        album_type: Option<String>,
        #[arg(long)]
        release_date: Option<String>,
        #[arg(long)]
        label: Option<String>,
        #[arg(long)]
        genre: Option<String>,
        #[arg(long)]
        sub_genre: Option<String>,
        #[arg(long)]
        thumbnail_blob_id: Option<String>,
        #[arg(long)]
        thumbnail_file: Option<String>,
        /// Tags to add (comma-separated)
        #[arg(long, value_delimiter = ',')]
        add_tags: Vec<String>,
        #[arg(long, value_delimiter = ',')]
        remove_tags: Vec<String>,
        #[arg(long, value_delimiter = ',')]
        replace_tags: Vec<String>,
        /// Favorite the song
        #[arg(long)]
        favorite_song: bool,
        #[arg(long)]
        favorite_artist: bool,
        #[arg(long)]
        favorite_album: bool,
        /// Rate the song (1-5)
        #[arg(long)]
        rate_song: Option<i32>,
        #[arg(long)]
        rate_artist: Option<i32>,
        #[arg(long)]
        rate_album: Option<i32>,
    },
    /// MusicBrainz operations
    MusicBrainz {
        #[command(subcommand)]
        action: MusicBrainzAction,
    },
}

/// Handle music commands
pub async fn handle_command(action: MusicAction) -> crate::error::GrimoireResult<()> {
    match action {
        // Query commands
        MusicAction::QuerySongs { .. } => query::handle_query_songs(action).await,
        MusicAction::QueryArtists { .. } => query::handle_query_artists(action).await,
        MusicAction::QueryAlbums { .. } => query::handle_query_albums(action).await,
        MusicAction::QueryGenres { .. } => query::handle_query_genres(action).await,
        MusicAction::QueryPlaylists { .. } => query::handle_query_playlists(action).await,
        MusicAction::QueryPlaylistSongs { .. } => query::handle_query_playlist_songs(action).await,

        // Playlist commands
        MusicAction::CreatePlaylist { .. } => playlists::handle_create_playlist(action).await,
        MusicAction::AddSongsToPlaylist { .. } => playlists::handle_add_songs(action).await,
        MusicAction::UpdateSongPosition { .. } => playlists::handle_update_position(action).await,
        MusicAction::DeletePlaylist { .. } => playlists::handle_delete_playlist(action).await,
        MusicAction::UpdatePlaylist { .. } => playlists::handle_update_playlist(action).await,
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
        MusicAction::UpdateSongs { .. } => songs::handle_update_songs(action).await,

        // MusicBrainz commands
        MusicAction::MusicBrainz { action } => musicbrainz::handle_command(action).await,
    }
}
