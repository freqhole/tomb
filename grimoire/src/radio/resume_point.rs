//! where a paused listener should pick back up.
//!
//! a solo listener pausing drops its session, which freezes the current
//! track in place for a short grace window and then gives up (see the
//! freeze loop in `Broadcaster::play_track`). the broadcaster runs ahead
//! of what the listener has actually played (warm-up plus the steady
//! lead), so "where the server froze" is not "where the listener paused".
//! the client therefore reports the exact chunk it was playing (`init_seq`
//! + `seq` + `offset_ms` on the resume hint) and this module turns that
//! into a concrete plan:
//!
//! - frozen, and the paused chunk is still in the catchup ring: replay the
//!   ring starting at that chunk ([`ResumePlan::FromRing`]).
//! - frozen, but the ring has already rolled past it: abandon the frozen
//!   encode and restart the same track at the exact track position
//!   ([`ResumePlan::Rewind`]).
//! - idle (the station already gave up): cold-start the same track at the
//!   exact track position ([`ResumePlan::ColdStart`]).
//! - anything else (other listeners kept the station going, a newer track
//!   is already playing): just join live ([`ResumePlan::JoinLive`]).

use crate::radio::messages::ResumeHint;
use crate::radio::playlist::RadioItemKind;

/// maps each media chunk of the current track to the track position it
/// starts at, so a `(init_seq, seq, offset_ms)` resume point can be turned
/// back into an ffmpeg `-ss` position. kept for the whole track (not just
/// the ring) and kept through idle, so it still resolves after give-up.
#[derive(Debug, Clone)]
pub struct TrackSeqIndex {
    init_seq: u32,
    kind: RadioItemKind,
    item_id: String,
    entries: Vec<(u32, u64)>,
    next_start_ms: u64,
}

impl TrackSeqIndex {
    pub fn new(
        init_seq: u32,
        kind: RadioItemKind,
        item_id: &str,
        start_position_seconds: Option<f64>,
    ) -> Self {
        let base_ms = start_position_seconds
            .filter(|s| s.is_finite() && *s > 0.0)
            .map(|s| (s * 1000.0).round() as u64)
            .unwrap_or(0);
        Self {
            init_seq,
            kind,
            item_id: item_id.to_string(),
            entries: Vec::new(),
            next_start_ms: base_ms,
        }
    }

    pub fn init_seq(&self) -> u32 {
        self.init_seq
    }

    /// record a media chunk in emission order.
    pub fn record(&mut self, seq: u32, duration_ms: u64) {
        self.entries.push((seq, self.next_start_ms));
        self.next_start_ms += duration_ms;
    }

    /// the track position (ms) the hint points at, when it refers to this
    /// track and a chunk this index has seen.
    pub fn position_ms(&self, hint: &ResumeHint) -> Option<u64> {
        if hint.init_seq != Some(self.init_seq)
            || hint.kind != self.kind
            || hint.item_id != self.item_id
        {
            return None;
        }
        let seq = hint.seq?;
        let idx = self.entries.binary_search_by_key(&seq, |e| e.0).ok()?;
        let start = self.entries[idx].1;
        // never resolve past the start of the following chunk - a bogus
        // offset shouldn't skip media.
        let chunk_end = self
            .entries
            .get(idx + 1)
            .map(|e| e.1)
            .unwrap_or(self.next_start_ms);
        let offset = hint.offset_ms.unwrap_or(0);
        Some((start + offset).min(chunk_end.max(start)))
    }
}

