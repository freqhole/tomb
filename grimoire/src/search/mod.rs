//! search module for full-text search and autocomplete
//!
//! provides FTS5-based search functionality across songs, artists, albums, genres, and playlists
//! with user preference integration, confidence scoring, and flexible filtering

pub mod helpers;
pub mod models;
pub mod queries;
pub mod service;
pub mod suggestions;

// re-export public types
pub use models::*;
pub use service::{get_suggestions, search};
