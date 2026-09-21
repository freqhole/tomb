//! native mpv playback for a video-capable radio station, used when the
//! "experimental player" (`use_rodio_playback`) config is on - an
//! alternative to the browser's own `<video>`+MediaSource element.
//!
//! mirrors rathole's already-working radio playback
//! (`client/rathole/src/tty/radio.rs` + `tty/video_player.rs`) closely:
//! each track gets its own named pipe, written to as chunks arrive and
//! `loadfile`d into a long-lived `mpv --idle=yes` process controlled over
//! its JSON ipc socket. a fresh pipe on every `is_init` chunk (mpv sees
//! EOF on the old one and that "file" ends) avoids needing to signal a
//! mid-stream demux reset to mpv itself.
//!
//! unlike rathole (a headless tty app where mpv owns the whole display
//! via `--vo=drm`), charnel is a gui app - this opens mpv in its own
//! plain os window rather than embedding it into charnel's ui, so the
//! actual playback mechanism can be validated on its own first.
//!
//! `#[cfg(unix)]`: named pipes are a posix concept with no windows
//! equivalent, mirroring rathole's own platform split.

#![cfg(unix)]

use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::process::{Child, Command};
use tokio::sync::Mutex as AsyncMutex;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_RETRY_INTERVAL: Duration = Duration::from_millis(25);

static NEXT_ID: AtomicU64 = AtomicU64::new(0);

fn unique_temp_path(prefix: &str) -> std::path::PathBuf {
    let n = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("{prefix}-{now}-{n}"))
}

/// one long-lived `mpv --idle=yes` process, controlled over its json ipc
/// socket - kept alive for the duration of a single radio session (the
/// caller owns it and drops it on session end; `kill_on_drop(true)` on
/// spawn means the process actually exits when that happens, mirroring
/// the fix rathole's own `MpvPlayer` needed for the same reason).
pub struct RadioMpvPlayer {
    _child: Child,
    write_half: AsyncMutex<tokio::net::unix::OwnedWriteHalf>,
}

impl RadioMpvPlayer {
    /// spawns mpv in its own plain window (not embedded into charnel's
    /// ui yet - see this module's header comment).
    pub async fn spawn() -> Result<Arc<Self>, String> {
        let socket_path = unique_temp_path("charnel-radio-mpv").with_extension("sock");
        tracing::info!(socket = %socket_path.display(), "[radio-mpv] spawning mpv");

        let mut child = Command::new("mpv")
            .arg("--idle=yes")
            .arg("--force-window=yes")
            .arg("--title=freqhole radio")
            .arg("--no-terminal")
            // "warn" (not "really-quiet"/default) keeps real failures visible
            // in the piped stdout/stderr logged below.
            .arg("--msg-level=all=warn")
            .arg(format!(
                "--input-ipc-server={}",
                socket_path.to_string_lossy()
            ))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("failed to spawn mpv: {e}"))?;

        if let Some(stdout) = child.stdout.take() {
            tokio::spawn(log_output(stdout, "stdout"));
        }
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(log_output(stderr, "stderr"));
        }

        let stream = connect_with_retry(&socket_path).await?;
        let (read_half, write_half) = stream.into_split();
        // mpv's ipc socket is bidirectional (it echoes command acks and
        // any observed-property events) - draining it here isn't used
        // for anything in this first cut, but must happen or mpv can
        // eventually block writing to a socket nobody reads.
        tokio::spawn(drain_reader(read_half));

        Ok(Arc::new(Self {
            _child: child,
            write_half: AsyncMutex::new(write_half),
        }))
    }

    /// load (and immediately start playing) a local path - used with a
    /// fifo path here, but works the same as any other file mpv can open.
    pub async fn loadfile(&self, path: &str) -> Result<(), String> {
        self.send_ipc(json!({"command": ["loadfile", path, "replace"]}))
            .await
    }

    pub async fn stop(&self) -> Result<(), String> {
        self.send_ipc(json!({"command": ["stop"]})).await
    }

    async fn send_ipc(&self, cmd: serde_json::Value) -> Result<(), String> {
        let mut line = serde_json::to_vec(&cmd).map_err(|e| e.to_string())?;
        line.push(b'\n');
        let mut w = self.write_half.lock().await;
        w.write_all(&line)
            .await
            .map_err(|e| format!("mpv ipc write failed: {e}"))
    }
}

async fn connect_with_retry(socket_path: &std::path::Path) -> Result<UnixStream, String> {
    let deadline = tokio::time::Instant::now() + CONNECT_TIMEOUT;
    loop {
        match UnixStream::connect(socket_path).await {
            Ok(stream) => return Ok(stream),
            Err(e) => {
                if tokio::time::Instant::now() >= deadline {
                    return Err(format!(
                        "timed out connecting to mpv ipc socket at {}: {e}",
                        socket_path.display()
                    ));
                }
                tokio::time::sleep(CONNECT_RETRY_INTERVAL).await;
            }
        }
    }
}

