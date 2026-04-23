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
use tokio::io::AsyncReadExt;
use tokio::process::{Child, ChildStdout, Command};
use tracing::{debug, warn};

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

        Ok(Self {
            child,
            stdout,
            parser: BoxParser::new(),
            read_buf: vec![0u8; 64 * 1024],
            seq: 0,
            eof: false,
        })
    }

    /// pull the next chunk from ffmpeg. returns `Ok(None)` once ffmpeg exits
    /// and the parser has no more buffered chunks (= song over).
    pub async fn next_chunk(&mut self) -> GrimoireResult<Option<Chunk>> {
        loop {
            // drain anything the parser already has
            if let Some(chunk) = self.parser.next_chunk(&mut self.seq) {
                return Ok(Some(chunk));
            }
            if self.eof {
                return Ok(None);
            }

            let n = self.stdout.read(&mut self.read_buf).await.map_err(|e| {
                GrimoireError::ProcessingFailed {
                    message: format!("radio: ffmpeg stdout read failed: {e}"),
                }
            })?;
            if n == 0 {
                self.eof = true;
                continue;
            }
            self.parser.feed(&self.read_buf[..n]);
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
