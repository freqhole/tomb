//! music domain module
//!
//! provides simple api for managing songs, artists, albums, playlists, and genres
//! encapsulates all database logic internally

pub mod albums;
pub mod artists;
pub mod genres;
pub mod playlists;
pub mod songs;

// re-export all public types from submodules
pub use albums::{Album, CreateAlbumRequest};
pub use artists::{Artist, CreateArtistRequest};
pub use songs::{CreateSongRequest, Song};

// re-export service functions from submodules
pub use artists::{create_artist, get_artist, list_artists};
pub use songs::{create_song, get_song, list_songs};
