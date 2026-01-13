//! API handlers - normal Axum handlers with simple inventory registration

use crate::server::route_def::{Method, RouteInfo};
use crate::types::*;
use axum::{extract::Path, Json};

// =============================================================================
// Music - Playlist Handlers
// =============================================================================

pub async fn list_playlists(Json(params): Json<QueryParams>) -> Json<Vec<PlaylistQueryResult>> {
    let limit = params.limit.unwrap_or(10);
    let mut results = Vec::new();

    for i in 0..limit.min(3) {
        results.push(PlaylistQueryResult {
            playlist: Playlist {
                id: format!("playlist_{}", i),
                title: format!("Playlist {}", i),
                description: params.q.as_ref().map(|q| format!("Matching '{}'", q)),
            },
            song_count: 10 + i as i64,
        });
    }
    Json(results)
}

inventory::submit! {
    RouteInfo {
        name: "list_playlists",
        path: "/api/music/playlists/list",
        method: Method::POST,
        request_type: "QueryParams",
        response_type: "Vec<PlaylistQueryResult>",
    }
}

pub async fn get_playlist(Path(id): Path<String>) -> Json<Playlist> {
    Json(Playlist {
        id,
        title: "Test Playlist".to_string(),
        description: Some("A test playlist".to_string()),
    })
}

inventory::submit! {
    RouteInfo {
        name: "get_playlist",
        path: "/api/music/playlists/{id}",
        method: Method::GET,
        request_type: "String",
        response_type: "Playlist",
    }
}

pub async fn create_playlist(Json(playlist): Json<Playlist>) -> Json<Playlist> {
    Json(playlist)
}

inventory::submit! {
    RouteInfo {
        name: "create_playlist",
        path: "/api/music/playlists",
        method: Method::POST,
        request_type: "Playlist",
        response_type: "Playlist",
    }
}

// =============================================================================
// Music - Song Handlers
// =============================================================================

pub async fn list_songs(Json(params): Json<QueryParams>) -> Json<Vec<Song>> {
    let limit = params.limit.unwrap_or(10);
    let mut songs = Vec::new();

    for i in 0..limit.min(5) {
        songs.push(Song {
            id: format!("song_{}", i),
            title: format!("Song {}", i),
            artist_name: "Test Artist".to_string(),
        });
    }
    Json(songs)
}

inventory::submit! {
    RouteInfo {
        name: "list_songs",
        path: "/api/music/songs/list",
        method: Method::POST,
        request_type: "QueryParams",
        response_type: "Vec<Song>",
    }
}

pub async fn get_song(Path(id): Path<String>) -> Json<Song> {
    Json(Song {
        id,
        title: "Test Song".to_string(),
        artist_name: "Test Artist".to_string(),
    })
}

inventory::submit! {
    RouteInfo {
        name: "get_song",
        path: "/api/music/songs/{id}",
        method: Method::GET,
        request_type: "String",
        response_type: "Song",
    }
}

// =============================================================================
// Music - Album Handlers
// =============================================================================

pub async fn list_albums(Json(params): Json<QueryParams>) -> Json<Vec<Album>> {
    let limit = params.limit.unwrap_or(10);
    let mut albums = Vec::new();

    for i in 0..limit.min(4) {
        albums.push(Album {
            id: format!("album_{}", i),
            title: format!("Album {}", i),
            artist_name: "Test Artist".to_string(),
            year: Some(2024 - i as i32),
        });
    }
    Json(albums)
}

inventory::submit! {
    RouteInfo {
        name: "list_albums",
        path: "/api/music/albums/list",
        method: Method::POST,
        request_type: "QueryParams",
        response_type: "Vec<Album>",
    }
}

pub async fn get_album(Path(id): Path<String>) -> Json<Album> {
    Json(Album {
        id,
        title: "Test Album".to_string(),
        artist_name: "Test Artist".to_string(),
        year: Some(2024),
    })
}

inventory::submit! {
    RouteInfo {
        name: "get_album",
        path: "/api/music/albums/{id}",
        method: Method::GET,
        request_type: "String",
        response_type: "Album",
    }
}

// =============================================================================
// User Handlers
// =============================================================================

pub async fn create_user(Json(req): Json<CreateUserRequest>) -> Json<User> {
    Json(User {
        id: "1".to_string(),
        username: req.username,
        email: req.email,
        created_at: 1234567890,
    })
}

inventory::submit! {
    RouteInfo {
        name: "create_user",
        path: "/api/users",
        method: Method::POST,
        request_type: "CreateUserRequest",
        response_type: "User",
    }
}

pub async fn login(Json(req): Json<LoginRequest>) -> Json<LoginResponse> {
    Json(LoginResponse {
        user: User {
            id: "1".to_string(),
            username: req.username,
            email: None,
            created_at: 1234567890,
        },
        api_key: "test-api-key".to_string(),
    })
}

inventory::submit! {
    RouteInfo {
        name: "login",
        path: "/api/users/login",
        method: Method::POST,
        request_type: "LoginRequest",
        response_type: "LoginResponse",
    }
}

// Minimal test handler with no Path extraction
pub async fn get_user_test() -> &'static str {
    println!("MINIMAL TEST HANDLER CALLED!");
    "test response"
}

pub async fn get_user(Path(id): Path<String>) -> Json<User> {
    println!("get_user handler called with id: {}", id);
    Json(User {
        id,
        username: "test_user".to_string(),
        email: Some("test@example.com".to_string()),
        created_at: 1234567890,
    })
}

inventory::submit! {
    RouteInfo {
        name: "get_user",
        path: "/api/users/{id}",
        method: Method::GET,
        request_type: "String",
        response_type: "User",
    }
}
