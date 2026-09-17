//! iroh accept-loop for the `freqhole-player/1` ALPN: pairing handshake,
//! presence, subscribe, and the control-command stream framing that
//! hands each authorized line off to a consumer-supplied dispatch
//! channel.
//!
//! deliberately consumer-agnostic: this module never touches an actual
//! playback backend (rodio, mpv, tauri events, ...) - it only knows how
//! to authenticate/authorize a peer (via `crate::users::UserService`)
//! and frame the wire protocol. an authorized `PlayerCommand` is handed
//! to whichever consumer owns the other end of `PairingDispatchTx`
//! (rathole's own rodio/mpv dispatch, or charnel's tauri-event dispatch),
//! which replies with a `CommandAck` via the paired oneshot channel.

use iroh::endpoint::Connection;
use iroh::protocol::{AcceptError, ProtocolHandler};
use iroh::PublicKey;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{mpsc, oneshot};
use tracing::{debug, info, warn};

use super::state::{self, SharedPairingState};
use super::wire::{
    self, command_summary, CommandAck, CommandAckReason, ConnectedControllerInfo, PairRequest,
    PairResponse, PairResponseReason, PeerRole, PlayerCommand, PlayerStatus, PresenceAnnouncement,
    PresenceState,
};
use crate::federation::transport::FederationEndpoint;

/// ALPN identifier for the `freqhole-player/1` pairing/control protocol.
pub const PLAYER_ALPN: &[u8] = b"freqhole-player/1";

// -------------------------------------------------------------------
// pairing dispatch request - the alpn handler's bridge onto a
// consumer's real (possibly `!Send`) playback state. a dedicated
// channel rather than a direct call, since the reply side needs a
// `tokio::sync::oneshot::Sender` and the consumer's own event loop may
// not be reachable synchronously from a spawned task.
// -------------------------------------------------------------------

pub struct PairingDispatchRequest {
    /// iroh node id of the peer that sent `command` - lets a consumer
    /// (e.g. charnel's accept bridge) mark that controller as currently
    /// connected, same as the wasm/browser accept path already does per
    /// stream (see `connectedControllers.ts`'s doc comment for why a
    /// dial-per-command transport still works fine with a grace period).
    pub peer_id: String,
    pub command: PlayerCommand,
    pub reply: oneshot::Sender<CommandAck>,
}

pub type PairingDispatchTx = mpsc::UnboundedSender<PairingDispatchRequest>;
pub type PairingDispatchRx = mpsc::UnboundedReceiver<PairingDispatchRequest>;

// -------------------------------------------------------------------
// runtime handle: bundles the shared state + dispatch channel, and
// lazily starts the actual iroh endpoint/router the first time it's
// needed rather than unconditionally on every launch.
// -------------------------------------------------------------------

#[derive(Clone)]
pub struct PairingRuntime {
    pub state: SharedPairingState,
    pub dispatch_tx: PairingDispatchTx,
    started: std::sync::Arc<std::sync::atomic::AtomicBool>,
    /// live `PlayerStatus` broadcast to every connected `subscribe`
    /// stream - a `watch` channel since subscribers only ever want the
    /// LATEST status, never a backlog. the consumer's own tick/event
    /// loop pushes a fresh status here via `broadcast_status`.
    status_tx: tokio::sync::watch::Sender<PlayerStatus>,
}

impl PairingRuntime {
    pub fn new(state: SharedPairingState, dispatch_tx: PairingDispatchTx) -> Self {
        let (status_tx, _) = tokio::sync::watch::channel(PlayerStatus::Stopped {
            common: wire::StatusCommon {
                queue: Vec::new(),
                auto_download_enabled: false,
                volume: 1.0,
                recently_played: Vec::new(),
                unresolved_items: Vec::new(),
            },
        });
        Self {
            state,
            dispatch_tx,
            started: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            status_tx,
        }
    }

    /// pushes `status` to every currently-subscribed controller - called
    /// on every tick/update from the consumer's own event loop so a
    /// paired controller's queue/now-playing/position view stays live
    /// instead of only updating on its own poll interval.
    pub fn broadcast_status(&self, status: PlayerStatus) {
        // `send` errors only when there are zero receivers (nothing
        // subscribed yet) - not a real failure, nothing to do about it.
        let _ = self.status_tx.send(status);
    }

