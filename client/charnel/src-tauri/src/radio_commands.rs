//! charnel-side radio listener over the freqhole-radio/1 ALPN.
//!
//! mirrors `client/midden/src/radio.rs` (the wasm path) but lives inside
//! tauri so the spume webview can tune in even when midden wasm is not
//! loaded. surfaces a single `radio_tune` command that takes a peer addr
//! plus a tauri `Channel<RadioEvent>`; events are pushed back to JS as
//! they arrive on the iroh streams. `radio_leave` drops the connection.
//!
//! the wire protocol matches the wasm side exactly — same Tune/Hello/Meta
//! JSON, same `[u32 seq][u32 len][bytes]` chunk framing — so the spume
//! `radioService` can drive both transports through one `MiddenNodeLike`
//! interface.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;

use grimoire::federation::p2p_client::{get_endpoint_arc, parse_peer_address};
use grimoire::radio::messages::ControlMessage;
use grimoire::radio::protocol::{read_chunk, read_control_message, RADIO_ALPN};

/// active radio sessions keyed by opaque session id. dropping the entry
/// triggers the cancel token; the spawned tasks notice and tear down the
/// iroh connection on their next await point.
struct Session {
    cancel: CancellationToken,
    /// kept just so it's not dropped while the session is alive.
    _conn: iroh::endpoint::Connection,
}

static SESSIONS: Mutex<Option<HashMap<String, Session>>> = Mutex::new(None);

fn sessions() -> std::sync::MutexGuard<'static, Option<HashMap<String, Session>>> {
    let mut guard = SESSIONS.lock().unwrap();
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
    guard
}

fn next_session_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("radio-{now}-{n}")
}

/// events pushed back to JS over the per-session channel. mirrors the
/// midden wasm callbacks but as a serde-tagged enum so the JS side can
/// switch on `kind`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RadioEvent {
    /// initial Hello control message, JSON string (forwarded verbatim so
    /// the spume side can parse with the same code path as midden).
    Hello { json: String },
    /// subsequent Meta control messages, JSON string.
    Meta { json: String },
    /// server → client lag notice. JSON of `LagMessage`. spume should
    /// tear down + recreate its MediaSource and discard chunks until it
    /// sees `seq >= resync_at_seq && is_init`.
    Lag { json: String },
    /// server → client heartbeat. JSON of `ChunkReadyMessage`. used by
    /// spume to detect "broadcaster alive but my socket is silent" cases.
    ChunkReady { json: String },
    /// audio chunk. `bytes_b64` is the raw fMP4 fragment, base64-encoded
    /// because tauri channels serialize via JSON.
    Chunk {
        seq: u32,
        is_init: bool,
        bytes_b64: String,
    },
    /// session ended (stream closed, peer disconnected, error). carries
    /// a human-readable reason. after this fires no further events arrive.
    Closed { reason: String },
}

