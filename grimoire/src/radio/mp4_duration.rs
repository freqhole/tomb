//! extracts each fMP4 media fragment's REAL duration (from its own
//! `moof`/`traf`/`tfhd`/`trun` boxes, plus the init segment's
//! `moov`/`trak`/`mdia`/`mdhd` timescale and `moov`/`mvex`/`trex`
//! defaults) instead of assuming every fragment covers exactly the
//! nominal `frag_ms` the broadcaster's pacer targets.
//!
//! this exists because real fragments don't always land exactly on
//! `frag_ms` (sample-duration quantization, codec framing, etc) - a
//! fragment representing even slightly less real media than the pacer
//! assumes compounds over a whole track/session into the
//! ahead-of-playhead buffer slowly eroding on the client, eventually
//! surfacing as a stall no amount of client-side buffering can mask.
//! pacing off each fragment's REAL duration instead of a fixed
//! per-chunk assumption keeps wall-clock release rate locked to real
//! content rate by construction, regardless of any per-fragment
//! variance.

use std::collections::HashMap;

const BOX_HEADER_LEN: usize = 8;

struct BoxRef<'a> {
    kind: [u8; 4],
    body: &'a [u8],
}

/// walk sibling boxes at one level of an ISO base media file structure.
/// stops (yields nothing more) at the first malformed/truncated header -
/// callers treat "fewer boxes than expected" as "can't compute a real
/// duration for this fragment", falling back to the nominal frag_ms.
fn iter_boxes(data: &[u8]) -> impl Iterator<Item = BoxRef<'_>> {
    let mut cursor = 0usize;
    std::iter::from_fn(move || {
        if data.len() < cursor + BOX_HEADER_LEN {
            return None;
        }
        let size = u32::from_be_bytes([
            data[cursor],
            data[cursor + 1],
            data[cursor + 2],
            data[cursor + 3],
        ]) as usize;
        let kind = [
            data[cursor + 4],
            data[cursor + 5],
            data[cursor + 6],
            data[cursor + 7],
        ];
        // a 0/1 (largesize) or truncated box can't be walked safely -
        // stop rather than loop forever or read out of bounds.
        if size < BOX_HEADER_LEN || data.len() < cursor + size {
            return None;
        }
        let body = &data[cursor + BOX_HEADER_LEN..cursor + size];
        cursor += size;
        Some(BoxRef { kind, body })
    })
}

pub(crate) fn find_box<'a>(data: &'a [u8], kind: &[u8; 4]) -> Option<&'a [u8]> {
    iter_boxes(data).find(|b| &b.kind == kind).map(|b| b.body)
}

/// one track's timing info, resolved once from the init segment's `moov`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mp4TrackInfo {
    pub track_id: u32,
    pub timescale: u32,
    /// from `moov.mvex.trex` - the fallback every fragment's `trun` uses
    /// when it has no explicit per-sample durations and its own `tfhd`
    /// doesn't override it either.
    pub default_sample_duration: Option<u32>,
}

