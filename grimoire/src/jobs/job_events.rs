//! phase 11 / p1 — typed job-lifecycle events, filters, visibility.
//!
//! a separate broadcast channel from the existing `crate::events::EVENTS`
//! so subscribers (tauri bridge, future jobz alpn, http poll wrapper) can
//! tail just the job lifecycle without filtering through unrelated event
//! variants. payload is a typed `JobEvent` enum that derives `ZodSchema`
//! so the offal streaming codegen can render a typed async-iterable on
//! the client side.
//!
//! emit points (today):
//!   - `update_session_progress` -> `Progress`
//!   - runner success path        -> `StatusChanged { to: Completed }` then
//!                                   `Progress` and `Completed` if the
//!                                   session is settled
//!   - runner failure path        -> `StatusChanged { to: Failed|Pending }`,
//!                                   `Failed`, `Progress`, and possibly
//!                                   `Completed` if the session is settled
//!   - per-job processors (p2)    -> `Stage` for in-flight sub-step ticks
//!
//! every variant carries:
//!   - `topic: JobType` — what flavour of job emitted this
//!   - `entity_ref: Option<EntityRef>` — the album/artist this job is
//!     keyed on (None for non-entity-keyed jobs or session-aggregate events)
//!   - `created_by: Option<String>` — user id of the caller who enqueued
//!     the job (or the session). powers per-user visibility.

use crate::jobs::models::{Job, JobStatus, JobType};
use crate::jobs::service::{get_job_session, list_jobs};
use crate::offal::Caller;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::broadcast;
use zod_gen_derive::ZodSchema;

// ---------------------------------------------------------------------------
// entity reference + filter primitives
// ---------------------------------------------------------------------------

/// a domain entity a job operates on. used both for per-event tagging
/// (so subscribers can filter by "the album i'm looking at right now")
/// and for the per-user visibility check.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, ZodSchema)]
#[serde(tag = "kind", content = "id", rename_all = "snake_case")]
pub enum EntityRef {
    Album(String),
    Artist(String),
}

/// subscription filter — every field is "any of"; multiple fields are
/// and-ed together. None means no constraint on that axis.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema)]
pub struct EventFilter {
    pub kinds: Option<Vec<JobType>>,
    pub job_ids: Option<Vec<String>>,
    pub session_ids: Option<Vec<String>>,
    pub entity_refs: Option<Vec<EntityRef>>,
}

impl EventFilter {
    /// returns true when `evt` matches every non-None axis of this filter.
    pub fn matches(&self, evt: &JobEvent) -> bool {
        if let Some(kinds) = &self.kinds {
            if !kinds.iter().any(|k| k == evt.topic()) {
                return false;
            }
        }
        if let Some(job_ids) = &self.job_ids {
            match evt.job_id() {
                Some(jid) => {
                    if !job_ids.iter().any(|x| x == jid) {
                        return false;
                    }
                }
                None => return false,
            }
        }
        if let Some(session_ids) = &self.session_ids {
            match evt.session_id() {
                Some(sid) => {
                    if !session_ids.iter().any(|x| x == sid) {
                        return false;
                    }
                }
                None => return false,
            }
        }
        if let Some(refs) = &self.entity_refs {
            match evt.entity_ref() {
                Some(r) => {
                    if !refs.iter().any(|x| x == r) {
                        return false;
                    }
                }
                None => return false,
            }
        }
        true
    }
}

