//! charnel's native accept-side for the `freqhole-player/1` protocol -
//! registers `grimoire::cenotaph::PLAYER_ALPN` on charnel's own p2p
//! router (reusing the SAME iroh endpoint/identity `p2p_commands.rs`
//! already manages, not a second one - see that module's
//! `init_p2p_client`), and bridges each authorized `PlayerCommand` to
//! the spume webview via a tauri event, since the actual playback
//! backend (rodio/gst, via spume's existing `charnelPlaybackAdapter.ts`)
//! lives in JS, not here.
//!
//! mirrors rathole's `tty/pairing/dispatch.rs` in SHAPE (translate an
//! authorized command into this consumer's real playback backend) but
//! NOT in content - charnel has no native rodio/mpv command surface
//! here, it just forwards the raw wire command to JS and awaits a
//! `CommandAck` back, keeping the single existing playback
//! implementation (`charnelPlaybackAdapter.ts`, already used for the
//! dial-out/controller side) as the one true JS-side driver.
//!
//! per docs/cenotaph-migration-plan.md's front 3 scope: this accept
//! mode targets charnel's "experimental player config" (native mpv/
//! rodio playback via `charnelPlaybackAdapter.ts`) - not the plain
//! webview `mediaPlaybackBackend` DOM-engine path, which would also
//! need a charnel-native blob-fetch/radio-tune `MediaPlaybackNode`
//! implementation (not built here; tracked as a follow-up).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use grimoire::cenotaph::{
    CommandAck, CommandAckReason, PairingCode, PairingDispatchRx, PlayerProtocol, PlayerSession,
    PlayerStatus, SessionMode, SharedPairingState, StatusCommon,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static STATE: OnceLock<SharedPairingState> = OnceLock::new();
static STATUS_TX: OnceLock<tokio::sync::watch::Sender<PlayerStatus>> = OnceLock::new();
static PENDING_REPLIES: Mutex<Option<HashMap<String, oneshot::Sender<CommandAck>>>> =
    Mutex::new(None);
static NEXT_REQUEST_ID: AtomicU64 = AtomicU64::new(0);