/// a `tkhd`'s `track_ID` and an `mdhd`'s `timescale` sit at the identical
/// byte offset: a FullBox header (4 bytes) followed by a
/// creation_time+modification_time pair (8+8 bytes for version 1, 4+4 for
/// version 0), then the field itself.
fn read_u32_after_times(body: &[u8]) -> Option<u32> {
    let version = *body.first()?;
    let offset = if version == 1 { 4 + 16 } else { 4 + 8 };
    Some(u32::from_be_bytes(
        body.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

fn parse_trex(body: &[u8]) -> Option<(u32, u32)> {
    // FullBox header(4) + track_ID(4) + default_sample_description_index(4)
    // + default_sample_duration(4).
    let track_id = u32::from_be_bytes(body.get(4..8)?.try_into().ok()?);
    let default_sample_duration = u32::from_be_bytes(body.get(12..16)?.try_into().ok()?);
    Some((track_id, default_sample_duration))
}

/// parse every track's timescale (+ trex default sample duration, when
/// present) out of an init segment's `moov` box body.
pub fn parse_moov_tracks(moov_body: &[u8]) -> Vec<Mp4TrackInfo> {
    let mut trex_defaults: HashMap<u32, u32> = HashMap::new();
    if let Some(mvex) = find_box(moov_body, b"mvex") {
        for b in iter_boxes(mvex) {
            if &b.kind == b"trex" {
                if let Some((track_id, dur)) = parse_trex(b.body) {
                    trex_defaults.insert(track_id, dur);
                }
            }
        }
    }

    iter_boxes(moov_body)
        .filter(|b| &b.kind == b"trak")
        .filter_map(|trak| {
            let tkhd = find_box(trak.body, b"tkhd")?;
            let track_id = read_u32_after_times(tkhd)?;
            let mdia = find_box(trak.body, b"mdia")?;
            let mdhd = find_box(mdia, b"mdhd")?;
            let timescale = read_u32_after_times(mdhd)?;
            Some(Mp4TrackInfo {
                track_id,
                timescale,
                default_sample_duration: trex_defaults.get(&track_id).copied(),
            })
        })
        .collect()
}

/// `tfhd`'s `track_ID` plus its own `default_sample_duration` override,
/// when the box's flags include one (falls back to the track's `trex`
/// default otherwise).
fn parse_tfhd(body: &[u8]) -> Option<(u32, Option<u32>)> {
    let flags = u32::from_be_bytes([0, *body.get(1)?, *body.get(2)?, *body.get(3)?]);
    let track_id = u32::from_be_bytes(body.get(4..8)?.try_into().ok()?);
    let mut offset = 8;
    if flags & 0x000001 != 0 {
        offset += 8; // base_data_offset
    }
    if flags & 0x000002 != 0 {
        offset += 4; // sample_description_index
    }
    let default_sample_duration = if flags & 0x000008 != 0 {
        let v = u32::from_be_bytes(body.get(offset..offset + 4)?.try_into().ok()?);
        Some(v)
    } else {
        None
    };
    Some((track_id, default_sample_duration))
}

/// sum of every sample's duration (in the track's own timescale ticks)
/// covered by one `trun` box. uses explicit per-sample durations when
/// present, otherwise `sample_count * default_duration`.
fn parse_trun_duration_ticks(body: &[u8], default_duration: Option<u32>) -> Option<u64> {
    let flags = u32::from_be_bytes([0, *body.get(1)?, *body.get(2)?, *body.get(3)?]);
    let sample_count = u32::from_be_bytes(body.get(4..8)?.try_into().ok()?);
    let mut offset = 8;
    if flags & 0x000001 != 0 {
        offset += 4; // data_offset
    }
    if flags & 0x000004 != 0 {
        offset += 4; // first_sample_flags
    }

    let has_duration = flags & 0x000100 != 0;
    if !has_duration {
        return Some(sample_count as u64 * default_duration? as u64);
    }

    let has_size = flags & 0x000200 != 0;
    let has_flags = flags & 0x000400 != 0;
    let has_cto = flags & 0x000800 != 0;
    let per_sample_fields = 1 + [has_size, has_flags, has_cto]
        .iter()
        .filter(|f| **f)
        .count();

    let mut total: u64 = 0;
    for i in 0..sample_count as usize {
        let dur_offset = offset + i * per_sample_fields * 4;
        total += u32::from_be_bytes(body.get(dur_offset..dur_offset + 4)?.try_into().ok()?) as u64;
    }
    Some(total)
}

/// compute one media fragment's real duration in milliseconds, from its
/// `moof` box body plus the track info resolved from the init segment.
/// returns `None` when the fragment's structure can't be parsed (missing
/// `tfhd`/`trun`, an unknown `track_ID`, no default duration to fall back
/// on, etc) - the caller falls back to the nominal `frag_ms` in that case.
/// a fragment can carry multiple tracks (e.g. audio + video, cut at the
/// same real-time point) - takes the max across all of them, since they
/// should agree and any one track's own quantization shouldn't pull the
/// reported duration below what the others show.
pub fn fragment_duration_ms(moof_body: &[u8], tracks: &[Mp4TrackInfo]) -> Option<u32> {
    let mut best_ms: Option<u32> = None;
    for traf in iter_boxes(moof_body).filter(|b| &b.kind == b"traf") {
        let Some(tfhd) = find_box(traf.body, b"tfhd") else {
            continue;
        };
        let Some((track_id, tfhd_default)) = parse_tfhd(tfhd) else {
            continue;
        };
        let Some(info) = tracks.iter().find(|t| t.track_id == track_id) else {
            continue;
        };
        if info.timescale == 0 {
            continue;
        }
        let default_duration = tfhd_default.or(info.default_sample_duration);

        let mut total_ticks: u64 = 0;
        let mut any_trun = false;
        for trun in iter_boxes(traf.body).filter(|b| &b.kind == b"trun") {
            if let Some(ticks) = parse_trun_duration_ticks(trun.body, default_duration) {
                total_ticks += ticks;
                any_trun = true;
            }
        }
        if !any_trun {
            continue;
        }

        let ms = ((total_ticks as f64 / info.timescale as f64) * 1000.0).round() as u32;
        best_ms = Some(best_ms.map_or(ms, |b| b.max(ms)));
    }
    best_ms
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_box(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let total = (BOX_HEADER_LEN + body.len()) as u32;
        let mut v = Vec::with_capacity(total as usize);
        v.extend_from_slice(&total.to_be_bytes());
        v.extend_from_slice(kind);
        v.extend_from_slice(body);
        v
    }

    fn make_tkhd(track_id: u32) -> Vec<u8> {
        let mut body = vec![0u8; 4]; // version(0) + flags
        body.extend_from_slice(&0u32.to_be_bytes()); // creation_time
        body.extend_from_slice(&0u32.to_be_bytes()); // modification_time
        body.extend_from_slice(&track_id.to_be_bytes());
        make_box(b"tkhd", &body)
    }

    fn make_mdhd(timescale: u32) -> Vec<u8> {
        let mut body = vec![0u8; 4];
        body.extend_from_slice(&0u32.to_be_bytes());
        body.extend_from_slice(&0u32.to_be_bytes());
        body.extend_from_slice(&timescale.to_be_bytes());
        make_box(b"mdhd", &body)
    }

    fn make_trak(track_id: u32, timescale: u32) -> Vec<u8> {
        let tkhd = make_tkhd(track_id);
        let mdhd = make_mdhd(timescale);
        let mdia = make_box(b"mdia", &mdhd);
        let mut body = tkhd;
        body.extend_from_slice(&mdia);
        make_box(b"trak", &body)
    }

    fn make_trex(track_id: u32, default_duration: u32) -> Vec<u8> {
        let mut body = vec![0u8; 4];
        body.extend_from_slice(&track_id.to_be_bytes());
        body.extend_from_slice(&0u32.to_be_bytes()); // default_sample_description_index
        body.extend_from_slice(&default_duration.to_be_bytes());
        make_box(b"trex", &body)
    }

    fn make_moov(traks: &[Vec<u8>], trexes: &[Vec<u8>]) -> Vec<u8> {
        let mut body = Vec::new();
        for t in traks {
            body.extend_from_slice(t);
        }
        if !trexes.is_empty() {
            let mut mvex_body = Vec::new();
            for t in trexes {
                mvex_body.extend_from_slice(t);
            }
            body.extend_from_slice(&make_box(b"mvex", &mvex_body));
        }
        body
    }

    fn make_tfhd(track_id: u32, default_duration: Option<u32>) -> Vec<u8> {
        let flags: u32 = if default_duration.is_some() {
            0x000008
        } else {
            0
        };
        let mut body = vec![0u8, (flags >> 16) as u8, (flags >> 8) as u8, flags as u8];
        body.extend_from_slice(&track_id.to_be_bytes());
        if let Some(d) = default_duration {
            body.extend_from_slice(&d.to_be_bytes());
        }
        make_box(b"tfhd", &body)
    }

    fn make_trun_explicit(durations: &[u32]) -> Vec<u8> {
        let flags: u32 = 0x000100;
        let mut body = vec![0u8, (flags >> 16) as u8, (flags >> 8) as u8, flags as u8];
        body.extend_from_slice(&(durations.len() as u32).to_be_bytes());
        for d in durations {
            body.extend_from_slice(&d.to_be_bytes());
        }
        make_box(b"trun", &body)
    }

    fn make_trun_default(sample_count: u32) -> Vec<u8> {
        let mut body = vec![0u8; 4]; // version + flags(0) - no explicit durations
        body.extend_from_slice(&sample_count.to_be_bytes());
        make_box(b"trun", &body)
    }

    fn make_traf(tfhd: Vec<u8>, truns: &[Vec<u8>]) -> Vec<u8> {
        let mut body = tfhd;
        for t in truns {
            body.extend_from_slice(t);
        }
        make_box(b"traf", &body)
    }

    fn make_moof(trafs: &[Vec<u8>]) -> Vec<u8> {
        let mut body = Vec::new();
        for t in trafs {
            body.extend_from_slice(t);
        }
        body
    }

    #[test]
    fn parses_single_track_timescale_and_trex_default() {
        let moov = make_moov(&[make_trak(1, 44100)], &[make_trex(1, 1024)]);
        let tracks = parse_moov_tracks(&moov);
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].track_id, 1);
        assert_eq!(tracks[0].timescale, 44100);
        assert_eq!(tracks[0].default_sample_duration, Some(1024));
    }

    #[test]
    fn parses_multiple_tracks_independently() {
        let moov = make_moov(
            &[make_trak(1, 90000), make_trak(2, 44100)],
            &[make_trex(1, 3000), make_trex(2, 1024)],
        );
        let tracks = parse_moov_tracks(&moov);
        assert_eq!(tracks.len(), 2);
        assert!(tracks
            .iter()
            .any(|t| t.track_id == 1 && t.timescale == 90000));
        assert!(tracks
            .iter()
            .any(|t| t.track_id == 2 && t.timescale == 44100));
    }

    #[test]
    fn fragment_duration_from_trex_default_when_tfhd_has_no_override() {
        let tracks = vec![Mp4TrackInfo {
            track_id: 1,
            timescale: 44100,
            default_sample_duration: Some(1024),
        }];
        // 129 AAC frames of 1024 samples at 44100hz = ~2995.4ms, not the
        // nominal 3000ms - this IS the real-world shortfall this module
        // exists to detect.
        let traf = make_traf(make_tfhd(1, None), &[make_trun_default(129)]);
        let moof = make_moof(&[traf]);
        let ms = fragment_duration_ms(&moof, &tracks).expect("parseable");
        assert_eq!(ms, 2995);
    }

    #[test]
    fn tfhd_default_duration_overrides_trex() {
        let tracks = vec![Mp4TrackInfo {
            track_id: 1,
            timescale: 1000,
            default_sample_duration: Some(999),
        }];
        let traf = make_traf(make_tfhd(1, Some(500)), &[make_trun_default(6)]);
        let moof = make_moof(&[traf]);
        // 6 samples * 500 ticks / 1000hz = 3000ms, NOT 6*999/1000=5994ms.
        assert_eq!(fragment_duration_ms(&moof, &tracks), Some(3000));
    }

    #[test]
    fn explicit_per_sample_durations_are_summed() {
        let tracks = vec![Mp4TrackInfo {
            track_id: 7,
            timescale: 1000,
            default_sample_duration: None,
        }];
        let traf = make_traf(
            make_tfhd(7, None),
            &[make_trun_explicit(&[1000, 900, 1100])],
        );
        let moof = make_moof(&[traf]);
        assert_eq!(fragment_duration_ms(&moof, &tracks), Some(3000));
    }

    #[test]
    fn multi_track_fragment_takes_the_max_across_tracks() {
        let tracks = vec![
            Mp4TrackInfo {
                track_id: 1,
                timescale: 1000,
                default_sample_duration: Some(1000),
            },
            Mp4TrackInfo {
                track_id: 2,
                timescale: 1000,
                default_sample_duration: Some(970),
            },
        ];
        let traf1 = make_traf(make_tfhd(1, None), &[make_trun_default(3)]); // 3000ms
        let traf2 = make_traf(make_tfhd(2, None), &[make_trun_default(3)]); // 2910ms
        let moof = make_moof(&[traf1, traf2]);
        assert_eq!(fragment_duration_ms(&moof, &tracks), Some(3000));
    }

    #[test]
    fn unknown_track_id_is_skipped_not_a_hard_failure() {
        let tracks = vec![Mp4TrackInfo {
            track_id: 1,
            timescale: 1000,
            default_sample_duration: Some(1000),
        }];
        let traf = make_traf(make_tfhd(99, None), &[make_trun_default(3)]);
        let moof = make_moof(&[traf]);
        assert_eq!(fragment_duration_ms(&moof, &tracks), None);
    }

    #[test]
    fn missing_default_duration_with_no_explicit_durations_returns_none() {
        let tracks = vec![Mp4TrackInfo {
            track_id: 1,
            timescale: 1000,
            default_sample_duration: None,
        }];
        let traf = make_traf(make_tfhd(1, None), &[make_trun_default(3)]);
        let moof = make_moof(&[traf]);
        assert_eq!(fragment_duration_ms(&moof, &tracks), None);
    }

    #[test]
    fn truncated_moof_does_not_panic() {
        let tracks = vec![Mp4TrackInfo {
            track_id: 1,
            timescale: 1000,
            default_sample_duration: Some(1000),
        }];
        assert_eq!(fragment_duration_ms(&[1, 2, 3], &tracks), None);
        assert_eq!(fragment_duration_ms(&[], &tracks), None);
    }
}
