//! Music command definitions and argument parsing

use clap::Subcommand;
use std::path::PathBuf;
use uuid::Uuid;

use crate::music::musicbrainz::MusicBrainzArgs;

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

        /// Number of songs to show
        #[arg(long, short, default_value = "50")]
        limit: i64,

        /// Offset for pagination
        #[arg(long, short)]
        offset: Option<i64>,

        /// User ID to show preferences for (if not specified, shows global data)
        #[arg(long)]
        user_id: Option<String>,
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

        /// User ID who is removing the songs
        user_id: String,
    },

    /// Show songs in a playlist
    ShowPlaylist {
        /// Playlist title (or ID if exact match not found)
        playlist: String,

        /// Show detailed song information
        #[arg(long, short)]
        verbose: bool,

        /// User ID to show preferences for (if not specified, shows global data)
        #[arg(long)]
        user_id: Option<String>,
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

    /// Generate waveform visualizations for songs
    GenerateWaveforms {
        /// Maximum number of songs to process
        #[arg(long, default_value = "100")]
        limit: u32,

        /// Force regeneration of existing waveforms
        #[arg(long)]
        force: bool,
    },

    /// Backfill waveform visualizations for all songs in batches
    BackfillWaveforms {
        /// Batch size for processing
        #[arg(long, default_value = "50")]
        batch_size: u32,
        /// Force regeneration even if waveforms already exist
        #[arg(long)]
        force: bool,
    },

    /// Generate directory album art for songs missing thumbnails
    GenerateDirectoryArt {
        /// Maximum number of songs to process
        #[arg(long, default_value = "100")]
        limit: u32,
        /// Force regeneration even if thumbnails already exist
        #[arg(long)]
        force: bool,
    },

    /// Backfill directory album art for all songs in batches
    BackfillDirectoryArt {
        /// Batch size for processing
        #[arg(long, default_value = "50")]
        batch_size: u32,
        /// Force regeneration even if thumbnails already exist
        #[arg(long)]
        force: bool,
    },

    /// Backfill metadata for existing songs (artist, album, duration)
    BackfillMetadata {
        /// Batch size for processing
        #[arg(long, default_value = "50")]
        batch_size: u32,
        /// Force re-extraction even if metadata already exists
        #[arg(long)]
        force: bool,
    },

    /// Search for songs and playlists
    /// Search music
    Search {
        /// Search query (what to search for)
        query: String,

        /// Use structured search (key:value format for advanced filtering)
        #[arg(long)]
        structured: bool,

        /// Search type (websearch, plainto, phrase)
        #[arg(long, default_value = "websearch")]
        search_type: String,

        /// Number of results to show
        #[arg(long, short, default_value = "10")]
        limit: u32,

        /// Show detailed information
        #[arg(long, short)]
        verbose: bool,

        /// Search only songs (not playlists)
        #[arg(long)]
        songs_only: bool,

        /// Page number for pagination
        #[arg(long, default_value = "1")]
        page: u32,

        /// User ID to show preferences for (if not specified, shows global data)
        #[arg(long)]
        user_id: Option<String>,
    },

    /// Get search suggestions for autocomplete
    Suggest {
        /// Partial query to get suggestions for
        query: String,

        /// Maximum number of suggestions
        #[arg(long, short, default_value = "10")]
        limit: u32,
    },

    /// List all distinct song genres in alphabetical order
    Genres,

    /// List all distinct song sub-genres in alphabetical order (from array columns)
    Subgenres,

    /// MusicBrainz integration commands
    Musicbrainz {
        #[command(flatten)]
        args: MusicBrainzArgs,
    },
}
