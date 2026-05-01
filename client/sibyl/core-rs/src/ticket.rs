//! sibyl ticket wire format: base64(json) carrying the iroh ticket
//! plus a small amount of song-level metadata so the peer can
//! initialize the right decoder before any chunks arrive.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::chunk::CodecParams;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SibylTicket {
    pub song_id: String,
    /// iroh-blobs collection ticket (the on-the-wire format from
    /// `iroh_blobs::ticket::BlobTicket`)
    pub iroh_ticket: String,
    pub params: CodecParams,
    /// optional human-friendly title shown in the ui
    pub title: Option<String>,
}

#[derive(Debug, Error)]
pub enum TicketError {
    #[error("base64 decode: {0}")]
    Base64(#[from] base64::DecodeError),
    #[error("json decode: {0}")]
    Json(#[from] serde_json::Error),
}

impl SibylTicket {
    pub fn encode(&self) -> String {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
        let json = serde_json::to_vec(self).expect("ticket is always serializable");
        URL_SAFE_NO_PAD.encode(json)
    }

    pub fn decode(s: &str) -> Result<Self, TicketError> {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
        let raw = URL_SAFE_NO_PAD.decode(s.trim())?;
        Ok(serde_json::from_slice(&raw)?)
    }
}
