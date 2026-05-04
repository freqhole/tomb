//! per-connection radio handler.
//!
//! flow for a new listener:
//!
//! 1. server `accept_bi()` for the control stream
//! 2. server reads one `Tune` control message; uses `tune.station_id` (or
//!    the default station when absent) to look up the broadcaster
//! 3. server subscribes + writes a `Hello` on the control stream
//! 4. server `open_uni()` for the audio stream
//! 5. server writes the current init chunk + cached catchup chunks
//! 6. server fans live audio chunks + meta updates concurrently

use crate::error::{GrimoireError, GrimoireResult};
use crate::federation::is_known_peer;
use crate::radio::broadcaster::{
    get_default as get_default_broadcaster, get_station as get_broadcaster, Broadcaster, MetaUpdate,
};
use crate::radio::chunk::Chunk;
use crate::radio::messages::{
    ChunkReadyMessage, ControlMessage, GoodbyeMessage, HelloMessage, LagMessage, MetaMessage,
    RADIO_CODEC,
};
use crate::radio::protocol::{read_control_message, write_chunk, write_control_message};
use crate::radio::stations::get_station;
use iroh::endpoint::{Connection, SendStream};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::mpsc;
use tracing::{info, warn};

/// optional heartbeat cadence. lets clients detect a wedged uni stream
/// while the control stream stays alive over QUIC keepalives.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);

enum SessionEnd {
    Finished,
    Goodbye(String),
}

pub async fn handle_connection(conn: Connection) {
    let peer_id = conn.remote_id();
    info!("[radio-handler] new listener: {peer_id}");

    if let Err(e) = run_session(&conn).await {
        warn!("[radio-handler] listener {peer_id} disconnected: {e}");
    }

    info!("[radio-handler] listener gone: {peer_id}");
}

