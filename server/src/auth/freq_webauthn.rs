//! freq_webauthn - webauthn http handlers
//!
//! drives grimoire's `webauthn_ceremony` module (built on
//! `haruspex::webauthn::WebauthnCeremony`) for the four passkey routes.
//! the session carries only the ceremony's nonce between a start and
//! finish call - the actual challenge state lives in haruspex's own
//! sqlite-backed challenge store, keyed by that nonce, so the session is
//! just a thin carrier rather than the source of truth for ceremony state.
//!
//! this module is only compiled when the `webauthn` feature is enabled.

use axum::{extract::Extension, response::IntoResponse, Json};
use tower_sessions::Session;

use crate::{auth::middleware::ValidatedOrigin, auth::session, error::ApiError, state::AppState};
use grimoire::users::webauthn_ceremony::{self, RegisterStartResult, WebauthnCeremonyError};
use grimoire::users::{RegisterStartRequest, StartLoginRequest};

impl From<WebauthnCeremonyError> for ApiError {
    fn from(err: WebauthnCeremonyError) -> Self {
        match err {
            WebauthnCeremonyError::BadRequest(msg) => ApiError::BadRequest(msg),
            WebauthnCeremonyError::Internal(msg) => ApiError::Internal(msg),
        }
    }
}

/// session key for the nonce carried between register_start and
/// register_finish. separate from `LOGIN_NONCE_KEY` so a session with a
/// registration in progress doesn't collide with a concurrent login.
const REGISTER_NONCE_KEY: &str = "webauthn_register_nonce";
/// session key for the nonce carried between login_start and login_finish
/// (covers both the targeted and discoverable flows - the ceremony itself
/// tries both challenge kinds under one nonce, so one key suffices).
const LOGIN_NONCE_KEY: &str = "webauthn_login_nonce";

/// start webauthn registration - create challenge for new credential
pub async fn register_start(
    Extension(_state): Extension<AppState>,
    Extension(origin): Extension<ValidatedOrigin>,
    session: Session,
    Json(request): Json<RegisterStartRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let RegisterStartResult { challenge, nonce } = webauthn_ceremony::register_start(
        &origin.0,
        &request.username,
        request.invite_code.as_deref(),
    )
    .await?;

    session
        .insert(REGISTER_NONCE_KEY, nonce)
        .await
        .map_err(|e| ApiError::Internal(format!("failed to save session: {}", e)))?;

    Ok(Json(challenge))
}

/// finish webauthn registration - validate credential and create user
pub async fn register_finish(
    Extension(_state): Extension<AppState>,
    Extension(origin): Extension<ValidatedOrigin>,
    session: Session,
    Json(credential): Json<serde_json::Value>,
) -> Result<impl IntoResponse, ApiError> {
    let nonce: String = session
        .get(REGISTER_NONCE_KEY)
        .await
        .map_err(|e| ApiError::Internal(format!("failed to get session: {}", e)))?
        .ok_or_else(|| ApiError::BadRequest("no registration in progress".to_string()))?;
    let _ = session.remove_value(REGISTER_NONCE_KEY).await;

    let user = webauthn_ceremony::register_finish(&origin.0, &nonce, credential).await?;

    // create session to auto-login
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
///
/// if `username` is omitted, issues a discoverable-credential challenge
/// (empty allowCredentials); the user is identified during finish.
pub async fn login_start(
    Extension(_state): Extension<AppState>,
    Extension(origin): Extension<ValidatedOrigin>,
    session: Session,
    Json(request): Json<StartLoginRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let result = webauthn_ceremony::login_start(&origin.0, request.username.as_deref()).await?;

    session
        .insert(LOGIN_NONCE_KEY, result.nonce)
        .await
        .map_err(|e| ApiError::Internal(format!("failed to save session: {}", e)))?;

    Ok(Json(result.challenge))
}

/// finish webauthn authentication - validate and create session
pub async fn login_finish(
    Extension(_state): Extension<AppState>,
    Extension(origin): Extension<ValidatedOrigin>,
    session: Session,
    Json(credential): Json<serde_json::Value>,
) -> Result<impl IntoResponse, ApiError> {
    let nonce: String = session
        .get(LOGIN_NONCE_KEY)
        .await
        .map_err(|e| ApiError::Internal(format!("failed to get session: {}", e)))?
        .ok_or_else(|| ApiError::BadRequest("no authentication in progress".to_string()))?;
    let _ = session.remove_value(LOGIN_NONCE_KEY).await;

    let user = webauthn_ceremony::login_finish(&origin.0, &nonce, credential).await?;

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
