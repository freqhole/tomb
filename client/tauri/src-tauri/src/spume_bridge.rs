//! spume bridge - tauri ↔ spume communication via events
//!
//! uses tauri's emit() for push notifications (Rust → JS) and invoke commands for
//! request/response (JS → Rust). no more eval() or inline JS strings.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Wry};

/// event name for all freqhole events (single channel, discriminated by type)
const EVENT_NAME: &str = "freqhole:event";

/// event payload types sent from rust to spume
///
/// these match the zod schemas in client/spume/src/app/services/tauri/schema.ts
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum SpumeEvent {
    /// config was changed by user - spume should refetch config
    #[serde(rename = "config-changed")]
    ConfigChanged { message: String },

    /// server image was updated - spume should refresh remote icon silently
    #[serde(rename = "server-image-updated")]
    ServerImageUpdated {},

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
    #[serde(rename = "scan-complete")]
    ScanComplete {
        songs_added: u32,
        albums_added: u32,
        artists_added: u32,
    },

    /// a P2P peer connection failed - remote may be offline
    #[serde(rename = "peer-offline")]
    PeerOffline {
        /// the peer address (node_id) that failed
        peer_addr: String,
        /// error message describing the failure
        reason: String,
    },
}

/// emit an event to spume via tauri's event system
fn emit_event(app: &AppHandle<Wry>, event: SpumeEvent) -> Result<(), String> {
    app.emit(EVENT_NAME, event).map_err(|e| e.to_string())
}

/// notify spume that config was changed (via wizard)
///
/// spume should refetch config via the get_freqhole_config command
pub fn notify_config_changed(app: &AppHandle<Wry>, message: &str) -> Result<(), String> {
    emit_event(
        app,
        SpumeEvent::ConfigChanged {
            message: message.to_string(),
        },
    )
}

/// notify spume that server image was updated (silent refresh)
pub fn notify_server_image_updated(app: &AppHandle<Wry>) -> Result<(), String> {
    emit_event(app, SpumeEvent::ServerImageUpdated {})
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
    emit_event(
        app,
        SpumeEvent::ScanProgress {
            songs_added,
            albums_added,
            artists_added,
            jobs_pending,
            jobs_total,
        },
    )
}

/// notify spume that scan jobs have completed
pub fn notify_scan_complete(
    app: &AppHandle<Wry>,
    songs_added: u32,
    albums_added: u32,
    artists_added: u32,
) -> Result<(), String> {
    emit_event(
        app,
        SpumeEvent::ScanComplete {
            songs_added,
            albums_added,
            artists_added,
        },
    )
}

/// notify spume that a P2P peer connection failed
///
/// allows early detection of offline remotes before request timeout
pub fn notify_peer_offline(
    app: &AppHandle<Wry>,
    peer_addr: &str,
    reason: &str,
) -> Result<(), String> {
    emit_event(
        app,
        SpumeEvent::PeerOffline {
            peer_addr: peer_addr.to_string(),
            reason: reason.to_string(),
        },
    )
}
