//! albums module
//! handles album domain logic

pub mod external_url_proposals;
pub mod metadata;
mod models;
mod repository;
pub mod taxon_proposals;
mod update;

// re-export public types
pub use external_url_proposals::{
    apply_external_urls, propose_external_urls, AcceptedExternalUrl, ApplyExternalUrlsRequest,
    ApplyExternalUrlsResult, ExternalUrlProposal, ProposeExternalUrlsRequest,
    ProposeExternalUrlsResponse,
};
pub use models::{
    Album, CreateAlbumRequest, GenreRef, SetMbLookupStatusRequest, UpdateAlbumRequest,
};
pub use repository::{
    add_album_image, auto_confirm_mb_matches, clear_album_images, confirm_mb_match, create_album,
    delete_album, get_album, get_album_images, list_albums, merge_album_metadata,
    read_album_metadata, reject_mb_match, remove_album_image, set_mb_lookup_status,
    set_primary_album_image, update_mb_lookup_status,
};
pub use taxon_proposals::{
    apply_taxon_proposals, propose_taxons_for_album, AcceptedProposal, ApplyTaxonProposalsRequest,
    ApplyTaxonProposalsResult, ProposalSource, ProposeTaxonsRequest, TaxonProposal,
};
pub use update::update_album;
