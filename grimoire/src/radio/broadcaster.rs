//! shared radio broadcaster.
//!
//! a single global encoder pulls songs from the library, runs ffmpeg with
//! `-re` (wall-clock pacing), and fans the resulting fMP4 chunks out to all
//! connected listeners over a `tokio::sync::broadcast` channel.
//!
//! design vs phase 0:
//!
//! - phase 0: every iroh connection ran its own ffmpeg + picked its own song.
//!   each listener heard a different stream — fine for proving the pipeline,
//!   not at all "radio".
//! - phase 1: ONE encoder, ONE current-track state, every listener hears the
//!   same song at the same point. brand new listeners get the current init
//!   segment + a small "catchup" of recent media chunks, then join the live
//!   broadcast.
//!
//! the broadcaster keeps encoding even with zero listeners — that way joining
//! the station is instant and we don't have to coordinate startup. with `-re`
//! pacing this is roughly free (ffmpeg sleeps between frames).

use crate::error::{GrimoireError, GrimoireResult};
use crate::radio::art::resolve_track_art;
use crate::radio::chunk::Chunk;
use crate::radio::encoder::Encoder;
use crate::radio::messages::{ArtData, NowPlaying};
use crate::radio::playlist::pick_random_song;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::sync::{broadcast, RwLock};
use tracing::{info, warn};

/// number of recent media chunks the broadcaster keeps in memory so a new
/// listener can "catch up" to the live edge. with 3-second fragments this is
/// ~12s of pre-roll — enough for the browser to start playback smoothly.
const RING_CAPACITY: usize = 4;

/// per-listener channel buffer for the audio fan-out. each entry is an
/// `Arc<Chunk>` so the underlying bytes are not cloned. if a slow listener
/// falls behind by more than this many chunks they get `RecvError::Lagged`
/// and we disconnect them.
const CHUNK_CHANNEL_CAPACITY: usize = 32;

/// per-listener channel buffer for meta updates. meta only fires on track
/// changes (every few minutes) so this can be small.
const META_CHANNEL_CAPACITY: usize = 8;

/// short pause between songs when the playlist or encoder fails. avoids a
/// hot retry loop if (e.g.) the library is empty or ffmpeg is missing.
const RETRY_PAUSE: Duration = Duration::from_secs(3);

/// snapshot a new listener takes when joining the broadcast.
pub struct Subscription {
    /// the current track's init segment. listener should append this to its
    /// SourceBuffer first, then play `catchup` chunks, then live chunks.
    pub init: Option<Arc<Chunk>>,
    /// recent media chunks the broadcaster has cached for catchup.
    pub catchup: Vec<Arc<Chunk>>,
    /// metadata for the currently playing track.
    pub now_playing: Arc<NowPlaying>,
    /// seq the broadcaster will assign to the NEXT chunk it sends.
    pub next_seq: u32,
    /// seq of the current init segment.
    pub init_seq: u32,
    /// live chunk receiver. `Arc<Chunk>` so multiple listeners share bytes.
    pub chunk_rx: broadcast::Receiver<Arc<Chunk>>,
    /// live meta receiver, fires once per track change.
    pub meta_rx: broadcast::Receiver<Arc<NowPlaying>>,
}

struct State {
    current_init: Option<Arc<Chunk>>,
    init_seq: u32,
    ring: VecDeque<Arc<Chunk>>,
    now_playing: Arc<NowPlaying>,
}

impl State {
    fn empty() -> Self {
        Self {
            current_init: None,
            init_seq: 0,
            ring: VecDeque::with_capacity(RING_CAPACITY),
            now_playing: Arc::new(NowPlaying {
                title: "(starting up...)".to_string(),
                ..Default::default()
            }),
        }
    }
}

pub struct Broadcaster {
    state: RwLock<State>,
    chunk_tx: broadcast::Sender<Arc<Chunk>>,
    meta_tx: broadcast::Sender<Arc<NowPlaying>>,
    next_seq: AtomicU32,
    listener_count: AtomicU32,
}

