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
use crate::radio::art::resolve_track_art;
use crate::radio::chunk::Chunk;
use crate::radio::config as cfg;
use crate::radio::encoder::Encoder;
use crate::radio::messages::{ArtData, NowPlaying, RadioModeCapability};
use crate::radio::messages::{TimelineCurrentItem, TimelineMessage, TimelineUpcomingItem};
use crate::radio::playlist::pick_for_station;
use crate::radio::stations;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, Notify, RwLock};
use tracing::{info, warn};

/// short pause between songs when the playlist or encoder fails. avoids
/// a hot retry loop if (e.g.) the library is empty or ffmpeg is missing.
const RETRY_PAUSE: Duration = Duration::from_secs(3);

/// when the last listener leaves, keep the current ffmpeg pipeline alive
/// for a bit in case they only paused / scrubbed / reconnected.
const NO_LISTENER_GRACE: Duration = Duration::from_secs(60);
const SKIP_REQUEST_COOLDOWN_MS: i64 = 30_000;
const SKIP_MIN_REMAINING_MS: i64 = 30_000;

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
pub struct MetaUpdate {
    pub now_playing: Arc<NowPlaying>,
    pub init_seq: u32,
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
    /// wakes the run loop when the first listener arrives while the
    /// station is idle.
    listener_notify: Notify,
    /// wakes the active song loop when an admin requests a skip.
    skip_notify: Notify,
    /// rolling plan of pre-picked upcoming songs. consumed by the run loop
    /// at each track boundary; refilled in a background task while the
    /// current song plays so timeline snapshots have real lookahead.
    plan: RwLock<VecDeque<PlannedItem>>,
    /// monotonic counter used when minting `timeline_item_id` values for
    /// planned items.
    plan_item_seq: AtomicU64,
}

impl Broadcaster {
    fn new(station_id: String) -> Self {
        let (chunk_tx, _) = broadcast::channel(cfg::CHUNK_CHANNEL_CAPACITY);
        let (meta_tx, _) = broadcast::channel(cfg::META_CHANNEL_CAPACITY);
        Self {
            state: RwLock::new(State::empty(cfg::RING_CAPACITY, &station_id)),
            station_id,
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
            listener_notify: Notify::new(),
            skip_notify: Notify::new(),
            plan: RwLock::new(VecDeque::new()),
            plan_item_seq: AtomicU64::new(0),
        }
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
        self.plan.write().await.pop_front()
    }

    /// fill the plan up to MAX_UPCOMING_ITEMS (or TARGET_HORIZON_MS coverage).
    /// spawned as a background task after each track boundary so upcoming
    /// items are ready for timeline_snapshot() calls during the current song.
    async fn refill_planner(self: &Arc<Self>) {
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
                match pick_for_station(&self.station_id).await {
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
        }
        next
    }

    pub fn leave(&self) -> u32 {
        let prev = self.listener_count.fetch_sub(1, Ordering::Relaxed);
        prev.saturating_sub(1)
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
        if self.current_track_is_bumper.load(Ordering::Relaxed) {
            return Err(GrimoireError::BadRequest {
                message: "cannot skip a station bumper".to_string(),
            });
        }

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
        if remaining_ms < SKIP_MIN_REMAINING_MS {
            return Err(GrimoireError::BadRequest {
                message: format!(
                    "skip is only allowed when at least 30s remain on the current track ({:.0}s left)",
                    remaining_ms.max(0) as f64 / 1000.0,
                ),
            });
        }

        self.last_skip_requested_at_ms
            .store(now_ms, Ordering::Relaxed);
        self.skip_request_generation.fetch_add(1, Ordering::Relaxed);
        self.skip_notify.notify_waiters();
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

            // consume from planner if available; fall back to a direct pick.
            let track_result = match self.consume_planner_head().await {
                Some(planned) => Ok(planned.track),
                None => pick_for_station(&self.station_id).await,
            };

            match track_result {
                Ok(track) => {
                    // spawn planner refill in background while the current song plays.
                    let bc = self.clone();
                    tokio::spawn(async move {
                        bc.refill_planner().await;
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
        let _ = self.meta_tx.send(MetaUpdate {
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
        // resolve the underlying playable track (reuses the songz pipeline).
        let track = match crate::radio::playlist::fetch_track(&bumper.song_id).await {
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
        let _ = self.meta_tx.send(MetaUpdate {
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

        let art = match resolve_track_art(&track.song_id).await {
            Ok(a) => a,
            Err(e) => {
                warn!(
                    "[radio-broadcaster] station {} art lookup failed: {e}",
                    self.station_id
                );
                None
            }
        };

        let now_playing = Arc::new(NowPlaying {
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

        let mut encoder = Encoder::start(&track.local_path)?;
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

        let init_seq = self.next_seq.fetch_add(1, Ordering::Relaxed);
        let init_arc = Arc::new(Chunk {
            seq: init_seq,
            is_init: true,
            bytes: first.bytes,
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

        let _ = self.meta_tx.send(MetaUpdate {
            now_playing: now_playing.clone(),
            init_seq,
        });
        let _ = self.chunk_tx.send(init_arc);

        // record this play. failure is non-fatal (history is best-effort).
        // skip for bumpers — they aren't part of the listenable history.
        let listeners = self.listener_count() as i64;
        let play_id = if is_bumper {
            None
        } else {
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
        };
        let started = std::time::Instant::now();
        let mut silence_since: Option<Instant> = None;

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
                _ = self.skip_notify.notified(), if !is_bumper => {
                    if self.skip_request_generation.load(Ordering::Relaxed) != skip_generation {
                        skipped_by_admin = true;
                        encoder.interrupt();
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
                    let seq = self.next_seq.fetch_add(1, Ordering::Relaxed);
                    let arc = Arc::new(Chunk {
                        seq,
                        is_init: false,
                        bytes: chunk.bytes,
                    });
                    {
                        let mut s = self.state.write().await;
                        s.ring.push_back(arc.clone());
                        if s.ring.len() > s.ring_capacity {
                            s.ring.pop_front();
                        }
                    }
                    let _ = self.chunk_tx.send(arc);
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
            "[radio-broadcaster] station {} song finished: {}",
            self.station_id, track.title
        );
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

    let mut reg = registry().write().await;
    let mut tk = tasks().write().await;
    for st in enabled {
        if reg.contains_key(&st.id) {
            continue;
        }
        let bc = Arc::new(Broadcaster::new(st.id.clone()));
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
    let bc = Arc::new(Broadcaster::new(st.id.clone()));
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
