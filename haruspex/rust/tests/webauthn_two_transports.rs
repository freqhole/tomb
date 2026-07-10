//! one webauthn ceremony, driven through two different transport shims -
//! proving `WebauthnCeremony` + `ChallengeStore` need no transport-specific
//! branching to support both an http-style cookie session and a p2p-style
//! explicit nonce.
//!
//! an integration test rather than an example: completing a real ceremony
//! needs a signed credential response, which normally only a browser's
//! platform authenticator can produce. this file includes a minimal
//! software authenticator (real p-256 keygen, sha-256 hashing, ecdsa
//! signing, hand-written cbor for the small fixed-shape "none" attestation
//! object) so the ceremony can be driven to completion without one - see
//! `haruspex::webauthn::tests` for this crate's other webauthn coverage,
//! which stops at the plumbing layer instead.
//!
//! the two shims:
//!
//! - [`StatefulSession`]: the nonce lives in server-side session state (the
//!   caller never sees or threads it) - mimics an http cookie-session flow.
//! - [`ExplicitNonceTransport`]: the nonce must be threaded explicitly by
//!   the caller across the start/finish boundary - mimics a p2p flow where
//!   there is no cookie jar to lean on.
//!
//! both wrap the exact same `WebauthnCeremony` + `ChallengeStore` - this
//! crate's ceremony api already returns/accepts the challenge nonce as a
//! plain string, so no library change was needed to make both shims work;
//! this file exists to prove that design choice really does hold up.

use openssl::bn::BigNumContext;
use openssl::ec::{EcGroup, EcKey, PointConversionForm};
use openssl::hash::{hash, MessageDigest};
use openssl::nid::Nid;
use openssl::pkey::{PKey, Private};
use openssl::sign::Signer;
use serde_json::Value as JsonValue;
use uuid::Uuid;

use haruspex::identity::Identity;
use haruspex::sqlite::{SqliteChallengeStore, SqliteCredentialStore, SqliteIdentityStore};
use haruspex::stores::IdentityStore as _;
use haruspex::testing::open_in_memory;
use haruspex::webauthn::{
    LoginFinishOutcome, RegisterFinishOutcome, RegisterStartArgs, WebauthnCeremony, WebauthnError,
};

const RP_ID: &str = "localhost";
const RP_NAME: &str = "freqhole test";
const ORIGIN: &str = "https://localhost:8443";

// ---- minimal software authenticator ------------------------------------

/// a real (but minimal) software webauthn authenticator: one p-256
/// keypair plus a credential id and a sign counter. registers using the
/// "none" attestation format (an empty attestation statement - no
/// signature to produce, so registration needs no signing at all), and
/// authenticates with a real ecdsa signature over the authenticator data
/// and client data hash, exactly as a real platform authenticator would.
struct SoftwareAuthenticator {
    key: EcKey<Private>,
    credential_id: Vec<u8>,
    sign_count: u32,
}

impl SoftwareAuthenticator {
    fn new(credential_id: Vec<u8>) -> Self {
        let group = EcGroup::from_curve_name(Nid::X9_62_PRIME256V1).expect("p-256 curve group");
        let key = EcKey::generate(&group).expect("generate p-256 keypair");
        Self {
            key,
            credential_id,
            sign_count: 0,
        }
    }

    /// swap in a different credential id while keeping the same keypair -
    /// `credentialz.credential_id` is globally unique, so registering a
    /// second identity with this same authenticator needs a fresh one.
    fn set_credential_id(&mut self, credential_id: Vec<u8>) {
        self.credential_id = credential_id;
    }

    fn public_key_xy(&self) -> (Vec<u8>, Vec<u8>) {
        let group = EcGroup::from_curve_name(Nid::X9_62_PRIME256V1).expect("p-256 curve group");
        let mut ctx = BigNumContext::new().expect("bignum context");
        let point_bytes = self
            .key
            .public_key()
            .to_bytes(&group, PointConversionForm::UNCOMPRESSED, &mut ctx)
            .expect("encode public key point");
        // uncompressed SEC1 point: 0x04 || x (32 bytes) || y (32 bytes).
        (point_bytes[1..33].to_vec(), point_bytes[33..65].to_vec())
    }

