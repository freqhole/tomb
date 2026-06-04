//! `freqhole-events/1` ALPN protocol — bi-directional job event streaming
//!
//! dedicated channel for typed job-lifecycle event subscriptions. one
//! subscription per bi-stream; the wire format is newline-delimited JSON
//! (matches the existing json-over-bistream convention in this crate, but
//! framed by `\n` so reader and writer can both progress concurrently).
//!
//! the plan in `docs/bidirectional-job-progress-plan.md` (p4) describes
//! the flow:
//!
//! 1. peer dials this ALPN and opens a bi-stream
//! 2. server resolves `Caller` via `get_caller_for_peer(peer_id)`; if
//!    unresolved -> `Close { Unauthorized }` and exit
//! 3. peer writes `Subscribe { id, filter }` (one line of JSON)
//! 4. server replies with `Snapshot { id, items }`
//! 5. server forwards each `Event { id, evt }` from
//!    `job_events::subscribe_filtered` until stream end / lag / unsubscribe
//! 6. peer may write `Unsubscribe { id }` at any time; server replies
//!    `Close { ClientUnsubscribed }` and finishes
//!
//! visibility is per-event via `caller_can_see` (already baked into
//! `subscribe_filtered`). this layer only authenticates the subscriber.

use crate::federation::transport::handler::get_caller_for_peer;
use crate::jobs::job_events::{self, CloseReason, EventFilter, JobEvent, JobStateSnapshot};
use crate::offal::Caller;
use futures_util::StreamExt;
use iroh::endpoint::Connection;
use iroh::protocol::{AcceptError, ProtocolHandler};
use iroh::PublicKey;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tracing::{debug, info, warn};

/// ALPN protocol identifier for the bi-directional job event channel.
pub const EVENTS_ALPN: &[u8] = b"freqhole-events/1";

/// messages a subscriber sends on the events channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EventsClientMsg {
    /// open a subscription with the given filter. server must reply
    /// with `Snapshot` then 0..N `Event` messages.
    Subscribe { id: u64, filter: EventFilter },
    /// tear down the subscription. server replies with
    /// `Close { ClientUnsubscribed }` and finishes the stream.
    Unsubscribe { id: u64 },
}

/// messages the server emits on the events channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EventsServerMsg {
    /// one-shot hydration of currently-active jobs that match the filter
    /// and the caller's visibility.
    Snapshot {
        id: u64,
        items: Vec<JobStateSnapshot>,
    },
    /// a single live event matching the filter.
    Event { id: u64, evt: JobEvent },
    /// terminal frame; no more events on this stream.
    Close { id: u64, reason: CloseReason },
}

/// ProtocolHandler wrapper so the events ALPN can be registered on the
/// iroh Router alongside `freqhole/1` and `freqhole-blobz`.
#[derive(Debug, Clone)]
pub struct EventsProtocol {
    _inner: Arc<()>,
}

impl EventsProtocol {
    pub fn new() -> Self {
        Self {
            _inner: Arc::new(()),
        }
    }
}

impl Default for EventsProtocol {
    fn default() -> Self {
        Self::new()
    }
}

impl ProtocolHandler for EventsProtocol {
    async fn accept(&self, conn: Connection) -> std::result::Result<(), AcceptError> {
        let peer_id = conn.remote_id();
        info!(
            "[events-protocol] accepted connection from peer: {}",
            peer_id
        );
        handle_incoming(peer_id, conn).await;
        Ok(())
    }

    async fn shutdown(&self) {
        info!("[events-protocol] shutting down");
    }
}

