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
}

/// Request to start webauthn login
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct StartLoginRequest {
    /// Username to authenticate
    pub username: String,
}
