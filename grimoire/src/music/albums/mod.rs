//! albums module
//! handles album domain logic

mod models;
mod service;

// re-export public types
pub use models::{Album, CreateAlbumRequest};
pub use service::{create_album, delete_album, get_album, list_albums};
