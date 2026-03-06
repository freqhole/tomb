//! iroh P2P transport layer for federation
//!
//! this module handles the actual peer-to-peer networking using iroh.
//! it's entirely optional - only active when federation.enabled = true.
//!
//! uses a proxy pattern - incoming requests are HTTP-like messages
//! that get forwarded to the local freqhole server via reqwest.

mod connection;
mod endpoint;
mod handler;
mod protocol;

pub use connection::{BlobStreamInfo, PeerConnection, ProxyResponse};
pub use endpoint::FederationEndpoint;
pub use handler::handle_incoming;
pub use protocol::{PeerMessage, FREQHOLE_ALPN};
