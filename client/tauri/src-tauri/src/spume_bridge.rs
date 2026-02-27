//! spume bridge - config injection and messaging for tauri ↔ spume communication
//!
//! uses initialization_script for bootstrap config and eval() for updates/messages.
//! this works in both dev (external URL) and release (bundled) modes.

use serde::Serialize;
use tauri::{AppHandle, Manager, Wry};

use crate::commands::FreqholeConfig;

/// message types that can be sent to spume
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum SpumeMessage {
    /// config was updated (server restart) - auto-applies new config
    #[serde(rename = "config-updated")]
    ConfigUpdated(FreqholeConfig),

    /// config was changed by user - requires page reload
    #[serde(rename = "config-changed")]
    ConfigChanged { message: String },

    /// scan progress update - sent during scan to allow UI refresh
    #[serde(rename = "scan-progress")]
    ScanProgress {
        songs_added: u32,
        albums_added: u32,
        artists_added: u32,
        jobs_pending: u32,
        jobs_total: u32,
    },

    /// scan jobs completed - notifies spume to refresh music data
    #[serde(rename = "scan-jobs-complete")]
    ScanJobsComplete {
        songs_added: u32,
        albums_added: u32,
        artists_added: u32,
    },
}

/// generate JavaScript to dispatch a message event to spume
fn generate_message_script(msg: &SpumeMessage) -> String {
    let json = serde_json::to_string(msg).unwrap_or_else(|_| "null".to_string());

    // for config-updated, also update the global
    let extra = if let SpumeMessage::ConfigUpdated(config) = msg {
        let config_json = serde_json::to_string(config).unwrap_or_else(|_| "null".to_string());
        format!("window.__FREQHOLE_CONFIG__ = {};", config_json)
    } else {
        String::new()
    };

    format!(
        r#"{}
window.dispatchEvent(new CustomEvent('freqhole:message', {{ detail: {} }}));
console.log('[freqhole] message sent:', {});"#,
        extra, json, json
    )
}

/// generate JavaScript to set window.__FREQHOLE_CONFIG__
pub fn generate_config_script(config: &FreqholeConfig) -> String {
    let json = serde_json::to_string(config).unwrap_or_else(|_| "null".to_string());
    format!(
        r#"window.__FREQHOLE_CONFIG__ = {};
console.log('[freqhole] config injected:', window.__FREQHOLE_CONFIG__);"#,
        json
    )
}

/// get the initialization script for a new spume window
///
/// returns empty string if config not available yet
pub fn get_init_script(app: &AppHandle<Wry>) -> String {
    match crate::commands::get_freqhole_config(app.clone()) {
        Some(config) => generate_config_script(&config),
        None => {
            // no config yet - spume will fall back to local mode
            "console.log('[freqhole] no config available at window creation');".to_string()
        }
    }
}

/// send a message to the main spume window
pub fn send_message(app: &AppHandle<Wry>, msg: SpumeMessage) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("main window not found")?;

    let script = generate_message_script(&msg);
    window.eval(&script).map_err(|e| e.to_string())?;

    Ok(())
}

/// push config update to spume (server restart - auto-applies)
///
/// call this when server restarts to update the config seamlessly
pub fn push_config_to_spume(app: &AppHandle<Wry>) -> Result<(), String> {
    let config = crate::commands::get_freqhole_config(app.clone())
        .ok_or("config not available")?;

    send_message(app, SpumeMessage::ConfigUpdated(config))
}

/// notify spume that config was changed (requires reload)
///
/// call this when user changes config via wizard
pub fn notify_config_changed(app: &AppHandle<Wry>, message: &str) -> Result<(), String> {
    send_message(
        app,
        SpumeMessage::ConfigChanged {
            message: message.to_string(),
        },
    )
}

/// notify spume of scan progress (called during scan)
pub fn notify_scan_progress(
    app: &AppHandle<Wry>,
    songs_added: u32,
    albums_added: u32,
    artists_added: u32,
    jobs_pending: u32,
    jobs_total: u32,
) -> Result<(), String> {
    send_message(
        app,
        SpumeMessage::ScanProgress {
            songs_added,
            albums_added,
            artists_added,
            jobs_pending,
            jobs_total,
        },
    )
}

/// notify spume that scan jobs have completed
pub fn notify_scan_jobs_complete(
    app: &AppHandle<Wry>,
    songs_added: u32,
    albums_added: u32,
    artists_added: u32,
) -> Result<(), String> {
    send_message(
        app,
        SpumeMessage::ScanJobsComplete {
            songs_added,
            albums_added,
            artists_added,
        },
    )
}