// ---------------------------------------------------------------------------
// job event payload
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum JobEvent {
    /// in-flight progress update for a job session.
    Progress {
        session_id: String,
        complete: i64,
        total: i64,
        topic: JobType,
        entity_ref: Option<EntityRef>,
        created_by: Option<String>,
    },
    /// a single job within a session changed lifecycle state.
    /// `from` is best-effort and may be null when the previous state
    /// isn't cheaply known at the emit site.
    StatusChanged {
        session_id: String,
        job_id: String,
        from: Option<JobStatusWire>,
        to: JobStatusWire,
        topic: JobType,
        entity_ref: Option<EntityRef>,
        created_by: Option<String>,
    },
    /// a single job within a session terminated with failure (after
    /// retries are exhausted, or not retryable). emitted in addition to
    /// the matching `StatusChanged { to: Failed }`.
    Failed {
        session_id: String,
        job_id: String,
        error_type: String,
        message: String,
        topic: JobType,
        entity_ref: Option<EntityRef>,
        created_by: Option<String>,
    },
    /// fine-grained progress tick from within a single job's processor.
    /// emitted by long-running jobs (mb album search, enrichment
    /// pipeline, etc.) so the client can show "fetching releases…"
    /// without polling.
    Stage {
        session_id: Option<String>,
        job_id: String,
        stage: String,
        message: Option<String>,
        topic: JobType,
        entity_ref: Option<EntityRef>,
        created_by: Option<String>,
    },
    /// the entire session has settled (no jobs pending or running).
    /// emitted at-most-once per session in practice (last-job emits it
    /// from the runner); subscribers may dedup.
    Completed {
        session_id: String,
        topic: JobType,
        entity_ref: Option<EntityRef>,
        created_by: Option<String>,
    },
}

impl JobEvent {
    pub fn topic(&self) -> &JobType {
        match self {
            JobEvent::Progress { topic, .. }
            | JobEvent::StatusChanged { topic, .. }
            | JobEvent::Failed { topic, .. }
            | JobEvent::Stage { topic, .. }
            | JobEvent::Completed { topic, .. } => topic,
        }
    }

    pub fn session_id(&self) -> Option<&str> {
        match self {
            JobEvent::Progress { session_id, .. }
            | JobEvent::StatusChanged { session_id, .. }
            | JobEvent::Failed { session_id, .. }
            | JobEvent::Completed { session_id, .. } => Some(session_id.as_str()),
            JobEvent::Stage { session_id, .. } => session_id.as_deref(),
        }
    }

    pub fn job_id(&self) -> Option<&str> {
        match self {
            JobEvent::StatusChanged { job_id, .. }
            | JobEvent::Failed { job_id, .. }
            | JobEvent::Stage { job_id, .. } => Some(job_id.as_str()),
            JobEvent::Progress { .. } | JobEvent::Completed { .. } => None,
        }
    }

    pub fn entity_ref(&self) -> Option<&EntityRef> {
        match self {
            JobEvent::Progress { entity_ref, .. }
            | JobEvent::StatusChanged { entity_ref, .. }
            | JobEvent::Failed { entity_ref, .. }
            | JobEvent::Stage { entity_ref, .. }
            | JobEvent::Completed { entity_ref, .. } => entity_ref.as_ref(),
        }
    }

    pub fn created_by(&self) -> Option<&str> {
        match self {
            JobEvent::Progress { created_by, .. }
            | JobEvent::StatusChanged { created_by, .. }
            | JobEvent::Failed { created_by, .. }
            | JobEvent::Stage { created_by, .. }
            | JobEvent::Completed { created_by, .. } => created_by.as_deref(),
        }
    }
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

// ---------------------------------------------------------------------------
// snapshot + close reason (consumed by streaming routes in p3+)
// ---------------------------------------------------------------------------

/// point-in-time snapshot of a single job, returned at subscription
/// start so clients can render current state without racing the
/// broadcast stream. p1 leaves `last_stage`/`last_message` empty; p2
/// populates them via the side cache below.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct JobStateSnapshot {
    pub job_id: String,
    pub session_id: Option<String>,
    pub job_type: JobType,
    pub status: JobStatusWire,
    pub entity_ref: Option<EntityRef>,
    pub created_by: Option<String>,
    pub last_stage: Option<String>,
    pub last_message: Option<String>,
    /// unix epoch millis of the last lifecycle change for this row
    /// (`completed_at`, else `started_at`, else `scheduled_at`).
    pub updated_at: i64,
}

/// reason a subscription stream is closing. relayed back to the client
/// transport so it can decide whether to reconnect.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CloseReason {
    /// client dropped the receiver / called unsubscribe.
    ClientUnsubscribed,
    /// caller lost visibility on the filter (e.g. role downgrade); the
    /// stream is closed and the client should not reconnect with the
    /// same filter.
    Unauthorized,
    /// the broadcast channel lagged past this receiver's buffer. the
    /// client should re-snapshot and re-subscribe.
    Lagged,
    /// catch-all for internal errors; clients may retry with backoff.
    Internal(String),
}