impl Broadcaster {
    fn new() -> Self {
        let (chunk_tx, _) = broadcast::channel(CHUNK_CHANNEL_CAPACITY);
        let (meta_tx, _) = broadcast::channel(META_CHANNEL_CAPACITY);
        Self {
            state: RwLock::new(State::empty()),
            chunk_tx,
            meta_tx,
            next_seq: AtomicU32::new(0),
            listener_count: AtomicU32::new(0),
        }
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

    /// increment listener count, returning the new total. handler should call
    /// this when a control stream is accepted, and pair with
    /// [`Self::leave`] (e.g. via a `ListenerGuard`).
    pub fn join(&self) -> u32 {
        self.listener_count.fetch_add(1, Ordering::Relaxed) + 1
    }

    /// decrement listener count. safe to call from a `Drop` handler.
    pub fn leave(&self) -> u32 {
        let prev = self.listener_count.fetch_sub(1, Ordering::Relaxed);
        prev.saturating_sub(1)
    }

    pub fn listener_count(&self) -> u32 {
        self.listener_count.load(Ordering::Relaxed)
    }

    async fn run(self: Arc<Self>) {
        info!("[radio-broadcaster] starting encode loop");
        loop {
            if let Err(e) = self.play_one_song().await {
                warn!("[radio-broadcaster] song failed: {e}; retrying in {RETRY_PAUSE:?}");
                tokio::time::sleep(RETRY_PAUSE).await;
            }
        }
    }

    async fn play_one_song(self: &Arc<Self>) -> GrimoireResult<()> {
        let track = pick_random_song().await?;
        info!(
            "[radio-broadcaster] now playing: {} ({})",
            track.title, track.song_id
        );

        // resolve art before swapping state so the meta announcement has it.
        let art = match resolve_track_art(&track.song_id).await {
            Ok(a) => a,
            Err(e) => {
                warn!("[radio-broadcaster] art lookup failed: {e}");
                None
            }
        };

        let now_playing = Arc::new(NowPlaying {
            song_id: track.song_id.clone(),
            title: track.title.clone(),
            artist: track.artist.clone(),
            album: track.album.clone(),
            art: art.as_ref().map(ArtData::from_resolved),
        });

        let mut encoder = Encoder::start(&track.local_path)?;

        // first chunk MUST be the init segment. anything else is a hard error
        // — it means the BoxParser didn't recognize the ftyp/moov pair.
        let first = encoder.next_chunk().await?.ok_or_else(|| {
            GrimoireError::ProcessingFailed {
                message: "radio: encoder returned no init chunk".to_string(),
            }
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

        // swap state under one write so listeners always see a consistent
        // (init, meta) pair.
        {
            let mut s = self.state.write().await;
            s.current_init = Some(init_arc.clone());
            s.init_seq = init_seq;
            s.ring.clear();
            s.now_playing = now_playing.clone();
        }

        // announce in order: meta first, then init chunk. clients receive the
        // meta on the control stream and the init on the audio stream — they
        // don't strictly need to be ordered, but UI updating slightly before
        // audio swap feels right.
        let _ = self.meta_tx.send(now_playing);
        let _ = self.chunk_tx.send(init_arc);

        // pump media chunks until ffmpeg exits (= song over).
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
                        if s.ring.len() > RING_CAPACITY {
                            s.ring.pop_front();
                        }
                    }
                    // .send() returns Err only if there are no receivers;
                    // that's fine, the broadcaster runs even with zero
                    // listeners.
                    let _ = self.chunk_tx.send(arc);
                }
            }
        }

        info!("[radio-broadcaster] song finished: {}", track.title);
        Ok(())
    }
}

/// global broadcaster. populated by [`init_global`] when the radio server
/// starts, then cloned by every connection handler.
static BROADCASTER: OnceLock<Arc<Broadcaster>> = OnceLock::new();

/// start the global broadcaster and spawn its background encode loop.
/// safe to call repeatedly — subsequent calls are no-ops and return the
/// existing instance.
pub fn init_global() -> Arc<Broadcaster> {
    if let Some(existing) = BROADCASTER.get() {
        return existing.clone();
    }
    let bc = Arc::new(Broadcaster::new());
    // race with another init_global call: whichever loses uses the winner.
    match BROADCASTER.set(bc.clone()) {
        Ok(()) => {
            let task_bc = bc.clone();
            tokio::spawn(async move { task_bc.run().await });
            bc
        }
        Err(_) => BROADCASTER.get().expect("set just failed").clone(),
    }
}

/// fetch the global broadcaster, if [`init_global`] has been called.
pub fn get_broadcaster() -> Option<Arc<Broadcaster>> {
    BROADCASTER.get().cloned()
}
