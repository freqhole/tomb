//! api-key issue/validate helpers: a long-lived bearer secret an identity
//! can present instead of a webauthn ceremony, e.g. for automated/
//! federation-proxy requests that have no interactive passkey step.
//!
//! keys live in a dedicated `api_keyz` table (`IdentityStore::set_api_key`/
//! `find_by_api_key`, migration 0004) rather than as a column on the
//! identity row, so issuing/revoking is a plain insert/delete rather than an
//! update racing the identity table's own upsert, and revocation is `NULL`
//! (no row), not an empty-string sentinel.
//!
//! these are plain functions over `&dyn IdentityStore` rather than a new
//! store trait or a stateful service struct - api keys are a thin
//! generate/store/lookup operation on top of a store that already exists,
//! not a new storage concern of their own (unlike `InviteStore`, which owns
//! a whole new table and its own crud/lifecycle).

use uuid::Uuid;

use crate::error::StoreError;
use crate::identity::Identity;
use crate::stores::IdentityStore;

/// generate a cryptographically random api key: 32 bytes of entropy,
/// hex-encoded to a 64-character string.
pub fn generate_api_key() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// generate a fresh api key and issue it to `identity_id`, replacing any key
/// it already had. returns the new key (the only time it is ever visible in
/// plaintext - callers must show/return it to the identity immediately).
pub async fn issue_api_key(
    store: &dyn IdentityStore,
    identity_id: Uuid,
) -> Result<String, StoreError> {
    let key = generate_api_key();
    store.set_api_key(identity_id, Some(key.clone())).await?;
    Ok(key)
}

/// revoke `identity_id`'s api key, if it has one. a no-op success if it does
/// not (matches `IdentityStore::set_api_key`'s `None` semantics).
pub async fn revoke_api_key(
    store: &dyn IdentityStore,
    identity_id: Uuid,
) -> Result<(), StoreError> {
    store.set_api_key(identity_id, None).await
}

/// resolve an api key back to the identity it was issued to, or `None` if
/// the key is unknown (revoked or never issued) - the two are
/// indistinguishable to a caller, same as an unrecognized password.
pub async fn validate_api_key(
    store: &dyn IdentityStore,
    api_key: &str,
) -> Result<Option<Identity>, StoreError> {
    store.find_by_api_key(api_key).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::{test_pool, SqliteIdentityStore};

    async fn store_with_identity() -> (SqliteIdentityStore, Identity) {
        let store = SqliteIdentityStore::new(test_pool().await);
        let identity = Identity {
            id: Uuid::new_v4(),
            username: Some("alice".to_string()),
            created_at: 100,
            metadata: None,
            deleted_at: None,
        };
        store.upsert_identity(identity.clone()).await.unwrap();
        (store, identity)
    }

    #[test]
    fn generate_api_key_is_64_hex_chars() {
        let key = generate_api_key();
        assert_eq!(key.len(), 64);
        assert!(key.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn generate_api_key_is_not_trivially_repeated() {
        assert_ne!(generate_api_key(), generate_api_key());
    }

    #[tokio::test]
    async fn issue_then_validate_round_trips() {
        let (store, identity) = store_with_identity().await;
        let key = issue_api_key(&store, identity.id).await.unwrap();

        let found = validate_api_key(&store, &key).await.unwrap().unwrap();
        assert_eq!(found.id, identity.id);
    }

    #[tokio::test]
    async fn validate_unknown_key_returns_none() {
        let (store, _identity) = store_with_identity().await;
        assert!(validate_api_key(&store, "unknown-key")
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn revoke_then_validate_returns_none() {
        let (store, identity) = store_with_identity().await;
        let key = issue_api_key(&store, identity.id).await.unwrap();

        revoke_api_key(&store, identity.id).await.unwrap();

        assert!(validate_api_key(&store, &key).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn issuing_again_invalidates_the_prior_key() {
        let (store, identity) = store_with_identity().await;
        let first = issue_api_key(&store, identity.id).await.unwrap();
        let second = issue_api_key(&store, identity.id).await.unwrap();

        assert_ne!(first, second);
        assert!(validate_api_key(&store, &first).await.unwrap().is_none());
        assert!(validate_api_key(&store, &second).await.unwrap().is_some());
    }
}
