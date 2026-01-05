//! artists module
//! handles artist domain logic

mod models;
mod repository;

// re-export public types
pub use models::{Artist, CreateArtistRequest};
pub use repository::{create_artist, get_artist, list_artists};
