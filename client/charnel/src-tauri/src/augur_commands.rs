//! charnel-side ipc bridge for augur's "nearby devices" browse feed - see
//! `haruspex::augur::subscribe()`'s own doc comment for the underlying
//! mechanism (lan discovery over mdns/dns-sd).
//!
//! mirrors `jobs_events_commands.rs`'s shape: a `Channel<Frame>` per
//! subscription, sessions tracked in a process-local map,
//! `unsubscribe` aborts the spawned forwarder - which also drops
//! augur's own `DiscoveryGuard`, so the native browse session actually
//! stops (not just the forwarding) once nobody's subscribed anymore,
//! rather than scanning in the background indefinitely.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use n0_future::StreamExt;
use serde::Serialize;
use tauri::ipc::Channel;
use tokio::task::JoinHandle;

/// outbound frame on the per-session tauri channel - a trimmed-down,
/// json-friendly projection of `haruspex::augur::DiscoveredPeer` (whose
/// own `EndpointInfo` payload isn't `Serialize` and carries more than the
/// add-remote ui needs anyway).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum NearbyPeerFrame {
    /// a peer was found (or its advertised info changed).
    Found {
        node_id: String,
        /// the peer's self-reported display name/instance label, if it
        /// set one - absent for most peers today (nothing populates this
        /// yet on the publishing side either).
        user_data: Option<String>,
    },
    /// a previously-found peer disappeared.
    Lost { node_id: String },
}

struct Session {
    handle: JoinHandle<()>,
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
    format!("nearby-peers-{now}-{n}")
}

fn drop_session(session_id: &str) {
    if let Some(map) = sessions().as_mut() {
        if let Some(session) = map.remove(session_id) {
            session.handle.abort();
        }
    }
}

/// opens a "browse nearby devices" subscription for the add-remote ui.
/// returns an opaque `session_id` the caller passes to
/// `nearby_peers_unsubscribe` once done (e.g. the modal closing) - this
/// is the one thing that actually stops the underlying mdns browse
/// session, so callers should always pair this with an unsubscribe,
/// not just let the frontend component unmount silently.
///
/// errors if the federation endpoint isn't running yet (nothing to
/// browse from).
#[tauri::command]
pub async fn nearby_peers_subscribe(events: Channel<NearbyPeerFrame>) -> Result<String, String> {
    let endpoint =
        grimoire::federation::p2p_client::get_endpoint_arc().map_err(|e| e.to_string())?;
    let local_node_id = endpoint.id();
    let session_id = next_session_id();

    tracing::info!(session = %session_id, "[augur-charnel] nearby-peers subscribe");

    let mut stream = haruspex::augur::subscribe(local_node_id).await;
    let handle = tokio::spawn(async move {
        while let Some(peer) = stream.next().await {
            let frame = match peer {
                haruspex::augur::DiscoveredPeer::Found {
                    endpoint_id,
                    endpoint_info,
                } => NearbyPeerFrame::Found {
                    node_id: endpoint_id.to_string(),
                    user_data: endpoint_info.user_data().map(ToString::to_string),
                },
                haruspex::augur::DiscoveredPeer::Lost { endpoint_id } => NearbyPeerFrame::Lost {
                    node_id: endpoint_id.to_string(),
                },
            };
            if events.send(frame).is_err() {
                // js side dropped the channel; nothing more to do.
                break;
            }
        }
    });

    sessions()
        .as_mut()
        .unwrap()
        .insert(session_id.clone(), Session { handle });

    Ok(session_id)
}

/// tears down a previously-opened subscription. safe to call
/// repeatedly; unknown ids are silently ignored.
#[tauri::command]
pub fn nearby_peers_unsubscribe(session_id: String) -> Result<(), String> {
    drop_session(&session_id);
    Ok(())
}
