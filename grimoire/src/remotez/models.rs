//! remote registry models
//!
//! shapes mirror the existing TypeScript Remote schema in
//! client/spume/src/app/services/storage/schemas/remote.ts so rows
//! round-trip cleanly between sqlite and the spume / wizard clients.

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

/// transport type for a remote instance
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ZodSchema)]
#[serde(rename_all = "lowercase")]
pub enum RemoteTransport {
    /// standard HTTP REST transport
    Http,
    /// browser P2P over iroh (wasm endpoint)
    Wasm,
    /// native P2P over iroh (charnel/tauri endpoint)
    App,
}

impl RemoteTransport {
    pub fn as_str(&self) -> &'static str {
        match self {
            RemoteTransport::Http => "http",
            RemoteTransport::Wasm => "wasm",
            RemoteTransport::App => "app",
        }
    }
}

impl From<String> for RemoteTransport {
    fn from(s: String) -> Self {
        match s.as_str() {
            "http" => RemoteTransport::Http,
            "wasm" => RemoteTransport::Wasm,
            "app" => RemoteTransport::App,
            // unknown values default to http to avoid panics on legacy data
            _ => RemoteTransport::Http,
        }
    }
}

/// a single remote freqhole instance entry
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct Remote {
    pub remote_id: String,
    pub name: String,
    pub transport: RemoteTransport,
    pub base_url: Option<String>,
    pub peer_addr: Option<String>,
    pub api_key: Option<String>,
    pub is_active: bool,
    pub is_charnel_managed: bool,
    pub last_connected_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    // cached server info (from /api/hello)
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub image_blob_id: Option<String>,
    pub version: Option<String>,
    pub last_info_check: Option<i64>,
    // offline tracking
    pub is_offline: Option<bool>,
    pub offline_since: Option<i64>,
    pub last_checked: Option<i64>,
    /// extensible json blob for forward-compat fields
    pub metadata: Option<String>,
}

/// request shape for upserting a remote. caller-supplied fields only;
/// `created_at` / `updated_at` are managed by the repository.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpsertRemoteRequest {
    pub remote_id: String,
    pub name: String,
    pub transport: RemoteTransport,
    pub base_url: Option<String>,
    pub peer_addr: Option<String>,
    pub api_key: Option<String>,
    pub is_active: Option<bool>,
    pub is_charnel_managed: Option<bool>,
    pub last_connected_at: Option<i64>,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub image_blob_id: Option<String>,
    pub version: Option<String>,
    pub last_info_check: Option<i64>,
    pub is_offline: Option<bool>,
    pub offline_since: Option<i64>,
    pub last_checked: Option<i64>,
    pub metadata: Option<String>,
}