/// handle an incoming events connection.
///
/// accepts streams in a loop and spawns one task per bi-stream. each
/// task lives for the lifetime of a single subscription.
pub async fn handle_incoming(peer_node_id: PublicKey, conn: iroh::endpoint::Connection) {
    let node_id_str = peer_node_id.to_string();
    let node_id_short = node_id_str.chars().take(16).collect::<String>();

    // accept multiple subscriptions per connection (each on its own
    // bi-stream). pre-resolve the caller once and clone into tasks.
    let caller = get_caller_for_peer(&node_id_str).await;
    if caller.is_none() {
        warn!(
            "[events-p2p] rejecting events connection from unknown peer: {}",
            node_id_short
        );
        conn.close(1u32.into(), b"unauthorized");
        return;
    }
    let caller = caller.unwrap();
    info!(
        "[events-p2p] accepted events connection from {} (user={})",
        node_id_short, caller.username
    );

    loop {
        match conn.accept_bi().await {
            Ok((send, recv)) => {
                let caller = caller.clone();
                let node_id_short = node_id_short.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_stream(send, recv, caller, &node_id_short).await {
                        warn!("[events-p2p] stream error from {}: {}", node_id_short, e);
                    }
                });
            }
            Err(e) => {
                info!(
                    "[events-p2p] connection closed from {}: {}",
                    node_id_short, e
                );
                break;
            }
        }
    }
}

/// handle one bi-stream: read `Subscribe`, send `Snapshot`, forward live
/// events, watch for `Unsubscribe`, terminate with `Close`.
async fn handle_stream(
    mut send: iroh::endpoint::SendStream,
    recv: iroh::endpoint::RecvStream,
    caller: Caller,
    node_id_short: &str,
) -> Result<(), String> {
    let mut reader = BufReader::new(recv);

    // read the first line (Subscribe).
    let mut line = String::new();
    let n = reader
        .read_line(&mut line)
        .await
        .map_err(|e| format!("failed to read subscribe frame: {}", e))?;
    if n == 0 {
        return Err("stream closed before subscribe".to_string());
    }

    let req: EventsClientMsg = serde_json::from_str(line.trim_end())
        .map_err(|e| format!("failed to parse subscribe frame: {}", e))?;

    let (id, filter) = match req {
        EventsClientMsg::Subscribe { id, filter } => (id, filter),
        EventsClientMsg::Unsubscribe { id } => {
            // peer sent unsubscribe without subscribing — echo a close and
            // finish so they don't hang waiting for a frame.
            write_msg(
                &mut send,
                &EventsServerMsg::Close {
                    id,
                    reason: CloseReason::ClientUnsubscribed,
                },
            )
            .await?;
            send.finish()
                .map_err(|e| format!("failed to finish stream: {}", e))?;
            return Ok(());
        }
    };

    info!(
        "[events-p2p] subscribe id={} from {} (user={})",
        id, node_id_short, caller.username
    );

    // 1. send the snapshot first.
    let items = job_events::snapshot(&filter, &caller).await;
    write_msg(&mut send, &EventsServerMsg::Snapshot { id, items }).await?;

    // 2. open the live event stream and forward.
    let live = job_events::subscribe_filtered(filter, caller.clone());
    let mut live = Box::pin(live);

    // persistent buffer for inbound client frames. select! may cancel an
    // in-flight read_line; reset the buffer at the top of each iteration
    // so a partial read on a cancelled future doesn't contaminate the
    // next attempt.
    let mut inbox = String::new();

    // concurrently read for Unsubscribe.
    loop {
        inbox.clear();
        tokio::select! {
            biased;

            // unsubscribe / disconnect detection.
            read = reader.read_line(&mut inbox) => {
                match read {
                    Ok(0) => {
                        debug!(
                            "[events-p2p] peer closed read side (id={}, peer={})",
                            id, node_id_short
                        );
                        // best-effort close frame; peer may already be gone.
                        let _ = write_msg(
                            &mut send,
                            &EventsServerMsg::Close {
                                id,
                                reason: CloseReason::ClientUnsubscribed,
                            },
                        )
                        .await;
                        break;
                    }
                    Ok(_) => {
                        // treat any inbound frame as an unsubscribe for v1.
                        // (parsing the frame and matching `Unsubscribe { id }`
                        // is left for a follow-up — the only message a peer
                        // sends post-subscribe today is unsubscribe.)
                        info!(
                            "[events-p2p] unsubscribe id={} from {}",
                            id, node_id_short
                        );
                        write_msg(
                            &mut send,
                            &EventsServerMsg::Close {
                                id,
                                reason: CloseReason::ClientUnsubscribed,
                            },
                        )
                        .await?;
                        break;
                    }
                    Err(e) => {
                        warn!(
                            "[events-p2p] read error on stream id={} peer={}: {}",
                            id, node_id_short, e
                        );
                        let _ = write_msg(
                            &mut send,
                            &EventsServerMsg::Close {
                                id,
                                reason: CloseReason::Internal(format!("read error: {}", e)),
                            },
                        )
                        .await;
                        break;
                    }
                }
            }

            evt = live.next() => {
                match evt {
                    Some(Ok(evt)) => {
                        if let Err(e) = write_msg(&mut send, &EventsServerMsg::Event { id, evt }).await {
                            warn!(
                                "[events-p2p] write error on stream id={} peer={}: {}",
                                id, node_id_short, e
                            );
                            break;
                        }
                    }
                    Some(Err(reason)) => {
                        // broker signaled a terminal close (lag, etc).
                        let _ = write_msg(
                            &mut send,
                            &EventsServerMsg::Close { id, reason },
                        )
                        .await;
                        break;
                    }
                    None => {
                        // broker stream ended (sender dropped).
                        let _ = write_msg(
                            &mut send,
                            &EventsServerMsg::Close {
                                id,
                                reason: CloseReason::Internal(
                                    "broker stream ended".to_string(),
                                ),
                            },
                        )
                        .await;
                        break;
                    }
                }
            }
        }
    }

    send.finish()
        .map_err(|e| format!("failed to finish stream: {}", e))?;
    Ok(())
}

