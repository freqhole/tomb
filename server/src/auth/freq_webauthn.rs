//! freq_webauthn - webauthn authentication implementation
//!
//! **critical**: this module is the ONLY place where webauthn-rs types are used!
//! all webauthn-rs imports and types must be isolated to this file.
//!
//! this module is only compiled when the `webauthn` feature is enabled.
//!
//! ## structure
//!
//! this file contains both the FreqWebauthn wrapper (~180 lines) and HTTP handlers (~290 lines).
//! this is intentional - the file is unlikely to grow significantly as it contains:
//! - core webauthn wrapper (thin layer over webauthn-rs)
//! - 4 complete HTTP handlers (register_start/finish, login_start/finish)
//!
//! if this grows beyond ~1000 lines, consider splitting into:
//! - `freq_webauthn/core.rs` - FreqWebauthn struct and methods
//! - `freq_webauthn/handlers.rs` - HTTP handlers
//! - `freq_webauthn/mod.rs` - re-exports

#[cfg(feature = "webauthn")]
use webauthn_rs::prelude::*;

use crate::error::ApiError;

#[cfg(feature = "webauthn")]
use axum::{extract::Extension, response::IntoResponse, Json};

#[cfg(feature = "webauthn")]
use tower_sessions::Session;

#[cfg(feature = "webauthn")]
use crate::{auth::middleware::ValidatedOrigin, auth::session, state::AppState};

#[cfg(feature = "webauthn")]
use grimoire::users::{RegisterStartRequest, StartLoginRequest};

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

// ============================================================================
// webauthn HTTP handlers (only compiled with webauthn feature)
// ============================================================================

/// start webauthn registration - create challenge for new credential
#[cfg(feature = "webauthn")]
pub async fn register_start(
    Extension(state): Extension<AppState>,
    Extension(origin): Extension<ValidatedOrigin>,
    session: Session,
    Json(request): Json<RegisterStartRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let server_config = state
        .config
        .server
        .as_ref()
        .ok_or_else(|| ApiError::Internal("server config missing".to_string()))?;

    // Validate invite code if required
    let user_service = grimoire::users::UserService::new();

    // Check if user already exists
    let existing_user = user_service.get_user_by_username(&request.username).await;
    if existing_user.is_success() {
        return Err(ApiError::BadRequest("Username already exists".to_string()));
    }

    // Generate a temporary user ID for webauthn registration
    // The actual user account will be created in finish_register
    // We use UUID v4 to generate a deterministic 32-char hex string
    let user_id = uuid::Uuid::new_v4().to_string().replace("-", "");

    // Get existing credentials (none for new user)
    let exclude_credentials = Vec::new();

    // Get rp_id from first origin config (they should all have same rp_id)
    let rp_id = &server_config.auth.webauthn_origins[0].rp_id;
    let rp_name = "Freqhole"; // TODO: get from config

    // Create FreqWebauthn instance
    let freq_webauthn = FreqWebauthn::new(rp_id.clone(), rp_name.to_string());

    // Start registration
    let (ccr, reg_state) = freq_webauthn.start_registration(
        &origin.0,
        &user_id,
        &request.username,
        exclude_credentials,
    )?;

    // Store registration state in session
    session
        .insert(
            "reg_state",
            (
                user_id,
                request.username.clone(),
                reg_state,
                request.invite_code.clone(),
            ),
        )
        .await
        .map_err(|e| ApiError::Internal(format!("failed to save session: {}", e)))?;

    Ok(Json(ccr))
}

/// finish webauthn registration - validate credential and create user
#[cfg(feature = "webauthn")]
pub async fn register_finish(
    Extension(state): Extension<AppState>,
    Extension(origin): Extension<ValidatedOrigin>,
    session: Session,
    Json(reg): Json<RegisterPublicKeyCredential>,
) -> Result<impl IntoResponse, ApiError> {
    // Get registration state from session
    let (_temp_user_id, username, reg_state, invite_code): (
        String,
        String,
        PasskeyRegistration,
        Option<String>,
    ) = session
        .get("reg_state")
        .await
        .map_err(|e| ApiError::Internal(format!("failed to get session: {}", e)))?
        .ok_or_else(|| ApiError::BadRequest("no registration in progress".to_string()))?;

    // Remove registration state from session
    let _ = session.remove_value("reg_state").await;

    let server_config = state
        .config
        .server
        .as_ref()
        .ok_or_else(|| ApiError::Internal("server config missing".to_string()))?;

    // Get rp_id from config
    let rp_id = &server_config.auth.webauthn_origins[0].rp_id;
    let rp_name = "Freqhole";

    // Create FreqWebauthn instance
    let freq_webauthn = FreqWebauthn::new(rp_id.clone(), rp_name.to_string());

    // Finish registration
    let passkey = freq_webauthn.finish_registration(&origin.0, &reg, &reg_state)?;

    // Create user account
    let create_request = grimoire::users::CreateUserRequest {
        username: username.clone(),
        role: Some(grimoire::users::UserRole::Member),
        invite_code: invite_code.clone(),
    };

    let user_service = grimoire::users::UserService::new();
    let user_response = user_service.register_user(&create_request).await;

    if !user_response.is_success() {
        return Err(ApiError::BadRequest(
            user_response
                .errors
                .first()
                .map(|e| e.detail.clone())
                .unwrap_or_else(|| "Failed to create user".to_string()),
        ));
    }

    let user = user_response
        .data
        .ok_or_else(|| ApiError::Internal("Failed to get user data".to_string()))?;

    // Save the credential
    let webauthn_service = grimoire::users::WebAuthnService::new();
    let cred_response = webauthn_service.save_credential(&user.id, &passkey).await;

    if !cred_response.is_success() {
        return Err(ApiError::Internal("Failed to save credential".to_string()));
    }

    // Create session to auto-login
    session::save_session(&session, &user.id, &user.username, &user.role.to_string()).await?;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Registration successful",
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role.to_string(),
        }
    })))
}