    /// idempotent: spawns the `freqhole-player/1` endpoint/router on the
    /// first call, no-ops on later ones. safe to call from any entry
    /// point that can reach "pairing mode" (a cli flag, a settings
    /// toggle, ...). the caller's async runtime must be able to spawn a
    /// task that outlives this call (`tokio::spawn`, not
    /// `spawn_local` - unlike the original rathole-only implementation,
    /// this is consumer-agnostic and must not assume a `LocalSet`).
    pub fn ensure_started(&self) {
        if self.started.swap(true, std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        let state = self.state.clone();
        let dispatch_tx = self.dispatch_tx.clone();
        let status_tx = self.status_tx.clone();
        tokio::spawn(async move {
            match start_player_endpoint(state, dispatch_tx, status_tx).await {
                Ok(node_id) => info!(
                    target: "cenotaph",
                    node_id = %node_id,
                    "freqhole-player/1 endpoint started"
                ),
                Err(e) => {
                    warn!(target: "cenotaph", error = %e, "failed to start freqhole-player/1 endpoint")
                }
            }
        });
    }
}

/// build a native iroh endpoint (same construction grimoire's own p2p
/// serving uses) and register the `freqhole-player/1` alpn handler on
/// it. returns this device's node id (for the pairing qr) on success.
async fn start_player_endpoint(
    state: SharedPairingState,
    dispatch_tx: PairingDispatchTx,
    status_tx: tokio::sync::watch::Sender<PlayerStatus>,
) -> Result<String, String> {
    let mut endpoint = FederationEndpoint::new().await.map_err(|e| e.to_string())?;
    let node_id = endpoint.node_id().to_string();
    {
        let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
        guard.node_id = Some(node_id.clone());
    }
    // registers this endpoint (+ initializes the iroh-blobs downloader)
    // with grimoire's p2p_client global state - without this, a queued
    // item's own pull-from-peer call fails with "blobs downloader not
    // initialized" (see `p2p_client.rs`'s own doc comment).
    crate::federation::p2p_client::set_federation_endpoint(endpoint.endpoint());
    let handler = PlayerProtocol::new(state, dispatch_tx, status_tx);
    endpoint
        .start_router_with(|builder| builder.accept(PLAYER_ALPN, handler))
        .await
        .map_err(|e| e.to_string())?;
    // leak the endpoint deliberately: it must outlive this task for the
    // router to keep accepting connections, and there's no "stop pairing
    // mode" flow yet to hand a shutdown handle to.
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
    status_tx: tokio::sync::watch::Sender<PlayerStatus>,
}

impl PlayerProtocol {
    pub fn new(
        state: SharedPairingState,
        dispatch_tx: PairingDispatchTx,
        status_tx: tokio::sync::watch::Sender<PlayerStatus>,
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
        // the ALPN handler is now always attached (see charnel's
        // p2p_commands.rs) - checking the live config value here, per
        // connection, is what actually lets `[player_pairing].enabled`
        // be toggled on/off without a router rebuild/app restart. reject
        // outright (no handshake at all) when disabled, same as the
        // browser cenotaph accept loop's `isEnabled()` gate.
        if !crate::config::get_config().player_pairing.enabled {
            return Ok(());
        }
        let peer_id = conn.remote_id();
        info!(target: "cenotaph", peer = %peer_id, "accepted freqhole-player/1 connection");
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
                            warn!(target: "cenotaph", peer = %peer_id, error = %e, "stream error");
                        }
                    });
                }
                Err(e) => {
                    info!(target: "cenotaph", peer = %peer_id, error = %e, "connection closed");
                    break;
                }
            }
        }
        Ok(())
    }

    async fn shutdown(&self) {
        info!(target: "cenotaph", "shutting down");
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
/// subscription, or a control-command loop.
async fn handle_stream(
    peer_node_id: PublicKey,
    mut send: iroh::endpoint::SendStream,
    recv: iroh::endpoint::RecvStream,
    state: SharedPairingState,
    dispatch_tx: PairingDispatchTx,
    status_tx: tokio::sync::watch::Sender<PlayerStatus>,
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

    let Some(kind) = wire::peek_line_type(&first_line) else {
        warn!(target: "cenotaph", peer = %peer_id, line = %first_line, "received unparseable first line on stream, closing");
        return Ok(());
    };
    info!(target: "cenotaph", peer = %peer_id, kind = %kind, "handle_stream: dispatching on first-line kind");

    if kind == "pair_request" {
        handle_pair_request(&peer_id, &first_line, &state, &mut send).await?;
        // wait for the peer's clean close before tearing down our own
        // side (avoids racing the flush with an immediate teardown).
        let mut buf = String::new();
        let _ = reader.read_line(&mut buf).await;
        return Ok(());
    }

    // anything else requires already being trusted - a live grimoire
    // query every time (matches `federation::resolver::is_known_peer`'s
    // own "fresh query every connection, no cache" precedent).
    let user_resp = crate::users::UserService::new()
        .get_user_by_peer_node_id(&peer_id)
        .await;
    debug!(
        target: "cenotaph",
        peer = %peer_id,
        kind = %kind,
        success = user_resp.success,
        user = ?user_resp.data.as_ref().map(|u| (&u.id, &u.username, &u.role)),
        "get_user_by_peer_node_id"
    );
    let Some(user) = user_resp.data.filter(|_| user_resp.success) else {
        warn!(
            target: "cenotaph",
            peer = %peer_id,
            kind = %kind,
            "peer not found in grimoire's peer nodes - ignoring stream (needs to pair again?)"
        );
        return Ok(());
    };
    let role = wire::user_role_to_peer_role(user.role);
    let display_name = user.username.clone();

    if kind == "presence_query" {
        let access = {
            let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
            let session = wire::PlayerSession::ensure_active(guard.session.take());
            let access = session.access_status(&peer_id, role);
            guard.session = Some(session);
            access
        };
        debug!(target: "cenotaph", peer = %peer_id, role = ?role, access = ?access, "presence_query access");
        let msg = PresenceAnnouncement::for_caller(PresenceState::Active, access);
        write_line(&mut send, &serde_json::to_string(&msg).unwrap()).await?;
        return Ok(());
    }

    let connected_info = ConnectedControllerInfo {
        node_id: peer_id.clone(),
        display_name: display_name.clone(),
    };

    if kind == "subscribe" {
        // push-subscription session: read-only (no commands dispatched
        // on this stream) - registers presence, then pushes a
        // `PlayerStatusMessage` line every time the consumer broadcasts a
        // new one, for as long as the peer keeps the stream open.
        state::mark_connected(&state, connected_info);
        let mut status_rx = status_tx.subscribe();
        // send the current status immediately so a fresh subscriber
        // doesn't wait for the next update to see anything.
        let initial =
            serde_json::to_string(&wire::PlayerStatusMessage::new(status_rx.borrow().clone()))
                .unwrap();
        if let Err(e) = write_line(&mut send, &initial).await {
            warn!(target: "cenotaph", peer = %peer_id, error = %e, "subscribe stream: failed to write initial status, closing");
            state::mark_disconnected(&state, &peer_id);
            return Ok(());
        }
        info!(target: "cenotaph", peer = %peer_id, "subscribe stream: initial status sent, entering push loop");
        let mut buf = String::new();
        loop {
            tokio::select! {
                // detect the peer closing its end (or sending anything -
                // this stream is read-only from its point of view, any
                // read completing at all means either eof or a protocol
                // violation, both mean "stop pushing to this stream").
                _ = reader.read_line(&mut buf) => {
                    info!(target: "cenotaph", peer = %peer_id, "subscribe stream: peer read completed (eof/closed), stopping push loop");
                    break;
                }
                changed = status_rx.changed() => {
                    if changed.is_err() {
                        // sender side dropped (endpoint shutting down) -
                        // nothing more to push.
                        info!(target: "cenotaph", peer = %peer_id, "subscribe stream: status broadcaster dropped, stopping push loop");
                        break;
                    }
                    let msg = wire::PlayerStatusMessage::new(status_rx.borrow_and_update().clone());
                    if write_line(&mut send, &serde_json::to_string(&msg).unwrap()).await.is_err() {
                        info!(target: "cenotaph", peer = %peer_id, "subscribe stream: write_line failed, stopping push loop");
                        break;
                    }
                }
            }
        }
        state::mark_disconnected(&state, &peer_id);
        return Ok(());
    }

    // control command loop.
    state::mark_connected(&state, connected_info);
    let result = command_loop(
        &peer_id,
        role,
        first_line,
        &mut reader,
        &mut send,
        &state,
        &dispatch_tx,
    )
    .await;
    state::mark_disconnected(&state, &peer_id);
    result
}

/// resolves who `peer_id` should be treated as for this redemption: if
/// this exact node id already has a linked user (it paired before, under
/// this or any other display name), reuse that user directly and skip
/// `register_user`'s username-uniqueness check entirely - re-redeeming a
/// still-valid pin is re-authentication for an already-trusted peer, not
/// a fresh registration, and its previously-chosen display name should
/// never collide with itself. only a genuinely new peer_id goes through
/// `register_user`. see docs/cenotaph-queue-ux-hardening-plan.md issue 6 -
/// previously EVERY redemption called `register_user`, so a peer that
/// paired once and later re-paired (new session, forgotten pin, admin
/// pairing code rotated, etc.) got rejected as `username_taken` against
/// its own prior registration.
async fn resolve_pairing_user(
    service: &crate::users::UserService,
    peer_id: &str,
    create_request: &crate::users::CreateUserRequest,
) -> Result<crate::users::User, PairResponseReason> {
    let existing = service.get_user_by_peer_node_id(peer_id).await;
    if let Some(user) = existing.data.filter(|_| existing.success) {
        debug!(
            target: "cenotaph",
            peer_id = %peer_id,
            user_id = %user.id,
            username = %user.username,
            "pair_request: peer already linked to a user, re-authenticating under existing name"
        );
        return Ok(user);
    }
    let user_resp = service.register_user(create_request).await;
    user_resp
        .data
        .filter(|_| user_resp.success)
        .ok_or(PairResponseReason::UsernameTaken)
}

/// validates `raw` as a real grimoire invite code (mirrors
/// `server/src/auth/handlers.rs`'s `redeem_invite` regular-invite branch
/// almost exactly: check the code, register/find the user, link the
/// peer's node_id) instead of matching against a locally generated pin.
async fn handle_pair_request(
    peer_id: &str,
    raw: &str,
    state: &SharedPairingState,
    send: &mut iroh::endpoint::SendStream,
) -> Result<(), String> {
    let req: PairRequest = match serde_json::from_str(raw) {
        Ok(r) => r,
        Err(e) => {
            warn!(
                target: "cenotaph",
                peer_id = %peer_id,
                error = %e,
                "pair_request: malformed json, rejecting as invalid_code"
            );
            let resp = PairResponse::err(PairResponseReason::InvalidCode);
            return write_line(send, &serde_json::to_string(&resp).unwrap()).await;
        }
    };

    let service = crate::users::UserService::new();
    let code_resp = service.check_invite_code(&req.code).await;
    let invite = match code_resp.data.filter(|_| code_resp.success) {
        Some(invite) if invite.code_type == crate::users::InviteCodeType::Invite => invite,
        _ => {
            warn!(
                target: "cenotaph",
                peer_id = %peer_id,
                submitted_code = %req.code,
                check_message = %code_resp.message,
                "pair_request: code did not match a live invite code, rejecting as invalid_code - \
                 the pin shown to the pairing device must match this player's CURRENT code \
                 (see player_pairing_get_snapshot/current_code); a stale/rotated/mistyped pin \
                 lands here"
            );
            let resp = PairResponse::err(PairResponseReason::InvalidCode);
            return write_line(send, &serde_json::to_string(&resp).unwrap()).await;
        }
    };

    let create_request = crate::users::CreateUserRequest {
        username: req.display_name.clone(),
        role: None, // let the invite code's grants_role apply
        invite_code: Some(req.code.clone()),
    };
    let user = match resolve_pairing_user(&service, peer_id, &create_request).await {
        Ok(user) => user,
        Err(reason) => {
            warn!(
                target: "cenotaph",
                peer_id = %peer_id,
                display_name = %req.display_name,
                "pair_request: valid code, but resolve_pairing_user failed ({reason:?})"
            );
            let resp = PairResponse::err(reason);
            return write_line(send, &serde_json::to_string(&resp).unwrap()).await;
        }
    };

    let _ = service.add_peer_node(&user.id, peer_id, None).await;

    {
        let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
        let mut session = wire::PlayerSession::ensure_active(guard.session.take());
        session.join(peer_id);
        guard.session = Some(session);
    }

    info!(
        target: "cenotaph",
        peer_id = %peer_id,
        display_name = %req.display_name,
        grants_role = ?invite.grants_role,
        "pair_request: accepted, peer joined session"
    );

    // the code that was just redeemed may have been the one-time admin
    // bootstrap code (max_uses=1) - if so it's now exhausted, so line up
    // a fresh member-granting code for the next device to pair with.
    if invite.grants_role == crate::users::UserRole::Admin && invite.max_uses == 1 {
        state::ensure_current_pairing_code(state, None).await;
    }

    let response = PairResponse::ok();
    write_line(send, &serde_json::to_string(&response).unwrap()).await
}

pub(crate) fn is_get_status_line(raw: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|v| v.get("command").and_then(|c| c.as_str()).map(String::from))
        .is_some_and(|c| c == "get_status")
}

