//! music domain handlers
//!
//! covers: songs, albums, artists, playlists, genres, favorites, ratings,
//! tags, blobs, uploads, jobs, analytics, sessions, search

pub mod albums;
pub mod analytics;
pub mod artists;
pub mod favorites;
pub mod genres;
pub mod jobs;
pub mod playlists;
pub mod ratings;
pub mod search;
pub mod sessions;
pub mod songs;
pub mod tags;

use crate::api_registry::{Method, RouteInfo};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

/// collect all route metadata from music domain
pub fn routes() -> Vec<RouteInfo> {
    let mut all = Vec::new();
    all.extend_from_slice(albums::ROUTES);
    all.extend_from_slice(analytics::ROUTES);
    all.extend_from_slice(artists::ROUTES);
    all.extend_from_slice(favorites::ROUTES);
    all.extend_from_slice(genres::ROUTES);
    all.extend_from_slice(jobs::ROUTES);
    all.extend_from_slice(playlists::ROUTES);
    all.extend_from_slice(ratings::ROUTES);
    all.extend_from_slice(search::ROUTES);
    all.extend_from_slice(sessions::ROUTES);
    all.extend_from_slice(songs::ROUTES);
    all.extend_from_slice(tags::ROUTES);
    all
}

/// dispatch music domain routes
///
/// returns Some(response) if path matches this domain, None otherwise
pub async fn dispatch(
    path: &str,
    caller: &Caller,
    body: &JsonValue,
    _method: Option<Method>,
) -> Option<GrimoireResponse<JsonValue>> {
    match path {
        // playlists
        "/api/music/playlists/list" => Some(playlists::list(caller, body.clone()).await),
        "/api/music/playlists" => Some(playlists::create(caller, body.clone()).await),
        "/api/music/playlists/get" => Some(playlists::get(caller, body.clone()).await),
        "/api/music/playlists/etag" => Some(playlists::get_etag(caller, body.clone()).await),
        "/api/playlists/images" => Some(playlists::get_images(caller, body.clone()).await),
        "/api/playlists/update" => Some(playlists::update(caller, body.clone()).await),
        "/api/playlists/delete" => Some(playlists::delete(caller, body.clone()).await),
        "/api/playlists/add-songs" => Some(playlists::add_songs(caller, body.clone()).await),
        "/api/playlists/remove-songs" => Some(playlists::remove_songs(caller, body.clone()).await),
        "/api/playlists/reorder" => Some(playlists::reorder(caller, body.clone()).await),
        "/api/playlists/songs" => Some(playlists::query_songs(caller, body.clone()).await),
        "/api/playlists/record-play" => Some(playlists::record_play(caller, body.clone()).await),

        // songs
        "/api/songs/query" => Some(songs::query(caller, body.clone()).await),
        "/api/songs/recent" => Some(songs::recent(caller, body.clone()).await),
        "/api/songs/update" => Some(songs::update(caller, body.clone()).await),
        "/api/songs/delete" => Some(songs::delete(caller, body.clone()).await),
        "/api/songs/bulk-delete" => Some(songs::bulk_delete(caller, body.clone()).await),
        "/api/songs/bulk-clear-artwork" => {
            Some(songs::bulk_clear_artwork(caller, body.clone()).await)
        }

        // albums
        "/api/albums/query" => Some(albums::query(caller, body.clone()).await),
        "/api/albums/get" => Some(albums::get(caller, body.clone()).await),
        "/api/albums/delete" => Some(albums::delete(caller, body.clone()).await),
        "/api/albums/images" => Some(albums::get_images(caller, body.clone()).await),
        "/api/albums/update" => Some(albums::update(caller, body.clone()).await),

        // artists
        "/api/artists/query" => Some(artists::query(caller, body.clone()).await),
        "/api/artists/get" => Some(artists::get(caller, body.clone()).await),
        "/api/artists/delete" => Some(artists::delete(caller, body.clone()).await),
        "/api/artists/images" => Some(artists::get_images(caller, body.clone()).await),
        "/api/artists/update" => Some(artists::update(caller, body.clone()).await),
        "/api/music/artists" => Some(artists::create(caller, body.clone()).await),

        // genres
        "/api/genres/query" => Some(genres::query(caller, body.clone()).await),
        "/api/genres/get" => Some(genres::get(caller, body.clone()).await),

        // favorites
        "/api/favorites/set" => Some(favorites::set(caller, body.clone()).await),
        "/api/favorites/list" => Some(favorites::list(caller, body.clone()).await),

        // ratings
        "/api/ratings/set" => Some(ratings::set(caller, body.clone()).await),
        "/api/ratings/remove" => Some(ratings::remove(caller, body.clone()).await),
        "/api/ratings/stats" => Some(ratings::stats(caller, body.clone()).await),

        // tags
        "/api/tags/list" => Some(tags::list(caller, body.clone()).await),
        "/api/tags/query" => Some(tags::query(caller, body.clone()).await),
        "/api/tags/get" => Some(tags::get(caller, body.clone()).await),
        "/api/tags/delete" => Some(tags::delete(caller, body.clone()).await),
        "/api/tags/albums/add" => Some(tags::add_to_albums(caller, body.clone()).await),
        "/api/tags/albums/remove" => Some(tags::remove_from_albums(caller, body.clone()).await),
        "/api/tags/albums/replace" => Some(tags::replace_on_albums(caller, body.clone()).await),
        "/api/tags/albums/get" => Some(tags::get_for_albums(caller, body.clone()).await),

        // jobs
        "/api/jobs/status" => Some(jobs::status(caller, body.clone()).await),
        "/api/jobs/list" => Some(jobs::list(caller, body.clone()).await),
        "/api/music/fetch" => Some(jobs::create_fetch(caller, body.clone()).await),
        "/api/music/fetch/status" => Some(jobs::get_fetch(caller, body.clone()).await),

        // search
        "/api/music/search" => Some(search::search_handler(caller, body.clone()).await),
        "/api/music/suggestions" => Some(search::suggestions(caller, body.clone()).await),

        // images
        "/api/music/images/delete" => Some(albums::delete_image(caller, body.clone()).await),
        "/api/music/images/set-primary" => {
            Some(albums::set_primary_image(caller, body.clone()).await)
        }

        // analytics
        "/api/analytics/play" => Some(analytics::record_play(caller, body.clone()).await),
        "/api/analytics/listening-history" => Some(analytics::history(caller, body.clone()).await),
        "/api/analytics/song-stats" => Some(analytics::song_analytics(caller, body.clone()).await),
        "/api/analytics/top-songs" => Some(analytics::top_songs(caller, body.clone()).await),
        "/api/analytics/top-albums" => Some(analytics::top_albums(caller, body.clone()).await),
        "/api/analytics/top-artists" => Some(analytics::top_artists(caller, body.clone()).await),
        "/api/analytics/feed" => Some(analytics::feed(caller, body.clone()).await),
        "/api/analytics/feed/delete" => {
            Some(analytics::delete_feed_event(caller, body.clone()).await)
        }

        // listen sessions
        "/api/analytics/sessions" => Some(sessions::create(caller, body.clone()).await),
        "/api/analytics/sessions/list" => Some(sessions::list(caller, body.clone()).await),
        "/api/analytics/sessions/get" => Some(sessions::get(caller, body.clone()).await),
        "/api/analytics/sessions/delete" => Some(sessions::delete(caller, body.clone()).await),
        "/api/analytics/sessions/progress" => {
            Some(sessions::update_progress(caller, body.clone()).await)
        }
        "/api/analytics/sessions/songs" => Some(sessions::update_songs(caller, body.clone()).await),
        "/api/analytics/sessions/status" => {
            Some(sessions::update_status(caller, body.clone()).await)
        }

        // musicbrainz
        "/api/musicbrainz/search/releases" => {
            Some(search::musicbrainz_search_releases(caller, body.clone()).await)
        }
        "/api/musicbrainz/release" => {
            Some(search::musicbrainz_get_release(caller, body.clone()).await)
        }

        // blob metadata
        "/api/blob_metadata" => super::media_blobz::dispatch(path, caller, body).await,
        "/api/blob_metadata_by_blake3" => super::media_blobz::dispatch(path, caller, body).await,
        "/api/blobz/has" => super::media_blobz::dispatch(path, caller, body).await,

        // blobs: streaming routes still use path params
        _ if path.starts_with("/api/blobs/") => {
            super::media_blobz::dispatch(path, caller, body).await
        }

        _ => None,
    }
}
