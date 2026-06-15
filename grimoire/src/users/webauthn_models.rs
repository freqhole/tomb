//! WebAuthn request/response models for API
//!
//! These types are used by the webauthn HTTP handlers and need to be
//! registered for TypeScript codegen.

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

/// Request to start webauthn registration
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RegisterStartRequest {
    /// Username for the new account
    pub username: String,
    /// Optional invite code for registration
    pub invite_code: Option<String>,
    /// Browser origin (window.location.origin) - required for p2p transport
    /// so the server can derive rp_id without a validated http header.
    /// ignored by http handlers (they read origin from the request header).
    pub origin: Option<String>,
}

/// Request to start webauthn login
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct StartLoginRequest {
    /// Username to authenticate
    pub username: String,
    /// Browser origin (window.location.origin) - required for p2p transport.
    /// ignored by http handlers.
    pub origin: Option<String>,
}

/// Summary of a single passkey credential, safe to return to the owning user.
/// does not include the raw credential blob.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PasskeyCredentialSummary {
    /// row id (used for deletion)
    pub id: String,
    /// unix timestamp when the credential was registered
    pub created_at: i64,
    /// unix timestamp of last successful authentication, if any
    pub last_used_at: Option<i64>,
}

/// Request to delete a passkey by row id
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct DeletePasskeyRequest {
    /// the credential row id to delete (from PasskeyCredentialSummary.id)
    pub credential_id: String,
}

/// Request to link a new node_id to the authenticated user's account.
/// the calling node must already be a trusted peer (authenticated via passkey or invite).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct LinkNodeRequest {
    /// iroh node_id of the device to add as an allowed peer
    pub node_id: String,
}
