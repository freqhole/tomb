//! control-stream message types for `freqhole-radio/1`.
//!
//! the control stream is a bidi iroh stream carrying length-prefixed JSON
//! messages. it sits alongside the audio uni stream and carries low-frequency
//! metadata (track changes, listener counts, art) without touching the hot
//! audio path.
//!
//! framing on the wire: `[u32 BE len][len bytes utf-8 JSON]` per message.
//! see [`super::protocol::write_control_message`] / `read_control_message`.

use crate::radio::art::ResolvedArt;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};

/// codec string for the audio stream. matches the `audio/mp4; codecs=...`
/// MIME type clients hand to MSE's `addSourceBuffer`.
pub const RADIO_CODEC: &str = "audio/mp4; codecs=\"mp4a.40.2\"";

/// untagged outer wrapper: the wire shape is `{ "type": "...", ... }` —
/// serde picks the variant from the `type` discriminator.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ControlMessage {
    /// client → server, opening message on the control stream.
    Tune(TuneMessage),
    /// server → client, sent in response to `Tune`. carries the codec, the
    /// current track meta, and the seq numbers a client needs to align with
    /// the audio stream.
    Hello(HelloMessage),
    /// server → client, pushed on each track change.
    Meta(MetaMessage),
    /// server → client, sent when the listener has fallen behind the
    /// broadcaster's ring buffer. tells the listener what `init_seq` to
    /// expect on the audio stream once the broadcaster catches it back
    /// up. clients should tear down their MediaSource and discard chunks
    /// until they see `seq >= resync_at_seq && is_init`.
    Lag(LagMessage),
    /// server → client, optional heartbeat. lets the listener detect a
    /// hung uni stream (audio gone silent while the control stream is
    /// fine over QUIC keepalives). carries the broadcaster's most recent
    /// chunk seq. listeners may compare against their own `lastSeenSeq`
    /// and reconnect if the gap grows beyond a threshold.
    ChunkReady(ChunkReadyMessage),
}

/// server → client lag notice. see [`ControlMessage::Lag`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LagMessage {
    /// the seq of the next init chunk the listener should latch onto.
    pub resync_at_seq: u32,
}

/// server → client heartbeat. see [`ControlMessage::ChunkReady`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkReadyMessage {
    /// most recent chunk seq the broadcaster has produced.
    pub seq: u32,
    /// current listener count at the moment the heartbeat was emitted.
    /// this lets paused/left listeners see the badge settle quickly
    /// without waiting for the next track change.
    #[serde(default)]
    pub listener_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TuneMessage {
    /// reserved for phase 2 (multiple stations on one node). phase 1 ignores.
    #[serde(default)]
    pub station_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelloMessage {
    pub codec: String,
    pub now_playing: NowPlaying,
    pub listener_count: u32,
    /// the seq the broadcaster will assign to the next chunk. clients can use
    /// this to detect lag if they later receive a much larger seq with no
    /// chunks in between.
    pub current_seq: u32,
    /// seq of the current track's init chunk. clients receiving the audio
    /// stream will see this seq with `is_init = true`.
    pub init_seq: u32,
    /// elapsed playback time within the current track, in milliseconds,
    /// measured from when the broadcaster pushed the init chunk.
    /// clients use this to position their scrubber at the live edge so a
    /// fresh listener sees roughly the same playhead as everyone else.
    /// `0` when the broadcaster hasn't started a track yet.
    #[serde(default)]
    pub current_track_elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetaMessage {
    pub now_playing: NowPlaying,
    pub listener_count: u32,
    /// seq of the init chunk that starts this track. clients use this to
    /// latch the meta until playback actually crosses into the new track
    /// (the catchup ring + their own MSE buffer can be ~12+ seconds, so
    /// applying meta on receipt would change the displayed title well
    /// before the audio actually does).
    #[serde(default)]
    pub init_seq: u32,
}

/// the data backing the now-playing card. kept flat so phase 2 can extend
/// without bumping the protocol version.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NowPlaying {
    pub song_id: String,
    pub title: String,
    #[serde(default)]
    pub artist: Option<String>,
    #[serde(default)]
    pub album: Option<String>,
    #[serde(default)]
    pub art: Option<ArtData>,
    /// total track duration in milliseconds, when known. lets the client
    /// render a position scrubber. null for tracks without duration
    /// metadata (rare).
    #[serde(default)]
    pub duration_ms: Option<i64>,
    /// blob_id of the song's waveform image (if any). client fetches via
    /// the existing media-blob endpoint; populated independently from
    /// `art` (which is the album/artist cover).
    #[serde(default)]
    pub waveform_blob_id: Option<String>,
    /// id of the station currently playing this track (lets the client
    /// validate it's still tuned to the right channel after a reconnect).
    #[serde(default)]
    pub station_id: Option<String>,
}

/// inline base64-encoded art bytes. the `mime` field tells the client what
/// to wrap in a Blob URL.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtData {
    pub mime: String,
    /// blob_id for client-side caching (phase 1 doesn't dedupe; clients can).
    pub blob_id: String,
    /// raw image bytes, base64-encoded (RFC 4648 standard alphabet).
    pub data: String,
}

impl ArtData {
    /// build an `ArtData` payload from a [`ResolvedArt`]. base64-encodes the
    /// bytes inline so the message is a single JSON blob.
    pub fn from_resolved(resolved: &ResolvedArt) -> Self {
        Self {
            mime: resolved.mime.clone(),
            blob_id: resolved.blob_id.clone(),
            data: B64.encode(resolved.bytes.as_ref()),
        }
    }
}
