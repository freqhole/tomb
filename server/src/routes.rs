//! Routes module
//!
//! This module contains the main routing logic and general app routes.
//! Domain-specific routes are handled by their respective modules.

use axum::Router;

use crate::analytics::build_analytics_routes;
use crate::auth::build_auth_routes;
use crate::blobs::build_blob_routes;
use crate::health::build_health_routes;
use crate::media::build_media_routes;

use crate::static_filez::{build_enhanced_private_routes, build_enhanced_public_routes};

use crate::sync::create_sync_routes;
use crate::upload::build_upload_routes;
use crate::websocket::{build_websocket_routes_with_manager, handlers::ConnectionManager};
use grimoire::AppConfig;

/// Build all routes for the application
pub fn build_routes(config: &AppConfig, connection_manager: ConnectionManager) -> Router {
    Router::new()
        .merge(build_auth_routes(config))
        .merge(build_analytics_routes(config))
        .merge(build_blob_routes(config))
        .merge(build_enhanced_private_routes(config))
        .merge(build_enhanced_public_routes(config))
        .merge(build_health_routes())
        .merge(build_websocket_routes_with_manager(connection_manager))
        .merge(build_upload_routes(config))
        .merge(create_sync_routes())
        .merge(build_media_routes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_routes() {
        let config = AppConfig::default();
        let connection_manager = ConnectionManager::new();
        let _router = build_routes(&config, connection_manager);
        // Basic test to ensure router builds without panicking
    }
}
