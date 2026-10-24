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
    /// "resume where a previous listener left off" - when set, the
    /// broadcaster seeks the encoder to this position before streaming
    /// this item (see `playlist.rs`'s request-branch of
    /// `pick_for_station_after_with_options`, which copies this onto the
    /// `RadioTrack` it returns).
    pub start_position_seconds: Option<f64>,
    /// when this request was submitted - used by `sweep_unheard` below
    /// for a station that's never had a listener since its queue was
    /// created (see `StationQueue::has_ever_had_listener`'s doc comment
    /// for why this needs its own expiry path, separate from
    /// `idle_since`).
    submitted_at: Instant,
}

struct StationQueue {
    items: VecDeque<QueuedRequest>,
    /// `Some(t)` since the station's listener count last dropped to zero;
    /// `None` while at least one listener is tuned in. checked lazily
    /// (no background sweep task) whenever the queue is touched. only
    /// meaningful once `has_ever_had_listener` is true - see that field's
    /// doc comment.
    idle_since: Option<Instant>,
    /// true once this station has had at least one real listener (via
    /// `mark_active`) since its queue was created. `idle_since` only ever
    /// starts counting down on a 1→0 listener transition
    /// (`Broadcaster::leave()` → `mark_idle`) - a station that's *never*
    /// had a single listener never makes that transition, so `idle_since`
    /// would stay `None` forever and a request submitted to it would sit
    /// unheard indefinitely. while this is false, `sweep_unheard` below
    /// expires individual requests directly off their own
    /// `submitted_at` instead.
    has_ever_had_listener: bool,
}

impl StationQueue {
    fn new() -> Self {
        Self {
            items: VecDeque::new(),
            idle_since: None,
            has_ever_had_listener: false,
        }
    }

    fn is_idle_expired(&self) -> bool {
        self.idle_since.is_some_and(|t| t.elapsed() >= IDLE_GRACE)
    }

    /// drops any requests that have sat unheard for `IDLE_GRACE` while
    /// this station has never had a single listener - see
    /// `has_ever_had_listener`'s doc comment. a no-op once the station
    /// has had a listener (that case uses the coarser whole-queue
    /// `is_idle_expired` drop instead, unchanged from before).
    fn sweep_unheard(&mut self) {
        if self.has_ever_had_listener {
            return;
        }
        self.items
            .retain(|r| r.submitted_at.elapsed() < IDLE_GRACE);
    }
}

type Registry = RwLock<HashMap<String, StationQueue>>;
static REGISTRY: OnceLock<Registry> = OnceLock::new();

fn registry() -> &'static Registry {
    REGISTRY.get_or_init(|| RwLock::new(HashMap::new()))
}

