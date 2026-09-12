//! iroh endpoint/router startup + the `freqhole-player/1` alpn
//! protocol handler itself (pairing handshake, presence, subscribe,
//! and the control-command stream framing that hands each authorized
//! line off to `dispatch::dispatch_pairing_command`).

use iroh::endpoint::Connection;
use iroh::protocol::{AcceptError, ProtocolHandler};
use iroh::PublicKey;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{mpsc, oneshot};
use tracing::{info, warn};

use crate::ratcore::app::{
    pairing as portable, CommandAck, CommandAckReason, ConnectedControllerInfo, PairRequest,
    PairResponse, PairResponseReason, PairingCommand, PeerRole, PlayerSession,
    PresenceAnnouncement, PresenceState, TrustedController,
};

use super::state::{mark_connected, mark_disconnected, SharedPairingState};

// -------------------------------------------------------------------
// pairing dispatch request — the alpn handler's bridge onto rathole's
// real (LocalSet-bound, `!Send`) playback state. a dedicated channel
// rather than folding into `ratcore::app::AppAction`, since the reply
// side needs a `tokio::sync::oneshot::Sender` and `ratcore` itself
// must stay free of any tokio dependency (see its own module doc).
// -------------------------------------------------------------------

pub struct PairingDispatchRequest {
    pub command: PairingCommand,
    pub reply: oneshot::Sender<CommandAck>,
}

pub type PairingDispatchTx = mpsc::UnboundedSender<PairingDispatchRequest>;
pub type PairingDispatchRx = mpsc::UnboundedReceiver<PairingDispatchRequest>;

// -------------------------------------------------------------------
// runtime handle: bundles the shared state + dispatch channel, and
// lazily starts the actual iroh endpoint/router the first time it's
// needed (`--player` cli flag, or the `/player` slash command) rather
// than unconditionally on every rathole launch.
// -------------------------------------------------------------------

#[derive(Clone)]
pub struct PairingRuntime {
    pub state: SharedPairingState,
    pub dispatch_tx: PairingDispatchTx,
    started: std::rc::Rc<std::cell::Cell<bool>>,
    /// live `PlayerStatus` broadcast to every connected `subscribe`
    /// stream (see `handle_stream`'s subscribe arm) - a `watch` channel
    /// since subscribers only ever want the LATEST status, never a
    /// backlog. `run.rs`'s tick loop pushes a fresh status here every
    /// tick via `broadcast_status`.
    status_tx: tokio::sync::watch::Sender<portable::PlayerStatus>,
}

impl PairingRuntime {
    pub fn new(state: SharedPairingState, dispatch_tx: PairingDispatchTx) -> Self {
        let (status_tx, _) = tokio::sync::watch::channel(portable::PlayerStatus::Stopped {
            common: portable::StatusCommon {
                queue: Vec::new(),
                auto_download_enabled: false,
                volume: 1.0,
                recently_played: Vec::new(),
            },
        });
        Self {
            state,
            dispatch_tx,
            started: std::rc::Rc::new(std::cell::Cell::new(false)),
            status_tx,
        }
    }

    /// pushes `status` to every currently-subscribed controller -
    /// called every tick from `run.rs`'s main loop so a paired
    /// controller's queue/now-playing/position view stays live instead
    /// of only updating on its own poll interval.
    pub fn broadcast_status(&self, status: portable::PlayerStatus) {
        // `send` errors only when there are zero receivers (nothing
        // subscribed yet) - not a real failure, nothing to do about it.
        let _ = self.status_tx.send(status);
    }

    /// idempotent: spawns the `freqhole-player/1` endpoint/router on
    /// the first call, no-ops on later ones. safe to call from any
    /// entry point that can reach "pairing mode" (`--player`, `/player`).
    pub fn ensure_started(&self) {
        if self.started.replace(true) {
            return;
        }
        let state = self.state.clone();
        let dispatch_tx = self.dispatch_tx.clone();
        let status_tx = self.status_tx.clone();
        tokio::task::spawn_local(async move {
            match start_player_endpoint(state, dispatch_tx, status_tx).await {
                Ok(node_id) => info!(
                    target: "player_protocol",
                    node_id = %node_id,
                    "freqhole-player/1 endpoint started"
                ),
                Err(e) => {
                    warn!(target: "player_protocol", error = %e, "failed to start freqhole-player/1 endpoint")
                }
            }
        });
    }
}