/// what the broadcaster looks like at the moment a resuming tune arrives.
#[derive(Debug, Clone, Copy)]
pub struct StationSnapshot {
    /// `run()` is blocked waiting for a listener/request (gave up already).
    pub idle: bool,
    /// listeners currently connected (before this one joins).
    pub listener_count: u32,
    /// the init seq of the track currently published, if any.
    pub current_init_seq: Option<u32>,
    /// the oldest media seq still in the catchup ring, if any.
    pub oldest_ring_seq: Option<u32>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ResumePlan {
    /// no usable hint - ordinary tune.
    JoinLive,
    /// station is idle: cold-start the hinted track at this position.
    ColdStart { position_seconds: f64 },
    /// frozen with the paused chunk still in the ring: catch up from `seq`.
    FromRing { seq: u32 },
    /// frozen but the paused chunk was evicted: restart at this position.
    Rewind { position_seconds: f64 },
}

pub fn plan_resume(
    hint: Option<&ResumeHint>,
    index: Option<&TrackSeqIndex>,
    station: StationSnapshot,
) -> ResumePlan {
    let Some(hint) = hint else {
        return ResumePlan::JoinLive;
    };
    let exact_ms = index.and_then(|i| i.position_ms(hint));

    if station.idle {
        // older clients only send `position_seconds`; newer ones also send
        // the chunk, which wins because it's exact.
        let position_seconds = exact_ms
            .map(|ms| ms as f64 / 1000.0)
            .unwrap_or(hint.position_seconds.max(0.0));
        return ResumePlan::ColdStart { position_seconds };
    }

    // someone else kept the station going: the listener rejoins live.
    if station.listener_count > 0 {
        return ResumePlan::JoinLive;
    }
    let (Some(hint_init), Some(hint_seq)) = (hint.init_seq, hint.seq) else {
        return ResumePlan::JoinLive;
    };
    if station.current_init_seq != Some(hint_init) {
        return ResumePlan::JoinLive;
    }
    if station
        .oldest_ring_seq
        .is_some_and(|oldest| hint_seq >= oldest)
    {
        return ResumePlan::FromRing { seq: hint_seq };
    }
    match exact_ms {
        Some(ms) => ResumePlan::Rewind {
            position_seconds: ms as f64 / 1000.0,
        },
        None => ResumePlan::JoinLive,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hint(init_seq: Option<u32>, seq: Option<u32>, offset_ms: Option<u64>) -> ResumeHint {
        ResumeHint {
            kind: RadioItemKind::Video,
            item_id: "v1".into(),
            position_seconds: 999.0,
            init_seq,
            seq,
            offset_ms,
        }
    }

    fn index() -> TrackSeqIndex {
        let mut i = TrackSeqIndex::new(10, RadioItemKind::Video, "v1", None);
        for seq in 11..=40 {
            i.record(seq, 3000);
        }
        i
    }

    fn frozen(oldest: u32) -> StationSnapshot {
        StationSnapshot {
            idle: false,
            listener_count: 0,
            current_init_seq: Some(10),
            oldest_ring_seq: Some(oldest),
        }
    }

    #[test]
    fn position_is_chunk_start_plus_offset() {
        assert_eq!(
            index().position_ms(&hint(Some(10), Some(11), None)),
            Some(0)
        );
        assert_eq!(
            index().position_ms(&hint(Some(10), Some(15), Some(1200))),
            Some(13_200)
        );
    }

    #[test]
    fn position_includes_the_tracks_own_start_offset() {
        let mut i = TrackSeqIndex::new(10, RadioItemKind::Video, "v1", Some(120.5));
        i.record(11, 3000);
        i.record(12, 3000);
        assert_eq!(
            i.position_ms(&hint(Some(10), Some(12), Some(500))),
            Some(124_000)
        );
    }

    #[test]
    fn offset_never_runs_past_the_chunk() {
        assert_eq!(
            index().position_ms(&hint(Some(10), Some(11), Some(60_000))),
            Some(3000)
        );
    }

    #[test]
    fn position_needs_matching_track_and_known_seq() {
        assert_eq!(index().position_ms(&hint(Some(9), Some(15), None)), None);
        assert_eq!(index().position_ms(&hint(Some(10), Some(99), None)), None);
        assert_eq!(index().position_ms(&hint(None, None, None)), None);
        let mut other = hint(Some(10), Some(15), None);
        other.item_id = "v2".into();
        assert_eq!(index().position_ms(&other), None);
    }

    #[test]
    fn idle_cold_starts_at_the_exact_chunk_position() {
        let station = StationSnapshot {
            idle: true,
            listener_count: 0,
            current_init_seq: None,
            oldest_ring_seq: None,
        };
        assert_eq!(
            plan_resume(
                Some(&hint(Some(10), Some(21), None)),
                Some(&index()),
                station
            ),
            ResumePlan::ColdStart {
                position_seconds: 30.0
            }
        );
    }

    #[test]
    fn idle_falls_back_to_the_legacy_position() {
        let station = StationSnapshot {
            idle: true,
            listener_count: 0,
            current_init_seq: None,
            oldest_ring_seq: None,
        };
        assert_eq!(
            plan_resume(Some(&hint(None, None, None)), Some(&index()), station),
            ResumePlan::ColdStart {
                position_seconds: 999.0
            }
        );
    }

    #[test]
    fn frozen_with_chunk_in_ring_catches_up_from_it() {
        assert_eq!(
            plan_resume(
                Some(&hint(Some(10), Some(25), None)),
                Some(&index()),
                frozen(21)
            ),
            ResumePlan::FromRing { seq: 25 }
        );
    }

    #[test]
    fn frozen_with_chunk_evicted_rewinds_to_it() {
        assert_eq!(
            plan_resume(
                Some(&hint(Some(10), Some(15), Some(1000))),
                Some(&index()),
                frozen(21)
            ),
            ResumePlan::Rewind {
                position_seconds: 13.0
            }
        );
    }

    #[test]
    fn other_listeners_or_a_newer_track_mean_join_live() {
        let mut busy = frozen(21);
        busy.listener_count = 2;
        let h = hint(Some(10), Some(15), None);
        assert_eq!(
            plan_resume(Some(&h), Some(&index()), busy),
            ResumePlan::JoinLive
        );
        let mut moved_on = frozen(21);
        moved_on.current_init_seq = Some(41);
        assert_eq!(
            plan_resume(Some(&h), Some(&index()), moved_on),
            ResumePlan::JoinLive
        );
        assert_eq!(
            plan_resume(None, Some(&index()), frozen(21)),
            ResumePlan::JoinLive
        );
    }

    #[test]
    fn frozen_without_chunk_info_joins_live() {
        assert_eq!(
            plan_resume(Some(&hint(None, None, None)), Some(&index()), frozen(21)),
            ResumePlan::JoinLive
        );
    }
}
