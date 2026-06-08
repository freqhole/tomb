//! route composition
//!
//! builds routes from grimoire::offal metadata, routing through adapter.
//! custom handlers for streaming, uploads, and webauthn stay separate.

use axum::{
    extract::DefaultBodyLimit,
    middleware as axum_middleware,
    routing::{get, head, patch, post},
    Router,
};
use grimoire::api_registry::{Method, RouteAuth, RouteInfo};
use std::collections::HashMap;

use crate::{adapter, auth, blobs, state::AppState, static_files, upload};

/// routes that need custom handlers (not offal dispatch)
/// these can't be JSON-dispatched: streaming, uploads, origin-validated
const CUSTOM_ROUTES: &[&str] = &[
    // streaming routes - binary data, range requests
    "stream_blob",
    "get_blob_thumbnail",
    "build_atlas",
    // upload routes - multipart, body size limits
    "upload_image",
    "upload_music",
    // webauthn routes - need origin validation middleware
    "register_start",
    "register_finish",
    "login_start",
    "login_finish",
    // redeem invite - needs origin validation
    "redeem_invite",
];

/// build a map for looking up routes by domain and name
fn build_routes_map(routes: &[RouteInfo]) -> HashMap<&str, HashMap<&str, &RouteInfo>> {
    let mut map: HashMap<&str, HashMap<&str, &RouteInfo>> = HashMap::new();
    for route in routes {
        let domain_key = route.domain.as_str();
        map.entry(domain_key).or_default().insert(route.name, route);
    }
    map
}

/// build the application router
///
/// generates routes from offal metadata, with custom handlers for special cases
pub fn build_router(max_upload_bytes: u64) -> Router<AppState> {
    let all_routes = grimoire::offal::all_routes();
    let routes_map = build_routes_map(&all_routes);

    // two routers: protected (with auth) and public (no auth)
    let mut protected = Router::new();
    let mut public = Router::new();

    for route in &all_routes {
        if CUSTOM_ROUTES.contains(&route.name) {
            continue;
        }

        if matches!(route.auth, RouteAuth::Public) {
            public = match route.method {
                Method::GET => public.route(route.path, get(adapter::offal_public_handler)),
                Method::POST => public.route(route.path, post(adapter::offal_public_handler)),
                Method::PATCH => public.route(route.path, patch(adapter::offal_public_handler)),
                Method::HEAD => public.route(route.path, head(adapter::offal_public_handler)),
            };
        } else {
            protected = match route.method {
                Method::GET => protected.route(route.path, get(adapter::offal_handler)),
                Method::POST => protected.route(route.path, post(adapter::offal_handler)),
                Method::PATCH => protected.route(route.path, patch(adapter::offal_handler)),
                Method::HEAD => protected.route(route.path, head(adapter::offal_handler)),
            };
        }
    }

    // add auth middleware to protected routes
    let protected_routes =
        protected.layer(axum_middleware::from_fn(auth::middleware::require_auth));

    // upload routes - custom handlers with body limit
    let upload_routes = Router::new()
        .route(
            routes_map["music"]["upload_image"].path,
            post(upload::upload_image_handler),
        )
        .route(
            routes_map["music"]["upload_music"].path,
            post(upload::upload_music_handler),
        )
        .layer(DefaultBodyLimit::max(max_upload_bytes as usize))
        .layer(axum_middleware::from_fn(auth::middleware::require_auth));

    // blob streaming routes - custom handlers, auth only
    // both GET and HEAD: webkit issues HEAD first to probe Content-Length +
    // Accept-Ranges before issuing the Range GET. without explicit HEAD
    // routing axum returns 405 and webkit falls back to non-range full GETs.
    let blob_routes = Router::new()
        .route(
            routes_map["music"]["stream_blob"].path,
            get(blobs::stream_blob_handler).head(blobs::stream_blob_handler),
        )
        .route(
            routes_map["music"]["get_blob_thumbnail"].path,
            get(blobs::blob_thumbnail_handler).head(blobs::blob_thumbnail_handler),
        )
        .route(
            routes_map["music"]["build_atlas"].path,
            post(blobs::build_atlas_handler),
        )
        .layer(axum_middleware::from_fn(auth::middleware::require_auth));

    // webauthn routes - need origin validation
    #[cfg(feature = "webauthn")]
    let webauthn_routes = Router::new()
        .route(
            routes_map["auth"]["register_start"].path,
            post(auth::handlers::register_start),
        )
        .route(
            routes_map["auth"]["register_finish"].path,
            post(auth::handlers::register_finish),
        )
        .route(
            routes_map["auth"]["login_start"].path,
            post(auth::handlers::login_start),
        )
        .route(
            routes_map["auth"]["login_finish"].path,
            post(auth::handlers::login_finish),
        )
        .layer(axum_middleware::from_fn(auth::middleware::validate_origin));

    // public routes that need origin validation
    let origin_validated_public = Router::new()
        .route(
            routes_map["auth"]["redeem_invite"].path,
            post(auth::handlers::redeem_invite),
        )
        .layer(axum_middleware::from_fn(auth::middleware::validate_origin));

    // truly public routes (no auth, no origin validation)
    // note: health_check, server_info, knock routes are handled by offal
    let truly_public =
        Router::new().route("/api/hello/image", get(static_files::serve_server_image));

    // compose everything
    #[cfg(feature = "webauthn")]
    let router = Router::new()
        .merge(truly_public)
        .merge(public)
        .merge(origin_validated_public)
        .merge(webauthn_routes)
        .merge(blob_routes)
        .merge(upload_routes)
        .merge(protected_routes)
        .fallback(static_files::serve_static);

    #[cfg(not(feature = "webauthn"))]
    let router = Router::new()
        .merge(truly_public)
        .merge(public)
        .merge(origin_validated_public)
        .merge(blob_routes)
        .merge(upload_routes)
        .merge(protected_routes)
        .fallback(static_files::serve_static);

    router
}
