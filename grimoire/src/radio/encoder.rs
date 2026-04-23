//! per-song ffmpeg subprocess that streams fMP4 chunks.
//!
//! one `Encoder` = one ffmpeg process = one song. when the song ends
//! (ffmpeg exits), the caller drops the encoder and starts a new one for
//! the next track. the new encoder emits its own init chunk, which the
//! client uses as a soft-reset signal for MSE.

use crate::config::get_config;
use crate::error::{GrimoireError, GrimoireResult};
use crate::radio::chunk::{BoxParser, Chunk};
use crate::radio::config::{DEFAULT_BITRATE_KBPS, DEFAULT_FRAG_DURATION_US};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::{Child, ChildStdout, Command};
use tracing::{debug, warn};

/// upper bound on how long a single stdout read may block before we declare
/// ffmpeg wedged. with `-re` pacing and 3s frag_duration, a healthy ffmpeg
/// produces a chunk every ~3s; 30s is generous enough to avoid false
/// positives on slow disks while still catching real hangs.
const STDOUT_READ_TIMEOUT: Duration = Duration::from_secs(30);

/// keep at most this many recent stderr lines around so an exit-status
/// failure can include the most useful tail in its error message.
const STDERR_TAIL_LINES: usize = 8;

/// ffmpeg subprocess that yields a stream of [`Chunk`]s for one song.
pub struct Encoder {
    child: Child,
    stdout: ChildStdout,
    parser: BoxParser,
    /// internal read buffer; sized to hold roughly one fragment's worth of
    /// data so most reads land a complete chunk in one syscall.
    read_buf: Vec<u8>,
    /// monotonic chunk counter for this encoder. resets per-song in phase 0.
    seq: u32,
    /// set once stdout returns EOF; subsequent `next_chunk` calls return None.
    eof: bool,
    /// rolling tail of recent stderr lines from ffmpeg. shared with the
    /// background drain task; mutex is uncontended in practice.
    stderr_tail: Arc<Mutex<StderrTail>>,
    /// human-readable label included in error/log messages so failures point
    /// at a specific song.
    label: String,
}

#[derive(Default)]
struct StderrTail {
    lines: std::collections::VecDeque<String>,
}

impl StderrTail {
    fn push(&mut self, line: String) {
        if self.lines.len() >= STDERR_TAIL_LINES {
            self.lines.pop_front();
        }
        self.lines.push_back(line);
    }

    fn snapshot(&self) -> String {
        if self.lines.is_empty() {
            "(no stderr captured)".to_string()
        } else {
            self.lines.iter().cloned().collect::<Vec<_>>().join(" | ")
        }
    }
}