/// call once from `lib.rs`'s tauri `setup()` closure, where a real
/// `AppHandle` is available - every other entry point here needs one to
/// emit events, but several (the p2p router bootstrap, the dispatch
/// bridge task) don't receive one directly.
pub fn set_app_handle(handle: AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

fn pending() -> std::sync::MutexGuard<'static, Option<HashMap<String, oneshot::Sender<CommandAck>>>>
{
    let mut guard = PENDING_REPLIES.lock().unwrap();
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
    guard
}

fn next_request_id() -> String {
    let n = NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
    format!("cenotaph-cmd-{n}")
}

#[derive(Serialize, Clone)]
struct CenotaphCommandEvent {
    request_id: String,
    command_json: String,
}

/// builds the `PlayerProtocol` handler ready to `.accept(PLAYER_ALPN,
/// ...)` on charnel's own router, and spawns the dispatch bridge task.
/// call once, before `start_router_with` - safe to call unconditionally,
/// callers gate on `[player_pairing].enabled` themselves.
pub fn build_player_protocol() -> PlayerProtocol {
    let state = grimoire::cenotaph::state::new_shared_state(None);
    let (dispatch_tx, dispatch_rx) = tokio::sync::mpsc::unbounded_channel();
    let (status_tx, _status_rx) = tokio::sync::watch::channel(PlayerStatus::Stopped {
        common: StatusCommon {
            queue: Vec::new(),
            auto_download_enabled: false,
            volume: 1.0,
            recently_played: Vec::new(),
        },
    });
    let _ = STATE.set(state.clone());
    let _ = STATUS_TX.set(status_tx.clone());

    let state_for_bootstrap = state.clone();
    tauri::async_runtime::spawn(async move {
        grimoire::cenotaph::ensure_current_pairing_code(&state_for_bootstrap, None).await;
    });

    spawn_dispatch_bridge(dispatch_rx);

    PlayerProtocol::new(state, dispatch_tx, status_tx)
}

/// call once the endpoint's node_id is known (right after
/// `FederationEndpoint::new()`), so the pairing qr/settings screen can
/// display it.
pub fn set_node_id(node_id: String) {
    if let Some(state) = STATE.get() {
        let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
        guard.node_id = Some(node_id);
    }
}

fn spawn_dispatch_bridge(mut rx: PairingDispatchRx) {
    tauri::async_runtime::spawn(async move {
        while let Some(req) = rx.recv().await {
            let Some(app) = APP_HANDLE.get() else {
                let _ = req
                    .reply
                    .send(CommandAck::err(CommandAckReason::InvalidCommand));
                continue;
            };
            let command_json = match serde_json::to_string(&req.command) {
                Ok(s) => s,
                Err(_) => {
                    let _ = req
                        .reply
                        .send(CommandAck::err(CommandAckReason::InvalidCommand));
                    continue;
                }
            };
            let request_id = next_request_id();
            pending()
                .as_mut()
                .unwrap()
                .insert(request_id.clone(), req.reply);
            let event = CenotaphCommandEvent {
                request_id: request_id.clone(),
                command_json,
            };
            if let Err(e) = app.emit("cenotaph-command", event) {
                tracing::warn!(target: "cenotaph", error = %e, "failed to emit cenotaph-command event");
                if let Some(tx) = pending().as_mut().and_then(|m| m.remove(&request_id)) {
                    let _ = tx.send(CommandAck::err(CommandAckReason::InvalidCommand));
                }
            }
        }
    });
}

/// spume's JS-side bridge calls this after `dispatchCommand()` resolves,
/// carrying the resulting `CommandAck` back to the waiting accept-loop
/// stream. a request_id with no matching pending reply (already timed
/// out, or a stale/duplicate call) is silently ignored.
#[tauri::command]
pub fn player_pairing_command_reply(request_id: String, ack_json: String) {
    let tx = pending().as_mut().and_then(|m| m.remove(&request_id));
    if let Some(tx) = tx {
        let ack: CommandAck = serde_json::from_str(&ack_json)
            .unwrap_or_else(|_| CommandAck::err(CommandAckReason::InvalidCommand));
        let _ = tx.send(ack);
    }
}

/// spume calls this whenever local playback state changes, so any
/// controller with an open `subscribe` stream sees live updates -
/// charnel has no tick loop of its own to push this on a timer (unlike
/// rathole's `run.rs`), so it's push-driven from JS instead.
#[tauri::command]
pub fn player_pairing_broadcast_status(status_json: String) -> Result<(), String> {
    let status: PlayerStatus = serde_json::from_str(&status_json).map_err(|e| e.to_string())?;
    if let Some(tx) = STATUS_TX.get() {
        let _ = tx.send(status);
    }
    Ok(())
}

#[derive(Serialize)]
pub struct PairingSnapshotDto {
    node_id: Option<String>,
    current_code: Option<PairingCode>,
    session: Option<PlayerSession>,
    connected: Vec<grimoire::cenotaph::ConnectedControllerInfo>,
}

#[tauri::command]
pub fn player_pairing_get_snapshot() -> Result<PairingSnapshotDto, String> {
    let state = STATE
        .get()
        .ok_or_else(|| "player pairing not started".to_string())?;
    let snap = grimoire::cenotaph::state::snapshot(state);
    Ok(PairingSnapshotDto {
        node_id: snap.node_id,
        current_code: snap.current_code,
        session: snap.session,
        connected: snap.connected,
    })
}

#[tauri::command]
pub fn player_pairing_set_session_mode(mode: String) -> Result<(), String> {
    let state = STATE
        .get()
        .ok_or_else(|| "player pairing not started".to_string())?;
    let mode = match mode.as_str() {
        "everyone" => SessionMode::Everyone,
        "selected" => SessionMode::Selected,
        other => return Err(format!("unknown session mode: {other}")),
    };
    grimoire::cenotaph::state::set_session_mode(state, mode);
    Ok(())
}

#[tauri::command]
pub async fn player_pairing_regenerate_admin_pin() -> Result<(), String> {
    let state = STATE
        .get()
        .ok_or_else(|| "player pairing not started".to_string())?
        .clone();
    grimoire::cenotaph::state::regenerate_admin_pin(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn player_pairing_regenerate_session_pin() -> Result<(), String> {
    let state = STATE
        .get()
        .ok_or_else(|| "player pairing not started".to_string())?
        .clone();
    grimoire::cenotaph::state::regenerate_session_pin(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn player_pairing_remove_controller(node_id: String) -> Result<(), String> {
    let state = STATE
        .get()
        .ok_or_else(|| "player pairing not started".to_string())?
        .clone();
    grimoire::cenotaph::state::remove_controller(&state, &node_id).await;
    Ok(())
}

/// lets the frontend check whether `[player_pairing].enabled` actually
/// resulted in the accept-loop being wired up on this launch, before
/// showing pairing UI that would otherwise call the commands above and
/// get a "not started" error.
#[tauri::command]
pub fn player_pairing_is_started() -> bool {
    STATE.get().is_some()
}

/// mirrors rathole's own `grimoire::player_session::set_active()` call
/// (see `tty/run.rs`) - charnel never called this at all, so `server_info`/
/// `/api/hello`'s `player_device` field (health.rs) stayed permanently
/// `false` here, even while `/player` was open and actively accepting
/// commands. a controller's "add remote" flow reads that field to decide
/// whether to show the pin-pairing UI at all - without it, scanning this
/// device's pairing qr just looked like a normal already-added remote
/// ("already connected"), never registering it as a player. called from
/// spume's `CenotaphPlayerApp.tsx` whenever its own "am I an active
/// player right now" state (route mounted AND the accept-connections
/// toggle) changes.
#[tauri::command]
pub fn set_player_session_active(active: bool) {
    // TEMP DEBUG - remove once the charnel player_device bug is found
    eprintln!("\u{1F7E0}\u{1F7E0}\u{1F7E0} [player_session_debug] tauri command set_player_session_active({active}) invoked");
    grimoire::player_session::set_active(active);
}
