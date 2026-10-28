//! freqhole radio — live audio streaming over iroh
//!
//! phase 1: a single global [`Broadcaster`] runs one ffmpeg pipeline and fans
//! the resulting fMP4 chunks out to every connected listener. each listener
//! also gets a control bidi stream carrying now-playing metadata + album art.
//! see [`docs/radio-plan.md`](../../../docs/radio-plan.md) for the full
//! protocol and architecture.

pub mod art;
pub mod broadcaster;
pub mod bumpers;
pub mod chunk;
pub mod config;
pub mod encoder;
pub mod handler;
pub mod messages;
pub mod mp4_duration;
pub mod playlist;
pub mod protocol;
pub mod queue_events;
pub mod radio_protocol;
pub mod requests;
pub mod resume_point;
pub mod source_probe;
pub mod stations;
pub mod warmup;

pub use art::{resolve_track_art, ResolvedArt};
pub use broadcaster::{
    default_station_id, get_default as get_default_broadcaster, get_station as get_broadcaster,
    init_registry as init_broadcaster, list_running as list_broadcasters, Broadcaster, MetaUpdate,
};
pub use chunk::{BoxParser, Chunk};
pub use encoder::{BufferedEncoder, Encoder};
pub use messages::{
    ArtData, ControlMessage, HelloMessage, MetaMessage, NowPlaying, RadioModeCapability,
    TimelineCurrentItem, TimelineMessage, TimelineUpcomingItem, TuneMessage, RADIO_CODEC,
};
pub use protocol::{
    read_chunk, read_control_message, write_chunk, write_control_message, RADIO_ALPN,
};
pub use radio_protocol::RadioProtocol;

/// if radio is enabled in config, initializes the broadcaster registry
/// (spawns one ffmpeg encoder per already-enabled station) - logs a
/// warning and otherwise continues on failure rather than failing the
/// caller's own endpoint startup (incoming radio connections just get a
/// "no broadcaster" error until the registry is retried/restarted).
///
/// a no-op if radio is disabled - callers that always attach
/// [`RADIO_ALPN`]'s handler regardless of this flag (so toggling radio
/// on/off later doesn't require a router rebuild/process restart) call
/// this unconditionally and let it decide.
///
/// shared by every process that attaches `RADIO_ALPN`'s handler -
/// grimoire's own federation endpoint, charnel's p2p client, and
/// rathole's player endpoint - this exact enabled-check/init/log
/// sequence was duplicated near-verbatim across call sites before this
/// existed.
pub async fn init_broadcaster_if_enabled() {
    if !config::effective().enabled {
        return;
    }
    if let Err(e) = init_broadcaster().await {
        tracing::warn!(
            "failed to init radio broadcasters at startup: {e}; radio listeners may fail until retried"
        );
    } else {
        tracing::info!("[radio] broadcaster registry initialized");
    }
}
