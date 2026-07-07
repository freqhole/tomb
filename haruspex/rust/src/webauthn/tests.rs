//! plumbing-level tests for `WebauthnCeremony` that don't require a real
//! webauthn authenticator ceremony (no virtual/software authenticator crate
//! is a dependency here, matching the donor - grimoire's own webauthn tests
//! are exercised manually via a browser, not a simulated authenticator; see
//! `tomb/client-codegen/freqhole-api-client/auth-test.html`). these tests
//! cover everything around the crypto boundary: challenge persistence and
//! its fields, nonce single-use/expiry/kind-checking as seen through the
//! ceremony layer, and the error paths that don't require a valid signed
//! credential response.

use uuid::Uuid;

use crate::identity::Identity;
use crate::sqlite::{test_pool, SqliteChallengeStore, SqliteCredentialStore, SqliteIdentityStore};
use crate::stores::{ChallengeKind, ChallengeStore as _, IdentityStore as _};

use super::ceremony::{RegisterStartArgs, WebauthnCeremony, WebauthnError};

const RP_ID: &str = "localhost";
const RP_NAME: &str = "freqhole test";
const ORIGIN: &str = "https://localhost:8443";

async fn ceremony_stores() -> (
    SqliteCredentialStore,
    SqliteChallengeStore,
    SqliteIdentityStore,
) {
    let pool = test_pool().await;
    (
        SqliteCredentialStore::new(pool.clone()),
        SqliteChallengeStore::new(pool.clone()),
        SqliteIdentityStore::new(pool),
    )
}

async fn seed_identity(identities: &SqliteIdentityStore) -> Uuid {
    let id = Uuid::new_v4();
    identities
        .upsert_identity(Identity {
            id,
            username: Some("alice".to_string()),
            created_at: 100,
            metadata: None,
            deleted_at: None,
        })
        .await
        .unwrap();
    id
}

#[tokio::test]
async fn register_start_persists_a_challenge_with_the_right_fields() {
    let (credentials, challenges, identities) = ceremony_stores().await;
    let identity_id = seed_identity(&identities).await;
    let ceremony = WebauthnCeremony {
        rp_id: RP_ID,
        rp_name: RP_NAME,
        credentials: &credentials,
        challenges: &challenges,
        identities: &identities,
    };

    let (_ccr, nonce) = ceremony
        .register_start(
            ORIGIN,
            RegisterStartArgs {
                identity_id,
                username: "alice",
                is_account_link: false,
                invite_code: Some("invite-abc"),
                now: 1000,
                challenge_ttl_secs: 900,
            },
        )
        .await
        .unwrap();

    // register_start's own ChallengeStore::save consumed the row already
    // via `take` inside register_finish only - so read it back directly to
    // assert on the fields without consuming it via a full finish call.
    let taken = challenges
        .take(&nonce, ChallengeKind::Registration, 1000)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(taken.identity_id, Some(identity_id));
    assert_eq!(taken.username.as_deref(), Some("alice"));
    assert!(!taken.is_account_link);
    assert_eq!(taken.invite_code.as_deref(), Some("invite-abc"));
}

#[tokio::test]
async fn register_start_account_link_flag_round_trips() {
    let (credentials, challenges, identities) = ceremony_stores().await;
    let identity_id = seed_identity(&identities).await;
    let ceremony = WebauthnCeremony {
        rp_id: RP_ID,
        rp_name: RP_NAME,
        credentials: &credentials,
        challenges: &challenges,
        identities: &identities,
    };

    let (_ccr, nonce) = ceremony
        .register_start(
            ORIGIN,
            RegisterStartArgs {
                identity_id,
                username: "alice",
                is_account_link: true,
                invite_code: None,
                now: 1000,
                challenge_ttl_secs: 900,
            },
        )
        .await
        .unwrap();

    let taken = challenges
        .take(&nonce, ChallengeKind::Registration, 1000)
        .await
        .unwrap()
        .unwrap();
    assert!(taken.is_account_link);
    assert_eq!(taken.invite_code, None);
}

#[tokio::test]
async fn register_finish_rejects_an_unknown_nonce() {
    let (credentials, challenges, identities) = ceremony_stores().await;
    let ceremony = WebauthnCeremony {
        rp_id: RP_ID,
        rp_name: RP_NAME,
        credentials: &credentials,
        challenges: &challenges,
        identities: &identities,
    };

    let err = ceremony
        .register_finish(ORIGIN, "no-such-nonce", serde_json::json!({}), None, 1000)
        .await
        .unwrap_err();
    assert!(matches!(err, WebauthnError::InvalidChallenge));
}

