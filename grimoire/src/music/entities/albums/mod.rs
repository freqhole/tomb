//! albums module
//! handles album domain logic

mod models;
mod repository;
mod update;

// re-export public types
pub use models::{Album, CreateAlbumRequest, UpdateAlbumRequest};
pub use repository::{create_album, delete_album, get_album, get_album_images, list_albums};
pub use update::update_album;
