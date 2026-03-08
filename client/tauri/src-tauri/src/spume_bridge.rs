//! spume bridge - config injection and messaging for tauri ↔ spume communication
//!
//! uses initialization_script for bootstrap config and eval() for updates/messages.
//! this works in both dev (external URL) and release (bundled) modes.

use serde::Serialize;
use tauri::{AppHandle, Manager, Wry};

use crate::app_config::FreqholeAppConfig;
use crate::commands::{get_freqhole_config, FreqholeConfig};

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

/// generate JavaScript to set window.__FREQHOLE_CONFIG__ and set up auth listener
pub fn generate_config_script(config: &FreqholeConfig) -> String {
    let json = serde_json::to_string(config).unwrap_or_else(|_| "null".to_string());
    let no_blur_attr = if config.disable_backdrop_blur {
        "document.documentElement.dataset.noBackdropFilter = 'true';"
    } else {
        ""
    };
    format!(
        r#"{}window.__FREQHOLE_CONFIG__ = {};

// helper to wait for tauri to be ready
function waitForTauri(callback, maxAttempts = 50) {{
    let attempts = 0;
    const check = () => {{
        attempts++;
        if (window.__TAURI__?.core?.invoke) {{
            callback();
        }} else if (attempts < maxAttempts) {{
            setTimeout(check, 100);
        }}
    }};
    check();
}}

// set up auth-needed listener to auto-refresh auth via tauri
// note: in dev mode with external URLs, tauri IPC isn't available,
// so auth refresh is pushed from rust via push_auth_refresh_to_spume()
window.addEventListener('freqhole:auth-needed', async (event) => {{
    const remoteId = event.detail?.remote_id;
    
    // ensure tauri is ready before invoking
    if (!window.__TAURI__?.core?.invoke) {{
        waitForTauri(async () => {{
            try {{
                const inviteCode = await window.__TAURI__.core.invoke('generate_auto_auth_invite');
                window.dispatchEvent(new CustomEvent('freqhole:auth-refresh', {{
                    detail: {{ invite_code: inviteCode, remote_id: remoteId }}
                }}));
            }} catch (err) {{
                console.error('[freqhole] failed to generate auth invite:', err);
            }}
        }});
        return;
    }}
    
    try {{
        const inviteCode = await window.__TAURI__.core.invoke('generate_auto_auth_invite');
        window.dispatchEvent(new CustomEvent('freqhole:auth-refresh', {{
            detail: {{ invite_code: inviteCode, remote_id: remoteId }}
        }}));
    }} catch (err) {{
        console.error('[freqhole] failed to generate auth invite:', err);
    }}
}});"#,
        no_blur_attr, json
    )
}

/// get the initialization script for a new spume window
///
/// returns empty string if config not available yet
pub fn get_init_script(app: &AppHandle<Wry>) -> String {
    match get_freqhole_config(app.clone()) {
        Some(config) => generate_config_script(&config),
        None => String::new(),
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
    let config = get_freqhole_config(app.clone()).ok_or("config not available")?;

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

/// push a fresh auth invite code to spume
///
/// generates a new invite code linked to the admin user and dispatches
/// a `freqhole:auth-refresh` event to spume. this is used after server
/// start to enable auto-authentication without relying on tauri IPC
/// (which doesn't work for external URLs in dev mode).
pub async fn push_auth_refresh_to_spume(app: &AppHandle<Wry>) -> Result<(), String> {
    // get config to find the remote_id (server_id)
    let config = get_freqhole_config(app.clone()).ok_or("config not available")?;
    let remote_id = config.server_id.clone();

    // load app config to get stored admin user id
    let app_config =
        FreqholeAppConfig::load(app).ok_or_else(|| "app config not found".to_string())?;

    let admin_user_id = app_config
        .admin_user
        .user_id
        .ok_or_else(|| "admin user not configured".to_string())?;

    // ensure wordlist is initialized (needed for invite code generation)
    if !grimoire::wordlist::is_initialized() {
        let wordlist_config = grimoire::wordlist::ManagementWordlistConfig::default();
        let result = grimoire::wordlist::initialize_wordlist(&wordlist_config);
        if !result.is_success() {
            return Err(format!("failed to initialize wordlist: {}", result.message));
        }
    }

    // generate a fresh invite code
    let service = grimoire::users::UserService::new();
    let result = service
        .create_account_link_code_internal(&admin_user_id)
        .await;

    let invite_code = result
        .data
        .map(|c| c.code)
        .ok_or_else(|| format!("failed to generate invite code: {}", result.message))?;

    // dispatch freqhole:auth-refresh event to spume
    let window = app
        .get_webview_window("main")
        .ok_or("main window not found")?;

    let script = format!(
        r#"window.dispatchEvent(new CustomEvent('freqhole:auth-refresh', {{
            detail: {{ invite_code: '{}', remote_id: '{}' }}
        }}));"#,
        invite_code, remote_id
    );

    window.eval(&script).map_err(|e| e.to_string())?;
    Ok(())
}
