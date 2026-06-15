//! webauthn handlers for p2p transport
//!
//! these handlers implement the same webauthn register/login flow as the http
//! handlers in server/src/auth/freq_webauthn.rs, but use a sqlite challenge
//! store instead of tower_sessions so they work over p2p (no cookie support).
//!
//! the nonce returned by the start handlers must be echoed back in the finish
//! body. challenges expire after `server.auth.webauthn_challenge_ttl_minutes`.
//!
//! node_id is injected into the request body by the p2p handler for all four
//! routes (same as /api/knock and /api/auth/invite).
//!
//! this module is only compiled when the `webauthn` feature is enabled.
//! when the feature is off, stub functions return a "not enabled" error.

#[cfg(feature = "webauthn")]
use webauthn_rs::prelude::{
    Passkey, PasskeyAuthentication, PasskeyRegistration, PublicKeyCredential,
    RegisterPublicKeyCredential,
};

use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};

// ============================================================================
// request types
// ============================================================================

/// start registration over p2p
#[derive(Debug, Deserialize)]
struct P2pRegisterStartRequest {
    username: String,
    /// browser origin (window.location.origin) - used to derive rp_id
    origin: String,
    /// optional account-link invite code (required if node_id not already trusted)
    invite_code: Option<String>,
    /// injected by p2p handler
    node_id: Option<String>,
}

/// finish registration over p2p
#[derive(Debug, Deserialize)]
struct P2pRegisterFinishRequest {
    nonce: String,
    /// browser origin (window.location.origin) - must match what was sent to start
    origin: String,
    /// the RegisterPublicKeyCredential JSON from navigator.credentials.create()
    credential: JsonValue,
    /// injected by p2p handler
    node_id: Option<String>,
}

/// start login over p2p
#[derive(Debug, Deserialize)]
struct P2pLoginStartRequest {
    username: String,
    /// browser origin (window.location.origin) - used to derive rp_id
    origin: String,
    /// injected by p2p handler
    node_id: Option<String>,
}

/// finish login over p2p
#[derive(Debug, Deserialize)]
struct P2pLoginFinishRequest {
    nonce: String,
    /// browser origin (window.location.origin) - must match what was sent to start
    origin: String,
    /// the PublicKeyCredential JSON from navigator.credentials.get()
    credential: JsonValue,
    /// injected by p2p handler
    node_id: Option<String>,
}

// ============================================================================
// helpers
// ============================================================================

/// validate the origin against allowed_origins and extract rp_id
#[cfg(feature = "webauthn")]
fn validate_origin_and_get_rp_id(origin: &str) -> Result<String, GrimoireResponse<JsonValue>> {
    use crate::config::{extract_rp_id, get_config};

    let config = get_config();
    let allowed = config
        .server
        .as_ref()
        .map(|s| s.auth.allowed_origins.as_slice())
        .unwrap_or(&[]);

    let is_allowed = allowed.iter().any(|o| o == "any" || o == origin);
    if !is_allowed {
        return Err(GrimoireResponse::failure(
            "origin not allowed",
            vec![crate::error::ErrorDetail {
                error_type: "forbidden".to_string(),
                title: "forbidden".to_string(),
                detail: format!("origin '{}' is not in allowed_origins", origin),
            }],
        ));
    }

    extract_rp_id(origin).ok_or_else(|| {
        GrimoireResponse::failure(
            "invalid origin",
            vec![crate::error::ErrorDetail {
                error_type: "bad_request".to_string(),
                title: "invalid origin".to_string(),
                detail: "could not extract rp_id from origin url".to_string(),
            }],
        )
    })
}

fn bad_request(detail: &str) -> GrimoireResponse<JsonValue> {
    GrimoireResponse::failure(
        detail,
        vec![crate::error::ErrorDetail {
            error_type: "bad_request".to_string(),
            title: "bad request".to_string(),
            detail: detail.to_string(),
        }],
    )
}

fn internal_error(detail: &str) -> GrimoireResponse<JsonValue> {
    GrimoireResponse::failure(
        detail,
        vec![crate::error::ErrorDetail {
            error_type: "internal_error".to_string(),
            title: "internal error".to_string(),
            detail: detail.to_string(),
        }],
    )
}

// ============================================================================
// handlers (feature-gated)
// ============================================================================

