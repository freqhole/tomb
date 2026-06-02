//! outbound `freqhole-events/1` client
//!
//! dials a remote peer, opens a bi-stream, and either takes a one-shot
//! snapshot or returns a long-lived `EventsRemoteStream` handle for
//! continuous subscription forwarding.
//!
//! mirrors `admin_client.rs` in structure. the wire format is
//! newline-delimited JSON (one line per message) — same as the server side
//! in `events_protocol.rs`.

use std::sync::atomic::{AtomicU64, Ordering};

use tokio::io::{AsyncBufReadExt, BufReader};
use tracing::debug;

use crate::error::{GrimoireError, GrimoireResult};
use crate::federation::p2p_client::parse_peer_address;
use crate::federation::transport::events_protocol::{
    EventsClientMsg, EventsServerMsg, EVENTS_ALPN,
};
use crate::jobs::job_events::{EventFilter, JobStateSnapshot};

static REQUEST_ID: AtomicU64 = AtomicU64::new(1);

fn next_id() -> u64 {
    REQUEST_ID.fetch_add(1, Ordering::SeqCst)
}

fn serialize_msg(msg: &EventsClientMsg) -> GrimoireResult<Vec<u8>> {
    let mut bytes = serde_json::to_vec(msg).map_err(|e| GrimoireError::FederationApiError {
        message: format!("failed to serialize events client message: {}", e),
    })?;
    bytes.push(b'\n');
    Ok(bytes)
}

/// one-shot snapshot of currently-active jobs on a remote peer.
///
/// opens a connection on `EVENTS_ALPN`, subscribes, reads the snapshot
/// frame, unsubscribes (best-effort), and returns the items.
pub async fn snapshot_events_remote(
    peer_addr: &str,
    filter: EventFilter,
) -> GrimoireResult<Vec<JobStateSnapshot>> {
    let endpoint = crate::federation::p2p_client::get_endpoint_arc()?;
    let addr = parse_peer_address(peer_addr)?;
    let node_id_short = addr.id.to_string()[..16.min(addr.id.to_string().len())].to_string();
    let id = next_id();

    debug!(
        "[events-p2p-client] snapshot from {} (id={})",
        node_id_short, id
    );

    let conn = endpoint.connect(addr, EVENTS_ALPN).await.map_err(|e| {
        GrimoireError::FederationApiError {
            message: format!(
                "failed to connect to events endpoint on {}: {}",
                node_id_short, e
            ),
        }
    })?;

    let (mut send, recv) = conn
        .open_bi()
        .await
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("failed to open events stream on {}: {}", node_id_short, e),
        })?;

    // write Subscribe
    let sub_bytes = serialize_msg(&EventsClientMsg::Subscribe {
        id,
        filter: filter.clone(),
    })?;
    send.write_all(&sub_bytes)
        .await
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("failed to write subscribe frame: {}", e),
        })?;

    // read Snapshot
    let mut reader = BufReader::new(recv);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .await
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("failed to read snapshot frame: {}", e),
        })?;

    let msg: EventsServerMsg =
        serde_json::from_str(line.trim_end()).map_err(|e| GrimoireError::FederationApiError {
            message: format!("failed to parse snapshot frame: {}", e),
        })?;

    let items = match msg {
        EventsServerMsg::Snapshot { items, .. } => items,
        EventsServerMsg::Close { reason, .. } => {
            return Err(GrimoireError::FederationApiError {
                message: format!("events stream closed before snapshot: {:?}", reason),
            });
        }
        other => {
            return Err(GrimoireError::FederationApiError {
                message: format!("unexpected frame before snapshot: {:?}", other),
            });
        }
    };

    // best-effort unsubscribe
    if let Ok(unsub) = serialize_msg(&EventsClientMsg::Unsubscribe { id }) {
        let _ = send.write_all(&unsub).await;
    }
    let _ = send.finish();

    Ok(items)
}

/// long-lived events subscription to a remote peer.
///
/// opens a connection on `EVENTS_ALPN`, writes `Subscribe`, and returns
/// an `EventsRemoteStream` handle. the caller consumes frames via
/// `next_frame` and closes via `unsubscribe`.
pub async fn subscribe_events_remote(
    peer_addr: &str,
    filter: EventFilter,
) -> GrimoireResult<EventsRemoteStream> {
    let endpoint = crate::federation::p2p_client::get_endpoint_arc()?;
    let addr = parse_peer_address(peer_addr)?;
    let node_id_short = addr.id.to_string()[..16.min(addr.id.to_string().len())].to_string();
    let id = next_id();

    debug!(
        "[events-p2p-client] subscribe from {} (id={})",
        node_id_short, id
    );

    let conn = endpoint.connect(addr, EVENTS_ALPN).await.map_err(|e| {
        GrimoireError::FederationApiError {
            message: format!(
                "failed to connect to events endpoint on {}: {}",
                node_id_short, e
            ),
        }
    })?;

    let (mut send, recv) = conn
        .open_bi()
        .await
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("failed to open events stream on {}: {}", node_id_short, e),
        })?;

    let sub_bytes = serialize_msg(&EventsClientMsg::Subscribe { id, filter })?;
    send.write_all(&sub_bytes)
        .await
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("failed to write subscribe frame: {}", e),
        })?;

    Ok(EventsRemoteStream {
        id,
        send,
        reader: BufReader::new(recv),
    })
}

/// handle to an open remote events subscription.
///
/// call `next_frame` in a loop to receive server frames; call
/// `unsubscribe` to tear down cleanly.
pub struct EventsRemoteStream {
    id: u64,
    send: iroh::endpoint::SendStream,
    reader: BufReader<iroh::endpoint::RecvStream>,
}

impl EventsRemoteStream {
    /// read the next ndjson frame from the server.
    ///
    /// returns `None` on stream EOF (peer closed without a `Close` frame).
    pub async fn next_frame(&mut self) -> Option<EventsServerMsg> {
        let mut line = String::new();
        match self.reader.read_line(&mut line).await {
            Ok(0) => None,
            Ok(_) => serde_json::from_str(line.trim_end()).ok(),
            Err(_) => None,
        }
    }

    /// write `Unsubscribe` and close the send side.
    pub async fn unsubscribe(mut self) {
        if let Ok(bytes) = serialize_msg(&EventsClientMsg::Unsubscribe { id: self.id }) {
            let _ = self.send.write_all(&bytes).await;
        }
        let _ = self.send.finish();
    }
}
