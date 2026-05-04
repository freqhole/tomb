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

/// per-listener chunk channel buffer. lagging beyond this disconnects the
/// listener (they reconnect through the catchup path).
pub const CHUNK_CHANNEL_CAPACITY: usize = 32;

/// floor for the broadcaster's late-joiner ring (in chunks). even with a
/// tiny buffer config, we always keep at least this many fragments around
/// so a fresh listener has *something* to chew on while their first
/// network round-trip lands.
pub const MIN_RING_CHUNKS: usize = 4;

/// upper sanity bound on the late-joiner ring (in chunks). caps memory
/// when someone sets buffer_seconds absurdly large in config.
pub const MAX_RING_CHUNKS: usize = 256;

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
    ///
    /// note: the broadcaster now paces output server-side, so the default
    /// template no longer carries `-re`. ffmpeg runs as fast as the
    /// kernel pipe + bounded mpsc buffer allow, the broadcaster pacer
    /// emits at fragment cadence to listeners, and a server-side ring
    /// (`buffer_seconds` worth) absorbs ffmpeg crashes / restarts
    /// without listeners hearing a dropout.
    #[serde(default = "default_encode_args")]
    pub encode_args: String,

    /// approximate audio duration of one fragment, in milliseconds. must
    /// match the `-frag_duration` value baked into `encode_args`. the
    /// pacer uses this to compute when each chunk should be emitted.
    #[serde(default = "default_frag_ms")]
    pub frag_ms: u32,

    /// target seconds of pre-encoded audio the broadcaster keeps buffered
    /// in front of the pacer. sized so listeners can ride out an ffmpeg
    /// crash or restart without hearing silence. the encoder fills this
    /// as fast as it can; the pacer drains it at fragment cadence.
    #[serde(default = "default_buffer_seconds")]
    pub buffer_seconds: u32,

    /// silence gap inserted between tracks (in milliseconds). breathes a
    /// little air between songs so they don't smash together; also covers
    /// the fMP4 init-chunk handover for MSE.
    #[serde(default = "default_inter_track_silence_ms")]
    pub inter_track_silence_ms: u32,

    /// max consecutive ffmpeg launch failures before the broadcaster
    /// gives up on the current track and rolls to the next one. each
    /// retry restarts ffmpeg from scratch.
    #[serde(default = "default_encoder_restart_attempts")]
    pub encoder_restart_attempts: u32,
}

impl Default for RadioConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            encode_args: default_encode_args(),
            frag_ms: default_frag_ms(),
            buffer_seconds: default_buffer_seconds(),
            inter_track_silence_ms: default_inter_track_silence_ms(),
            encoder_restart_attempts: default_encoder_restart_attempts(),
        }
    }
}

/// default ffmpeg args. mirrors the style of `extract_album_art_args` /
/// `generate_waveform_args` in `MediaConfig` — a single string with
/// `{input}` placeholder, parsed via shell-style splitting.
///
/// notable flags:
/// - `-fflags +genpts -avoid_negative_ts make_zero` hardens timestamp
///   continuity for live stitching.
/// - `frag_keyframe+empty_moov+default_base_moof` makes fMP4 that MSE
///   can append incrementally.
/// - `-frag_duration 3000000` = 3s fragments. when changing this, also
///   update `frag_ms` so the pacer agrees with what ffmpeg actually
///   produces.
///
/// note: the historical `-re` flag is intentionally absent — the
/// broadcaster paces the output server-side now, and dropping `-re`
/// lets ffmpeg eagerly fill the server-side buffer (so a crash leaves
/// listeners with `buffer_seconds` of slack to recover in).
fn default_encode_args() -> String {
    "-hide_banner -loglevel error -fflags +genpts -i {input} -vn -map 0:a:0 \
     -c:a aac -profile:a aac_low -b:a 192k -ar 48000 -ac 2 \
     -movflags frag_keyframe+empty_moov+default_base_moof \
     -frag_duration 3000000 -avoid_negative_ts make_zero -f mp4 pipe:1"
        .to_string()
}

fn default_frag_ms() -> u32 {
    3000
}

fn default_buffer_seconds() -> u32 {
    60
}

fn default_inter_track_silence_ms() -> u32 {
    250
}

fn default_encoder_restart_attempts() -> u32 {
    3
}

/// derived ring capacity (in chunks) — `buffer_seconds / frag_seconds`,
/// clamped to `[MIN_RING_CHUNKS, MAX_RING_CHUNKS]`. used both for the
/// late-joiner ring (broadcaster) and the encoder→pacer mpsc channel.
pub fn ring_capacity(cfg: &RadioConfig) -> usize {
    let frag_s = (cfg.frag_ms / 1000).max(1) as usize;
    let raw = (cfg.buffer_seconds as usize).max(1) / frag_s;
    raw.clamp(MIN_RING_CHUNKS, MAX_RING_CHUNKS)
}

/// fetch the effective radio config: the toml `[radio]` block when
/// present, otherwise an all-defaults instance with `enabled = false`.
pub fn effective() -> RadioConfig {
    crate::config::get_config()
        .radio
        .clone()
        .unwrap_or_default()
}
