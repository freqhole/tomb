//! albums module
//! handles album domain logic

mod models;
mod repository;

// re-export public types
pub use models::{Album, CreateAlbumRequest};
pub use repository::{create_album, get_album, list_albums};
