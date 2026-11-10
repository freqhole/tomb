//! pure decision helpers for the broadcaster's per-track encoder warm-up.
//!
//! kept free of tokio/ffmpeg so the timing math can be unit-tested
//! directly - the broadcaster's own warm-up loop just feeds these the
//! numbers it observes.

use std::time::Duration;

/// fraction of a continuing listener's remaining cushion the next track's
/// warm-up may spend. the rest stays as margin for whatever the new
/// encoder actually delivers once published.
const CUSHION_SPEND_FRACTION: f64 = 0.5;

/// floor on the warm-up wait at a track boundary, even when listeners
/// have little or no cushion left - publishing a brand-new encoder with
/// next to nothing ready just moves the stall into the new track.
pub const MIN_BOUNDARY_WARMUP: Duration = Duration::from_secs(12);

/// how long a track may wait for its encoder warm-up before publishing.
///
/// a station's very first track (or one with nobody tuned in) can take
/// the full `full_timeout` - listeners are already looking at a
/// "connecting" state, and a deep warm-up is what keeps the rest of the
/// session smooth. at a boundary with listeners still playing out the
/// previous track, though, every second spent here is a second of their
/// buffered cushion burned with nothing new arriving; letting it run
/// past that cushion turns a slow encode into dead air (confirmed live:
/// a 78s cushion drained to silence waiting on a 120s warm-up).
pub fn boundary_warmup_budget(
    full_timeout: Duration,
    listener_cushion: Option<Duration>,
) -> Duration {
    let Some(cushion) = listener_cushion else {
        return full_timeout;
    };
    cushion
        .mul_f64(CUSHION_SPEND_FRACTION)
        .max(MIN_BOUNDARY_WARMUP)
        .min(full_timeout)
}

/// warm-up progress shown to tuning listeners, 0-99. never reports 100
/// while still warming - the track being published is the real "done".
pub fn progress_percent(ready_chunks: u64, target_chunks: u64) -> u8 {
    if target_chunks == 0 {
        return 0;
    }
    (ready_chunks.saturating_mul(100) / target_chunks).min(99) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_percent_is_capped_below_100() {
        assert_eq!(progress_percent(0, 20), 0);
        assert_eq!(progress_percent(5, 20), 25);
        assert_eq!(progress_percent(20, 20), 99);
        assert_eq!(progress_percent(40, 20), 99);
        assert_eq!(progress_percent(3, 0), 0);
    }

    #[test]
    fn first_track_or_no_listeners_gets_the_full_timeout() {
        let full = Duration::from_secs(120);
        assert_eq!(boundary_warmup_budget(full, None), full);
    }

    #[test]
    fn boundary_spends_at_most_half_the_cushion() {
        let full = Duration::from_secs(120);
        assert_eq!(
            boundary_warmup_budget(full, Some(Duration::from_secs(78))),
            Duration::from_secs(39)
        );
    }

    #[test]
    fn boundary_budget_never_drops_below_the_floor() {
        let full = Duration::from_secs(120);
        assert_eq!(
            boundary_warmup_budget(full, Some(Duration::ZERO)),
            MIN_BOUNDARY_WARMUP
        );
    }

    #[test]
    fn boundary_budget_never_exceeds_the_full_timeout() {
        let full = Duration::from_secs(30);
        assert_eq!(
            boundary_warmup_budget(full, Some(Duration::from_secs(600))),
            full
        );
    }
}
