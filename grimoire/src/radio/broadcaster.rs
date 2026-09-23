//! shared radio broadcaster registry.
//!
//! one global registry maps `station_id` → `Arc<Broadcaster>`. each
//! broadcaster runs its own ffmpeg pipeline against its own configured
//! song source (`stations::pick_for_station`), keeps its own catchup
//! ring, and fans audio + meta out to its own subscribers.
//!
//! the registry is populated at server startup by [`init_registry`],
//! which queries `radio_stationz` for every `is_enabled = 1` row and
//! spawns a broadcaster per station. handler picks the broadcaster from
//! `tune.station_id` (or the default).

use crate::error::{GrimoireError, GrimoireResult};
use crate::music::analytics::events as play_events;
use crate::radio::art::resolve_track_art;
use crate::radio::chunk::Chunk;
use crate::radio::config as cfg;
use crate::radio::encoder::BufferedEncoder;
use crate::radio::messages::{ArtData, NowPlaying, RadioModeCapability};
use crate::radio::messages::{TimelineCurrentItem, TimelineMessage, TimelineUpcomingItem};
use crate::radio::playlist::{
    pick_for_station, pick_for_station_after, pick_for_station_force_new_album,
};
use crate::radio::stations;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, Notify, RwLock};
use tracing::{debug, info, warn};

/// short pause between songs when the playlist or encoder fails. avoids
/// a hot retry loop if (e.g.) the library is empty or ffmpeg is missing.
const RETRY_PAUSE: Duration = Duration::from_secs(3);

/// when the last listener leaves, keep the current ffmpeg pipeline alive
/// for a bit in case they only paused / scrubbed / reconnected.
const NO_LISTENER_GRACE: Duration = Duration::from_secs(60);
const SKIP_REQUEST_COOLDOWN_MS: i64 = 5_000;
/// when this little (or less) audio remains on the current track, an admin
/// skip is ignored: the track plays out and the next one buffers naturally.
/// avoids a redundant transition right as a track is already ending.
const SKIP_TAIL_IGNORE_MS: i64 = 10_000;

/// how often `wait_for_request` re-checks a request-only station's queue
/// while idle. polling (not a `Notify`) keeps this decoupled from the
/// request registry's own lock lifetime - the queue is tiny and
/// rarely-touched, so a short interval is both simple and plenty
/// responsive for "pick up the next request shortly after it's submitted".
const REQUEST_WAIT_POLL_INTERVAL: Duration = Duration::from_secs(2);

/// shifts pace_origin backward at the start of EVERY track (not just
/// after an admin skip - generalized per
/// docs/radio-buffering-retune-plan.md's "feed the ring from the
/// encoder" discussion, the synchronization-safe alternative: since
/// listeners don't need to be in lockstep with each other, front-loading
/// each track's own timeline for everyone at once deepens the catchup
/// ring faster at every track boundary, not just a skip, without any
/// listener ever seeing content "from the future" relative to another)
/// so however many chunks warmed up (see `ENCODER_WARMUP_TIMEOUT_MULTIPLE`'s doc
/// comment) are emitted immediately (target < now) instead of draining
/// in at real-time cadence. STEADY-STATE pacing for the rest of the
/// track (once this initial lead is exhausted) is intentionally left
/// alone - removing it entirely would let the whole remaining track (or
/// even the whole remaining playlist) render as fast as the CPU allows,
/// completely decoupled from real time, which breaks `NowPlaying`/
/// history/analytics timing (they'd describe content nobody has
/// actually heard yet) - this is scoped to "give each track a real head
/// start," not "stop being a live station."
const ENCODER_WARMUP_POLL_INTERVAL: Duration = Duration::from_millis(100);

/// how much slack, as a multiple of the real-time-equivalent duration
/// of the warm-up target (`ring_capacity` chunks worth), to allow before
/// giving up on warm-up and publishing whatever's ready anyway. e.g. for
/// the default 60s ring, a healthy encoder running at or faster than
/// real time fills it well under 60s; this gives up to 2x that (120s)
/// before concluding the encoder can't even sustain real time, which is
/// itself the diagnostic signal (logged as a `warn!`) - a fixed, small
/// timeout would false-positive on any encoder running only slightly
/// slower than real time, which is a normal-ish case this warm-up is
/// explicitly meant to tolerate (favoring smooth playback over fast
/// start, per explicit user direction - waiting longer is fine, stalls
/// are not).
const ENCODER_WARMUP_TIMEOUT_MULTIPLE: u32 = 2;
/// floor under the multiple above so a tiny `ring_capacity` (e.g. the
/// `MIN_RING_CHUNKS` clamp) doesn't produce an unreasonably short
/// timeout.
const ENCODER_WARMUP_TIMEOUT_FLOOR: Duration = Duration::from_secs(10);

/// permanent steady-state lead the pacer maintains over strict real
/// time, on top of the one-time warm-up burst. without this, steady-
/// state pacing tracks real time exactly (see `pace_origin`'s own doc
/// comment) - the warm-up burst is a ONE-TIME head start that a listener
/// who stays tuned in slowly spends down (each stall-recovery seek uses
/// some of it) with nothing to replenish it, eventually leaving only a
/// razor-thin, easily-exhausted margin for the rest of a long session.
/// shifting `pace_origin` earlier by a fixed amount makes every
/// subsequent target that much earlier too - since the pacer now paces
/// off each chunk's REAL measured duration (see `cumulative_media_ms`),
/// the release RATE already exactly matches real content, so this
/// constant offset doesn't decay over time the way it would have
/// against the old nominal-frag_ms-based schedule - it's a genuine,
/// permanent cushion, not just a bigger one-time burst.
const STEADY_STATE_LEAD_MS: u64 = 20_000;

/// ffmpeg lavfi source used as the "video" for a song played on a mixed
/// station - see `play_track`'s `synthesize_still_video` branch. always
/// blank rather than the track's own art: looping a real image needs a
/// temp file written/cleaned up per track for comparatively little
/// benefit, since the art still reaches listeners separately via the
/// NowPlaying control message either way.
const BLANK_VIDEO_INPUT: &str = "-f lavfi -i color=c=0x1a1a1a:s=1280x720:r=2";

/// maximum upcoming items to maintain in the rolling planner.
pub const MAX_UPCOMING_ITEMS: usize = 8;
/// minimum upcoming items before the horizon check stops filling.
const MIN_UPCOMING_ITEMS: usize = 2;
/// target lookahead horizon in milliseconds.
const TARGET_HORIZON_MS: i64 = 15 * 60 * 1_000;

/// one pre-picked song in the station's rolling plan.
/// consumed by the run loop at each track boundary;
/// read by timeline_snapshot() and planner_snapshot() for lookahead.
#[derive(Clone)]
pub struct PlannedItem {
    pub timeline_item_id: String,
    pub planned_start_at_ms: i64,
    pub track: crate::radio::playlist::RadioTrack,
}

/// snapshot a new listener takes when joining the broadcast.
pub struct Subscription {
    pub init: Option<Arc<Chunk>>,
    pub catchup: Vec<Arc<Chunk>>,
    pub now_playing: Arc<NowPlaying>,
    pub next_seq: u32,
    pub init_seq: u32,
    pub chunk_rx: broadcast::Receiver<Arc<Chunk>>,
    pub meta_rx: broadcast::Receiver<MetaUpdate>,
}

/// payload pushed on the meta channel. carries the init_seq so handlers
/// can include it in `MetaMessage` without holding the broadcaster lock.
#[derive(Clone)]
pub enum MetaUpdate {
    /// a `NowPlaying` change: track boundary, interstitial placeholder,
    /// or idle announcement.
    Meta {
        now_playing: Arc<NowPlaying>,
        init_seq: u32,
    },
    /// an admin skip was just accepted. tells every listener to flush
    /// whatever of the outgoing track it still has buffered client-side
    /// instead of letting it play out - a `NowPlaying` change follows
    /// separately once the next track actually starts.
    SkipFlush,
}

struct State {
    current_init: Option<Arc<Chunk>>,
    init_seq: u32,
    ring: VecDeque<Arc<Chunk>>,
    now_playing: Arc<NowPlaying>,
    ring_capacity: usize,
}

impl State {
    fn empty(ring_capacity: usize, station_id: &str) -> Self {
        Self {
            current_init: None,
            init_seq: 0,
            ring: VecDeque::with_capacity(ring_capacity),
            now_playing: Arc::new(NowPlaying {
                title: "(starting up...)".to_string(),
                station_id: Some(station_id.to_string()),
                ..Default::default()
            }),
            ring_capacity,
        }
    }
}

