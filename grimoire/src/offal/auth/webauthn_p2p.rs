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
use serde::Deserialize;
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
    /// username is optional - if omitted the client uses discoverable credentials
    /// (the platform authenticator presents whatever passkey it has for this RP)
    username: Option<String>,
    /// browser origin (window.location.origin) - used to derive rp_id
    origin: String,
    /// injected by p2p handler
    #[serde(rename = "node_id")]
    _node_id: Option<String>,
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
    use crate::users::{
        challenge_store::{ChallengeStore, SaveChallengeArgs},
        webauthn::GrimoireWebAuthn,
        UserService, WebAuthnService,
    };

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
        tracing::info!("[PASSKEY-REG-BE] checking invite code, len={}", code.len());
        let code_response = user_service.check_invite_code(code).await;
        if !code_response.is_success() {
            return bad_request("invalid invite code");
        }
        let invite = code_response.data.unwrap();
        tracing::info!(
            "[PASSKEY-REG-BE] invite code type: is_account_link={}",
            invite.is_account_link_code()
        );
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
                return bad_request(
                    "node_id is known but not linked to a user account - use an invite code",
                );
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
        let creds = webauthn_service
            .get_credentials(&user_id)
            .await
            .data
            .unwrap_or_default();
        tracing::info!(
            "[PASSKEY-REG-BE] account-link mode: user_id={}, excluding {} credentials",
            user_id,
            creds.len()
        );
        creds
            .iter()
            .map(|p: &Passkey| p.cred_id().clone())
            .collect()
    } else {
        tracing::info!("[PASSKEY-REG-BE] new-user mode: no exclusions, is_account_link=false");
        vec![]
    };

    let freq_webauthn = GrimoireWebAuthn::new(rp_id.clone(), "freqhole".to_string());
    tracing::info!("[PASSKEY-REG-BE] calling start_registration: rp_id={}, user_id={}, username={}, exclude_count={}", rp_id, user_id, req.username, exclude_credentials.len());
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
    use crate::users::{
        challenge_store::ChallengeStore, webauthn::GrimoireWebAuthn, CreateUserRequest,
        UserService, WebAuthnService,
    };

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
    let reg_credential: RegisterPublicKeyCredential = match serde_json::from_value(req.credential) {
        Ok(c) => c,
        Err(e) => return bad_request(&format!("invalid credential: {}", e)),
    };

    let freq_webauthn = GrimoireWebAuthn::new(rp_id, "freqhole".to_string());
    let passkey = match freq_webauthn.finish_registration(&req.origin, &reg_credential, &reg_state)
    {
        Ok(p) => p,
        Err(e) => return bad_request(&format!("registration verification failed: {:?}", e)),
    };

    let user_service = UserService::new();

    // create or confirm user and keep the authoritative user id for credential save
    let credential_user_id = if row.is_account_link {
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
        user_id.clone()
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
        match user_resp.data {
            Some(user) => user.id,
            None => return internal_error("failed to create user"),
        }
    };

    // save the credential
    let webauthn_service = WebAuthnService::new();
    let save_resp = webauthn_service
        .save_credential(&credential_user_id, &passkey)
        .await;
    if !save_resp.is_success() {
        let detail = save_resp
            .errors
            .first()
            .map(|e| e.detail.clone())
            .unwrap_or_else(|| "failed to save credential".to_string());
        return internal_error(&detail);
    }

    // link node_id to user if provided
    if let Some(ref node_id) = req.node_id {
        let _ = user_service
            .add_peer_node(&credential_user_id, node_id, Some("passkey registration"))
            .await;
    }

    GrimoireResponse::success(
        "registration successful",
        json!({
            "user_id": credential_user_id,
            "username": username,
        }),
    )
}

