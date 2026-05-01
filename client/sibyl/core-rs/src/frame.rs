//! mp3 frame sync-word scanner.
//!
//! mp3 frames begin with an 11-bit sync word `0xFFE` followed by 1
//! bit indicating MPEG version. this module scans a byte buffer and
//! reports frame starts + lengths so [`crate::transcode::Transcoder`]
//! can split chunks on frame boundaries.
//!
//! references:
//! - http://www.mp3-tech.org/programmer/frame_header.html

/// a single mp3 frame: an offset + length within some buffer.
#[derive(Debug, Clone, Copy)]
pub struct Frame {
    pub offset: usize,
    pub len: usize,
    /// pcm samples this frame produces (1152 for layer iii @ 44.1k).
    pub samples: u32,
}

/// scan `buf` for the next complete mp3 frame starting at or after `from`.
///
/// returns `Some(frame)` if a full frame fits in `buf`, `None` if we
/// need more bytes. caller is responsible for compacting consumed
/// bytes out of the buffer.
pub fn next_frame(buf: &[u8], from: usize) -> Option<Frame> {
    // todo: scan for 0xFFFA-style sync, parse header (bitrate index,
    // sampling rate index, padding bit) → length. for now, with cbr
    // 192kbps @ 44.1khz layer iii, frame length is essentially fixed
    // at ~626 bytes (with padding ±1).
    let _ = (buf, from);
    None
}
