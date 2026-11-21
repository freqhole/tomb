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
use crate::GrimoireResult;
use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// how long a station can sit at zero listeners before its request queue
/// is dropped. mirrors this codebase's existing "don't react to a
/// momentary blip" debounce patterns elsewhere (e.g. reveal-debounce
/// windows on the client).
const IDLE_GRACE: Duration = Duration::from_secs(5 * 60);

#[derive(Debug, Clone)]
pub(crate) struct RequestMedia {
    pub kind: RadioItemKind,
    pub item_id: String,
    pub media_blob_id: Option<String>,
}

impl RequestMedia {
    fn matches(&self, kind: RadioItemKind, item_id: &str, media_blob_id: Option<&str>) -> bool {
        self.kind == kind
            && match (self.media_blob_id.as_deref(), media_blob_id) {
                (Some(left), Some(right)) => left == right,
                _ => self.item_id == item_id,
            }
    }
}

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
    media_blob_id: Option<String>,
    /// when the request was submitted, for expiry while awaiting listeners.
    submitted_at: Instant,
}

struct StationQueue {
    items: VecDeque<QueuedRequest>,
    playing: Option<(String, RequestMedia)>,
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
            playing: None,
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
                self.playing = None;
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
        if q.items.is_empty() && q.playing.is_none() {
            reg.remove(station_id);
        } else {
            q.idle_since = Some(Instant::now());
        }
    }
}

/// submit a request to a station's queue. caller (the offal route
/// handler) is responsible for checking `accepts_requests`/`content_mode`
/// before calling this. resolve playable media before insertion; duplicate
/// pending/current media is an idempotent no-op without a submission event.
/// the station's blob id is content-stable (media_blobz.blake3 is unique).
pub async fn submit(
    station_id: &str,
    kind: RadioItemKind,
    item_id: String,
    requested_by: String,
    start_position_seconds: Option<f64>,
    position: Option<usize>,
    on_submitted: impl FnOnce(String, usize),
) -> GrimoireResult<bool> {
    let track = crate::radio::playlist::fetch_track(kind, &item_id).await?;
    Ok(enqueue(
        station_id,
        RequestMedia {
            kind,
            item_id,
            media_blob_id: track.audio_blob_id,
        },
        requested_by,
        start_position_seconds,
        position,
        on_submitted,
    ))
}

pub(crate) fn enqueue(
    station_id: &str,
    media: RequestMedia,
    requested_by: String,
    start_position_seconds: Option<f64>,
    position: Option<usize>,
    on_submitted: impl FnOnce(String, usize),
) -> bool {
    let mut reg = registry().lock().unwrap();
    let q = reg
        .entry(station_id.to_string())
        .or_insert_with(StationQueue::new);
    q.sweep(station_id);
    if q.playing.as_ref().is_some_and(|(_, playing)| {
        playing.matches(media.kind, &media.item_id, media.media_blob_id.as_deref())
    }) || q.items.iter().any(|request| {
        media.matches(
            request.kind,
            &request.item_id,
            request.media_blob_id.as_deref(),
        )
    }) {
        return false;
    }
    let id = uuid::Uuid::new_v4().to_string();
    let index = position.unwrap_or(q.items.len()).min(q.items.len());
    q.items.insert(
        index,
        QueuedRequest {
            id: id.clone(),
            kind: media.kind,
            item_id: media.item_id,
            media_blob_id: media.media_blob_id,
            requested_by,
            start_position_seconds,
            submitted_at: Instant::now(),
        },
    );
    on_submitted(id, index);
    true
}

pub(crate) fn mark_playing(station_id: &str, media: RequestMedia) -> Option<String> {
    if let Some(q) = registry().lock().unwrap().get_mut(station_id) {
        let token = uuid::Uuid::new_v4().to_string();
        q.playing = Some((token.clone(), media));
        return Some(token);
    }
    None
}

