//! Server module - Axum server setup

pub mod handlers;
pub mod route_def;
pub mod routes;

use axum::{
    routing::{get, post},
    Router,
};
use routes::{albums, playlists, songs, users};

/// Build the Axum router from route registry
pub fn build_router() -> Router {
    // Get route definitions from each module
    let playlist_routes = playlists::routes();
    let song_routes = songs::routes();
    let album_routes = albums::routes();
    let user_routes = users::routes();

    Router::new()
        // Music playlist routes
        .route(
            &playlist_routes["list"].path,
            post(handlers::list_playlists),
        )
        .route(&playlist_routes["get"].path, get(handlers::get_playlist))
        .route(
            &playlist_routes["create"].path,
            post(handlers::create_playlist),
        )
        // Music song routes
        .route(&song_routes["list"].path, post(handlers::list_songs))
        .route(&song_routes["get"].path, get(handlers::get_song))
        // Music album routes
        .route(&album_routes["list"].path, post(handlers::list_albums))
        .route(&album_routes["get"].path, get(handlers::get_album))
        // User routes
        .route(&user_routes["create"].path, post(handlers::create_user))
        .route(&user_routes["login"].path, post(handlers::login))
        .route(&user_routes["get"].path, get(handlers::get_user))
}
