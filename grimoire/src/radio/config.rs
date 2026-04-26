//! radio configuration.
//!
//! by design the toml has only two knobs: `enabled` (main switch) and
//! `encode_args` (the ffmpeg command-line template). everything else that
//! a user might want to tweak per-stream — station name, public/private,
//! source query (which songs play) — lives in the database so the ui can
//! manage any number of stations without restarting the server.
//!
//! internal tuning constants (ring size, channel buffer) stay as bare
//! consts because they're implementation details, not user-facing.

use serde::{Deserialize, Serialize};

/// number of recent media chunks the broadcaster keeps for late-joiner
/// catchup. with ~3s frags from the default ffmpeg args this is ~12s.
pub const RING_CAPACITY: usize = 4;

/// per-listener chunk channel buffer. lagging beyond this disconnects the
/// listener (they reconnect through the catchup path).
pub const CHUNK_CHANNEL_CAPACITY: usize = 32;

/// per-listener meta channel buffer (track changes only — small is fine).
pub const META_CHANNEL_CAPACITY: usize = 8;

/// MSE codec string clients should use when creating the SourceBuffer.
/// matches the `mp4a.40.2` (AAC-LC) profile produced by the default
/// `encode_args`. if a station overrides `encode_args` to produce a
/// different codec, the corresponding station row in the db will store
/// its own codec string (added when station-level config lands).
pub const MSE_CODEC: &str = "audio/mp4; codecs=\"mp4a.40.2\"";

/// radio configuration block (toml `[radio]` section).
///
/// when `enabled = false` (or the section is absent), the broadcaster
/// does not start and `freqhole radio serve` refuses to run. all other
/// per-station settings live in sqlite (see migrations 03x_radio_*.sql,
/// landing in the next slice).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadioConfig {
    /// main switch (default: false).
    #[serde(default)]
    pub enabled: bool,

    /// ffmpeg command-line template for the encoder. supports the
    /// `{input}` placeholder (the absolute path of the song file). output
    /// is always written to stdout — `pipe:1` is part of the template.
    ///
    /// the default produces fragmented MP4 with AAC-LC at 192 kbps and
    /// 3-second fragments — what the spume / midden client expect.
    #[serde(default = "default_encode_args")]
    pub encode_args: String,
}

impl Default for RadioConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            encode_args: default_encode_args(),
        }
    }
}

/// default ffmpeg args. mirrors the style of `extract_album_art_args` /
/// `generate_waveform_args` in `MediaConfig` — a single string with
/// `{input}` placeholder, parsed via shell-style splitting.
///
/// notable flags:
/// - `-re` paces output to wall-clock playback rate (without it ffmpeg
///   blasts the entire transcoded song through stdout in seconds).
/// - `-fflags +genpts -avoid_negative_ts make_zero` hardens timestamp
///   continuity for live stitching.
/// - `frag_keyframe+empty_moov+default_base_moof` makes fMP4 that MSE
///   can append incrementally.
/// - `-frag_duration 3000000` = 3s fragments.
fn default_encode_args() -> String {
    "-hide_banner -loglevel error -re -fflags +genpts -i {input} -vn -map 0:a:0 \
     -c:a aac -profile:a aac_low -b:a 192k -ar 48000 -ac 2 \
     -movflags frag_keyframe+empty_moov+default_base_moof \
     -frag_duration 3000000 -avoid_negative_ts make_zero -f mp4 pipe:1"
        .to_string()
}

/// fetch the effective radio config: the toml `[radio]` block when
/// present, otherwise an all-defaults instance with `enabled = false`.
pub fn effective() -> RadioConfig {
    crate::config::get_config()
        .radio
        .clone()
        .unwrap_or_default()
}
