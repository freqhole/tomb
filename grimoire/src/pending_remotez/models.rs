//! pending-remote registry models
//!
//! shapes mirror client/spume/src/app/services/storage/types.ts's
//! `PendingRemote` interface so rows round-trip cleanly between sqlite and
//! the spume client, even though they're backed by the same `remotez`
//! table established remotes use (see this module's mod.rs doc comment).

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

/// stage of an in-progress remote addition - mirrors spume's
/// `PendingRemoteStage` union exactly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ZodSchema)]
#[serde(rename_all = "snake_case")]
pub enum PendingRemoteStage {
    /// connection test in progress
    Testing,
    /// test connection succeeded, have server info
    Connected,
    /// connection failed (timeout, unreachable, etc.)
    Failed,
    /// knock request was sent, awaiting response
    KnockPending,
    /// knock was accepted, can complete setup
    KnockAccepted,
    /// knock was rejected
    KnockRejected,
}

impl PendingRemoteStage {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Testing => "testing",
            Self::Connected => "connected",
            Self::Failed => "failed",
            Self::KnockPending => "knock_pending",
            Self::KnockAccepted => "knock_accepted",
            Self::KnockRejected => "knock_rejected",
        }
    }
}

impl From<String> for PendingRemoteStage {
    fn from(s: String) -> Self {
        match s.as_str() {
            "connected" => Self::Connected,
            "failed" => Self::Failed,
            "knock_pending" => Self::KnockPending,
            "knock_accepted" => Self::KnockAccepted,
            "knock_rejected" => Self::KnockRejected,
            // unknown values default to "testing" to avoid panics on legacy data
            _ => Self::Testing,
        }
    }
}

/// a single in-progress remote addition. `id` maps onto the underlying
/// `remotez.remote_id` column - a pending row gets a server-generated
/// uuid the moment it's created, same as before this was folded into
/// remotez.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PendingRemote {
    pub id: String,
    pub peer_addr: String,
    pub transport: String, // "http" | "wasm" | "app"
    pub stage: PendingRemoteStage,
    pub created_at: i64,
    pub updated_at: i64,
    // cached server info (from /api/hello) - name/description/version
    // map onto remotez's own name/description/version columns, the same
    // concept an established remote uses them for. the preview image is
    // raw base64 bytes fetched before this peer is a registered remote at
    // all (no blob/url relationship exists yet to reuse image_url/
    // image_blob_id for), so it keeps its own two columns.
    pub server_name: Option<String>,
    pub server_description: Option<String>,
    pub server_version: Option<String>,
    pub server_image_data: Option<String>,
    pub server_image_type: Option<String>,
    // knock info (optional, only if knock was sent)
    pub knock_username: Option<String>,
    pub knock_message: Option<String>,
    // error info (optional, only if stage is "failed")
    pub error_message: Option<String>,
}

/// request shape for creating a pending remote. `id`/`created_at`/
/// `updated_at` are managed by the repository (unlike `remotez`'s upsert,
/// which lets the caller supply `remote_id` - pending remotes are always
/// freshly created with a server-generated id, mirroring the IDB store's
/// own `generateUUID()` call at creation time).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreatePendingRemoteRequest {
    pub peer_addr: String,
    pub transport: String,
    pub stage: PendingRemoteStage,
    pub server_name: Option<String>,
    pub server_description: Option<String>,
    pub server_version: Option<String>,
    pub server_image_data: Option<String>,
    pub server_image_type: Option<String>,
    pub knock_username: Option<String>,
    pub knock_message: Option<String>,
    pub error_message: Option<String>,
}

/// request shape for updating a pending remote. every field besides `id`
/// is optional - only supplied fields are changed (mirrors the IDB
/// store's `Partial<Omit<PendingRemote, "id" | "created_at">>` update
/// shape). `updated_at` is always bumped to now.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema)]
pub struct UpsertPendingRemoteRequest {
    pub peer_addr: Option<String>,
    pub transport: Option<String>,
    pub stage: Option<PendingRemoteStage>,
    pub server_name: Option<String>,
    pub server_description: Option<String>,
    pub server_version: Option<String>,
    pub server_image_data: Option<String>,
    pub server_image_type: Option<String>,
    pub knock_username: Option<String>,
    pub knock_message: Option<String>,
    pub error_message: Option<String>,
}

/// single tauri-command multiplexer for every pending-remote operation -
/// mirrors `video_window::backend::VideoCommand`'s shape (a tagged enum,
/// not a loose `action: String` + json blob), so sub-commands are
/// compiler-checked and exhaustively matched on the rust side, while
/// still registering as exactly one tauri command/ACL entry instead of
/// seven. not registered for `ZodSchema`/codegen - like `VideoCommand`,
/// this is a tauri-ipc-only shape, not an offal http/p2p route.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PendingRemoteCommand {
    List,
    Get { id: String },
    GetByPeerAddr { peer_addr: String },
    Create { request: CreatePendingRemoteRequest },
    Update { id: String, request: UpsertPendingRemoteRequest },
    Remove { id: String },
    RemoveByPeerAddr { peer_addr: String },
}
