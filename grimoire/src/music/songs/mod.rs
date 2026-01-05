//! songs module
//! handles song domain logic

mod models;
mod service;

// re-export public types
pub use models::{CreateSongRequest, Song};
pub use service::{create_song, get_song, list_songs};
