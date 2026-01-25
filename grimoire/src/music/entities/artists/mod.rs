//! artists module
//! handles artist domain logic

mod models;
mod repository;

// re-export public types
pub use models::{Artist, CreateArtistRequest, UpdateArtistRequest};
pub use repository::{
    create_artist, delete_artist, get_artist, get_artist_images, list_artists, update_artist,
};
