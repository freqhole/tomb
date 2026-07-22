//! webauthn ceremony orchestration for the http transport.
//!
//! drives the same `haruspex::webauthn::WebauthnCeremony` ceremony the p2p
//! transport uses (see `crate::offal::auth::webauthn_p2p`), adapted for a
//! caller that already has a cookie session to carry the ceremony's nonce
//! across the start/finish round trip and has no node_id concept at all
//! (node linking is a p2p/knock idea - passkeys registered over http are
//! never tied to a node). the invite-code / account-link / existing-user
//! resolution logic mirrors the p2p transport's exactly, minus the node_id
//! branch.
//!
//! callers own the http-specific concerns entirely: reading/writing the
//! session, picking the request/response json shapes, and validating the
//! request's origin against `allowed_origins` (the caller does this via its
//! own origin-validation middleware, so this module only needs to derive
//! `rp_id` from an already-trusted origin).

use serde_json::Value as JsonValue;
use thiserror::Error;
use uuid::Uuid;

use crate::users::models::User;

/// errors from the http-facing webauthn ceremony wrapper. mirrors the
/// vague-on-purpose error surface used by the p2p transport: failed
/// lookups and invalid/expired nonces are folded into the same messages so
/// a client can't use them to enumerate usernames or probe server state.
#[derive(Debug, Error)]
pub enum WebauthnCeremonyError {
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Internal(String),
}

/// the response body for a register_start call: the raw creation
/// challenge (serialized exactly as webauthn-rs produced it, for
/// `navigator.credentials.create()`) plus the nonce the caller must carry
/// to register_finish.
pub struct RegisterStartResult {
    pub challenge: JsonValue,
    pub nonce: String,
}

/// the response body for a login_start call: the raw request challenge
/// (for `navigator.credentials.get()`) plus the nonce the caller must
/// carry to login_finish.
pub struct LoginStartResult {
    pub challenge: JsonValue,
    pub nonce: String,
}

/// start passkey registration: resolves the identity the new passkey will
/// belong to (via an invite code, or a brand-new registration if none is
/// given), then starts the ceremony and returns its challenge plus the
/// nonce to carry to `register_finish`.
#[cfg(feature = "webauthn")]
pub async fn register_start(
    origin: &str,
    username: &str,
    invite_code: Option<&str>,
) -> Result<RegisterStartResult, WebauthnCeremonyError> {
    use crate::users::{haruspex_bridge, UserService};
    use haruspex::webauthn::{RegisterStartArgs, WebauthnCeremony};

    let rp_id = crate::config::extract_rp_id(origin)
        .ok_or_else(|| WebauthnCeremonyError::Internal("invalid origin url".to_string()))?;

    let user_service = UserService::new();
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let (credentials, challenges, identities) = haruspex_webauthn_stores().await?;

    let (identity_id, is_account_link) = if let Some(code) = invite_code {
        let code_response = user_service.check_invite_code(code).await;
        if !code_response.is_success() {
            return Err(WebauthnCeremonyError::BadRequest(
                "invalid invite code".to_string(),
            ));
        }
        let invite = code_response.data.unwrap();
        if invite.is_account_link_code() {
            let target_user_id = invite
                .get_target_user_id()
                .ok_or_else(|| {
                    WebauthnCeremonyError::BadRequest("invalid invite code".to_string())
                })?
                .to_string();
            let user_resp = user_service.get_user(&target_user_id).await;
            if !user_resp.is_success() {
                return Err(WebauthnCeremonyError::BadRequest(
                    "invalid invite code".to_string(),
                ));
            }
            let user = user_resp.data.unwrap();
            if user.username != username {
                return Err(WebauthnCeremonyError::BadRequest(format!(
                    "username '{}' does not match account-link target user '{}'",
                    username, user.username
                )));
            }
            let id = haruspex_bridge::ensure_identity_for_user(
                &identities,
                &user.id,
                &user.username,
                now,
            )
            .await
            .map_err(|e| {
                WebauthnCeremonyError::Internal(format!("failed to prepare identity: {}", e))
            })?;
            (id, true)
        } else {
            let id = ensure_pending_identity_for_new_registration(
                &user_service,
                &identities,
                username,
                now,
            )
            .await?;
            (id, false)
        }
    } else {
        let id =
            ensure_pending_identity_for_new_registration(&user_service, &identities, username, now)
                .await?;
        (id, false)
    };

    let ceremony = WebauthnCeremony {
        rp_id: &rp_id,
        rp_name: "freqhole",
        credentials: &credentials,
        challenges: &challenges,
        identities: &identities,
    };

    let (ccr, nonce) = ceremony
        .register_start(
            origin,
            RegisterStartArgs {
                identity_id,
                username,
                is_account_link,
                invite_code,
                now,
                challenge_ttl_secs: webauthn_challenge_ttl_secs(),
            },
        )
        .await
        .map_err(map_webauthn_error)?;

    let challenge = serde_json::to_value(&ccr).map_err(|e| {
        WebauthnCeremonyError::Internal(format!("failed to serialize challenge: {}", e))
    })?;

    Ok(RegisterStartResult { challenge, nonce })
}

