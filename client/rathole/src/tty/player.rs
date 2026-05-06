//! rodio-backed `MusicPlayer` impl for the tty shell. wraps
//! grimoire's player supervisor and resolves `media_blob_id`s to
//! filesystem paths via grimoire's media_blobz service.
//!
//! events from the player are forwarded onto the app's `AppAction`
//! channel as [`AppAction::MusicEvent`] so the music view can react
//! (state changes, progress ticks, errors).

use async_trait::async_trait;
use grimoire::player::{
    spawn_player, PlayerCommand, PlayerController, PlayerEvent, PlayerState as GrimoirePlayerState,
    RestartPolicy, RodioController,
};
use std::rc::Rc;
use tokio::sync::mpsc;

use crate::ratcore::app::{AppAction, MusicEvent, PlayerState};
use crate::ratcore::transport::{MusicPlayer, PlayerCmd};

/// rodio player wired into rathole. construct once at shell start;
/// it spawns a background task that pumps `PlayerEvent`s onto
/// `action_tx` so the ui sees them.
pub struct RodioPlayer {
    controller: RodioController,
}

impl RodioPlayer {
    /// spawn the rodio backend and a forwarding task that converts
    /// `grimoire::player::PlayerEvent` -> `AppAction::MusicEvent`.
    pub fn spawn(action_tx: mpsc::UnboundedSender<AppAction>) -> Rc<Self> {
        let controller = spawn_player(RestartPolicy::default());
        let mut events = controller.subscribe();
        // forward events; on the LocalSet so we don't need Send.
        tokio::task::spawn_local(async move {
            loop {
                match events.recv().await {
                    Ok(ev) => {
                        if let Some(mapped) = map_event(ev) {
                            if action_tx.send(AppAction::MusicEvent(mapped)).is_err() {
                                return;
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        // skipped some progress ticks; not fatal.
                        continue;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                }
            }
        });
        Rc::new(Self { controller })
    }
}

fn map_state(s: GrimoirePlayerState) -> PlayerState {
    match s {
        GrimoirePlayerState::Stopped => PlayerState::Stopped,
        GrimoirePlayerState::Loading => PlayerState::Loading,
        GrimoirePlayerState::Playing => PlayerState::Playing,
        GrimoirePlayerState::Paused => PlayerState::Paused,
    }
}

fn map_event(ev: PlayerEvent) -> Option<MusicEvent> {
    Some(match ev {
        PlayerEvent::State { state } => MusicEvent::State(map_state(state)),
        PlayerEvent::Progress { ms, total_ms } => MusicEvent::Progress { ms, total_ms },
        PlayerEvent::TrackChanged { index, path } => MusicEvent::TrackChanged {
            index: index as usize,
            path,
        },
        PlayerEvent::Ended => MusicEvent::Ended,
        PlayerEvent::Error { detail } => MusicEvent::Error(detail.detail),
        // backend lifecycle events are noisy; surface as state-ish.
        PlayerEvent::BackendDown { .. } | PlayerEvent::BackendUp => return None,
    })
}

#[async_trait(?Send)]
impl MusicPlayer for RodioPlayer {
    async fn send(&self, cmd: PlayerCmd) -> Result<(), String> {
        let mapped = match cmd {
            PlayerCmd::Load(paths) => PlayerCommand::Load { paths },
            PlayerCmd::Enqueue(_) => {
                // tty rodio backend doesn't support progressive
                // enqueueing yet; the initial Load already contains
                // the full queue (tty resolves all paths up-front).
                return Ok(());
            }
            PlayerCmd::Play => PlayerCommand::Play,
            PlayerCmd::Pause => PlayerCommand::Pause,
            PlayerCmd::Stop => PlayerCommand::Stop,
            PlayerCmd::Next => PlayerCommand::Next,
            PlayerCmd::Previous => PlayerCommand::Previous,
            PlayerCmd::Seek(ms) => PlayerCommand::Seek { ms },
            PlayerCmd::SetVolume(v) => PlayerCommand::SetVolume { v },
        };
        self.controller
            .send(mapped)
            .await
            .map_err(|e| e.to_string())
    }
}

/// resolve a list of `media_blob_id`s to local filesystem paths via
/// grimoire's media_blobz service. ids without a `local_path` are
/// skipped (rodio needs files on disk; in-memory bytes aren't
/// supported by grimoire's player today).
pub async fn resolve_paths(blob_ids: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(blob_ids.len());
    for id in blob_ids {
        match grimoire::media_blobz::get_media_blob_with_data(id).await {
            Ok((blob, _)) => {
                if let Some(path) = blob.local_path {
                    out.push(path);
                }
            }
            Err(e) => {
                tracing::warn!("media_blob {} resolve failed: {}", id, e);
            }
        }
    }
    out
}
