//! `freqhole-admin/1` ALPN protocol types
//!
//! dedicated channel for remote admin operations. command-based framing
//! (not path-based like `freqhole/1`). isolated from the `PeerMessage`
//! enum used by the player proxy protocol.
//!
//! see docs/wizard-remote-admin.md for the full plan.

use crate::error::ErrorDetail;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

/// ALPN protocol identifier for remote admin connections
pub const ADMIN_ALPN: &[u8] = b"freqhole-admin/1";

/// messages exchanged on the `freqhole-admin/1` channel
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AdminMessage {
    /// admin command request from a remote wizard
    Request {
        /// request id for correlation
        id: u64,
        /// command name (e.g. "users_list", "knocks_accept")
        command: String,
        /// command arguments as a json object (or null)
        args: JsonValue,
    },

    /// response to an admin command
    Response {
        /// matching request id
        id: u64,
        /// success flag (mirrors `GrimoireResponse::success`)
        success: bool,
        /// response payload (data) or null on failure
        data: JsonValue,
        /// human-readable message
        message: String,
        /// structured errors when `success == false`
        errors: Vec<ErrorDetail>,
    },
}