// ---------------------------------------------------------------------------
// visibility predicate
// ---------------------------------------------------------------------------

/// returns true when `caller` is allowed to observe `evt`.
///
/// rules (top-down, first match wins):
///   1. admins (root/admin) see everything.
///   2. owners (created_by matches caller.user_id) see their own jobs.
///   3. fall back to per-entity-ref visibility (album/artist reads).
///      jobs with no entity_ref and no owner remain admin-only.
pub fn caller_can_see(caller: &Caller, evt: &JobEvent) -> bool {
    if caller.is_admin() {
        return true;
    }
    if let Some(owner) = evt.created_by() {
        if owner == caller.user_id {
            return true;
        }
    }
    if let Some(eref) = evt.entity_ref() {
        return can_read_entity(caller, eref);
    }
    false
}

/// p1 stub — all authenticated callers can read any entity. p9 will
/// hook this up to the playlist/library acl model.
pub fn can_read_entity(_caller: &Caller, _eref: &EntityRef) -> bool {
    true
}

// ---------------------------------------------------------------------------
// side-cache for the latest stage/message per job (populated in p2)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct StageState {
    stage: Option<String>,
    message: Option<String>,
    /// last emit instant for this job_id; used by the `emit_stage`
    /// debouncer to coalesce same-stage bursts.
    last_emit_at: Option<std::time::Instant>,
}

static STAGE_CACHE: Lazy<Mutex<HashMap<String, StageState>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// minimum interval between two `Stage` events with the same `stage`
/// label for the same `job_id`. transitions (different stage) and all
/// other event variants bypass this entirely.
const STAGE_DEBOUNCE: std::time::Duration = std::time::Duration::from_millis(5_000);

/// record the most recent stage/message for a job. cheap, in-memory,
/// not persisted (server restarts reset running jobs to pending
/// anyway). called from `emit()` whenever a `Stage` event flies by.
fn record_stage(job_id: &str, stage: &str, message: Option<&str>) {
    if let Ok(mut cache) = STAGE_CACHE.lock() {
        cache.insert(
            job_id.to_string(),
            StageState {
                stage: Some(stage.to_string()),
                message: message.map(|s| s.to_string()),
                last_emit_at: Some(std::time::Instant::now()),
            },
        );
    }
}

/// drop the side-cache entry for a finished job to keep the map bounded.
fn forget_stage(job_id: &str) {
    if let Ok(mut cache) = STAGE_CACHE.lock() {
        cache.remove(job_id);
    }
}

fn read_stage(job_id: &str) -> Option<StageState> {
    STAGE_CACHE.lock().ok().and_then(|c| c.get(job_id).cloned())
}

// ---------------------------------------------------------------------------
// broker
// ---------------------------------------------------------------------------

/// global broadcast channel for job lifecycle events.
/// 256-slot ring buffer; lagged subscribers drop older events.
static JOB_EVENTS: Lazy<broadcast::Sender<JobEvent>> = Lazy::new(|| {
    let (tx, _) = broadcast::channel(256);
    tx
});

/// publish a `JobEvent` to all current subscribers. silent no-op when
/// there are no subscribers (broadcast::send returns `Err` then, which
/// we drop intentionally). updates the side cache for `Stage` events
/// and clears it for terminal status transitions.
pub fn emit(event: JobEvent) {
    match &event {
        JobEvent::Stage {
            job_id,
            stage,
            message,
            ..
        } => record_stage(job_id, stage, message.as_deref()),
        JobEvent::StatusChanged {
            job_id,
            to: JobStatusWire::Completed | JobStatusWire::Failed | JobStatusWire::Cancelled,
            ..
        } => forget_stage(job_id),
        _ => {}
    }
    let _ = JOB_EVENTS.send(event);
}

