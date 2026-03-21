//! grimoire event system
//!
//! provides a broadcast channel for internal events that can be
//! subscribed to by consumers (e.g., tauri app for real-time UI updates).

use once_cell::sync::Lazy;
use serde::Serialize;
use tokio::sync::broadcast;

/// events that can be emitted from grimoire
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GrimoireEvent {
    /// a new knock request was created
    KnockCreated {
        id: String,
        username: String,
        node_id: String,
        message: String,
    },
    /// a knock request was processed (accepted/rejected)
    KnockProcessed {
        id: String,
        status: String,
        username: String,
    },
    /// job progress update - emitted after import jobs complete
    JobProgress {
        /// session_id for tracking related jobs
        session_id: String,
        /// directory being processed (parent of file)
        directory: String,
        /// total songs added so far in this session
        songs_added: u32,
        /// jobs remaining in this session
        jobs_pending: u32,
        /// total jobs in this session
        jobs_total: u32,
    },
    /// job session completed - all jobs in session finished
    JobSessionComplete {
        session_id: String,
        songs_added: u32,
        albums_added: u32,
        artists_added: u32,
    },
}

/// the global event channel
/// uses broadcast so multiple subscribers can receive events
static EVENTS: Lazy<broadcast::Sender<GrimoireEvent>> = Lazy::new(|| {
    let (tx, _) = broadcast::channel(100);
    tx
});

/// emit an event to all subscribers
///
/// safe to call even if no one is listening - events are dropped silently
pub fn emit(event: GrimoireEvent) {
    let _ = EVENTS.send(event);
}

/// subscribe to receive events
///
/// returns a receiver that will get all events emitted after subscription.
/// if you fall behind, older events will be dropped (lagged).
pub fn subscribe() -> broadcast::Receiver<GrimoireEvent> {
    EVENTS.subscribe()
}
