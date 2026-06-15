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