/// finish passkey registration: verifies the credential against the
/// challenge named by `nonce`, resolves or creates the grimoire user the
/// passkey belongs to, and returns that user.
#[cfg(feature = "webauthn")]
pub async fn register_finish(
    origin: &str,
    nonce: &str,
    credential: JsonValue,
) -> Result<User, WebauthnCeremonyError> {
    use crate::users::{haruspex_bridge, CreateUserRequest, UserService};
    use haruspex::stores::IdentityStore;
    use haruspex::webauthn::WebauthnCeremony;

    let rp_id = crate::config::extract_rp_id(origin)
        .ok_or_else(|| WebauthnCeremonyError::Internal("invalid origin url".to_string()))?;

    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let (credentials, challenges, identities) = haruspex_webauthn_stores().await?;

    let ceremony = WebauthnCeremony {
        rp_id: &rp_id,
        rp_name: "freqhole",
        credentials: &credentials,
        challenges: &challenges,
        identities: &identities,
    };

    let outcome = ceremony
        .register_finish(origin, nonce, credential, None, now)
        .await
        .map_err(map_webauthn_error)?;

    let identity_id = outcome.credential.identity_id;
    let username = match identities.get_identity(identity_id).await {
        Ok(Some(identity)) => identity.username.unwrap_or_default(),
        Ok(None) => {
            return Err(WebauthnCeremonyError::Internal(
                "identity vanished mid-ceremony".to_string(),
            ))
        }
        Err(e) => {
            return Err(WebauthnCeremonyError::Internal(format!(
                "failed to load identity: {}",
                e
            )))
        }
    };

    let user_service = UserService::new();

    let user_id = if outcome.is_account_link {
        let user_id =
            match haruspex_bridge::grimoire_user_id_for_identity(&identities, identity_id).await {
                Ok(Some(id)) => id,
                Ok(None) => {
                    return Err(WebauthnCeremonyError::Internal(
                        "identity is missing its linked grimoire user".to_string(),
                    ))
                }
                Err(e) => {
                    return Err(WebauthnCeremonyError::Internal(format!(
                        "failed to resolve user: {}",
                        e
                    )))
                }
            };
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
            return Err(WebauthnCeremonyError::BadRequest(detail));
        }
        let user = user_resp
            .data
            .ok_or_else(|| WebauthnCeremonyError::Internal("failed to create user".to_string()))?;
        haruspex_bridge::link_identity_to_grimoire_user(&identities, identity_id, &user.id)
            .await
            .map_err(|e| {
                WebauthnCeremonyError::Internal(format!("failed to link identity: {}", e))
            })?;
        user.id
    };

    user_service
        .get_user(&user_id)
        .await
        .data
        .ok_or_else(|| WebauthnCeremonyError::Internal("failed to load user".to_string()))
}