pub struct Broadcaster {
    station_id: String,
    /// station's `content_mode` at spawn time ('audio_only' |
    /// 'audio_or_video' | 'video_only') - snapshotted here (rather than
    /// re-fetched from the db) purely so the concurrent-stream-limit
    /// check (see `check_concurrency_cap`) can count running broadcasters
    /// by group without a db round trip per station on every registry
    /// scan. a station's content_mode change only takes effect for THIS
    /// purpose on its next restart, same as `encode_args`/other settings
    /// that `restart_station` exists to apply.
    content_mode: String,
    state: RwLock<State>,
    chunk_tx: broadcast::Sender<Arc<Chunk>>,
    meta_tx: broadcast::Sender<MetaUpdate>,
    next_seq: AtomicU32,
    listener_count: AtomicU32,
    /// epoch-seconds timestamp of the last bumper play. zero = never.
    /// the run loop uses this with the per-station
    /// `bumper_frequency_seconds` to decide when to slot a bumper in.
    last_bumper_at: std::sync::atomic::AtomicI64,
    /// epoch-millis timestamp of when the current track's init chunk was
    /// pushed. `0` until the first track starts. used to compute
    /// `current_track_elapsed_ms` for fresh listeners (see HelloMessage).
    track_started_at_ms: AtomicI64,
    /// when true the broadcaster skips the audio uni stream entirely;
    /// all listeners get only timeline control messages. can be toggled
    /// at runtime via `set_timeline_only()` (admin command).
    timeline_only_mode: AtomicBool,
    /// duration of the currently-playing track in milliseconds. zero when
    /// there is no active song or the duration is unknown.
    current_track_duration_ms: AtomicI64,
    /// true when the active track is a bumper/interstitial rather than a
    /// regular station song.
    current_track_is_bumper: AtomicBool,
    /// monotonic generation bumped on each accepted admin skip request.
    skip_request_generation: AtomicU32,
    /// wall-clock ms timestamp of the last accepted skip request.
    last_skip_requested_at_ms: AtomicI64,
    /// when set, the next pick bypasses planner continuity and forces
    /// album mode to start a new random album from track 1.
    force_new_album_pick: AtomicBool,
    /// wakes the run loop when the first listener arrives while the
    /// station is idle.
    listener_notify: Notify,
    /// wakes the active song loop when an admin requests a skip.
    skip_notify: Notify,
    /// rolling plan of pre-picked upcoming songs. consumed by the run loop
    /// at each track boundary; refilled in a background task while the
    /// current song plays so timeline snapshots have real lookahead.
    plan: RwLock<VecDeque<PlannedItem>>,
    /// cached play_mode used to build the current planner entries.
    plan_mode: RwLock<Option<String>>,
    /// monotonic counter used when minting `timeline_item_id` values for
    /// planned items.
    plan_item_seq: AtomicU64,
}

impl Broadcaster {
    fn new(station_id: String, content_mode: String) -> Self {
        let (chunk_tx, _) = broadcast::channel(cfg::CHUNK_CHANNEL_CAPACITY);
        let (meta_tx, _) = broadcast::channel(cfg::META_CHANNEL_CAPACITY);
        let ring_capacity = cfg::ring_capacity(&crate::radio::config::effective());
        Self {
            state: RwLock::new(State::empty(ring_capacity, &station_id)),
            station_id,
            content_mode,
            chunk_tx,
            meta_tx,
            next_seq: AtomicU32::new(0),
            listener_count: AtomicU32::new(0),
            last_bumper_at: std::sync::atomic::AtomicI64::new(0),
            track_started_at_ms: AtomicI64::new(0),
            timeline_only_mode: AtomicBool::new(false),
            current_track_duration_ms: AtomicI64::new(0),
            current_track_is_bumper: AtomicBool::new(false),
            skip_request_generation: AtomicU32::new(0),
            last_skip_requested_at_ms: AtomicI64::new(0),
            force_new_album_pick: AtomicBool::new(false),
            listener_notify: Notify::new(),
            skip_notify: Notify::new(),
            plan: RwLock::new(VecDeque::new()),
            plan_mode: RwLock::new(None),
            plan_item_seq: AtomicU64::new(0),
        }
    }

    async fn current_play_mode(&self) -> String {
        match stations::get_station(&self.station_id).await {
            Ok(Some(st)) => st.play_mode.trim().to_ascii_lowercase(),
            _ => "shuffle".to_string(),
        }
    }

    async fn sync_plan_mode(&self) {
        let mode = self.current_play_mode().await;
        let mut cached = self.plan_mode.write().await;
        if cached.as_deref() == Some(mode.as_str()) {
            return;
        }
        self.plan.write().await.clear();
        *cached = Some(mode);
    }

    pub fn station_id(&self) -> &str {
        &self.station_id
    }

    /// radio transport capabilities this broadcaster supports.
    /// when timeline-only mode is active, chunk_stream is excluded so
    /// clients know not to attempt MSE playback.
    pub fn radio_mode_capabilities(&self) -> Vec<RadioModeCapability> {
        if self.timeline_only_mode.load(Ordering::Relaxed) {
            vec![RadioModeCapability::TimelineSeed]
        } else {
            vec![
                RadioModeCapability::ChunkStream,
                RadioModeCapability::TimelineSeed,
            ]
        }
    }

    /// true when the station is running in timeline-seed-only mode
    /// (no audio uni stream). set by the broadcaster admin or at startup
    /// from the `timeline_only_mode` db column.
    pub fn timeline_seed_active(&self) -> bool {
        self.timeline_only_mode.load(Ordering::Relaxed)
    }

    /// check whether this station is in timeline-only mode.
    pub fn is_timeline_only(&self) -> bool {
        self.timeline_only_mode.load(Ordering::Relaxed)
    }

    /// toggle per-station timeline-only mode at runtime.
    /// called by the admin dispatch after a db update so the change takes
    /// effect on the next incoming listener without a server restart.
    pub fn set_timeline_only(&self, mode: bool) {
        self.timeline_only_mode.store(mode, Ordering::Relaxed);
        info!(
            "[radio-broadcaster] station {} timeline_only_mode → {mode}",
            self.station_id
        );
    }

    /// pop the next planned item for playback. the run loop calls this at
    /// each track boundary; falls back to a fresh pick when empty.
    async fn consume_planner_head(&self) -> Option<PlannedItem> {
        self.sync_plan_mode().await;
        self.plan.write().await.pop_front()
    }

    /// fill the plan up to MAX_UPCOMING_ITEMS (or TARGET_HORIZON_MS coverage).
    /// spawned as a background task after each track boundary so upcoming
    /// items are ready for timeline_snapshot() calls during the current song.
    async fn refill_planner(self: &Arc<Self>, seed_anchor_song_id: Option<String>) {
        // request-accepting stations must never speculatively pop MORE
        // than one item ahead - popping into this planner's own internal
        // `plan` buffer silently drains items out of the member-visible
        // request queue (crate::radio::requests) before they're actually
        // about to play, which both hides them from radio_list_requests
        // and looks like requests are being reordered ("shuffled") - the
        // planner's own buffer is still FIFO internally, it just no
        // longer matches what list()/the UI shows once several items get
        // pulled ahead of time in one shot. a request-only station is
        // exactly the case where ONE-at-a-time, just-in-time picking
        // (consume_planner_head's own empty-plan fallback branch,
        // `pick_for_station`, which re-checks accepts_requests and pops
        // exactly one real item right when it's needed) is both correct
        // and sufficient.
        let accepts_requests = self.station_accepts_requests().await;
        if accepts_requests {
            return;
        }

        self.sync_plan_mode().await;

        let (existing_ids, current_count, horizon_end_from_plan) = {
            let plan = self.plan.read().await;
            let ids: Vec<String> = plan.iter().map(|i| i.track.song_id.clone()).collect();
            let count = plan.len();
            let started = self.track_started_at_ms.load(Ordering::Relaxed);
            let duration = self.current_track_duration_ms.load(Ordering::Relaxed);
            let base = if started > 0 && duration > 0 {
                started + duration
            } else {
                unix_now_ms()
            };
            let end = plan
                .iter()
                .fold(base, |acc, item| acc + item.track.duration_ms.unwrap_or(0));
            (ids, count, end)
        };

        if current_count >= MAX_UPCOMING_ITEMS {
            return;
        }

        let horizon_base = {
            let started = self.track_started_at_ms.load(Ordering::Relaxed);
            let duration = self.current_track_duration_ms.load(Ordering::Relaxed);
            if started > 0 && duration > 0 {
                started + duration
            } else {
                unix_now_ms()
            }
        };
        let mut excluded = existing_ids;
        let mut horizon_end = horizon_end_from_plan;
        let mut new_items: Vec<PlannedItem> = Vec::new();
        let mut anchor_song_id = {
            let plan = self.plan.read().await;
            if let Some(last) = plan.back() {
                Some(last.track.song_id.clone())
            } else if let Some(seed) = seed_anchor_song_id.clone() {
                Some(seed)
            } else {
                let state = self.state.read().await;
                let id = state.now_playing.song_id.trim();
                if id.is_empty() {
                    None
                } else {
                    Some(id.to_string())
                }
            }
        };

        loop {
            let total_count = current_count + new_items.len();
            if total_count >= MAX_UPCOMING_ITEMS {
                break;
            }
            let horizon_covered = (horizon_end - horizon_base) >= TARGET_HORIZON_MS;
            let enough = total_count >= MIN_UPCOMING_ITEMS;
            if horizon_covered && enough {
                break;
            }

            let mut picked = None;
            for _ in 0..3 {
                match pick_for_station_after(&self.station_id, anchor_song_id.as_deref()).await {
                    Ok(t) if !excluded.contains(&t.song_id) => {
                        picked = Some(t);
                        break;
                    }
                    Ok(_) => {} // intra-plan duplicate — retry
                    Err(e) => {
                        warn!(
                            "[radio-planner] station {} refill pick failed: {e}",
                            self.station_id
                        );
                        return;
                    }
                }
            }

            let Some(track) = picked else { break };
            let duration = track.duration_ms.unwrap_or(0);
            let item_seq = self.plan_item_seq.fetch_add(1, Ordering::Relaxed);
            let item = PlannedItem {
                timeline_item_id: format!("{}:{}:{}", self.station_id, track.song_id, item_seq),
                planned_start_at_ms: horizon_end,
                track: track.clone(),
            };
            anchor_song_id = Some(track.song_id.clone());
            excluded.push(track.song_id);
            horizon_end += duration;
            new_items.push(item);
        }

        if !new_items.is_empty() {
            let mut plan = self.plan.write().await;
            for item in new_items {
                plan.push_back(item);
            }
        }
    }

