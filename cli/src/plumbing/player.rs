//! `freqhole player` cli commands.
//!
//! the cli is the **player daemon** itself, not a remote controller.
//! `freqhole player daemon` spawns a supervised rodio backend, attaches
//! the `freqhole-player/1` ALPN to a fresh iroh endpoint, prints the
//! node id, and runs until Ctrl-C. remote admins can then drive
//! playback by connecting on that ALPN.
//!
//! for one-shot, locally-driven playback testing, use
//! `freqhole player play <path>...` — it spawns the same supervised
//! backend, queues the given paths, and blocks until playback ends
//! (or Ctrl-C). useful for "does my audio work?" sanity checks
//! without bringing up an iroh endpoint.
//!
//! to drive a *remote* daemon (running `freqhole player daemon` on
//! another machine, or charnel with `[remote_player].enabled = true`),
//! use `freqhole player ctl <node-id> <command>`. it dials the
//! `freqhole-player/1` ALPN, sends one command, optionally tails
//! events, then closes the connection.
//!
//! gated behind the `rodio-playback` cli feature (on by default).

use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use grimoire::error::ErrorDetail;
use grimoire::player::alpn::{read_frame, write_frame};
use grimoire::player::{
    spawn_player, PlayerCommand, PlayerController, PlayerEvent, PlayerProtocol, RestartPolicy,
    PLAYER_ALPN,
};
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tokio::signal;
use tracing::{info, warn};

#[derive(Subcommand)]
pub enum PlayerAction {
    /// run a player daemon: spawn rodio + register the
    /// `freqhole-player/1` ALPN. blocks until Ctrl-C.
    Daemon {
        /// don't start the iroh endpoint — just run the local rodio
        /// supervisor and idle. useful for local-only sanity tests.
        #[arg(long)]
        no_alpn: bool,
        /// print the iroh node id as `node_id=<hex>` on its own line
        /// after startup. useful for piping into other commands.
        #[arg(long)]
        print_node_id: bool,
    },
    /// queue paths and play them locally; block until ended or Ctrl-C.
    /// no iroh endpoint involved.
    Play {
        /// audio file paths to enqueue, in order.
        paths: Vec<String>,
    },
    /// remote-control a `freqhole player daemon` (or any peer that
    /// accepts `freqhole-player/1`). dials the peer, sends one
    /// command, then closes.
    Ctl {
        /// peer node id (64 hex chars).
        node_id: String,
        /// how long to keep the connection open after sending so we
        /// can tail event frames. zero closes immediately.
        #[arg(long, default_value = "1500")]
        tail_ms: u64,
        #[command(subcommand)]
        cmd: CtlCommand,
    },
}

#[derive(Subcommand, Clone)]
pub enum CtlCommand {
    /// load + play a list of file paths on the remote daemon.
    /// note: the remote must have access to those paths on its own
    /// filesystem; this does not stream audio.
    Load {
        /// audio file paths the remote should enqueue, in order.
        paths: Vec<String>,
    },
    /// resume playback.
    Play,
    /// pause playback.
    Pause,
    /// stop playback + clear the sink.
    Stop,
    /// skip to next track in the current queue.
    Next,
    /// skip to previous track.
    Previous,
    /// seek to absolute position (in ms) within the current track.
    Seek {
        /// position in milliseconds.
        ms: u64,
    },
    /// set output volume (0.0 = mute, 1.0 = unity, >1.0 amplifies).
    SetVolume {
        /// linear gain. clamp at the rodio side.
        v: f32,
    },
    /// request a fresh state event without changing anything.
    Status,
}

impl CtlCommand {
    fn into_wire(self) -> PlayerCommand {
        match self {
            CtlCommand::Load { paths } => PlayerCommand::Load { paths },
            CtlCommand::Play => PlayerCommand::Play,
            CtlCommand::Pause => PlayerCommand::Pause,
            CtlCommand::Stop => PlayerCommand::Stop,
            CtlCommand::Next => PlayerCommand::Next,
            CtlCommand::Previous => PlayerCommand::Previous,
            CtlCommand::Seek { ms } => PlayerCommand::Seek { ms },
            CtlCommand::SetVolume { v } => PlayerCommand::SetVolume { v },
            CtlCommand::Status => PlayerCommand::Status,
        }
    }
}

pub async fn handle_command(action: PlayerAction) -> CommandOutput<serde_json::Value> {
    match action {
        PlayerAction::Daemon {
            no_alpn,
            print_node_id,
        } => daemon(no_alpn, print_node_id).await,
        PlayerAction::Play { paths } => play_local(paths).await,
        PlayerAction::Ctl {
            node_id,
            tail_ms,
            cmd,
        } => ctl(node_id, tail_ms, cmd).await,
    }
}

