//! per-song ffmpeg subprocess that streams fMP4 chunks.
//!
//! one `Encoder` = one ffmpeg process = one song. when the song ends
//! (ffmpeg exits), the caller drops the encoder and starts a new one for
//! the next track. the new encoder emits its own init chunk, which the
//! client uses as a soft-reset signal for MSE.

use crate::config::get_config;
use crate::error::{GrimoireError, GrimoireResult};
use crate::radio::chunk::{BoxParser, Chunk};
use crate::radio::config::effective as radio_cfg;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::{Child, ChildStdout, Command};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tracing::{debug, info, warn};

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

/// parses `encode_args` (shell-words style), substitutes `{input}`, and -
/// when `start_position_seconds` is a positive value - inserts a fast
/// input-level `-ss <seconds>` immediately before the `-i`-style flag
/// that precedes the `{input}` token (i.e. two tokens before `{input}`
/// itself: `-i`, then the path). pulled out of `Encoder::start` as a pure
/// function so the `-ss` placement logic can be unit-tested without
/// actually spawning ffmpeg.
fn build_ffmpeg_args(
    encode_args: &str,
    input_path: &str,
    start_position_seconds: Option<f64>,
) -> GrimoireResult<Vec<String>> {
    // parse args FIRST (so quoted strings stay intact), then substitute
    // {input}. mirrors the pattern used by extract_album_art_args /
    // generate_waveform_args in MediaConfig.
    let mut args =
        shell_words::split(encode_args).map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("radio: failed to parse encode_args: {e}"),
        })?;
    // the `{input}` token's own index - `-ss` needs to land one token
    // EARLIER than this (before the `-i` flag immediately preceding the
    // input path, not before the path itself) for ffmpeg to treat it as a
    // fast input-level seek rather than a no-op output-level one.
    let input_flag_index = args
        .iter()
        .position(|a| a.contains("{input}"))
        .filter(|&idx| idx > 0)
        .map(|idx| idx - 1);
    for arg in args.iter_mut() {
        if arg.contains("{input}") {
            *arg = arg.replace("{input}", input_path);
        }
    }
    if let (Some(pos), Some(idx)) = (start_position_seconds, input_flag_index) {
        if pos > 0.0 {
            args.insert(idx, pos.to_string());
            args.insert(idx, "-ss".to_string());
        }
    }
    Ok(args)
}

#[cfg(test)]
mod build_ffmpeg_args_tests {
    use super::*;

    #[test]
    fn substitutes_input_with_no_start_position() {
        let args = build_ffmpeg_args("-i {input} -c:a aac", "/tmp/song.mp3", None).unwrap();
        assert_eq!(args, vec!["-i", "/tmp/song.mp3", "-c:a", "aac"]);
    }

    #[test]
    fn inserts_fast_seek_before_the_input_flag_when_a_start_position_is_set() {
        let args =
            build_ffmpeg_args("-i {input} -c:a aac", "/tmp/song.mp3", Some(42.5)).unwrap();
        assert_eq!(
            args,
            vec!["-ss", "42.5", "-i", "/tmp/song.mp3", "-c:a", "aac"]
        );
    }

    #[test]
    fn zero_start_position_is_treated_as_no_seek() {
        // a position of exactly 0.0 means "start from the top" - identical
        // to no position at all, so no -ss should be inserted.
        let args = build_ffmpeg_args("-i {input} -c:a aac", "/tmp/song.mp3", Some(0.0)).unwrap();
        assert_eq!(args, vec!["-i", "/tmp/song.mp3", "-c:a", "aac"]);
    }

    #[test]
    fn negative_start_position_is_treated_as_no_seek() {
        let args = build_ffmpeg_args("-i {input} -c:a aac", "/tmp/song.mp3", Some(-5.0)).unwrap();
        assert_eq!(args, vec!["-i", "/tmp/song.mp3", "-c:a", "aac"]);
    }

    #[test]
    fn respects_a_differently_ordered_station_template() {
        // the seek must land right before whichever token has {input},
        // regardless of what else precedes it in the station's own
        // configured args.
        let args = build_ffmpeg_args(
            "-hide_banner -loglevel error -i {input} -map 0:v:0",
            "/videos/clip.mp4",
            Some(10.0),
        )
        .unwrap();
        assert_eq!(
            args,
            vec![
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                "10",
                "-i",
                "/videos/clip.mp4",
                "-map",
                "0:v:0"
            ]
        );
    }

