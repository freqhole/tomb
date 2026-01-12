//! application state

use std::sync::Arc;

/// application state shared across all handlers
///
/// **critical**: no database pool! grimoire handles all db connections.
#[derive(Clone)]
pub struct AppState {
    /// grimoire configuration
    pub config: Arc<grimoire::config::GrimoireConfig>,

    /// session store for authentication
    pub session_store: Arc<dyn tower_sessions::SessionStore>,
    // TODO: add auth state when implementing phase 2
    // will be isolated to auth module, no webauthn-rs types here
}

impl AppState {
    /// create new app state
    pub fn new(
        config: grimoire::config::GrimoireConfig,
        session_store: impl tower_sessions::SessionStore + 'static,
    ) -> Self {
        Self {
            config: Arc::new(config),
            session_store: Arc::new(session_store),
        }
    }

    /// validate configuration at startup
    ///
    /// validates that config settings are compatible with build features
    pub fn validate(&self) -> Result<(), String> {
        // webauthn validation: config-based gating with build-time check
        // TODO: uncomment when server config is added
        // #[cfg(not(feature = "webauthn"))]
        // {
        //     if self.config.server.auth.webauthn_enabled {
        //         return Err(
        //             "webauthn enabled in config but binary built without webauthn feature. \
        //              rebuild with --features webauthn or disable in config".to_string()
        //         );
        //     }
        // }

        Ok(())
    }
}
