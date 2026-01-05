//! music domain module
//!
//! provides high-level API for music workflows and domain operations
//! encapsulates all database logic internally

// internal implementation details (not exposed in public API)
mod entities;

// public modules
pub mod crud;
pub mod scanner;
pub mod search;

// re-export main workflow API
pub use crud::*;

// re-export scanner and search APIs
pub use scanner::*;
// Note: search_songs comes from crud, so we use specific imports to avoid conflict
pub use search::{
    create_search_index,
    rebuild_search_index,
    search_albums,
    search_artists,
    search_songs as search_songs_fts, // rename to avoid conflict with crud::search_songs
    update_search_index,
    SearchFilter,
    SearchQuery,
    SearchRequest,
    SearchResult,
    SearchType,
    SongSearchResult,
};

// re-export core domain types for consumers
pub use entities::{
    Album, Artist, CreateAlbumRequest, CreateArtistRequest, CreateGenreRequest,
    CreatePlaylistRequest, CreateSongRequest, Genre, Playlist, Song, SubGenre,
};

// Public API structure:
//
// crud:: - Main workflow operations (public API)
//   - add_song() - creates song + artist + album + genre in one call
//   - find_or_create_artist() - case-insensitive artist deduplication
//   - find_or_create_album() - case-insensitive album deduplication
//   - bulk_import_songs() - processes multiple files with relationships
//   - (TODO) query operations, delete operations
//
// scanner:: - Filesystem scanning operations
//   - scan_directory() - discover audio files
//   - extract_metadata() - read audio file metadata
//
// search:: - Full-text search operations
//   - search_songs_fts() - FTS across songs/artists/albums (full-text)
//   - search_songs() - complex queries with joins (from crud)
//   - rebuild_search_index() - refresh search index
//
// entities:: - Internal single-table CRUD (not exposed)
//   - albums/repository.rs, artists/repository.rs, etc.
//   - Only used internally by crud:: operations
