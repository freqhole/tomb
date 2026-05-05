//! supervised rodio backend.
//!
//! [`spawn_player`] is the public entry point. it wires up:
//!
//! - an mpsc command channel (frontend → audio thread)
//! - a broadcast event channel (audio thread → many subscribers)
//! - a snapshot mirror updated by a tokio task that listens to the
//!   same events
//! - a watchdog tokio task that detects unexpected audio-thread
//!   exits, emits [`PlayerEvent::BackendDown`], and restarts per the
//!   [`RestartPolicy`]
//!
//! the returned [`PlayerController`] handle is `Arc`-clonable and
//! safe to share across frontends (tauri commands, iroh ALPN
//! handler, cli daemon).
//!
//! gated behind the `rodio-playback` cargo feature.

use std::sync::{mpsc as std_mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use tokio::sync::{broadcast, mpsc as tokio_mpsc};
use tokio::task::JoinHandle;
use tracing::{debug, error, info, warn};

use crate::error::{ErrorDetail, GrimoireError, GrimoireResult};
use crate::player::control::{PlayerCommand, PlayerEvent, PlayerSnapshot, RestartPolicy};
use crate::player::PlayerController;

use super::rodio as rodio_backend;

/// broadcast channel capacity. event consumers that lag past this
/// window will see a `RecvError::Lagged`; callers can resubscribe.
const EVENT_CHANNEL_CAPACITY: usize = 256;

/// command channel capacity (tokio side). small because real workloads
/// produce one command per ui interaction.
const COMMAND_CHANNEL_CAPACITY: usize = 32;

/// public handle. clone freely.
#[derive(Clone)]
pub struct RodioController {
    inner: Arc<Inner>,
}

struct Inner {
    cmd_tx: tokio_mpsc::Sender<PlayerCommand>,
    events: broadcast::Sender<PlayerEvent>,
    snapshot: Arc<Mutex<PlayerSnapshot>>,
    /// kept alive so the watchdog + bridge tasks aren't dropped.
    /// abort handles for shutdown via `Drop`.
    _watchdog: JoinHandle<()>,
    _snapshot_pump: JoinHandle<()>,
    _bridge: JoinHandle<()>,
}

impl Drop for Inner {
    fn drop(&mut self) {
        self._watchdog.abort();
        self._snapshot_pump.abort();
        self._bridge.abort();
    }
}

/// shared, swappable handle to the std-mpsc sender that pushes
/// commands into the audio thread. the supervisor replaces this on
/// every restart so the bridge always forwards into the live thread.
type SharedStdTx = Arc<Mutex<Option<std_mpsc::Sender<PlayerCommand>>>>;

/// spawn a fully-supervised rodio player.
///
/// must be called from inside a tokio runtime. the returned handle
/// can be cloned and shared across frontends.
pub fn spawn_player(policy: RestartPolicy) -> RodioController {
    let (cmd_tx, cmd_rx) = tokio_mpsc::channel::<PlayerCommand>(COMMAND_CHANNEL_CAPACITY);
    let (events, _) = broadcast::channel::<PlayerEvent>(EVENT_CHANNEL_CAPACITY);

    // shared std sender — supervisor populates it before each spawn,
    // bridge reads it for each forward.
    let shared_std_tx: SharedStdTx = Arc::new(Mutex::new(None));

    // bridge: tokio mpsc → std mpsc (via the shared swappable sender).
    let bridge = tokio::spawn(bridge_commands(
        cmd_rx,
        shared_std_tx.clone(),
        events.clone(),
    ));

    // watchdog: spawn the audio thread, watch for unexpected exit,
    // restart per policy.
    let watchdog = tokio::spawn(supervise(shared_std_tx, events.clone(), policy));

    // snapshot pump: maintain a cheap last-known state.
    let snapshot = Arc::new(Mutex::new(PlayerSnapshot::default()));
    let snapshot_pump = tokio::spawn(pump_snapshot(events.subscribe(), snapshot.clone()));

    RodioController {
        inner: Arc::new(Inner {
            cmd_tx,
            events,
            snapshot,
            _watchdog: watchdog,
            _snapshot_pump: snapshot_pump,
            _bridge: bridge,
        }),
    }
}

/// forward each tokio mpsc command to the std mpsc the audio thread
/// consumes. emits a structured error if forwarding fails (e.g. the
/// audio thread is between restart attempts and the std rx is gone).
async fn bridge_commands(
    mut rx: tokio_mpsc::Receiver<PlayerCommand>,
    shared_std_tx: SharedStdTx,
    events: broadcast::Sender<PlayerEvent>,
) {
    while let Some(cmd) = rx.recv().await {
        let send_result = {
            let guard = match shared_std_tx.lock() {
                Ok(g) => g,
                Err(_) => {
                    warn!("rodio bridge: shared sender mutex poisoned; dropping command");
                    continue;
                }
            };
            match guard.as_ref() {
                Some(tx) => tx.send(cmd).map_err(|_| ()),
                None => Err(()),
            }
        };
        if send_result.is_err() {
            let _ = events.send(PlayerEvent::Error {
                detail: ErrorDetail::new(
                    "command_forward_failed",
                    "Command Forward Failed",
                    "audio thread is not running; command dropped".to_string(),
                ),
            });
        }
    }
    debug!("rodio bridge: command sender closed; bridge exiting");
}

/// supervise the audio thread. each iteration:
///
/// 1. create a fresh std command channel and publish the sender into
///    the shared cell so the bridge starts forwarding to the new
///    thread.
/// 2. spawn the rodio thread; emit [`PlayerEvent::BackendUp`].
/// 3. wait for the join handle to complete.
/// 4. clean exit (channel hung up) is treated as deliberate shutdown.
/// 5. on crash, emit [`PlayerEvent::BackendDown { restart_count }`],
///    apply exponential backoff per [`RestartPolicy`], loop.
/// 6. give up after `max_restarts` failures inside `window_ms`; emit
///    a terminal `audio_supervisor_gave_up` error and exit.
async fn supervise(
    shared_std_tx: SharedStdTx,
    events: broadcast::Sender<PlayerEvent>,
    policy: RestartPolicy,
) {
    let mut restart_count: u32 = 0;
    let mut window_start = Instant::now();
    let mut backoff_ms = policy.initial_backoff_ms;

    loop {
        // create a fresh channel and publish the sender.
        let (std_tx, std_rx) = std_mpsc::channel::<PlayerCommand>();
        if let Ok(mut guard) = shared_std_tx.lock() {
            *guard = Some(std_tx);
        } else {
            error!("rodio supervisor: shared sender mutex poisoned; aborting");
            return;
        }

        // spawn the audio thread.
        let events_for_thread = events.clone();
        let join_handle = match rodio_backend::spawn(std_rx, events_for_thread) {
            Ok(h) => h,
            Err(e) => {
                let _ = events.send(PlayerEvent::Error {
                    detail: ErrorDetail::new(
                        "audio_thread_spawn_failed",
                        "Audio Thread Spawn Failed",
                        e.to_string(),
                    ),
                });
                return;
            }
        };

        let _ = events.send(PlayerEvent::BackendUp);

        // wait for the thread to exit. thread::JoinHandle::join blocks,
        // so jump to a blocking task to avoid blocking the runtime.
        let join_result = tokio::task::spawn_blocking(move || join_handle.join())
            .await
            .map_err(|e| format!("join task panicked: {e}"));

        // clear the shared sender so the bridge surfaces command_forward_failed
        // for anything that tries to send during the restart window.
        if let Ok(mut guard) = shared_std_tx.lock() {
            *guard = None;
        }

        match join_result {
            Ok(Ok(())) => {
                info!("rodio supervisor: audio thread exited cleanly; shutting down");
                return;
            }
            Ok(Err(panic_payload)) => {
                let msg = panic_message(&panic_payload);
                error!("rodio supervisor: audio thread panicked: {msg}");
            }
            Err(e) => {
                error!("rodio supervisor: join failed: {e}");
            }
        }

        // apply restart policy.
        if window_start.elapsed() > Duration::from_millis(policy.window_ms) {
            window_start = Instant::now();
            restart_count = 0;
            backoff_ms = policy.initial_backoff_ms;
        }
        restart_count = restart_count.saturating_add(1);
        let _ = events.send(PlayerEvent::BackendDown { restart_count });

        if restart_count > policy.max_restarts {
            error!(
                "rodio supervisor: exceeded {} restarts in {}ms; giving up",
                policy.max_restarts, policy.window_ms
            );
            let _ = events.send(PlayerEvent::Error {
                detail: ErrorDetail::new(
                    "audio_supervisor_gave_up",
                    "Audio Supervisor Gave Up",
                    format!(
                        "exceeded {} restarts in {}ms",
                        policy.max_restarts, policy.window_ms
                    ),
                ),
            });
            return;
        }

        debug!("rodio supervisor: restarting in {backoff_ms}ms (attempt {restart_count})");
        tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
        backoff_ms = (backoff_ms.saturating_mul(2)).min(policy.max_backoff_ms);
    }
}

/// extract a human-readable message from a panic payload.
fn panic_message(payload: &Box<dyn std::any::Any + Send + 'static>) -> String {
    if let Some(s) = payload.downcast_ref::<&'static str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "<non-string panic payload>".to_string()
    }
}