async fn log_output(stream: impl tokio::io::AsyncRead + Unpin, stream_name: &'static str) {
    let mut lines = BufReader::new(stream).lines();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => tracing::warn!(mpv_stream = stream_name, %line, "[radio-mpv] output"),
            Ok(None) => break,
            Err(e) => {
                tracing::warn!(mpv_stream = stream_name, error = %e, "[radio-mpv] output stream read error");
                break;
            }
        }
    }
}

async fn drain_reader(read_half: tokio::net::unix::OwnedReadHalf) {
    let mut lines = BufReader::new(read_half).lines();
    while let Ok(Some(_line)) = lines.next_line().await {
        // ipc replies/events aren't consumed in this first cut - see
        // this fn's call site doc comment.
    }
}

/// creates a posix named pipe at `path`, owner read/write only.
fn create_fifo(path: &std::path::Path) -> Result<(), String> {
    nix::unistd::mkfifo(
        path,
        nix::sys::stat::Mode::S_IRUSR | nix::sys::stat::Mode::S_IWUSR,
    )
    .map_err(|e| format!("mkfifo failed: {e}"))
}

/// owns the currently-active per-track named pipe: the write end (chunks
/// are written here as they arrive) and its path (unlinked on close/
/// drop). a fresh instance is `loadfile`d into mpv on every `is_init`
/// chunk - see this module's header comment.
#[derive(Default)]
struct TrackFifo {
    path: Option<std::path::PathBuf>,
    writer: Option<tokio::fs::File>,
}

impl TrackFifo {
    /// opens a fresh fifo, tells mpv to load it, and stores the write
    /// end - first dropping any previous fifo (closing its write end
    /// signals eof to mpv for that "file").
    async fn begin_new_track(&mut self, player: &RadioMpvPlayer) -> Result<(), String> {
        self.close();
        let path = unique_temp_path("charnel-radio-mpv").with_extension("fifo");
        create_fifo(&path)?;
        // opening the write end blocks (on tokio's blocking pool) until a
        // reader shows up - kick that off concurrently with mpv's own
        // open (the loadfile below) rather than awaiting it first, or
        // neither side would ever make progress.
        let open_path = path.clone();
        let write_fut = tokio::task::spawn_blocking(move || {
            std::fs::OpenOptions::new().write(true).open(open_path)
        });
        player.loadfile(&path.to_string_lossy()).await?;
        let file = write_fut
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| format!("open radio fifo for writing: {e}"))?;
        self.path = Some(path);
        self.writer = Some(tokio::fs::File::from_std(file));
        Ok(())
    }

    async fn write(&mut self, bytes: &[u8]) -> Result<(), String> {
        let Some(writer) = self.writer.as_mut() else {
            // no track has started yet (shouldn't happen - the first
            // chunk of any session is always `is_init`) - drop silently
            // rather than erroring the whole session over it.
            return Ok(());
        };
        // a reader (mpv) that closed/errored makes every further write
        // fail - treat that as "this track is over" rather than a fatal
        // session error, same as rathole's own handling.
        if writer.write_all(bytes).await.is_err() {
            self.close();
        }
        Ok(())
    }

    /// drops the write end (if any) and unlinks the fifo file. safe to
    /// call when nothing is open.
    fn close(&mut self) {
        self.writer = None;
        if let Some(path) = self.path.take() {
            let _ = std::fs::remove_file(path);
        }
    }
}

impl Drop for TrackFifo {
    fn drop(&mut self) {
        self.close();
    }
}

/// bundles the mpv process + its current track fifo for one radio
/// session - owned by that session's audio-loop task, torn down when it
/// ends (see `radio_commands.rs`).
pub struct RadioMpvSink {
    player: Arc<RadioMpvPlayer>,
    fifo: TrackFifo,
}

impl RadioMpvSink {
    pub async fn spawn() -> Result<Self, String> {
        Ok(Self {
            player: RadioMpvPlayer::spawn().await?,
            fifo: TrackFifo::default(),
        })
    }

    /// feed one chunk from the radio wire stream. `is_init` starts a
    /// fresh track (new fifo, freshly `loadfile`d into mpv).
    pub async fn feed(&mut self, is_init: bool, bytes: &[u8]) -> Result<(), String> {
        if is_init {
            self.fifo.begin_new_track(&self.player).await?;
        }
        self.fifo.write(bytes).await
    }

    /// tears down the current track's fifo and stops mpv playback -
    /// called when the radio session itself ends. the mpv PROCESS keeps
    /// running (`--idle=yes`) until this sink is dropped, matching
    /// rathole's own "close stops playback, the process exits on drop"
    /// split.
    pub async fn close(&mut self) {
        self.fifo.close();
        let _ = self.player.stop().await;
    }
}
