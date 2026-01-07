//! music domain module
//!
//! provides high-level API for music workflows and domain operations
//! encapsulates all database logic internally

// internal implementation details (not exposed in public API)
mod entities;

// public modules
pub mod crud;
pub mod musicbrainz;
pub mod scanner;

// re-export main workflow API
pub use crud::*;

// re-export scanner APIs
pub use scanner::*;

// re-export musicbrainz APIs
pub use musicbrainz::*;

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

// entities:: - Internal single-table CRUD (not exposed)
//   - albums/repository.rs, artists/repository.rs, etc.
//   - Only used internally by crud:: operations
