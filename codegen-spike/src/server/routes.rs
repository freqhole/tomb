//! Route Registry - Single source of truth for all API routes
//!
//! This file defines all routes once, which are used by:
//! 1. Server to build Axum router
//! 2. Codegen to generate TypeScript client

use crate::types::*;
use std::collections::HashMap;

/// HTTP method
#[derive(Debug, Clone, Copy)]
pub enum Method {
    GET,
    POST,
    PUT,
    DELETE,
    PATCH,
}

impl Method {
    pub fn as_str(&self) -> &'static str {
        match self {
            Method::GET => "GET",
            Method::POST => "POST",
            Method::PUT => "PUT",
            Method::DELETE => "DELETE",
            Method::PATCH => "PATCH",
        }
    }
}

/// Route definition
#[derive(Debug, Clone)]
pub struct RouteDefinition {
    pub name: &'static str,
    pub path: &'static str,
    pub method: Method,
    pub request_type: &'static str,
    pub response_type: &'static str,
    pub module_path: &'static str,
}

/// Helper macro to create type-safe routes
macro_rules! route {
    ($name:expr, $path:expr, $method:expr, $module:expr, $req:ty, $resp:ty) => {
        RouteDefinition {
            name: $name,
            path: $path,
            method: $method,
            request_type: std::any::type_name::<$req>(),
            response_type: std::any::type_name::<$resp>(),
            module_path: $module,
        }
    };
}

// =============================================================================
// Route Modules
// =============================================================================

/// Music playlist routes
pub mod playlists {
    use super::*;

    pub fn routes() -> HashMap<&'static str, RouteDefinition> {
        let mut map = HashMap::new();

        map.insert(
            "list",
            route!(
                "listPlaylists",
                "/api/music/playlists/list",
                Method::POST,
                "music/playlists",
                QueryParams,
                Vec<PlaylistQueryResult>
            ),
        );

        map.insert(
            "get",
            route!(
                "getPlaylist",
                "/api/music/playlists/:id",
                Method::GET,
                "music/playlists",
                String,
                Playlist
            ),
        );

        map.insert(
            "create",
            route!(
                "createPlaylist",
                "/api/music/playlists",
                Method::POST,
                "music/playlists",
                Playlist,
                Playlist
            ),
        );

        map
    }
}

/// Music song routes
pub mod songs {
    use super::*;

    pub fn routes() -> HashMap<&'static str, RouteDefinition> {
        let mut map = HashMap::new();

        map.insert(
            "list",
            route!(
                "listSongs",
                "/api/music/songs/list",
                Method::POST,
                "music/songs",
                QueryParams,
                Vec<Song>
            ),
        );

        map.insert(
            "get",
            route!(
                "getSong",
                "/api/music/songs/:id",
                Method::GET,
                "music/songs",
                String,
                Song
            ),
        );

        map
    }
}

/// Music album routes
pub mod albums {
    use super::*;

    pub fn routes() -> HashMap<&'static str, RouteDefinition> {
        let mut map = HashMap::new();

        map.insert(
            "list",
            route!(
                "listAlbums",
                "/api/music/albums/list",
                Method::POST,
                "music/albums",
                QueryParams,
                Vec<Album>
            ),
        );

        map.insert(
            "get",
            route!(
                "getAlbum",
                "/api/music/albums/:id",
                Method::GET,
                "music/albums",
                String,
                Album
            ),
        );

        map
    }
}

/// User routes
pub mod users {
    use super::*;

    pub fn routes() -> HashMap<&'static str, RouteDefinition> {
        let mut map = HashMap::new();

        map.insert(
            "create",
            route!(
                "createUser",
                "/api/users",
                Method::POST,
                "users",
                CreateUserRequest,
                User
            ),
        );

        map.insert(
            "login",
            route!(
                "login",
                "/api/users/login",
                Method::POST,
                "users",
                LoginRequest,
                LoginResponse
            ),
        );

        map.insert(
            "get",
            route!(
                "getUser",
                "/api/users/:id",
                Method::GET,
                "users",
                String,
                User
            ),
        );

        map
    }
}

/// Collect all routes from all modules
pub fn all_routes() -> Vec<RouteDefinition> {
    let mut routes = Vec::new();
    routes.extend(playlists::routes().into_values());
    routes.extend(songs::routes().into_values());
    routes.extend(albums::routes().into_values());
    routes.extend(users::routes().into_values());
    routes
}