    /// completes a registration ceremony for `challenge_b64` (the base64url
    /// challenge exactly as it appears in the `CreationChallengeResponse`
    /// the caller received), producing the wire-shaped credential json
    /// `WebauthnCeremony::register_finish` expects.
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
        auth_data.extend_from_slice(&[0u8; 16]); // aaguid: no attestation, so all-zero
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

    /// completes an authentication ceremony for `challenge_b64`, signing a
    /// real ecdsa assertion over the authenticator data + client data hash
    /// with this authenticator's own private key.
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

/// url-safe, unpadded base64 - the encoding every webauthn json field on
/// the wire uses (RFC 4648 section 5).
fn base64url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
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
/// ("fmt", "none", "attStmt", "authData") fits in the 1-byte-header form.
fn cbor_text(s: &str) -> Vec<u8> {
    let bytes = s.as_bytes();
    assert!(bytes.len() <= 23, "cbor_text only supports short strings");
    let mut out = Vec::with_capacity(bytes.len() + 1);
    out.push(0x60 | bytes.len() as u8);
    out.extend_from_slice(bytes);
    out
}

/// a cbor byte string (major type 2), 1-byte or 1-byte-length-prefixed
/// form - every byte string this file builds (cose key coordinates,
/// authData) fits comfortably under 256 bytes.
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

/// canonical cbor encoding of an es256 cose ec2 public key from raw (x, y)
/// coordinates - the exact shape `attestedCredentialData` embeds inline
/// (cose_key map: kty=ec2(2), alg=es256(-7), crv=p-256(1), x, y).
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
/// integrity alone with no attestation signature to verify at all - the
/// same format many real platform authenticators use once attestation is
/// stripped for privacy.
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

// ---- transport shims -----------------------------------------------------

/// mimics an http cookie-session flow: the ceremony's nonce is carried in
/// server-side session state, indexed only by whatever the browser's
/// cookie points at - the caller never sees or threads the nonce itself.
#[derive(Default)]
struct StatefulSession {
    pending_nonce: Option<String>,
}

/// a stateful session's own error: either the underlying ceremony failed,
/// or this session was asked to finish a ceremony it never started (no
/// pending nonce to fall back on - never borrows another session's).
#[derive(Debug)]
enum SessionShimError {
    NoCeremonyInProgress,
    Ceremony(WebauthnError),
}

impl From<WebauthnError> for SessionShimError {
    fn from(err: WebauthnError) -> Self {
        SessionShimError::Ceremony(err)
    }
}

impl StatefulSession {
    fn new() -> Self {
        Self::default()
    }

    async fn start_registration(
        &mut self,
        ceremony: &WebauthnCeremony<'_>,
        origin: &str,
        args: RegisterStartArgs<'_>,
    ) -> JsonValue {
        let (ccr, nonce) = ceremony
            .register_start(origin, args)
            .await
            .expect("register_start");
        self.pending_nonce = Some(nonce);
        serde_json::to_value(&ccr).expect("serialize creation challenge response")
    }

    async fn finish_registration(
        &mut self,
        ceremony: &WebauthnCeremony<'_>,
        origin: &str,
        credential: JsonValue,
        now: i64,
    ) -> Result<RegisterFinishOutcome, SessionShimError> {
        let nonce = self
            .pending_nonce
            .take()
            .ok_or(SessionShimError::NoCeremonyInProgress)?;
        Ok(ceremony
            .register_finish(origin, &nonce, credential, None, now)
            .await?)
    }

    async fn start_authentication(
        &mut self,
        ceremony: &WebauthnCeremony<'_>,
        origin: &str,
        identity: Option<(Uuid, &str)>,
        now: i64,
        challenge_ttl_secs: i64,
    ) -> JsonValue {
        let (rcr, nonce) = ceremony
            .login_start(origin, identity, now, challenge_ttl_secs)
            .await
            .expect("login_start");
        self.pending_nonce = Some(nonce);
        serde_json::to_value(&rcr).expect("serialize request challenge response")
    }