/// subscribe to the raw job-event stream. each receiver gets every
/// event emitted after subscription; drop the receiver when done.
pub fn subscribe() -> broadcast::Receiver<JobEvent> {
    JOB_EVENTS.subscribe()
}

/// subscribe with a filter + caller authz check applied. yields each
/// event the caller is allowed to see. on broadcast lag, yields a
/// single `Err(CloseReason::Lagged)` and ends — the client should
/// re-snapshot and reconnect.
pub fn subscribe_filtered(
    filter: EventFilter,
    caller: Caller,
) -> impl futures_util::Stream<Item = Result<JobEvent, CloseReason>> {
    use futures_util::stream;
    let mut rx = JOB_EVENTS.subscribe();
    stream::unfold(
        (rx_take(&mut rx), filter, caller),
        |(mut rx, filter, caller): (broadcast::Receiver<JobEvent>, EventFilter, Caller)| async move {
            loop {
                match rx.recv().await {
                    Ok(evt) => {
                        if !filter.matches(&evt) {
                            continue;
                        }
                        if !caller_can_see(&caller, &evt) {
                            continue;
                        }
                        return Some((Ok(evt), (rx, filter, caller)));
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        return Some((Err(CloseReason::Lagged), (rx, filter, caller)));
                    }
                    Err(broadcast::error::RecvError::Closed) => return None,
                }
            }
        },
    )
}

/// helper: own the receiver inside the unfold closure.
fn rx_take(rx: &mut broadcast::Receiver<JobEvent>) -> broadcast::Receiver<JobEvent> {
    std::mem::replace(rx, JOB_EVENTS.subscribe())
}

// ---------------------------------------------------------------------------
// stage emit helper (debounced for same-stage bursts)
// ---------------------------------------------------------------------------

/// emit a `JobEvent::Stage` for `job`, applying the same-stage debounce
/// window. stage transitions (different `stage` than the last one for
/// this job_id) always emit immediately. when the last event for this
/// job was the same `stage` and fired <`STAGE_DEBOUNCE` ago, the call
/// is silently dropped — the side cache still reflects the most recent
/// state because cache writes happen on every successful emit.
///
/// callers pass the in-hand `Job` so `topic`, `entity_ref`, and
/// `created_by` are derived without an extra db round-trip.
pub fn emit_stage_from_job(job: &Job, stage: &str, message: Option<&str>) {
    let Ok(topic) = job.job_type() else { return };
    let entity_ref = entity_ref_for(&topic, &job.parameters);
    if !should_emit_stage(&job.id, stage) {
        return;
    }
    emit(JobEvent::Stage {
        session_id: job.session_id.clone(),
        job_id: job.id.clone(),
        stage: stage.to_string(),
        message: message.map(|s| s.to_string()),
        topic,
        entity_ref,
        created_by: job.created_by.clone(),
    });
}

/// returns true when the emit should proceed. transitions always pass;
/// same-stage repeats inside the debounce window are suppressed.
fn should_emit_stage(job_id: &str, stage: &str) -> bool {
    let Ok(cache) = STAGE_CACHE.lock() else {
        return true;
    };
    let Some(prev) = cache.get(job_id) else {
        return true;
    };
    if prev.stage.as_deref() != Some(stage) {
        return true; // transition
    }
    match prev.last_emit_at {
        Some(t) => t.elapsed() >= STAGE_DEBOUNCE,
        None => true,
    }
}

// ---------------------------------------------------------------------------
// snapshot
// ---------------------------------------------------------------------------

