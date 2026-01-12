//! route composition

use axum::{middleware as axum_middleware, routing::get, routing::post, Router};

use crate::{auth, state::AppState};

/// build the application router
///
/// composes all route modules into a single router
pub fn build_router() -> Router<AppState> {
    // protected routes (require authentication)
    let protected_routes = Router::new()
        .route("/auth/whoami", get(auth::handlers::whoami))
        .route("/auth/logout", post(auth::handlers::logout))
        .layer(axum_middleware::from_fn(auth::middleware::require_auth));

    Router::new()
        // public routes (no auth required)
        .route("/auth/invite", post(auth::handlers::redeem_invite))
        // protected routes
        .merge(protected_routes)
    // TODO: add music routes
    // TODO: add blob routes
    // TODO: add health routes
    // TODO: add static file routes
}
