//! Route Registry - Single source of truth for all API routes
//!
//! Define all routes here in one place. Used by:
//! 1. Server to build Axum router
//! 2. Codegen to generate TypeScript client

use crate::route;
use crate::server::route_def::*;
use crate::types::*;

/// Define all API routes in one place
/// No modules needed - just a flat list with organization by comments
pub fn define_routes() -> Vec<RouteDefinition> {
    vec![
        // =================================================================
        // Music - Playlists
        // =================================================================
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
        // =================================================================
        // Music - Songs
        // =================================================================
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
        // =================================================================
        // Music - Albums
        // =================================================================
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
        // =================================================================
        // Users
        // =================================================================
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
