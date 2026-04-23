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
        }
    }

    pub fn station_id(&self) -> &str {
        &self.station_id
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

    async fn run(self: Arc<Self>) {
        info!(
            "[radio-broadcaster] starting encode loop for station {}",
            self.station_id
        );
        loop {
            if let Err(e) = self.play_one_song().await {
                warn!(
                    "[radio-broadcaster] station {} song failed: {e}; retrying in {RETRY_PAUSE:?}",
                    self.station_id
                );
                tokio::time::sleep(RETRY_PAUSE).await;
            }
        }
    }

    async fn play_one_song(self: &Arc<Self>) -> GrimoireResult<()> {
        let track = pick_for_station(&self.station_id).await?;
        info!(
            "[radio-broadcaster] station {} now playing: {} ({})",
            self.station_id, track.title, track.song_id
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
            title: track.title.clone(),
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
        let listeners = self.listener_count() as i64;
        let play_id = match stations::record_play(&self.station_id, &track.song_id, listeners).await
        {
            Ok(id) => Some(id),
            Err(e) => {
                warn!(
                    "[radio-broadcaster] station {} record_play failed: {e}",
                    self.station_id
                );
                None
            }
        };
        let started = std::time::Instant::now();

        loop {
            match encoder.next_chunk().await? {
                None => break,
                Some(chunk) => {
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
            }
        }

        if let Some(pid) = play_id {
            let dur = started.elapsed().as_millis() as i64;
            if let Err(e) = stations::finish_play(&pid, dur).await {
                warn!(
                    "[radio-broadcaster] station {} finish_play failed: {e}",
                    self.station_id
                );
            }
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

/// id of the "default" station — the one used when a tune message has no
/// `station_id`. set to the first enabled station discovered at startup.
static DEFAULT_STATION_ID: OnceLock<String> = OnceLock::new();

fn registry() -> &'static Registry {
    REGISTRY.get_or_init(|| RwLock::new(HashMap::new()))
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
    for st in enabled {
        if reg.contains_key(&st.id) {
            continue;
        }
        let bc = Arc::new(Broadcaster::new(st.id.clone()));
        reg.insert(st.id.clone(), bc.clone());
        let task_bc = bc.clone();
        tokio::spawn(async move { task_bc.run().await });
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
/// init time).
pub async fn get_default() -> Option<Arc<Broadcaster>> {
    let id = DEFAULT_STATION_ID.get()?.clone();
    get_station(&id).await
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