/// start passkey registration over p2p
///
/// path: POST /api/auth/webauthn/register/start
#[cfg(feature = "webauthn")]
pub async fn register_start(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    use crate::users::{challenge_store::{ChallengeStore, SaveChallengeArgs}, webauthn::GrimoireWebAuthn, UserService, WebAuthnService};

    let req: P2pRegisterStartRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_request(&format!("invalid request body: {}", e)),
    };

    let rp_id = match validate_origin_and_get_rp_id(&req.origin) {
        Ok(id) => id,
        Err(e) => return e,
    };

    let user_service = UserService::new();

    // determine user_id and whether this is an account-link flow
    let (user_id, is_account_link) = if let Some(ref code) = req.invite_code {
        let code_response = user_service.check_invite_code(code).await;
        if !code_response.is_success() {
            return bad_request("invalid invite code");
        }
        let invite = code_response.data.unwrap();
        if invite.is_account_link_code() {
            let target_user_id = match invite.get_target_user_id() {
                Some(id) => id.to_string(),
                None => return bad_request("invalid invite code"),
            };
            let user_resp = user_service.get_user(&target_user_id).await;
            if !user_resp.is_success() {
                return bad_request("invalid invite code");
            }
            let user = user_resp.data.unwrap();
            if user.username != req.username {
                return bad_request(&format!(
                    "username '{}' does not match account-link target user '{}'",
                    req.username, user.username
                ));
            }
            (user.id, true)
        } else {
            // regular invite: check username is free
            let existing = user_service.get_user_by_username(&req.username).await;
            if existing.is_success() {
                return bad_request("username already exists");
            }
            (uuid::Uuid::new_v4().to_string().replace("-", ""), false)
        }
    } else if let Some(ref node_id) = req.node_id {
        // no invite code: allow if this node_id is already a known/trusted peer
        use crate::federation::is_known_peer;
        if is_known_peer(node_id).await {
            // find the user linked to this node_id
            let user_resp = user_service.get_user_by_node_id(node_id).await;
            if user_resp.is_success() {
                let user = user_resp.data.unwrap();
                if user.username != req.username {
                    return bad_request("username does not match node's linked account");
                }
                (user.id, false)
            } else {
                return bad_request("node_id is known but not linked to a user account - use an invite code");
            }
        } else {
            return bad_request("invite_code required to register a passkey for a new identity");
        }
    } else {
        return bad_request("invite_code required to register a passkey");
    };

    // exclude already-registered credentials for this user
    let exclude_credentials = if is_account_link {
        let webauthn_service = WebAuthnService::new();
        webauthn_service
            .get_credentials(&user_id)
            .await
            .data
            .unwrap_or_default()
            .iter()
            .map(|p: &Passkey| p.cred_id().clone())
            .collect()
    } else {
        vec![]
    };

    let freq_webauthn = GrimoireWebAuthn::new(rp_id, "freqhole".to_string());
    let (ccr, reg_state) = match freq_webauthn.start_registration(
        &req.origin,
        &user_id,
        &req.username,
        exclude_credentials,
    ) {
        Ok(r) => r,
        Err(e) => return internal_error(&format!("webauthn start failed: {:?}", e)),
    };

    // persist challenge
    let challenge_json = match serde_json::to_string(&reg_state) {
        Ok(j) => j,
        Err(e) => return internal_error(&format!("failed to serialize challenge: {}", e)),
    };

    let store = ChallengeStore::new();
    let nonce = match store
        .save(SaveChallengeArgs {
            kind: "registration",
            challenge_json: &challenge_json,
            user_id: Some(&user_id),
            username: Some(&req.username),
            is_account_link,
            invite_code: req.invite_code.as_deref(),
        })
        .await
    {
        Ok(n) => n,
        Err(e) => return internal_error(&format!("failed to save challenge: {}", e)),
    };

    GrimoireResponse::success(
        "registration challenge created",
        json!({
            "nonce": nonce,
            "challenge": ccr,
        }),
    )
}