    /// snapshot the planner for use in the public timeline manifest.
    /// returns up to `max_items` upcoming planned songs with full display
    /// metadata. does not consume items.
    pub async fn planner_snapshot(&self, max_items: usize) -> Vec<PlannedItem> {
        if max_items == 0 {
            return Vec::new();
        }
        let plan = self.plan.read().await;
        plan.iter().take(max_items).cloned().collect()
    }

    /// build a timeline snapshot from the current broadcaster state.
    /// `lookahead_count` controls how many upcoming planned items to include.
    pub async fn timeline_snapshot(&self, lookahead_count: usize) -> TimelineMessage {
        let state = self.state.read().await;
        let now_ms = unix_now_ms();
        let elapsed_ms = self.current_track_elapsed_ms() as i64;
        let has_song = !state.now_playing.song_id.trim().is_empty();

        let current = if has_song {
            Some(TimelineCurrentItem {
                timeline_item_id: format!(
                    "{}:{}:{}",
                    self.station_id, state.now_playing.song_id, state.init_seq
                ),
                song_id: state.now_playing.song_id.clone(),
                start_at_ms: now_ms.saturating_sub(elapsed_ms.max(0)),
                duration_ms: state.now_playing.duration_ms,
            })
        } else {
            None
        };

        let upcoming: Vec<TimelineUpcomingItem> = if lookahead_count > 0 {
            let plan = self.plan.read().await;
            plan.iter()
                .take(lookahead_count)
                .map(|item| TimelineUpcomingItem {
                    timeline_item_id: item.timeline_item_id.clone(),
                    song_id: item.track.song_id.clone(),
                    planned_start_at_ms: item.planned_start_at_ms,
                    duration_ms: item.track.duration_ms,
                })
                .collect()
        } else {
            Vec::new()
        };

        TimelineMessage {
            station_id: self.station_id.clone(),
            timeline_seq: self.current_seq() as u64,
            station_epoch_ms: current.as_ref().map(|c| c.start_at_ms).unwrap_or(now_ms),
            generated_at_ms: now_ms,
            current,
            upcoming,
            lookahead_count,
        }
    }

    /// snapshot the broadcaster's current `NowPlaying` without taking a
    /// full subscription. used by admin status endpoints.
    pub async fn now_playing(&self) -> Arc<NowPlaying> {
        self.state.read().await.now_playing.clone()
    }

    /// take a live snapshot for a new listener.
    pub async fn subscribe(self: &Arc<Self>) -> Subscription {
        let state = self.state.read().await;
        Subscription {
            init: state.current_init.clone(),
            catchup: state.ring.iter().cloned().collect(),
            now_playing: state.now_playing.clone(),
            next_seq: self.next_seq.load(Ordering::Relaxed),
            init_seq: state.init_seq,
            chunk_rx: self.chunk_tx.subscribe(),
            meta_rx: self.meta_tx.subscribe(),
        }
    }

    pub fn join(&self) -> u32 {
        let next = self.listener_count.fetch_add(1, Ordering::Relaxed) + 1;
        if next == 1 {
            self.listener_notify.notify_waiters();
            let station_id = self.station_id.clone();
            tokio::spawn(async move { crate::radio::requests::mark_active(&station_id).await });
        }
        next
    }

    pub fn leave(&self) -> u32 {
        let prev = self.listener_count.fetch_sub(1, Ordering::Relaxed);
        let next = prev.saturating_sub(1);
        if next == 0 {
            let station_id = self.station_id.clone();
            tokio::spawn(async move { crate::radio::requests::mark_idle(&station_id).await });
        }
        next
    }

    pub fn listener_count(&self) -> u32 {
        self.listener_count.load(Ordering::Relaxed)
    }

    /// the seq the broadcaster will assign to the *next* chunk it
    /// produces. matches the `current_seq` reported in `HelloMessage`.
    /// useful for the `ChunkReady` heartbeat.
    pub fn current_seq(&self) -> u32 {
        self.next_seq.load(Ordering::Relaxed)
    }