/// open a radio connection to `peer_addr` and stream events back through
/// `events`. returns an opaque `session_id` the caller passes to
/// `radio_leave` to tear down.
#[tauri::command]
pub async fn radio_tune(peer_addr: String, events: Channel<RadioEvent>) -> Result<String, String> {
    // singleton policy: only one active listener session per app process.
    // clear any stale/overlapping sessions before opening a fresh tune.
    drop_all_sessions();
    drop_all_local_sessions();

    let endpoint = get_endpoint_arc().map_err(|e| e.to_string())?;
    let addr = parse_peer_address(&peer_addr).map_err(|e| e.to_string())?;

    tracing::info!(peer = %peer_addr, "[radio-charnel] connecting to broadcaster");
    let conn = endpoint
        .connect(addr, RADIO_ALPN)
        .await
        .map_err(|e| format!("connect: {e}"))?;

    // open control bidi, send Tune, wait for Hello.
    let (mut ctrl_send, mut ctrl_recv) =
        conn.open_bi().await.map_err(|e| format!("open_bi: {e}"))?;

    let tune_body = b"{\"type\":\"tune\"}";
    let tune_len = (tune_body.len() as u32).to_be_bytes();
    ctrl_send
        .write_all(&tune_len)
        .await
        .map_err(|e| format!("write tune len: {e}"))?;
    ctrl_send
        .write_all(tune_body)
        .await
        .map_err(|e| format!("write tune body: {e}"))?;

    // read Hello (server pushes it before opening the audio uni).
    let hello = match read_control_message(&mut ctrl_recv)
        .await
        .map_err(|e| format!("read hello: {e}"))?
    {
        Some(ControlMessage::Hello(h)) => h,
        Some(other) => {
            return Err(format!(
                "expected Hello first, got {:?}",
                std::mem::discriminant(&other)
            ));
        }
        None => return Err("control stream closed before Hello".into()),
    };
    let hello_json =
        serde_json::to_string(&ControlMessage::Hello(hello)).map_err(|e| e.to_string())?;
    let _ = events.send(RadioEvent::Hello { json: hello_json });

    // accept the audio uni stream the server opens after Hello.
    let mut audio_recv = conn
        .accept_uni()
        .await
        .map_err(|e| format!("accept_uni: {e}"))?;

    let session_id = next_session_id();
    let cancel = CancellationToken::new();

    // audio loop
    {
        let cancel = cancel.clone();
        let events = events.clone();
        let session_id = session_id.clone();
        tokio::spawn(async move {
            let reason = run_audio_loop(&mut audio_recv, &events, &cancel).await;
            let _ = events.send(RadioEvent::Closed {
                reason: reason.clone(),
            });
            // best-effort cleanup if the loop exited on its own.
            drop_session(&session_id);
            tracing::debug!(session = %session_id, reason, "[radio-charnel] audio loop ended");
        });
    }

    // meta loop
    {
        let cancel = cancel.clone();
        let events = events.clone();
        let session_id = session_id.clone();
        tokio::spawn(async move {
            // ctrl_send unused for now; phase 2 will use it for skip/queue.
            let _ = ctrl_send;
            let reason = run_meta_loop(&mut ctrl_recv, &events, &cancel).await;
            tracing::debug!(session = %session_id, reason, "[radio-charnel] meta loop ended");
        });
    }

    sessions().as_mut().unwrap().insert(
        session_id.clone(),
        Session {
            cancel,
            _conn: conn,
        },
    );

    Ok(session_id)
}

/// tear down a session by id. safe to call repeatedly.
#[tauri::command]
pub fn radio_leave(session_id: String) -> Result<(), String> {
    drop_session(&session_id);
    drop_local_session(&session_id);
    Ok(())
}

fn drop_session(session_id: &str) {
    if let Some(map) = sessions().as_mut() {
        if let Some(session) = map.remove(session_id) {
            session.cancel.cancel();
            // dropping `_conn` after we've signalled cancel closes the
            // iroh connection cleanly; the spawned loops will see the
            // stream finish on their next read.
            session._conn.close(0u32.into(), b"client leaving");
        }
    }
}

fn drop_all_sessions() {
    if let Some(map) = sessions().as_mut() {
        let drained: Vec<Session> = map.drain().map(|(_, session)| session).collect();
        let count = drained.len();
        for session in drained {
            session.cancel.cancel();
            session._conn.close(0u32.into(), b"radio singleton handoff");
        }
        if count > 0 {
            tracing::debug!(count, "[radio-charnel] dropped existing remote session(s)");
        }
    }
}

// ---------- self-listen: in-process tune to a local broadcaster --------

/// active local sessions keyed by opaque session id. dropping the entry
/// triggers the cancel token; the spawned tasks notice and tear down the
/// in-process subscription on their next await point.
struct LocalSession {
    cancel: CancellationToken,
}

static LOCAL_SESSIONS: Mutex<Option<HashMap<String, LocalSession>>> = Mutex::new(None);

fn local_sessions() -> std::sync::MutexGuard<'static, Option<HashMap<String, LocalSession>>> {
    let mut guard = LOCAL_SESSIONS.lock().unwrap();
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
    guard
}

fn drop_local_session(session_id: &str) {
    if let Some(map) = local_sessions().as_mut() {
        if let Some(session) = map.remove(session_id) {
            session.cancel.cancel();
        }
    }
}