/// build a native iroh endpoint (same construction grimoire's own p2p
/// serving uses) and register the `freqhole-player/1` alpn handler on
/// it, mirroring the `.accept(ALPN, Handler::new())` pattern used for
/// grimoire's own admin/events/freqhole protocols. returns this
/// device's node id (for the pairing qr) on success.
async fn start_player_endpoint(
    state: SharedPairingState,
    dispatch_tx: PairingDispatchTx,
    status_tx: tokio::sync::watch::Sender<portable::PlayerStatus>,
) -> Result<String, String> {
    let mut endpoint = grimoire::federation::transport::FederationEndpoint::new()
        .await
        .map_err(|e| e.to_string())?;
    let node_id = endpoint.node_id().to_string();
    {
        let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
        guard.node_id = Some(node_id.clone());
    }
    // registers this endpoint (+ initializes the iroh-blobs downloader) with
    // grimoire's p2p_client global state - without this, `media::
    // resolve_media_ref`'s `fetch_blob_verified_to_file` call fails with
    // "blobs downloader not initialized" for every queued item, since that
    // global is otherwise only ever set by the server/charnel startup paths
    // (see p2p_client.rs's own doc comment: "must be initialized via
    // set_federation_endpoint() before use").
    grimoire::federation::p2p_client::set_federation_endpoint(endpoint.endpoint());
    let handler = PlayerProtocol::new(state, dispatch_tx, status_tx);
    endpoint
        .start_router_with(|builder| builder.accept(super::PLAYER_ALPN, handler))
        .await
        .map_err(|e| e.to_string())?;
    // leak the endpoint deliberately: it must outlive this task for
    // the router to keep accepting connections, and rathole has no
    // "stop pairing mode" flow yet to hand a shutdown handle to.
    // tracked as a follow-up once that flow exists.
    std::mem::forget(endpoint);
    Ok(node_id)
}

// -------------------------------------------------------------------
// the alpn protocol handler itself.
// -------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct PlayerProtocol {
    state: SharedPairingState,
    dispatch_tx: PairingDispatchTx,
    status_tx: tokio::sync::watch::Sender<portable::PlayerStatus>,
}

impl PlayerProtocol {
    pub fn new(
        state: SharedPairingState,
        dispatch_tx: PairingDispatchTx,
        status_tx: tokio::sync::watch::Sender<portable::PlayerStatus>,
    ) -> Self {
        Self {
            state,
            dispatch_tx,
            status_tx,
        }
    }
}

impl ProtocolHandler for PlayerProtocol {
    async fn accept(&self, conn: Connection) -> std::result::Result<(), AcceptError> {
        let peer_id = conn.remote_id();
        info!(target: "player_protocol", peer = %peer_id, "accepted freqhole-player/1 connection");
        let state = self.state.clone();
        let dispatch_tx = self.dispatch_tx.clone();
        let status_tx = self.status_tx.clone();
        loop {
            match conn.accept_bi().await {
                Ok((send, recv)) => {
                    let state = state.clone();
                    let dispatch_tx = dispatch_tx.clone();
                    let status_tx = status_tx.clone();
                    tokio::spawn(async move {
                        if let Err(e) =
                            handle_stream(peer_id, send, recv, state, dispatch_tx, status_tx).await
                        {
                            warn!(target: "player_protocol", peer = %peer_id, error = %e, "stream error");
                        }
                    });
                }
                Err(e) => {
                    info!(target: "player_protocol", peer = %peer_id, error = %e, "connection closed");
                    break;
                }
            }
        }
        Ok(())
    }

    async fn shutdown(&self) {
        info!(target: "player_protocol", "shutting down");
    }
}

async fn write_line(send: &mut iroh::endpoint::SendStream, line: &str) -> Result<(), String> {
    let mut bytes = line.as_bytes().to_vec();
    bytes.push(b'\n');
    send.write_all(&bytes)
        .await
        .map_err(|e| format!("write failed: {e}"))
}

