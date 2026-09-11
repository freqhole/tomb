//! `freqhole-player/1` ALPN handler: pairing handshake + command
//! dispatch, bridging the portable protocol/session types in
//! `ratcore::app::pairing` to a real iroh transport and rathole's real
//! playback backends (rodio via `PlayerCmd`, mpv via `VideoCommand`).
//!
//! mirrors (wire-compatible, not code-shared) cenotaph's
//! `control/playerConnectionHandler.ts` + `control/dispatcher.ts` — see
//! docs/rathole-headless-player-plan.md phase 4.
//!
//! **known simplifications, tracked as follow-ups, not silently
//! skipped:**
//! - no rate limiting on pin redemption attempts yet (cenotaph's
//!   `pairing/rateLimiter.ts` has no rust port here). a real gap for a
//!   6-hex-char (16M combination) pin — worth adding before this ships
//!   for real.
//! - `current_status()`'s queue/now-playing `MediaRef`s use this
//!   device's own `media_blob_id` as a stand-in for `blake3_hash`
//!   (getting the *real* blake3 hash needs an extra grimoire lookup
//!   per row — deferred; a remote controller only needs a stable
//!   identifier for its own dedup/diffing here, not the real hash).
//! - `play`/`replace_queue`/`append_queue` for **video** items load the
//!   fetched file into mpv but don't yet flip rathole into the
//!   "fullscreen video, suppress console" state from phase 3 — that
//!   transition is still unimplemented pending the console/ssh
//!   decision tracked in the plan doc.

use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use iroh::endpoint::Connection;
use iroh::protocol::{AcceptError, ProtocolHandler};
use iroh::PublicKey;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{mpsc, oneshot};
use tracing::{info, warn};

use crate::ratcore::app::{
    pairing as portable, CommandAck, CommandAckReason, ConnectedControllerInfo, MediaKind,
    MediaRef, PairRequest, PairResponse, PairResponseReason, PairingCommand, PairingSnapshot,
    PeerRole, PersistedState, PlayerSession, PlayerStatus, PresenceAnnouncement, PresenceState,
    StatusCommon, TrustedController,
};
use crate::ratcore::transport::{PairingStateReader, PlayerCmd, VideoPlayer};

/// ALPN identifier. see the "naming disambiguation" note in
/// docs/rathole-headless-player-plan.md — unrelated to grimoire's own,
/// removed, differently-shaped `freqhole-player/1` protocol.
pub const PLAYER_ALPN: &[u8] = b"freqhole-player/1";

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// -------------------------------------------------------------------
// shared runtime state — read directly by the ui (a quick lock, never
// held across an await) and read+written by the alpn handler's
// `tokio::spawn`'d tasks (which must be `Send`, unlike the
// `LocalSet`-bound `App`/`EphemeralState`).
// -------------------------------------------------------------------

#[derive(Debug, Clone, Default)]
pub struct PairingRuntimeState {
    pub node_id: Option<String>,
    pub trusted_controllers: Vec<TrustedController>,
    pub session: Option<PlayerSession>,
    pub connected: Vec<ConnectedControllerInfo>,
}

pub type SharedPairingState = Arc<Mutex<PairingRuntimeState>>;

pub fn load_pairing_state(persisted: &PersistedState) -> SharedPairingState {
    // ensure a session (and its pin) exists up front rather than lazily on
    // first mutation/pair attempt - otherwise the pairing screen has no pin
    // to show until someone regenerates one in settings or a client happens
    // to trigger `ensure_active` first, which is a dead end for a brand new
    // device (see docs/rathole-headless-player-plan.md phase 4 UI notes).
    let session = Some(PlayerSession::ensure_active(
        persisted.player_session.clone(),
    ));
    Arc::new(Mutex::new(PairingRuntimeState {
        node_id: None,
        trusted_controllers: persisted.trusted_controllers.clone(),
        session,
        connected: Vec::new(),
    }))
}

/// call before saving the statefile so trust/session changes made by
/// the alpn handler (a different set of tasks than the one that owns
/// `PersistedState`) aren't lost.
pub fn sync_pairing_state_to_persisted(persisted: &mut PersistedState, state: &SharedPairingState) {
    let guard = state.lock().unwrap_or_else(|p| p.into_inner());
    persisted.trusted_controllers = guard.trusted_controllers.clone();
    persisted.player_session = guard.session.clone();
}

fn mark_connected(state: &SharedPairingState, info: ConnectedControllerInfo) {
    let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
    guard.connected.retain(|c| c.node_id != info.node_id);
    guard.connected.push(info);
}

fn mark_disconnected(state: &SharedPairingState, node_id: &str) {
    let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
    guard.connected.retain(|c| c.node_id != node_id);
}