/// finish passkey registration over p2p
///
/// path: POST /api/auth/webauthn/register/finish
#[cfg(feature = "webauthn")]
pub async fn register_finish(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    use crate::users::{challenge_store::ChallengeStore, webauthn::GrimoireWebAuthn, CreateUserRequest, UserService, WebAuthnService};

    let req: P2pRegisterFinishRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_request(&format!("invalid request body: {}", e)),
    };

    let rp_id = match validate_origin_and_get_rp_id(&req.origin) {
        Ok(id) => id,
        Err(e) => return e,
    };

    // retrieve (and consume) the challenge
    let store = ChallengeStore::new();
    let row = match store.take(&req.nonce, "registration").await {
        Ok(Some(r)) => r,
        Ok(None) => return bad_request("invalid or expired nonce"),
        Err(e) => return internal_error(&format!("failed to retrieve challenge: {}", e)),
    };

    let user_id = match row.user_id {
        Some(ref id) => id.clone(),
        None => return internal_error("challenge missing user_id"),
    };
    let username = match row.username {
        Some(ref u) => u.clone(),
        None => return internal_error("challenge missing username"),
    };

    // deserialize the stored challenge state
    let reg_state: PasskeyRegistration = match serde_json::from_str(&row.challenge_json) {
        Ok(s) => s,
        Err(e) => return internal_error(&format!("failed to deserialize challenge: {}", e)),
    };

    // deserialize the credential from the client
    let reg_credential: RegisterPublicKeyCredential =
        match serde_json::from_value(req.credential) {
            Ok(c) => c,
            Err(e) => return bad_request(&format!("invalid credential: {}", e)),
        };

    let freq_webauthn = GrimoireWebAuthn::new(rp_id, "freqhole".to_string());
    let passkey = match freq_webauthn.finish_registration(&req.origin, &reg_credential, &reg_state) {
        Ok(p) => p,
        Err(e) => return bad_request(&format!("registration verification failed: {:?}", e)),
    };

    let user_service = UserService::new();

    // create or confirm user
    if row.is_account_link {
        // user already exists; optionally mark invite code as used
        if let Some(ref code) = row.invite_code {
            let _ = user_service
                .register_user(&CreateUserRequest {
                    username: username.clone(),
                    role: None,
                    invite_code: Some(code.clone()),
                })
                .await;
        }
    } else {
        let user_resp = user_service
            .register_user(&CreateUserRequest {
                username: username.clone(),
                role: None,
                invite_code: row.invite_code.clone(),
            })
            .await;
        if !user_resp.is_success() {
            let detail = user_resp
                .errors
                .first()
                .map(|e| e.detail.clone())
                .unwrap_or_else(|| "failed to create user".to_string());
            return bad_request(&detail);
        }
    }

    // save the credential
    let webauthn_service = WebAuthnService::new();
    if !webauthn_service.save_credential(&user_id, &passkey).await.is_success() {
        return internal_error("failed to save credential");
    }

    // link node_id to user if provided
    if let Some(ref node_id) = req.node_id {
        let _ = user_service.add_peer_node(&user_id, node_id, None).await;
    }

    GrimoireResponse::success(
        "registration successful",
        json!({
            "user_id": user_id,
            "username": username,
        }),
    )
}

/// start passkey authentication over p2p
///
/// path: POST /api/auth/webauthn/login/start
#[cfg(feature = "webauthn")]
pub async fn login_start(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    use crate::users::{challenge_store::{ChallengeStore, SaveChallengeArgs}, webauthn::GrimoireWebAuthn, UserService, WebAuthnService};

    let req: P2pLoginStartRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_request(&format!("invalid request body: {}", e)),
    };

    let rp_id = match validate_origin_and_get_rp_id(&req.origin) {
        Ok(id) => id,
        Err(e) => return e,
    };

    let user_service = UserService::new();
    let user_resp = user_service.get_user_by_username(&req.username).await;
    if !user_resp.is_success() {
        return bad_request("user not found");
    }
    let user = user_resp.data.unwrap();

    let webauthn_service = WebAuthnService::new();
    let creds = webauthn_service
        .get_credentials(&user.id)
        .await
        .data
        .unwrap_or_default();

    if creds.is_empty() {
        return bad_request("user has no passkeys registered");
    }

    let freq_webauthn = GrimoireWebAuthn::new(rp_id, "freqhole".to_string());
    let (rcr, auth_state) = match freq_webauthn.start_authentication(&req.origin, &creds) {
        Ok(r) => r,
        Err(e) => return internal_error(&format!("webauthn start failed: {:?}", e)),
    };

    let challenge_json = match serde_json::to_string(&auth_state) {
        Ok(j) => j,
        Err(e) => return internal_error(&format!("failed to serialize challenge: {}", e)),
    };

    let store = ChallengeStore::new();
    let nonce = match store
        .save(SaveChallengeArgs {
            kind: "authentication",
            challenge_json: &challenge_json,
            user_id: Some(&user.id),
            username: Some(&user.username),
            is_account_link: false,
            invite_code: None,
        })
        .await
    {
        Ok(n) => n,
        Err(e) => return internal_error(&format!("failed to save challenge: {}", e)),
    };

    GrimoireResponse::success(
        "authentication challenge created",
        json!({
            "nonce": nonce,
            "challenge": rcr,
        }),
    )
}

