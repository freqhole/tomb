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

use crate::radio::playlist::RadioItemKind;
use crate::radio::queue_events::{self, RadioQueueEvent};
use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

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
    /// when the request was submitted, for expiry while awaiting listeners.
    submitted_at: Instant,
}

struct StationQueue {
    items: VecDeque<QueuedRequest>,
    /// `Some(t)` since the station's listener count last dropped to zero;
    /// `None` while at least one listener is tuned in. checked lazily
    /// (no background sweep task) before reading, appending, or joining.
    idle_since: Option<Instant>,
    listeners: usize,
}

impl StationQueue {
    fn new() -> Self {
        Self {
            items: VecDeque::new(),
            idle_since: None,
            listeners: 0,
        }
    }

    fn sweep(&mut self, station_id: &str) {
        if self.listeners != 0 {
            return;
        }
        let drop_session = match self.idle_since {
            Some(left) if left.elapsed() < IDLE_GRACE => return,
            Some(_) => {
                self.idle_since = None;
                true
            }
            None => false,
        };
        self.items.retain(|request| {
            let expired = drop_session || request.submitted_at.elapsed() >= IDLE_GRACE;
            if expired {
                queue_events::emit(RadioQueueEvent::Removed {
                    station_id: station_id.to_string(),
                    request_id: request.id.clone(),
                });
            }
            !expired
        });
    }
}

type Registry = Mutex<HashMap<String, StationQueue>>;
static REGISTRY: OnceLock<Registry> = OnceLock::new();

fn registry() -> &'static Registry {
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// record listeners even before a station has received its first request.
pub fn listener_joined(station_id: &str) {
    let mut reg = registry().lock().unwrap();
    let q = reg
        .entry(station_id.to_string())
        .or_insert_with(StationQueue::new);
    q.sweep(station_id);
    q.listeners += 1;
    q.idle_since = None;
}

pub fn listener_left(station_id: &str) {
    let mut reg = registry().lock().unwrap();
    let q = reg
        .get_mut(station_id)
        .expect("listener joined before leaving");
    q.listeners -= 1;
    if q.listeners == 0 {
        if q.items.is_empty() {
            reg.remove(station_id);
        } else {
            q.idle_since = Some(Instant::now());
        }
    }
}

/// submit a request to a station's queue. caller (the offal route
/// handler) is responsible for checking `accepts_requests`/`content_mode`
/// before calling this - this function just appends, creating the
/// station's queue on first use. publishes after expiry removals, while
/// concurrent queue changes still can't interleave.
pub async fn submit(
    station_id: &str,
    kind: RadioItemKind,
    item_id: String,
    requested_by: String,
    start_position_seconds: Option<f64>,
    on_submitted: impl FnOnce(String),
) {
    let mut reg = registry().lock().unwrap();
    let q = reg
        .entry(station_id.to_string())
        .or_insert_with(StationQueue::new);
    q.sweep(station_id);
    let id = uuid::Uuid::new_v4().to_string();
    q.items.push_back(QueuedRequest {
        id: id.clone(),
        kind,
        item_id,
        requested_by,
        start_position_seconds,
        submitted_at: Instant::now(),
    });
    on_submitted(id);
}

/// pop the next queued request for a station, if any. also lazily sweeps
/// a stale queue first: a whole-queue drop if the station has had
/// listeners before and is now past the idle grace, or a per-request drop
/// of anything that's sat unheard past the grace period between sessions.
/// called from `playlist::pick_for_station_after_with_options` before it
/// falls through to filter-based picking.
pub async fn pop_next(station_id: &str) -> Option<QueuedRequest> {
    let mut reg = registry().lock().unwrap();
    let q = reg.get_mut(station_id)?;
    q.sweep(station_id);
    q.items.pop_front()
}

/// list every currently-queued request for a station, in submission
/// order, without removing any of them. used by the `radio_list_requests`
/// route to back the client's "queue" tab. applies the same lazy
/// staleness sweep as `pop_next` so a stale, long-idle (or never-heard)
/// backlog isn't shown as if it were still live.
pub async fn list(station_id: &str) -> Vec<QueuedRequest> {
    let mut reg = registry().lock().unwrap();
    let Some(q) = reg.get_mut(station_id) else {
        return Vec::new();
    };
    q.sweep(station_id);
    q.items.iter().cloned().collect()
}

