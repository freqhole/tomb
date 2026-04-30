//! embedded media http server lifecycle for charnel.
//!
//! spawns a tiny axum loopback server (see `server::media_server`) on app
//! startup, ensures the configured admin user has a usable api key, and
//! exposes the bind address + key to the webview via tauri-managed state.
//!
//! the frontend (`CharnelLocalTransport`) reads this via the
//! `media_server_info` ipc command and uses the resulting url for `<audio>`
//! and `<img>` `src` attributes — bypassing the asset:// streaming bug on
//! linux webkitgtk.

use std::sync::{Arc, RwLock};

use serde::Serialize;

use crate::app_config::FreqholeAppConfig;

/// info about the running embedded media server, exposed to the webview.
#[derive(Clone, Debug, Serialize)]
pub struct MediaServerInfo {
    /// base url e.g. `http://127.0.0.1:54321`. append `/api/blobs/{id}`.
    pub base_url: String,
    /// admin api key, append as `?api_key=...` since `<audio>` cannot send
    /// authorization headers.
    pub api_key: String,
}

/// tauri-managed state holding the current media server info (if running).
#[derive(Default, Clone)]
pub struct MediaServerState(pub Arc<RwLock<Option<MediaServerInfo>>>);

impl MediaServerState {
    pub fn new() -> Self {
        Self(Arc::new(RwLock::new(None)))
    }

    pub fn get(&self) -> Option<MediaServerInfo> {
        self.0.read().ok().and_then(|g| g.clone())
    }

    pub fn set(&self, info: MediaServerInfo) {
        if let Ok(mut g) = self.0.write() {
            *g = Some(info);
        }
    }
}

/// resolve the saved admin user (from charnel app config) and ensure they
/// have an api key. returns the api key string.
///
/// requires grimoire config + database to be initialized already.
async fn ensure_admin_api_key(
    app_handle: &tauri::AppHandle,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let app_config = FreqholeAppConfig::load(app_handle).unwrap_or_default();
    let admin_id = app_config
        .admin_user
        .user_id
        .ok_or("no admin user configured (run setup wizard)")?;

    // load the admin user from grimoire
    let user_response = grimoire::users::get_user(&admin_id).await;
    let user = user_response
        .data
        .ok_or_else(|| format!("admin user {} not found in db", admin_id))?;

    // ensure_api_key returns the user (with key already set) or generates one.
    let service = grimoire::users::UserService::new();
    let response = service.ensure_api_key(user).await;
    let user = response
        .data
        .ok_or_else(|| format!("failed to ensure api key: {}", response.message))?;

    user.api_key
        .filter(|k| !k.is_empty())
        .ok_or_else(|| "admin user has empty api key after ensure".into())
}

/// start the embedded media server, ensure the admin api key exists, and
/// store the resulting `MediaServerInfo` in tauri state.
///
/// safe to call on app startup. no-op-ish if called twice (will spawn a
/// second server bound to a different random port — caller should only call
/// once).
pub async fn start_and_register(
    app_handle: tauri::AppHandle,
    state: MediaServerState,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let api_key = ensure_admin_api_key(&app_handle).await?;
    let handle = server::spawn_local_media_server().await?;
    let info = MediaServerInfo {
        base_url: handle.base_url(),
        api_key,
    };
    tracing::info!(base_url = %info.base_url, "embedded media server registered");
    state.set(info);
    Ok(())
}
