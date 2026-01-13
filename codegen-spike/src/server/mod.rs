//! Server module - Axum server setup

pub mod handlers;
pub mod route_def;
pub mod routes;

use axum::{
    routing::{get, post},
    Router,
};

/// Build the Axum router from route registry
/// Automatically wires up all routes defined in routes::define_routes()
pub fn build_router() -> Router {
    let mut router = Router::new();

    for route in routes::define_routes() {
        // Match handler based on route name
        let handler = match route.name {
            // Music - Playlists
            "listPlaylists" => post(handlers::list_playlists),
            "getPlaylist" => get(handlers::get_playlist),
            "createPlaylist" => post(handlers::create_playlist),

            // Music - Songs
            "listSongs" => post(handlers::list_songs),
            "getSong" => get(handlers::get_song),

            // Music - Albums
            "listAlbums" => post(handlers::list_albums),
            "getAlbum" => get(handlers::get_album),

            // Users
            "createUser" => post(handlers::create_user),
            "login" => post(handlers::login),
            "getUser" => get(handlers::get_user),

            _ => panic!("Unknown route handler: {}", route.name),
        };

        router = router.route(route.path, handler);
    }

    router
}