    #[test]
    fn no_input_token_leaves_args_unchanged_even_with_a_start_position() {
        // defensive: a malformed/empty template with no {input} token at
        // all has nowhere sensible to insert -ss - don't guess, just
        // leave it alone (same as the None case).
        let args = build_ffmpeg_args("-f mp4 pipe:1", "/tmp/song.mp3", Some(30.0)).unwrap();
        assert_eq!(args, vec!["-f", "mp4", "pipe:1"]);
    }
}

impl Encoder {
    /// spawn ffmpeg for the given input path. ffmpeg runs in the background;
    /// chunks are pulled lazily via [`Encoder::next_chunk`].
    ///
    /// `encode_args_override` is a station's own `encode_args` column (see
    /// `RadioStation`) - `None` falls back to the node-wide `[radio]` toml
    /// default, same as before this param existed.
    ///
    /// `start_position_seconds` - "resume where a previous listener left
    /// off" (see `playlist::RadioTrack::start_position_seconds`). inserted
    /// as `-ss <seconds>` immediately before whichever arg token
    /// references `{input}` - ffmpeg treats `-ss` placed *before* `-i` as
    /// a fast, keyframe-granularity input seek (no full decode from the
    /// start of the file), vs. the slow, frame-accurate seek it does when
    /// `-ss` comes after `-i`. frame accuracy doesn't matter for a live
    /// broadcast resume - fast matters a lot (this runs on every request
    /// pickup, not just an admin action).
    pub fn start(
        input_path: &str,
        encode_args_override: Option<&str>,
        start_position_seconds: Option<f64>,
    ) -> GrimoireResult<Self> {
        let ffmpeg = get_config().media.ffmpeg_path.clone();
        let cfg = radio_cfg();
        let encode_args = encode_args_override.unwrap_or(&cfg.encode_args);
        let args = build_ffmpeg_args(encode_args, input_path, start_position_seconds)?;

        debug!("[radio-encoder] spawning ffmpeg for {input_path}");

        let mut cmd = Command::new(&ffmpeg);
        cmd.arg("-hide_banner")
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            // ensure ffmpeg is reaped if our task is cancelled mid-song.
            // belt-and-braces with the manual `start_kill` in `Drop`.
            .kill_on_drop(true);

        // unix: put ffmpeg in its own process group so a stray child
        // (rare for `ffmpeg`, but possible via filter graphs) can be
        // signalled together with the parent. also keeps ctrl-c on a
        // foreground server from racing the broadcaster's own kill.
        #[cfg(unix)]
        {
            cmd.process_group(0);
        }
        crate::process_ext::hide_console_window(&mut cmd);

        let mut child = cmd.spawn().map_err(|e| GrimoireError::ProcessingFailed {
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

    /// best-effort interruption for admin-triggered track skips.
    pub fn interrupt(&mut self) {
        self.eof = true;
        if let Err(e) = self.child.start_kill() {
            warn!("[radio-encoder] failed to interrupt ffmpeg child: {e}");
        }
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

/// async-fillable wrapper around [`Encoder`] that decouples ffmpeg's
/// production rate from the broadcaster's emission rate.
///
/// a background tokio task pulls chunks from `Encoder` as fast as
/// ffmpeg produces them and pushes them into a bounded `mpsc` channel
/// of size [`crate::radio::config::ring_capacity`]. when the channel
/// fills, the task blocks on `send` — natural backpressure on ffmpeg
/// (which then blocks on its stdout pipe). when the consumer drains
/// the channel, the task unblocks and refills.
///
/// the upshot: at steady state the broadcaster has up to
/// `buffer_seconds` of pre-encoded audio queued in memory, ready to
/// ride out a transient ffmpeg crash / restart without dropping out.
///
/// retry policy: if `Encoder::start` itself fails (file missing,
/// codec error, ffmpeg binary not found), we retry up to
/// `encoder_restart_attempts` times with a short backoff before
/// surfacing the error to the broadcaster (which then rolls to the
/// next track).
pub struct BufferedEncoder {
    rx: mpsc::Receiver<GrimoireResult<Chunk>>,
    feeder: Option<JoinHandle<()>>,
    interrupt_flag: Arc<std::sync::atomic::AtomicBool>,
    label: String,
}

impl BufferedEncoder {
    /// spawn ffmpeg + the feeder task. the channel capacity is derived
    /// from the radio config (`buffer_seconds / frag_seconds`).
    pub fn start(
        input_path: &str,
        encode_args_override: Option<&str>,
        start_position_seconds: Option<f64>,
    ) -> GrimoireResult<Self> {
        Self::start_with_capacity(
            input_path,
            encode_args_override,
            crate::radio::config::ring_capacity(&radio_cfg()),
            start_position_seconds,
        )
    }

    /// like [`Self::start`] but with an explicit channel capacity (used
    /// in tests).
    pub fn start_with_capacity(
        input_path: &str,
        encode_args_override: Option<&str>,
        capacity: usize,
        start_position_seconds: Option<f64>,
    ) -> GrimoireResult<Self> {
        let cfg = radio_cfg();
        let attempts = cfg.encoder_restart_attempts.max(1);
        let label = input_path.to_string();

        let mut last_err: Option<GrimoireError> = None;
        let mut encoder: Option<Encoder> = None;
        for attempt in 1..=attempts {
            match Encoder::start(input_path, encode_args_override, start_position_seconds) {
                Ok(enc) => {
                    if attempt > 1 {
                        info!(
                            "[radio-encoder] ffmpeg started for {label} on attempt {attempt}/{attempts}"
                        );
                    }
                    encoder = Some(enc);
                    break;
                }
                Err(e) => {
                    warn!(
                        "[radio-encoder] ffmpeg start failed for {label} (attempt {attempt}/{attempts}): {e}"
                    );
                    last_err = Some(e);
                }
            }
        }
        let mut encoder = encoder.ok_or_else(|| {
            last_err.unwrap_or_else(|| GrimoireError::ProcessingFailed {
                message: format!("radio: ffmpeg failed to start for {label}"),
            })
        })?;

        let (tx, rx) = mpsc::channel(capacity.max(1));
        let interrupt_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let task_flag = interrupt_flag.clone();
        let task_label = label.clone();
        let feeder = tokio::spawn(async move {
            loop {
                if task_flag.load(std::sync::atomic::Ordering::Relaxed) {
                    encoder.interrupt();
                    break;
                }
                match encoder.next_chunk().await {
                    Ok(Some(chunk)) => {
                        if tx.send(Ok(chunk)).await.is_err() {
                            // consumer dropped; tear down ffmpeg
                            encoder.interrupt();
                            break;
                        }
                    }
                    Ok(None) => {
                        // clean EOF — feeder exits, channel closes,
                        // recv_chunk returns None to broadcaster.
                        debug!("[radio-encoder] feeder EOF for {task_label}");
                        break;
                    }
                    Err(e) => {
                        // surface the error then exit. broadcaster will
                        // see the Err and roll to the next track.
                        let _ = tx.send(Err(e)).await;
                        break;
                    }
                }
            }
        });

        Ok(Self {
            rx,
            feeder: Some(feeder),
            interrupt_flag,
            label,
        })
    }

    /// pull the next chunk from the buffer. returns `Ok(None)` once
    /// ffmpeg has produced its final chunk and the buffer is drained.
    pub async fn next_chunk(&mut self) -> GrimoireResult<Option<Chunk>> {
        match self.rx.recv().await {
            Some(Ok(chunk)) => Ok(Some(chunk)),
            Some(Err(e)) => Err(e),
            None => Ok(None),
        }
    }

    /// signal the feeder to kill ffmpeg and tear down. used for admin
    /// skip + station shutdown.
    pub fn interrupt(&mut self) {
        self.interrupt_flag
            .store(true, std::sync::atomic::Ordering::Relaxed);
    }

    /// number of chunks currently sitting in the encode-ahead buffer -
    /// already produced by ffmpeg (via the background feeder task) but
    /// not yet pulled by `next_chunk()`. a non-consuming peek (`mpsc::
    /// Receiver::len`), used both to give the broadcaster a way to wait
    /// for a real lead to build before publishing a track to listeners,
    /// and as a diagnostic for how close that lead is to running dry.
    pub fn queued_chunks(&self) -> usize {
        self.rx.len()
    }

    /// true once the feeder task has ended (clean EOF, error, or
    /// interrupt) and dropped its sender - no more chunks will EVER
    /// arrive, so whatever `queued_chunks()` reports right now is
    /// final. lets a caller waiting for a target chunk count (e.g. the
    /// broadcaster's warm-up) stop as soon as the encoder is genuinely
    /// done rather than waiting out a full timeout for a target a
    /// short track can never reach - a track shorter than the target's
    /// real duration will never produce that many chunks no matter how
    /// long we wait.
    pub fn is_finished(&self) -> bool {
        self.rx.is_closed()
    }

    /// human-readable label (input path) for log messages.
    pub fn label(&self) -> &str {
        &self.label
    }
}

impl Drop for BufferedEncoder {
    fn drop(&mut self) {
        self.interrupt_flag
            .store(true, std::sync::atomic::Ordering::Relaxed);
        if let Some(handle) = self.feeder.take() {
            handle.abort();
        }
    }
}
