//! in-memory member-submitted request queue for `accepts_requests`
//! stations.
//!
//! deliberately NOT persisted (see migration 086's doc comment) - a
//! durable, cross-session backlog would let one member queue a huge
//! backlog nobody actually listens to, permanently clogging the station
//! for anyone else who tunes in later. queue contents are dropped once a
//! station has had zero listeners for a grace period (not instantly at
//! zero listeners - a brief blip between two back-to-back listeners must
//! not wipe the queue).

use std::collections::{HashMap, VecDeque};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::radio::playlist::RadioItemKind;

/// how long a station can sit at zero listeners before its request queue
/// is dropped. mirrors this codebase's existing "don't react to a
/// momentary blip" debounce patterns elsewhere (e.g. reveal-debounce
/// windows on the client).
const IDLE_GRACE: Duration = Duration::from_secs(5 * 60);

/// one member-submitted request, queued in submission order.
#[derive(Debug, Clone)]
pub struct QueuedRequest {
    /// stable id for this specific queued request - lets `remove()` target
    /// one entry precisely; a plain VecDeque index isn't stable once other
    /// requests are popped/removed concurrently.
    pub id: String,
    pub kind: RadioItemKind,
    pub item_id: String,
    pub requested_by: String,
    /// forward-compatible placeholder for a future "resume where a
    /// previous listener left off" feature - deliberately not populated
    /// or read anywhere yet, just reserved so the struct doesn't need
    /// reshaping later.
    #[allow(dead_code)]
    pub start_position_seconds: Option<f64>,
}

struct StationQueue {
    items: VecDeque<QueuedRequest>,
    /// `Some(t)` since the station's listener count last dropped to zero;
    /// `None` while at least one listener is tuned in. checked lazily
    /// (no background sweep task) whenever the queue is touched.
    idle_since: Option<Instant>,
}

impl StationQueue {
    fn new() -> Self {
        Self {
            items: VecDeque::new(),
            idle_since: None,
        }
    }

    fn is_idle_expired(&self) -> bool {
        self.idle_since.is_some_and(|t| t.elapsed() >= IDLE_GRACE)
    }
}

type Registry = RwLock<HashMap<String, StationQueue>>;
static REGISTRY: OnceLock<Registry> = OnceLock::new();

fn registry() -> &'static Registry {
    REGISTRY.get_or_init(|| RwLock::new(HashMap::new()))
}

/// call when a station's listener count transitions from 0 to 1 (i.e.
/// from `Broadcaster::join()`) - cancels any pending idle-drop. a no-op
/// if the station has no queue yet (nothing to cancel).
pub async fn mark_active(station_id: &str) {
    let mut reg = registry().write().await;
    if let Some(q) = reg.get_mut(station_id) {
        q.idle_since = None;
    }
}

/// call when a station's listener count transitions to 0 (i.e. from
/// `Broadcaster::leave()`) - starts the idle-drop grace period. a no-op
/// if the station has no queue yet.
pub async fn mark_idle(station_id: &str) {
    let mut reg = registry().write().await;
    if let Some(q) = reg.get_mut(station_id) {
        if q.idle_since.is_none() {
            q.idle_since = Some(Instant::now());
        }
    }
}

/// submit a request to a station's queue. caller (the offal route
/// handler) is responsible for checking `accepts_requests`/`content_mode`
/// before calling this - this function just appends, creating the
/// station's queue on first use. returns the new request's id.
pub async fn submit(
    station_id: &str,
    kind: RadioItemKind,
    item_id: String,
    requested_by: String,
) -> String {
    let mut reg = registry().write().await;
    let q = reg
        .entry(station_id.to_string())
        .or_insert_with(StationQueue::new);
    // a fresh request is itself a sign of real activity - don't let a
    // request submitted right as the grace period was about to expire
    // get raced by the next `pop_next` sweep.
    q.idle_since = None;
    let id = uuid::Uuid::new_v4().to_string();
    q.items.push_back(QueuedRequest {
        id: id.clone(),
        kind,
        item_id,
        requested_by,
        start_position_seconds: None,
    });
    id
}