/// start passkey authentication over p2p
///
/// path: POST /api/auth/webauthn/login/start
///
/// if username is omitted (or empty), uses the discoverable-credential flow:
/// the challenge has an empty allowCredentials list so the platform authenticator
/// presents whatever passkey it has for this RP without the user typing a username.
/// the user is identified from the credential's embedded userHandle in login_finish.
#[cfg(feature = "webauthn")]
pub async fn login_start(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    use crate::users::{
        challenge_store::{ChallengeStore, SaveChallengeArgs},
        webauthn::GrimoireWebAuthn,
        UserService, WebAuthnService,
    };

    let req: P2pLoginStartRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_request(&format!("invalid request body: {}", e)),
    };

    let rp_id = match validate_origin_and_get_rp_id(&req.origin) {
        Ok(id) => id,
        Err(e) => return e,
    };

    let freq_webauthn = GrimoireWebAuthn::new(rp_id, "freqhole".to_string());

    // if username is supplied and non-empty, use the targeted flow (specific credentials).
    // otherwise use discoverable credentials so the authenticator picks the passkey.
    let username = req.username.as_deref().filter(|s| !s.is_empty());

    if let Some(username) = username {
        // targeted flow: look up user, build allowCredentials list
        let user_service = UserService::new();
        let user_resp = user_service.get_user_by_username(username).await;
        if !user_resp.is_success() {
            // return the same error as a non-existent user to avoid user enumeration
            return bad_request("passkey authentication failed");
        }
        let user = user_resp.data.unwrap();

        let webauthn_service = WebAuthnService::new();
        let creds = webauthn_service
            .get_credentials(&user.id)
            .await
            .data
            .unwrap_or_default();

        if creds.is_empty() {
            return bad_request("passkey authentication failed");
        }

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
            json!({ "nonce": nonce, "challenge": rcr }),
        )
    } else {
        // discoverable flow: empty allowCredentials, user identified in login_finish
        let (rcr, auth_state) = match freq_webauthn.start_discoverable_authentication(&req.origin) {
            Ok(r) => r,
            Err(e) => {
                return internal_error(&format!("discoverable webauthn start failed: {:?}", e))
            }
        };

        let challenge_json = match serde_json::to_string(&auth_state) {
            Ok(j) => j,
            Err(e) => return internal_error(&format!("failed to serialize challenge: {}", e)),
        };

        let store = ChallengeStore::new();
        let nonce = match store
            .save(SaveChallengeArgs {
                kind: "discoverable_authentication",
                challenge_json: &challenge_json,
                user_id: None,
                username: None,
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
            json!({ "nonce": nonce, "challenge": rcr }),
        )
    }
}