    /// elapsed playback time of the current track in milliseconds, as
    /// measured from when the broadcaster pushed its init chunk. returns
    /// `0` until the first track starts. used by the radio handler to
    /// populate `HelloMessage.current_track_elapsed_ms` so fresh
    /// listeners can position their scrubber at the live edge.
    pub fn current_track_elapsed_ms(&self) -> u64 {
        let started = self.track_started_at_ms.load(Ordering::Relaxed);
        if started == 0 {
            return 0;
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(started);
        (now.saturating_sub(started)).max(0) as u64
    }

    pub fn request_skip_current_track(&self) -> GrimoireResult<()> {
        let now_ms = unix_now_ms();
        let last_skip = self.last_skip_requested_at_ms.load(Ordering::Relaxed);
        if last_skip > 0 {
            let since_last = now_ms.saturating_sub(last_skip);
            if since_last < SKIP_REQUEST_COOLDOWN_MS {
                let wait_seconds = ((SKIP_REQUEST_COOLDOWN_MS - since_last) / 1000).max(1);
                return Err(GrimoireError::BadRequest {
                    message: format!(
                        "skip is throttled for this station; wait {wait_seconds}s before trying again"
                    ),
                });
            }
        }

        let started_at = self.track_started_at_ms.load(Ordering::Relaxed);
        if started_at <= 0 {
            return Err(GrimoireError::BadRequest {
                message: "no active track to skip".to_string(),
            });
        }

        let duration_ms = self.current_track_duration_ms.load(Ordering::Relaxed);
        if duration_ms <= 0 {
            return Err(GrimoireError::BadRequest {
                message: "current track duration is unknown; skip is disabled".to_string(),
            });
        }

        let elapsed_ms = now_ms.saturating_sub(started_at);
        let remaining_ms = duration_ms.saturating_sub(elapsed_ms);
        // if the track is nearly over, ignore the skip and let it play out.
        // the next track buffers naturally; no error is surfaced to the caller.
        if remaining_ms <= SKIP_TAIL_IGNORE_MS {
            debug!(
                "[radio-broadcaster] station {} skip ignored; track ending in {}ms (tail <= {}ms)",
                self.station_id,
                remaining_ms.max(0),
                SKIP_TAIL_IGNORE_MS
            );
            return Ok(());
        }

        self.last_skip_requested_at_ms
            .store(now_ms, Ordering::Relaxed);
        self.force_new_album_pick.store(true, Ordering::Relaxed);
        self.skip_request_generation.fetch_add(1, Ordering::Relaxed);
        // notify_one stores a permit if no waiter is currently registered,
        // so the signal is never lost even if the pacing loop is between
        // iterations (not yet blocked on notified()). notify_waiters() does
        // not store a permit and would silently drop the skip in that window.
        self.skip_notify.notify_one();
        info!(
            "[radio-broadcaster] station {} accepted admin skip request (remaining={}ms)",
            self.station_id, remaining_ms
        );
        Ok(())
    }

    async fn run(self: Arc<Self>) {
        info!(
            "[radio-broadcaster] starting encode loop for station {}",
            self.station_id
        );
        loop {
            self.wait_for_listener().await;

            // bumper interleave: when the per-station cadence has elapsed
            // since the last bumper play (and the station has any
            // bumpers), slot one in before the next regular pick.
            let bumper_played = match self.maybe_play_bumper().await {
                Ok(p) => p,
                Err(e) => {
                    warn!(
                        "[radio-broadcaster] station {} bumper play failed: {e}; continuing",
                        self.station_id
                    );
                    false
                }
            };
            if bumper_played {
                self.announce_interstitial("switching tracks…").await;
                continue;
            }

            // request-only stations must not silently fall back to
            // filter-based/shuffle picking once their queue empties -
            // "no requests queued" is a deliberate stop-and-wait state
            // for these stations, not "play something else in the
            // meantime". `wait_for_request` re-checks both conditions
            // (still accepting requests, still has a listener) as it
            // polls, so toggling either off while waiting unsticks it.
            if self.station_accepts_requests().await
                && crate::radio::requests::list(&self.station_id)
                    .await
                    .is_empty()
            {
                self.wait_for_request().await;
                continue;
            }

            let force_new_album = self.force_new_album_pick.swap(false, Ordering::Relaxed);

            // consume from planner if available; fall back to a direct pick.
            // after a skip request, drop stale plan continuity and force
            // album mode to jump to a new album start.
            let track_result = if force_new_album {
                self.plan.write().await.clear();
                pick_for_station_force_new_album(&self.station_id).await
            } else {
                match self.consume_planner_head().await {
                    Some(planned) => Ok(planned.track),
                    None => pick_for_station(&self.station_id).await,
                }
            };

            match track_result {
                Ok(track) => {
                    // spawn planner refill in background while the current song plays.
                    let bc = self.clone();
                    let current_song_id = track.song_id.clone();
                    tokio::spawn(async move {
                        bc.refill_planner(Some(current_song_id)).await;
                    });

                    if let Err(e) = self.play_track(&track, /*is_bumper=*/ false).await {
                        warn!(
                            "[radio-broadcaster] station {} song failed: {e}; retrying in {RETRY_PAUSE:?}",
                            self.station_id
                        );
                        self.announce_interstitial("switching tracks…").await;
                        tokio::time::sleep(RETRY_PAUSE).await;
                    } else {
                        // brief gap between songs (between ffmpeg exit + next spawn)
                        // — give listeners a heads-up so the player bar can render
                        // a "switching" affordance instead of a stale title.
                        self.announce_interstitial("switching tracks…").await;
                    }
                }
                Err(e) => {
                    warn!(
                        "[radio-broadcaster] station {} pick failed: {e}; retrying in {RETRY_PAUSE:?}",
                        self.station_id
                    );
                    self.announce_interstitial("switching tracks…").await;
                    tokio::time::sleep(RETRY_PAUSE).await;
                }
            }
        }
    }

    async fn wait_for_listener(&self) {
        if self.listener_count() > 0 {
            return;
        }

        self.track_started_at_ms.store(0, Ordering::Relaxed);
        self.current_track_duration_ms.store(0, Ordering::Relaxed);
        self.current_track_is_bumper.store(false, Ordering::Relaxed);
        self.announce_idle("waiting for listeners…").await;
        info!(
            "[radio-broadcaster] station {} idle; waiting for a listener",
            self.station_id
        );

        loop {
            if self.listener_count() > 0 {
                return;
            }
            self.listener_notify.notified().await;
        }
    }

    /// true when this station currently has `accepts_requests` set.
    /// shared by `run()`'s empty-queue check and `refill_planner`'s own
    /// lookahead skip, so both places agree on exactly the same lookup.
    async fn station_accepts_requests(&self) -> bool {
        matches!(
            stations::get_station(&self.station_id).await,
            Ok(Some(s)) if s.accepts_requests != 0
        )
    }

    /// block until a request-only station's queue has something in it
    /// again (or the wait should stop for another reason - no listeners
    /// left, or requests were turned off while waiting). called from
    /// `run()` instead of falling through to filter-based picking, which
    /// would otherwise silently start shuffling library content the
    /// moment the last queued request plays out.
    async fn wait_for_request(&self) {
        self.announce_idle("waiting for requests…").await;
        info!(
            "[radio-broadcaster] station {} accepts requests but its queue is empty; waiting",
            self.station_id
        );
        loop {
            if self.listener_count() == 0 {
                return;
            }
            if !crate::radio::requests::list(&self.station_id)
                .await
                .is_empty()
            {
                return;
            }
            if !self.station_accepts_requests().await {
                return;
            }
            tokio::time::sleep(REQUEST_WAIT_POLL_INTERVAL).await;
        }
    }

    async fn announce_idle(&self, title: &str) {
        let init_seq = self.state.read().await.init_seq;
        let placeholder = Arc::new(NowPlaying {
            title: title.to_string(),
            station_id: Some(self.station_id.clone()),
            ..Default::default()
        });
        {
            let mut s = self.state.write().await;
            s.now_playing = placeholder.clone();
        }
        let _ = self.meta_tx.send(MetaUpdate::Meta {
            now_playing: placeholder,
            init_seq,
        });
    }

    /// roll the bumper dice. returns `Ok(true)` when a bumper was played,
    /// `Ok(false)` when bumpers are disabled / cadence not elapsed / no
    /// bumpers configured, and `Err` only on database failures.
    async fn maybe_play_bumper(self: &Arc<Self>) -> GrimoireResult<bool> {
        let freq = match crate::radio::bumpers::get_frequency(&self.station_id).await? {
            Some(f) if f > 0 => f,
            _ => return Ok(false),
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let last = self.last_bumper_at.load(Ordering::Relaxed);
        if last != 0 && now - last < freq {
            return Ok(false);
        }
        let bumper = match crate::radio::bumpers::pick_random(&self.station_id).await? {
            Some(b) => b,
            None => return Ok(false),
        };
        // resolve the underlying playable track (reuses the songz/videoz
        // pipeline via fetch_track - bumper.item() reports which one).
        let (kind, item_id) = bumper.item();
        let track = match crate::radio::playlist::fetch_track(kind, item_id).await {
            Ok(t) => t,
            Err(e) => {
                warn!(
                    "[radio-broadcaster] station {} bumper {} unplayable: {e}; skipping",
                    self.station_id, bumper.id
                );
                // bump the last_bumper_at so we don't tight-loop on a
                // broken bumper for every subsequent track boundary.
                self.last_bumper_at.store(now, Ordering::Relaxed);
                return Ok(false);
            }
        };
        info!(
            "[radio-broadcaster] station {} playing bumper '{}' ({})",
            self.station_id, bumper.label, bumper.id
        );
        self.play_track(&track, /*is_bumper=*/ true).await?;
        self.last_bumper_at.store(now, Ordering::Relaxed);
        Ok(true)
    }

    /// push a transient meta update tagged with the **current** init_seq.
    /// clients that already received that init chunk treat the update as
    /// "apply now" (see radioService.ts latching), so the player bar can
    /// show a "switching tracks…" banner during the gap before the next
    /// song's init chunk arrives.
    async fn announce_interstitial(self: &Arc<Self>, title: &str) {
        self.track_started_at_ms.store(0, Ordering::Relaxed);
        self.current_track_duration_ms.store(0, Ordering::Relaxed);
        self.current_track_is_bumper.store(false, Ordering::Relaxed);
        let (init_seq, station_id) = {
            let s = self.state.read().await;
            (s.init_seq, s.now_playing.station_id.clone())
        };
        let placeholder = Arc::new(NowPlaying {
            title: title.to_string(),
            station_id,
            ..Default::default()
        });
        // also stash on shared state so newly-joining listeners see the
        // placeholder in their `hello` snapshot.
        {
            let mut s = self.state.write().await;
            s.now_playing = placeholder.clone();
        }
        let _ = self.meta_tx.send(MetaUpdate::Meta {
            now_playing: placeholder,
            init_seq,
        });
    }

    async fn play_track(
        self: &Arc<Self>,
        track: &crate::radio::playlist::RadioTrack,
        is_bumper: bool,
    ) -> GrimoireResult<()> {
        info!(
            "[radio-broadcaster] station {} now playing{}: {} ({})",
            self.station_id,
            if is_bumper { " [bumper]" } else { "" },
            track.title,
            track.song_id
        );

        let art = match track.kind {
            crate::radio::playlist::RadioItemKind::Song => resolve_track_art(&track.song_id).await,
            crate::radio::playlist::RadioItemKind::Video => {
                crate::radio::art::resolve_video_poster_art(&track.song_id).await
            }
        }
        .unwrap_or_else(|e| {
            warn!(
                "[radio-broadcaster] station {} art lookup failed: {e}",
                self.station_id
            );
            None
        });

        let now_playing = Arc::new(NowPlaying {
            kind: track.kind,
            song_id: track.song_id.clone(),
            title: if is_bumper {
                format!("[station id] {}", track.title)
            } else {
                track.title.clone()
            },
            artist: track.artist.clone(),
            album: track.album.clone(),
            art: art.as_ref().map(ArtData::from_resolved),
            duration_ms: track.duration_ms,
            waveform_blob_id: track.waveform_blob_id.clone(),
            audio_blob_id: track.audio_blob_id.clone(),
            station_id: Some(self.station_id.clone()),
        });

        // small breathing-room gap between tracks. the broadcaster paces
        // chunk emission to listeners (rather than relying on ffmpeg's
        // `-re`), so we explicitly insert silence here. only sleep when
        // we've already played at least one track on this station — the
        // very first chunk after startup should not be artificially
        // delayed.
        let radio_cfg = crate::radio::config::effective();
        if self.next_seq.load(Ordering::Relaxed) > 0 {
            let gap = Duration::from_millis(radio_cfg.inter_track_silence_ms as u64);
            if gap > Duration::ZERO {
                tokio::time::sleep(gap).await;
            }
        }

        let encoder_setup_started = Instant::now();
        let mut encoder = {
            // content_mode-aware: a video-capable station with no
            // per-station encode_args override must NOT fall back to the
            // plain audio default (`-vn` strips video entirely) - see
            // `RadioStation::effective_encode_args`.
            let station_encode_args = stations::get_station(&self.station_id)
                .await
                .ok()
                .flatten()
                .map(|s| s.effective_encode_args(&radio_cfg).to_string());

            // a mixed ("audio_or_video") station still needs every track
            // to come out as the SAME h264+aac stream the client's single
            // SourceBuffer/mpv pipeline expects, even a plain song with no
            // video of its own - `-map 0:v:0` (what the video_encode_args
            // template does) against a pure audio file either matches
            // nothing, or (worse) grabs an embedded cover-art
            // "attached_pic" stream and feeds a single still frame into
            // libx264 as if it were real moving video, which fails at mux
            // time ("Could not find tag for codec h264..."). for this
            // specific case, build a one-off command with a synthesized
            // blank frame as the video input instead - simpler and one
            // less moving part than looping the track's own art image
            // (no temp file to write/clean up, no art-resolution
            // dependency for the video path at all); the art image is
            // still sent to listeners separately via the NowPlaying
            // control message either way, so nothing is lost display-wise
            // for a client that renders it there instead of in-stream.
            let synthesize_still_video = self.content_mode == "audio_or_video"
                && track.kind == crate::radio::playlist::RadioItemKind::Song;
            let synthesized_args = if synthesize_still_video {
                Some(format!(
                    "-hide_banner -loglevel error -fflags +genpts {BLANK_VIDEO_INPUT} -i {{input}} \
                     -map 0:v:0 -map 1:a:0 -c:v libx264 -profile:v main -tune stillimage \
                     -preset veryfast -b:v 600k -pix_fmt yuv420p -r 2 \
                     -c:a aac -profile:a aac_low -b:a 192k -ar 48000 -ac 2 \
                     -movflags frag_keyframe+empty_moov+default_base_moof \
                     -frag_duration 3000000 -avoid_negative_ts make_zero -shortest -f mp4 pipe:1"
                ))
            } else {
                None
            };

            let effective_args = synthesized_args
                .as_deref()
                .or(station_encode_args.as_deref());
            BufferedEncoder::start(&track.local_path, effective_args)?
        };
        let skip_generation = self.skip_request_generation.load(Ordering::Relaxed);

        let first = encoder
            .next_chunk()
            .await?
            .ok_or_else(|| GrimoireError::ProcessingFailed {
                message: "radio: encoder returned no init chunk".to_string(),
            })?;
        if !first.is_init {
            return Err(GrimoireError::ProcessingFailed {
                message: "radio: first chunk was not an init segment".to_string(),
            });
        }
        let time_to_init_chunk = encoder_setup_started.elapsed();
        let frag_ms = radio_cfg.frag_ms.max(1) as u64;

        // wait for the encoder to fill (up to) the full ring before
        // publishing this track to listeners at all, not just a small
        // fixed handful of chunks - per explicit user direction, smooth
        // playback matters far more than a fast start, and a shallow
        // warm-up leaves a track with almost no real cushion the moment
        // it's more than a few seconds old. `queued_chunks()` is a
        // non-consuming peek at the encode-ahead buffer (chunks ffmpeg
        // has already produced beyond the init one, via the background
        // feeder task), so this doesn't touch/consume anything - it just
        // delays the moment we start touching `state`/`chunk_tx` below.
        // bounded by a timeout scaled to how long the target SHOULD take
        // in real time (see `ENCODER_WARMUP_TIMEOUT_MULTIPLE`'s doc
        // comment) so a genuinely struggling encoder doesn't hang the
        // track start forever - hitting it is itself a diagnostic
        // signal, logged as a `warn!` below.
        let warmup_target_chunks = cfg::ring_capacity(&radio_cfg) as u64;
        let warmup_timeout = Duration::from_millis(
            warmup_target_chunks * frag_ms * ENCODER_WARMUP_TIMEOUT_MULTIPLE as u64,
        )
        .max(ENCODER_WARMUP_TIMEOUT_FLOOR);
        let warmup_started = Instant::now();
        // a track shorter than `warmup_target_chunks * frag_ms` of real
        // duration can NEVER reach the target - without this check that
        // case wastes the entire `warmup_timeout` every single time
        // (confirmed live: an 11s track spun for the full 120s timeout
        // before giving up on ever reaching 20 chunks). `is_finished()`
        // means the encoder has hit clean EOF/error and nothing more is
        // coming, so whatever's ready right now is genuinely final.
        while (encoder.queued_chunks() as u64) < warmup_target_chunks
            && warmup_started.elapsed() < warmup_timeout
            && !encoder.is_finished()
        {
            tokio::time::sleep(ENCODER_WARMUP_POLL_INTERVAL).await;
        }
        let warmup_elapsed = warmup_started.elapsed();
        let warmup_chunks_ready = encoder.queued_chunks() as u64;
        if warmup_chunks_ready >= warmup_target_chunks {
            info!(
                "[radio-broadcaster] station {} encoder warm-up for '{}': {warmup_chunks_ready} chunks ready \
                 after {warmup_elapsed:?} (init took {time_to_init_chunk:?})",
                self.station_id, track.title
            );
        } else if encoder.is_finished() {
            // the track's real duration is simply too short to ever
            // reach the target - not an encode-throughput problem at
            // all, so this is NOT a warning.
            info!(
                "[radio-broadcaster] station {} encoder warm-up for '{}' ended early: track \
                 finished with only {warmup_chunks_ready}/{warmup_target_chunks} chunks total \
                 after {warmup_elapsed:?} (init took {time_to_init_chunk:?}) - track is shorter \
                 than the warm-up target, not an encode-throughput issue",
                self.station_id, track.title
            );
        } else {
            warn!(
                "[radio-broadcaster] station {} encoder warm-up timed out on '{}' after {warmup_elapsed:?}: \
                 only {warmup_chunks_ready}/{warmup_target_chunks} chunks ready (init took {time_to_init_chunk:?}) - \
                 the encode can't keep up with real time even before the pacer starts; \
                 consider a cheaper preset/lower bitrate for this content_mode",
                self.station_id, track.title
            );
        }

        let init_seq = self.next_seq.fetch_add(1, Ordering::Relaxed);
        let init_arc = Arc::new(Chunk {
            seq: init_seq,
            is_init: true,
            bytes: first.bytes,
            duration_ms: None,
        });

        // stamp the track start *before* publishing the init chunk so
        // late subscribers that race in between the chunk push + the
        // listener join still get a sensible elapsed_ms.
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        self.track_started_at_ms.store(now_ms, Ordering::Relaxed);
        self.current_track_duration_ms
            .store(track.duration_ms.unwrap_or(0), Ordering::Relaxed);
        self.current_track_is_bumper
            .store(is_bumper, Ordering::Relaxed);

        {
            let mut s = self.state.write().await;
            s.current_init = Some(init_arc.clone());
            s.init_seq = init_seq;
            s.ring.clear();
            s.now_playing = now_playing.clone();
        }

        let _ = self.meta_tx.send(MetaUpdate::Meta {
            now_playing: now_playing.clone(),
            init_seq,
        });
        let _ = self.chunk_tx.send(init_arc);

        // record this play. failure is non-fatal (history is best-effort).
        // skip for bumpers — they aren't part of the listenable history.
        // also skip radio_play_historyz specifically for a video pick -
        // that table's song_id column FKs to songz, so a video id would
        // violate the constraint (recent-repeat avoidance doesn't apply
        // to video yet, see playlist.rs). play_eventz has no such
        // limitation (entity_type is already song|video), so that half
        // still records normally for video below.
        let listeners = self.listener_count() as i64;
        let play_id = if is_bumper {
            None
        } else {
            // credit each current listener with a play row in
            // play_eventz so radio plays roll up into the unified
            // top-songs/top-videos play count analytics. failure is
            // non-fatal — best-effort, same as record_play below.
            if listeners > 0 {
                let entity_type = match track.kind {
                    crate::radio::playlist::RadioItemKind::Song => "song",
                    crate::radio::playlist::RadioItemKind::Video => "video",
                };
                if let Err(e) = play_events::record_radio_plays(
                    entity_type,
                    &track.song_id,
                    &self.station_id,
                    listeners as u32,
                )
                .await
                {
                    warn!(
                        "[radio-broadcaster] station {} record_radio_plays failed: {e}",
                        self.station_id
                    );
                }
            }

            if track.kind == crate::radio::playlist::RadioItemKind::Song {
                match stations::record_play(&self.station_id, &track.song_id, listeners).await {
                    Ok(id) => Some(id),
                    Err(e) => {
                        warn!(
                            "[radio-broadcaster] station {} record_play failed: {e}",
                            self.station_id
                        );
                        None
                    }
                }
            } else {
                None
            }
        };
        let started = std::time::Instant::now();
        let mut silence_since: Option<Instant> = None;
        // server-side pacing: emit each media chunk at the wall-clock
        // moment its audio should start playing. computed against the
        // track's start instant so error doesn't accumulate. with no
        // `-re` flag on ffmpeg, the buffered encoder runs as fast as
        // the kernel pipe allows and the broadcaster pacer is the only
        // thing keeping listeners in sync with "now" for the STEADY
        // STATE of the track (see `ENCODER_WARMUP_POLL_INTERVAL`'s doc
        // comment for why steady-state pacing stays real-time even
        // though the warm-up above doesn't).
        //
        // shifts pace_origin back by however many chunks the warm-up
        // above actually managed to produce (not a fixed number), so
        // ALL of that already-produced lead is emitted immediately
        // (target < now) rather than only releasing part of it and
        // trickling the rest out at real-time cadence despite it
        // already existing. also shifts back by `STEADY_STATE_LEAD_MS`
        // (see its own doc comment) so the schedule keeps a permanent
        // cushion ahead of strict real time, not just this one-time
        // burst.
        let pace_origin = started
            .checked_sub(Duration::from_millis(
                warmup_chunks_ready * frag_ms + STEADY_STATE_LEAD_MS,
            ))
            .unwrap_or(started);
        let mut media_chunks_emitted: u64 = 0;
        // cumulative REAL media duration emitted so far, per-chunk from
        // `Chunk::duration_ms` (falling back to the nominal `frag_ms` for
        // any chunk whose fragment structure couldn't be parsed) - paces
        // off this instead of `media_chunks_emitted * frag_ms`, which
        // assumed every fragment covers exactly `frag_ms` of real media.
        // real fragments don't always land exactly on that nominal value
        // (sample-duration quantization etc); pacing off an assumption
        // that's persistently even slightly wrong compounds over a whole
        // track into the client's ahead-of-playhead cushion eroding away
        // and eventually stalling, even though delivery stays perfectly
        // on the server's own schedule the whole time.
        let mut cumulative_media_ms: u64 = 0;
        // wall-clock instant the previous chunk was actually sent (after
        // any pacing wait) - lets the per-chunk diagnostic log below
        // report the REAL measured gap between sends, directly comparable
        // to the client's own `avg`/`p95_chunk_gap_ms` session-summary
        // metric, instead of only the pacer's intended target.
        let mut last_chunk_sent_at: Option<Instant> = None;
        // how many chunks had a real parsed duration vs fell back to the
        // nominal frag_ms - purely a diagnostic (logged at track end
        // below), doesn't affect pacing itself.
        let mut chunks_with_parsed_duration: u32 = 0;
        // real-time-factor diagnostic: counts fragments the encoder
        // delivered a full frag_ms (or more) behind the pacer's schedule -
        // see the warn! at the point of detection below for what this
        // means and why it matters more for video than audio.
        let mut encoder_behind_schedule_events: u32 = 0;

        // pull chunks until ffmpeg signals EOF (clean song end). if it
        // errors mid-song we still want to close out the play history row
        // and roll straight into the next track without the inter-song
        // RETRY_PAUSE — the listener has already been on this station for
        // a while, no point making them wait an extra 3s.
        let mut skipped_by_admin = false;
        let mid_song_err = loop {
            if self.listener_count() == 0 {
                if let Some(since) = silence_since {
                    if since.elapsed() >= NO_LISTENER_GRACE {
                        info!(
                            "[radio-broadcaster] station {} stopping encoder after {:?} without listeners",
                            self.station_id,
                            NO_LISTENER_GRACE
                        );
                        break None;
                    }
                } else {
                    silence_since = Some(Instant::now());
                    info!(
                        "[radio-broadcaster] station {} lost all listeners; keeping encoder alive for {:?}",
                        self.station_id,
                        NO_LISTENER_GRACE
                    );
                }
            } else {
                silence_since = None;
            }

            let next = tokio::select! {
                res = encoder.next_chunk() => Some(res),
                _ = self.skip_notify.notified() => {
                    if self.skip_request_generation.load(Ordering::Relaxed) != skip_generation {
                        skipped_by_admin = true;
                        encoder.interrupt();
                        // tell every listener to flush their buffered audio
                        // for this track immediately, rather than letting
                        // the already-sent tail play out.
                        let _ = self.meta_tx.send(MetaUpdate::SkipFlush);
                        None
                    } else {
                        continue;
                    }
                }
            };

            let Some(next) = next else {
                break None;
            };

            match next {
                Ok(None) => break None,
                Ok(Some(chunk)) => {
                    // this chunk's real media duration, captured before
                    // `chunk.bytes` moves into the outgoing `Arc<Chunk>`
                    // below - falls back to the nominal frag_ms when the
                    // fragment's own structure couldn't be parsed.
                    let this_chunk_ms = match chunk.duration_ms {
                        Some(ms) => {
                            chunks_with_parsed_duration += 1;
                            ms as u64
                        }
                        None => frag_ms,
                    };
                    // a fragment's real duration landing FAR off nominal
                    // (not the routine +/-10ms AAC-frame-count rounding
                    // seen on almost every fragment) is itself worth
                    // flagging loudly - it directly causes a matching
                    // pacing jolt (this chunk's own release, and the
                    // NEXT chunk's target, both shift by the same
                    // amount), which is a concrete, measurable stall
                    // trigger distinct from the routine small quantization
                    // drift the cumulative-duration pacing above already
                    // absorbs smoothly.
                    let deviation_ms = this_chunk_ms as i64 - frag_ms as i64;
                    if deviation_ms.unsigned_abs() > frag_ms / 5 {
                        warn!(
                            "[radio-pacer] station {} seq={} anomalous fragment duration: \
                             this_chunk_ms={this_chunk_ms} vs nominal frag_ms={frag_ms} \
                             (deviation={deviation_ms}ms) - this alone shifts this chunk's \
                             own release and every later chunk's target by the same amount",
                            self.station_id,
                            self.next_seq.load(Ordering::Relaxed)
                        );
                    }
                    // pace: wait until this chunk's audio "starts" before
                    // pushing it. the buffered encoder has likely already
                    // produced the next several chunks; that backlog is
                    // exactly the crash-recovery cushion we want.
                    let target = pace_origin + Duration::from_millis(cumulative_media_ms);
                    let now = Instant::now();
                    if target > now {
                        // wake on skip too — admins shouldn't have to wait
                        // through the pacing sleep before the cut takes
                        // effect.
                        let sleep_for = target - now;
                        tokio::select! {
                            _ = tokio::time::sleep(sleep_for) => {}
                            _ = self.skip_notify.notified() => {
                                if self.skip_request_generation.load(Ordering::Relaxed) != skip_generation {
                                    skipped_by_admin = true;
                                    encoder.interrupt();
                                    let _ = self.meta_tx.send(MetaUpdate::SkipFlush);
                                    break None;
                                }
                            }
                        }
                    } else {
                        // encoder didn't have this fragment ready by its
                        // scheduled emission time - the buffer_seconds
                        // cushion is what's actually protecting listeners
                        // right now, not the pacer. one-off lateness (a
                        // slow disk read, a brief CPU spike) is normal and
                        // not worth logging; falling a FULL fragment or
                        // more behind schedule means the encode itself
                        // can't keep up in real time (a real risk for a
                        // video-capable station's much heavier h264 encode
                        // vs the cheap audio-only default - see
                        // `RadioConfig::video_encode_args`) and every
                        // occurrence erodes that cushion, eventually
                        // surfacing to listeners as a stall no amount of
                        // CLIENT-side buffering can mask (the bytes simply
                        // don't exist yet upstream). logged unthrottled,
                        // like other broadcaster warnings in this file -
                        // this should be rare in a healthy setup, so
                        // volume itself is the diagnostic signal.
                        //
                        // chunks still inside the warm-up burst region
                        // (`media_chunks_emitted < warmup_chunks_ready`)
                        // are EXPECTED to have `target` in the past - that
                        // IS the burst (see `pace_origin`'s doc comment
                        // above) - so `target > now` is already false for
                        // literally every one of them by design. checking
                        // "behind schedule" for those isn't a real
                        // encoder-throughput signal, it's just measuring
                        // how deep the intentional burst was; skip it
                        // entirely rather than logging N spurious
                        // "encoder running Ns behind" warnings per track.
                        if media_chunks_emitted >= warmup_chunks_ready {
                            let behind = now.duration_since(target);
                            if behind >= Duration::from_millis(frag_ms) {
                                encoder_behind_schedule_events += 1;
                                // encode-ahead depth at the moment of detection -
                                // 0 means the lead is fully exhausted (the
                                // encoder is producing at or slower than real
                                // time, not just briefly jittery); a healthy
                                // encoder should show this recovering back up
                                // toward `ring_capacity` between events.
                                let queued = encoder.queued_chunks();
                                warn!(
                                    "[radio-broadcaster] station {} encoder running {:?} behind \
                                     real-time schedule on '{}' (event #{encoder_behind_schedule_events} \
                                     this track, {queued} chunks still queued ahead) - the encode can't \
                                     keep up with frag_ms={frag_ms}ms; consider a cheaper preset/lower \
                                     bitrate for this content_mode",
                                    self.station_id, behind, track.title
                                );
                            }
                        }
                    }

                    // runtime-scheduling jitter: how much LATER than the
                    // intended `target` this task actually woke up and
                    // resumed, distinct from either a fragment-duration
                    // anomaly or the encoder falling behind - this is the
                    // tokio runtime itself not polling this task promptly
                    // (e.g. contention from other concurrent work), which
                    // would shift this chunk's ACTUAL send time even with
                    // perfectly accurate pacing math above it. chunks
                    // still inside the warm-up burst region are EXPECTED
                    // to "wake up late" relative to `target` (their
                    // `target` is deliberately backdated into the past by
                    // `pace_origin`'s own doc comment above, so the burst
                    // dumps immediately) - checking this for them isn't a
                    // real scheduling signal, it's just measuring how deep
                    // the intentional burst backdating was, same reasoning
                    // as the "encoder behind schedule" check below.
                    let woke_at = Instant::now();
                    let scheduling_jitter_ms =
                        woke_at.saturating_duration_since(target).as_millis();
                    if media_chunks_emitted >= warmup_chunks_ready && scheduling_jitter_ms > 50 {
                        warn!(
                            "[radio-pacer] station {} seq-to-be={} woke up {scheduling_jitter_ms}ms \
                             later than its pacing target - the tokio runtime didn't poll this \
                             task promptly (other concurrent work contending for it), not a \
                             fragment-duration or encoder-throughput issue",
                            self.station_id,
                            self.next_seq.load(Ordering::Relaxed)
                        );
                    }

                    let seq = self.next_seq.fetch_add(1, Ordering::Relaxed);
                    // loud, unthrottled per-chunk pacing diagnostic - the
                    // single log line to check to confirm real-duration
                    // pacing is actually active in a running build (vs a
                    // stale one) and to correlate server-side timing
                    // directly against the client's own chunk-gap/media-
                    // growth session-summary numbers. `send_gap_ms` is the
                    // REAL measured wall-clock gap since the previous
                    // chunk was sent - this is the server-side number that
                    // should track the client's `chunk_gap_ms`; if it
                    // stays pinned at `frag_ms` regardless of
                    // `this_chunk_ms`, the fix isn't actually changing the
                    // release cadence despite parsing succeeding.
                    let send_now = woke_at;
                    let _send_gap_ms =
                        last_chunk_sent_at.map(|t| send_now.duration_since(t).as_millis());
                    let _nominal_cumulative_ms = (media_chunks_emitted + 1) * frag_ms;
                    let _new_cumulative_ms = cumulative_media_ms + this_chunk_ms;
                    // info!(
                    //     "[radio-pacer] station {} seq={seq} duration_ms={:?} \
                    //      this_chunk_ms={this_chunk_ms} send_gap_ms={send_gap_ms:?} \
                    //      cumulative_media_ms={new_cumulative_ms} \
                    //      nominal_cumulative_ms={nominal_cumulative_ms} \
                    //      drift_vs_nominal_ms={} scheduling_jitter_ms={scheduling_jitter_ms}",
                    //     self.station_id,
                    //     chunk.duration_ms,
                    //     new_cumulative_ms as i64 - nominal_cumulative_ms as i64
                    // );
                    last_chunk_sent_at = Some(send_now);
                    let arc = Arc::new(Chunk {
                        seq,
                        is_init: false,
                        bytes: chunk.bytes,
                        duration_ms: chunk.duration_ms,
                    });
                    {
                        let mut s = self.state.write().await;
                        s.ring.push_back(arc.clone());
                        if s.ring.len() > s.ring_capacity {
                            s.ring.pop_front();
                        }
                    }
                    let _ = self.chunk_tx.send(arc);
                    media_chunks_emitted += 1;
                    cumulative_media_ms += this_chunk_ms;
                }
                Err(e) => break Some(e),
            }
        };

        if let Some(pid) = play_id {
            let dur = started.elapsed().as_millis() as i64;
            if let Err(e) = stations::finish_play(&pid, dur).await {
                warn!(
                    "[radio-broadcaster] station {} finish_play failed: {e}",
                    self.station_id
                );
            }
        }

        if let Some(e) = mid_song_err {
            warn!(
                "[radio-broadcaster] station {} mid-song failure on '{}': {e}; rolling to next track",
                self.station_id, track.title
            );
            return Ok(());
        }

        if skipped_by_admin {
            info!(
                "[radio-broadcaster] station {} admin-skipped track: {}",
                self.station_id, track.title
            );
            return Ok(());
        }

        info!(
            "[radio-broadcaster] station {} song finished: {} ({} chunks, {} behind-schedule events)",
            self.station_id, track.title, media_chunks_emitted, encoder_behind_schedule_events
        );
        // whole-track confirmation that the pacer's cumulative REAL
        // media duration (summed per-chunk, see `cumulative_media_ms`'s
        // own doc comment above) actually matches the track's known real
        // duration - any residual drift here now only reflects chunks
        // whose fragment structure couldn't be parsed (falling back to
        // the nominal frag_ms), not the systematic per-fragment
        // shortfall this pacer rework was meant to eliminate.
        if let Some(real_duration_ms) = track.duration_ms {
            let drift_ms = cumulative_media_ms as i64 - real_duration_ms;
            let drift_pct = if real_duration_ms > 0 {
                (drift_ms as f64 / real_duration_ms as f64) * 100.0
            } else {
                0.0
            };
            info!(
                "[radio-broadcaster] station {} fragment-duration check for '{}': \
                 real_duration={real_duration_ms}ms, cumulative_media_ms={cumulative_media_ms}ms \
                 ({chunks_with_parsed_duration}/{media_chunks_emitted} chunks had a parsed \
                 duration), drift={drift_ms}ms ({drift_pct:.1}%)",
                self.station_id, track.title
            );
        }
        Ok(())
    }
}

fn unix_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ---------- registry -----------------------------------------------------

/// global station registry. populated by [`init_registry`] at startup.
type Registry = RwLock<HashMap<String, Arc<Broadcaster>>>;
static REGISTRY: OnceLock<Registry> = OnceLock::new();

/// task handles for each running broadcaster — used by `stop_station` to
/// abort the encoder loop. parallel to `REGISTRY`.
type TaskRegistry = RwLock<HashMap<String, tokio::task::JoinHandle<()>>>;
static TASKS: OnceLock<TaskRegistry> = OnceLock::new();

/// id of the "default" station — the one used when a tune message has no
/// `station_id`. set to the first enabled station discovered at startup.
static DEFAULT_STATION_ID: OnceLock<String> = OnceLock::new();
/// once the default has been initialized once, hold a writeable mirror so
/// supervisor restarts can swap which station is "default" when the
/// previous default has been stopped or deleted.
static DEFAULT_OVERRIDE: OnceLock<RwLock<Option<String>>> = OnceLock::new();

fn registry() -> &'static Registry {
    REGISTRY.get_or_init(|| RwLock::new(HashMap::new()))
}

fn tasks() -> &'static TaskRegistry {
    TASKS.get_or_init(|| RwLock::new(HashMap::new()))
}