/// `freqhole player daemon`
async fn daemon(no_alpn: bool, print_node_id: bool) -> CommandOutput<serde_json::Value> {
    info!("[player] starting daemon...");
    eprintln!("starting freqhole player daemon...");

    // 1. spawn the supervised rodio backend.
    let controller: Arc<dyn PlayerController> = Arc::new(spawn_player(RestartPolicy::default()));

    // 2. optionally bring up an iroh endpoint with `freqhole-player/1`.
    let mut endpoint_opt = None;
    let node_id_opt = if no_alpn {
        eprintln!("--no-alpn: skipping iroh endpoint setup");
        None
    } else {
        match grimoire::federation::transport::FederationEndpoint::new().await {
            Ok(mut endpoint) => {
                let node_id = endpoint.node_id().to_string();
                let proto = PlayerProtocol::new(controller.clone());
                if let Err(e) = endpoint
                    .start_router_with(|builder| builder.accept(PLAYER_ALPN, proto))
                    .await
                {
                    return CommandOutput::failure(
                        format!("failed to start player router: {e}"),
                        vec![ErrorDetail::from(e)],
                        serde_json::json!({ "node_id": node_id }),
                    );
                }
                info!("[player] router ready on freqhole-player/1");
                endpoint_opt = Some(endpoint);
                Some(node_id)
            }
            Err(e) => {
                return CommandOutput::failure(
                    format!("failed to create iroh endpoint: {e}"),
                    vec![ErrorDetail::from(e)],
                    serde_json::json!({}),
                );
            }
        }
    };

    eprintln!("player daemon ready");
    if let Some(ref nid) = node_id_opt {
        eprintln!("node_id: {nid}");
        if print_node_id {
            // single machine-parseable line on stdout.
            println!("node_id={nid}");
        }
    }
    eprintln!();
    eprintln!("press Ctrl+C to stop");

    // 3. spawn an event tap so the operator can see what's happening.
    spawn_event_tap(controller.clone());

    // 4. block until Ctrl-C.
    if let Err(e) = signal::ctrl_c().await {
        warn!("error waiting for shutdown signal: {e}");
    } else {
        info!("[player] received shutdown signal");
        eprintln!("\nshutting down...");
    }

    // 5. graceful shutdown.
    if let Err(e) = controller.send(PlayerCommand::Stop).await {
        warn!("[player] failed to send Stop on shutdown: {e}");
    }
    if let Some(endpoint) = endpoint_opt {
        endpoint.close().await;
    }
    info!("[player] daemon stopped");

    CommandOutput::success(
        "player daemon stopped",
        serde_json::json!({ "node_id": node_id_opt }),
    )
}

/// `freqhole player play <path>...`
async fn play_local(paths: Vec<String>) -> CommandOutput<serde_json::Value> {
    if paths.is_empty() {
        let msg = "no paths provided; pass one or more audio file paths";
        return CommandOutput::failure(
            msg.to_string(),
            vec![ErrorDetail::new("missing_paths", "Missing Paths", msg)],
            serde_json::json!({}),
        );
    }

    eprintln!(
        "starting local rodio playback ({} track(s))...",
        paths.len()
    );

    let controller: Arc<dyn PlayerController> = Arc::new(spawn_player(RestartPolicy::default()));
    let mut events = controller.subscribe();

    if let Err(e) = controller
        .send(PlayerCommand::Load {
            paths: paths.clone(),
        })
        .await
    {
        return CommandOutput::failure(
            format!("failed to send Load command: {e}"),
            vec![],
            serde_json::json!({}),
        );
    }

    eprintln!("press Ctrl+C to stop");

    // pump events until Ended, Error, or Ctrl-C.
    let pump = async {
        loop {
            match events.recv().await {
                Ok(PlayerEvent::TrackChanged { index, path }) => {
                    eprintln!("track [{index}]: {path}");
                }
                Ok(PlayerEvent::Ended) => {
                    eprintln!("playback ended.");
                    return Ok::<(), String>(());
                }
                Ok(PlayerEvent::Error { detail }) => {
                    // non-fatal per-track errors are common (skipped tracks);
                    // fatal errors will be followed by no further activity, so
                    // we surface them and keep waiting for Ended.
                    eprintln!(
                        "error: [{}] {} — {}",
                        detail.error_type, detail.title, detail.detail
                    );
                }
                Ok(PlayerEvent::BackendDown { restart_count }) => {
                    eprintln!("backend down (restart {restart_count})");
                }
                Ok(PlayerEvent::BackendUp) => {
                    eprintln!("backend up");
                }
                Ok(_) => { /* ignore state/progress noise on stdout */ }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    return Err("event stream closed unexpectedly".to_string());
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            }
        }
    };

    tokio::select! {
        r = pump => {
            if let Err(e) = r {
                return CommandOutput::failure(
                    format!("playback failed: {e}"),
                    vec![],
                    serde_json::json!({}),
                );
            }
        }
        _ = signal::ctrl_c() => {
            eprintln!("\nshutting down...");
            if let Err(e) = controller.send(PlayerCommand::Stop).await {
                warn!("[player] failed to send Stop on shutdown: {e}");
            }
        }
    }

    CommandOutput::success(
        "local playback finished",
        serde_json::json!({ "tracks": paths.len() }),
    )
}