impl Encoder {
    /// spawn ffmpeg for the given input path. ffmpeg runs in the background;
    /// chunks are pulled lazily via [`Encoder::next_chunk`].
    pub fn start(input_path: &str) -> GrimoireResult<Self> {
        let ffmpeg = get_config().media.ffmpeg_path.clone();

        let bitrate = format!("{}k", DEFAULT_BITRATE_KBPS);
        let frag_dur = DEFAULT_FRAG_DURATION_US.to_string();

        debug!("[radio-encoder] spawning ffmpeg for {input_path}");

        let mut child = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                // pace output to wall-clock playback rate so we don't blast
                // an entire song through the wire in seconds. without this
                // the listener's MSE buffer balloons and song boundaries
                // arrive faster than they can be played.
                "-re",
                "-i",
                input_path,
                "-vn",
                "-c:a",
                "aac",
                "-b:a",
                &bitrate,
                "-movflags",
                "frag_keyframe+empty_moov+default_base_moof",
                "-frag_duration",
                &frag_dur,
                "-f",
                "mp4",
                "pipe:1",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            .spawn()
            .map_err(|e| GrimoireError::ProcessingFailed {
                message: format!("radio: failed to spawn ffmpeg ({ffmpeg}): {e}"),
            })?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| GrimoireError::ProcessingFailed {
                message: "radio: ffmpeg stdout missing after spawn".to_string(),
            })?;

        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| GrimoireError::ProcessingFailed {
                message: "radio: ffmpeg stderr missing after spawn".to_string(),
            })?;

        let stderr_tail = Arc::new(Mutex::new(StderrTail::default()));
        let label = input_path.to_string();

        // background drain: prevents ffmpeg from blocking on a full stderr
        // pipe AND surfaces ffmpeg diagnostics in our logs. terminates
        // automatically when ffmpeg closes stderr (process exit).
        {
            let tail = stderr_tail.clone();
            let label_for_task = label.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr).lines();
                loop {
                    match reader.next_line().await {
                        Ok(Some(line)) => {
                            warn!("[radio-encoder] ffmpeg ({label_for_task}): {line}");
                            if let Ok(mut t) = tail.lock() {
                                t.push(line);
                            }
                        }
                        Ok(None) => break,
                        Err(e) => {
                            warn!("[radio-encoder] stderr read error ({label_for_task}): {e}");
                            break;
                        }
                    }
                }
            });
        }

        Ok(Self {
            child,
            stdout,
            parser: BoxParser::new(),
            read_buf: vec![0u8; 64 * 1024],
            seq: 0,
            eof: false,
            stderr_tail,
            label,
        })
    }

    /// pull the next chunk from ffmpeg. returns `Ok(None)` once ffmpeg exits
    /// cleanly (= song over). returns `Err` if ffmpeg exits non-zero, hangs
    /// past [`STDOUT_READ_TIMEOUT`], or stdout reads fail.
    pub async fn next_chunk(&mut self) -> GrimoireResult<Option<Chunk>> {
        loop {
            // drain anything the parser already has
            if let Some(chunk) = self.parser.next_chunk(&mut self.seq) {
                return Ok(Some(chunk));
            }
            if self.eof {
                return Ok(None);
            }

            let read_fut = self.stdout.read(&mut self.read_buf);
            let n = match tokio::time::timeout(STDOUT_READ_TIMEOUT, read_fut).await {
                Ok(Ok(n)) => n,
                Ok(Err(e)) => {
                    return Err(GrimoireError::ProcessingFailed {
                        message: format!(
                            "radio: ffmpeg stdout read failed for {}: {e} (stderr: {})",
                            self.label,
                            self.snapshot_stderr()
                        ),
                    });
                }
                Err(_) => {
                    // wedged: ffmpeg hasn't written for a long time. kill it
                    // so the broadcaster's retry loop can move on.
                    let _ = self.child.start_kill();
                    return Err(GrimoireError::ProcessingFailed {
                        message: format!(
                            "radio: ffmpeg stdout idle for >{:?} on {} (stderr: {})",
                            STDOUT_READ_TIMEOUT,
                            self.label,
                            self.snapshot_stderr()
                        ),
                    });
                }
            };

            if n == 0 {
                self.eof = true;
                // ffmpeg closed stdout — verify it exited cleanly. silent
                // EOF used to mask segfaults / codec errors / missing files.
                self.verify_clean_exit().await?;
                continue;
            }
            self.parser.feed(&self.read_buf[..n]);
        }
    }

    /// after stdout EOF, await ffmpeg's exit and convert non-zero status
    /// into an error so the broadcaster's retry path fires.
    async fn verify_clean_exit(&mut self) -> GrimoireResult<()> {
        match self.child.wait().await {
            Ok(status) if status.success() => Ok(()),
            Ok(status) => Err(GrimoireError::ProcessingFailed {
                message: format!(
                    "radio: ffmpeg exited with {} for {} (stderr: {})",
                    status,
                    self.label,
                    self.snapshot_stderr()
                ),
            }),
            Err(e) => Err(GrimoireError::ProcessingFailed {
                message: format!("radio: failed to await ffmpeg exit for {}: {e}", self.label),
            }),
        }
    }

    fn snapshot_stderr(&self) -> String {
        self.stderr_tail
            .lock()
            .map(|t| t.snapshot())
            .unwrap_or_else(|_| "(stderr lock poisoned)".to_string())
    }
}

impl Drop for Encoder {
    fn drop(&mut self) {
        // best-effort: make sure ffmpeg doesn't outlive us. start_kill is
        // non-blocking; the OS reaps when the process actually exits.
        if let Err(e) = self.child.start_kill() {
            warn!("[radio-encoder] failed to kill ffmpeg child: {e}");
        }
    }
}
