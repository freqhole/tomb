//! bridges the shared unix control socket (`grimoire::control_socket`)
//! into charnel's existing playback/pairing mechanisms - lets a physical
//! button (or any local script) drive charnel the same way it already
//! drives rathole (see docs/rathole-control-socket.md). charnel has no
//! playback backend of its own in rust - audio/video always live in the
//! spume webview (`charnelPlaybackAdapter.ts`) - so every command here
//! reuses one of two already-existing bridges instead of building a
//! third:
//!
//!   - play/pause/next/previous/stop route through the existing
//!     `freqhole:media_session_action` event (`media_session.rs`) -
//!     spume's queue-aware action handler already knows how to route
//!     these to whichever backend is actually playing (the exact same
//!     path OS media keys already use).
//!   - volume/get_state route through `player_pairing_accept.rs`'s
//!     `dispatch_local_command` - the SAME `PlayerCommand`/`CommandAck`
//!     pipeline a real paired remote controller uses, so this always
//!     reflects live state regardless of which backend is playing.
//!   - show_admin_pin/rotate_pin/show_player act on the same
//!     `SharedPairingState` the pairing screen and real controllers see
//!     (`grimoire::cenotaph::state`), then bring charnel's main window
//!     forward and tell spume to show the player-pairing route.
//!
//! list_audio_devices/set_audio_device are a known gap (see their match
//! arms below) - no audio-output-device enumeration exists anywhere in
//! charnel/spume today, for any backend.

use grimoire::cenotaph::{PlayerCommand, PlayerStatus, StatusCommon};
use grimoire::control_socket::{maybe_spawn, ControlSocketCommand, ControlSocketRequest};
use tauri::{AppHandle, Emitter, Manager};
use tracing::warn;

use crate::media_session::{emit_action, MediaSessionAction};
use crate::player_pairing_accept;

/// tauri event spume listens on to navigate to the player-pairing route
/// (`show_player`/`show_admin_pin`/`rotate_pin` all end here) - kept in
/// sync with wherever spume subscribes (see `client/spume/src/app/
/// App.tsx`'s `freqhole:show-player` listener).
const SHOW_PLAYER_EVENT: &str = "freqhole:show-player";

/// how much `volume_up`/`volume_down` change the volume by per command -
/// matches rathole's own control socket convention, clamped to spume's
/// actual valid volume range (0.0..=1.0, unlike rathole's 0.0..=2.0 -
/// spume's `setPlayerVolume` clamps every backend to 0..1).
const VOLUME_STEP: f64 = 0.05;

/// starts the shared control socket listener (if `[control_socket].enabled`)
/// and spawns the dispatcher that routes each command into whichever
/// existing bridge above handles it. call once from `lib.rs`'s `setup()`,
/// after `player_pairing_accept::set_app_handle` - safe to call
/// unconditionally, `maybe_spawn` itself checks config.
pub fn init(app: AppHandle) {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<ControlSocketRequest>();
    maybe_spawn(tx);
    tauri::async_runtime::spawn(async move {
        while let Some(req) = rx.recv().await {
            let ControlSocketRequest { command, reply } = req;
            let needs_reply = reply.is_some();
            let json = dispatch(&app, command).await;
            if let (true, Some(reply_tx)) = (needs_reply, reply) {
                let _ = reply_tx.send(json.unwrap_or_else(|| "{}".to_string()));
            } else if !needs_reply && json.is_some() {
                // action commands never produce a reply payload above -
                // this would only trip if a future command is miswired.
                warn!(target: "charnel::control_socket", "action command unexpectedly produced a reply payload");
            }
        }
    });
}