fn default_override() -> &'static RwLock<Option<String>> {
    DEFAULT_OVERRIDE.get_or_init(|| RwLock::new(None))
}

/// true for any content_mode that can carry video (`audio_or_video` /
/// `video_only`) - these share the smaller `max_concurrent_video_streams`
/// pool since video encoding is far more cpu-expensive than audio-only.
/// `audio_only` shares `max_concurrent_audio_streams` instead.
fn is_video_capable(content_mode: &str) -> bool {
    content_mode != "audio_only"
}

/// count currently-registered broadcasters in the given cap group
/// (video-capable vs audio-only), given an already-borrowed registry map -
/// used by `init_registry`, which already holds the write lock and would
/// deadlock re-acquiring it via `running_count_for_group`.
fn count_group_in_map(reg: &HashMap<String, Arc<Broadcaster>>, video: bool) -> usize {
    reg.values()
        .filter(|bc| is_video_capable(&bc.content_mode) == video)
        .count()
}

/// same as `count_group_in_map`, but acquires its own read lock - for
/// callers (`start_station`) that don't already hold one.
async fn running_count_for_group(video: bool) -> usize {
    let reg = registry().read().await;
    count_group_in_map(&reg, video)
}

fn concurrency_cap_error(video: bool, current: usize, limit: u32) -> GrimoireError {
    let group = if video { "video" } else { "audio" };
    GrimoireError::ProcessingFailed {
        message: format!(
            "radio: concurrent {group} stream limit reached ({current}/{limit}) - stop \
             another {group} station first or raise max_concurrent_{group}_streams in the \
             [radio] config"
        ),
    }
}

