//! Auth routes module
//!
//! This module contains all authentication and registration related routes.

use axum::{
    routing::{get, post},
    Router,
};

use super::{
    auth_status, finish_authentication, finish_register, logout, start_authentication,
    start_register,
};
use grimoire::AppConfig;

/// Build authentication and registration routes
pub fn build_auth_routes(config: &AppConfig) -> Router {
    let mut auth_routes = Router::new()
        .route("/login_start/{username}", post(start_authentication))
        .route("/login_finish", post(finish_authentication))
        .route("/logout", post(logout))
        .route("/api/whoami", get(auth_status));

    // Add registration routes if enabled in config
    if config.features.registration_enabled {
        auth_routes = auth_routes
            .route("/register_start/{username}", post(start_register))
            .route("/register_finish", post(finish_register));
    }

    auth_routes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_auth_routes_with_registration() {
        let mut config = AppConfig::default();
        config.features.registration_enabled = true;

        let _router = build_auth_routes(&config);
        // Basic test to ensure router builds without panicking
    }

    #[test]
    fn test_build_auth_routes_without_registration() {
        let mut config = AppConfig::default();
        config.features.registration_enabled = false;

        let _router = build_auth_routes(&config);
        // Basic test to ensure router builds without panicking
    }
}
