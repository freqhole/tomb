//! phase 9.0 / 9.1 — typed job-lifecycle events.
//!
//! a separate broadcast channel from the existing `crate::events::EVENTS`
//! so subscribers (tauri bridge, future jobz alpn, http poll wrapper) can
//! tail just the job lifecycle without filtering through unrelated event
//! variants. payload is a typed `JobEvent` enum that derives `ZodSchema`
//! so the offal streaming codegen can render a typed async-iterable on
//! the client side (phase 9.2+).
//!
//! emit points (today):
//!   - `update_session_progress` -> `Progress`
//!   - runner success path        -> `StatusChanged { to: Completed }` then
//!                                   `Completed` if the session is settled
//!   - runner failure path        -> `Failed { error_type, message }` and
//!                                   `Completed` if the session is settled
//!
//! intentionally session-keyed: jobs without a session_id don't emit.
//! that matches the design — subscriptions filter by session_id.

use crate::jobs::models::JobStatus;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use zod_gen_derive::ZodSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum JobEvent {
    /// in-flight progress update for a job session.
    Progress {
        session_id: String,
        complete: i64,
        total: i64,
    },
    /// a single job within a session changed lifecycle state.
    /// `from` is best-effort and may be null when the previous state
    /// isn't cheaply known at the emit site.
    StatusChanged {
        session_id: String,
        job_id: String,
        from: Option<JobStatusWire>,
        to: JobStatusWire,
    },
    /// a single job within a session terminated with failure (after
    /// retries are exhausted, or not retryable). emitted in addition to
    /// the matching `StatusChanged { to: Failed }`.
    Failed {
        session_id: String,
        job_id: String,
        error_type: String,
        message: String,
    },
    /// the entire session has settled (no jobs pending or running).
    /// emitted at-most-once per session in practice (last-job emits it
    /// from the runner); subscribers may dedup.
    Completed { session_id: String },
}

/// wire-friendly mirror of `JobStatus` so we can derive `ZodSchema`
/// without invading the existing `JobStatus` definition (which is
/// `PartialEq`-derived and used in `match` arms across the crate).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, ZodSchema)]
#[serde(rename_all = "snake_case")]
pub enum JobStatusWire {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl From<JobStatus> for JobStatusWire {
    fn from(s: JobStatus) -> Self {
        match s {
            JobStatus::Pending => Self::Pending,
            JobStatus::Running => Self::Running,
            JobStatus::Completed => Self::Completed,
            JobStatus::Failed => Self::Failed,
            JobStatus::Cancelled => Self::Cancelled,
        }
    }
}

impl From<&JobStatus> for JobStatusWire {
    fn from(s: &JobStatus) -> Self {
        Self::from(s.clone())
    }
}

/// global broadcast channel for job lifecycle events.
/// 256-slot ring buffer; lagged subscribers drop older events.
static JOB_EVENTS: Lazy<broadcast::Sender<JobEvent>> = Lazy::new(|| {
    let (tx, _) = broadcast::channel(256);
    tx
});

/// publish a `JobEvent` to all current subscribers. silent no-op when
/// there are no subscribers (broadcast::send returns `Err` then, which
/// we drop intentionally).
pub fn emit(event: JobEvent) {
    let _ = JOB_EVENTS.send(event);
}

/// subscribe to the job-event stream. each receiver gets every event
/// emitted after subscription; drop the receiver when done.
pub fn subscribe() -> broadcast::Receiver<JobEvent> {
    JOB_EVENTS.subscribe()
}
