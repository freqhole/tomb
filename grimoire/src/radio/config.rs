//! radio defaults — promoted to a `RadioConfig` block in phase 1.
//!
//! kept as bare consts so phase 0 has zero new config-file surface area.
//! call sites import these directly; phase 1 swaps the import for a
//! `get_config().radio.unwrap_or_default()` lookup without touching them.

/// AAC bitrate in kbps (192 = transparent quality for most listeners).
pub const DEFAULT_BITRATE_KBPS: u32 = 192;

/// fragment duration passed to ffmpeg via `-frag_duration` (microseconds).
/// 3s = ~50 kB per fragment at 192 kbps; balances latency vs. overhead.
pub const DEFAULT_FRAG_DURATION_US: u64 = 3_000_000;

/// MSE codec string clients should use when creating the SourceBuffer.
/// matches the `mp4a.40.2` (AAC-LC) profile produced by the encoder.
pub const MSE_CODEC: &str = "audio/mp4; codecs=\"mp4a.40.2\"";
