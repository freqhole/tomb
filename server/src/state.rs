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
        // check if server config exists
        let server_config = self.config.server.as_ref().ok_or_else(|| {
            "server config required (add 'server' section to config.jsonc)".to_string()
        })?;

        // webauthn validation: config-based gating with build-time check
        #[cfg(not(feature = "webauthn"))]
        {
            if server_config.auth.webauthn_enabled {
                return Err(
                    "webauthn enabled in config but binary built without webauthn feature. \
                     rebuild with --features webauthn or disable in config"
                        .to_string(),
                );
            }
        }

        // validate webauthn origins if webauthn is enabled
        if server_config.auth.webauthn_enabled {
            if server_config.auth.webauthn_origins.is_empty() {
                return Err("webauthn enabled but no webauthn_origins configured. \
                     add at least one origin with rp_id and rp_origin"
                    .to_string());
            }

            // validate each origin config
            for origin_config in &server_config.auth.webauthn_origins {
                if origin_config.rp_id.is_empty() {
                    return Err("webauthn origin config has empty rp_id".to_string());
                }
                if origin_config.rp_origin.is_empty() {
                    return Err("webauthn origin config has empty rp_origin".to_string());
                }
            }
        }

        // validate static files config
        if server_config.static_files.enabled && server_config.static_files.directory.is_none() {
            return Err("static_files enabled but no directory specified. \
                 set static_files.directory in config"
                .to_string());
        }

        Ok(())
    }
}
