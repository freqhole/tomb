//! transcoder: spawns ffmpeg, scans stdout for mp3 frames, accumulates
//! them into [`Chunk`]s, and yields one chunk at a time to the caller.
//!
//! mirrors the spawn/timeout pattern in `grimoire/src/radio/encoder.rs`
//! but emits chunks of mp3 frames instead of fmp4 boxes. dropped `-re`
//! so transcode runs as fast as possible.

use std::path::Path;

use crate::chunk::{Chunk, CodecParams};

pub struct Transcoder {
    // todo (phase 2): real fields
    //   child: tokio::process::Child,
    //   stdout: tokio::process::ChildStdout (or a framed reader)
    //   buf: Vec<u8>,                  // sync-word accumulator
    //   next_seq: u32,
    //   params: CodecParams,
    params: CodecParams,
}

impl Transcoder {
    /// spawn ffmpeg with the canonical sibyl args and return a
    /// transcoder ready to yield chunks.
    ///
    /// canonical command (from the plan):
    /// `ffmpeg -hide_banner -loglevel error -i <in> -vn -map 0:a:0
    ///         -ac 2 -ar 44100 -c:a libmp3lame -b:a 192k -f mp3 pipe:1`
    pub fn spawn(input: &Path, params: CodecParams) -> anyhow::Result<Self> {
        let _ = input;
        // todo (phase 2): tokio::process::Command::new("ffmpeg") …
        Ok(Self { params })
    }

    /// await the next complete chunk. returns `None` when ffmpeg has
    /// closed stdout and no more frames remain in the buffer.
    pub async fn next_chunk(&mut self) -> anyhow::Result<Option<Chunk>> {
        // todo (phase 2): drain stdout into self.buf, scan with
        // crate::frame::next_frame until we have params.frames_per_chunk,
        // then split off a Chunk and return it.
        Ok(None)
    }

    pub fn params(&self) -> CodecParams {
        self.params
    }

    /// terminate ffmpeg if still running.
    pub fn cancel(self) {
        // todo (phase 2): self.child.start_kill().ok();
    }
}
