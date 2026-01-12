//! MusicBrainz API routes
//!
//! This module defines the HTTP routes for MusicBrainz integration endpoints.
//! Routes follow RESTful patterns and integrate with existing authentication middleware.

use axum::routing::{get, post};
use axum::{middleware as axum_middleware, Router};

use crate::auth::middleware::require_admin;
use crate::musicbrainz::handlers::{
    apply_musicbrainz_metadata, get_musicbrainz_config, get_song_matches, scan_songs_for_matches,
    search_albums, search_musicbrainz,
};

/// Create MusicBrainz API routes
pub fn create_musicbrainz_routes() -> Router {
    // All MusicBrainz routes are admin-only
    Router::new()
        .route("/admin/musicbrainz/config", get(get_musicbrainz_config))
        .route("/musicbrainz/search", post(search_musicbrainz))
        .route("/musicbrainz/search/albums", post(search_albums))
        .route("/musicbrainz/matches", post(get_song_matches))
        .route("/musicbrainz/apply", post(apply_musicbrainz_metadata))
        .route("/musicbrainz/scan", post(scan_songs_for_matches))
        .layer(axum_middleware::from_fn(require_admin))
}
