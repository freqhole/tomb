//! related artists — phase 13h.
//!
//! cross-source store of related-artist relations harvested from
//! lastfm / audiodb / musicbrainz enrichment payloads. lives outside
//! `artistz.metadata` because:
//!   - we want fk-driven "in your library" badges (cheap join).
//!   - relations stack across sources without blob churn.
//!   - bandcamp links accumulate over time (manual or future scraper).
//!
//! see [migrations/041_related_artistz.sql] for the schema.

mod models;
mod normalize;
mod repository;

pub use models::{
    BandcampAlbumLink, ExternalUrl, RelatedArtist, RelatedArtistSource, UpsertRelatedArtist,
};
pub use normalize::name_key;
pub use repository::{
    backfill_related_artist_for_local, list_related_for_artist, list_related_for_artists,
    list_relations_pointing_at, set_related_bandcamp, upsert_related_artist,
};
