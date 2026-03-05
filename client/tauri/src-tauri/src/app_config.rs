//! freqhole app configuration
//!
//! manages tauri-specific config separate from the server's freqhole-config.toml
//! this config stores:
//! - path to the server config file
//! - admin user info (for auto-generating invite codes)
//! - path to the freqhole binary (for sidecar)

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// freqhole app config filename
const APP_CONFIG_FILENAME: &str = "freqhole-app-config.toml";

/// freqhole app configuration
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FreqholeAppConfig {
    /// path to the server's freqhole-config.toml file
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_config_path: Option<String>,

    /// admin user info for auto-generating invite codes
    #[serde(default)]
    pub admin_user: AdminUserConfig,

    /// path to the freqhole binary (discovered or configured)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub freqhole_bin_path: Option<String>,

    /// disable backdrop-filter blur effects (for linux/webkitgtk compatibility)
    #[serde(default)]
    pub disable_backdrop_blur: bool,
}

/// admin user configuration
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AdminUserConfig {
    /// admin user id (UUID)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,

    /// admin username
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
}

impl FreqholeAppConfig {
    /// load app config from the tauri app data directory
    pub fn load(app_handle: &tauri::AppHandle) -> Option<Self> {
        let config_path = get_config_path(app_handle)?;
        if !config_path.exists() {
            return None;
        }

        let content = std::fs::read_to_string(&config_path).ok()?;
        toml::from_str(&content).ok()
    }

    /// save app config to the tauri app data directory
    pub fn save(&self, app_handle: &tauri::AppHandle) -> Result<(), String> {
        let config_path =
            get_config_path(app_handle).ok_or_else(|| "failed to get app data dir".to_string())?;

        // ensure parent directory exists
        if let Some(parent) = config_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create config dir: {}", e))?;
        }

        let content = toml::to_string_pretty(self)
            .map_err(|e| format!("failed to serialize config: {}", e))?;

        std::fs::write(&config_path, content)
            .map_err(|e| format!("failed to write config: {}", e))?;

        eprintln!("[app_config] saved config to {:?}", config_path);
        Ok(())
    }

    /// set the server config path
    pub fn set_server_config_path(&mut self, path: &str) {
        self.server_config_path = Some(path.to_string());
    }

    /// set the admin user info
    pub fn set_admin_user(&mut self, user_id: &str, username: &str) {
        self.admin_user = AdminUserConfig {
            user_id: Some(user_id.to_string()),
            username: Some(username.to_string()),
        };
    }

    /// set the freqhole binary path
    pub fn set_freqhole_bin_path(&mut self, path: &str) {
        self.freqhole_bin_path = Some(path.to_string());
    }

    /// get the server config path as PathBuf
    pub fn get_server_config_path(&self) -> Option<PathBuf> {
        self.server_config_path.as_ref().map(PathBuf::from)
    }

    /// get the freqhole binary path as PathBuf
    pub fn get_freqhole_bin_path(&self) -> Option<PathBuf> {
        self.freqhole_bin_path.as_ref().map(PathBuf::from)
    }
}

/// get the path to the app config file
fn get_config_path(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    app_handle
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join(APP_CONFIG_FILENAME))
}

/// load or create default app config
pub fn load_or_create(app_handle: &tauri::AppHandle) -> FreqholeAppConfig {
    FreqholeAppConfig::load(app_handle).unwrap_or_default()
}

/// save admin user info to app config
pub fn save_admin_user(
    app_handle: &tauri::AppHandle,
    user_id: &str,
    username: &str,
) -> Result<(), String> {
    let mut config = load_or_create(app_handle);
    config.set_admin_user(user_id, username);
    config.save(app_handle)
}

/// save server config path to app config
pub fn save_server_config_path(app_handle: &tauri::AppHandle, path: &str) -> Result<(), String> {
    let mut config = load_or_create(app_handle);
    config.set_server_config_path(path);
    config.save(app_handle)
}

/// save freqhole binary path to app config
pub fn save_freqhole_bin_path(app_handle: &tauri::AppHandle, path: &str) -> Result<(), String> {
    let mut config = load_or_create(app_handle);
    config.set_freqhole_bin_path(path);
    config.save(app_handle)
}

/// get the resolved server config path
///
/// tries app config first, falls back to legacy location in app data dir.
/// returns None if no config path is found.
pub fn get_server_config_path_resolved(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;

    // first, check app config for saved path
    if let Some(app_config) = FreqholeAppConfig::load(app_handle) {
        if let Some(path) = app_config.get_server_config_path() {
            if path.exists() {
                return Some(path);
            }
        }
    }

    // fallback: check legacy location in app data dir
    let legacy_path = app_handle
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("freqhole-config.toml"))?;

    if legacy_path.exists() {
        Some(legacy_path)
    } else {
        None
    }
}

/// check if setup is complete (has valid config)
///
/// returns true if either:
/// - app config exists with a valid server_config_path, OR
/// - legacy config exists in app data dir (backward compat)
pub fn is_setup_complete(app_handle: &tauri::AppHandle) -> bool {
    get_server_config_path_resolved(app_handle).is_some()
}