/// pop the next queued request for a station, if any. also lazily sweeps
/// an idle-expired queue (dropping it entirely) so a long-idle station
/// doesn't resume playing a stale backlog once someone re-tunes. called
/// from `playlist::pick_for_station_after_with_options` before it falls
/// through to filter-based picking.
pub async fn pop_next(station_id: &str) -> Option<QueuedRequest> {
    let mut reg = registry().write().await;
    let idle_expired = reg
        .get(station_id)
        .map(|q| q.is_idle_expired())
        .unwrap_or(false);
    if idle_expired {
        reg.remove(station_id);
        return None;
    }
    reg.get_mut(station_id)?.items.pop_front()
}

/// list every currently-queued request for a station, in submission
/// order, without removing any of them. used by the `radio_list_requests`
/// route to back the client's "queue" tab. applies the same lazy
/// idle-expiry sweep as `pop_next` so a stale, long-idle backlog isn't
/// shown as if it were still live.
pub async fn list(station_id: &str) -> Vec<QueuedRequest> {
    let mut reg = registry().write().await;
    let idle_expired = reg
        .get(station_id)
        .map(|q| q.is_idle_expired())
        .unwrap_or(false);
    if idle_expired {
        reg.remove(station_id);
        return Vec::new();
    }
    reg.get(station_id)
        .map(|q| q.items.iter().cloned().collect())
        .unwrap_or_default()
}

/// remove one specific queued request by id, regardless of its position.
/// returns true if a matching request was found and removed. any
/// authenticated member (not just admins) may call this.
pub async fn remove(station_id: &str, request_id: &str) -> bool {
    let mut reg = registry().write().await;
    let Some(q) = reg.get_mut(station_id) else {
        return false;
    };
    let before = q.items.len();
    q.items.retain(|r| r.id != request_id);
    q.items.len() != before
}