/// finish passkey authentication over p2p
///
/// path: POST /api/auth/webauthn/login/finish
///
/// on success, the connecting node_id is linked to the authenticated user so
/// subsequent p2p requests from that node are auto-authenticated by node_id lookup.
#[cfg(feature = "webauthn")]
pub async fn login_finish(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    use crate::users::{challenge_store::ChallengeStore, webauthn::GrimoireWebAuthn, UserService};

    let req: P2pLoginFinishRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_request(&format!("invalid request body: {}", e)),
    };

    let rp_id = match validate_origin_and_get_rp_id(&req.origin) {
        Ok(id) => id,
        Err(e) => return e,
    };

    let store = ChallengeStore::new();
    let row = match store.take(&req.nonce, "authentication").await {
        Ok(Some(r)) => r,
        Ok(None) => return bad_request("invalid or expired nonce"),
        Err(e) => return internal_error(&format!("failed to retrieve challenge: {}", e)),
    };

    let user_id = match row.user_id {
        Some(ref id) => id.clone(),
        None => return internal_error("challenge missing user_id"),
    };

    let auth_state: PasskeyAuthentication = match serde_json::from_str(&row.challenge_json) {
        Ok(s) => s,
        Err(e) => return internal_error(&format!("failed to deserialize challenge: {}", e)),
    };

    let auth_credential: PublicKeyCredential = match serde_json::from_value(req.credential) {
        Ok(c) => c,
        Err(e) => return bad_request(&format!("invalid credential: {}", e)),
    };

    let freq_webauthn = GrimoireWebAuthn::new(rp_id, "freqhole".to_string());
    let _auth_result =
        match freq_webauthn.finish_authentication(&req.origin, &auth_credential, &auth_state) {
            Ok(r) => r,
            Err(e) => return bad_request(&format!("authentication failed: {:?}", e)),
        };

    // link node_id to user (this is the key p2p auth payoff: subsequent
    // requests from this node are auto-authenticated without a passkey)
    let user_service = UserService::new();
    if let Some(ref node_id) = req.node_id {
        let _ = user_service.add_peer_node(&user_id, node_id, None).await;
    }

    // return basic user info; over p2p the node_id link is the "session"
    let user_resp = user_service.get_user(&user_id).await;
    let username = user_resp.data.map(|u| u.username).unwrap_or_default();

    GrimoireResponse::success(
        "authentication successful",
        json!({
            "user_id": user_id,
            "username": username,
        }),
    )
}

// ============================================================================
// stubs when webauthn feature is disabled
// ============================================================================

#[cfg(not(feature = "webauthn"))]
pub async fn register_start(_caller: &Caller, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    GrimoireResponse::failure(
        "webauthn not enabled",
        vec![crate::error::ErrorDetail {
            error_type: "not_enabled".to_string(),
            title: "not enabled".to_string(),
            detail: "server was built without webauthn support".to_string(),
        }],
    )
}

#[cfg(not(feature = "webauthn"))]
pub async fn register_finish(_caller: &Caller, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    GrimoireResponse::failure(
        "webauthn not enabled",
        vec![crate::error::ErrorDetail {
            error_type: "not_enabled".to_string(),
            title: "not enabled".to_string(),
            detail: "server was built without webauthn support".to_string(),
        }],
    )
}

#[cfg(not(feature = "webauthn"))]
pub async fn login_start(_caller: &Caller, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    GrimoireResponse::failure(
        "webauthn not enabled",
        vec![crate::error::ErrorDetail {
            error_type: "not_enabled".to_string(),
            title: "not enabled".to_string(),
            detail: "server was built without webauthn support".to_string(),
        }],
    )
}

#[cfg(not(feature = "webauthn"))]
pub async fn login_finish(_caller: &Caller, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    GrimoireResponse::failure(
        "webauthn not enabled",
        vec![crate::error::ErrorDetail {
            error_type: "not_enabled".to_string(),
            title: "not enabled".to_string(),
            detail: "server was built without webauthn support".to_string(),
        }],
    )
}
