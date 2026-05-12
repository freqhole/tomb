//! seeded `taxon_kindz` slug constants.
//!
//! every code path that needs a known kind looks it up by slug — ids
//! are auto-generated and never referenced from rust.

pub const KIND_GENRE: &str = "genre";
pub const KIND_MOOD: &str = "mood";
pub const KIND_INSTRUMENT: &str = "instrument";
pub const KIND_ERA: &str = "era";
pub const KIND_KEY: &str = "key";
pub const KIND_LOCATION: &str = "location";
pub const KIND_LABEL: &str = "label";
pub const KIND_RELEASE_DATE: &str = "release_date";
pub const KIND_LOUDNESS_DB: &str = "loudness_db";
pub const KIND_ENERGY: &str = "energy";

// phase 14: enrichment-driven kinds (migration 040).
pub const KIND_SUBGENRE: &str = "subgenre";
pub const KIND_THEME: &str = "theme";
pub const KIND_STYLE: &str = "style";
pub const KIND_SPEED: &str = "speed";
pub const KIND_COUNTRY: &str = "country";
pub const KIND_DECADE: &str = "decade";
/// catch-all for raw last.fm folksonomy tags that don't already match
/// a known `genre` taxon. the lastfm proposal path performs the
/// genre-promotion check before routing a tag here.
pub const KIND_LASTFM_TAG: &str = "lastfm_tag";

/// every slug seeded in `033_taxonomy_seed_kinds.sql` and
/// `040_taxon_kinds_artist_metadata_jobz_priority.sql`, in display order.
pub const SEEDED_KIND_SLUGS: &[&str] = &[
    KIND_GENRE,
    KIND_SUBGENRE,
    KIND_MOOD,
    KIND_INSTRUMENT,
    KIND_ERA,
    KIND_DECADE,
    KIND_KEY,
    KIND_LOCATION,
    KIND_COUNTRY,
    KIND_LABEL,
    KIND_THEME,
    KIND_STYLE,
    KIND_SPEED,
    KIND_RELEASE_DATE,
    KIND_LOUDNESS_DB,
    KIND_ENERGY,
    KIND_LASTFM_TAG,
];