/// start webauthn authentication - create challenge
#[cfg(feature = "webauthn")]
pub async fn login_start(
    Extension(state): Extension<AppState>,
    Extension(origin): Extension<ValidatedOrigin>,
    session: Session,
    Json(request): Json<StartLoginRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let username = &request.username;

    // Look up user
    let user_service = grimoire::users::UserService::new();
    let user_response = user_service.get_user_by_username(username).await;

    if !user_response.is_success() {
        return Err(ApiError::BadRequest("User not found".to_string()));
    }

    let user = user_response
        .data
        .ok_or_else(|| ApiError::Internal("Failed to get user data".to_string()))?;

    // Get user's credentials
    let webauthn_service = grimoire::users::WebAuthnService::new();
    let creds_response = webauthn_service.get_credentials(&user.id).await;

    if !creds_response.is_success() {
        return Err(ApiError::Internal("Failed to get credentials".to_string()));
    }

    let credentials = creds_response
        .data
        .ok_or_else(|| ApiError::Internal("No credentials data".to_string()))?;

    if credentials.is_empty() {
        return Err(ApiError::BadRequest("User has no credentials".to_string()));
    }

    let server_config = state
        .config
        .server
        .as_ref()
        .ok_or_else(|| ApiError::Internal("server config missing".to_string()))?;

    // Get rp_id from config
    let rp_id = &server_config.auth.webauthn_origins[0].rp_id;
    let rp_name = "Freqhole";

    // Create FreqWebauthn instance
    let freq_webauthn = FreqWebauthn::new(rp_id.clone(), rp_name.to_string());

    // Start authentication
    let (rcr, auth_state) = freq_webauthn.start_authentication(&origin.0, &credentials)?;

    // Store auth state in session
    session
        .insert("auth_state", (user.id, auth_state))
        .await
        .map_err(|e| ApiError::Internal(format!("failed to save session: {}", e)))?;

    Ok(Json(rcr))
}

/// finish webauthn authentication - validate and create session
#[cfg(feature = "webauthn")]
pub async fn login_finish(
    Extension(state): Extension<AppState>,
    Extension(origin): Extension<ValidatedOrigin>,
    session: Session,
    Json(auth): Json<PublicKeyCredential>,
) -> Result<impl IntoResponse, ApiError> {
    // Get auth state from session
    let (user_id, auth_state): (String, PasskeyAuthentication) = session
        .get("auth_state")
        .await
        .map_err(|e| ApiError::Internal(format!("failed to get session: {}", e)))?
        .ok_or_else(|| ApiError::BadRequest("no authentication in progress".to_string()))?;

    // Remove auth state from session
    let _ = session.remove_value("auth_state").await;

    let server_config = state
        .config
        .server
        .as_ref()
        .ok_or_else(|| ApiError::Internal("server config missing".to_string()))?;

    // Get rp_id from config
    let rp_id = &server_config.auth.webauthn_origins[0].rp_id;
    let rp_name = "Freqhole";

    // Create FreqWebauthn instance
    let freq_webauthn = FreqWebauthn::new(rp_id.clone(), rp_name.to_string());

    // Finish authentication
    let _auth_result = freq_webauthn.finish_authentication(&origin.0, &auth, &auth_state)?;

    // Update credential counter (optional, for now we'll skip this)
    // In production, you'd want to update the credential's counter to prevent replay attacks

    // Get user info
    let user_service = grimoire::users::UserService::new();
    let user_response = user_service.get_user(&user_id).await;

    if !user_response.is_success() {
        return Err(ApiError::Internal("Failed to get user".to_string()));
    }

    let user = user_response
        .data
        .ok_or_else(|| ApiError::Internal("No user data".to_string()))?;

    // Create session
    session::save_session(&session, &user.id, &user.username, &user.role.to_string()).await?;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Login successful",
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role.to_string(),
        }
    })))
}

// route registrations for inventory-based codegen
#[cfg(feature = "webauthn")]
use grimoire::api_registry::{Domain, Method, RouteInfo};

#[cfg(feature = "webauthn")]
inventory::submit! {
    RouteInfo {
        name: "register_start",
        path: "/api/auth/webauthn/register/start",
        method: Method::POST,
        domain: Domain::Auth,
        request_type: "RegisterStartRequest",
        response_type: "serde_json::Value",
    }
}

#[cfg(feature = "webauthn")]
inventory::submit! {
    RouteInfo {
        name: "register_finish",
        path: "/api/auth/webauthn/register/finish",
        method: Method::POST,
        domain: Domain::Auth,
        request_type: "serde_json::Value",
        response_type: "serde_json::Value",
    }
}

#[cfg(feature = "webauthn")]
inventory::submit! {
    RouteInfo {
        name: "login_start",
        path: "/api/auth/webauthn/login/start",
        method: Method::POST,
        domain: Domain::Auth,
        request_type: "StartLoginRequest",
        response_type: "serde_json::Value",
    }
}

#[cfg(feature = "webauthn")]
inventory::submit! {
    RouteInfo {
        name: "login_finish",
        path: "/api/auth/webauthn/login/finish",
        method: Method::POST,
        domain: Domain::Auth,
        request_type: "serde_json::Value",
        response_type: "serde_json::Value",
    }
}
