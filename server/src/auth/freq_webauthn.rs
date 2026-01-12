//! freq_webauthn - webauthn authentication implementation
//!
//! **critical**: this module is the ONLY place where webauthn-rs types are used!
//! all webauthn-rs imports and types must be isolated to this file.
//!
//! this module is only compiled when the `webauthn` feature is enabled.

// webauthn_rs imports will be added here when implementing phase 2
// use webauthn_rs::prelude::*;

/// webauthn state wrapper
///
/// wraps webauthn-rs types so they don't leak into the rest of the codebase
///
/// **important**: origin is not stored here! it's validated by middleware
/// and passed per-operation to support multiple allowed origins at runtime.
pub struct FreqWebauthn {
    rp_id: String,
}

impl FreqWebauthn {
    /// create new webauthn instance
    ///
    /// # Arguments
    /// * `rp_id` - relying party id (usually your domain, e.g., "example.com")
    ///
    /// **note**: origin is NOT specified here. middleware validates the request
    /// origin against config's allowed_origins list, then passes the validated
    /// origin to each operation (start_registration, start_authentication, etc).
    pub fn new(rp_id: String) -> Self {
        Self { rp_id }
    }

    /// get relying party id
    pub fn rp_id(&self) -> &str {
        &self.rp_id
    }

    // TODO: phase 2 implementation
    // each method accepts `origin: &str` parameter (validated by middleware)
    //
    // - start_registration(origin, username, ...) -> returns challenge state
    // - finish_registration(origin, ...) -> validates registration, returns credential
    // - start_authentication(origin, username) -> returns challenge state
    // - finish_authentication(origin, ...) -> validates authentication
    //
    // pattern:
    //   1. middleware validates request origin against config.allowed_origins
    //   2. middleware injects validated origin into request extensions
    //   3. handler extracts validated origin from extensions
    //   4. handler calls webauthn method with validated origin
    //
    // this allows supporting multiple origins (prod, staging, localhost)
    // without hardcoding or creating multiple webauthn instances
}