/// background tap on the player's event stream. logs notable events
/// to stderr so the operator running `daemon` sees what's happening
/// without flipping on full debug logging.
fn spawn_event_tap(controller: Arc<dyn PlayerController>) {
    let mut rx = controller.subscribe();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(PlayerEvent::TrackChanged { index, path }) => {
                    eprintln!("[player] now playing [{index}]: {path}");
                }
                Ok(PlayerEvent::Error { detail }) => {
                    eprintln!(
                        "[player] error [{}] {}: {}",
                        detail.error_type, detail.title, detail.detail
                    );
                }
                Ok(PlayerEvent::BackendDown { restart_count }) => {
                    eprintln!("[player] backend down (restart {restart_count})");
                }
                Ok(PlayerEvent::BackendUp) => {
                    eprintln!("[player] backend up");
                }
                Ok(_) => { /* state + progress are too chatty for stderr */ }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            }
        }
    });
}

/// `freqhole player ctl <node-id> <command>`
///
/// dial the `freqhole-player/1` ALPN on the given peer, send one
/// command, optionally tail event frames for `tail_ms` ms, then close.
///
/// auth note: the remote will reject the command unless it has
/// `[federation.remote_player].enabled = true` and our node id is
/// either an admin user there or in the optional allowed-node-ids
/// list. see the 3-gate check in `grimoire/src/player/alpn.rs`.
async fn ctl(
    node_id_hex: String,
    tail_ms: u64,
    cmd: CtlCommand,
) -> CommandOutput<serde_json::Value> {
    use grimoire::federation::transport::{FederationEndpoint, IrohPublicKey};

    let peer = match IrohPublicKey::from_str(node_id_hex.trim()) {
        Ok(p) => p,
        Err(e) => {
            return CommandOutput::failure(
                format!("invalid node id: {e}"),
                vec![ErrorDetail {
                    error_type: "invalid_node_id".to_string(),
                    title: "Invalid Node Id".to_string(),
                    detail: format!("expected 64 hex chars, got: {node_id_hex} ({e})"),
                }],
                serde_json::json!({}),
            );
        }
    };

    info!("[player-ctl] building federation endpoint");
    let endpoint = match FederationEndpoint::new().await {
        Ok(e) => e,
        Err(e) => {
            return CommandOutput::failure(
                format!("failed to start endpoint: {e}"),
                vec![],
                serde_json::json!({}),
            );
        }
    };

    info!("[player-ctl] dialing peer {peer} on freqhole-player/1");
    let conn = match endpoint.connect_for_player(peer).await {
        Ok(c) => c,
        Err(e) => {
            return CommandOutput::failure(
                format!("failed to connect: {e}"),
                vec![ErrorDetail {
                    error_type: "connect_failed".to_string(),
                    title: "Connect Failed".to_string(),
                    detail: format!("could not dial {peer} on freqhole-player/1: {e}"),
                }],
                serde_json::json!({}),
            );
        }
    };

    let (mut send, mut recv) = match conn.open_bi().await {
        Ok(s) => s,
        Err(e) => {
            return CommandOutput::failure(
                format!("failed to open bi-stream: {e}"),
                vec![],
                serde_json::json!({}),
            );
        }
    };

    let wire = cmd.into_wire();
    info!("[player-ctl] sending command: {wire:?}");
    if let Err(e) = write_frame(&mut send, &wire).await {
        return CommandOutput::failure(
            format!("failed to write command frame: {e}"),
            vec![],
            serde_json::json!({}),
        );
    }
    // signal end-of-commands so the remote can flush events freely.
    if let Err(e) = send.finish() {
        warn!("[player-ctl] send.finish failed: {e}");
    }

    // tail events. we cap at `tail_ms` total wall time; the remote
    // may keep streaming progress indefinitely, so a deadline keeps
    // ctl one-shot. errors are surfaced but don't fail the command
    // since the send already succeeded.
    let mut events: Vec<serde_json::Value> = Vec::new();
    if tail_ms > 0 {
        let deadline = tokio::time::sleep(Duration::from_millis(tail_ms));
        tokio::pin!(deadline);
        loop {
            tokio::select! {
                _ = &mut deadline => break,
                frame = read_frame::<PlayerEvent>(&mut recv, 1024 * 1024) => {
                    match frame {
                        Ok(Some(ev)) => {
                            // surface on stderr so the json output stays clean.
                            eprintln!("[player-ctl] event: {ev:?}");
                            if let Ok(v) = serde_json::to_value(&ev) {
                                events.push(v);
                            }
                            // ended / error are natural stopping points.
                            if matches!(ev, PlayerEvent::Ended | PlayerEvent::Error { .. }) {
                                break;
                            }
                        }
                        Ok(None) => break,
                        Err(e) => {
                            warn!("[player-ctl] read_frame failed: {e}");
                            break;
                        }
                    }
                }
            }
        }
    }

    // best-effort close.
    conn.close(0u32.into(), b"ctl-done");
    endpoint.close().await;

    CommandOutput::success(
        "command sent",
        serde_json::json!({
            "node_id": node_id_hex,
            "events": events,
        }),
    )
}