/// finish passkey authentication over p2p
///
/// path: POST /api/auth/webauthn/login/finish
///
/// handles both targeted (kind="authentication") and discoverable
/// (kind="discoverable_authentication") challenge flows.
/// on success, the connecting node_id is linked to the authenticated user so
/// subsequent p2p requests from that node are auto-authenticated by node_id lookup.
#[cfg(feature = "webauthn")]
pub async fn login_finish(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    use crate::users::{
        challenge_store::ChallengeStore, webauthn::GrimoireWebAuthn, UserService, WebAuthnService,
    };

    let req: P2pLoginFinishRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_request(&format!("invalid request body: {}", e)),
    };

    let rp_id = match validate_origin_and_get_rp_id(&req.origin) {
        Ok(id) => id,
        Err(e) => return e,
    };

    let store = ChallengeStore::new();

    // try to retrieve the challenge - check both kinds
    let row = {
        let targeted = store.take(&req.nonce, "authentication").await;
        let discoverable = store.take(&req.nonce, "discoverable_authentication").await;
        match (targeted, discoverable) {
            (Ok(Some(r)), _) => r,
            (_, Ok(Some(r))) => r,
            (Ok(None), Ok(None)) => return bad_request("invalid or expired nonce"),
            (Err(e), _) | (_, Err(e)) => {
                return internal_error(&format!("failed to retrieve challenge: {}", e))
            }
        }
    };

    let auth_credential: PublicKeyCredential = match serde_json::from_value(req.credential) {
        Ok(c) => c,
        Err(e) => return bad_request(&format!("invalid credential: {}", e)),
    };

    let freq_webauthn = GrimoireWebAuthn::new(rp_id, "freqhole".to_string());
    let user_service = UserService::new();

    let user_id = if row.kind == "discoverable_authentication" {
        // discoverable flow: extract credential_id directly from the assertion
        // (identify_discoverable_authentication is not used because it requires
        //  the authenticator to have sent a user handle, which is not guaranteed)
        let cred_id = auth_credential.get_credential_id();
        tracing::info!(
            "discoverable login_finish: cred_id len={}, hex prefix={}",
            cred_id.len(),
            cred_id
                .iter()
                .take(8)
                .map(|b| format!("{:02x}", b))
                .collect::<String>()
        );

        // look up which user owns this credential
        let webauthn_service = WebAuthnService::new();
        let lookup = webauthn_service.get_user_id_by_credential_id(cred_id).await;
        tracing::info!(
            "discoverable login_finish: db lookup success={}, data={:?}",
            lookup.success,
            lookup.data
        );
        let uid = match lookup.data {
            Some(Some(id)) => id,
            _ => return bad_request("passkey authentication failed"),
        };

        // get user's credentials and finish the discoverable authentication
        let creds = webauthn_service
            .get_credentials(&uid)
            .await
            .data
            .unwrap_or_default();
        tracing::info!(
            "discoverable login_finish: uid={}, credential count={}",
            uid,
            creds.len()
        );

        let disc_state: webauthn_rs::prelude::DiscoverableAuthentication =
            match serde_json::from_str(&row.challenge_json) {
                Ok(s) => s,
                Err(e) => {
                    return internal_error(&format!("failed to deserialize challenge: {}", e))
                }
            };

        let auth_result = match freq_webauthn.finish_discoverable_authentication(
            &req.origin,
            &auth_credential,
            disc_state,
            &creds,
        ) {
            Ok(r) => r,
            Err(e) => return bad_request(&format!("authentication failed: {:?}", e)),
        };

        // update last_used_at for the credential that was used
        let _ = WebAuthnService::new()
            .update_credential_last_used(auth_result.cred_id())
            .await;

        uid
    } else {
        // targeted flow: user_id is in the challenge row
        let uid = match row.user_id {
            Some(ref id) => id.clone(),
            None => return internal_error("challenge missing user_id"),
        };

        let auth_state: PasskeyAuthentication = match serde_json::from_str(&row.challenge_json) {
            Ok(s) => s,
            Err(e) => return internal_error(&format!("failed to deserialize challenge: {}", e)),
        };

        let auth_result =
            match freq_webauthn.finish_authentication(&req.origin, &auth_credential, &auth_state) {
                Ok(r) => r,
                Err(e) => return bad_request(&format!("authentication failed: {:?}", e)),
            };

        // update last_used_at for the credential that was used
        let _ = WebAuthnService::new()
            .update_credential_last_used(auth_result.cred_id())
            .await;

        uid
    };

    // link node_id to user (this is the key p2p auth payoff: subsequent
    // requests from this node are auto-authenticated without a passkey)
    if let Some(ref node_id) = req.node_id {
        let _ = user_service
            .add_peer_node(&user_id, node_id, Some("passkey login"))
            .await;
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

// ============================================================================
// passkey management handlers (authenticated — caller must be a known peer)
// ============================================================================

fn unauthorized(detail: &str) -> GrimoireResponse<JsonValue> {
    GrimoireResponse::failure(
        detail,
        vec![crate::error::ErrorDetail {
            error_type: "unauthorized".to_string(),
            title: "unauthorized".to_string(),
            detail: detail.to_string(),
        }],
    )
}

/// list the caller's passkeys
///
/// path: GET /api/auth/webauthn/passkeys
/// owner-only: returns credentials scoped to caller.user_id; no admin override.
/// the db query itself is scoped to caller.user_id so a misconfigured caller
/// can never read another user's credentials.
pub async fn list_passkeys(caller: &Caller, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    use crate::users::WebAuthnService;

    if !caller.is_member() {
        return unauthorized("must be authenticated to list passkeys");
    }

    let service = WebAuthnService::new();
    let creds = service.list_credentials_meta(&caller.user_id).await;
    if !creds.is_success() {
        return GrimoireResponse::failure("failed to list passkeys", creds.errors);
    }

    let summaries: Vec<serde_json::Value> = creds
        .data
        .unwrap_or_default()
        .into_iter()
        .map(|c| {
            json!({
                "id": c.id,
                "created_at": c.created_at,
                "last_used_at": c.last_used_at,
                "name": c.name,
            })
        })
        .collect();

    GrimoireResponse::success("ok", json!(summaries))
}

/// delete one of the caller's passkeys by credential row id
///
/// path: POST /api/auth/webauthn/passkeys/delete
/// owner-only: the delete query is scoped to (credential_id, caller.user_id)
/// so it is impossible to delete another user's credential even with a valid row id.
#[derive(Debug, Deserialize)]
struct DeletePasskeyBody {
    credential_id: String,
}

pub async fn delete_passkey(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    use crate::users::WebAuthnService;

    if !caller.is_member() {
        return unauthorized("must be authenticated to delete a passkey");
    }

    let req: DeletePasskeyBody = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_request(&format!("invalid request body: {}", e)),
    };

    let service = WebAuthnService::new();
    let result = service
        .delete_credential(&req.credential_id, &caller.user_id)
        .await;

    if !result.is_success() {
        return GrimoireResponse::failure("failed to delete passkey", result.errors);
    }

    GrimoireResponse::success("passkey deleted", json!({}))
}

