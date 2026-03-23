//! charnel app configuration
//!
//! manages charnel-specific config separate from the server's freqhole-config.toml
//! this config stores:
//! - path to the server config file
//! - admin user info (for auto-generating invite codes)

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// charnel app config filename
const APP_CONFIG_FILENAME: &str = "charnel-config.toml";

/// logging configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingConfig {
    /// log file name (relative to app data dir)
    #[serde(default = "default_log_file")]
    pub file: String,

    /// max lines before auto-truncate (default: 10000)
    #[serde(default = "default_max_lines")]
    pub max_lines: usize,
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            file: default_log_file(),
            max_lines: default_max_lines(),
        }
    }
}

fn default_log_file() -> String {
    "charnel.log".to_string()
}

fn default_max_lines() -> usize {
    10000
}

/// charnel app configuration
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FreqholeAppConfig {
    /// app config version (tracks which binary version last wrote this config)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,

    /// path to the server's freqhole-config.toml file
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_config_path: Option<String>,

    /// admin user info for auto-generating invite codes
    #[serde(default)]
    pub admin_user: AdminUserConfig,

    /// logging configuration
    #[serde(default)]
    pub logging: LoggingConfig,

    /// disable backdrop-filter blur effects (for linux/webkitgtk compatibility)
    #[serde(default)]
    pub disable_backdrop_blur: bool,

    /// show system tray icon (default: false)
    #[serde(default)]
    pub tray_enabled: bool,

    /// sync queue songs from remotes to local library (default: true)
    #[serde(default = "default_sync_queue_to_local")]
    pub sync_queue_to_local: bool,
}

/// default value for sync_queue_to_local (true)
fn default_sync_queue_to_local() -> bool {
    true
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

        tracing::info!(path = ?config_path, "saved config");
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

    /// get the server config path as PathBuf
    pub fn get_server_config_path(&self) -> Option<PathBuf> {
        self.server_config_path.as_ref().map(PathBuf::from)
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
    // also set version when saving config path (means setup is complete or being updated)
    config.version = Some(get_binary_version().to_string());
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

/// get the binary version from cargo
pub fn get_binary_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// check if app config needs upgrade (version mismatch)
///
/// returns true if version in app config differs from binary version,
/// or if version is missing (old config format)
pub fn app_config_needs_upgrade(app_handle: &tauri::AppHandle) -> bool {
    let Some(config) = FreqholeAppConfig::load(app_handle) else {
        return false; // no config means setup not done yet, not an upgrade situation
    };

    let config_version = config.version.as_deref().unwrap_or("0.0.0");
    config_version != get_binary_version()
}

/// result of an app config upgrade
#[derive(Debug, Clone)]
pub struct AppConfigUpgradeResult {
    /// path to backup of original config
    pub backup_path: std::path::PathBuf,
    /// old version from config (or "0.0.0" if missing)
    pub old_version: String,
    /// new version written to config
    pub new_version: String,
}

/// upgrade app config to current binary version
///
/// creates backup first, then updates version field.
/// preserves all other config values.
pub fn upgrade_app_config(app_handle: &tauri::AppHandle) -> Result<AppConfigUpgradeResult, String> {
    let config_path =
        get_config_path(app_handle).ok_or_else(|| "failed to get app config path".to_string())?;

    if !config_path.exists() {
        return Err("app config does not exist".to_string());
    }

    // load current config
    let mut config = FreqholeAppConfig::load(app_handle)
        .ok_or_else(|| "failed to load app config".to_string())?;

    let old_version = config
        .version
        .clone()
        .unwrap_or_else(|| "0.0.0".to_string());

    // create backup with timestamp
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let timestamp = now.as_secs();
    let backup_path = config_path.with_extension(format!("toml.bak.{}", timestamp));

    std::fs::copy(&config_path, &backup_path)
        .map_err(|e| format!("failed to create backup: {}", e))?;

    // update version
    config.version = Some(get_binary_version().to_string());

    // save updated config
    config.save(app_handle)?;

    Ok(AppConfigUpgradeResult {
        backup_path,
        old_version,
        new_version: get_binary_version().to_string(),
    })
}

/// get the path to the log file
pub fn get_log_file_path(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    let config = FreqholeAppConfig::load(app_handle).unwrap_or_default();
    app_handle
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join(&config.logging.file))
}