/// handle one bi-stream: pairing handshake, presence check, status
/// subscription, or a control-command loop — mirrors
/// `playerConnectionHandler.ts`'s `handleConnection` branch-by-first-
/// line shape exactly.
async fn handle_stream(
    peer_node_id: PublicKey,
    mut send: iroh::endpoint::SendStream,
    recv: iroh::endpoint::RecvStream,
    state: SharedPairingState,
    dispatch_tx: PairingDispatchTx,
    status_tx: tokio::sync::watch::Sender<portable::PlayerStatus>,
) -> Result<(), String> {
    let peer_id = peer_node_id.to_string();
    let mut reader = BufReader::new(recv);

    let mut line = String::new();
    let n = reader
        .read_line(&mut line)
        .await
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Ok(());
    }
    let first_line = line.trim_end().to_string();

    let Some(kind) = portable::peek_line_type(&first_line) else {
        return Ok(());
    };

    if kind == "pair_request" {
        handle_pair_request(&peer_id, &first_line, &state, &mut send).await?;
        // wait for the peer's clean close before tearing down our own
        // side - mirrors the ts handler's own comment on why (avoids
        // racing the flush with an immediate teardown).
        let mut buf = String::new();
        let _ = reader.read_line(&mut buf).await;
        return Ok(());
    }

    // anything else requires already being trusted.
    let trusted = {
        let guard = state.lock().unwrap_or_else(|p| p.into_inner());
        guard
            .trusted_controllers
            .iter()
            .find(|c| c.node_id == peer_id)
            .cloned()
    };
    let Some(controller) = trusted else {
        return Ok(());
    };

    if kind == "presence_query" {
        let msg = PresenceAnnouncement::new(PresenceState::Active);
        write_line(&mut send, &serde_json::to_string(&msg).unwrap()).await?;
        return Ok(());
    }

    let connected_info = ConnectedControllerInfo {
        node_id: peer_id.clone(),
        display_name: controller.display_name.clone(),
    };

    if kind == "subscribe" {
        // push-subscription session: read-only (no commands dispatched
        // on this stream) - registers presence, then pushes a
        // `PlayerStatusMessage` line every time `run.rs`'s tick loop
        // broadcasts a new one (`PairingRuntime::broadcast_status`),
        // for as long as the peer keeps the stream open. mirrors
        // cenotaph's `statusSubscribers.ts` push behavior.
        mark_connected(&state, connected_info);
        let mut status_rx = status_tx.subscribe();
        // send the current status immediately so a fresh subscriber
        // doesn't wait for the next tick's change to see anything.
        let initial = serde_json::to_string(&portable::PlayerStatusMessage::new(
            status_rx.borrow().clone(),
        ))
        .unwrap();
        if write_line(&mut send, &initial).await.is_err() {
            mark_disconnected(&state, &peer_id);
            return Ok(());
        }
        let mut buf = String::new();
        loop {
            tokio::select! {
                // detect the peer closing its end (or sending anything -
                // this stream is read-only from its point of view, any
                // read completing at all means either eof or a protocol
                // violation, both mean "stop pushing to this stream").
                _ = reader.read_line(&mut buf) => break,
                changed = status_rx.changed() => {
                    if changed.is_err() {
                        // sender side dropped (pairing endpoint shutting
                        // down) - nothing more to push.
                        break;
                    }
                    let msg = portable::PlayerStatusMessage::new(status_rx.borrow_and_update().clone());
                    if write_line(&mut send, &serde_json::to_string(&msg).unwrap()).await.is_err() {
                        break;
                    }
                }
            }
        }
        mark_disconnected(&state, &peer_id);
        return Ok(());
    }

    // control command loop.
    mark_connected(&state, connected_info);
    let result = command_loop(
        &peer_id,
        &controller,
        first_line,
        &mut reader,
        &mut send,
        &state,
        &dispatch_tx,
    )
    .await;
    mark_disconnected(&state, &peer_id);
    result
}

