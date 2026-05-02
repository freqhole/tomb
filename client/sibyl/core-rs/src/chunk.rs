//! mp3 chunk and codec parameter types.
//!
//! a [`Chunk`] is a self-contained run of complete mp3 frames — never
//! split across a frame boundary. this makes opfs caching trivial:
//! every chunk is independently decodable.

use serde::{Deserialize, Serialize};

/// codec parameters fixed for the prototype. mp3 cbr only.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodecParams {
    pub sample_rate: u32,
    pub channels: u8,
    pub bitrate_kbps: u32,
    /// mp3 layer-iii frames per chunk. 40 ≈ 1.04s at 44.1kHz.
    pub frames_per_chunk: u32,
}

impl CodecParams {
    pub const MP3_DEFAULT: Self = Self {
        sample_rate: 44_100,
        channels: 2,
        bitrate_kbps: 192,
        frames_per_chunk: 40,
    };
}

impl Default for CodecParams {
    fn default() -> Self {
        Self::MP3_DEFAULT
    }
}

/// one ordered run of mp3 frames. `seq` starts at 0.
///
/// `chunks_total` is `Some(n)` only on the first chunk a peer
/// receives — it carries the collection's `len()` so downstream
/// consumers can write `chunks_total` into their manifest and show
/// real progress percentages. host-emitted chunks (mid-transcode)
/// leave it as `None` since the count isn't known yet.
#[derive(Debug, Clone)]
pub struct Chunk {
    pub seq: u32,
    pub bytes: Vec<u8>,
    pub frame_count: u32,
    pub chunks_total: Option<u32>,
}