async fn command_loop(
    peer_id: &str,
    role: PeerRole,
    first_line: String,
    reader: &mut BufReader<iroh::endpoint::RecvStream>,
    send: &mut iroh::endpoint::SendStream,
    state: &SharedPairingState,
    dispatch_tx: &PairingDispatchTx,
) -> Result<(), String> {
    let mut current = Some(first_line);
    while let Some(raw) = current.take() {
        let ack = process_command_line(peer_id, role, &raw, state, dispatch_tx).await;
        write_line(send, &serde_json::to_string(&ack).unwrap()).await?;

        let mut buf = String::new();
        // TEMP: measuring how long it takes to receive the NEXT line off
        // the wire - if this is where the multi-second gap lives (rather
        // than in dispatch/resolve), that points at the connection itself
        // (relay throttling) rather than at anything JS-side. remove once
        // confirmed either way.
        let read_start = std::time::Instant::now();
        match reader.read_line(&mut buf).await {
            Ok(0) => break,
            Err(_) => break,
            Ok(n) => {
                info!(
                    target: "cenotaph",
                    peer = %peer_id,
                    bytes = n,
                    elapsed_ms = read_start.elapsed().as_millis(),
                    "CENOTAPH_QUEUE_TRACE: command_loop: read next line off the wire"
                );
                current = Some(buf.trim_end().to_string());
            }
        }
    }
    Ok(())
}