async fn run_session(conn: &Connection) -> GrimoireResult<()> {
    // 1. accept the control bidi stream.
    let (mut ctrl_send, mut ctrl_recv) =
        conn.accept_bi()
            .await
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("radio: failed to accept control stream: {e}"),
            })?;

    // 2. read Tune; pick broadcaster by station_id (or default).
    let requested_station = match read_control_message(&mut ctrl_recv).await? {
        Some(ControlMessage::Tune(t)) => t.station_id,
        Some(other) => {
            return Err(GrimoireError::FederationApiError {
                message: format!("radio: expected Tune, got {other:?}"),
            });
        }
        None => {
            return Err(GrimoireError::FederationApiError {
                message: "radio: control stream closed before Tune".to_string(),
            });
        }
    };

    let bc = match requested_station.as_deref() {
        Some(id) => get_broadcaster(id)
            .await
            .ok_or_else(|| GrimoireError::FederationApiError {
                message: format!("radio: no broadcaster for station '{id}'"),
            })?,
        None => {
            get_default_broadcaster()
                .await
                .ok_or_else(|| GrimoireError::FederationApiError {
                    message: "radio: no default station configured".to_string(),
                })?
        }
    };
    info!(
        "[radio-handler] tune request station_id={:?} resolved_station_id={}",
        requested_station,
        bc.station_id()
    );

    // 2a. per-station auth gate: when `is_public = 0` the requested
    // station is restricted to peers in the federation peer list.
    // public stations skip this check entirely.
    let station_id = bc.station_id().to_string();
    if let Some(station) = get_station(&station_id).await? {
        if station.is_public == 0 {
            let peer_node = conn.remote_id().to_string();
            let allowed = is_known_peer(&peer_node).await;
            if !allowed {
                return Err(GrimoireError::FederationApiError {
                    message: format!(
                        "radio: peer {peer_node} not authorized for private station '{station_id}'"
                    ),
                });
            }
        }
    }

    // 3. subscribe + send Hello.
    let _guard = ListenerGuard::new(bc.clone());
    let listener_count = bc.listener_count();
    let mut sub = bc.subscribe().await;
    let is_timeline_only = bc.is_timeline_only();

    let hello = ControlMessage::Hello(HelloMessage {
        codec: RADIO_CODEC.to_string(),
        now_playing: (*sub.now_playing).clone(),
        listener_count,
        radio_mode_capabilities: bc.radio_mode_capabilities(),
        timeline_seed_active: bc.timeline_seed_active(),
        broadcaster_timeline_only: is_timeline_only,
        current_seq: sub.next_seq,
        init_seq: sub.init_seq,
        current_track_elapsed_ms: bc.current_track_elapsed_ms(),
    });
    write_control_message(&mut ctrl_send, &hello).await?;
    let timeline = ControlMessage::Timeline(bc.timeline_snapshot(/*lookahead_count=*/ 8).await);
    write_control_message(&mut ctrl_send, &timeline).await?;

    // 4–6. session forwarding.
    // timeline-only stations skip the audio uni stream entirely; the
    // broadcaster only pushes control messages (Meta + Timeline).
    // normal stations open an audio uni stream and fan audio + meta.
    let (ctrl_tx, mut ctrl_rx) = mpsc::channel::<ControlMessage>(32);

    let writer_task = async move {
        while let Some(msg) = ctrl_rx.recv().await {
            if let Err(e) = write_control_message(&mut ctrl_send, &msg).await {
                return Err::<(), GrimoireError>(e);
            }
        }
        Ok(())
    };
    tokio::pin!(writer_task);

    let bc_meta = bc.clone();
    let ctrl_tx_meta = ctrl_tx.clone();
    let ctrl_tx_hb = ctrl_tx.clone();
    let bc_hb = bc.clone();

    let end = if is_timeline_only {
        // no audio uni stream — just forward meta + heartbeat.
        info!("[radio-handler] timeline-only session for station '{station_id}'");
        drop(ctrl_tx);
        let writer_tx = ctrl_tx_meta.clone();
        let end = tokio::select! {
            res = &mut writer_task => return res,
            res = forward_meta(&mut sub.meta_rx, ctrl_tx_meta, bc_meta) => res?,
            res = heartbeat(ctrl_tx_hb, bc_hb) => res?,
            // detect closed conns promptly so listener_count decrements
            // within the QUIC keepalive window rather than waiting for
            // a write to actually fail (which can take >30s on idle
            // streams). without this arm, a closed tab keeps inflating
            // the count until the next track change forces a fast
            // burst of writes that finally errors out.
            reason = conn.closed() => {
                info!("[radio-handler] connection closed while idle: {reason:?}");
                SessionEnd::Finished
            }
        };
        (end, writer_tx)
    } else {
        // 4. open the audio uni stream.
        let mut audio_send =
            conn.open_uni()
                .await
                .map_err(|e| GrimoireError::FederationApiError {
                    message: format!("radio: failed to open audio stream: {e}"),
                })?;

        // 5. write current init + catchup chunks.
        if let Some(init) = sub.init.as_ref() {
            write_chunk(&mut audio_send, init).await?;
        }
        for chunk in &sub.catchup {
            write_chunk(&mut audio_send, chunk).await?;
        }

        let bc_audio = bc.clone();
        let ctrl_tx_audio = ctrl_tx.clone();
        drop(ctrl_tx);

        let writer_tx = ctrl_tx_meta.clone();
        let end = tokio::select! {
            res = &mut writer_task => return res,
            res = forward_audio(&mut sub.chunk_rx, &mut audio_send, ctrl_tx_audio, bc_audio) => res?,
            res = forward_meta(&mut sub.meta_rx, ctrl_tx_meta, bc_meta) => res?,
            res = heartbeat(ctrl_tx_hb, bc_hb) => res?,
            // see timeline-only branch above. without this arm, a dead
            // tab keeps the listener_count inflated until QUIC flow
            // control fills up (often only at the next track change).
            reason = conn.closed() => {
                info!("[radio-handler] connection closed while idle: {reason:?}");
                SessionEnd::Finished
            }
        };
        (end, writer_tx)
    };

    let (end, writer_tx) = end;
    match end {
        SessionEnd::Finished => Ok(()),
        SessionEnd::Goodbye(reason) => {
            let _ = writer_tx
                .send(ControlMessage::Goodbye(GoodbyeMessage { reason }))
                .await;
            drop(writer_tx);
            writer_task.await
        }
    }
}

