//! charnel-side ipc bridge for the grimoire radio-queue events broker.
//!
//! mirrors `jobs_events_commands.rs`'s shape (a `Channel<Frame>` per
//! subscription, sessions tracked in a process-local map, `unsubscribe`
//! aborts the spawned forwarder) - deliberately a sibling module rather
//! than a generalized one, matching `events_protocol.rs`'s own dispatch
//! (each domain's match arm is its own small bit of code; only the
//! fiddly concurrent forwarding loop is actually shared).
//!
//! no snapshot command here: unlike jobs (which bypasses the generic
//! request/response path for perf), the existing `radio_list_requests`
//! route already works transparently against local or remote stations
//! through the normal `client.app.radioListRequests` call - this module
//! only needs to add the *live push* half.
//!
//! when `target_peer` is `None`, routes through the in-process broker
//! (skips the iroh hop entirely, and skips caller resolution too - the
//! request queue has no per-event visibility check, see
//! `grimoire::radio::queue_events`'s doc comment). when `target_peer` is
//! `Some(peer_addr)`, dials the remote peer via
//! `grimoire::federation::transport::subscribe_radio_queue_events_remote`
//! using the shared `freqhole-events/1` ALPN.

use futures_util::StreamExt;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tokio::task::JoinHandle;

use grimoire::federation::transport::EventsServerMsg;
use grimoire::jobs::job_events::CloseReason;
use grimoire::radio::queue_events::{self, RadioQueueEvent, RadioQueueEventFilter};

/// outbound frame on the per-session tauri channel - same shape as
/// `jobs_events_commands::JobsEventsFrame`, just carrying a
/// `RadioQueueEvent` payload instead.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RadioQueueEventsFrame {
    /// live broker event (submitted/removed/reordered/cleared).
    Event { evt: Box<RadioQueueEvent> },
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
    format!("radio-queue-events-{now}-{n}")
}

fn drop_session(session_id: &str) {
    if let Some(map) = sessions().as_mut() {
        if let Some(session) = map.remove(session_id) {
            session.handle.abort();
        }
    }
}

/// open a subscription for one station's request queue. returns an
/// opaque `session_id` the caller passes to
/// `radio_queue_events_unsubscribe`.
///
/// when `target_peer` is `Some(peer_addr)`, dials the remote peer via
/// `freqhole-events/1` and forwards frames into `events`. when `None`,
/// routes through the in-process broker.
#[tauri::command]
pub async fn radio_queue_events_subscribe(
    filter: RadioQueueEventFilter,
    events: Channel<RadioQueueEventsFrame>,
    target_peer: Option<String>,
) -> Result<String, String> {
    let session_id = next_session_id();

    if let Some(peer_addr) = target_peer {
        tracing::info!(
            session = %session_id,
            peer = %peer_addr,
            station = %filter.station_id,
            "[radio-queue-events-charnel] subscribing (remote)"
        );

        let mut stream = grimoire::federation::transport::subscribe_radio_queue_events_remote(
            &peer_addr, filter,
        )
        .await
        .map_err(|e| e.to_string())?;

        let task_session_id = session_id.clone();
        let handle = tokio::spawn(async move {
            loop {
                match stream.next_frame().await {
                    Some(EventsServerMsg::RadioQueueEvent { evt, .. }) => {
                        if events
                            .send(RadioQueueEventsFrame::Event { evt: Box::new(evt) })
                            .is_err()
                        {
                            break;
                        }
                    }
                    Some(EventsServerMsg::Close { reason, .. }) => {
                        let _ = events.send(RadioQueueEventsFrame::Closed { reason });
                        break;
                    }
                    // consume the initial snapshot frame silently - the
                    // js side already has its own snapshot via
                    // `radioListRequests`.
                    Some(EventsServerMsg::RadioQueueSnapshot { .. }) => {}
                    // this command only ever subscribes via
                    // `EventsClientMsg::SubscribeRadioQueue` - a job-event
                    // frame arriving here would mean something else is
                    // wrong, not a normal case to silently ignore.
                    Some(EventsServerMsg::Snapshot { .. } | EventsServerMsg::Event { .. }) => {
                        tracing::warn!(
                            session = %task_session_id,
                            "[radio-queue-events-charnel] unexpected job-event frame on a radio-queue subscription"
                        );
                    }
                    None => {
                        let _ = events.send(RadioQueueEventsFrame::Closed {
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

    tracing::info!(
        session = %session_id,
        station = %filter.station_id,
        "[radio-queue-events-charnel] subscribing (local)"
    );

    let handle = tokio::spawn(async move {
        let stream = queue_events::subscribe_filtered(filter);
        let mut stream = Box::pin(stream);
        loop {
            match stream.next().await {
                Some(Ok(evt)) => {
                    if events
                        .send(RadioQueueEventsFrame::Event { evt: Box::new(evt) })
                        .is_err()
                    {
                        // js side dropped the channel; nothing more to do.
                        break;
                    }
                }
                Some(Err(reason)) => {
                    let _ = events.send(RadioQueueEventsFrame::Closed { reason });
                    break;
                }
                None => {
                    let _ = events.send(RadioQueueEventsFrame::Closed {
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
pub fn radio_queue_events_unsubscribe(session_id: String) -> Result<(), String> {
    drop_session(&session_id);
    Ok(())
}
