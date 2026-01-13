//! Route Registry - Single source of truth for all API routes
//!
//! Define all routes here. Used by:
//! 1. Server to build Axum router
//! 2. Codegen to generate TypeScript client

use crate::route;
use crate::routes;
use crate::server::route_def::*;
use crate::types::*;
use std::collections::HashMap;

// =============================================================================
// Music Playlist Routes
// =============================================================================

pub mod playlists {
    use super::*;

    pub fn routes() -> HashMap<&'static str, RouteDefinition> {
        routes![
            route!(
                "list",
                "listPlaylists",
                "/api/music/playlists/list",
                Method::POST,
                "music/playlists",
                QueryParams,
                Vec<PlaylistQueryResult>
            ),
            route!(
                "get",
                "getPlaylist",
                "/api/music/playlists/{id}",
                Method::GET,
                "music/playlists",
                String,
                Playlist
            ),
            route!(
                "create",
                "createPlaylist",
                "/api/music/playlists",
                Method::POST,
                "music/playlists",
                Playlist,
                Playlist
            ),
        ]
    }
}

// =============================================================================
// Music Song Routes
// =============================================================================

pub mod songs {
    use super::*;

    pub fn routes() -> HashMap<&'static str, RouteDefinition> {
        routes![
            route!(
                "list",
                "listSongs",
                "/api/music/songs/list",
                Method::POST,
                "music/songs",
                QueryParams,
                Vec<Song>
            ),
            route!(
                "get",
                "getSong",
                "/api/music/songs/{id}",
                Method::GET,
                "music/songs",
                String,
                Song
            ),
        ]
    }
}

// =============================================================================
// Music Album Routes
// =============================================================================

pub mod albums {
    use super::*;

    pub fn routes() -> HashMap<&'static str, RouteDefinition> {
        routes![
            route!(
                "list",
                "listAlbums",
                "/api/music/albums/list",
                Method::POST,
                "music/albums",
                QueryParams,
                Vec<Album>
            ),
            route!(
                "get",
                "getAlbum",
                "/api/music/albums/{id}",
                Method::GET,
                "music/albums",
                String,
                Album
            ),
        ]
    }
}

// =============================================================================
// User Routes
// =============================================================================

pub mod users {
    use super::*;

    pub fn routes() -> HashMap<&'static str, RouteDefinition> {
        routes![
            route!(
                "create",
                "createUser",
                "/api/users",
                Method::POST,
                "users",
                CreateUserRequest,
                User
            ),
            route!(
                "login",
                "login",
                "/api/users/login",
                Method::POST,
                "users",
                LoginRequest,
                LoginResponse
            ),
            route!(
                "get",
                "getUser",
                "/api/users/{id}",
                Method::GET,
                "users",
                String,
                User
            ),
        ]
    }
}

// =============================================================================
// Collect All Routes
// =============================================================================

pub fn all_routes() -> Vec<RouteDefinition> {
    let mut routes = Vec::new();
    routes.extend(playlists::routes().into_values());
    routes.extend(songs::routes().into_values());
    routes.extend(albums::routes().into_values());
    routes.extend(users::routes().into_values());
    routes
}