/// tokio task that updates the snapshot mirror as events arrive.
async fn pump_snapshot(
    mut rx: broadcast::Receiver<PlayerEvent>,
    snapshot: Arc<Mutex<PlayerSnapshot>>,
) {
    loop {
        match rx.recv().await {
            Ok(ev) => {
                if let Ok(mut snap) = snapshot.lock() {
                    snap.apply(&ev);
                }
            }
            Err(broadcast::error::RecvError::Closed) => return,
            Err(broadcast::error::RecvError::Lagged(n)) => {
                debug!("snapshot pump lagged by {n} events; continuing");
            }
        }
    }
}

#[async_trait]
impl PlayerController for RodioController {
    async fn send(&self, cmd: PlayerCommand) -> GrimoireResult<()> {
        self.inner
            .cmd_tx
            .send(cmd)
            .await
            .map_err(|_| GrimoireError::ProcessingFailed {
                message: "player command channel closed".to_string(),
            })
    }

    fn subscribe(&self) -> broadcast::Receiver<PlayerEvent> {
        self.inner.events.subscribe()
    }

    fn snapshot(&self) -> PlayerSnapshot {
        self.inner
            .snapshot
            .lock()
            .map(|s| s.clone())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    /// supervisor must spawn and emit `BackendUp`. headless ci that
    /// can't open a default audio device will additionally emit an
    /// `audio_device_open_failed` error — that's fine; we only assert
    /// `BackendUp` arrives because the supervisor emits it before the
    /// audio thread tries to open the device.
    #[tokio::test]
    async fn supervisor_emits_backend_up() {
        let ctl = spawn_player(RestartPolicy::default());
        let mut rx = ctl.subscribe();
        let mut got_up = false;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
        while tokio::time::Instant::now() < deadline {
            match tokio::time::timeout(Duration::from_millis(200), rx.recv()).await {
                Ok(Ok(PlayerEvent::BackendUp)) => {
                    got_up = true;
                    break;
                }
                Ok(Ok(_)) => continue,
                Ok(Err(_)) => break,
                Err(_) => continue,
            }
        }
        assert!(got_up, "supervisor never emitted BackendUp");
    }

    /// snapshot is queryable immediately after spawn.
    #[tokio::test]
    async fn snapshot_is_queryable() {
        let ctl = spawn_player(RestartPolicy::default());
        let snap = ctl.snapshot();
        assert_eq!(snap.queue_len, 0);
    }
}