pub(crate) fn finish_playing(station_id: &str, token: &str) {
    let mut reg = registry().lock().unwrap();
    let Some(q) = reg.get_mut(station_id) else {
        return;
    };
    if q.playing
        .as_ref()
        .is_some_and(|(current, _)| current == token)
    {
        q.playing = None;
    }
    if q.listeners == 0 && q.items.is_empty() && q.playing.is_none() {
        reg.remove(station_id);
    }
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
    let request = q.items.pop_front()?;
    q.playing = Some((
        request.id.clone(),
        RequestMedia {
            kind: request.kind,
            item_id: request.item_id.clone(),
            media_blob_id: request.media_blob_id.clone(),
        },
    ));
    Some(request)
}

/// take a specific request without disturbing the other requests' order.
pub async fn take(station_id: &str, request_id: &str) -> Option<QueuedRequest> {
    let mut reg = registry().lock().unwrap();
    let q = reg.get_mut(station_id)?;
    q.sweep(station_id);
    let index = q.items.iter().position(|r| r.id == request_id)?;
    let request = q.items.remove(index)?;
    q.playing = Some((
        request.id.clone(),
        RequestMedia {
            kind: request.kind,
            item_id: request.item_id.clone(),
            media_blob_id: request.media_blob_id.clone(),
        },
    ));
    Some(request)
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
    q.playing = None;
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    fn video_media(id: &str, blob_id: &str) -> RequestMedia {
        RequestMedia {
            kind: RadioItemKind::Video,
            item_id: id.into(),
            media_blob_id: Some(blob_id.into()),
        }
    }

    #[tokio::test]
    async fn simultaneous_members_cannot_enqueue_the_same_content_twice() {
        let station_id = "concurrent-duplicate-request-test";
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let events = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let handles: Vec<_> = ["first-id", "same-blob-other-id"]
            .into_iter()
            .map(|id| {
                let barrier = barrier.clone();
                let events = events.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    enqueue(
                        station_id,
                        video_media(id, "shared-blob"),
                        id.into(),
                        None,
                        None,
                        |_, _| {
                            events.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        },
                    )
                })
            })
            .collect();
        let inserted = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .filter(|inserted| *inserted)
            .count();
        assert_eq!(inserted, 1);
        assert_eq!(events.load(std::sync::atomic::Ordering::Relaxed), 1);
        assert_eq!(list(station_id).await.len(), 1);
        assert!(enqueue(
            "other-duplicate-station",
            video_media("first-id", "shared-blob"),
            "member".into(),
            None,
            None,
            |_, _| {}
        ));
    }

    #[tokio::test]
    async fn selected_and_playing_content_stays_deduplicated_until_playback_finishes() {
        let station_id = "playing-duplicate-request-test";
        let media = video_media("first-id", "shared-blob");
        enqueue(
            station_id,
            media.clone(),
            "first-member".into(),
            Some(12.0),
            None,
            |_, _| {},
        );
        let original = list(station_id).await[0].clone();
        assert!(!enqueue(
            station_id,
            video_media("alias", "shared-blob"),
            "other-member".into(),
            Some(99.0),
            Some(0),
            |_, _| {}
        ));
        let pending = list(station_id).await;
        assert_eq!(pending[0].id, original.id);
        assert_eq!(pending[0].requested_by, "first-member");
        assert_eq!(pending[0].start_position_seconds, Some(12.0));
        let selected = pop_next(station_id).await.unwrap();
        assert!(!enqueue(
            station_id,
            video_media("alias", "shared-blob"),
            "member".into(),
            None,
            None,
            |_, _| {}
        ));
        let token = mark_playing(station_id, media).unwrap();
        finish_playing(station_id, &selected.id);
        assert!(!enqueue(
            station_id,
            video_media("alias", "shared-blob"),
            "member".into(),
            None,
            None,
            |_, _| {}
        ));
        finish_playing(station_id, &token);
        assert!(enqueue(
            station_id,
            video_media("alias", "shared-blob"),
            "member".into(),
            None,
            None,
            |_, _| {}
        ));
    }

    #[tokio::test]
    async fn clearing_then_replaying_the_same_item_is_not_unlocked_by_old_playback_cleanup() {
        let station_id = "clear-duplicate-request-test";
        listener_joined(station_id);
        let media = video_media("same-id", "same-blob");
        let old_token = mark_playing(station_id, media.clone()).unwrap();
        clear(station_id).await;
        assert!(enqueue(
            station_id,
            media.clone(),
            "member".into(),
            None,
            None,
            |_, _| {}
        ));
        let request_id = list(station_id).await[0].id.clone();
        take(station_id, &request_id).await.unwrap();
        assert!(!enqueue(
            station_id,
            media.clone(),
            "member".into(),
            None,
            None,
            |_, _| {}
        ));
        let token = mark_playing(station_id, media.clone()).unwrap();
        finish_playing(station_id, &old_token);
        assert!(!enqueue(
            station_id,
            media.clone(),
            "member".into(),
            None,
            None,
            |_, _| {}
        ));
        finish_playing(station_id, &token);
        assert!(enqueue(
            station_id,
            media,
            "member".into(),
            None,
            None,
            |_, _| {}
        ));
        listener_left(station_id);
    }

    #[tokio::test]
    async fn taking_a_selected_request_preserves_the_rest_and_its_resume_position() {
        let station_id = "selected-request-test";
        for id in ["first", "selected", "last"] {
            submit(
                station_id,
                RadioItemKind::Video,
                id.into(),
                "member".into(),
                Some(12.0),
            )
            .await;
        }

        let request_id = list(station_id).await[1].id.clone();
        let selected = take(station_id, &request_id).await.unwrap();
        assert_eq!(selected.item_id, "selected");
        assert_eq!(selected.start_position_seconds, Some(12.0));
        assert_eq!(
            list(station_id)
                .await
                .iter()
                .map(|r| r.item_id.as_str())
                .collect::<Vec<_>>(),
            ["first", "last"]
        );
        assert!(take(station_id, &request_id).await.is_none());
    }

    #[tokio::test]
    async fn inserting_play_next_requests_preserves_batch_order_ahead_of_the_backlog() {
        let station_id = "play-next-insertion-test";
        submit(
            station_id,
            RadioItemKind::Song,
            "old".into(),
            "member".into(),
            None,
        )
        .await;
        for (index, id) in ["first", "second"].into_iter().enumerate() {
            enqueue(
                station_id,
                RequestMedia {
                    kind: RadioItemKind::Song,
                    item_id: id.into(),
                    media_blob_id: None,
                },
                "member".into(),
                None,
                Some(index),
                |_, inserted| assert_eq!(inserted, index),
            );
        }
        assert_eq!(
            list(station_id)
                .await
                .iter()
                .map(|r| r.item_id.as_str())
                .collect::<Vec<_>>(),
            ["first", "second", "old"]
        );
    }

    async fn submit(
        station_id: &str,
        kind: RadioItemKind,
        item_id: String,
        requested_by: String,
        start_position_seconds: Option<f64>,
    ) {
        enqueue(
            station_id,
            RequestMedia {
                kind,
                item_id,
                media_blob_id: None,
            },
            requested_by,
            start_position_seconds,
            None,
            |_, _| {},
        );
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
        enqueue(
            station_id,
            RequestMedia {
                kind: RadioItemKind::Song,
                item_id: "song-2".to_string(),
                media_blob_id: None,
            },
            "user-a".to_string(),
            None,
            None,
            |id, _| {
                let removed: Vec<_> = std::iter::from_fn(|| events.try_recv().ok())
                    .filter(|event| event.station_id() == station_id)
                    .collect();
                assert_eq!(removed.len(), 2);
                assert!(removed.iter().all(|event| matches!(
                    event, RadioQueueEvent::Removed { request_id, .. } if request_id != &id
                )));
            },
        );
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