/// call when a station's listener count transitions from 0 to 1 (i.e.
/// from `Broadcaster::join()`) - cancels any pending idle-drop and marks
/// the station as having had a real listener (see
/// `StationQueue::has_ever_had_listener`). a no-op if the station has no
/// queue yet (nothing to cancel).
pub async fn mark_active(station_id: &str) {
    let mut reg = registry().write().await;
    if let Some(q) = reg.get_mut(station_id) {
        q.idle_since = None;
        q.has_ever_had_listener = true;
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
    start_position_seconds: Option<f64>,
) -> String {
    let mut reg = registry().write().await;
    let q = reg
        .entry(station_id.to_string())
        .or_insert_with(StationQueue::new);
    // a fresh request is itself a sign of real activity - don't let a
    // request submitted right as the grace period was about to expire
    // get raced by the next `pop_next` sweep. only meaningful once this
    // station has had a listener (see `is_idle_expired`); harmless no-op
    // otherwise.
    q.idle_since = None;
    let id = uuid::Uuid::new_v4().to_string();
    q.items.push_back(QueuedRequest {
        id: id.clone(),
        kind,
        item_id,
        requested_by,
        start_position_seconds,
        submitted_at: Instant::now(),
    });
    id
}

/// pop the next queued request for a station, if any. also lazily sweeps
/// a stale queue first: a whole-queue drop if the station has had
/// listeners before and is now past the idle grace, or a per-request drop
/// of anything that's sat unheard past the grace period if the station
/// has never had a listener at all (see `StationQueue::has_ever_had_listener`).
/// called from `playlist::pick_for_station_after_with_options` before it
/// falls through to filter-based picking.
pub async fn pop_next(station_id: &str) -> Option<QueuedRequest> {
    let mut reg = registry().write().await;
    let q = reg.get_mut(station_id)?;
    if q.has_ever_had_listener && q.is_idle_expired() {
        reg.remove(station_id);
        return None;
    }
    q.sweep_unheard();
    q.items.pop_front()
}

/// list every currently-queued request for a station, in submission
/// order, without removing any of them. used by the `radio_list_requests`
/// route to back the client's "queue" tab. applies the same lazy
/// staleness sweep as `pop_next` so a stale, long-idle (or never-heard)
/// backlog isn't shown as if it were still live.
pub async fn list(station_id: &str) -> Vec<QueuedRequest> {
    let mut reg = registry().write().await;
    let Some(q) = reg.get_mut(station_id) else {
        return Vec::new();
    };
    if q.has_ever_had_listener && q.is_idle_expired() {
        reg.remove(station_id);
        return Vec::new();
    }
    q.sweep_unheard();
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

/// move one specific queued request to a new position, identified by id
/// (not its current index - the client's last-known position may be
/// stale by the time this call lands, e.g. another member just removed
/// an earlier entry; targeting by id means the move always lands on the
/// right item regardless). `new_index` is clamped to the queue's length
/// after the item is lifted out, so "move to the end" is always
/// expressible as a large index without the caller needing to know the
/// exact count. returns true if a matching request was found and moved.
/// any authenticated member (not just admins) may call this, same as
/// `remove`/`clear` above.
pub async fn reorder(station_id: &str, request_id: &str, new_index: usize) -> bool {
    let mut reg = registry().write().await;
    let Some(q) = reg.get_mut(station_id) else {
        return false;
    };
    let Some(pos) = q.items.iter().position(|r| r.id == request_id) else {
        return false;
    };
    let item = q
        .items
        .remove(pos)
        .expect("pos came from iter().position() on this same deque");
    let clamped = new_index.min(q.items.len());
    q.items.insert(clamped, item);
    true
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
            None,
        )
        .await;
        submit(
            station_id,
            RadioItemKind::Video,
            "video-1".to_string(),
            "user-b".to_string(),
            None,
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
    async fn submit_preserves_a_start_position() {
        let station_id = "station-start-position-test";
        submit(
            station_id,
            RadioItemKind::Video,
            "video-1".to_string(),
            "user-a".to_string(),
            Some(123.5),
        )
        .await;

        let popped = pop_next(station_id).await.expect("request");
        assert_eq!(popped.start_position_seconds, Some(123.5));
    }

    #[tokio::test]
    async fn idle_grace_period_drops_the_queue_only_after_expiry() {
        let station_id = "station-idle-test";
        submit(
            station_id,
            RadioItemKind::Song,
            "song-1".to_string(),
            "user-a".to_string(),
            None,
        )
        .await;

        // simulate "had a listener, then they left" by directly setting
        // has_ever_had_listener + an idle_since already past the grace
        // period - avoids an actual 5-minute sleep in a test. the
        // whole-queue idle-drop path only applies once a station has
        // ever had a listener (see `has_ever_had_listener`'s doc comment);
        // a station that never did uses the separate per-request
        // `sweep_unheard` path instead - see
        // `never_had_a_listener_expires_each_request_individually` below.
        {
            let mut reg = registry().write().await;
            let q = reg.get_mut(station_id).expect("queue exists");
            q.has_ever_had_listener = true;
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
            None,
        )
        .await;
        let next = pop_next(station_id).await.expect("new queue after drop");
        assert_eq!(next.item_id, "song-2");
    }

    #[tokio::test]
    async fn never_had_a_listener_expires_each_request_individually() {
        // the actual bug this fix addresses: a station that's never had a
        // single listener never transitions through mark_idle (only
        // Broadcaster::leave() calls that, and leave implies a prior
        // join), so idle_since would stay None forever and the
        // idle_since-based whole-queue drop above would never fire - a
        // request sitting in a never-tuned-into station's queue would
        // otherwise sit there indefinitely.
        let station_id = "station-never-heard-test";
        submit(
            station_id,
            RadioItemKind::Song,
            "song-old".to_string(),
            "user-a".to_string(),
            None,
        )
        .await;

        // backdate just this one request's submitted_at past the grace
        // period, without ever touching idle_since/has_ever_had_listener -
        // no listener has ever joined this station.
        {
            let mut reg = registry().write().await;
            let q = reg.get_mut(station_id).expect("queue exists");
            assert!(!q.has_ever_had_listener);
            q.items[0].submitted_at = Instant::now() - IDLE_GRACE - Duration::from_secs(1);
        }

        // a second, fresh request submitted after the first - must
        // survive the sweep even though the first one expires.
        submit(
            station_id,
            RadioItemKind::Song,
            "song-new".to_string(),
            "user-a".to_string(),
            None,
        )
        .await;

        let listed = list(station_id).await;
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].item_id, "song-new");
    }

    #[tokio::test]
    async fn mark_active_cancels_a_pending_idle_drop() {
        let station_id = "station-mark-active-test";
        submit(
            station_id,
            RadioItemKind::Song,
            "song-1".to_string(),
            "user-a".to_string(),
            None,
        )
        .await;
        // establish "this station has had a listener before" (a real
        // mark_idle is always preceded by an earlier mark_active/join in
        // practice) so the idle_since-based drop path below is actually
        // the one under test, not sweep_unheard's never-had-a-listener
        // path.
        mark_active(station_id).await;
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
            None,
        )
        .await;
        submit(
            station_id,
            RadioItemKind::Video,
            "video-1".to_string(),
            "user-b".to_string(),
            None,
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
            None,
        )
        .await;
        submit(
            station_id,
            RadioItemKind::Song,
            "song-2".to_string(),
            "user-a".to_string(),
            None,
        )
        .await;
        submit(
            station_id,
            RadioItemKind::Song,
            "song-3".to_string(),
            "user-a".to_string(),
            None,
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
            None,
        )
        .await;
        assert!(!remove(station_id, "not-a-real-id").await);
        assert!(!remove("station-never-seen", "not-a-real-id").await);
        // the real item must still be there - a failed removal is a no-op.
        assert_eq!(list(station_id).await.len(), 1);
    }

    #[tokio::test]
    async fn reorder_moves_an_item_to_a_new_position_by_id() {
        let station_id = "station-reorder-test";
        submit(
            station_id,
            RadioItemKind::Song,
            "song-1".to_string(),
            "user-a".to_string(),
            None,
        )
        .await;
        submit(
            station_id,
            RadioItemKind::Song,
            "song-2".to_string(),
            "user-a".to_string(),
            None,
        )
        .await;
        submit(
            station_id,
            RadioItemKind::Song,
            "song-3".to_string(),
            "user-a".to_string(),
            None,
        )
        .await;

        // move the last item ("song-3") to the front.
        let last_id = list(station_id).await[2].id.clone();
        assert!(reorder(station_id, &last_id, 0).await);

        let reordered = list(station_id).await;
        assert_eq!(
            reordered.iter().map(|r| r.item_id.as_str()).collect::<Vec<_>>(),
            vec!["song-3", "song-1", "song-2"]
        );
    }

    #[tokio::test]
    async fn reorder_clamps_an_out_of_range_index_to_the_end() {
        let station_id = "station-reorder-clamp-test";
        submit(
            station_id,
            RadioItemKind::Song,
            "song-1".to_string(),
            "user-a".to_string(),
            None,
        )
        .await;
        submit(
            station_id,
            RadioItemKind::Song,
            "song-2".to_string(),
            "user-a".to_string(),
            None,
        )
        .await;

        let first_id = list(station_id).await[0].id.clone();
        // wildly out-of-range - must clamp to "end of queue", not panic
        // or silently no-op.
        assert!(reorder(station_id, &first_id, 999).await);

        let reordered = list(station_id).await;
        assert_eq!(
            reordered.iter().map(|r| r.item_id.as_str()).collect::<Vec<_>>(),
            vec!["song-2", "song-1"]
        );
    }

    #[tokio::test]
    async fn reorder_returns_false_for_an_unknown_id_or_station() {
        let station_id = "station-reorder-miss-test";
        submit(
            station_id,
            RadioItemKind::Song,
            "song-1".to_string(),
            "user-a".to_string(),
            None,
        )
        .await;
        assert!(!reorder(station_id, "not-a-real-id", 0).await);
        assert!(!reorder("station-never-seen", "not-a-real-id", 0).await);
        // the real item must still be in its original position - a
        // failed reorder is a no-op.
        assert_eq!(list(station_id).await[0].item_id, "song-1");
    }

    #[tokio::test]
    async fn clear_removes_every_item_and_reports_the_count() {
        let station_id = "station-clear-test";
        submit(
            station_id,
            RadioItemKind::Song,
            "song-1".to_string(),
            "user-a".to_string(),
            None,
        )
        .await;
        submit(
            station_id,
            RadioItemKind::Video,
            "video-1".to_string(),
            "user-b".to_string(),
            None,
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
