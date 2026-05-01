//! sibyl-core: transcode → iroh-blobs → chunk pipeline.
//!
//! this crate is the **portable** part of sibyl. it has no tauri or
//! dom dependencies and is designed to be lifted into freqhole's
//! grimoire workspace later with no changes.
//!
//! public surface:
//! - [`Transcoder`] — spawns ffmpeg, yields [`Chunk`]s
//! - [`SibylNode`] — iroh `Endpoint` + blobs `MemStore` + downloader
//! - [`SibylHost`] — drives a transcoder and publishes chunks as blobs
//! - [`SibylPeer`] — downloads a ticket and emits chunks in order
//! - [`SibylTicket`] — base64-json wire format
//!
//! everything is async (tokio). chunk delivery is callback-based;
//! callers wire those callbacks into whatever transport surface they
//! expose to their ui (tauri events, postMessage, etc.).

pub mod chunk;
pub mod frame;
pub mod host;
pub mod iroh_node;
pub mod peer;
pub mod ticket;
pub mod transcode;

pub use chunk::{Chunk, CodecParams};
pub use frame::Frame;
pub use host::SibylHost;
pub use iroh_node::SibylNode;
pub use peer::SibylPeer;
pub use ticket::{SibylTicket, TicketError};
pub use transcode::Transcoder;
