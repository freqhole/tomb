//! artists module
//! handles artist domain logic

mod models;
mod service;

// re-export public types
pub use models::{Artist, CreateArtistRequest};
pub use service::{create_artist, get_artist, list_artists};
