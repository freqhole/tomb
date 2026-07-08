//! webauthn handlers for p2p transport
//!
//! these handlers implement the same webauthn register/login flow as the http
//! handlers in server/src/auth/freq_webauthn.rs, but drive haruspex's
//! `WebauthnCeremony` (a sqlite challenge/credential store instead of
//! tower_sessions) so they work over p2p (no cookie support).
//!
//! the nonce returned by the start handlers must be echoed back in the finish
//! body. challenges expire after `server.auth.webauthn_challenge_ttl_minutes`.
//!
//! node_id is injected into the request body by the p2p handler for all four
//! routes (same as /api/knock and /api/auth/invite).
//!
//! this module is only compiled when the `webauthn` feature is enabled.
//! when the feature is off, stub functions return a "not enabled" error.

use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use serde::Deserialize;
use serde_json::{json, Value as JsonValue};

// ============================================================================
// request types
// ============================================================================

/// start registration over p2p
#[cfg(feature = "webauthn")]
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
#[cfg(feature = "webauthn")]
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
#[cfg(feature = "webauthn")]
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
#[cfg(feature = "webauthn")]
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

#[cfg(feature = "webauthn")]
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

/// the challenge ttl, in seconds, from config (default 15 minutes)
#[cfg(feature = "webauthn")]
fn webauthn_challenge_ttl_secs() -> i64 {
    use crate::config::get_config;
    get_config()
        .server
        .as_ref()
        .map(|s| s.auth.webauthn_challenge_ttl_minutes)
        .unwrap_or(15) as i64
        * 60
}

/// map a haruspex ceremony error onto the same response shapes the p2p
/// handlers used before the cutover (a failed lookup and an expired/invalid
/// nonce are kept indistinguishable from each other on purpose, to avoid
/// leaking which case occurred).
#[cfg(feature = "webauthn")]
fn webauthn_error_response(err: haruspex::webauthn::WebauthnError) -> GrimoireResponse<JsonValue> {
    use haruspex::webauthn::WebauthnError;
    match err {
        WebauthnError::InvalidChallenge => bad_request("invalid or expired nonce"),
        WebauthnError::NoCredentials | WebauthnError::AuthenticationFailed => {
            bad_request("passkey authentication failed")
        }
        WebauthnError::InvalidCredential(msg) => {
            bad_request(&format!("invalid credential: {}", msg))
        }
        WebauthnError::Ceremony(msg) => {
            internal_error(&format!("webauthn ceremony failed: {}", msg))
        }
        WebauthnError::Store(e) => internal_error(&format!("auth store error: {}", e)),
    }
}

/// open haruspex's credential/challenge/identity stores, all backed by the
/// same pool.
#[cfg(feature = "webauthn")]
async fn haruspex_webauthn_stores() -> Result<
    (
        haruspex::sqlite::SqliteCredentialStore,
        haruspex::sqlite::SqliteChallengeStore,
        haruspex::sqlite::SqliteIdentityStore,
    ),
    GrimoireResponse<JsonValue>,
> {
    let pool = crate::database::connect_haruspex()
        .await
        .map_err(|e| internal_error(&format!("failed to open auth store: {}", e)))?;
    Ok((
        haruspex::sqlite::SqliteCredentialStore::new(pool.clone()),
        haruspex::sqlite::SqliteChallengeStore::new(pool.clone()),
        haruspex::sqlite::SqliteIdentityStore::new(pool),
    ))
}

