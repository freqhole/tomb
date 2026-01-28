//! artists module
//! handles artist domain logic

mod models;
mod repository;

// re-export public types
pub use models::{Artist, CreateArtistRequest, UpdateArtistRequest};
pub use repository::{
    add_artist_image, clear_artist_images, create_artist, delete_artist, get_artist,
    get_artist_images, list_artists, remove_artist_image, set_primary_artist_image,
    update_artist,
};