    async fn finish_authentication(
        &mut self,
        ceremony: &WebauthnCeremony<'_>,
        origin: &str,
        credential: JsonValue,
        now: i64,
    ) -> Result<LoginFinishOutcome, SessionShimError> {
        let nonce = self
            .pending_nonce
            .take()
            .ok_or(SessionShimError::NoCeremonyInProgress)?;
        Ok(ceremony
            .login_finish(origin, &nonce, credential, None, now)
            .await?)
    }
}

/// mimics a p2p flow: the nonce must be threaded explicitly by the caller
/// across the start/finish boundary, riding along in whatever message
/// envelope the transport uses - there is no session state here at all,
/// which is the entire point of the comparison against `StatefulSession`.
struct ExplicitNonceTransport;

impl ExplicitNonceTransport {
    async fn start_registration(
        &self,
        ceremony: &WebauthnCeremony<'_>,
        origin: &str,
        args: RegisterStartArgs<'_>,
    ) -> (JsonValue, String) {
        let (ccr, nonce) = ceremony
            .register_start(origin, args)
            .await
            .expect("register_start");
        (
            serde_json::to_value(&ccr).expect("serialize creation challenge response"),
            nonce,
        )
    }

    async fn finish_registration(
        &self,
        ceremony: &WebauthnCeremony<'_>,
        origin: &str,
        nonce: &str,
        credential: JsonValue,
        now: i64,
    ) -> Result<RegisterFinishOutcome, WebauthnError> {
        ceremony
            .register_finish(origin, nonce, credential, None, now)
            .await
    }

    async fn start_authentication(
        &self,
        ceremony: &WebauthnCeremony<'_>,
        origin: &str,
        identity: Option<(Uuid, &str)>,
        now: i64,
        challenge_ttl_secs: i64,
    ) -> (JsonValue, String) {
        let (rcr, nonce) = ceremony
            .login_start(origin, identity, now, challenge_ttl_secs)
            .await
            .expect("login_start");
        (
            serde_json::to_value(&rcr).expect("serialize request challenge response"),
            nonce,
        )
    }

