//! tauri commands + event bridge for the audio player.
//!
//! desktop-only. wraps whichever [`grimoire::player::PlayerController`]
//! impl is active (rodio or libmpv, picked per `use_libmpv_playback` -
//! see `get_or_init_global`) with two surfaces:
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
    spawn_libmpv_player, spawn_player, NoopPlayerController, PlayerCommand, PlayerController,
    RestartPolicy,
};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::OnceCell;
use tracing::{debug, warn};

/// the tauri event name spume listens on. keep in sync with
/// `client/spume/src/music/services/audio/backends/rodioBackend.ts`.
pub const PLAYER_EVENT: &str = "freqhole:player_event";

/// process-global player, behind a trait object so the concrete
/// backend (rodio vs. libmpv, picked at first use per
/// `FreqholeAppConfig::use_libmpv_playback`) can vary without any
/// other code in this file - or spume's `RodioBackend` TS client -
/// needing to know or care which one is live. lazily spawned on
/// first use from a tauri command (`player_send` / `player_init` /
/// `player_snapshot`).
///
/// having a single instance ensures every local-control command
/// drives the same audio device. clone the `Arc` freely.
static GLOBAL_PLAYER: OnceCell<Arc<dyn PlayerController>> = OnceCell::const_new();

/// get-or-init the process-global controller. safe to call from any
/// async context. **does not** wire the tauri event pump — that's
/// the responsibility of [`PlayerState::ensure_event_pump`] (which
/// needs an `AppHandle`).
///
/// picks libmpv when `use_libmpv_playback` is on (the "experimental
/// player" toggle - see `app_config.rs`), else rodio. a runtime failure
/// starting libmpv falls back to a silent no-op controller rather than
/// panicking - same "never fatal" posture `media_session.rs` already
/// takes for a missing platform media service.
async fn get_or_init_global(app: &AppHandle) -> Arc<dyn PlayerController> {
    GLOBAL_PLAYER
        .get_or_init(|| async {
            let use_libmpv = crate::app_config::FreqholeAppConfig::load(app)
                .map(|c| c.use_libmpv_playback)
                .unwrap_or_else(crate::app_config::default_use_libmpv_playback);
            if use_libmpv {
                return match spawn_libmpv_player() {
                    Ok(ctl) => Arc::new(ctl) as Arc<dyn PlayerController>,
                    Err(e) => {
                        warn!(error = %e, "failed to start libmpv audio backend; falling back to no-op");
                        Arc::new(NoopPlayerController::new()) as Arc<dyn PlayerController>
                    }
                };
            }
            let ctl = spawn_player(RestartPolicy::default());
            Arc::new(ctl) as Arc<dyn PlayerController>
        })
        .await
        .clone()
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
    async fn get_or_init(&self, app: &AppHandle) -> Arc<dyn PlayerController> {
        let arc = get_or_init_global(app).await;
        self.ensure_event_pump(app, &arc).await;
        arc
    }

    /// wire the broadcast subscriber → tauri emit pump exactly once.
    async fn ensure_event_pump(&self, app: &AppHandle, controller: &Arc<dyn PlayerController>) {
        let app = app.clone();
        let controller = controller.clone();
        self.pump_started
            .get_or_init(|| async move {
                spawn_event_pump(app, controller);
            })
            .await;
    }
}

/// background task: forward every [`PlayerEvent`] to the webview, and fold
/// play/pause/position/duration into the OS media session (see
/// `media_session.rs` - it has no other way to learn these, since neither
/// audio backend ever knows song metadata). `on_rodio_event`'s name
/// predates libmpv but the function itself only depends on the
/// backend-agnostic `PlayerEvent` wire format, so it works unchanged for
/// either backend. runs for the life of the app; aborts when its broadcast
/// receiver closes (which only happens when the controller is dropped,
/// which only happens at process exit).
fn spawn_event_pump(app: AppHandle, controller: Arc<dyn PlayerController>) {
    let mut rx = controller.subscribe();
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(ev) => {
                    crate::media_session::on_rodio_event(&app, &ev);
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