/// thin `PairingStateReader` impl wrapping the shared mutex, so `App`
/// can hold it as `Rc<dyn PairingStateReader>` (ratcore's portable
/// trait) without ratcore itself knowing about `Arc<Mutex<...>>`.
pub struct PairingStateHandle(pub SharedPairingState);

impl PairingStateReader for PairingStateHandle {
    fn snapshot(&self) -> PairingSnapshot {
        let guard = self.0.lock().unwrap_or_else(|p| p.into_inner());
        PairingSnapshot {
            node_id: guard.node_id.clone(),
            trusted_controllers: guard.trusted_controllers.clone(),
            session: guard.session.clone(),
            connected: guard.connected.clone(),
        }
    }

    fn set_session_mode(&self, mode: portable::SessionMode) {
        let mut guard = self.0.lock().unwrap_or_else(|p| p.into_inner());
        let mut session = PlayerSession::ensure_active(guard.session.take());
        session.set_mode(mode);
        guard.session = Some(session);
    }

    fn regenerate_admin_pin(&self) {
        let mut guard = self.0.lock().unwrap_or_else(|p| p.into_inner());
        let mut session = PlayerSession::ensure_active(guard.session.take());
        session.regenerate_admin_pin();
        guard.session = Some(session);
    }

    fn regenerate_session_pin(&self) {
        let mut guard = self.0.lock().unwrap_or_else(|p| p.into_inner());
        let mut session = PlayerSession::ensure_active(guard.session.take());
        session.regenerate_session_pin();
        guard.session = Some(session);
    }

    fn remove_controller(&self, node_id: &str) {
        let mut guard = self.0.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(mut session) = guard.session.take() {
            session.leave(node_id);
            guard.session = Some(session);
        }
    }
}

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
}

