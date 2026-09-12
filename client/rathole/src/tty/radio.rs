//! rathole's `--player`/cenotaph radio client.
//!
//! connects to a broadcaster over `freqhole-radio/1` (grimoire's own
//! `radio::{messages,protocol}` types - the same wire format the
//! browser/wasm and charnel-native radio clients use, see
//! `client/charnel/src-tauri/src/radio_commands.rs`, which this
//! module's connect/tune/hello handshake mirrors closely), and writes
//! the raw fMP4 chunk stream into a per-track named pipe that gets
//! `VideoCommand::Load`ed into the existing mpv backend.
//!
//! mpv (not rodio) drives radio playback: rodio's `PlayerCommand::Load`
//! only ever opens a real `std::fs::File` (needs `Read + Seek`, since
//! rodio/symphonia's `Decoder::new` requires `Seek`), and a fifo isn't
//! seekable - there's no precedent anywhere in this codebase of rodio
//! decoding a live/growing stream. mpv already handles exactly this
//! (it's built for HLS/live streams), and rathole already manages an
//! mpv subprocess for video/audio-fallback playback (`tty::video_player`).
//!
//! each track gets its OWN fifo, mirroring the wire protocol's own
//! per-track "soft reset" semantics (see `protocol.rs`'s `is_init` doc
//! comment - browsers tear down + recreate their MediaSource on this
//! same flag): a new `is_init` chunk drops the previous fifo's write
//! end (mpv sees EOF and that "file" ends) and opens a fresh one,
//! `loadfile`d into mpv the same way a queued song/video is - this
//! avoids needing to signal a mid-stream demux reset to mpv itself,
//! which has no clean way to do that against one already-open file.

use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};

use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;

use grimoire::federation::p2p_client::{get_endpoint_arc, parse_peer_address};
use grimoire::radio::messages::{ControlMessage, TuneMessage};
use grimoire::radio::protocol::{read_chunk, read_control_message, write_control_message, RADIO_ALPN};

use crate::ratcore::app::{App, AppAction, RadioPlaybackState, VideoCommand};
use crate::ratcore::transport::VideoPlayer;

/// bumped on every `start`/`stop` - lets a superseded session's task
/// recognize it's stale (another tune or an explicit stop happened)
/// and stop touching mpv/fifos, without needing a cross-task
/// cancellation channel. mirrors the `playGeneration`/`adapterGeneration`
/// staleness-guard pattern already used on the spume side for the same
/// "an old async loop must not keep acting once it's been superseded"
/// problem (see radioQueueAdapter.ts/playbackEngine.ts).
static GENERATION: AtomicU64 = AtomicU64::new(0);

fn generation_is_current(generation: u64) -> bool {
    GENERATION.load(Ordering::SeqCst) == generation
}

/// start (or retune) a radio session - any previous session is
/// superseded immediately (its next chunk/control-message check will
/// fail and it tears itself down on its own).
pub fn start(
    app: &mut App,
    peer_addr: String,
    station_id: Option<String>,
    tx: mpsc::UnboundedSender<AppAction>,
) {
    let Some(video_player) = app.video_player.clone() else {
        let _ = tx.send(AppAction::RadioEnded {
            error: Some("no mpv backend in this shell".to_string()),
        });
        return;
    };
    // mutually exclusive with regular queue playback, same reasoning
    // as switching between audio/video queue entries - see
    // `tty::queue::play_index`'s module doc.
    super::queue::stop_for_radio(app);

    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    app.state.ephemeral.radio = RadioPlaybackState {
        active: true,
        station_id: station_id.clone(),
        station_name: None,
        track_title: None,
        track_artist: None,
        last_error: None,
    };

    tokio::task::spawn_local(async move {
        let result = run_session(generation, peer_addr, station_id, video_player, tx.clone()).await;
        if generation_is_current(generation) {
            let _ = tx.send(AppAction::RadioEnded {
                error: result.err(),
            });
        }
    });
}

/// stop the active radio session (if any). bumps the generation so the
/// running task's next check fails and it tears itself down on its own
/// (closing its iroh connection + fifo), and closes mpv right away
/// rather than waiting for the task to next poll - so the ui/audio
/// react immediately instead of on the next chunk/heartbeat.
pub fn stop(app: &mut App) {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    app.state.ephemeral.radio = RadioPlaybackState::default();
    if let Some(video_player) = app.video_player.clone() {
        tokio::task::spawn_local(async move {
            let _ = video_player.send(VideoCommand::Close).await;
        });
    }
}