fn drop_all_local_sessions() {
    if let Some(map) = local_sessions().as_mut() {
        let drained: Vec<LocalSession> = map.drain().map(|(_, session)| session).collect();
        let count = drained.len();
        for session in drained {
            session.cancel.cancel();
        }
        if count > 0 {
            tracing::debug!(count, "[radio-charnel] dropped existing local session(s)");
        }
    }
}

/// subscribe directly to a local broadcaster (no iroh hop). lets the
/// charnel app listen to its own stations without round-tripping through
/// iroh's "you can't dial yourself" check. emits the same RadioEvent
/// stream as `radio_tune`, so the spume side can reuse its event loop.
#[tauri::command]
pub async fn radio_tune_local(
    station_id: Option<String>,
    events: Channel<RadioEvent>,
) -> Result<String, String> {
    // singleton policy: only one active listener across remote + local paths.
    drop_all_sessions();
    drop_all_local_sessions();

    use grimoire::radio::broadcaster::{get_default, get_station};
    use grimoire::radio::messages::{ControlMessage, HelloMessage, RADIO_CODEC};

    let bc = match station_id.as_deref() {
        Some(id) => get_station(id)
            .await
            .ok_or_else(|| format!("no broadcaster for station '{id}'"))?,
        None => get_default()
            .await
            .ok_or_else(|| "no default station available".to_string())?,
    };

    // join *before* snapshotting so listener_count in Hello reflects us.
    let new_count = bc.join();
    let sub = bc.subscribe().await;

    let hello = ControlMessage::Hello(HelloMessage {
        codec: RADIO_CODEC.to_string(),
        now_playing: (*sub.now_playing).clone(),
        listener_count: new_count,
        current_seq: sub.next_seq,
        init_seq: sub.init_seq,
        current_track_elapsed_ms: bc.current_track_elapsed_ms(),
    });
    let hello_json = serde_json::to_string(&hello).map_err(|e| e.to_string())?;
    let _ = events.send(RadioEvent::Hello { json: hello_json });

    // catchup chunks (init first, then ring contents).
    if let Some(init) = sub.init.as_ref() {
        let _ = events.send(RadioEvent::Chunk {
            seq: init.seq,
            is_init: init.is_init,
            bytes_b64: B64.encode(&init.bytes),
        });
    }
    for chunk in &sub.catchup {
        let _ = events.send(RadioEvent::Chunk {
            seq: chunk.seq,
            is_init: chunk.is_init,
            bytes_b64: B64.encode(&chunk.bytes),
        });
    }

    let session_id = next_session_id();
    let cancel = CancellationToken::new();

    // split out the receivers so each loop owns one half.
    let mut chunk_rx = sub.chunk_rx;
    let mut meta_rx = sub.meta_rx;
    let bc_for_leave = bc.clone();
    let bc_for_meta = bc.clone();

    // audio loop
    {
        let cancel = cancel.clone();
        let events = events.clone();
        let session_id = session_id.clone();
        tokio::spawn(async move {
            let reason = run_local_audio_loop(&mut chunk_rx, &events, &cancel).await;
            bc_for_leave.leave();
            let _ = events.send(RadioEvent::Closed {
                reason: reason.clone(),
            });
            drop_local_session(&session_id);
            tracing::debug!(session = %session_id, reason, "[radio-charnel-local] audio loop ended");
        });
    }

    // meta loop
    {
        let cancel = cancel.clone();
        let events = events.clone();
        let session_id = session_id.clone();
        tokio::spawn(async move {
            let reason = run_local_meta_loop(&mut meta_rx, &events, &cancel, bc_for_meta).await;
            tracing::debug!(session = %session_id, reason, "[radio-charnel-local] meta loop ended");
        });
    }

    local_sessions()
        .as_mut()
        .unwrap()
        .insert(session_id.clone(), LocalSession { cancel });

    Ok(session_id)
}