    async fn finish_authentication(
        &self,
        ceremony: &WebauthnCeremony<'_>,
        origin: &str,
        nonce: &str,
        credential: JsonValue,
        now: i64,
    ) -> Result<LoginFinishOutcome, WebauthnError> {
        ceremony
            .login_finish(origin, nonce, credential, None, now)
            .await
    }
}

// ---- test setup helpers ---------------------------------------------------

async fn ceremony_stores() -> (
    SqliteCredentialStore,
    SqliteChallengeStore,
    SqliteIdentityStore,
) {
    let pool = open_in_memory().await;
    (
        SqliteCredentialStore::new(pool.clone()),
        SqliteChallengeStore::new(pool.clone()),
        SqliteIdentityStore::new(pool),
    )
}

async fn seed_identity(identities: &SqliteIdentityStore, username: &str) -> Uuid {
    let id = Uuid::new_v4();
    identities
        .upsert_identity(Identity {
            id,
            username: Some(username.to_string()),
            created_at: 1_700_000_000,
            metadata: None,
            deleted_at: None,
        })
        .await
        .expect("seed identity");
    id
}

fn extract_challenge(response_json: &JsonValue) -> String {
    response_json["publicKey"]["challenge"]
        .as_str()
        .expect("response json carries a publicKey.challenge string")
        .to_string()
}

// ---- tests -----------------------------------------------------------------

#[tokio::test]
async fn same_credential_data_shape_round_trips_through_both_transport_shims() {
    let (credentials, challenges, identities) = ceremony_stores().await;
    let ceremony = WebauthnCeremony {
        rp_id: RP_ID,
        rp_name: RP_NAME,
        credentials: &credentials,
        challenges: &challenges,
        identities: &identities,
    };

    let identity_a = seed_identity(&identities, "alice").await;
    let identity_b = seed_identity(&identities, "bob").await;

    // the SAME simulated authenticator keypair drives both registrations -
    // only the credential id changes (credentialz.credential_id is
    // globally unique, so the same identity's authenticator can't reuse
    // one across two different identities). if the persisted
    // credential_data differs beyond that one expected field, something
    // about the transport - rather than the authenticator - leaked into
    // the stored shape.
    let mut authenticator = SoftwareAuthenticator::new(vec![0xAA; 16]);

    // -- stateful (http-like) shim --
    let mut session = StatefulSession::new();
    let ccr_json = session
        .start_registration(
            &ceremony,
            ORIGIN,
            RegisterStartArgs {
                identity_id: identity_a,
                username: "alice",
                is_account_link: false,
                invite_code: None,
                now: 1000,
                challenge_ttl_secs: 900,
            },
        )
        .await;
    let credential = authenticator.register(&extract_challenge(&ccr_json), ORIGIN);
    let outcome_a = session
        .finish_registration(&ceremony, ORIGIN, credential, 1001)
        .await
        .expect("stateful registration should succeed");

    // -- explicit-nonce (p2p-like) shim --
    authenticator.set_credential_id(vec![0xBB; 16]);
    let transport = ExplicitNonceTransport;
    let (rcr_json, nonce) = transport
        .start_registration(
            &ceremony,
            ORIGIN,
            RegisterStartArgs {
                identity_id: identity_b,
                username: "bob",
                is_account_link: false,
                invite_code: None,
                now: 1000,
                challenge_ttl_secs: 900,
            },
        )
        .await;
    let credential = authenticator.register(&extract_challenge(&rcr_json), ORIGIN);
    let outcome_b = transport
        .finish_registration(&ceremony, ORIGIN, &nonce, credential, 1001)
        .await
        .expect("explicit-nonce registration should succeed");

    // strip the necessarily-different credential id, then compare
    // everything else: same public key, same "none" attestation shape,
    // same counter/verification flags - proof the persisted encoding is
    // transport-independent.
    let mut data_a = outcome_a.credential.credential_data.clone();
    let mut data_b = outcome_b.credential.credential_data.clone();
    data_a["cred"]["cred_id"] = serde_json::Value::Null;
    data_b["cred"]["cred_id"] = serde_json::Value::Null;
    assert_eq!(
        data_a, data_b,
        "credential_data must be identical regardless of which transport shim drove the ceremony"
    );
}

#[tokio::test]
async fn same_credential_authenticates_through_both_transport_shims() {
    let (credentials, challenges, identities) = ceremony_stores().await;
    let ceremony = WebauthnCeremony {
        rp_id: RP_ID,
        rp_name: RP_NAME,
        credentials: &credentials,
        challenges: &challenges,
        identities: &identities,
    };
    let identity_id = seed_identity(&identities, "alice").await;
    let mut authenticator = SoftwareAuthenticator::new(vec![0xCC; 16]);

    // register once, via the stateful shim.
    let mut session = StatefulSession::new();
    let ccr_json = session
        .start_registration(
            &ceremony,
            ORIGIN,
            RegisterStartArgs {
                identity_id,
                username: "alice",
                is_account_link: false,
                invite_code: None,
                now: 1000,
                challenge_ttl_secs: 900,
            },
        )
        .await;
    let credential = authenticator.register(&extract_challenge(&ccr_json), ORIGIN);
    session
        .finish_registration(&ceremony, ORIGIN, credential, 1001)
        .await
        .expect("registration should succeed");

    // log in via the stateful shim, targeted flow.
    let rcr_json = session
        .start_authentication(&ceremony, ORIGIN, Some((identity_id, "alice")), 2000, 900)
        .await;
    let assertion = authenticator.authenticate(&extract_challenge(&rcr_json), ORIGIN);
    let outcome = session
        .finish_authentication(&ceremony, ORIGIN, assertion, 2001)
        .await
        .expect("stateful login should succeed");
    assert_eq!(outcome.identity_id, identity_id);

    // log in again via the explicit-nonce shim, discoverable flow - same
    // physical authenticator and stored passkey, opposite transport.
    let transport = ExplicitNonceTransport;
    let (rcr_json, nonce) = transport
        .start_authentication(&ceremony, ORIGIN, None, 3000, 900)
        .await;
    let assertion = authenticator.authenticate(&extract_challenge(&rcr_json), ORIGIN);
    let outcome = transport
        .finish_authentication(&ceremony, ORIGIN, &nonce, assertion, 3001)
        .await
        .expect("explicit-nonce login should succeed");
    assert_eq!(outcome.identity_id, identity_id);
}

#[tokio::test]
async fn challenge_expiry_is_honored_by_both_shims() {
    let (credentials, challenges, identities) = ceremony_stores().await;
    let ceremony = WebauthnCeremony {
        rp_id: RP_ID,
        rp_name: RP_NAME,
        credentials: &credentials,
        challenges: &challenges,
        identities: &identities,
    };
    let identity_a = seed_identity(&identities, "alice").await;
    let identity_b = seed_identity(&identities, "bob").await;

    let mut session = StatefulSession::new();
    session
        .start_registration(
            &ceremony,
            ORIGIN,
            RegisterStartArgs {
                identity_id: identity_a,
                username: "alice",
                is_account_link: false,
                invite_code: None,
                now: 1000,
                challenge_ttl_secs: 900,
            },
        )
        .await;
    // 1000 + 900 = 1900 is the expiry; 2000 is past it.
    let stateful_result = session
        .finish_registration(&ceremony, ORIGIN, serde_json::json!({}), 2000)
        .await;
    assert!(matches!(
        stateful_result,
        Err(SessionShimError::Ceremony(WebauthnError::InvalidChallenge))
    ));

    let transport = ExplicitNonceTransport;
    let (_rcr, nonce) = transport
        .start_registration(
            &ceremony,
            ORIGIN,
            RegisterStartArgs {
                identity_id: identity_b,
                username: "bob",
                is_account_link: false,
                invite_code: None,
                now: 1000,
                challenge_ttl_secs: 900,
            },
        )
        .await;
    let explicit_result = transport
        .finish_registration(&ceremony, ORIGIN, &nonce, serde_json::json!({}), 2000)
        .await;
    assert!(matches!(
        explicit_result,
        Err(WebauthnError::InvalidChallenge)
    ));
}

#[tokio::test]
async fn stateful_sessions_do_not_leak_nonces_across_independent_sessions() {
    let (credentials, challenges, identities) = ceremony_stores().await;
    let ceremony = WebauthnCeremony {
        rp_id: RP_ID,
        rp_name: RP_NAME,
        credentials: &credentials,
        challenges: &challenges,
        identities: &identities,
    };
    let identity_a = seed_identity(&identities, "alice").await;
    let identity_b = seed_identity(&identities, "bob").await;

    let mut session_a = StatefulSession::new();
    let ccr_a = session_a
        .start_registration(
            &ceremony,
            ORIGIN,
            RegisterStartArgs {
                identity_id: identity_a,
                username: "alice",
                is_account_link: false,
                invite_code: None,
                now: 1000,
                challenge_ttl_secs: 900,
            },
        )
        .await;

    let mut session_b = StatefulSession::new();
    let ccr_b = session_b
        .start_registration(
            &ceremony,
            ORIGIN,
            RegisterStartArgs {
                identity_id: identity_b,
                username: "bob",
                is_account_link: false,
                invite_code: None,
                now: 1000,
                challenge_ttl_secs: 900,
            },
        )
        .await;

    assert_ne!(
        session_a.pending_nonce, session_b.pending_nonce,
        "two independent sessions must never be issued the same nonce"
    );

    // a session that never started a ceremony has nothing to finish - it
    // must reject the attempt outright, never fall back to a nonce it
    // never issued.
    let mut session_c = StatefulSession::new();
    let orphan_result = session_c
        .finish_registration(&ceremony, ORIGIN, serde_json::json!({}), 1001)
        .await;
    assert!(matches!(
        orphan_result,
        Err(SessionShimError::NoCeremonyInProgress)
    ));

    // finish session_b first - this must consume ONLY session_b's own
    // nonce, leaving session_a's completely untouched.
    let authenticator_b = SoftwareAuthenticator::new(vec![0xDD; 16]);
    let credential_b = authenticator_b.register(&extract_challenge(&ccr_b), ORIGIN);
    session_b
        .finish_registration(&ceremony, ORIGIN, credential_b, 1001)
        .await
        .expect("session b finishes using its own nonce");

    // session_a's nonce is still intact and independently finishable -
    // proof session_b's finish never touched it.
    assert!(session_a.pending_nonce.is_some());
    let authenticator_a = SoftwareAuthenticator::new(vec![0xEE; 16]);
    let credential_a = authenticator_a.register(&extract_challenge(&ccr_a), ORIGIN);
    session_a
        .finish_registration(&ceremony, ORIGIN, credential_a, 1001)
        .await
        .expect("session a still finishes independently afterward");
}