async fn process_command_line(
    peer_id: &str,
    role: PeerRole,
    raw: &str,
    state: &SharedPairingState,
    dispatch_tx: &PairingDispatchTx,
) -> CommandAck {
    let allowed = {
        let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
        let mut session = wire::PlayerSession::ensure_active(guard.session.take());
        let ok = is_get_status_line(raw) || session.is_peer_allowed(peer_id, Some(role));
        if !ok {
            // this branch previously had NO logging at all - a command
            // rejected here (session membership failed, and the peer's
            // trust-store role wasn't Admin - see PlayerSession::
            // is_peer_allowed's own doc comment) never reaches dispatch_tx,
            // so it's invisible to every JS-side/dispatch-bridge trace
            // downstream. found live: a queue push that silently "never
            // even queued" with zero trace anywhere was consistent with
            // being dropped right here.
            warn!(
                target: "cenotaph",
                peer = %peer_id,
                role = ?role,
                session_mode = ?session.mode,
                allowed_node_ids = ?session.allowed_node_ids,
                "CENOTAPH_QUEUE_TRACE: process_command_line REJECTED (not_in_session) - peer's role is not Admin and it's not in the current session's allowed_node_ids, command dropped before ever reaching dispatch_tx: {raw}"
            );
        }
        if ok {
            session.touch();
        }
        guard.session = Some(session);
        ok
    };
    if !allowed {
        return CommandAck::err(CommandAckReason::NotInSession);
    }

    let command: PlayerCommand = match serde_json::from_str(raw) {
        Ok(c) => c,
        Err(e) => {
            warn!(target: "cenotaph", error = %e, "failed to parse control command");
            return CommandAck::err(CommandAckReason::InvalidCommand);
        }
    };

    let (reply_tx, reply_rx) = oneshot::channel();
    let command_debug = command_summary(&command);
    if dispatch_tx
        .send(PairingDispatchRequest {
            peer_id: peer_id.to_string(),
            command,
            reply: reply_tx,
        })
        .is_err()
    {
        warn!(target: "cenotaph", peer = %peer_id, command = %command_debug, "dispatch channel closed (consumer not receiving) - returning error ack immediately");
        return CommandAck::err(CommandAckReason::InvalidCommand);
    }
    let started = std::time::Instant::now();
    // TEMP: raw.len() is the exact wire payload size rust actually
    // received - confirms/rules out base64-embedded-artwork bloat as a
    // cause of slow queue pushes. remove once confirmed either way.
    info!(target: "cenotaph", peer = %peer_id, command = %command_debug, raw_bytes = raw.len(), "CENOTAPH_QUEUE_TRACE: process_command_line: sent to dispatch_tx, awaiting reply");
    let ack = reply_rx
        .await
        .unwrap_or_else(|_| CommandAck::err(CommandAckReason::InvalidCommand));
    info!(
        target: "cenotaph",
        peer = %peer_id,
        command = %command_debug,
        elapsed_ms = started.elapsed().as_millis(),
        "process_command_line: got reply"
    );
    ack
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

    // resolve_pairing_user touches the real db pool singleton (via
    // UserService) - same convention as offal/dispatch.rs's role-check
    // tests: #[ignore]'d so normal `cargo test` runs stay fast/isolated,
    // run explicitly with `cargo test -- --ignored` when touching this
    // path.
    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn resolve_pairing_user_reuses_existing_peer_instead_of_registering_again() {
        crate::config::init_config_for_tests();
        // init_config_for_tests() points at a real (persistent, on-disk)
        // sqlite file - `database::connect()` refuses to create it lazily
        // (mirrors production's "run `grimoire config init` first"
        // safety check), so an ignored test touching this singleton pool
        // for the first time in a process must create the empty file and
        // run real migrations itself.
        let db_dir = std::path::Path::new("/tmp/grimoire-test");
        std::fs::create_dir_all(db_dir).expect("create test db dir");
        let db_path = db_dir.join("test.db");
        if !db_path.exists() {
            std::fs::File::create(&db_path).expect("create empty test db file");
        }
        crate::database::run_migrations()
            .await
            .expect("run migrations against test db");
        let service = crate::users::UserService::new();

        // unique per run - the test db above is persistent across runs of
        // this ignored test, so a fixed peer_id/username would collide.
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let peer_id = format!("test-peer-resolve-pairing-user-{nonce}");
        let other_peer_id = format!("test-peer-resolve-pairing-user-{nonce}-other");
        let username = format!("eddie-{nonce}");

        // unlimited-use member-granting code, mirrors create_player_pairing_code's
        // own shape (see its doc comment for why max_uses <= 0 means unlimited).
        let invite = service
            .create_player_pairing_code(crate::users::UserRole::Member, 0, 6)
            .await
            .data
            .expect("create invite code");

        let first_request = crate::users::CreateUserRequest {
            username: username.clone(),
            role: None,
            invite_code: Some(invite.code.clone()),
        };
        let first = resolve_pairing_user(&service, &peer_id, &first_request)
            .await
            .expect("first redemption registers a new user");
        assert_eq!(first.username, username);
        // mirrors handle_pair_request's own follow-up call - the peer-node
        // link is what a SECOND redemption's short-circuit depends on.
        service
            .add_peer_node(&first.id, &peer_id, None)
            .await
            .data
            .expect("link peer node to first user");

        // re-pairing supplies the SAME node id and the SAME (now-taken)
        // display name - previously this failed as `username_taken`
        // against the peer's own prior registration.
        let second_request = crate::users::CreateUserRequest {
            username: username.clone(),
            role: None,
            invite_code: Some(invite.code.clone()),
        };
        let second = resolve_pairing_user(&service, &peer_id, &second_request)
            .await
            .expect("re-redemption by the same peer_id must succeed, not username_taken");
        assert_eq!(
            second.id, first.id,
            "must resolve to the SAME user, not a new one"
        );

        // a genuinely different peer_id trying to register the same
        // display name must still be rejected - the short-circuit is
        // keyed on peer_id, not username.
        let other_peer_request = crate::users::CreateUserRequest {
            username: username.clone(),
            role: None,
            invite_code: Some(invite.code.clone()),
        };
        let other_peer_result =
            resolve_pairing_user(&service, &other_peer_id, &other_peer_request).await;
        assert!(matches!(
            other_peer_result,
            Err(PairResponseReason::UsernameTaken)
        ));
    }
}