async fn handle_pair_request(
    peer_id: &str,
    raw: &str,
    state: &SharedPairingState,
    send: &mut iroh::endpoint::SendStream,
) -> Result<(), String> {
    let req: PairRequest = match serde_json::from_str(raw) {
        Ok(r) => r,
        Err(_) => {
            let resp = PairResponse::err(PairResponseReason::InvalidPin);
            return write_line(send, &serde_json::to_string(&resp).unwrap()).await;
        }
    };

    let response = {
        let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
        let mut session = PlayerSession::ensure_active(guard.session.take());
        if req.pin != session.pin {
            guard.session = Some(session);
            PairResponse::err(PairResponseReason::InvalidPin)
        } else {
            // first peer ever paired (or a pending one-time admin
            // grant) becomes admin; everyone else defaults to the
            // lowest-privilege role — same as pairingHandler.ts.
            let grants_admin = guard.trusted_controllers.is_empty() || session.admin_grant_pending;
            let role = if grants_admin {
                PeerRole::Admin
            } else {
                PeerRole::Viewer
            };
            if let Some(existing) = guard
                .trusted_controllers
                .iter_mut()
                .find(|c| c.node_id == peer_id)
            {
                existing.display_name = req.display_name.clone();
                existing.role = role;
            } else {
                guard.trusted_controllers.push(TrustedController {
                    node_id: peer_id.to_string(),
                    display_name: req.display_name.clone(),
                    role,
                    paired_at: super::now_ms(),
                });
            }
            session.join(peer_id);
            if grants_admin {
                // the admin-bootstrap pin is a one-time registration
                // code - mint a fresh, non-admin pin so regular users
                // get a distinct code to join with.
                session.regenerate_session_pin();
            }
            guard.session = Some(session);
            PairResponse::ok()
        }
    };
    write_line(send, &serde_json::to_string(&response).unwrap()).await
}

pub(super) fn is_get_status_line(raw: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|v| v.get("command").and_then(|c| c.as_str()).map(String::from))
        .is_some_and(|c| c == "get_status")
}

async fn command_loop(
    peer_id: &str,
    controller: &TrustedController,
    first_line: String,
    reader: &mut BufReader<iroh::endpoint::RecvStream>,
    send: &mut iroh::endpoint::SendStream,
    state: &SharedPairingState,
    dispatch_tx: &PairingDispatchTx,
) -> Result<(), String> {
    let mut current = Some(first_line);
    while let Some(raw) = current.take() {
        let ack = process_command_line(peer_id, controller, &raw, state, dispatch_tx).await;
        write_line(send, &serde_json::to_string(&ack).unwrap()).await?;

        let mut buf = String::new();
        match reader.read_line(&mut buf).await {
            Ok(0) => break,
            Err(_) => break,
            Ok(_) => current = Some(buf.trim_end().to_string()),
        }
    }
    Ok(())
}

async fn process_command_line(
    peer_id: &str,
    controller: &TrustedController,
    raw: &str,
    state: &SharedPairingState,
    dispatch_tx: &PairingDispatchTx,
) -> CommandAck {
    let allowed = {
        let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
        let mut session = PlayerSession::ensure_active(guard.session.take());
        let ok = is_get_status_line(raw) || session.is_peer_allowed(peer_id, Some(controller.role));
        if ok {
            session.touch();
        }
        guard.session = Some(session);
        ok
    };
    if !allowed {
        return CommandAck::err(CommandAckReason::NotInSession);
    }

    let command: PairingCommand = match serde_json::from_str(raw) {
        Ok(c) => c,
        Err(e) => {
            warn!(target: "player_protocol", error = %e, "failed to parse control command");
            return CommandAck::err(CommandAckReason::InvalidCommand);
        }
    };

    let (reply_tx, reply_rx) = oneshot::channel();
    if dispatch_tx
        .send(PairingDispatchRequest {
            command,
            reply: reply_tx,
        })
        .is_err()
    {
        return CommandAck::err(CommandAckReason::InvalidCommand);
    }
    reply_rx
        .await
        .unwrap_or_else(|_| CommandAck::err(CommandAckReason::InvalidCommand))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_get_status_line_detects_the_command() {
        assert!(is_get_status_line(
            r#"{"type":"control","command":"get_status"}"#
        ));
        assert!(!is_get_status_line(
            r#"{"type":"control","command":"stop"}"#
        ));
        assert!(!is_get_status_line("not json"));
    }
}
