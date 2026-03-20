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

use crate::api_registry::RouteInfo;
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
) -> Option<GrimoireResponse<JsonValue>> {
    // first check exact path matches
    match path {
        // playlists
        "/api/music/playlists/list" => Some(playlists::list(caller, body.clone()).await),
        "/api/music/playlists" => Some(playlists::create(caller, body.clone()).await),
        "/api/playlists/update" => Some(playlists::update(caller, body.clone()).await),
        "/api/playlists/delete" => Some(playlists::delete(caller, body.clone()).await),
        "/api/playlists/add-songs" => Some(playlists::add_songs(caller, body.clone()).await),
        "/api/playlists/remove-songs" => Some(playlists::remove_songs(caller, body.clone()).await),
        "/api/playlists/reorder" => Some(playlists::reorder(caller, body.clone()).await),
        "/api/playlists/songs" => Some(playlists::query_songs(caller, body.clone()).await),

        // songs
        "/api/songs/query" => Some(songs::query(caller, body.clone()).await),
        "/api/songs/recent" => Some(songs::recent(caller, body.clone()).await),
        "/api/songs/update" => Some(songs::update(caller, body.clone()).await),
        "/api/songs/bulk-delete" => Some(songs::bulk_delete(caller, body.clone()).await),
        "/api/songs/bulk-clear-artwork" => {
            Some(songs::bulk_clear_artwork(caller, body.clone()).await)
        }

        // albums
        "/api/albums/query" => Some(albums::query(caller, body.clone()).await),
        "/api/albums/update" => Some(albums::update(caller, body.clone()).await),

        // artists
        "/api/artists/query" => Some(artists::query(caller, body.clone()).await),
        "/api/artists/update" => Some(artists::update(caller, body.clone()).await),
        "/api/music/artists" => Some(artists::create(caller, body.clone()).await),

        // genres
        "/api/genres/query" => Some(genres::query(caller, body.clone()).await),

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

        // listen sessions
        "/api/analytics/sessions" => Some(sessions::create(caller, body.clone()).await),
        "/api/analytics/sessions/list" => Some(sessions::list(caller, body.clone()).await),
        "/api/analytics/sessions/delete" => Some(sessions::delete(caller, body.clone()).await),

        // musicbrainz
        "/api/musicbrainz/search/releases" => {
            Some(search::musicbrainz_search_releases(caller, body.clone()).await)
        }
        "/api/musicbrainz/release" => {
            Some(search::musicbrainz_get_release(caller, body.clone()).await)
        }

        // fetch jobs
        "/api/music/fetch" => Some(jobs::create_fetch(caller, body.clone()).await),

        _ => dispatch_path_params(path, caller, body).await,
    }
}

/// dispatch routes with path parameters (e.g., /api/albums/{id})
async fn dispatch_path_params(
    path: &str,
    caller: &Caller,
    body: &JsonValue,
) -> Option<GrimoireResponse<JsonValue>> {
    // playlists: /api/music/playlists/{id}, /api/playlists/{id}/images
    if let Some(id) = path.strip_prefix("/api/music/playlists/") {
        if id.ends_with("/etag") {
            let id = id.strip_suffix("/etag").unwrap();
            return Some(playlists::get_etag(caller, id, body.clone()).await);
        }
        return Some(playlists::get(caller, id, body.clone()).await);
    }
    if let Some(rest) = path.strip_prefix("/api/playlists/") {
        if let Some(id) = rest.strip_suffix("/images") {
            return Some(playlists::get_images(caller, id, body.clone()).await);
        }
    }

    // albums: /api/albums/{id}, /api/albums/{id}/images
    if let Some(rest) = path.strip_prefix("/api/albums/") {
        if rest == "query" || rest == "update" {
            return None; // handled above
        }
        if let Some(id) = rest.strip_suffix("/images") {
            return Some(albums::get_images(caller, id, body.clone()).await);
        }
        return Some(albums::get(caller, rest, body.clone()).await);
    }

    // artists: /api/artists/{id}, /api/artists/{id}/images
    if let Some(rest) = path.strip_prefix("/api/artists/") {
        if rest == "query" || rest == "update" {
            return None; // handled above
        }
        if let Some(id) = rest.strip_suffix("/images") {
            return Some(artists::get_images(caller, id, body.clone()).await);
        }
        return Some(artists::get(caller, rest, body.clone()).await);
    }

    // genres: /api/genres/{id}
    if let Some(rest) = path.strip_prefix("/api/genres/") {
        if rest == "query" {
            return None; // handled above
        }
        return Some(genres::get(caller, rest, body.clone()).await);
    }

    // songs: /api/songs/{id}
    if let Some(rest) = path.strip_prefix("/api/songs/") {
        if rest == "query"
            || rest == "recent"
            || rest == "update"
            || rest == "bulk-delete"
            || rest == "bulk-clear-artwork"
        {
            return None; // handled above
        }
        return Some(songs::delete(caller, rest, body.clone()).await);
    }

    // listen sessions: /api/analytics/sessions/{id}/*
    if let Some(rest) = path.strip_prefix("/api/analytics/sessions/") {
        if rest == "list" {
            return None; // handled above
        }
        // /api/analytics/sessions/{id}/progress
        if rest.ends_with("/progress") {
            let id = rest.strip_suffix("/progress").unwrap();
            return Some(sessions::update_progress(caller, id, body.clone()).await);
        }
        // /api/analytics/sessions/{id}/songs
        if rest.ends_with("/songs") {
            let id = rest.strip_suffix("/songs").unwrap();
            return Some(sessions::update_songs(caller, id, body.clone()).await);
        }
        // /api/analytics/sessions/{id}/status/{status}
        if rest.contains("/status/") {
            let parts: Vec<&str> = rest.split("/status/").collect();
            if parts.len() == 2 {
                let id = parts[0];
                let status = parts[1];
                return Some(sessions::update_status(caller, id, status, body.clone()).await);
            }
        }
        // /api/analytics/sessions/{id} - could be GET or DELETE
        return Some(sessions::get_or_delete(caller, rest, body.clone()).await);
    }

    // blobs: delegated to media_blobz module
    if path.starts_with("/api/blobs/") {
        return super::media_blobz::dispatch(path, caller, body).await;
    }

    // fetch jobs: /api/music/fetch/{id}
    if let Some(id) = path.strip_prefix("/api/music/fetch/") {
        return Some(jobs::get_fetch(caller, id, body.clone()).await);
    }

    None
}
