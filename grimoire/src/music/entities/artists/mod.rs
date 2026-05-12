//! artists module
//! handles artist domain logic

pub mod metadata;

mod models;
mod repository;

// re-export public types
pub use metadata::{ArtistAudioDbMetadata, ArtistLastFmMetadata, ArtistMetadata};
pub use models::{
    Artist, CreateArtistRequest, UpdateArtistMetadataRequest, UpdateArtistMetadataResponse,
    UpdateArtistRequest,
};
pub use repository::{
    add_artist_image, clear_artist_images, create_artist, delete_artist, get_artist,
    get_artist_images, list_artists, remove_artist_image, set_primary_artist_image, update_artist,
    update_artist_metadata,
};
