//! route composition

use axum::Router;

use crate::state::AppState;

/// build the application router
///
/// composes all route modules into a single router
pub fn build_router() -> Router<AppState> {
    Router::new()
    // TODO: add auth routes
    // TODO: add music routes
    // TODO: add blob routes
    // TODO: add health routes
    // TODO: add static file routes
}