impl PairingRuntime {
    pub fn new(state: SharedPairingState, dispatch_tx: PairingDispatchTx) -> Self {
        Self {
            state,
            dispatch_tx,
            started: std::rc::Rc::new(std::cell::Cell::new(false)),
        }
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
        tokio::task::spawn_local(async move {
            match start_player_endpoint(state, dispatch_tx).await {
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
) -> Result<String, String> {
    let mut endpoint = grimoire::federation::transport::FederationEndpoint::new()
        .await
        .map_err(|e| e.to_string())?;
    let node_id = endpoint.node_id().to_string();
    {
        let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
        guard.node_id = Some(node_id.clone());
    }
    let handler = PlayerProtocol::new(state, dispatch_tx);
    endpoint
        .start_router_with(|builder| builder.accept(PLAYER_ALPN, handler))
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
}

impl PlayerProtocol {
    pub fn new(state: SharedPairingState, dispatch_tx: PairingDispatchTx) -> Self {
        Self { state, dispatch_tx }
    }
}

impl ProtocolHandler for PlayerProtocol {
    async fn accept(&self, conn: Connection) -> std::result::Result<(), AcceptError> {
        let peer_id = conn.remote_id();
        info!(target: "player_protocol", peer = %peer_id, "accepted freqhole-player/1 connection");
        let state = self.state.clone();
        let dispatch_tx = self.dispatch_tx.clone();
        loop {
            match conn.accept_bi().await {
                Ok((send, recv)) => {
                    let state = state.clone();
                    let dispatch_tx = dispatch_tx.clone();
                    tokio::spawn(async move {
                        if let Err(e) = handle_stream(peer_id, send, recv, state, dispatch_tx).await
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
        // push-subscription session: read-only, no commands dispatched
        // on this stream — just register presence and wait for close.
        // TODO(follow-up): actually push `PlayerStatus` updates onto
        // this stream when something changes (cenotaph's
        // `statusSubscribers.ts`); for now a subscriber only gets the
        // initial presence-equivalent registration, matching a
        // "connected" indicator but not live now-playing push updates.
        mark_connected(&state, connected_info);
        loop {
            let mut buf = String::new();
            match reader.read_line(&mut buf).await {
                Ok(0) => break,
                Ok(_) => continue,
                Err(_) => break,
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
                    paired_at: now_ms(),
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

fn is_get_status_line(raw: &str) -> bool {
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

// -------------------------------------------------------------------
// media resolution: fetch a `MediaRef` to a local, playable file path.
// -------------------------------------------------------------------

fn player_cache_dir() -> std::path::PathBuf {
    grimoire::config::get_config()
        .data_dir
        .join("rathole")
        .join("player_cache")
}

fn guess_extension(media: &MediaRef) -> &'static str {
    match media.mime_type.as_deref() {
        Some("audio/flac") => "flac",
        Some("audio/wav") | Some("audio/x-wav") => "wav",
        Some("audio/ogg") => "ogg",
        Some("audio/opus") => "opus",
        Some("audio/mp4") | Some("audio/m4a") => "m4a",
        Some("video/mp4") => "mp4",
        Some("video/webm") => "webm",
        Some("video/x-matroska") => "mkv",
        _ => match media.kind {
            Some(MediaKind::Video) => "mp4",
            _ => "mp3",
        },
    }
}

/// resolve a `MediaRef` to a local file path, fetching the bytes from
/// `source_peer_addr` via grimoire's existing verified iroh-blobs
/// client if not already cached locally. reuses
/// `grimoire::federation::p2p_client::fetch_blob_verified_to_file` -
/// the same primitive charnel's own player-pairing "queue push" flow
/// is built on (see repo memory
/// `tomb-grimoire-player-alpn-half-baked.md`'s follow-up #2) - streamed
/// straight to disk, no full-file memory buffering.
pub async fn resolve_media_ref(media: &MediaRef) -> Result<String, String> {
    let cache_dir = player_cache_dir();
    std::fs::create_dir_all(&cache_dir).map_err(|e| format!("player cache dir: {e}"))?;
    let target = cache_dir.join(format!("{}.{}", media.blake3_hash, guess_extension(media)));
    if target.exists() {
        return Ok(target.to_string_lossy().into_owned());
    }
    grimoire::federation::p2p_client::fetch_blob_verified_to_file(
        &media.source_peer_addr,
        &media.blake3_hash,
        &target,
    )
    .await
    .map_err(|e| format!("failed to fetch media from {}: {e}", media.source_peer_addr))?;
    Ok(target.to_string_lossy().into_owned())
}

// -------------------------------------------------------------------
// playback dispatch: `PairingCommand` -> rathole's real backends.
// -------------------------------------------------------------------

/// which backend a generic (kind-less) command like pause/resume/seek
/// should target, based on which one currently has something loaded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveBackend {
    Audio,
    Video,
}

/// snapshot passed in by `run.rs` (which owns `App`) so this module
/// never needs `&mut App` / non-`Send` handles itself — only cloned
/// `Rc<dyn ...>` handles and plain data, all assembled synchronously
/// before any `.await` point.
pub struct DispatchContext {
    pub active_backend: ActiveBackend,
    pub player: Option<std::rc::Rc<dyn crate::ratcore::transport::MusicPlayer>>,
    pub video_player: Option<std::rc::Rc<dyn VideoPlayer>>,
    pub volume: f32,
}

/// dispatch one already-authorized `PairingCommand` against real
/// playback state, returning the `CommandAck` to send back on the
/// wire. lives here (not `tty::run`) so the mapping from wire command
/// to concrete `PlayerCmd`/`VideoCommand` calls is unit-testable in
/// isolation from the rest of the event loop.
pub async fn dispatch_pairing_command(ctx: DispatchContext, command: PairingCommand) -> CommandAck {
    match command {
        PairingCommand::Play { item } => play_item(&ctx, item).await,
        PairingCommand::ReplaceQueue { items } => {
            // v1: replace = play the first item; the rest aren't
            // queued yet (rathole's own audio queue is a *local*
            // rows concept - see queue-manager comment in
            // `tty/run.rs` - bridging a remote MediaRef queue onto it
            // is a real follow-up, not attempted here).
            match items.into_iter().next() {
                Some(first) => play_item(&ctx, first).await,
                None => status_ack(&ctx, None),
            }
        }
        PairingCommand::AppendQueue { .. } => {
            // TODO(follow-up): needs the same local-queue bridging as
            // ReplaceQueue above.
            CommandAck::err(CommandAckReason::InvalidCommand)
        }
        PairingCommand::Pause => {
            send_generic(
                &ctx,
                PlayerCmd::Pause,
                crate::ratcore::app::VideoCommand::Pause,
            )
            .await;
            status_ack(&ctx, None)
        }
        PairingCommand::Resume => {
            send_generic(
                &ctx,
                PlayerCmd::Play,
                crate::ratcore::app::VideoCommand::Play,
            )
            .await;
            status_ack(&ctx, None)
        }
        PairingCommand::Seek { position_ms } => {
            send_generic(
                &ctx,
                PlayerCmd::Seek(position_ms),
                crate::ratcore::app::VideoCommand::Seek {
                    seconds: position_ms as f64 / 1000.0,
                },
            )
            .await;
            status_ack(&ctx, None)
        }
        PairingCommand::Stop => {
            send_generic(
                &ctx,
                PlayerCmd::Stop,
                crate::ratcore::app::VideoCommand::Close,
            )
            .await;
            status_ack(&ctx, None)
        }
        PairingCommand::SetVolume { volume } => {
            if let Some(player) = &ctx.player {
                let _ = player.send(PlayerCmd::SetVolume(volume as f32)).await;
            }
            if let Some(vp) = &ctx.video_player {
                let _ = vp
                    .send(crate::ratcore::app::VideoCommand::SetVolume { volume })
                    .await;
            }
            status_ack(&ctx, None)
        }
        PairingCommand::Skip => {
            if let Some(player) = &ctx.player {
                let _ = player.send(PlayerCmd::Next).await;
            }
            status_ack(&ctx, None)
        }
        PairingCommand::GetStatus => status_ack(&ctx, None),
        // not yet supported - see module doc / plan doc follow-ups.
        PairingCommand::RemoveFromQueue { .. }
        | PairingCommand::ReorderQueue { .. }
        | PairingCommand::SetAutoDownloadEnabled { .. }
        | PairingCommand::TuneRadio { .. }
        | PairingCommand::StopRadio => CommandAck::err(CommandAckReason::InvalidCommand),
    }
}

async fn send_generic(
    ctx: &DispatchContext,
    audio_cmd: PlayerCmd,
    video_cmd: crate::ratcore::app::VideoCommand,
) {
    match ctx.active_backend {
        ActiveBackend::Audio => {
            if let Some(player) = &ctx.player {
                let _ = player.send(audio_cmd).await;
            }
        }
        ActiveBackend::Video => {
            if let Some(vp) = &ctx.video_player {
                let _ = vp.send(video_cmd).await;
            }
        }
    }
}

async fn play_item(ctx: &DispatchContext, item: MediaRef) -> CommandAck {
    let kind = item.kind.unwrap_or(MediaKind::Audio);
    let path = match resolve_media_ref(&item).await {
        Ok(p) => p,
        Err(e) => {
            warn!(target: "player_protocol", error = %e, "failed to resolve media ref");
            return status_ack(
                ctx,
                Some(PlayerStatus::Error {
                    message: e,
                    common: empty_common(ctx),
                }),
            );
        }
    };
    match kind {
        MediaKind::Audio => {
            if let Some(player) = &ctx.player {
                let _ = player.send(PlayerCmd::Load(vec![path])).await;
            }
        }
        MediaKind::Video => {
            if let Some(vp) = &ctx.video_player {
                let _ = vp
                    .send(crate::ratcore::app::VideoCommand::Load {
                        path,
                        title: item.title.clone(),
                        start_seconds: None,
                    })
                    .await;
            }
        }
    }
    status_ack(ctx, None)
}

fn empty_common(ctx: &DispatchContext) -> StatusCommon {
    StatusCommon {
        queue: vec![],
        auto_download_enabled: false,
        volume: ctx.volume as f64,
        recently_played: vec![],
    }
}

/// best-effort immediate ack. real position/duration/queue state
/// still arrives the normal way (`MusicEvent`/`VideoPlayerEvent` ->
/// `EphemeralState`) for THIS device's own ui; a remote controller
/// only gets this one-shot ack today (no live push subscription yet -
/// see the module doc's "known simplifications").
fn status_ack(ctx: &DispatchContext, explicit: Option<PlayerStatus>) -> CommandAck {
    let status = explicit.unwrap_or(PlayerStatus::Buffering {
        common: empty_common(ctx),
    });
    CommandAck::ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ref_with_kind(kind: MediaKind) -> MediaRef {
        MediaRef {
            source_peer_addr: "peer".into(),
            blake3_hash: "hash".into(),
            size_bytes: None,
            duration_ms: None,
            mime_type: None,
            kind: Some(kind),
            title: None,
            artist: None,
            artwork_thumb_url: None,
            artwork_full_url: None,
        }
    }

    #[test]
    fn guess_extension_prefers_mime_type() {
        let mut m = ref_with_kind(MediaKind::Audio);
        m.mime_type = Some("audio/flac".into());
        assert_eq!(guess_extension(&m), "flac");
    }

    #[test]
    fn guess_extension_falls_back_to_kind() {
        assert_eq!(guess_extension(&ref_with_kind(MediaKind::Video)), "mp4");
        assert_eq!(guess_extension(&ref_with_kind(MediaKind::Audio)), "mp3");
    }

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

    #[tokio::test]
    async fn get_status_acks_ok_without_a_backend() {
        let ctx = DispatchContext {
            active_backend: ActiveBackend::Audio,
            player: None,
            video_player: None,
            volume: 1.0,
        };
        let ack = dispatch_pairing_command(ctx, PairingCommand::GetStatus).await;
        assert!(ack.ok);
    }

    #[tokio::test]
    async fn unsupported_commands_ack_with_invalid_command() {
        let ctx = DispatchContext {
            active_backend: ActiveBackend::Audio,
            player: None,
            video_player: None,
            volume: 1.0,
        };
        let ack = dispatch_pairing_command(
            ctx,
            PairingCommand::TuneRadio {
                peer_addr: "x".into(),
                station_id: None,
            },
        )
        .await;
        assert!(!ack.ok);
        assert_eq!(ack.reason, Some(CommandAckReason::InvalidCommand));
    }
}
