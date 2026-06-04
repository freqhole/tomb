//! charnel-side ipc bridge for the grimoire job events broker.
//!
//! mirrors `radio_commands.rs` shape: a `Channel<JobEvent>` per
//! subscription, sessions tracked in a process-local map, and
//! `unsubscribe` aborts the spawned forwarder.
//!
//! when `target_peer` is `None`, routes through the in-process broker
//! (skips the iroh hop entirely). when `target_peer` is `Some(peer_addr)`,
//! dials the remote peer via `grimoire::federation::transport::events_client`
//! using the `freqhole-events/1` ALPN.

use futures_util::StreamExt;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tokio::task::JoinHandle;

use grimoire::federation::transport::EventsServerMsg;
use grimoire::jobs::job_events::{self, CloseReason, EventFilter, JobEvent, JobStateSnapshot};

use crate::commands::get_caller_from_app_config;

/// outbound frame on the per-session tauri channel.
///
/// mirrors `EventsServerMsg` from the iroh wire format but flattened
/// to a single tagged enum so the spume side can switch on `kind`
/// regardless of transport.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum JobsEventsFrame {
    /// live broker event (status/progress/stage/etc).
    Event { evt: JobEvent },
    /// terminal frame; no further events on this channel.
    Closed { reason: CloseReason },
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
    format!("jobs-events-{now}-{n}")
}

fn drop_session(session_id: &str) {
    if let Some(map) = sessions().as_mut() {
        if let Some(session) = map.remove(session_id) {
            session.handle.abort();
        }
    }
}

/// one-shot snapshot of currently-active jobs matching `filter` and
/// visible to the logged-in caller (or caller on the remote peer).
/// when `target_peer` is provided, fetches from that peer via iroh.
#[tauri::command]
pub async fn jobs_events_snapshot(
    app_handle: tauri::AppHandle,
    filter: Option<EventFilter>,
    target_peer: Option<String>,
) -> Result<Vec<JobStateSnapshot>, String> {
    let filter = filter.unwrap_or_default();

    if let Some(peer_addr) = target_peer {
        return grimoire::federation::transport::snapshot_events_remote(&peer_addr, filter)
            .await
            .map_err(|e| e.to_string());
    }

    let caller = get_caller_from_app_config(&app_handle)?;
    Ok(job_events::snapshot(&filter, &caller).await)
}

/// open a subscription. returns an opaque `session_id` the caller passes
/// to `jobs_events_unsubscribe`.
///
/// when `target_peer` is `Some(peer_addr)`, dials the remote peer via
/// `freqhole-events/1` and forwards frames into `events`. when `None`,
/// routes through the in-process broker.
///
/// the spawned task forwards each broker event into `events` as a
/// `JobsEventsFrame::Event { evt }`. on broker-side close (lag, etc.)
/// or stream end, it emits one `JobsEventsFrame::Closed { reason }`
/// and exits.
#[tauri::command]
pub async fn jobs_events_subscribe(
    app_handle: tauri::AppHandle,
    filter: Option<EventFilter>,
    events: Channel<JobsEventsFrame>,
    target_peer: Option<String>,
) -> Result<String, String> {
    let filter = filter.unwrap_or_default();
    let session_id = next_session_id();

    if let Some(peer_addr) = target_peer {
        tracing::info!(
            session = %session_id,
            peer = %peer_addr,
            "[jobs-events-charnel] subscribing (remote)"
        );

        let mut stream =
            grimoire::federation::transport::subscribe_events_remote(&peer_addr, filter)
                .await
                .map_err(|e| e.to_string())?;

        let handle = tokio::spawn(async move {
            loop {
                match stream.next_frame().await {
                    Some(EventsServerMsg::Event { evt, .. }) => {
                        if events.send(JobsEventsFrame::Event { evt }).is_err() {
                            break;
                        }
                    }
                    Some(EventsServerMsg::Close { reason, .. }) => {
                        let _ = events.send(JobsEventsFrame::Closed { reason });
                        break;
                    }
                    // consume the initial snapshot frame silently
                    Some(EventsServerMsg::Snapshot { .. }) => {}
                    None => {
                        let _ = events.send(JobsEventsFrame::Closed {
                            reason: CloseReason::Internal("remote stream ended".to_string()),
                        });
                        break;
                    }
                }
            }
        });

        sessions()
            .as_mut()
            .unwrap()
            .insert(session_id.clone(), Session { handle });

        return Ok(session_id);
    }

    let caller = get_caller_from_app_config(&app_handle)?;

    tracing::info!(
        session = %session_id,
        user = %caller.username,
        "[jobs-events-charnel] subscribing (local)"
    );

    let handle = tokio::spawn(async move {
        let stream = job_events::subscribe_filtered(filter, caller);
        let mut stream = Box::pin(stream);
        loop {
            match stream.next().await {
                Some(Ok(evt)) => {
                    if events.send(JobsEventsFrame::Event { evt }).is_err() {
                        // js side dropped the channel; nothing more to do.
                        break;
                    }
                }
                Some(Err(reason)) => {
                    let _ = events.send(JobsEventsFrame::Closed { reason });
                    break;
                }
                None => {
                    let _ = events.send(JobsEventsFrame::Closed {
                        reason: CloseReason::Internal("broker stream ended".to_string()),
                    });
                    break;
                }
            }
        }
    });

    sessions()
        .as_mut()
        .unwrap()
        .insert(session_id.clone(), Session { handle });

    Ok(session_id)
}

/// tear down a previously-opened subscription. safe to call
/// repeatedly; unknown ids are silently ignored.
#[tauri::command]
pub fn jobs_events_unsubscribe(session_id: String) -> Result<(), String> {
    drop_session(&session_id);
    Ok(())
}
