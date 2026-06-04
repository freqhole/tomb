//! artists module
//! handles artist domain logic

pub mod bio_proposals;
pub mod metadata;
pub mod related_proposals;

mod models;
mod repository;

// re-export public types
pub use bio_proposals::{
    apply_artist_bio, propose_artist_bios, ApplyArtistBioRequest, ApplyArtistBioResult,
    BioProposal, BioSource, ProposeArtistBiosRequest, ProposeArtistBiosResponse,
};
pub use metadata::{ArtistAudioDbMetadata, ArtistLastFmMetadata, ArtistMbMetadata, ArtistMetadata};
pub use models::{
    Artist, CreateArtistRequest, UpdateArtistMetadataRequest, UpdateArtistMetadataResponse,
    UpdateArtistRequest,
};
pub use related_proposals::{
    apply_related_artists, propose_related_artists, ApplyRelatedArtistsRequest,
    ApplyRelatedArtistsResult, ProposeRelatedArtistsRequest, ProposeRelatedArtistsResponse,
    RelatedArtistProposal,
};
pub use repository::{
    add_artist_image, clear_artist_images, create_artist, delete_artist, get_artist,
    get_artist_images, list_artists, merge_artist_metadata, remove_artist_image,
    set_primary_artist_image, update_artist, update_artist_metadata,
};