/// start a broadcaster for every enabled station in the database. safe
/// to call multiple times — already-running stations are kept; stations
/// added since the last call are spawned. stations removed since last
/// call are NOT torn down (do that explicitly with [`stop_station`]).
pub async fn init_registry() -> GrimoireResult<()> {
    let mut stations_rows = stations::list_stations().await?;

    // first-boot zero-config: seed a "freqhole radio" station that uses
    // the toml-level encode_args + global random source. operators can
    // rename it / add filter clauses later via the cli or ui.
    if stations_rows.is_empty() {
        info!("[radio-broadcaster] no stations in db; seeding default 'freqhole radio'");
        let seed = stations::create_station(stations::CreateStationRequest {
            name: "freqhole radio".to_string(),
            description: Some("auto-seeded default station".to_string()),
            is_public: Some(true),
            is_enabled: Some(true),
            encode_args: None,
            codec: None,
            play_mode: None,
            timeline_only_mode: None,
            content_mode: None,
            accepts_requests: None,
        })
        .await?;
        stations_rows = vec![seed];
    }

    let enabled: Vec<_> = stations_rows
        .into_iter()
        .filter(|s| s.is_enabled != 0)
        .collect();

    if enabled.is_empty() {
        warn!("[radio-broadcaster] no enabled stations in db; nothing to start");
        return Ok(());
    }

    // first enabled station becomes default for clients that don't set
    // station_id (single-station deployments + the demo).
    let _ = DEFAULT_STATION_ID.set(enabled[0].id.clone());

    let radio_cfg = crate::radio::config::effective();
    let mut reg = registry().write().await;
    let mut tk = tasks().write().await;
    for st in enabled {
        if reg.contains_key(&st.id) {
            continue;
        }
        let video = is_video_capable(&st.content_mode);
        let limit = if video {
            radio_cfg.max_concurrent_video_streams
        } else {
            radio_cfg.max_concurrent_audio_streams
        };
        let current = count_group_in_map(&reg, video);
        if current >= limit as usize {
            warn!(
                "[radio-broadcaster] station '{}' ({}) not started at boot: {} concurrent-stream \
                 limit reached ({}/{}) - raise max_concurrent_{}_streams in [radio] config to \
                 start more at once",
                st.name,
                st.id,
                if video { "video" } else { "audio" },
                current,
                limit,
                if video { "video" } else { "audio" }
            );
            continue;
        }
        let bc = Arc::new(Broadcaster::new(st.id.clone(), st.content_mode.clone()));
        // seed runtime flag from db so a server restart picks up the
        // persisted value without an extra admin call.
        if st.timeline_only_mode != 0 {
            bc.set_timeline_only(true);
        }
        reg.insert(st.id.clone(), bc.clone());
        let task_bc = bc.clone();
        let handle = tokio::spawn(async move { task_bc.run().await });
        tk.insert(st.id.clone(), handle);
        info!(
            "[radio-broadcaster] spawned station '{}' ({})",
            st.name, st.id
        );
    }
    Ok(())
}

