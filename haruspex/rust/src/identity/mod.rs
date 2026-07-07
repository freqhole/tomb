//! the multi-device identity model: a stable identity id owning n device
//! node ids, plus the peer profile shape a device shows to others.
//!
//! see PHASE_4_HARUSPEX_RUST.md's "identity" module map section (in the
//! tomb repo's xl-refactor plan) for the full design this ports. keypair
//! file management does NOT live here - reliquary::identity owns the key
//! file; haruspex only ever consumes node ids as plain strings.

pub mod attestation;

pub use attestation::{
    attestation_message, verify_device_attestation, AttestationError, DeviceAttestation,
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// a stable auth identity. `id` is a stable identifier independent of any
/// device's node id; `username` is optional since skein/playlistz peers may
/// be anonymous.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Identity {
    pub id: Uuid,
    pub username: Option<String>,
    pub created_at: i64,
    pub metadata: Option<serde_json::Value>,
    pub deleted_at: Option<i64>,
}

/// one device (iroh node id) belonging to an identity.
///
/// ported from tomb's `user_peer_nodez`: `node_id` is globally unique even
/// across soft-deleted rows, so a node id that was ever registered - even if
/// later soft-deleted - can never be silently re-registered to a different
/// identity. see `haruspex::sqlite::identity_store` for the enforcement.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DeviceNode {
    pub identity_id: Uuid,
    pub node_id: String,
    pub instance_name: Option<String>,
    pub last_seen_at: i64,
    pub deleted_at: Option<i64>,
}

/// what a peer shows you: display name, alias, bio, avatar. kept separate
/// from `Identity` - a profile is what a peer _presents_, not an
/// authenticated claim.
///
/// ported from skein's userz peer directory, including its coalesce-based
/// partial upsert semantics (see `haruspex::sqlite::peer_directory`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PeerProfile {
    pub node_id: String,
    pub display_name: Option<String>,
    pub alias: Option<String>,
    pub bio: Option<String>,
    pub avatar_blake3: Option<String>,
    pub accent_color: Option<String>,
    pub is_self: bool,
    pub is_hub: bool,
    pub first_seen: i64,
    pub last_seen: i64,
}
