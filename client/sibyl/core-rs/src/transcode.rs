//! transcoder: spawns ffmpeg, scans stdout for mp3 frames, accumulates
//! them into [`Chunk`]s, and yields one chunk at a time to the caller.
//!
//! mirrors the spawn pattern in `grimoire/src/radio/encoder.rs` but
//! emits chunks of mp3 frames instead of fmp4 boxes, and drops `-re`
//! so transcode runs as fast as possible.

use std::path::Path;
use std::process::Stdio;

use anyhow::{anyhow, Context};
use tokio::io::AsyncReadExt;
use tokio::process::{Child, ChildStdout, Command};
use tracing::{debug, warn};

use crate::chunk::{Chunk, CodecParams};
use crate::frame;

/// soft cap on the in-memory accumulator. one mp3 frame at 192 kbps is
/// ~626 bytes; a single chunk is ~25 kb. we keep at most ~256 kb so
/// we can recover from spurious sync misses without unbounded growth.
const MAX_BUF: usize = 256 * 1024;

/// number of bytes to read from stdout per syscall. one mp3 frame is
/// ~626 bytes; a chunk of 40 frames is ~25 kb.
const READ_CAP: usize = 32 * 1024;

pub struct Transcoder {
    child: Child,
    stdout: ChildStdout,
    /// rolling accumulator: holds bytes that haven't been split into
    /// frames yet (plus any partial frame straddling the next read).
    buf: Vec<u8>,
    /// monotonic chunk counter.
    next_seq: u32,
    params: CodecParams,
    /// set once stdout returns EOF. once true and `buf` has been
    /// drained of complete frames, `next_chunk` returns `None`.
    eof: bool,
}

impl Transcoder {
    /// spawn ffmpeg with the canonical sibyl args.
    ///
    /// canonical command (from the plan):
    /// `ffmpeg -hide_banner -loglevel error -i <in> -vn -map 0:a:0
    ///         -ac 2 -ar 44100 -c:a libmp3lame -b:a 192k -f mp3 pipe:1`
    pub fn spawn(input: &Path, params: CodecParams) -> anyhow::Result<Self> {
        let input_str = input
            .to_str()
            .ok_or_else(|| anyhow!("input path is not valid utf-8: {:?}", input))?;

        let mut child = Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                input_str,
                "-vn",
                "-map",
                "0:a:0",
                "-ac",
                &params.channels.to_string(),
                "-ar",
                &params.sample_rate.to_string(),
                "-c:a",
                "libmp3lame",
                "-b:a",
                &format!("{}k", params.bitrate_kbps),
                "-f",
                "mp3",
                "pipe:1",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .context("failed to spawn ffmpeg (is it on PATH?)")?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("ffmpeg stdout missing after spawn"))?;

        // drain stderr in the background so a chatty ffmpeg can't wedge.
        if let Some(mut stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut sink = Vec::with_capacity(4096);
                let _ = stderr.read_to_end(&mut sink).await;
                if !sink.is_empty() {
                    warn!(
                        "[sibyl-transcode] ffmpeg stderr: {}",
                        String::from_utf8_lossy(&sink).trim()
                    );
                }
            });
        }

        Ok(Self {
            child,
            stdout,
            buf: Vec::with_capacity(READ_CAP * 2),
            next_seq: 0,
            params,
            eof: false,
        })
    }

    /// await the next complete chunk. returns `None` once ffmpeg has
    /// closed stdout and no more frames remain in the buffer.
    pub async fn next_chunk(&mut self) -> anyhow::Result<Option<Chunk>> {
        let need = self.params.frames_per_chunk as usize;

        loop {
            // try to assemble a chunk from what we already have.
            if let Some(chunk) = self.try_take_chunk(need) {
                return Ok(Some(chunk));
            }

            if self.eof {
                // flush any partial chunk so the last few frames aren't
                // lost. some sources end mid-chunk and that's fine.
                if let Some(chunk) = self.flush_partial() {
                    return Ok(Some(chunk));
                }
                return Ok(None);
            }

            // pull more bytes from ffmpeg.
            let mut tmp = [0u8; READ_CAP];
            let n = self
                .stdout
                .read(&mut tmp)
                .await
                .context("read from ffmpeg stdout")?;
            if n == 0 {
                self.eof = true;
                continue;
            }
            self.buf.extend_from_slice(&tmp[..n]);

            // safety: cap the buffer so a runaway sync miss doesn't
            // OOM the process. if we exceed MAX_BUF without finding a
            // frame, drop the front half and warn.
            if self.buf.len() > MAX_BUF {
                warn!(
                    "[sibyl-transcode] buffer exceeded {MAX_BUF} bytes without a frame; dropping front"
                );
                let drop = self.buf.len() / 2;
                self.buf.drain(..drop);
            }
        }
    }

    /// scan `self.buf` for `need` frames, and if found, drain those
    /// bytes into a new `Chunk`.
    fn try_take_chunk(&mut self, need: usize) -> Option<Chunk> {
        let mut frames_found = 0usize;
        let mut cursor = 0usize;
        let mut first_offset: Option<usize> = None;

        while frames_found < need {
            match frame::next_frame(&self.buf, cursor) {
                Some(f) => {
                    if first_offset.is_none() {
                        first_offset = Some(f.offset);
                    }
                    cursor = f.offset + f.len;
                    frames_found += 1;
                }
                None => return None,
            }
        }

        let start = first_offset.unwrap_or(0);
        let end = cursor;
        let bytes = self.buf[start..end].to_vec();
        // discard everything up to `end` (including any pre-sync junk).
        self.buf.drain(..end);

        let seq = self.next_seq;
        self.next_seq += 1;
        debug!(
            "[sibyl-transcode] chunk seq={seq} frames={need} bytes={}",
            bytes.len()
        );
        Some(Chunk {
            seq,
            bytes,
            frame_count: need as u32,
        })
    }

    /// flush a final, possibly-short chunk on eof. returns `None` if
    /// no frames remain.
    fn flush_partial(&mut self) -> Option<Chunk> {
        let mut frames_found = 0u32;
        let mut cursor = 0usize;
        let mut first_offset: Option<usize> = None;

        loop {
            match frame::next_frame(&self.buf, cursor) {
                Some(f) => {
                    if first_offset.is_none() {
                        first_offset = Some(f.offset);
                    }
                    cursor = f.offset + f.len;
                    frames_found += 1;
                }
                None => break,
            }
        }
        if frames_found == 0 {
            self.buf.clear();
            return None;
        }
        let start = first_offset.unwrap_or(0);
        let bytes = self.buf[start..cursor].to_vec();
        self.buf.drain(..cursor);
        let seq = self.next_seq;
        self.next_seq += 1;
        debug!(
            "[sibyl-transcode] final chunk seq={seq} frames={frames_found} bytes={}",
            bytes.len()
        );
        Some(Chunk {
            seq,
            bytes,
            frame_count: frames_found,
        })
    }

    pub fn params(&self) -> CodecParams {
        self.params
    }

    /// terminate ffmpeg if still running. best-effort.
    pub fn cancel(mut self) {
        let _ = self.child.start_kill();
    }
}