/// start passkey authentication. `username` selects the targeted flow
/// (challenge scoped to that user's own credentials); `None` (or empty)
/// selects the discoverable flow, where the identity is resolved from the
/// credential itself in `login_finish`.
#[cfg(feature = "webauthn")]
pub async fn login_start(
    origin: &str,
    username: Option<&str>,
) -> Result<LoginStartResult, WebauthnCeremonyError> {
    use crate::users::{haruspex_bridge, UserService};
    use haruspex::webauthn::WebauthnCeremony;

    let rp_id = crate::config::extract_rp_id(origin)
        .ok_or_else(|| WebauthnCeremonyError::Internal("invalid origin url".to_string()))?;

    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let (credentials, challenges, identities) = haruspex_webauthn_stores().await?;

    let username = username.filter(|s| !s.is_empty());

    let targeted_identity = if let Some(username) = username {
        let user_service = UserService::new();
        let user_resp = user_service.get_user_by_username(username).await;
        if !user_resp.is_success() {
            // same error as "no credentials for this user" - never reveal
            // whether the username exists.
            return Err(WebauthnCeremonyError::BadRequest(
                "passkey authentication failed".to_string(),
            ));
        }
        let user = user_resp.data.unwrap();
        let identity_id =
            haruspex_bridge::ensure_identity_for_user(&identities, &user.id, &user.username, now)
                .await
                .map_err(|e| {
                    WebauthnCeremonyError::Internal(format!("failed to prepare identity: {}", e))
                })?;
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

    let (rcr, nonce) = ceremony
        .login_start(
            origin,
            targeted_identity
                .as_ref()
                .map(|(id, name)| (*id, name.as_str())),
            now,
            webauthn_challenge_ttl_secs(),
        )
        .await
        .map_err(map_webauthn_error)?;

    let challenge = serde_json::to_value(&rcr).map_err(|e| {
        WebauthnCeremonyError::Internal(format!("failed to serialize challenge: {}", e))
    })?;

    Ok(LoginStartResult { challenge, nonce })
}

/// finish passkey authentication, handling both the targeted and
/// discoverable challenge flows transparently (the ceremony itself tries
/// both challenge kinds under the same nonce), and returns the
/// authenticated grimoire user.
#[cfg(feature = "webauthn")]
pub async fn login_finish(
    origin: &str,
    nonce: &str,
    credential: JsonValue,
) -> Result<User, WebauthnCeremonyError> {
    use crate::users::{haruspex_bridge, UserService};
    use haruspex::webauthn::WebauthnCeremony;

    let rp_id = crate::config::extract_rp_id(origin)
        .ok_or_else(|| WebauthnCeremonyError::Internal("invalid origin url".to_string()))?;

    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let (credentials, challenges, identities) = haruspex_webauthn_stores().await?;

    let ceremony = WebauthnCeremony {
        rp_id: &rp_id,
        rp_name: "freqhole",
        credentials: &credentials,
        challenges: &challenges,
        identities: &identities,
    };

    let outcome = ceremony
        .login_finish(origin, nonce, credential, None, now)
        .await
        .map_err(map_webauthn_error)?;

    let user_id = match haruspex_bridge::grimoire_user_id_for_identity(
        &identities,
        outcome.identity_id,
    )
    .await
    {
        Ok(Some(id)) => id,
        Ok(None) => {
            return Err(WebauthnCeremonyError::Internal(
                "identity is missing its linked grimoire user".to_string(),
            ))
        }
        Err(e) => {
            return Err(WebauthnCeremonyError::Internal(format!(
                "failed to resolve user: {}",
                e
            )))
        }
    };

    UserService::new()
        .get_user(&user_id)
        .await
        .data
        .ok_or_else(|| WebauthnCeremonyError::Internal("no user data".to_string()))
}

/// resolves the identity a brand-new (no account-link) registration will
/// use: the username must be free, and the identity is created "pending"
/// (no linked grimoire user yet, since grimoire only assigns a real user
/// id once the ceremony finishes - see `register_finish`).
#[cfg(feature = "webauthn")]
async fn ensure_pending_identity_for_new_registration(
    user_service: &crate::users::UserService,
    identities: &dyn haruspex::stores::IdentityStore,
    username: &str,
    now: i64,
) -> Result<Uuid, WebauthnCeremonyError> {
    use crate::users::haruspex_bridge;

    let existing = user_service.get_user_by_username(username).await;
    if existing.is_success() {
        return Err(WebauthnCeremonyError::BadRequest(
            "username already exists".to_string(),
        ));
    }
    let id = Uuid::new_v4();
    haruspex_bridge::create_pending_identity(identities, id, username, now)
        .await
        .map_err(|e| {
            WebauthnCeremonyError::Internal(format!("failed to prepare identity: {}", e))
        })?;
    Ok(id)
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
    WebauthnCeremonyError,
> {
    let pool = crate::database::connect_haruspex().await.map_err(|e| {
        WebauthnCeremonyError::Internal(format!("failed to open auth store: {}", e))
    })?;
    Ok((
        haruspex::sqlite::SqliteCredentialStore::new(pool.clone()),
        haruspex::sqlite::SqliteChallengeStore::new(pool.clone()),
        haruspex::sqlite::SqliteIdentityStore::new(pool),
    ))
}

/// the challenge ttl, in seconds, from config (default 15 minutes) - the
/// same setting the p2p transport's ceremony uses.
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

/// map a haruspex ceremony error to this module's error type. failed
/// lookups and expired/invalid nonces are kept indistinguishable from each
/// other on purpose, to avoid leaking which case occurred.
#[cfg(feature = "webauthn")]
fn map_webauthn_error(err: haruspex::webauthn::WebauthnError) -> WebauthnCeremonyError {
    use haruspex::webauthn::WebauthnError;
    match err {
        WebauthnError::InvalidChallenge => {
            WebauthnCeremonyError::BadRequest("invalid or expired nonce".to_string())
        }
        WebauthnError::NoCredentials | WebauthnError::AuthenticationFailed => {
            WebauthnCeremonyError::BadRequest("passkey authentication failed".to_string())
        }
        WebauthnError::InvalidCredential(msg) => {
            WebauthnCeremonyError::BadRequest(format!("invalid credential: {}", msg))
        }
        WebauthnError::Ceremony(msg) => {
            WebauthnCeremonyError::Internal(format!("webauthn ceremony failed: {}", msg))
        }
        WebauthnError::Store(e) => {
            WebauthnCeremonyError::Internal(format!("auth store error: {}", e))
        }
    }
}

#[cfg(not(feature = "webauthn"))]
pub async fn register_start(
    _origin: &str,
    _username: &str,
    _invite_code: Option<&str>,
) -> Result<RegisterStartResult, WebauthnCeremonyError> {
    Err(WebauthnCeremonyError::Internal(
        "server was built without webauthn support".to_string(),
    ))
}

#[cfg(not(feature = "webauthn"))]
pub async fn register_finish(
    _origin: &str,
    _nonce: &str,
    _credential: JsonValue,
) -> Result<User, WebauthnCeremonyError> {
    Err(WebauthnCeremonyError::Internal(
        "server was built without webauthn support".to_string(),
    ))
}

#[cfg(not(feature = "webauthn"))]
pub async fn login_start(
    _origin: &str,
    _username: Option<&str>,
) -> Result<LoginStartResult, WebauthnCeremonyError> {
    Err(WebauthnCeremonyError::Internal(
        "server was built without webauthn support".to_string(),
    ))
}

#[cfg(not(feature = "webauthn"))]
pub async fn login_finish(
    _origin: &str,
    _nonce: &str,
    _credential: JsonValue,
) -> Result<User, WebauthnCeremonyError> {
    Err(WebauthnCeremonyError::Internal(
        "server was built without webauthn support".to_string(),
    ))
}

// ============================================================================
// credential-compatibility proof: a passkey registered by building a raw
// webauthn-rs ceremony directly (the exact approach the http transport used
// before it adopted haruspex's `WebauthnCeremony`, with no haruspex
// involvement at all) must still authenticate through the ceremony above.
// this is the load-bearing claim of the whole cutover: existing passkeys
// don't need re-registration.
// ============================================================================

#[cfg(all(test, feature = "webauthn"))]
mod credential_compat_tests {
    use openssl::bn::BigNumContext;
    use openssl::ec::{EcGroup, EcKey, PointConversionForm};
    use openssl::hash::{hash, MessageDigest};
    use openssl::nid::Nid;
    use openssl::pkey::{PKey, Private};
    use openssl::sign::Signer;
    use serde_json::Value as JsonValue;
    use webauthn_rs::prelude::{RegisterPublicKeyCredential, Url, WebauthnBuilder};

    use haruspex::stores::{Credential, CredentialStore};
    use haruspex::webauthn::WebauthnCeremony;

    const RP_ID: &str = "localhost";
    const RP_NAME: &str = "freqhole";
    const ORIGIN: &str = "https://localhost:8443";

    /// a minimal but real software webauthn authenticator: one p-256
    /// keypair plus a credential id and sign counter. registers using the
    /// "none" attestation format (an empty attestation statement, so
    /// registration needs no signature at all) and authenticates with a
    /// real ecdsa signature over the authenticator data and client data
    /// hash, exactly as a platform authenticator would.
    struct SoftwareAuthenticator {
        key: EcKey<Private>,
        credential_id: Vec<u8>,
        sign_count: u32,
    }

    impl SoftwareAuthenticator {
        fn new(credential_id: Vec<u8>) -> Self {
            let group = EcGroup::from_curve_name(Nid::X9_62_PRIME256V1).expect("p-256 group");
            let key = EcKey::generate(&group).expect("generate p-256 keypair");
            Self {
                key,
                credential_id,
                sign_count: 0,
            }
        }

        fn public_key_xy(&self) -> (Vec<u8>, Vec<u8>) {
            let group = EcGroup::from_curve_name(Nid::X9_62_PRIME256V1).expect("p-256 group");
            let mut ctx = BigNumContext::new().expect("bignum context");
            let point_bytes = self
                .key
                .public_key()
                .to_bytes(&group, PointConversionForm::UNCOMPRESSED, &mut ctx)
                .expect("encode public key point");
            // uncompressed SEC1 point: 0x04 || x (32 bytes) || y (32 bytes).
            (point_bytes[1..33].to_vec(), point_bytes[33..65].to_vec())
        }

        /// completes a registration ceremony for `challenge_b64` (the
        /// base64url challenge exactly as it appears in the creation
        /// challenge response), producing the wire-shaped credential json a
        /// `RegisterPublicKeyCredential` deserializes from.
        fn register(&self, challenge_b64: &str, origin: &str) -> JsonValue {
            let client_data_json = serde_json::to_vec(&serde_json::json!({
                "type": "webauthn.create",
                "challenge": challenge_b64,
                "origin": origin,
            }))
            .expect("serialize clientDataJSON");

            let rp_id_hash = hash(MessageDigest::sha256(), RP_ID.as_bytes())
                .expect("hash rp id")
                .to_vec();
            let (x, y) = self.public_key_xy();
            let cose_key = cbor_cose_ec2_key(&x, &y);

            let mut auth_data = Vec::new();
            auth_data.extend_from_slice(&rp_id_hash);
            auth_data.push(0x45); // flags: user present | user verified | attested credential data
            auth_data.extend_from_slice(&0u32.to_be_bytes()); // sign count
            auth_data.extend_from_slice(&[0u8; 16]); // aaguid: no attestation, all-zero
            auth_data.extend_from_slice(&(self.credential_id.len() as u16).to_be_bytes());
            auth_data.extend_from_slice(&self.credential_id);
            auth_data.extend_from_slice(&cose_key);

            let attestation_object = cbor_attestation_object_none(&auth_data);

            serde_json::json!({
                "id": base64url(&self.credential_id),
                "rawId": base64url(&self.credential_id),
                "response": {
                    "attestationObject": base64url(&attestation_object),
                    "clientDataJSON": base64url(&client_data_json),
                },
                "type": "public-key",
            })
        }

        /// completes an authentication ceremony for `challenge_b64`,
        /// signing a real ecdsa assertion with this authenticator's own
        /// private key.
        fn authenticate(&mut self, challenge_b64: &str, origin: &str) -> JsonValue {
            self.sign_count += 1;

            let client_data_json = serde_json::to_vec(&serde_json::json!({
                "type": "webauthn.get",
                "challenge": challenge_b64,
                "origin": origin,
            }))
            .expect("serialize clientDataJSON");
            let client_data_hash = hash(MessageDigest::sha256(), &client_data_json)
                .expect("hash clientDataJSON")
                .to_vec();

            let rp_id_hash = hash(MessageDigest::sha256(), RP_ID.as_bytes())
                .expect("hash rp id")
                .to_vec();
            let mut auth_data = Vec::new();
            auth_data.extend_from_slice(&rp_id_hash);
            auth_data.push(0x05); // flags: user present | user verified, no attested credential data
            auth_data.extend_from_slice(&self.sign_count.to_be_bytes());

            let mut signed_over = auth_data.clone();
            signed_over.extend_from_slice(&client_data_hash);

            let pkey = PKey::from_ec_key(self.key.clone()).expect("wrap ec key in pkey");
            let mut signer = Signer::new(MessageDigest::sha256(), &pkey).expect("build signer");
            let signature = signer
                .sign_oneshot_to_vec(&signed_over)
                .expect("sign assertion");

            serde_json::json!({
                "id": base64url(&self.credential_id),
                "rawId": base64url(&self.credential_id),
                "response": {
                    "authenticatorData": base64url(&auth_data),
                    "clientDataJSON": base64url(&client_data_json),
                    "signature": base64url(&signature),
                    "userHandle": null,
                },
                "type": "public-key",
            })
        }
    }

    /// url-safe, unpadded base64 - the encoding every webauthn json field
    /// on the wire uses (RFC 4648 section 5).
    fn base64url(bytes: &[u8]) -> String {
        const ALPHABET: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
        for chunk in bytes.chunks(3) {
            let b0 = chunk[0];
            let b1 = *chunk.get(1).unwrap_or(&0);
            let b2 = *chunk.get(2).unwrap_or(&0);
            let n = (u32::from(b0) << 16) | (u32::from(b1) << 8) | u32::from(b2);
            out.push(ALPHABET[((n >> 18) & 0x3f) as usize] as char);
            out.push(ALPHABET[((n >> 12) & 0x3f) as usize] as char);
            if chunk.len() > 1 {
                out.push(ALPHABET[((n >> 6) & 0x3f) as usize] as char);
            }
            if chunk.len() > 2 {
                out.push(ALPHABET[(n & 0x3f) as usize] as char);
            }
        }
        out
    }

    /// a short cbor text string (major type 3) - every key this file needs
    /// ("fmt", "none", "attStmt", "authData") fits in the 1-byte-header
    /// form.
    fn cbor_text(s: &str) -> Vec<u8> {
        let bytes = s.as_bytes();
        assert!(bytes.len() <= 23, "cbor_text only supports short strings");
        let mut out = Vec::with_capacity(bytes.len() + 1);
        out.push(0x60 | bytes.len() as u8);
        out.extend_from_slice(bytes);
        out
    }

    /// a cbor byte string (major type 2) - every byte string this file
    /// builds (cose key coordinates, authData) fits comfortably under 256
    /// bytes.
    fn cbor_bytestring(bytes: &[u8]) -> Vec<u8> {
        let len = bytes.len();
        let mut out = Vec::with_capacity(len + 3);
        if len <= 23 {
            out.push(0x40 | len as u8);
        } else {
            assert!(len <= 255, "cbor_bytestring only supports up to 255 bytes");
            out.push(0x58);
            out.push(len as u8);
        }
        out.extend_from_slice(bytes);
        out
    }

    /// canonical cbor encoding of an es256 cose ec2 public key from raw
    /// (x, y) coordinates - the exact shape `attestedCredentialData` embeds
    /// inline (cose_key map: kty=ec2(2), alg=es256(-7), crv=p-256(1), x, y).
    fn cbor_cose_ec2_key(x: &[u8], y: &[u8]) -> Vec<u8> {
        let mut out = vec![0xa5]; // map, 5 pairs
        out.push(0x01); // key: kty (1)
        out.push(0x02); // value: EC2 (2)
        out.push(0x03); // key: alg (3)
        out.push(0x26); // value: -7 (ES256) -> major type 1, n=6
        out.push(0x20); // key: -1 (crv) -> major type 1, n=0
        out.push(0x01); // value: 1 (P-256)
        out.push(0x21); // key: -2 (x) -> major type 1, n=1
        out.extend(cbor_bytestring(x));
        out.push(0x22); // key: -3 (y) -> major type 1, n=2
        out.extend(cbor_bytestring(y));
        out
    }

    /// the "none" attestation format's cbor attestation object: an empty
    /// attestation statement, so registration succeeds on `authData`'s
    /// integrity alone with no attestation signature to verify.
    fn cbor_attestation_object_none(auth_data: &[u8]) -> Vec<u8> {
        let mut out = vec![0xa3]; // map, 3 pairs
        out.extend(cbor_text("fmt"));
        out.extend(cbor_text("none"));
        out.extend(cbor_text("attStmt"));
        out.push(0xa0); // empty map
        out.extend(cbor_text("authData"));
        out.extend(cbor_bytestring(auth_data));
        out
    }

    /// pulls `publicKey.challenge` back out of a serialized creation/request
    /// challenge response, exactly as a browser's `navigator.credentials`
    /// call would read it off the object handed to it.
    fn extract_challenge(response: &JsonValue) -> String {
        response["publicKey"]["challenge"]
            .as_str()
            .expect("response carries a publicKey.challenge string")
            .to_string()
    }

    /// sets up an isolated grimoire instance (its own tempdir, its own
    /// haruspex.db) and returns the three ceremony stores. touches the
    /// process-wide config/pool singletons, so callers must be run in their
    /// own process - see the test's own `#[ignore]`.
    async fn isolated_haruspex_stores() -> (
        haruspex::sqlite::SqliteCredentialStore,
        haruspex::sqlite::SqliteChallengeStore,
        haruspex::sqlite::SqliteIdentityStore,
        tempfile::TempDir,
    ) {
        let tmp = tempfile::tempdir().expect("tempdir");
        let data_dir = tmp.path();
        let config_toml = format!(
            r#"data_dir = "{data_dir}"

[database]
filename = "grimoire.db"

[media]
max_fs_file_size = 104857600
supported_audio_formats = ["mp3", "flac"]

[musicbrainz]
enabled = false

[logging]
level = "warn"
"#,
            data_dir = data_dir.display()
        );
        let config_path = data_dir.join("freqhole-config.toml");
        std::fs::write(&config_path, config_toml).expect("write config");
        crate::config::init_config(Some(config_path)).expect("init config");

        let pool = crate::database::connect_haruspex()
            .await
            .expect("open haruspex pool");
        (
            haruspex::sqlite::SqliteCredentialStore::new(pool.clone()),
            haruspex::sqlite::SqliteChallengeStore::new(pool.clone()),
            haruspex::sqlite::SqliteIdentityStore::new(pool),
            tmp,
        )
    }

    // run individually (touches process-wide config/pool singletons):
    // cargo test -p grimoire --lib -- --ignored --exact users::webauthn_ceremony::credential_compat_tests::credential_registered_via_raw_webauthn_rs_authenticates_through_the_new_ceremony
    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn credential_registered_via_raw_webauthn_rs_authenticates_through_the_new_ceremony() {
        let (credentials, challenges, identities, _tmp) = isolated_haruspex_stores().await;

        // step 1: register a passkey the way the http transport did before
        // it adopted `WebauthnCeremony` - a bare `webauthn_rs::Webauthn`
        // built directly, no haruspex store involved at all.
        let rp_origin = Url::parse(ORIGIN).expect("parse origin");
        let webauthn = WebauthnBuilder::new(RP_ID, &rp_origin)
            .expect("build webauthn builder")
            .rp_name(RP_NAME)
            .build()
            .expect("build webauthn");

        let user_unique_id = uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_URL, b"old-flow-user-id");
        let (ccr, reg_state) = webauthn
            .start_passkey_registration(user_unique_id, "old-flow-user", "old-flow-user", None)
            .expect("start_passkey_registration");

        let mut authenticator = SoftwareAuthenticator::new(vec![0xAA; 16]);
        let ccr_json = serde_json::to_value(&ccr).expect("serialize creation challenge");
        let reg_credential_json = authenticator.register(&extract_challenge(&ccr_json), ORIGIN);
        let reg_credential: RegisterPublicKeyCredential =
            serde_json::from_value(reg_credential_json).expect("deserialize credential json");

        let passkey = webauthn
            .finish_passkey_registration(&reg_credential, &reg_state)
            .expect("finish_passkey_registration");

        // step 2: persist the resulting passkey exactly the way
        // `WebauthnCeremony::register_finish` (and the old
        // `WebAuthnService::save_credential`) do - same identity/credential
        // linkage, same `serde_json::to_value(&passkey)` serialization.
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        let identity_id = crate::users::haruspex_bridge::ensure_identity_for_user(
            &identities,
            "old-flow-user-id",
            "old-flow-user",
            now,
        )
        .await
        .expect("create identity for the migrated credential");

        let credential_data = serde_json::to_value(&passkey).expect("serialize passkey");
        credentials
            .add_credential(Credential {
                id: String::new(),
                identity_id,
                credential_id: passkey.cred_id().as_ref().to_vec(),
                credential_data,
                name: None,
                created_at: now,
                last_used_at: None,
                deleted_at: None,
            })
            .await
            .expect("store credential the old flow produced");

        // step 3: authenticate against that stored credential through the
        // NEW ceremony, with the same physical authenticator signing a
        // fresh assertion. `login_finish` performs a real ecdsa signature
        // verification (webauthn-rs's own), not a stubbed check.
        let ceremony = WebauthnCeremony {
            rp_id: RP_ID,
            rp_name: RP_NAME,
            credentials: &credentials,
            challenges: &challenges,
            identities: &identities,
        };

        let (rcr, nonce) = ceremony
            .login_start(ORIGIN, Some((identity_id, "old-flow-user")), now, 900)
            .await
            .expect("login_start");
        let rcr_json = serde_json::to_value(&rcr).expect("serialize request challenge");
        let assertion = authenticator.authenticate(&extract_challenge(&rcr_json), ORIGIN);

        let outcome = ceremony
            .login_finish(ORIGIN, &nonce, assertion, None, now + 1)
            .await
            .expect(
                "a credential registered via raw webauthn-rs (the old http flow) must \
                 authenticate through the new haruspex-backed ceremony with no migration step",
            );

        assert_eq!(outcome.identity_id, identity_id);
    }
}
