//! taxonomy module
//!
//! hierarchical, multi-kind classification for albums.
//!
//! - `taxon_kindz` rows describe each kind (genre, mood, instrument,
//!   era, key, location, label, bpm, loudness_db, energy, ...).
//! - `taxonz` rows are categorical nodes under a kind (e.g.
//!   `(kind=genre, label="rock")`).
//! - `taxon_parentz` is the DAG: a taxon may have multiple parents.
//!   cycle prevention is enforced in `add_taxon_parent` via a
//!   recursive cte before insert.
//! - `album_taxonz` links an album to a categorical taxon along with
//!   `origin` (user / musicbrainz / lastfm / audiodb / ...) and an
//!   optional confidence score.
//! - `scalar_attributez` holds numeric per-album values keyed by
//!   `taxon_kind_id` (bpm=128, energy=0.72, ...). these kinds have
//!   no rows in `taxonz`.

mod kinds;
mod models;
mod repository;

pub use kinds::{
    KIND_BPM, KIND_ENERGY, KIND_ERA, KIND_GENRE, KIND_INSTRUMENT, KIND_KEY, KIND_LABEL,
    KIND_LOCATION, KIND_LOUDNESS_DB, KIND_MOOD, SEEDED_KIND_SLUGS,
};
pub use models::{
    AddAlbumTaxonRequest, AddTaxonParentRequest, AlbumTaxonLink, AlbumTaxonLinkInput,
    CreateTaxonKindRequest, CreateTaxonRequest, GetAlbumTaxonLinksRequest, GetTaxonRequest,
    ListTaxonsByKindRequest, QueryScalarRangeRequest, QueryTaxonsRequest, RemoveAlbumTaxonRequest,
    RemoveTaxonParentRequest, ScalarAttribute, ScalarValueType, SetAlbumTaxonsRequest,
    SetScalarAttributeRequest, Taxon, TaxonKind, TaxonNode, TaxonRef, TaxonWithStats,
    TaxonsQueryResult,
};
pub use repository::{
    add_album_taxon, add_taxon_parent, create_taxon, create_taxon_kind, find_or_create_taxon,
    get_album_taxon_links, get_taxon, get_taxon_ancestors, get_taxon_descendants, list_taxon_kinds,
    list_taxons_by_kind, query_albums_by_scalar_range, query_taxons, remove_album_taxon,
    remove_taxon_parent, set_album_taxons, set_scalar_attribute, slugify_taxon_label,
};