#[tokio::test]
async fn register_finish_rejects_a_malformed_credential_body() {
    let (credentials, challenges, identities) = ceremony_stores().await;
    let identity_id = seed_identity(&identities).await;
    let ceremony = WebauthnCeremony {
        rp_id: RP_ID,
        rp_name: RP_NAME,
        credentials: &credentials,
        challenges: &challenges,
        identities: &identities,
    };

    let (_ccr, nonce) = ceremony
        .register_start(
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
        .await
        .unwrap();

    let err = ceremony
        .register_finish(
            ORIGIN,
            &nonce,
            serde_json::json!({"not": "a credential"}),
            None,
            1001,
        )
        .await
        .unwrap_err();
    assert!(matches!(err, WebauthnError::InvalidCredential(_)));
}

#[tokio::test]
async fn register_finish_rejects_an_expired_nonce() {
    let (credentials, challenges, identities) = ceremony_stores().await;
    let identity_id = seed_identity(&identities).await;
    let ceremony = WebauthnCeremony {
        rp_id: RP_ID,
        rp_name: RP_NAME,
        credentials: &credentials,
        challenges: &challenges,
        identities: &identities,
    };

    let (_ccr, nonce) = ceremony
        .register_start(
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
        .await
        .unwrap();

    // 1000 + 900 = 1900 is the expiry; 2000 is past it.
    let err = ceremony
        .register_finish(ORIGIN, &nonce, serde_json::json!({}), None, 2000)
        .await
        .unwrap_err();
    assert!(matches!(err, WebauthnError::InvalidChallenge));
}

#[tokio::test]
async fn login_start_targeted_rejects_an_identity_with_no_credentials() {
    let (credentials, challenges, identities) = ceremony_stores().await;
    let identity_id = seed_identity(&identities).await;
    let ceremony = WebauthnCeremony {
        rp_id: RP_ID,
        rp_name: RP_NAME,
        credentials: &credentials,
        challenges: &challenges,
        identities: &identities,
    };

    let err = ceremony
        .login_start(ORIGIN, Some((identity_id, "alice")), 1000, 900)
        .await
        .unwrap_err();
    assert!(matches!(err, WebauthnError::NoCredentials));
}

#[tokio::test]
async fn login_start_discoverable_persists_a_challenge_with_no_identity() {
    let (credentials, challenges, identities) = ceremony_stores().await;
    let ceremony = WebauthnCeremony {
        rp_id: RP_ID,
        rp_name: RP_NAME,
        credentials: &credentials,
        challenges: &challenges,
        identities: &identities,
    };

    let (_rcr, nonce) = ceremony.login_start(ORIGIN, None, 1000, 900).await.unwrap();

    let taken = challenges
        .take(&nonce, ChallengeKind::DiscoverableAuthentication, 1000)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(taken.identity_id, None);
    assert_eq!(taken.username, None);
}

#[tokio::test]
async fn login_finish_rejects_an_unknown_nonce_under_either_kind() {
    let (credentials, challenges, identities) = ceremony_stores().await;
    let ceremony = WebauthnCeremony {
        rp_id: RP_ID,
        rp_name: RP_NAME,
        credentials: &credentials,
        challenges: &challenges,
        identities: &identities,
    };

    let err = ceremony
        .login_finish(ORIGIN, "no-such-nonce", serde_json::json!({}), None, 1000)
        .await
        .unwrap_err();
    assert!(matches!(err, WebauthnError::InvalidChallenge));
}

#[tokio::test]
async fn login_finish_tries_the_discoverable_kind_when_targeted_kind_does_not_match() {
    let (credentials, challenges, identities) = ceremony_stores().await;
    let ceremony = WebauthnCeremony {
        rp_id: RP_ID,
        rp_name: RP_NAME,
        credentials: &credentials,
        challenges: &challenges,
        identities: &identities,
    };

    // a discoverable-flow nonce; login_finish's targeted `take` attempt
    // should miss (kind mismatch, row left in place) and fall through to
    // the discoverable `take`, which should find it - then fail later on
    // the malformed credential body, proving it got that far rather than
    // stopping at InvalidChallenge.
    let (_rcr, nonce) = ceremony.login_start(ORIGIN, None, 1000, 900).await.unwrap();

    let err = ceremony
        .login_finish(
            ORIGIN,
            &nonce,
            serde_json::json!({"not": "a credential"}),
            None,
            1001,
        )
        .await
        .unwrap_err();
    assert!(matches!(err, WebauthnError::InvalidCredential(_)));
}
