//! songs module
//! handles song domain logic

mod models;
mod repository;

// re-export public types
pub use models::{CreateSongRequest, Song};
pub use repository::{
    add_song_image, bulk_clear_song_artwork, bulk_delete_songs, clear_song_artwork,
    clear_song_images, create_song, delete_song, get_all_song_sha256s, get_song,
    get_song_by_blake3, get_song_by_sha256, get_song_media_blob_id, list_songs, remove_song_image,
    set_primary_song_image,
};
