pub mod handlers;
pub mod route_def;

use axum::{
    routing::{delete, get, post},
    Router,
};

pub fn build_router() -> Router {
    let r = route_def::all_routes_map();
    println!("Building router with {} routes", r.len());
    for (name, route) in &r {
        println!("  {} -> {} {}", name, route.method.as_str(), route.path);
    }

    Router::new()
        .route(r["list_playlists"].path, post(handlers::list_playlists))
        .route(r["get_playlist"].path, get(handlers::get_playlist))
        .route(r["create_playlist"].path, post(handlers::create_playlist))
        .route(r["delete_playlist"].path, delete(handlers::delete_playlist))
        .route(r["list_songs"].path, post(handlers::list_songs))
        .route(r["get_song"].path, get(handlers::get_song))
        .route(r["list_albums"].path, post(handlers::list_albums))
        .route(r["get_album"].path, get(handlers::get_album))
        .route(r["create_user"].path, post(handlers::create_user))
        .route(r["login"].path, post(handlers::login))
        .route(r["get_user"].path, get(handlers::get_user))
}