async fn run_session(
    generation: u64,
    peer_addr: String,
    station_id: Option<String>,
    video_player: Rc<dyn VideoPlayer>,
    tx: mpsc::UnboundedSender<AppAction>,
) -> Result<(), String> {
    let endpoint = get_endpoint_arc().map_err(|e| e.to_string())?;
    let addr = parse_peer_address(&peer_addr).map_err(|e| e.to_string())?;
    let conn = endpoint
        .connect(addr, RADIO_ALPN)
        .await
        .map_err(|e| format!("connect: {e}"))?;

    let (mut ctrl_send, mut ctrl_recv) = conn
        .open_bi()
        .await
        .map_err(|e| format!("open control stream: {e}"))?;
    write_control_message(
        &mut ctrl_send,
        &ControlMessage::Tune(TuneMessage {
            station_id: station_id.clone(),
        }),
    )
    .await
    .map_err(|e| format!("send tune: {e}"))?;

    let hello = match read_control_message(&mut ctrl_recv)
        .await
        .map_err(|e| format!("read hello: {e}"))?
    {
        Some(ControlMessage::Hello(h)) => h,
        Some(_) => return Err("radio: expected Hello first".to_string()),
        None => return Err("radio: connection closed before Hello".to_string()),
    };
    if hello.broadcaster_timeline_only {
        return Err(
            "this station has no live audio stream (timeline-only mode isn't supported yet)"
                .to_string(),
        );
    }
    if !generation_is_current(generation) {
        return Ok(());
    }
    let _ = tx.send(AppAction::RadioStatusUpdate {
        station_name: Some(station_id.clone().unwrap_or_else(|| "default".to_string())),
        track_title: Some(hello.now_playing.title.clone()),
        track_artist: hello.now_playing.artist.clone(),
    });

    let mut audio_recv = conn
        .accept_uni()
        .await
        .map_err(|e| format!("accept audio stream: {e}"))?;

    let mut track = TrackFifo::default();
    let mut current_title = hello.now_playing.title.clone();

    loop {
        if !generation_is_current(generation) {
            track.close();
            return Ok(());
        }
        tokio::select! {
            chunk = read_chunk(&mut audio_recv) => {
                let Some(chunk) = chunk.map_err(|e| e.to_string())? else {
                    return Ok(()); // clean eof - broadcaster closed the audio stream.
                };
                if chunk.is_init {
                    track
                        .begin_new_track(&video_player, current_title.clone())
                        .await?;
                }
                track.write(&chunk.bytes).await?;
            }
            ctrl = read_control_message(&mut ctrl_recv) => {
                match ctrl.map_err(|e| e.to_string())? {
                    Some(ControlMessage::Meta(meta)) => {
                        current_title = meta.now_playing.title.clone();
                        let _ = tx.send(AppAction::RadioStatusUpdate {
                            station_name: None,
                            track_title: Some(meta.now_playing.title),
                            track_artist: meta.now_playing.artist,
                        });
                    }
                    // both tell the listener to discard audio until the
                    // next init chunk - closing the current fifo now
                    // (rather than waiting for stray trailing chunks to
                    // error out against it) matches that.
                    Some(ControlMessage::Lag(_)) | Some(ControlMessage::Skip(_)) => track.close(),
                    Some(ControlMessage::Goodbye(g)) => {
                        return Err(format!("station closed the session: {}", g.reason));
                    }
                    Some(_) => {}
                    None => return Ok(()), // control stream closed cleanly.
                }
            }
        }
    }
}

/// owns the currently-active per-track named pipe: the write end
/// (chunks are written here as they arrive) and its path (unlinked on
/// close/drop). a fresh instance is `loadfile`d into mpv on every
/// `is_init` chunk - see this module's doc comment.
#[derive(Default)]
struct TrackFifo {
    path: Option<std::path::PathBuf>,
    writer: Option<tokio::fs::File>,
}

impl TrackFifo {
    /// opens a fresh fifo, tells mpv to load it, and stores the write
    /// end - first dropping any previous fifo (closing its write end
    /// signals eof to mpv for that "file").
    async fn begin_new_track(
        &mut self,
        video_player: &Rc<dyn VideoPlayer>,
        title: String,
    ) -> Result<(), String> {
        self.close();
        let path = std::env::temp_dir().join(format!("rathole-radio-{}.fifo", ulid::Ulid::new()));
        let cpath = std::ffi::CString::new(path.to_string_lossy().as_bytes().to_vec())
            .map_err(|e| e.to_string())?;
        // SAFETY: `mkfifo` is a plain libc syscall; `cpath` is a valid
        // NUL-terminated string owned for the duration of this call.
        let ret = unsafe { libc::mkfifo(cpath.as_ptr(), 0o600) };
        if ret != 0 {
            return Err(format!(
                "mkfifo failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        // opening the write end blocks (on tokio's blocking pool) until
        // a reader shows up - kick that off concurrently with mpv's own
        // open (the loadfile below) rather than awaiting it first, or
        // neither side would ever make progress.
        let open_path = path.clone();
        let write_fut = tokio::task::spawn_blocking(move || {
            std::fs::OpenOptions::new().write(true).open(open_path)
        });
        video_player
            .send(VideoCommand::Load {
                path: path.to_string_lossy().into_owned(),
                title: Some(title),
                start_seconds: None,
            })
            .await?;
        let file = write_fut
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| format!("open radio fifo for writing: {e}"))?;
        self.path = Some(path);
        self.writer = Some(tokio::fs::File::from_std(file));
        Ok(())
    }

    /// writes to the current fifo, if one is open - silently dropped
    /// otherwise (no track has started yet, or the last one was closed
    /// by a Lag/Skip and we're waiting on the next init chunk).
    async fn write(&mut self, bytes: &[u8]) -> Result<(), String> {
        let Some(writer) = self.writer.as_mut() else {
            return Ok(());
        };
        if let Err(e) = writer.write_all(bytes).await {
            self.close();
            return Err(format!("write radio chunk: {e}"));
        }
        Ok(())
    }

    /// drops the write end (mpv sees eof) and unlinks the fifo file.
    fn close(&mut self) {
        self.writer = None;
        if let Some(path) = self.path.take() {
            let _ = std::fs::remove_file(&path);
        }
    }
}

impl Drop for TrackFifo {
    fn drop(&mut self) {
        self.close();
    }
}