/// dispatches one command; returns `Some(json)` only for the two query
/// commands (`get_state`/`list_audio_devices`), mirroring
/// `ControlSocketRequest::reply`'s own "query commands only" contract.
async fn dispatch(app: &AppHandle, command: ControlSocketCommand) -> Option<String> {
    match command {
        ControlSocketCommand::PlayPause => {
            emit_action(app, MediaSessionAction::PlayPause);
            None
        }
        ControlSocketCommand::Next => {
            emit_action(app, MediaSessionAction::Next);
            None
        }
        ControlSocketCommand::Previous => {
            emit_action(app, MediaSessionAction::Previous);
            None
        }
        ControlSocketCommand::Stop => {
            emit_action(app, MediaSessionAction::Stop);
            None
        }
        ControlSocketCommand::VolumeUp => {
            adjust_volume(VOLUME_STEP).await;
            None
        }
        ControlSocketCommand::VolumeDown => {
            adjust_volume(-VOLUME_STEP).await;
            None
        }
        ControlSocketCommand::ShowAdminPin => {
            rotate_pin(true).await;
            show_player(app);
            None
        }
        ControlSocketCommand::RotatePin => {
            rotate_pin(false).await;
            show_player(app);
            None
        }
        ControlSocketCommand::ShowPlayer => {
            show_player(app);
            None
        }
        ControlSocketCommand::GetState => Some(get_state_json().await),
        ControlSocketCommand::ListAudioDevices => {
            // known gap - see this module's own doc comment. an empty
            // list is a real, honest answer ("nothing to pick from"),
            // matching every spume backend's own convention for
            // platforms/elements with no output-device concept.
            Some(r#"{"backend":"audio","devices":[]}"#.to_string())
        }
        ControlSocketCommand::SetAudioDevice(name) => {
            warn!(
                target: "charnel::control_socket",
                device = %name,
                "set_audio_device: not supported yet in charnel (no output-device switching exists for any backend)"
            );
            None
        }
    }
}

/// queries the current volume via the same pipeline a real paired
/// controller uses, then sends the clamped, stepped result back through
/// it - there's no local record of "current volume" in rust to compute
/// a delta against otherwise (charnel has no playback backend of its
/// own; spume owns the only real volume state).
async fn adjust_volume(delta: f64) {
    let current = match player_pairing_accept::dispatch_local_command(PlayerCommand::GetStatus)
        .await
    {
        Ok(ack) if ack.ok => ack.status.as_ref().map(status_volume).unwrap_or(1.0),
        Ok(ack) => {
            warn!(target: "charnel::control_socket", reason = ?ack.reason, "volume adjust: get_status rejected");
            return;
        }
        Err(e) => {
            warn!(target: "charnel::control_socket", error = %e, "volume adjust: get_status failed");
            return;
        }
    };
    let next = (current + delta).clamp(0.0, 1.0);
    if let Err(e) =
        player_pairing_accept::dispatch_local_command(PlayerCommand::SetVolume { volume: next })
            .await
    {
        warn!(target: "charnel::control_socket", error = %e, "volume adjust: set_volume failed");
    }
}

fn status_volume(status: &PlayerStatus) -> f64 {
    common_of(status).volume
}

fn common_of(status: &PlayerStatus) -> &StatusCommon {
    match status {
        PlayerStatus::NowPlaying { common, .. } => common,
        PlayerStatus::Paused { common, .. } => common,
        PlayerStatus::Buffering { common } => common,
        PlayerStatus::Stopped { common } => common,
        PlayerStatus::Error { common, .. } => common,
        PlayerStatus::PlayingRadio { common, .. } => common,
    }
}

/// builds the same `{"kind":..., "title":..., ...}` reply shape
/// docs/rathole-control-socket.md documents, from whatever
/// `PlayerCommand::GetStatus` reports back through the real dispatch
/// pipeline - always live, regardless of which backend is actually
/// playing. `Paused`/`Buffering`/`Stopped`/`Error` carry no media
/// reference in `PlayerStatus` today (only `NowPlaying`/`PlayingRadio`
/// do) - reported as `"kind":"idle"` with whatever position/volume IS
/// known, a superset of the documented plain-idle shape rather than a
/// perfect match, which is harmless for any consumer that only reads
/// the fields it expects.
async fn get_state_json() -> String {
    let status = match player_pairing_accept::dispatch_local_command(PlayerCommand::GetStatus).await
    {
        Ok(ack) if ack.ok => ack.status,
        Ok(ack) => {
            return serde_json::json!({
                "kind": "idle",
                "volume": 1.0,
                "error": format!("{:?}", ack.reason),
            })
            .to_string();
        }
        Err(e) => {
            return serde_json::json!({
                "kind": "idle",
                "volume": 1.0,
                "error": e,
            })
            .to_string();
        }
    };
    let Some(status) = status else {
        return serde_json::json!({ "kind": "idle", "volume": 1.0 }).to_string();
    };
    let volume = common_of(&status).volume;
    let value = match status {
        PlayerStatus::NowPlaying {
            item, position_ms, ..
        } => serde_json::json!({
            "kind": item.kind.map(media_kind_str).unwrap_or("song"),
            "title": item.title,
            "artist": item.artist,
            "album": serde_json::Value::Null,
            "is_playing": true,
            "position_ms": position_ms,
            "duration_ms": item.duration_ms,
            "volume": volume,
        }),
        PlayerStatus::Paused { position_ms, .. } => serde_json::json!({
            "kind": "idle",
            "is_playing": false,
            "position_ms": position_ms,
            "volume": volume,
        }),
        PlayerStatus::PlayingRadio {
            title,
            artist,
            kind,
            ..
        } => serde_json::json!({
            "kind": kind.map(media_kind_str).unwrap_or("song"),
            "title": title,
            "artist": artist,
            "album": serde_json::Value::Null,
            "is_playing": true,
            "volume": volume,
        }),
        PlayerStatus::Buffering { .. } | PlayerStatus::Stopped { .. } => serde_json::json!({
            "kind": "idle",
            "volume": volume,
        }),
        PlayerStatus::Error { message, .. } => serde_json::json!({
            "kind": "idle",
            "volume": volume,
            "error": message,
        }),
    };
    value.to_string()
}

fn media_kind_str(kind: grimoire::cenotaph::MediaKind) -> &'static str {
    match kind {
        grimoire::cenotaph::MediaKind::Audio => "song",
        grimoire::cenotaph::MediaKind::Video => "video",
    }
}

/// rotates the pairing session pin on the SAME shared state the pairing
/// screen and real controllers use - a no-op (logged) if player pairing
/// never started this launch (`[player_pairing].enabled` is off).
async fn rotate_pin(admin_grant: bool) {
    let Some(state) = player_pairing_accept::shared_state() else {
        warn!(target: "charnel::control_socket", "rotate_pin: player pairing not started");
        return;
    };
    let result = if admin_grant {
        grimoire::cenotaph::state::regenerate_admin_pin(&state).await
    } else {
        grimoire::cenotaph::state::regenerate_session_pin(&state).await
    };
    if let Err(e) = result {
        warn!(target: "charnel::control_socket", error = %e, "rotate_pin failed");
    }
}

/// brings charnel's main window forward and tells spume to show the
/// player-pairing route - mirrors rathole's `ShowPlayer`/pin commands
/// switching focus to its own pairing overview.
fn show_player(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Err(e) = app.emit(SHOW_PLAYER_EVENT, ()) {
        warn!(target: "charnel::control_socket", error = %e, "failed to emit show-player event");
    }
}