/// write one newline-delimited JSON frame.
async fn write_msg(
    send: &mut iroh::endpoint::SendStream,
    msg: &EventsServerMsg,
) -> Result<(), String> {
    let mut bytes =
        serde_json::to_vec(msg).map_err(|e| format!("failed to serialize events frame: {}", e))?;
    bytes.push(b'\n');
    send.write_all(&bytes)
        .await
        .map_err(|e| format!("failed to write events frame: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jobs::job_events::EntityRef;
    use crate::jobs::JobType;

    #[test]
    fn subscribe_message_roundtrip() {
        let msg = EventsClientMsg::Subscribe {
            id: 42,
            filter: EventFilter {
                kinds: Some(vec![JobType::MbAlbumSearch]),
                job_ids: None,
                session_ids: None,
                entity_refs: Some(vec![EntityRef::Album("alb-1".to_string())]),
            },
        };
        let s = serde_json::to_string(&msg).unwrap();
        let back: EventsClientMsg = serde_json::from_str(&s).unwrap();
        match back {
            EventsClientMsg::Subscribe { id, filter } => {
                assert_eq!(id, 42);
                assert_eq!(filter.kinds.as_ref().unwrap().len(), 1);
                assert_eq!(filter.entity_refs.as_ref().unwrap().len(), 1);
            }
            _ => panic!("expected Subscribe"),
        }
    }

    #[test]
    fn unsubscribe_message_roundtrip() {
        let msg = EventsClientMsg::Unsubscribe { id: 7 };
        let s = serde_json::to_string(&msg).unwrap();
        let back: EventsClientMsg = serde_json::from_str(&s).unwrap();
        assert!(matches!(back, EventsClientMsg::Unsubscribe { id: 7 }));
    }

    #[test]
    fn server_close_message_roundtrip() {
        let msg = EventsServerMsg::Close {
            id: 1,
            reason: CloseReason::ClientUnsubscribed,
        };
        let s = serde_json::to_string(&msg).unwrap();
        let back: EventsServerMsg = serde_json::from_str(&s).unwrap();
        match back {
            EventsServerMsg::Close { id, reason } => {
                assert_eq!(id, 1);
                assert!(matches!(reason, CloseReason::ClientUnsubscribed));
            }
            _ => panic!("expected Close"),
        }
    }

    #[test]
    fn server_snapshot_message_roundtrip() {
        let msg = EventsServerMsg::Snapshot {
            id: 9,
            items: vec![],
        };
        let s = serde_json::to_string(&msg).unwrap();
        let back: EventsServerMsg = serde_json::from_str(&s).unwrap();
        match back {
            EventsServerMsg::Snapshot { id, items } => {
                assert_eq!(id, 9);
                assert!(items.is_empty());
            }
            _ => panic!("expected Snapshot"),
        }
    }

    #[test]
    fn alpn_is_freqhole_events_v1() {
        assert_eq!(EVENTS_ALPN, b"freqhole-events/1");
    }
}
