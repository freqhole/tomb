//! internal domain entities for music database operations
//! single-table CRUD operations - not exposed in public API

pub mod albums;
pub mod artists;
pub mod genres;
pub mod playlists;
pub mod shared;
pub mod songs;
pub mod tags;

// re-export models for internal use within music module
pub use albums::{Album, CreateAlbumRequest};
pub use artists::{Artist, CreateArtistRequest};
pub use genres::{CreateGenreRequest, Genre, GenreStat, SubGenre};
pub use playlists::{CreatePlaylistRequest, Playlist};
pub use shared::ImageMetadata;
pub use songs::{CreateSongRequest, Song};
pub use tags::Tag;

// Note: repository functions are NOT re-exported here
// They remain internal to each entity module
// Public API consumers should use crud:: functions instead
