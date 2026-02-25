//! application state

use grimoire::music::musicbrainz::MusicBrainzClient;
use std::sync::Arc;
use tower_sessions_sqlx_store::SqliteStore;

/// application state shared across all handlers
///
/// **critical**: no database pool! grimoire handles all db connections.
#[derive(Clone)]
pub struct AppState {
    /// grimoire configuration
    pub config: Arc<grimoire::config::GrimoireConfig>,

    /// session store for authentication
    pub session_store: SqliteStore,

    /// shared musicbrainz client (None if disabled in config)
    /// single instance ensures rate limiter state persists across requests
    /// and the connection pool is reused
    pub musicbrainz_client: Option<MusicBrainzClient>,
}

impl AppState {
    /// create new app state
    ///
    /// session_store should be initialized via grimoire::sessions::init_session_store()
    pub fn new(config: grimoire::config::GrimoireConfig, session_store: SqliteStore) -> Self {
        let musicbrainz_client = if config.musicbrainz.enabled {
            match MusicBrainzClient::new(config.musicbrainz.clone()) {
                Ok(client) => {
                    tracing::info!("musicbrainz client initialized");
                    Some(client)
                }
                Err(e) => {
                    tracing::warn!(
                        "failed to create musicbrainz client: {}, will be unavailable",
                        e
                    );
                    None
                }
            }
        } else {
            None
        };

        Self {
            config: Arc::new(config),
            session_store,
            musicbrainz_client,
        }
    }

    /// validate configuration at startup
    ///
    /// validates that config settings are compatible with build features
    pub fn validate(&self) -> Result<(), String> {
        // check if server config exists
        let server_config = self.config.server.as_ref().ok_or_else(|| {
            "server config required (add 'server' section to freqhole-config.toml)".to_string()
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

        // validate webauthn config if enabled
        if server_config.auth.webauthn_enabled {
            // webauthn needs at least one allowed origin (or "any")
            if server_config.auth.allowed_origins.is_empty() {
                return Err("webauthn enabled but no allowed_origins configured. \
                     add at least one origin or use \"any\" to allow any origin"
                    .to_string());
            }

            // validate each origin is a valid URL (unless it's "any")
            for origin in &server_config.auth.allowed_origins {
                if origin != "any" && grimoire::config::extract_rp_id(origin).is_none() {
                    return Err(format!(
                        "invalid origin '{}' - must be a valid URL (e.g., http://localhost:1420)",
                        origin
                    ));
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