/// clear every queued request for a station at once. returns the number
/// of requests removed.
pub async fn clear(station_id: &str) -> usize {
    let mut reg = registry().write().await;
    let Some(q) = reg.get_mut(station_id) else {
        return 0;
    };
    let count = q.items.len();
    q.items.clear();
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn submit_then_pop_returns_in_fifo_order() {
        let station_id = "station-fifo-test";
        submit(
            station_id,
            RadioItemKind::Song,
            "song-1".to_string(),
            "user-a".to_string(),
        )
        .await;
        submit(
            station_id,
            RadioItemKind::Video,
            "video-1".to_string(),
            "user-b".to_string(),
        )
        .await;

        let first = pop_next(station_id).await.expect("first request");
        assert_eq!(first.item_id, "song-1");
        assert_eq!(first.kind, RadioItemKind::Song);
        assert_eq!(first.requested_by, "user-a");

        let second = pop_next(station_id).await.expect("second request");
        assert_eq!(second.item_id, "video-1");

        assert!(pop_next(station_id).await.is_none());
    }

    #[tokio::test]
    async fn idle_grace_period_drops_the_queue_only_after_expiry() {
        let station_id = "station-idle-test";
        submit(
            station_id,
            RadioItemKind::Song,
            "song-1".to_string(),
            "user-a".to_string(),
        )
        .await;

        // simulate "listener left" by directly manipulating idle_since
        // to a time already past the grace period - avoids an actual
        // 5-minute sleep in a test.
        {
            let mut reg = registry().write().await;
            let q = reg.get_mut(station_id).expect("queue exists");
            q.idle_since = Some(Instant::now() - IDLE_GRACE - Duration::from_secs(1));
        }

        // pop_next's lazy sweep should now drop the queue instead of
        // returning the still-present item.
        assert!(pop_next(station_id).await.is_none());

        // confirm it's genuinely gone, not just empty - a fresh submit
        // after this should start a brand new queue with idle_since unset.
        submit(
            station_id,
            RadioItemKind::Song,
            "song-2".to_string(),
            "user-a".to_string(),
        )
        .await;
        let next = pop_next(station_id).await.expect("new queue after drop");
        assert_eq!(next.item_id, "song-2");
    }

    #[tokio::test]
    async fn mark_active_cancels_a_pending_idle_drop() {
        let station_id = "station-mark-active-test";
        submit(
            station_id,
            RadioItemKind::Song,
            "song-1".to_string(),
            "user-a".to_string(),
        )
        .await;
        mark_idle(station_id).await;
        // still within the grace period, but let's confirm mark_active
        // clears idle_since regardless of how much time has passed.
        {
            let mut reg = registry().write().await;
            let q = reg.get_mut(station_id).expect("queue exists");
            q.idle_since = Some(Instant::now() - IDLE_GRACE - Duration::from_secs(1));
        }
        mark_active(station_id).await;

        // the queue must survive now - a real listener tuned back in
        // before the lazy sweep ever ran.
        let next = pop_next(station_id).await.expect("queue survives");
        assert_eq!(next.item_id, "song-1");
    }

    #[tokio::test]
    async fn list_returns_every_item_without_removing_them() {
        let station_id = "station-list-test";
        submit(
            station_id,
            RadioItemKind::Song,
            "song-1".to_string(),
            "user-a".to_string(),
        )
        .await;
        submit(
            station_id,
            RadioItemKind::Video,
            "video-1".to_string(),
            "user-b".to_string(),
        )
        .await;

        let listed = list(station_id).await;
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].item_id, "song-1");
        assert_eq!(listed[1].item_id, "video-1");

        // list must not have popped anything - both items still there.
        let listed_again = list(station_id).await;
        assert_eq!(listed_again.len(), 2);
    }

    #[tokio::test]
    async fn list_on_unknown_station_returns_empty() {
        assert!(list("station-never-seen").await.is_empty());
    }

    #[tokio::test]
    async fn remove_deletes_one_specific_item_by_id_regardless_of_position() {
        let station_id = "station-remove-test";
        submit(
            station_id,
            RadioItemKind::Song,
            "song-1".to_string(),
            "user-a".to_string(),
        )
        .await;
        submit(
            station_id,
            RadioItemKind::Song,
            "song-2".to_string(),
            "user-a".to_string(),
        )
        .await;
        submit(
            station_id,
            RadioItemKind::Song,
            "song-3".to_string(),
            "user-a".to_string(),
        )
        .await;

        let middle_id = list(station_id).await[1].id.clone();
        let removed = remove(station_id, &middle_id).await;
        assert!(removed);

        let remaining = list(station_id).await;
        assert_eq!(remaining.len(), 2);
        assert_eq!(remaining[0].item_id, "song-1");
        assert_eq!(remaining[1].item_id, "song-3");
    }

    #[tokio::test]
    async fn remove_returns_false_for_an_unknown_id_or_station() {
        let station_id = "station-remove-miss-test";
        submit(
            station_id,
            RadioItemKind::Song,
            "song-1".to_string(),
            "user-a".to_string(),
        )
        .await;
        assert!(!remove(station_id, "not-a-real-id").await);
        assert!(!remove("station-never-seen", "not-a-real-id").await);
        // the real item must still be there - a failed removal is a no-op.
        assert_eq!(list(station_id).await.len(), 1);
    }

    #[tokio::test]
    async fn clear_removes_every_item_and_reports_the_count() {
        let station_id = "station-clear-test";
        submit(
            station_id,
            RadioItemKind::Song,
            "song-1".to_string(),
            "user-a".to_string(),
        )
        .await;
        submit(
            station_id,
            RadioItemKind::Video,
            "video-1".to_string(),
            "user-b".to_string(),
        )
        .await;

        let removed = clear(station_id).await;
        assert_eq!(removed, 2);
        assert!(list(station_id).await.is_empty());
    }

    #[tokio::test]
    async fn clear_on_unknown_station_returns_zero() {
        assert_eq!(clear("station-never-seen").await, 0);
    }
}
