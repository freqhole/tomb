//! albums module
//! handles album domain logic

mod models;
mod repository;
mod update;

// re-export public types
pub use models::{Album, CreateAlbumRequest, UpdateAlbumRequest};
pub use repository::{
    add_album_image, clear_album_images, create_album, delete_album, get_album,
    get_album_images, list_albums, remove_album_image, set_primary_album_image,
};
pub use update::update_album;
