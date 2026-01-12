//! application state

use std::sync::Arc;

/// application state shared across all handlers
///
/// **critical**: no database pool! grimoire handles all db connections.
#[derive(Clone)]
pub struct AppState {
    /// grimoire configuration
    pub config: Arc<grimoire::config::GrimoireConfig>,

    /// webauthn instance (if feature enabled)
    #[cfg(feature = "webauthn")]
    pub webauthn: Option<Arc<webauthn_rs::Webauthn>>,

    /// session store for authentication
    pub session_store: Arc<dyn tower_sessions::SessionStore>,
}

impl AppState {
    /// create new app state
    pub fn new(
        config: grimoire::config::GrimoireConfig,
        #[cfg(feature = "webauthn")] webauthn: Option<webauthn_rs::Webauthn>,
        session_store: impl tower_sessions::SessionStore + 'static,
    ) -> Self {
        Self {
            config: Arc::new(config),
            #[cfg(feature = "webauthn")]
            webauthn: webauthn.map(Arc::new),
            session_store: Arc::new(session_store),
        }
    }

    /// validate configuration at startup
    ///
    /// panics if configuration is invalid (e.g., webauthn enabled without feature)
    pub fn validate(&self) -> Result<(), String> {
        // check webauthn config vs feature flag
        #[cfg(not(feature = "webauthn"))]
        {
            // if webauthn feature is disabled, config must not enable it
            // TODO: add config field check when we add server config
            // if config.auth.webauthn_enabled {
            //     return Err("webauthn enabled in config but binary built without webauthn feature".to_string());
            // }
        }

        Ok(())
    }
}
