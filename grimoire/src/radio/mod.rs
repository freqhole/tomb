//! freqhole radio — live audio streaming over iroh
//!
//! phase 1: a single global [`Broadcaster`] runs one ffmpeg pipeline and fans
//! the resulting fMP4 chunks out to every connected listener. each listener
//! also gets a control bidi stream carrying now-playing metadata + album art.
//! see [`docs/radio-plan.md`](../../../docs/radio-plan.md) for the full
//! protocol and architecture.

pub mod art;
pub mod broadcaster;
pub mod chunk;
pub mod config;
pub mod encoder;
pub mod handler;
pub mod messages;
pub mod playlist;
pub mod protocol;
pub mod radio_protocol;

pub use art::{resolve_track_art, ResolvedArt};
pub use broadcaster::{get_broadcaster, init_global as init_broadcaster, Broadcaster};
pub use chunk::{BoxParser, Chunk};
pub use encoder::Encoder;
pub use messages::{
    ArtData, ControlMessage, HelloMessage, MetaMessage, NowPlaying, TuneMessage, RADIO_CODEC,
};
pub use protocol::{
    read_chunk, read_control_message, write_chunk, write_control_message, RADIO_ALPN,
};
pub use radio_protocol::RadioProtocol;
