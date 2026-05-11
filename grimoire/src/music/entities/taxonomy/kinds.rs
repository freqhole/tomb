//! seeded `taxon_kindz` slug constants.
//!
//! every code path that needs a known kind looks it up by slug \u2014 ids
//! are auto-generated and never referenced from rust.

pub const KIND_GENRE: &str = "genre";
pub const KIND_MOOD: &str = "mood";
pub const KIND_INSTRUMENT: &str = "instrument";
pub const KIND_ERA: &str = "era";
pub const KIND_KEY: &str = "key";
pub const KIND_LOCATION: &str = "location";
pub const KIND_LABEL: &str = "label";
pub const KIND_BPM: &str = "bpm";
pub const KIND_LOUDNESS_DB: &str = "loudness_db";
pub const KIND_ENERGY: &str = "energy";

/// every slug seeded in `033_taxonomy_seed_kinds.sql`, in display order.
pub const SEEDED_KIND_SLUGS: &[&str] = &[
    KIND_GENRE,
    KIND_MOOD,
    KIND_INSTRUMENT,
    KIND_ERA,
    KIND_KEY,
    KIND_LOCATION,
    KIND_LABEL,
    KIND_BPM,
    KIND_LOUDNESS_DB,
    KIND_ENERGY,
];