/// build the initial state snapshot for a subscription. queries the
/// `jobz` table (filtered) and returns one `JobStateSnapshot` per row
/// the caller is allowed to see.
pub async fn snapshot(filter: &EventFilter, caller: &Caller) -> Vec<JobStateSnapshot> {
    // narrow by session_ids when provided; otherwise pull recent rows.
    // p3 will likely expand this; for now we cover the common cases
    // (specific session, specific job ids, or "everything recent").
    let mut rows: Vec<Job> = Vec::new();
    if let Some(session_ids) = &filter.session_ids {
        for sid in session_ids {
            if let Some(jobs) = list_jobs(Some(sid), None, Some(500), None).await.data {
                rows.extend(jobs);
            }
        }
    } else if let Some(job_ids) = &filter.job_ids {
        // hydrate one-by-one via the existing single-job fetch path.
        for jid in job_ids {
            if let Some(job) = crate::jobs::service::get_job(jid).await.data {
                rows.push(job);
            }
        }
    } else {
        if let Some(jobs) = list_jobs(None, None, Some(200), None).await.data {
            rows.extend(jobs);
        }
    }

    rows.into_iter()
        .filter_map(|job| job_to_snapshot(&job))
        .filter(|snap| snapshot_matches_filter(snap, filter))
        .filter(|snap| snapshot_visible(snap, caller))
        .collect()
}

fn job_to_snapshot(job: &Job) -> Option<JobStateSnapshot> {
    let job_type = job.job_type().ok()?;
    let status: JobStatusWire = job.status().ok()?.into();
    let entity_ref = entity_ref_for(&job_type, &job.parameters);
    let updated_at = job
        .completed_at
        .or(job.started_at)
        .unwrap_or(job.scheduled_at);
    let stage_state = read_stage(&job.id);
    Some(JobStateSnapshot {
        job_id: job.id.clone(),
        session_id: job.session_id.clone(),
        job_type,
        status,
        entity_ref,
        created_by: job.created_by.clone(),
        last_stage: stage_state.as_ref().and_then(|s| s.stage.clone()),
        last_message: stage_state.and_then(|s| s.message),
        updated_at,
    })
}

fn snapshot_matches_filter(snap: &JobStateSnapshot, filter: &EventFilter) -> bool {
    if let Some(kinds) = &filter.kinds {
        if !kinds.iter().any(|k| k == &snap.job_type) {
            return false;
        }
    }
    if let Some(job_ids) = &filter.job_ids {
        if !job_ids.iter().any(|x| x == &snap.job_id) {
            return false;
        }
    }
    if let Some(session_ids) = &filter.session_ids {
        match &snap.session_id {
            Some(sid) => {
                if !session_ids.iter().any(|x| x == sid) {
                    return false;
                }
            }
            None => return false,
        }
    }
    if let Some(refs) = &filter.entity_refs {
        match &snap.entity_ref {
            Some(r) => {
                if !refs.iter().any(|x| x == r) {
                    return false;
                }
            }
            None => return false,
        }
    }
    true
}

fn snapshot_visible(snap: &JobStateSnapshot, caller: &Caller) -> bool {
    if caller.is_admin() {
        return true;
    }
    if let Some(owner) = &snap.created_by {
        if owner == &caller.user_id {
            return true;
        }
    }
    if let Some(eref) = &snap.entity_ref {
        return can_read_entity(caller, eref);
    }
    false
}

// ---------------------------------------------------------------------------
// entity-ref extraction from job parameters
// ---------------------------------------------------------------------------

/// derive an `EntityRef` from a job's `parameters` json blob, based on
/// the job kind. returns `None` for jobs that aren't entity-keyed
/// (filesystem scans, file processing, fetches).
pub fn entity_ref_for(job_type: &JobType, params_json: &str) -> Option<EntityRef> {
    let parsed: serde_json::Value = serde_json::from_str(params_json).ok()?;
    match job_type {
        JobType::MbAlbumSearch
        | JobType::MbAlbumDetail
        | JobType::LastFmAlbumDetail
        | JobType::AudioDbAlbumDetail
        | JobType::AlbumEnrichmentPipeline
        | JobType::AutoApplyAlbumEnrichment => parsed
            .get("album_id")
            .and_then(|v| v.as_str())
            .map(|s| EntityRef::Album(s.to_string())),
        JobType::LastFmArtistDetail | JobType::AudioDbArtistDetail => parsed
            .get("artist_id")
            .and_then(|v| v.as_str())
            .map(|s| EntityRef::Artist(s.to_string())),
        JobType::ScanDirectory
        | JobType::RescanDirectories
        | JobType::ProcessFile
        | JobType::FetchMedia
        | JobType::ConvertWebp
        | JobType::ImportMusic => None,
    }
}

