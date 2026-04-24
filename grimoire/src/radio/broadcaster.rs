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
use crate::radio::messages::{ArtData, NowPlaying};
use crate::radio::playlist::pick_for_station;
use crate::radio::stations;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::sync::{broadcast, RwLock};
use tracing::{info, warn};

/// short pause between songs when the playlist or encoder fails. avoids
/// a hot retry loop if (e.g.) the library is empty or ffmpeg is missing.
const RETRY_PAUSE: Duration = Duration::from_secs(3);

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
        }
    }

    pub fn station_id(&self) -> &str {
        &self.station_id
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
        self.listener_count.fetch_add(1, Ordering::Relaxed) + 1
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

    async fn run(self: Arc<Self>) {
        info!(
            "[radio-broadcaster] starting encode loop for station {}",
            self.station_id
        );
        loop {
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

            match pick_for_station(&self.station_id).await {
                Ok(track) => {
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
            station_id: Some(self.station_id.clone()),
        });

        let mut encoder = Encoder::start(&track.local_path)?;

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

        // pull chunks until ffmpeg signals EOF (clean song end). if it
        // errors mid-song we still want to close out the play history row
        // and roll straight into the next track without the inter-song
        // RETRY_PAUSE — the listener has already been on this station for
        // a while, no point making them wait an extra 3s.
        let mid_song_err = loop {
            match encoder.next_chunk().await {
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

        info!(
            "[radio-broadcaster] station {} song finished: {}",
            self.station_id, track.title
        );
        Ok(())
    }
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
    registry().read().await.values().cloned().collect()
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
    let st = stations::get_station(station_id)
        .await?
        .ok_or_else(|| GrimoireError::ProcessingFailed {
            message: format!("station '{}' not found", station_id),
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
        let next = registry()
            .read()
            .await
            .keys()
            .next()
            .cloned();
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

/// stop every running broadcaster. used by the supervisor to "disable"
/// the radio surface in response to a config-toggle from the wizard.
pub async fn stop_all() -> GrimoireResult<()> {
    let ids: Vec<String> = registry().read().await.keys().cloned().collect();
    for id in ids {
        stop_station(&id).await?;
    }
    Ok(())
}