async fn run_local_audio_loop(
    rx: &mut tokio::sync::broadcast::Receiver<std::sync::Arc<grimoire::radio::chunk::Chunk>>,
    events: &Channel<RadioEvent>,
    cancel: &CancellationToken,
) -> String {
    use tokio::sync::broadcast::error::RecvError;
    loop {
        tokio::select! {
            _ = cancel.cancelled() => return "cancelled".into(),
            res = rx.recv() => match res {
                Ok(chunk) => {
                    let bytes_b64 = B64.encode(&chunk.bytes);
                    if events.send(RadioEvent::Chunk {
                        seq: chunk.seq,
                        is_init: chunk.is_init,
                        bytes_b64,
                    }).is_err() {
                        return "channel closed".into();
                    }
                }
                Err(RecvError::Lagged(n)) => {
                    tracing::warn!("[radio-charnel-local] chunk rx lagged by {n}");
                    // keep going; ring buffer will resync on next init.
                }
                Err(RecvError::Closed) => return "broadcaster gone".into(),
            },
        }
    }
}

async fn run_local_meta_loop(
    rx: &mut tokio::sync::broadcast::Receiver<grimoire::radio::broadcaster::MetaUpdate>,
    events: &Channel<RadioEvent>,
    cancel: &CancellationToken,
    bc: std::sync::Arc<grimoire::radio::broadcaster::Broadcaster>,
) -> String {
    use grimoire::radio::messages::{ControlMessage, MetaMessage};
    use tokio::sync::broadcast::error::RecvError;
    loop {
        tokio::select! {
            _ = cancel.cancelled() => return "cancelled".into(),
            res = rx.recv() => match res {
                Ok(update) => {
                    let msg = ControlMessage::Meta(MetaMessage {
                        now_playing: (*update.now_playing).clone(),
                        listener_count: bc.listener_count(),
                        init_seq: update.init_seq,
                    });
                    match serde_json::to_string(&msg) {
                        Ok(json) => {
                            if events.send(RadioEvent::Meta { json }).is_err() {
                                return "channel closed".into();
                            }
                        }
                        Err(e) => {
                            tracing::warn!(error = %e, "[radio-charnel-local] meta serialize failed");
                        }
                    }
                }
                Err(RecvError::Lagged(n)) => {
                    tracing::warn!("[radio-charnel-local] meta rx lagged by {n}");
                }
                Err(RecvError::Closed) => return "broadcaster gone".into(),
            },
        }
    }
}

async fn run_audio_loop(
    recv: &mut iroh::endpoint::RecvStream,
    events: &Channel<RadioEvent>,
    cancel: &CancellationToken,
) -> String {
    loop {
        tokio::select! {
            _ = cancel.cancelled() => return "cancelled".into(),
            res = read_chunk(recv) => match res {
                Ok(Some(chunk)) => {
                    let bytes_b64 = B64.encode(&chunk.bytes);
                    if events.send(RadioEvent::Chunk {
                        seq: chunk.seq,
                        is_init: chunk.is_init,
                        bytes_b64,
                    }).is_err() {
                        return "channel closed".into();
                    }
                }
                Ok(None) => return "audio stream eof".into(),
                Err(e) => return format!("audio read error: {e}"),
            },
        }
    }
}

async fn run_meta_loop(
    recv: &mut iroh::endpoint::RecvStream,
    events: &Channel<RadioEvent>,
    cancel: &CancellationToken,
) -> String {
    loop {
        tokio::select! {
            _ = cancel.cancelled() => return "cancelled".into(),
            res = read_control_message(recv) => match res {
                Ok(Some(msg)) => {
                    // forward as JSON. ignore Tune (client → server only).
                    if matches!(msg, ControlMessage::Tune(_)) {
                        continue;
                    }
                    match serde_json::to_string(&msg) {
                        Ok(json) => {
                            let event = match msg {
                                ControlMessage::Hello(_) => RadioEvent::Hello { json },
                                ControlMessage::Meta(_) => RadioEvent::Meta { json },
                                ControlMessage::Lag(_) => RadioEvent::Lag { json },
                                ControlMessage::ChunkReady(_) => RadioEvent::ChunkReady { json },
                                ControlMessage::Goodbye(_) => RadioEvent::Meta { json },
                                ControlMessage::Tune(_) => continue,
                            };
                            if events.send(event).is_err() {
                                return "channel closed".into();
                            }
                        }
                        Err(e) => {
                            tracing::warn!(error = %e, "[radio-charnel] meta serialize failed");
                        }
                    }
                }
                Ok(None) => return "control stream eof".into(),
                Err(e) => return format!("meta read error: {e}"),
            },
        }
    }
}
