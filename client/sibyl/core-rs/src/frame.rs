//! mp3 frame sync-word scanner.
//!
//! mp3 frames begin with an 11-bit sync word `0xFFE` followed by 1
//! bit indicating MPEG version, then layer and other fields. this
//! module scans a byte buffer and reports frame starts + lengths so
//! [`crate::transcode::Transcoder`] can split chunks on frame
//! boundaries — the most important invariant of the whole pipeline.
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

/// mpeg1 layer3 bitrate table (kbps). index 0 = free, 15 = bad.
const BITRATES_MPEG1_L3: [u32; 16] = [
    0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
];

/// mpeg1 sample rate table (hz). index 3 = reserved.
const SAMPLE_RATES_MPEG1: [u32; 4] = [44100, 48000, 32000, 0];

/// is this byte pair a plausible mpeg1 layer3 sync word?
///
/// looks for `0xFFF` (11 bits) + version=11 (mpeg1) + layer=01 (layer iii).
/// the protection bit varies, so accept either `0xFFFB` or `0xFFFA`.
fn is_sync_mpeg1_l3(b0: u8, b1: u8) -> bool {
    b0 == 0xFF && (b1 & 0xF6) == 0xF2
}

/// parse an mpeg1 layer3 header at `buf[offset..offset+4]` and return
/// the full frame size in bytes (header + payload + optional padding).
///
/// returns `None` for malformed headers (free/bad bitrate, reserved
/// sample rate). caller should skip such bytes and rescan.
fn frame_size_mpeg1_l3(buf: &[u8], offset: usize) -> Option<usize> {
    if buf.len() < offset + 4 {
        return None;
    }
    let h2 = buf[offset + 2];
    let bitrate_idx = (h2 >> 4) & 0x0F;
    let sr_idx = (h2 >> 2) & 0x03;
    let padding = (h2 >> 1) & 0x01;

    let bitrate_kbps = BITRATES_MPEG1_L3[bitrate_idx as usize];
    let sample_rate = SAMPLE_RATES_MPEG1[sr_idx as usize];
    if bitrate_kbps == 0 || sample_rate == 0 {
        return None;
    }
    // mpeg1 layer3: frame_size_bytes = 144 * bitrate / sample_rate + padding
    let size = (144 * bitrate_kbps * 1000) / sample_rate + padding as u32;
    Some(size as usize)
}

/// scan `buf` for the next complete mp3 frame starting at or after `from`.
///
/// returns `Some(frame)` if a full frame fits in `buf`, `None` if we
/// need more bytes (caller should append more and retry). caller is
/// responsible for compacting consumed bytes out of the buffer.
pub fn next_frame(buf: &[u8], from: usize) -> Option<Frame> {
    let mut i = from;
    while i + 4 <= buf.len() {
        if is_sync_mpeg1_l3(buf[i], buf[i + 1]) {
            if let Some(len) = frame_size_mpeg1_l3(buf, i) {
                if i + len <= buf.len() {
                    return Some(Frame {
                        offset: i,
                        len,
                        samples: 1152,
                    });
                } else {
                    // sync looks valid but we don't have the whole
                    // frame yet — caller needs to feed more bytes.
                    return None;
                }
            }
            // bad header at a sync candidate: skip one byte and rescan.
            i += 1;
            continue;
        }
        i += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// build a minimal valid mpeg1-layer3 header.
    fn header(bitrate_idx: u8, sr_idx: u8, padding: u8) -> [u8; 4] {
        // byte 0: 0xFF
        // byte 1: 1111 1011 → mpeg1 (11), layer3 (01), no protection (1) = 0xFB
        // byte 2: BBBB SS P E (bitrate, samplerate, padding, private)
        let b2 = (bitrate_idx << 4) | (sr_idx << 2) | (padding << 1);
        [0xFF, 0xFB, b2, 0x00]
    }

    #[test]
    fn finds_192kbps_44100_frame() {
        // 192 kbps idx=11, 44100 idx=0, padding=0 → 144*192000/44100 = 626
        let h = header(11, 0, 0);
        let mut buf = vec![0u8; 626];
        buf[..4].copy_from_slice(&h);
        let f = next_frame(&buf, 0).expect("expected frame");
        assert_eq!(f.offset, 0);
        assert_eq!(f.len, 626);
        assert_eq!(f.samples, 1152);
    }

    #[test]
    fn padding_adds_one_byte() {
        let h = header(11, 0, 1);
        let mut buf = vec![0u8; 627];
        buf[..4].copy_from_slice(&h);
        let f = next_frame(&buf, 0).expect("expected frame");
        assert_eq!(f.len, 627);
    }

    #[test]
    fn returns_none_when_truncated() {
        let h = header(11, 0, 0);
        let mut buf = vec![0u8; 200];
        buf[..4].copy_from_slice(&h);
        assert!(next_frame(&buf, 0).is_none());
    }

    #[test]
    fn skips_garbage_to_sync() {
        let h = header(11, 0, 0);
        let mut buf = vec![0xAAu8; 5];
        buf.extend_from_slice(&[0u8; 626]);
        buf[5..9].copy_from_slice(&h);
        let f = next_frame(&buf, 0).expect("expected frame");
        assert_eq!(f.offset, 5);
        assert_eq!(f.len, 626);
    }

    #[test]
    fn rejects_invalid_bitrate_index() {
        // bitrate_idx=15 is invalid
        let h = header(15, 0, 0);
        let buf = h.to_vec();
        assert!(next_frame(&buf, 0).is_none());
    }

    #[test]
    fn finds_consecutive_frames() {
        let h = header(11, 0, 0);
        let mut buf = vec![0u8; 626 * 2];
        buf[..4].copy_from_slice(&h);
        buf[626..630].copy_from_slice(&h);
        let f1 = next_frame(&buf, 0).expect("first");
        assert_eq!(f1.offset, 0);
        let f2 = next_frame(&buf, f1.offset + f1.len).expect("second");
        assert_eq!(f2.offset, 626);
    }
}
