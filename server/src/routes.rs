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

    // webauthn routes (feature-gated, require origin validation)
    #[cfg(feature = "webauthn")]
    let webauthn_routes = Router::new()
        .route(
            "/auth/webauthn/register/start",
            post(auth::handlers::register_start),
        )
        .route(
            "/auth/webauthn/register/finish",
            post(auth::handlers::register_finish),
        )
        .route(
            "/auth/webauthn/login/start",
            post(auth::handlers::login_start),
        )
        .route(
            "/auth/webauthn/login/finish",
            post(auth::handlers::login_finish),
        )
        .layer(axum_middleware::from_fn(auth::middleware::validate_origin));

    #[cfg(feature = "webauthn")]
    let router = Router::new()
        // public routes (no auth required)
        .route("/auth/invite", post(auth::handlers::redeem_invite))
        // webauthn routes (require origin validation)
        .merge(webauthn_routes)
        // protected routes
        .merge(protected_routes);

    #[cfg(not(feature = "webauthn"))]
    let router = Router::new()
        // public routes (no auth required)
        .route("/auth/invite", post(auth::handlers::redeem_invite))
        // protected routes
        .merge(protected_routes);

    router
    // TODO: add music routes
    // TODO: add blob routes
    // TODO: add health routes
    // TODO: add static file routes
}
