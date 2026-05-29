//! charnel-side ipc bridge for the grimoire job events broker.
//!
//! mirrors `radio_commands.rs` shape: a `Channel<JobEvent>` per
//! subscription, sessions tracked in a process-local map, and
//! `unsubscribe` aborts the spawned forwarder. this is the *local*
//! shortcut — when charnel is talking to the in-process grimoire
//! server it skips the iroh `freqhole-events/1` hop entirely.
//!
//! the remote path (open an `EVENTS_ALPN` bistream against a peer
//! and forward frames into the same tauri channel) is intentionally
//! deferred to a follow-up: it shares the wire protocol from
//! `grimoire::federation::transport::events_protocol` but needs the
//! "currently-targeted remote peer" wiring that p6 introduces.

use futures_util::StreamExt;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tokio::task::JoinHandle;

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
/// visible to the logged-in caller. no subscription is opened.
#[tauri::command]
pub async fn jobs_events_snapshot(
    app_handle: tauri::AppHandle,
    filter: Option<EventFilter>,
) -> Result<Vec<JobStateSnapshot>, String> {
    let caller = get_caller_from_app_config(&app_handle)?;
    let filter = filter.unwrap_or_default();
    Ok(job_events::snapshot(&filter, &caller).await)
}

/// open a subscription against the in-process broker. returns an
/// opaque `session_id` the caller passes to `jobs_events_unsubscribe`.
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
) -> Result<String, String> {
    let caller = get_caller_from_app_config(&app_handle)?;
    let filter = filter.unwrap_or_default();

    let session_id = next_session_id();
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
