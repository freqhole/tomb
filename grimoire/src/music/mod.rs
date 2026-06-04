//! music domain module
//!
//! provides high-level API for music workflows and domain operations
//! encapsulates all database logic internally

// entity modules - basic CRUD operations organized by entity type
pub mod entities;

// public modules
pub mod analytics;
pub mod audiodb;
pub mod crud;
pub mod fetch;
pub mod lastfm;
pub mod musicbrainz;
pub mod scanner;
pub mod users;

// re-export main workflow API
pub use crud::*;

// re-export scanner APIs
pub use scanner::*;

// re-export musicbrainz APIs
pub use musicbrainz::*;

// re-export music-specific user functionality (explicit to avoid ambiguous globs)
pub use users::{FavoritesService, RatingStats, RatingsService};

// Public API structure:
//
// entities:: - Basic CRUD operations organized by entity type
//   - entities::artists::{create_artist, get_artist, list_artists, Artist, CreateArtistRequest}
//   - entities::playlists::{create_playlist, get_playlist, Playlist, CreatePlaylistRequest}
//   - entities::albums::{create_album, get_album, Album, CreateAlbumRequest}
//   - entities::songs::{create_song, list_songs, Song, CreateSongRequest}
//   - entities::taxonomy::{find_or_create_taxon, query_taxons, ...} - genres + other taxonomies
//   - entities::tags::{create_tag, get_tag, Tag}
//
// crud:: - High-level workflow operations (coordinates multiple entities)
//   - add_song() - creates song + artist + album + genre in one call
//   - find_or_create_artist() - case-insensitive artist deduplication
//   - find_or_create_album() - case-insensitive album deduplication
//   - bulk_import_songs() - processes multiple files with relationships
//   - query_songs() - unified query with FTS, filters, pagination
//   - query_artists(), query_albums() - aggregated queries
//
// scanner:: - Filesystem scanning operations
//   - scan_directory() - discover audio files
//   - extract_metadata() - read audio file metadata