/// link an external node_id (e.g. a tauri/charnel app) to the caller's account.
/// the calling browser node must already be authenticated (its node_id is a known peer).
/// the target node_id will be added as an allowed peer for the same user.
///
/// path: POST /api/auth/webauthn/link-node
/// owner-only: always links to caller.user_id; callers cannot link nodes to other users.
#[derive(Debug, Deserialize)]
struct LinkNodeBody {
    /// node_id of the device to add as an allowed peer
    node_id: String,
}

pub async fn link_node(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    use crate::users::UserService;

    if !caller.is_member() {
        return unauthorized("must be authenticated to link a device");
    }

    let req: LinkNodeBody = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_request(&format!("invalid request body: {}", e)),
    };

    // basic sanity: node_id should be 64 hex chars
    if req.node_id.len() != 64 || !req.node_id.chars().all(|c| c.is_ascii_hexdigit()) {
        return bad_request("node_id must be a 64-character hex string");
    }

    let user_service = UserService::new();
    let result = user_service
        .add_peer_node(&caller.user_id, &req.node_id, Some("passkey link"))
        .await;

    if !result.is_success() {
        return GrimoireResponse::failure("failed to link node", result.errors);
    }

    // fire-and-forget P2P notification to charnel so it can show a "browse remote" toast
    let linked_node_id = req.node_id.clone();
    let server_name = crate::config::get_config()
        .server
        .as_ref()
        .map(|s| s.name.clone())
        .unwrap_or_else(|| "freqhole".to_string());
    let peer_addr = crate::federation::get_node_id().unwrap_or_default();
    tokio::spawn(async move {
        let payload = serde_json::json!({ "peer_addr": peer_addr, "server_name": server_name });
        let body_str = serde_json::to_string(&payload).unwrap_or_default();
        if let Err(e) = crate::federation::p2p_client::proxy_request(
            &linked_node_id,
            "POST",
            "/api/internal/device-linked",
            Some(body_str),
        )
        .await
        {
            tracing::warn!(error = %e, "failed to notify charnel of device link");
        }
    });

    GrimoireResponse::success(
        "node linked",
        json!({
            "user_id": caller.user_id,
            "node_id": req.node_id,
        }),
    )
}