/// emit a `ChunkReady { seq }` every `HEARTBEAT_INTERVAL`. lets clients
/// detect a hung uni stream when audio has gone silent but the control
/// stream is still alive (e.g. QUIC stalls past one direction).
async fn heartbeat(
    tx: mpsc::Sender<ControlMessage>,
    bc: Arc<Broadcaster>,
) -> GrimoireResult<SessionEnd> {
    let mut tick = tokio::time::interval(HEARTBEAT_INTERVAL);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    // skip the immediate initial tick — Hello already carried current_seq.
    tick.tick().await;
    loop {
        tick.tick().await;
        let seq = bc.current_seq();
        if tx
            .send(ControlMessage::ChunkReady(ChunkReadyMessage {
                seq,
                listener_count: bc.listener_count(),
            }))
            .await
            .is_err()
        {
            return Ok(SessionEnd::Finished);
        }
    }
}

async fn forward_audio(
    rx: &mut tokio::sync::broadcast::Receiver<Arc<Chunk>>,
    send: &mut SendStream,
    ctrl_tx: mpsc::Sender<ControlMessage>,
    bc: Arc<Broadcaster>,
) -> GrimoireResult<SessionEnd> {
    loop {
        match rx.recv().await {
            Ok(chunk) => write_chunk(send, &chunk).await?,
            Err(RecvError::Lagged(n)) => {
                // we fell behind by `n` chunks. tell the client where to
                // resume by reading the broadcaster's current init seq.
                let sub = bc.subscribe().await;
                let resync_at_seq = sub.init_seq;
                warn!(
                    "[radio-handler] listener lagged {n} chunks; sending Lag(resync_at_seq={resync_at_seq})"
                );
                let _ = ctrl_tx
                    .send(ControlMessage::Lag(LagMessage { resync_at_seq }))
                    .await;
                // re-prime the audio stream: send the current init + the
                // catchup ring so the listener can pick up immediately
                // without reconnecting.
                if let Some(init) = sub.init.as_ref() {
                    write_chunk(send, init).await?;
                }
                for chunk in &sub.catchup {
                    write_chunk(send, chunk).await?;
                }
                // swap in the fresh receiver so subsequent recvs aren't
                // immediately lagged on the same buffer.
                *rx = sub.chunk_rx;
            }
            Err(RecvError::Closed) => {
                return Ok(SessionEnd::Goodbye("station offline".to_string()))
            }
        }
    }
}

async fn forward_meta(
    rx: &mut tokio::sync::broadcast::Receiver<MetaUpdate>,
    ctrl_tx: mpsc::Sender<ControlMessage>,
    bc: Arc<Broadcaster>,
) -> GrimoireResult<SessionEnd> {
    loop {
        match rx.recv().await {
            Ok(update) => {
                let msg = ControlMessage::Meta(MetaMessage {
                    now_playing: (*update.now_playing).clone(),
                    listener_count: bc.listener_count(),
                    init_seq: update.init_seq,
                });
                if ctrl_tx.send(msg).await.is_err() {
                    return Ok(SessionEnd::Finished);
                }
                let timeline = ControlMessage::Timeline(bc.timeline_snapshot(8).await);
                if ctrl_tx.send(timeline).await.is_err() {
                    return Ok(SessionEnd::Finished);
                }
            }
            Err(RecvError::Lagged(_)) => {
                // missed updates — push the current snapshot.
                let sub = bc.subscribe().await;
                let msg = ControlMessage::Meta(MetaMessage {
                    now_playing: (*sub.now_playing).clone(),
                    listener_count: bc.listener_count(),
                    init_seq: sub.init_seq,
                });
                if ctrl_tx.send(msg).await.is_err() {
                    return Ok(SessionEnd::Finished);
                }
                let timeline = ControlMessage::Timeline(bc.timeline_snapshot(8).await);
                if ctrl_tx.send(timeline).await.is_err() {
                    return Ok(SessionEnd::Finished);
                }
            }
            Err(RecvError::Closed) => {
                return Ok(SessionEnd::Goodbye("station offline".to_string()))
            }
        }
    }
}

/// RAII guard for the broadcaster's listener count.
struct ListenerGuard {
    bc: Arc<Broadcaster>,
}

impl ListenerGuard {
    fn new(bc: Arc<Broadcaster>) -> Self {
        let n = bc.join();
        info!("[radio-handler] listener joined; total now {n}");
        Self { bc }
    }
}

impl Drop for ListenerGuard {
    fn drop(&mut self) {
        let n = self.bc.leave();
        info!("[radio-handler] listener left; total now {n}");
    }
}
