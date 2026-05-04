//! tauri commands + event bridge for the rodio player.
//!
//! desktop-only. wraps the supervised
//! [`grimoire::player::RodioController`] with two surfaces:
//!
//! - `player_send(cmd)` — invoke handler that forwards a
//!   [`PlayerCommand`] into the supervised audio thread.
//! - `player_event` tauri event — every [`PlayerEvent`] the
//!   supervisor emits is re-emitted through the webview so spume's
//!   `RodioBackend` can `listen()` for it.
//!
//! the controller is lazily constructed on first use via a
//! [`tokio::sync::OnceCell`] held in tauri-managed state. this
//! avoids paying the audio-device init cost during app startup
//! (and avoids spamming logs on machines where rodio fails to
//! open).
//!
//! gated to desktop targets via `#[cfg(...)]` in `lib.rs`.

use std::sync::Arc;

use grimoire::player::{
    spawn_player, PlayerCommand, PlayerController, RestartPolicy, RodioController,
};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::OnceCell;
use tracing::{debug, warn};

/// the tauri event name spume listens on. keep in sync with
/// `client/spume/src/music/services/audio/backends/rodioBackend.ts`.
pub const PLAYER_EVENT: &str = "freqhole:player_event";

/// process-global supervised player. lazily spawned on first use
/// from either:
///
/// - a tauri command (`player_send` / `player_init` / `player_snapshot`)
/// - p2p init wiring `PLAYER_ALPN` into the iroh router
///
/// having a single instance ensures the wizard's local-control
/// commands and any incoming remote-control connections drive the
/// same audio device. clone the `Arc` freely.
static GLOBAL_PLAYER: OnceCell<Arc<RodioController>> = OnceCell::const_new();

/// get-or-init the process-global controller. safe to call from any
/// async context. **does not** wire the tauri event pump — that's
/// the responsibility of [`PlayerState::ensure_event_pump`] (which
/// needs an `AppHandle`).
async fn get_or_init_global() -> Arc<RodioController> {
    GLOBAL_PLAYER
        .get_or_init(|| async {
            let ctl = spawn_player(RestartPolicy::default());
            Arc::new(ctl)
        })
        .await
        .clone()
}

/// non-async accessor for callers that just want to know whether the
/// player is up. used by the iroh router wiring to avoid forcing init
/// in `ProtocolHandler` callbacks.
#[allow(dead_code)]
pub fn try_get_global() -> Option<Arc<RodioController>> {
    GLOBAL_PLAYER.get().cloned()
}

/// async wrapper exported for the p2p init path: returns an
/// `Arc<dyn PlayerController>` ready to hand to
/// [`grimoire::player::PlayerProtocol::new`]. spawning the audio
/// thread on iroh-router setup matches the existing radio pattern
/// (broadcaster spawned alongside the router) and means the first
/// remote control connection doesn't pay a cold-start penalty.
pub async fn get_or_init_for_alpn() -> Arc<dyn PlayerController> {
    get_or_init_global().await as Arc<dyn PlayerController>
}

/// tauri-managed state. the controller itself lives in
/// [`GLOBAL_PLAYER`]; this state only tracks whether we've already
/// wired the per-`AppHandle` event pump.
#[derive(Default)]
pub struct PlayerState {
    pump_started: OnceCell<()>,
}

impl PlayerState {
    pub fn new() -> Self {
        Self::default()
    }

    /// get-or-init the controller and (idempotently) wire its event
    /// stream into a tauri emitter. safe to call from any tauri
    /// command handler.
    async fn get_or_init(&self, app: &AppHandle) -> Arc<RodioController> {
        let arc = get_or_init_global().await;
        self.ensure_event_pump(app, &arc).await;
        arc
    }

    /// wire the broadcast subscriber → tauri emit pump exactly once.
    async fn ensure_event_pump(&self, app: &AppHandle, controller: &Arc<RodioController>) {
        let app = app.clone();
        let controller = controller.clone();
        self.pump_started
            .get_or_init(|| async move {
                spawn_event_pump(app, controller);
            })
            .await;
    }
}

/// background task: forward every [`PlayerEvent`] to the webview.
/// runs for the life of the app; aborts when its broadcast receiver
/// closes (which only happens when the controller is dropped, which
/// only happens at process exit).
fn spawn_event_pump(app: AppHandle, controller: Arc<RodioController>) {
    let mut rx = controller.subscribe();
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(ev) => {
                    if let Err(e) = app.emit(PLAYER_EVENT, &ev) {
                        warn!(error = %e, "failed to emit player event to webview");
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    debug!("player event pump: broadcast closed; exiting");
                    return;
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    debug!("player event pump: lagged by {n}; continuing");
                }
            }
        }
    });
}

/// dispatch a [`PlayerCommand`]. returns `Ok(())` once the command
/// has been queued; observable effects arrive via the
/// `freqhole:player_event` tauri event.
#[tauri::command]
pub async fn player_send(
    app: AppHandle,
    state: State<'_, PlayerState>,
    cmd: PlayerCommand,
) -> Result<(), String> {
    let ctl = state.get_or_init(&app).await;
    ctl.send(cmd)
        .await
        .map_err(|e| format!("player_send failed: {e}"))
}

/// returns the last-known [`PlayerSnapshot`]. cheap; safe to poll
/// from spume on demand for cold-start hydration.
#[tauri::command]
pub async fn player_snapshot(
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<grimoire::player::PlayerSnapshot, String> {
    let ctl = state.get_or_init(&app).await;
    Ok(ctl.snapshot())
}

/// explicit init — useful for "warm up the audio device early" hooks.
/// idempotent. callers can also just send any command and let
/// `player_send` lazy-init.
#[tauri::command]
pub async fn player_init(app: AppHandle, state: State<'_, PlayerState>) -> Result<(), String> {
    let _ = state.get_or_init(&app).await;
    Ok(())
}

/// resolve a media blob id to a local filesystem path the rodio
/// backend can hand to `Symphonia` via [`PlayerCommand::Load`].
///
/// returns `Ok({ id, path, mime })` for blobs that have a
/// `local_path` (i.e. the file lives on disk — true for songs synced
/// via the local importer or downloaded over p2p), and an `Err` with
/// a structured `error_type` discriminant otherwise. spume callers
/// can introspect the error to decide whether to fall back to the
/// html `<audio>` path (which can stream remote http urls) on a
/// per-song basis.
#[tauri::command]
pub async fn resolve_blob_path(blob_id: String) -> Result<serde_json::Value, String> {
    let resp = grimoire::media_blobz::build_blob_path_response(&blob_id).await;
    match resp.data {
        Some(data) => Ok(data),
        None => {
            // surface the first error_type if available so the client
            // can branch on `no_local_path` vs `not_found` etc.
            let kind = resp
                .errors
                .first()
                .map(|e| e.error_type.clone())
                .unwrap_or_else(|| "unknown_error".to_string());
            Err(format!("{kind}: {}", resp.message))
        }
    }
}
