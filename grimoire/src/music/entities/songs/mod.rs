//! songs module
//! handles song domain logic

mod models;
mod repository;

// re-export public types
pub use models::{CreateSongRequest, Song};
pub use repository::{create_song, delete_song, get_song, get_song_media_blob_id, list_songs};
