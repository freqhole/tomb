//! albums module
//! handles album domain logic

pub mod metadata;
mod models;
mod repository;
mod update;

// re-export public types
pub use models::{Album, CreateAlbumRequest, GenreRef, UpdateAlbumRequest};
pub use repository::{
    add_album_image, clear_album_images, create_album, delete_album, get_album, get_album_images,
    list_albums, merge_album_metadata, read_album_metadata, remove_album_image,
    set_primary_album_image, update_mb_lookup_status,
};
pub use update::update_album;
