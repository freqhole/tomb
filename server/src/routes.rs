//! route composition

use axum::{middleware as axum_middleware, routing::get, routing::post, Router};
use grimoire::api_registry;

use crate::{auth, music, state::AppState, static_files};

/// build the application router
///
/// composes all route modules into a single router
pub fn build_router() -> Router<AppState> {
    let routes = api_registry::all_routes_map();

    // protected routes (require authentication)
    let protected_routes = Router::new()
        .route(routes["auth"]["whoami"].path, get(auth::handlers::whoami))
        .route(routes["auth"]["logout"].path, post(auth::handlers::logout))
        .route(
            routes["auth"]["api_key_status"].path,
            get(auth::handlers::api_key_status),
        )
        .route(
            routes["auth"]["regenerate_api_key"].path,
            post(auth::handlers::regenerate_api_key),
        )
        // music routes
        .route(
            routes["music"]["list_playlists"].path,
            post(music::playlists::list_playlists),
        )
        .route(
            routes["music"]["create_playlist"].path,
            post(music::playlists::create_playlist_handler),
        )
        .route(
            routes["music"]["get_playlist_by_id"].path,
            get(music::playlists::get_playlist_by_id),
        )
        .route(
            routes["music"]["create_artist"].path,
            post(music::artists::create_artist_handler),
        )
        // fetch routes
        .route(
            routes["music"]["create_fetch_job"].path,
            post(music::fetch::create_fetch_job),
        )
        .route(
            routes["music"]["get_fetch_job"].path,
            get(music::fetch::get_fetch_job),
        )
        .layer(axum_middleware::from_fn(auth::middleware::require_auth));

    // webauthn routes (feature-gated, require origin validation)
    #[cfg(feature = "webauthn")]
    let webauthn_routes = Router::new()
        .route(
            routes["auth"]["register_start"].path,
            post(auth::handlers::register_start),
        )
        .route(
            routes["auth"]["register_finish"].path,
            post(auth::handlers::register_finish),
        )
        .route(
            routes["auth"]["login_start"].path,
            post(auth::handlers::login_start),
        )
        .route(
            routes["auth"]["login_finish"].path,
            post(auth::handlers::login_finish),
        )
        .layer(axum_middleware::from_fn(auth::middleware::validate_origin));

    #[cfg(feature = "webauthn")]
    let router = Router::new()
        // public routes (no auth required)
        .route(
            routes["auth"]["redeem_invite"].path,
            post(auth::handlers::redeem_invite),
        )
        // webauthn routes (require origin validation)
        .merge(webauthn_routes)
        // protected routes
        .merge(protected_routes);

    #[cfg(not(feature = "webauthn"))]
    let router = Router::new()
        // public routes (no auth required)
        .route(
            routes["auth"]["redeem_invite"].path,
            post(auth::handlers::redeem_invite),
        )
        // protected routes
        .merge(protected_routes);

    router
        // TODO: add music routes
        // TODO: add blob routes
        // TODO: add health routes
        // static files (fallback - serves anything not matched above)
        .fallback(static_files::serve_static)
}