/// look up a broadcaster by station id.
pub async fn get_station(station_id: &str) -> Option<Arc<Broadcaster>> {
    registry().read().await.get(station_id).cloned()
}

/// look up the default station's broadcaster (first enabled station at
/// init time, or whatever the supervisor has since promoted).
pub async fn get_default() -> Option<Arc<Broadcaster>> {
    let id = {
        let ovr = default_override().read().await;
        if let Some(id) = ovr.as_ref() {
            id.clone()
        } else {
            DEFAULT_STATION_ID.get()?.clone()
        }
    };
    get_station(&id).await
}

/// resolved default station id (supervisor override wins). returns
/// `None` when init hasn't run / no enabled station was found.
pub async fn current_default_station_id() -> Option<String> {
    if let Some(id) = default_override().read().await.as_ref() {
        return Some(id.clone());
    }
    DEFAULT_STATION_ID.get().cloned()
}

/// list every running broadcaster (for /api/radio/info).
pub async fn list_running() -> Vec<Arc<Broadcaster>> {
    let mut out: Vec<_> = registry().read().await.values().cloned().collect();
    out.sort_by(|a, b| a.station_id().cmp(b.station_id()));
    out
}

/// the id used as the default station. None when no stations have been
/// initialized yet.
pub fn default_station_id() -> Option<&'static str> {
    DEFAULT_STATION_ID.get().map(|s| s.as_str())
}