/// convenience: derive an entity_ref for an already-loaded `Job`.
pub fn entity_ref_for_job(job: &Job) -> Option<EntityRef> {
    let jt = job.job_type().ok()?;
    entity_ref_for(&jt, &job.parameters)
}

/// look up a session's `(job_type, created_by)` so emit sites without
/// a `Job` row (e.g. `update_session_progress`) can still tag events.
pub async fn session_topic_and_owner(session_id: &str) -> Option<(JobType, Option<String>)> {
    let session = get_job_session(session_id).await.data?;
    let jt = session.job_type().ok()?;
    Some((jt, session.created_by))
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::users::UserRole;

    fn evt_status(
        session_id: &str,
        job_id: &str,
        topic: JobType,
        entity: Option<EntityRef>,
        owner: Option<&str>,
    ) -> JobEvent {
        JobEvent::StatusChanged {
            session_id: session_id.to_string(),
            job_id: job_id.to_string(),
            from: Some(JobStatusWire::Running),
            to: JobStatusWire::Completed,
            topic,
            entity_ref: entity,
            created_by: owner.map(|s| s.to_string()),
        }
    }

    #[test]
    fn filter_matches_by_kind_and_session() {
        let evt = evt_status(
            "sess-1",
            "job-1",
            JobType::MbAlbumSearch,
            Some(EntityRef::Album("a1".into())),
            Some("u1"),
        );
        let f = EventFilter {
            kinds: Some(vec![JobType::MbAlbumSearch]),
            session_ids: Some(vec!["sess-1".into()]),
            ..Default::default()
        };
        assert!(f.matches(&evt));

        let f_wrong = EventFilter {
            session_ids: Some(vec!["sess-2".into()]),
            ..Default::default()
        };
        assert!(!f_wrong.matches(&evt));
    }

    #[test]
    fn filter_matches_by_entity_ref() {
        let evt = evt_status(
            "s",
            "j",
            JobType::MbAlbumDetail,
            Some(EntityRef::Album("alb-x".into())),
            None,
        );
        let f = EventFilter {
            entity_refs: Some(vec![EntityRef::Album("alb-x".into())]),
            ..Default::default()
        };
        assert!(f.matches(&evt));

        let f_wrong = EventFilter {
            entity_refs: Some(vec![EntityRef::Album("alb-y".into())]),
            ..Default::default()
        };
        assert!(!f_wrong.matches(&evt));
    }

    #[test]
    fn caller_can_see_admin_sees_all() {
        let admin = Caller::new("root", "root", UserRole::Admin);
        let evt = evt_status("s", "j", JobType::MbAlbumSearch, None, None);
        assert!(caller_can_see(&admin, &evt));
    }

    #[test]
    fn caller_can_see_owner_sees_own() {
        let user = Caller::new("u1", "u1", UserRole::Member);
        let mine = evt_status("s", "j", JobType::MbAlbumSearch, None, Some("u1"));
        let theirs = evt_status("s", "j", JobType::MbAlbumSearch, None, Some("u2"));
        assert!(caller_can_see(&user, &mine));
        assert!(!caller_can_see(&user, &theirs));
    }

    #[test]
    fn caller_can_see_falls_back_to_entity_visibility() {
        let user = Caller::new("u1", "u1", UserRole::Viewer);
        let evt = evt_status(
            "s",
            "j",
            JobType::MbAlbumSearch,
            Some(EntityRef::Album("alb".into())),
            Some("other"),
        );
        // can_read_entity is a stub returning true for now.
        assert!(caller_can_see(&user, &evt));
    }

    #[test]
    fn caller_cannot_see_orphan_event() {
        let user = Caller::new("u1", "u1", UserRole::Viewer);
        let evt = evt_status("s", "j", JobType::ProcessFile, None, None);
        assert!(!caller_can_see(&user, &evt));
    }

    #[test]
    fn entity_ref_for_album_job() {
        let params = r#"{"album_id":"abc","auto_confirm_threshold":null}"#;
        assert_eq!(
            entity_ref_for(&JobType::MbAlbumSearch, params),
            Some(EntityRef::Album("abc".into()))
        );
    }

    #[test]
    fn entity_ref_for_non_entity_job() {
        let params = r#"{"file_path":"/x"}"#;
        assert_eq!(entity_ref_for(&JobType::ProcessFile, params), None);
    }

    #[test]
    fn debounce_drops_same_stage_within_window() {
        // arrange: cache an entry as if a `Stage` event just emitted.
        record_stage("job-x", "strict_search", None);
        // act: a same-stage emit should be suppressed.
        assert!(
            !should_emit_stage("job-x", "strict_search"),
            "same-stage emit inside the debounce window must be dropped"
        );
        // a transition to a new stage always passes.
        assert!(
            should_emit_stage("job-x", "scoring_candidates"),
            "stage transitions must bypass the debounce window"
        );
    }

    #[test]
    fn debounce_allows_first_emit_for_unknown_job() {
        assert!(should_emit_stage("brand-new-job", "strict_search"));
    }

    #[tokio::test]
    async fn emit_stage_from_job_publishes_to_subscribers() {
        use futures_util::StreamExt;

        // unique ids so this test doesn't collide with parallel runs.
        let job_id = format!("test-job-{}", std::process::id());
        let session_id = format!("test-session-{}", std::process::id());
        let job = Job {
            id: job_id.clone(),
            session_id: Some(session_id.clone()),
            job_type: "MbAlbumSearch".to_string(),
            status: "running".to_string(),
            parameters: r#"{"album_id":"alb-xyz","auto_confirm_threshold":null}"#.to_string(),
            result: None,
            retry_count: 0,
            max_retries: 0,
            scheduled_at: 0,
            started_at: None,
            completed_at: None,
            error_message: None,
            created_by: Some("alice".to_string()),
        };

        // subscribe BEFORE emit so we don't miss it.
        let filter = EventFilter {
            kinds: None,
            job_ids: Some(vec![job_id.clone()]),
            session_ids: None,
            entity_refs: None,
        };
        let caller = Caller::new("alice", "alice", crate::users::UserRole::Member);
        let mut stream = Box::pin(subscribe_filtered(filter, caller));

        // emit a stage transition (different from any prior cached value).
        // use a fresh-per-test stage label so we're guaranteed not to be
        // suppressed by leftover cache state from earlier tests.
        let stage_label = format!("strict_search_{}", std::process::id());
        job_events_emit_test_stage(&job, &stage_label);

        // give the broadcast a tick to flush.
        let evt = tokio::time::timeout(std::time::Duration::from_millis(500), stream.next())
            .await
            .expect("subscriber timed out")
            .expect("stream ended")
            .expect("close reason");
        match evt {
            JobEvent::Stage {
                job_id: jid,
                stage,
                topic,
                entity_ref,
                created_by,
                ..
            } => {
                assert_eq!(jid, job_id);
                assert_eq!(stage, stage_label);
                assert!(matches!(topic, JobType::MbAlbumSearch));
                assert_eq!(entity_ref, Some(EntityRef::Album("alb-xyz".to_string())));
                assert_eq!(created_by.as_deref(), Some("alice"));
            }
            other => panic!("expected Stage, got {:?}", other),
        }
    }

    // small wrapper so the test doesn't depend on the exact module path
    // of `emit_stage_from_job` (kept in case its visibility changes).
    fn job_events_emit_test_stage(job: &Job, stage: &str) {
        super::emit_stage_from_job(job, stage, Some("test"));
    }

    // ------------------------------------------------------------------
    // p10 integration test: enqueue -> stage emit -> terminal -> snapshot
    // reflects terminal -> reconnect -> no duplicate event.
    //
    // exercised purely against the in-memory broker + side cache +
    // `job_to_snapshot` so we don't need a sqlite fixture. the live
    // db-backed `snapshot()` is covered by p3 round-trip integration.
    // ------------------------------------------------------------------
    #[tokio::test]
    async fn end_to_end_emit_then_snapshot_then_reconnect() {
        use futures_util::StreamExt;

        // unique ids to keep this test isolated from parallel runs.
        let job_id = format!("p10-job-{}", std::process::id());
        let session_id = format!("p10-sess-{}", std::process::id());
        let stage_label = format!("strict_search_{}", std::process::id());

        // ---- enqueue: synthesize a freshly-running job row ----------
        let mut job = Job {
            id: job_id.clone(),
            session_id: Some(session_id.clone()),
            job_type: "MbAlbumSearch".to_string(),
            status: "Running".to_string(),
            parameters: r#"{"album_id":"alb-end2end","auto_confirm_threshold":null}"#.to_string(),
            result: None,
            retry_count: 0,
            max_retries: 0,
            scheduled_at: 0,
            started_at: Some(1),
            completed_at: None,
            error_message: None,
            created_by: Some("alice".to_string()),
        };

        let caller = Caller::new("alice", "alice", UserRole::Member);
        let filter = EventFilter {
            kinds: None,
            job_ids: Some(vec![job_id.clone()]),
            session_ids: None,
            entity_refs: None,
        };

        // ---- subscribe BEFORE emit (first connect) ------------------
        let mut stream_a = Box::pin(subscribe_filtered(filter.clone(), caller.clone()));

        // ---- stage emit ---------------------------------------------
        super::emit_stage_from_job(&job, &stage_label, Some("trying tight match"));

        // first subscriber must observe the stage event.
        let first = tokio::time::timeout(std::time::Duration::from_millis(500), stream_a.next())
            .await
            .expect("first subscriber timed out")
            .expect("stream ended")
            .expect("close reason");
        match first {
            JobEvent::Stage {
                job_id: jid, stage, ..
            } => {
                assert_eq!(jid, job_id);
                assert_eq!(stage, stage_label);
            }
            other => panic!("expected Stage, got {:?}", other),
        }

        // ---- terminal: simulate the runner marking the job done -----
        job.status = "Completed".to_string();
        job.completed_at = Some(2);

        // ---- snapshot reflects terminal -----------------------------
        // use job_to_snapshot directly (no db required); same code path
        // the live `snapshot()` uses to project a Job row.
        let snap = job_to_snapshot(&job).expect("snapshot must project");
        assert_eq!(snap.job_id, job_id);
        assert!(matches!(snap.status, JobStatusWire::Completed));
        assert_eq!(
            snap.entity_ref,
            Some(EntityRef::Album("alb-end2end".to_string()))
        );
        // the earlier stage emit populated the side cache; snapshot
        // surfaces it as last_stage/last_message.
        assert_eq!(snap.last_stage.as_deref(), Some(stage_label.as_str()));
        assert_eq!(snap.last_message.as_deref(), Some("trying tight match"));
        // the snapshot must be visible to the owner.
        assert!(snapshot_visible(&snap, &caller));
        assert!(snapshot_matches_filter(&snap, &filter));

        // ---- reconnect: fresh subscriber gets NO replay -------------
        // critical idempotence guarantee: tokio broadcast does not
        // buffer past events for new receivers, so a reconnect after a
        // terminal emit only sees future events. clients are expected
        // to combine snapshot() with subscribe_filtered() to catch up.
        let mut stream_b = Box::pin(subscribe_filtered(filter.clone(), caller.clone()));
        let no_replay =
            tokio::time::timeout(std::time::Duration::from_millis(150), stream_b.next()).await;
        assert!(
            no_replay.is_err(),
            "reconnect must not replay past events; got {:?}",
            no_replay
        );

        // a subsequent live emit, however, must reach the new
        // subscriber (proving the channel is healthy, not closed).
        // use a different stage label so the debounce window doesn't
        // suppress it.
        let post_stage = format!("post_reconnect_{}", std::process::id());
        super::emit_stage_from_job(&job, &post_stage, None);
        let live = tokio::time::timeout(std::time::Duration::from_millis(500), stream_b.next())
            .await
            .expect("post-reconnect subscriber timed out")
            .expect("stream ended")
            .expect("close reason");
        match live {
            JobEvent::Stage { stage, .. } => assert_eq!(stage, post_stage),
            other => panic!("expected Stage post-reconnect, got {:?}", other),
        }
    }
}
