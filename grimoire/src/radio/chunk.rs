//! the wire-format unit shared between the encoder, the handler, and (later)
//! the broadcaster. one chunk = one self-contained piece of fMP4.
//!
//! also holds the fMP4 box parser: a small streaming state machine that
//! consumes ffmpeg stdout and emits chunks at box boundaries. parser is
//! deliberately dumb — it only inspects 4-byte length + 4-byte type headers
//! and delegates "is this an init?" to the type tag.

use bytes::{Bytes, BytesMut};

/// one self-contained fMP4 unit ready to be pushed to listeners.
///
/// in phase 0 the seq counter resets on each connection (one encoder per
/// listener). in phase 1 the broadcaster owns a global counter and wraps each
/// chunk in `Arc<Chunk>` for cheap fan-out.
#[derive(Debug, Clone)]
pub struct Chunk {
    /// monotonic chunk counter. resets to 0 at the start of each connection
    /// in phase 0; phase 1 makes this global per-station.
    pub seq: u32,

    /// true when this is an `ftyp`+`moov` init segment (a new track started).
    /// clients soft-reset MSE on init boundaries.
    pub is_init: bool,

    /// raw fMP4 bytes. for an init: `ftyp` + `moov`. for media: `moof` + `mdat`.
    pub bytes: Bytes,
}

/// fMP4 box header — 4 bytes big-endian length followed by 4 ASCII chars.
const BOX_HEADER_LEN: usize = 8;

/// streaming parser that turns ffmpeg stdout into [`Chunk`]s.
///
/// usage:
/// ```ignore
/// let mut parser = BoxParser::new();
/// loop {
///     let n = stdout.read(&mut buf).await?;
///     if n == 0 { break; }
///     parser.feed(&buf[..n]);
///     while let Some(chunk) = parser.next_chunk(&mut seq) {
///         // ship it
///     }
/// }
/// ```
///
/// rules:
/// - first emitted chunk: everything from the first `ftyp` through the matching
///   `moov` (= the init segment). flagged `is_init = true`.
/// - subsequent chunks: each `moof` + paired `mdat` (= one media fragment).
///
/// any boxes that aren't `ftyp` / `moov` / `moof` / `mdat` (e.g. `styp`, `sidx`,
/// `free`) are accumulated into the next emitted chunk so MSE sees them in order.
#[derive(Debug, Default)]
pub struct BoxParser {
    /// rolling buffer of bytes not yet emitted as a chunk.
    buf: BytesMut,
    /// have we emitted the init segment yet? if false, we're collecting
    /// `ftyp` + `moov`; first emitted chunk will be marked `is_init = true`.
    init_done: bool,
}

impl BoxParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// append more bytes from ffmpeg stdout.
    pub fn feed(&mut self, data: &[u8]) {
        self.buf.extend_from_slice(data);
    }

    /// try to extract the next ready chunk. returns `None` if more bytes are
    /// needed before a complete chunk is available.
    ///
    /// `seq_counter` is mutated in place — incremented for each emitted chunk.
    pub fn next_chunk(&mut self, seq_counter: &mut u32) -> Option<Chunk> {
        // walk box headers from the start of buf, looking for the boundary
        // that closes the current chunk.
        //
        // for the init chunk: boundary = end of the first `moov` box.
        // for media chunks:   boundary = end of the first `mdat` box that
        //                     follows a `moof`.
        let mut cursor = 0usize;
        let mut saw_moof = false;

        loop {
            if self.buf.len() < cursor + BOX_HEADER_LEN {
                return None; // need more bytes for the next header
            }
            let size = u32::from_be_bytes([
                self.buf[cursor],
                self.buf[cursor + 1],
                self.buf[cursor + 2],
                self.buf[cursor + 3],
            ]) as usize;
            let kind = [
                self.buf[cursor + 4],
                self.buf[cursor + 5],
                self.buf[cursor + 6],
                self.buf[cursor + 7],
            ];

            // sanity: a 0-length box would loop forever. fMP4 from ffmpeg
            // always uses concrete box sizes, so treat 0 as "wait for more"
            // (could indicate truncation).
            if size < BOX_HEADER_LEN {
                return None;
            }
            if self.buf.len() < cursor + size {
                return None; // header parsed, body not yet here
            }

            let next = cursor + size;

            if !self.init_done {
                // collecting ftyp + moov; emit when we close the moov box.
                if &kind == b"moov" {
                    let chunk_bytes = self.buf.split_to(next).freeze();
                    self.init_done = true;
                    let seq = *seq_counter;
                    *seq_counter = seq.wrapping_add(1);
                    return Some(Chunk {
                        seq,
                        is_init: true,
                        bytes: chunk_bytes,
                    });
                }
            } else {
                // collecting media boxes; emit when we close an mdat that was
                // preceded by a moof in this chunk.
                if &kind == b"moof" {
                    saw_moof = true;
                } else if &kind == b"mdat" && saw_moof {
                    let chunk_bytes = self.buf.split_to(next).freeze();
                    let seq = *seq_counter;
                    *seq_counter = seq.wrapping_add(1);
                    return Some(Chunk {
                        seq,
                        is_init: false,
                        bytes: chunk_bytes,
                    });
                }
            }

            cursor = next;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// build a fake box with the given 4-char type and `payload_len` zero bytes
    /// of body.
    fn fake_box(kind: &[u8; 4], payload_len: usize) -> Vec<u8> {
        let total = (BOX_HEADER_LEN + payload_len) as u32;
        let mut v = Vec::with_capacity(total as usize);
        v.extend_from_slice(&total.to_be_bytes());
        v.extend_from_slice(kind);
        v.extend(std::iter::repeat_n(0, payload_len));
        v
    }

    #[test]
    fn emits_init_then_media() {
        let mut parser = BoxParser::new();
        let mut seq = 0u32;

        // init segment: ftyp + moov
        parser.feed(&fake_box(b"ftyp", 8));
        parser.feed(&fake_box(b"moov", 16));

        let init = parser.next_chunk(&mut seq).unwrap();
        assert!(init.is_init);
        assert_eq!(init.seq, 0);

        // media segment: moof + mdat
        parser.feed(&fake_box(b"moof", 4));
        parser.feed(&fake_box(b"mdat", 32));

        let media = parser.next_chunk(&mut seq).unwrap();
        assert!(!media.is_init);
        assert_eq!(media.seq, 1);

        assert!(parser.next_chunk(&mut seq).is_none());
    }

    #[test]
    fn handles_partial_feeds() {
        let mut parser = BoxParser::new();
        let mut seq = 0u32;

        let init: Vec<u8> = fake_box(b"ftyp", 4)
            .into_iter()
            .chain(fake_box(b"moov", 4))
            .collect();
        // feed one byte at a time
        for b in &init {
            parser.feed(std::slice::from_ref(b));
        }
        let chunk = parser.next_chunk(&mut seq).unwrap();
        assert!(chunk.is_init);
        assert_eq!(chunk.bytes.len(), init.len());
    }
}
