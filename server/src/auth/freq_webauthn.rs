//! freq_webauthn - webauthn authentication implementation
//!
//! **critical**: this module is the ONLY place where webauthn-rs types are used!
//! all webauthn-rs imports and types must be isolated to this file.
//!
//! this module is only compiled when the `webauthn` feature is enabled.

#[cfg(feature = "webauthn")]
use webauthn_rs::prelude::*;

use crate::error::ApiError;

/// webauthn state wrapper
///
/// wraps webauthn-rs types so they don't leak into the rest of the codebase
///
/// **important**: origin is not stored here! it's validated by middleware
/// and passed per-operation to support multiple allowed origins at runtime.
#[cfg(feature = "webauthn")]
pub struct FreqWebauthn {
    rp_id: String,
    rp_name: String,
}

#[cfg(feature = "webauthn")]
impl FreqWebauthn {
    /// create new webauthn instance
    ///
    /// # Arguments
    /// * `rp_id` - relying party id (usually your domain, e.g., "example.com")
    /// * `rp_name` - human-readable name shown during authentication
    ///
    /// **note**: origin is NOT specified here. middleware validates the request
    /// origin against config's allowed_origins list, then passes the validated
    /// origin to each operation (start_registration, start_authentication, etc).
    pub fn new(rp_id: String, rp_name: String) -> Self {
        Self { rp_id, rp_name }
    }

    /// get relying party id
    pub fn rp_id(&self) -> &str {
        &self.rp_id
    }

    /// start passkey registration
    ///
    /// creates a registration challenge for a new credential
    pub fn start_registration(
        &self,
        origin: &str,
        user_id: &str,
        username: &str,
        exclude_credentials: Vec<CredentialID>,
    ) -> Result<(CreationChallengeResponse, PasskeyRegistration), ApiError> {
        // Create webauthn instance for this origin
        let rp_origin = Url::parse(origin)
            .map_err(|e| ApiError::Internal(format!("invalid origin url: {}", e)))?;

        let webauthn = WebauthnBuilder::new(&self.rp_id, &rp_origin)
            .map_err(|e| ApiError::Internal(format!("failed to create webauthn builder: {}", e)))?
            .rp_name(&self.rp_name)
            .build()
            .map_err(|e| ApiError::Internal(format!("failed to build webauthn: {}", e)))?;

        // Create deterministic UUID from user_id string using UUID v5
        // Use NAMESPACE_URL as the namespace (arbitrary but consistent)
        let user_unique_id = Uuid::new_v5(&Uuid::NAMESPACE_URL, user_id.as_bytes());

        // Start passkey registration
        webauthn
            .start_passkey_registration(
                user_unique_id,
                username,
                username,
                Some(exclude_credentials),
            )
            .map_err(|e| ApiError::Internal(format!("webauthn registration failed: {}", e)))
    }

    /// finish passkey registration
    ///
    /// validates the registration response and returns the credential
    pub fn finish_registration(
        &self,
        origin: &str,
        reg: &RegisterPublicKeyCredential,
        state: &PasskeyRegistration,
    ) -> Result<Passkey, ApiError> {
        // Create webauthn instance for this origin
        let rp_origin = Url::parse(origin)
            .map_err(|e| ApiError::Internal(format!("invalid origin url: {}", e)))?;

        let webauthn = WebauthnBuilder::new(&self.rp_id, &rp_origin)
            .map_err(|e| ApiError::Internal(format!("failed to create webauthn builder: {}", e)))?
            .rp_name(&self.rp_name)
            .build()
            .map_err(|e| ApiError::Internal(format!("failed to build webauthn: {}", e)))?;

        // Finish passkey registration
        webauthn
            .finish_passkey_registration(reg, state)
            .map_err(|e| {
                ApiError::Internal(format!("webauthn registration validation failed: {}", e))
            })
    }

    /// start passkey authentication
    ///
    /// creates an authentication challenge
    pub fn start_authentication(
        &self,
        origin: &str,
        credentials: &[Passkey],
    ) -> Result<(RequestChallengeResponse, PasskeyAuthentication), ApiError> {
        // Create webauthn instance for this origin
        let rp_origin = Url::parse(origin)
            .map_err(|e| ApiError::Internal(format!("invalid origin url: {}", e)))?;

        let webauthn = WebauthnBuilder::new(&self.rp_id, &rp_origin)
            .map_err(|e| ApiError::Internal(format!("failed to create webauthn builder: {}", e)))?
            .rp_name(&self.rp_name)
            .build()
            .map_err(|e| ApiError::Internal(format!("failed to build webauthn: {}", e)))?;

        // Start passkey authentication
        webauthn
            .start_passkey_authentication(credentials)
            .map_err(|e| ApiError::Internal(format!("webauthn authentication failed: {}", e)))
    }

    /// finish passkey authentication
    ///
    /// validates the authentication response
    pub fn finish_authentication(
        &self,
        origin: &str,
        auth: &PublicKeyCredential,
        state: &PasskeyAuthentication,
    ) -> Result<AuthenticationResult, ApiError> {
        // Create webauthn instance for this origin
        let rp_origin = Url::parse(origin)
            .map_err(|e| ApiError::Internal(format!("invalid origin url: {}", e)))?;

        let webauthn = WebauthnBuilder::new(&self.rp_id, &rp_origin)
            .map_err(|e| ApiError::Internal(format!("failed to create webauthn builder: {}", e)))?
            .rp_name(&self.rp_name)
            .build()
            .map_err(|e| ApiError::Internal(format!("failed to build webauthn: {}", e)))?;

        // Finish passkey authentication
        webauthn
            .finish_passkey_authentication(auth, state)
            .map_err(|e| {
                ApiError::Internal(format!("webauthn authentication validation failed: {}", e))
            })
    }
}

// Non-feature-gated stub for when webauthn is disabled
#[cfg(not(feature = "webauthn"))]
pub struct FreqWebauthn {
    _rp_id: String,
    _rp_name: String,
}

#[cfg(not(feature = "webauthn"))]
impl FreqWebauthn {
    pub fn new(rp_id: String, rp_name: String) -> Self {
        Self {
            _rp_id: rp_id,
            _rp_name: rp_name,
        }
    }

    pub fn rp_id(&self) -> &str {
        &self._rp_id
    }
}
