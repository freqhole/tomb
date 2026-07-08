//! translates between grimoire's own user id representation
//! (`user_accountz.id`, a short random hex string) and haruspex's identity
//! model (`Identity.id: Uuid`).
//!
//! haruspex owns its own sqlite database and knows nothing about grimoire's
//! user table, so the two id spaces need an explicit bridge wherever
//! webauthn ceremony code has to talk to both. the bridge stores grimoire's
//! user id in the haruspex identity's `metadata` field, so a haruspex
//! identity id can always be resolved back to the grimoire user that owns
//! it - this is needed for the discoverable login flow, where the identity
//! is only known once the ceremony has already completed.

use haruspex::error::StoreError;
use haruspex::identity::Identity;
use haruspex::stores::IdentityStore;
use uuid::Uuid;

/// namespace used to derive a stable haruspex identity id from a grimoire
/// user id. arbitrary but fixed - the same grimoire user id always derives
/// the same identity id.
const GRIMOIRE_USER_NAMESPACE: Uuid = Uuid::from_bytes([
    0x9a, 0x1e, 0x3b, 0x77, 0x0c, 0x0a, 0x4b, 0x63, 0x9a, 0x6e, 0x0e, 0x9f, 0x0b, 0x1d, 0x2a, 0x5c,
]);

/// deterministically derive a haruspex identity id for an existing grimoire
/// user. pure and side-effect free - safe to call for read-only lookups
/// even if no identity row has been created for this user yet (a store
/// query against a nonexistent identity id just returns nothing).
pub(crate) fn identity_id_for_existing_user(user_id: &str) -> Uuid {
    Uuid::new_v5(&GRIMOIRE_USER_NAMESPACE, user_id.as_bytes())
}

/// ensure a haruspex identity exists (with current username and the
/// `grimoire_user_id` metadata link) for an already-existing grimoire user,
/// returning its identity id. call this whenever the grimoire user is known
/// up front (account-link registration, targeted login).
pub(crate) async fn ensure_identity_for_user(
    identities: &dyn IdentityStore,
    user_id: &str,
    username: &str,
    now: i64,
) -> Result<Uuid, StoreError> {
    let id = identity_id_for_existing_user(user_id);
    identities
        .upsert_identity(Identity {
            id,
            username: Some(username.to_string()),
            created_at: now,
            metadata: Some(serde_json::json!({ "grimoire_user_id": user_id })),
            deleted_at: None,
        })
        .await?;
    Ok(id)
}

/// create a haruspex identity for a brand-new registration, before the
/// grimoire user row exists (grimoire only assigns a real user id once the
/// passkey ceremony finishes - see `offal::auth::webauthn_p2p::register_finish`).
/// `identity_id` is a freshly generated id threaded through the challenge;
/// the `grimoire_user_id` metadata link is filled in afterward by
/// [`link_identity_to_grimoire_user`] once the grimoire user has been
/// created.
pub(crate) async fn create_pending_identity(
    identities: &dyn IdentityStore,
    identity_id: Uuid,
    username: &str,
    now: i64,
) -> Result<(), StoreError> {
    identities
        .upsert_identity(Identity {
            id: identity_id,
            username: Some(username.to_string()),
            created_at: now,
            metadata: None,
            deleted_at: None,
        })
        .await?;
    Ok(())
}

/// record the grimoire user id on a haruspex identity created by
/// [`create_pending_identity`], now that the grimoire user row exists.
/// preserves the identity's existing username/created_at.
pub(crate) async fn link_identity_to_grimoire_user(
    identities: &dyn IdentityStore,
    identity_id: Uuid,
    user_id: &str,
) -> Result<(), StoreError> {
    let existing = identities.get_identity(identity_id).await?;
    let (username, created_at) = match existing {
        Some(identity) => (identity.username, identity.created_at),
        None => (None, time::OffsetDateTime::now_utc().unix_timestamp()),
    };
    identities
        .upsert_identity(Identity {
            id: identity_id,
            username,
            created_at,
            metadata: Some(serde_json::json!({ "grimoire_user_id": user_id })),
            deleted_at: None,
        })
        .await?;
    Ok(())
}

/// resolve a haruspex identity id back to the grimoire user id it belongs
/// to, via the `grimoire_user_id` metadata field set by
/// `ensure_identity_for_user`/`link_identity_to_grimoire_user`. `None` means
/// the identity exists but was never linked to a grimoire user (should not
/// happen for identities created through the webauthn ceremony handlers).
pub(crate) async fn grimoire_user_id_for_identity(
    identities: &dyn IdentityStore,
    identity_id: Uuid,
) -> Result<Option<String>, StoreError> {
    let identity = identities.get_identity(identity_id).await?;
    Ok(identity.and_then(|identity| {
        identity
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("grimoire_user_id"))
            .and_then(|value| value.as_str())
            .map(str::to_string)
    }))
}