// ---------- supervisor: per-station start / stop / restart ---------------

/// is the named station currently spawned?
pub async fn is_running(station_id: &str) -> bool {
    registry().read().await.contains_key(station_id)
}

/// list station ids currently spawned.
pub async fn running_station_ids() -> Vec<String> {
    registry().read().await.keys().cloned().collect()
}

/// find a currently-running broadcaster in the given cap group (video vs
/// audio) with zero listeners, other than `exclude` - a candidate to stop
/// and free a concurrency slot for a newly-requested station. the cap
/// counts running broadcaster PROCESSES, not active listeners, so a
/// station nobody is listening to (e.g. everyone left minutes ago, or it
/// was auto-started at boot and never actually tuned into) would
/// otherwise occupy its slot forever.
async fn find_idle_broadcaster_in_group(video: bool, exclude: &str) -> Option<String> {
    let reg = registry().read().await;
    reg.values()
        .filter(|bc| bc.station_id() != exclude)
        .filter(|bc| is_video_capable(&bc.content_mode) == video)
        .filter(|bc| bc.listener_count() == 0)
        .map(|bc| bc.station_id().to_string())
        .next()
}

/// spawn a broadcaster for `station_id` if not already running. errors
/// when the station row is missing or marked `is_enabled = 0`. idempotent
/// on re-call (returns Ok).
pub async fn start_station(station_id: &str) -> GrimoireResult<()> {
    {
        let reg = registry().read().await;
        if reg.contains_key(station_id) {
            return Ok(());
        }
    }
    let st = stations::get_station(station_id).await?.ok_or_else(|| {
        GrimoireError::ProcessingFailed {
            message: format!("station '{}' not found", station_id),
        }
    })?;
    if st.is_enabled == 0 {
        return Err(GrimoireError::ProcessingFailed {
            message: format!(
                "station '{}' is disabled; flip is_enabled before starting",
                st.id
            ),
        });
    }
    let video = is_video_capable(&st.content_mode);
    let radio_cfg = crate::radio::config::effective();
    let limit = if video {
        radio_cfg.max_concurrent_video_streams
    } else {
        radio_cfg.max_concurrent_audio_streams
    };
    let current = running_count_for_group(video).await;
    if current >= limit as usize {
        // don't fail immediately - a running-but-unlistened-to station in
        // the same group is a better use of the slot than this brand new
        // request. only surface the cap error if every station in the
        // group genuinely has listeners.
        match find_idle_broadcaster_in_group(video, station_id).await {
            Some(idle_id) => {
                info!(
                    "[radio-broadcaster] concurrency cap reached ({current}/{limit}) - \
                     stopping idle station '{idle_id}' to free a slot for '{station_id}'"
                );
                stop_station(&idle_id).await?;
            }
            None => return Err(concurrency_cap_error(video, current, limit)),
        }
    }
    let bc = Arc::new(Broadcaster::new(st.id.clone(), st.content_mode.clone()));
    let task_bc = bc.clone();
    let handle = tokio::spawn(async move { task_bc.run().await });
    {
        let mut reg = registry().write().await;
        reg.insert(st.id.clone(), bc.clone());
    }
    {
        let mut tk = tasks().write().await;
        tk.insert(st.id.clone(), handle);
    }
    // promote to default if there isn't one yet.
    if DEFAULT_STATION_ID.get().is_none() {
        let _ = DEFAULT_STATION_ID.set(st.id.clone());
    }
    info!(
        "[radio-broadcaster] supervisor spawned '{}' ({})",
        st.name, st.id
    );
    Ok(())
}

/// stop the broadcaster for `station_id`. aborts the encoder loop and
/// drops the broadcaster from the registry. listeners on the closed
/// broadcast channels disconnect on next read. no-op when not running.
pub async fn stop_station(station_id: &str) -> GrimoireResult<()> {
    let bc = {
        let mut reg = registry().write().await;
        reg.remove(station_id)
    };
    let handle = {
        let mut tk = tasks().write().await;
        tk.remove(station_id)
    };
    if let Some(h) = handle {
        h.abort();
    }
    drop(bc);
    // if we just removed the default, pick a new one.
    if DEFAULT_STATION_ID.get().map(|s| s.as_str()) == Some(station_id) {
        let next = registry().read().await.keys().next().cloned();
        let mut ovr = default_override().write().await;
        *ovr = next;
    }
    info!("[radio-broadcaster] supervisor stopped '{}'", station_id);
    Ok(())
}

/// stop + start a station's broadcaster. forces a reload of station
/// settings (e.g. `encode_args`, source query) without bouncing the
/// whole server.
pub async fn restart_station(station_id: &str) -> GrimoireResult<()> {
    stop_station(station_id).await?;
    // small delay so any inflight ffmpeg child has a moment to exit
    // before the new encoder grabs the file handles.
    tokio::time::sleep(Duration::from_millis(150)).await;
    start_station(station_id).await
}

/// ask a running station to skip its current track. this is throttled by
/// the broadcaster so admin spam cannot churn the encoder loop.
pub async fn skip_station_track(station_id: &str) -> GrimoireResult<()> {
    let bc = get_station(station_id)
        .await
        .ok_or_else(|| GrimoireError::BadRequest {
            message: format!("station '{station_id}' is not running"),
        })?;
    bc.request_skip_current_track()
}

/// stop every running broadcaster. used by the supervisor to "disable"
/// the radio surface in response to a config-toggle from the wizard.
pub async fn stop_all() -> GrimoireResult<()> {
    let ids: Vec<String> = registry().read().await.keys().cloned().collect();
    for id in ids {
        stop_station(&id).await?;
    }
    Ok(())
}