/// start passkey registration over p2p
///
/// path: POST /api/auth/webauthn/register/start
#[cfg(feature = "webauthn")]
pub async fn register_start(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    use crate::users::{haruspex_bridge, UserService};
    use haruspex::webauthn::{RegisterStartArgs, WebauthnCeremony};

    let req: P2pRegisterStartRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_request(&format!("invalid request body: {}", e)),
    };

    let rp_id = match validate_origin_and_get_rp_id(&req.origin) {
        Ok(id) => id,
        Err(e) => return e,
    };

    let user_service = UserService::new();
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let (credentials, challenges, identities) = match haruspex_webauthn_stores().await {
        Ok(stores) => stores,
        Err(e) => return e,
    };

    // determine the identity this passkey will belong to, and whether this
    // is an account-link flow: an invite code either names an existing
    // account (account-link) or authorizes a brand-new one; a known peer's
    // node_id can also resolve to an existing account.
    let (identity_id, is_account_link) = if let Some(ref code) = req.invite_code {
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
            let id = match haruspex_bridge::ensure_identity_for_user(
                &identities,
                &user.id,
                &user.username,
                now,
            )
            .await
            {
                Ok(id) => id,
                Err(e) => return internal_error(&format!("failed to prepare identity: {}", e)),
            };
            (id, true)
        } else {
            // regular invite: check username is free
            let existing = user_service.get_user_by_username(&req.username).await;
            if existing.is_success() {
                return bad_request("username already exists");
            }
            // brand-new account: no grimoire user row exists yet (created in
            // register_finish once the ceremony succeeds), so there is no
            // stable id to derive an identity from - use a fresh one and
            // link it to the real grimoire user id once that row exists.
            let id = uuid::Uuid::new_v4();
            if let Err(e) =
                haruspex_bridge::create_pending_identity(&identities, id, &req.username, now).await
            {
                return internal_error(&format!("failed to prepare identity: {}", e));
            }
            (id, false)
        }
    } else if let Some(ref node_id) = req.node_id {
        // no invite code: allow if this node_id is already a known/trusted peer
        use crate::federation::is_known_peer;
        if is_known_peer(node_id).await {
            let user_resp = user_service.get_user_by_node_id(node_id).await;
            if user_resp.is_success() {
                let user = user_resp.data.unwrap();
                if user.username != req.username {
                    return bad_request("username does not match node's linked account");
                }
                let id = match haruspex_bridge::ensure_identity_for_user(
                    &identities,
                    &user.id,
                    &user.username,
                    now,
                )
                .await
                {
                    Ok(id) => id,
                    Err(e) => return internal_error(&format!("failed to prepare identity: {}", e)),
                };
                (id, false)
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

    let ceremony = WebauthnCeremony {
        rp_id: &rp_id,
        rp_name: "freqhole",
        credentials: &credentials,
        challenges: &challenges,
        identities: &identities,
    };

    let (ccr, nonce) = match ceremony
        .register_start(
            &req.origin,
            RegisterStartArgs {
                identity_id,
                username: &req.username,
                is_account_link,
                invite_code: req.invite_code.as_deref(),
                now,
                challenge_ttl_secs: webauthn_challenge_ttl_secs(),
            },
        )
        .await
    {
        Ok(r) => r,
        Err(e) => return webauthn_error_response(e),
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
    use crate::users::{haruspex_bridge, CreateUserRequest, UserService};
    use haruspex::stores::IdentityStore;
    use haruspex::webauthn::WebauthnCeremony;

    let req: P2pRegisterFinishRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_request(&format!("invalid request body: {}", e)),
    };

    let rp_id = match validate_origin_and_get_rp_id(&req.origin) {
        Ok(id) => id,
        Err(e) => return e,
    };

    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let (credentials, challenges, identities) = match haruspex_webauthn_stores().await {
        Ok(stores) => stores,
        Err(e) => return e,
    };

    let ceremony = WebauthnCeremony {
        rp_id: &rp_id,
        rp_name: "freqhole",
        credentials: &credentials,
        challenges: &challenges,
        identities: &identities,
    };

    let outcome = match ceremony
        .register_finish(
            &req.origin,
            &req.nonce,
            req.credential,
            req.node_id.as_deref(),
            now,
        )
        .await
    {
        Ok(o) => o,
        Err(e) => return webauthn_error_response(e),
    };

    let identity_id = outcome.credential.identity_id;
    let username = match identities.get_identity(identity_id).await {
        Ok(Some(identity)) => identity.username.unwrap_or_default(),
        Ok(None) => return internal_error("identity vanished mid-ceremony"),
        Err(e) => return internal_error(&format!("failed to load identity: {}", e)),
    };

    let user_service = UserService::new();

    // create or confirm the grimoire user and keep the authoritative user id
    // for the response
    let credential_user_id = if outcome.is_account_link {
        let user_id =
            match haruspex_bridge::grimoire_user_id_for_identity(&identities, identity_id).await {
                Ok(Some(id)) => id,
                Ok(None) => return internal_error("identity is missing its linked grimoire user"),
                Err(e) => return internal_error(&format!("failed to resolve user: {}", e)),
            };
        // user already exists; optionally mark invite code as used
        if let Some(ref code) = outcome.invite_code {
            let _ = user_service
                .register_user(&CreateUserRequest {
                    username: username.clone(),
                    role: None,
                    invite_code: Some(code.clone()),
                })
                .await;
        }
        user_id
    } else {
        let user_resp = user_service
            .register_user(&CreateUserRequest {
                username: username.clone(),
                role: None,
                invite_code: outcome.invite_code.clone(),
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
        let user = match user_resp.data {
            Some(user) => user,
            None => return internal_error("failed to create user"),
        };
        // the identity was created with a scratch id in register_start (no
        // grimoire user existed yet) - link it to the real one now.
        if let Err(e) =
            haruspex_bridge::link_identity_to_grimoire_user(&identities, identity_id, &user.id)
                .await
        {
            return internal_error(&format!("failed to link identity: {}", e));
        }
        user.id
    };

    // link node_id to the grimoire user (grimoire's own peer table -
    // separate from haruspex's own device_nodez table, which the ceremony
    // above already updated directly; device/identity storage is not
    // unified across the two yet, see this cutover's final report)
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
    use crate::users::{haruspex_bridge, UserService};
    use haruspex::webauthn::WebauthnCeremony;

    let req: P2pLoginStartRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_request(&format!("invalid request body: {}", e)),
    };

    let rp_id = match validate_origin_and_get_rp_id(&req.origin) {
        Ok(id) => id,
        Err(e) => return e,
    };

    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let (credentials, challenges, identities) = match haruspex_webauthn_stores().await {
        Ok(stores) => stores,
        Err(e) => return e,
    };

    // if username is supplied and non-empty, use the targeted flow (specific
    // credentials). otherwise use discoverable credentials so the
    // authenticator picks the passkey; the identity is resolved in
    // login_finish.
    let username = req.username.as_deref().filter(|s| !s.is_empty());

    let targeted_identity = if let Some(username) = username {
        let user_service = UserService::new();
        let user_resp = user_service.get_user_by_username(username).await;
        if !user_resp.is_success() {
            // return the same error as a non-existent user to avoid user enumeration
            return bad_request("passkey authentication failed");
        }
        let user = user_resp.data.unwrap();
        let identity_id = match haruspex_bridge::ensure_identity_for_user(
            &identities,
            &user.id,
            &user.username,
            now,
        )
        .await
        {
            Ok(id) => id,
            Err(e) => return internal_error(&format!("failed to prepare identity: {}", e)),
        };
        Some((identity_id, user.username))
    } else {
        None
    };

    let ceremony = WebauthnCeremony {
        rp_id: &rp_id,
        rp_name: "freqhole",
        credentials: &credentials,
        challenges: &challenges,
        identities: &identities,
    };

    let (rcr, nonce) = match ceremony
        .login_start(
            &req.origin,
            targeted_identity
                .as_ref()
                .map(|(id, name)| (*id, name.as_str())),
            now,
            webauthn_challenge_ttl_secs(),
        )
        .await
    {
        Ok(r) => r,
        Err(e) => return webauthn_error_response(e),
    };

    GrimoireResponse::success(
        "authentication challenge created",
        json!({ "nonce": nonce, "challenge": rcr }),
    )
}

/// finish passkey authentication over p2p
///
/// path: POST /api/auth/webauthn/login/finish
///
/// handles both the targeted and discoverable challenge flows transparently
/// (the ceremony tries both challenge kinds under the same nonce). on
/// success, the connecting node_id is linked to the authenticated user so
/// subsequent p2p requests from that node are auto-authenticated by node_id lookup.
#[cfg(feature = "webauthn")]
pub async fn login_finish(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    use crate::users::{haruspex_bridge, UserService};
    use haruspex::webauthn::WebauthnCeremony;

    let req: P2pLoginFinishRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_request(&format!("invalid request body: {}", e)),
    };

    let rp_id = match validate_origin_and_get_rp_id(&req.origin) {
        Ok(id) => id,
        Err(e) => return e,
    };

    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let (credentials, challenges, identities) = match haruspex_webauthn_stores().await {
        Ok(stores) => stores,
        Err(e) => return e,
    };

    let ceremony = WebauthnCeremony {
        rp_id: &rp_id,
        rp_name: "freqhole",
        credentials: &credentials,
        challenges: &challenges,
        identities: &identities,
    };

    let outcome = match ceremony
        .login_finish(
            &req.origin,
            &req.nonce,
            req.credential,
            req.node_id.as_deref(),
            now,
        )
        .await
    {
        Ok(o) => o,
        Err(e) => return webauthn_error_response(e),
    };

    let user_id = match haruspex_bridge::grimoire_user_id_for_identity(
        &identities,
        outcome.identity_id,
    )
    .await
    {
        Ok(Some(id)) => id,
        Ok(None) => return internal_error("identity is missing its linked grimoire user"),
        Err(e) => return internal_error(&format!("failed to resolve user: {}", e)),
    };

    let user_service = UserService::new();

    // link node_id to the grimoire user (this is the key p2p auth payoff:
    // subsequent requests from this node are auto-authenticated without a
    // passkey; see register_finish's comment on haruspex's own device_nodez
    // table being updated separately by the ceremony above)
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
