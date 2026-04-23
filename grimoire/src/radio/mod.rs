//! freqhole radio — live audio streaming over iroh
//!
//! phase 0: bare-bones single-listener prototype. on each inbound connection,
//! pick a random song, run ffmpeg to fMP4/AAC, write framed chunks to a uni
//! stream. when the song ends, pick another and continue.
//!
//! phase 1 will add a `Broadcaster` between the encoder and the handler so
//! many listeners share one ffmpeg pipeline. the modules below are shaped
//! so phase 1 extends rather than replaces them.

pub mod chunk;
pub mod config;
pub mod encoder;
pub mod handler;
pub mod playlist;
pub mod protocol;
pub mod radio_protocol;

pub use chunk::{BoxParser, Chunk};
pub use encoder::Encoder;
pub use protocol::{read_chunk, write_chunk, RADIO_ALPN};
pub use radio_protocol::RadioProtocol;
