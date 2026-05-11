//! last.fm integration module (scaffold)
//!
//! provides a thin http client + typed models for the last.fm 2.0 web api.
//! covers the bits we actually want for album/artist enrichment:
//!
//! - `album.getInfo`        — wiki summary, top tags (folksonomy), play/listener counts
//! - `artist.getInfo`       — bio, similar artists, top tags
//! - `artist.getTopTags`    — folksonomy with vote counts
//! - `track.getInfo`        — per-track tags + wiki (future)
//!
//! last.fm has no dedicated "mood" field — same story as musicbrainz: moods
//! live in the freeform `toptags` list. but the bio text is unique to
//! last.fm and worth capturing on its own.
//!
//! rate limits: docs say "no more than 5 requests per originating IP per
//! second averaged over a 5 minute period". we use the same 1 req/sec
//! limiter as musicbrainz to stay well within bounds.
//!
//! transport pattern matches `crate::music::musicbrainz`.

pub mod client;
pub mod models;

pub use client::LastFmClient;
pub use models::{LastFmAlbumInfo, LastFmArtistInfo, LastFmTag, LastFmWiki};