/// remove one specific queued request by id, regardless of its position.
/// returns true if a matching request was found and removed. any
/// authenticated member (not just admins) may call this.
pub async fn remove(station_id: &str, request_id: &str) -> bool {
    let mut reg = registry().lock().unwrap();
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
/// exact count. returns the item's actual (clamped) final index on
/// success - the caller needs this real index, not just a bool, to
/// build an accurate `RadioQueueEvent::Reordered` payload for other
/// listeners watching this station's queue (see
/// offal::music::radio::reorder_request). `None` if no matching request
/// was found. any authenticated member (not just admins) may call this,
/// same as `remove`/`clear` above.
pub async fn reorder(station_id: &str, request_id: &str, new_index: usize) -> Option<usize> {
    let mut reg = registry().lock().unwrap();
    let q = reg.get_mut(station_id)?;
    let pos = q.items.iter().position(|r| r.id == request_id)?;
    let item = q
        .items
        .remove(pos)
        .expect("pos came from iter().position() on this same deque");
    let clamped = new_index.min(q.items.len());
    q.items.insert(clamped, item);
    Some(clamped)
}

/// clear every queued request for a station at once. returns the number
/// of requests removed.
pub async fn clear(station_id: &str) -> usize {
    let mut reg = registry().lock().unwrap();
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

    async fn submit(
        station_id: &str,
        kind: RadioItemKind,
        item_id: String,
        requested_by: String,
        start_position_seconds: Option<f64>,
    ) {
        super::submit(
            station_id,
            kind,
            item_id,
            requested_by,
            start_position_seconds,
            |_| {},
        )
        .await;
    }

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
        listener_joined(station_id);
        submit(
            station_id,
            RadioItemKind::Song,
            "song-1".to_string(),
            "user-a".to_string(),
            None,
        )
        .await;
        listener_left(station_id);
        submit(
            station_id,
            RadioItemKind::Song,
            "within-grace".into(),
            "user-a".into(),
            None,
        )
        .await;
        assert_eq!(list(station_id).await.len(), 2);
        {
            let mut reg = registry().lock().unwrap();
            let q = reg.get_mut(station_id).expect("queue exists");
            assert!(
                q.idle_since.is_some(),
                "submitting must not reset the idle clock"
            );
            q.idle_since = Some(Instant::now() - IDLE_GRACE - Duration::from_secs(1));
        }

        // exercise submit as the first access after expiry.
        let mut events = queue_events::subscribe();
        super::submit(
            station_id,
            RadioItemKind::Song,
            "song-2".to_string(),
            "user-a".to_string(),
            None,
            |id| {
                let removed: Vec<_> = std::iter::from_fn(|| events.try_recv().ok())
                    .filter(|event| event.station_id() == station_id)
                    .collect();
                assert_eq!(removed.len(), 2);
                assert!(removed.iter().all(|event| matches!(
                    event, RadioQueueEvent::Removed { request_id, .. } if request_id != &id
                )));
            },
        )
        .await;
        let next = pop_next(station_id).await.expect("new queue after drop");
        assert_eq!(next.item_id, "song-2");
        assert!(pop_next(station_id).await.is_none());
    }

    #[tokio::test]
    async fn never_had_a_listener_expires_each_request_individually() {
        let station_id = "station-never-heard-test";
        submit(
            station_id,
            RadioItemKind::Song,
            "song-old".to_string(),
            "user-a".to_string(),
            None,
        )
        .await;

        {
            let mut reg = registry().lock().unwrap();
            let q = reg.get_mut(station_id).expect("queue exists");
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
    async fn reconnect_preserves_requests_only_within_the_grace_period() {
        let station_id = "station-reconnect-test";
        listener_joined(station_id);
        listener_joined(station_id);
        submit(
            station_id,
            RadioItemKind::Song,
            "song-1".to_string(),
            "user-a".to_string(),
            None,
        )
        .await;
        listener_left(station_id);
        {
            let mut reg = registry().lock().unwrap();
            let q = reg.get_mut(station_id).expect("queue exists");
            q.items[0].submitted_at = Instant::now() - IDLE_GRACE - Duration::from_secs(1);
        }
        submit(
            station_id,
            RadioItemKind::Song,
            "song-2".into(),
            "user-a".into(),
            None,
        )
        .await;
        assert_eq!(
            list(station_id).await.len(),
            2,
            "one listener is still tuned"
        );

        listener_left(station_id);
        listener_joined(station_id);
        assert_eq!(list(station_id).await.len(), 2, "reconnected within grace");

        listener_left(station_id);
        {
            let mut reg = registry().lock().unwrap();
            let q = reg.get_mut(station_id).expect("queue exists");
            q.idle_since = Some(Instant::now() - IDLE_GRACE - Duration::from_secs(1));
        }
        listener_joined(station_id);
        assert!(
            list(station_id).await.is_empty(),
            "reconnect must not revive stale requests"
        );
        listener_left(station_id);
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
        assert_eq!(reorder(station_id, &last_id, 0).await, Some(0));

        let reordered = list(station_id).await;
        assert_eq!(
            reordered
                .iter()
                .map(|r| r.item_id.as_str())
                .collect::<Vec<_>>(),
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
        // wildly out-of-range - must clamp to "end of queue" (index 1,
        // the only valid position once this item is lifted out of a
        // 2-item queue), not panic or silently no-op. the returned
        // index is the real, clamped one - callers need this (not just
        // a bool) to build an accurate event payload.
        assert_eq!(reorder(station_id, &first_id, 999).await, Some(1));

        let reordered = list(station_id).await;
        assert_eq!(
            reordered
                .iter()
                .map(|r| r.item_id.as_str())
                .collect::<Vec<_>>(),
            vec!["song-2", "song-1"]
        );
    }

    #[tokio::test]
    async fn reorder_returns_none_for_an_unknown_id_or_station() {
        let station_id = "station-reorder-miss-test";
        submit(
            station_id,
            RadioItemKind::Song,
            "song-1".to_string(),
            "user-a".to_string(),
            None,
        )
        .await;
        assert_eq!(reorder(station_id, "not-a-real-id", 0).await, None);
        assert_eq!(
            reorder("station-never-seen", "not-a-real-id", 0).await,
            None
        );
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
