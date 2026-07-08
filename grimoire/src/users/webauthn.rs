//! webauthn credential storage - a grimoire-facing adapter over haruspex's
//! `CredentialStore`.
//!
//! credentials live in haruspex's own sqlite database (see
//! `crate::database::connect_haruspex`), keyed by a haruspex identity id
//! rather than grimoire's own user id - `crate::users::haruspex_bridge`
//! translates between the two so this module's public surface
//! (`WebAuthnService`) can stay keyed on grimoire user ids, the way every
//! caller (the p2p ceremony handlers and the http webauthn routes, which
//! still use a cookie session rather than the p2p nonce flow) already
//! expects.

use crate::database;
use crate::response::GrimoireResponse;
use crate::users::haruspex_bridge;
use crate::users::models::WebAuthnCredential;
use haruspex::sqlite::SqliteCredentialStore;
use haruspex::stores::{Credential, CredentialStore};
use time::OffsetDateTime;

#[cfg(feature = "webauthn")]
use webauthn_rs::prelude::Passkey;

/// open haruspex's database, mapping a connection failure to an
/// `ErrorDetail` the same way every other store error is reported.
async fn haruspex_pool() -> Result<sqlx::SqlitePool, crate::error::ErrorDetail> {
    database::connect_haruspex().await.map_err(Into::into)
}

fn to_webauthn_credential(
    row: Credential,
    user_id: &str,
) -> Result<WebAuthnCredential, serde_json::Error> {
    Ok(WebAuthnCredential {
        id: row.id,
        user_id: user_id.to_string(),
        credential_id: row.credential_id,
        credential_data: serde_json::to_string(&row.credential_data)?,
        created_at: row.created_at,
        last_used_at: row.last_used_at,
        deleted_at: row.deleted_at,
        name: row.name,
    })
}

/// service for webauthn credential operations, backed by haruspex's
/// `CredentialStore`.
pub struct WebAuthnService;

impl WebAuthnService {
    /// create a new webauthn service instance
    pub fn new() -> Self {
        Self
    }

    /// save a webauthn credential (passkey serialized as json). `username`
    /// is required so a haruspex identity can be created for `user_id` if
    /// this is its first credential - haruspex's `credentialz` table has a
    /// foreign key on the owning identity, so the identity must exist
    /// before the credential does.
    #[cfg(feature = "webauthn")]
    pub async fn save_credential(
        &self,
        user_id: &str,
        username: &str,
        passkey: &Passkey,
    ) -> GrimoireResponse<WebAuthnCredential> {
        let pool = match haruspex_pool().await {
            Ok(p) => p,
            Err(e) => return GrimoireResponse::failure("failed to open credential store", vec![e]),
        };
        let now = OffsetDateTime::now_utc().unix_timestamp();

        let identities = haruspex::sqlite::SqliteIdentityStore::new(pool.clone());
        let identity_id =
            match haruspex_bridge::ensure_identity_for_user(&identities, user_id, username, now)
                .await
            {
                Ok(id) => id,
                Err(e) => {
                    return GrimoireResponse::failure("failed to prepare identity", vec![e.into()])
                }
            };

        let credential_data = match serde_json::to_value(passkey) {
            Ok(v) => v,
            Err(e) => {
                return GrimoireResponse::failure("failed to serialize credential", vec![e.into()])
            }
        };

        let credentials = SqliteCredentialStore::new(pool);
        let saved = match credentials
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
        {
            Ok(c) => c,
            Err(e) => {
                return GrimoireResponse::failure("failed to save credential", vec![e.into()])
            }
        };

        match to_webauthn_credential(saved, user_id) {
            Ok(cred) => GrimoireResponse::success("credential saved successfully", cred),
            Err(e) => GrimoireResponse::failure("failed to encode credential", vec![e.into()]),
        }
    }

    /// get all webauthn credentials for a user (deserialize passkeys from json)
    #[cfg(feature = "webauthn")]
    pub async fn get_credentials(&self, user_id: &str) -> GrimoireResponse<Vec<Passkey>> {
        let pool = match haruspex_pool().await {
            Ok(p) => p,
            Err(e) => return GrimoireResponse::failure("failed to get credentials", vec![e]),
        };
        let identity_id = haruspex_bridge::identity_id_for_existing_user(user_id);
        let credentials = SqliteCredentialStore::new(pool);
        let rows = match credentials.list_for_identity(identity_id).await {
            Ok(rows) => rows,
            Err(e) => {
                return GrimoireResponse::failure("failed to get credentials", vec![e.into()])
            }
        };

        let mut passkeys = Vec::new();
        for row in rows {
            match serde_json::from_value::<Passkey>(row.credential_data) {
                Ok(passkey) => passkeys.push(passkey),
                Err(e) => {
                    tracing::warn!("failed to deserialize credential {}: {}", row.id, e);
                    // skip invalid credentials but don't fail the whole request
                }
            }
        }

        GrimoireResponse::success(format!("found {} credential(s)", passkeys.len()), passkeys)
    }

    /// update credential last used timestamp
    pub async fn update_credential_last_used(&self, credential_id: &[u8]) -> GrimoireResponse<()> {
        let pool = match haruspex_pool().await {
            Ok(p) => p,
            Err(e) => return GrimoireResponse::failure("failed to update credential", vec![e]),
        };
        let now = OffsetDateTime::now_utc().unix_timestamp();
        let credentials = SqliteCredentialStore::new(pool);
        match credentials.touch_last_used(credential_id, now).await {
            Ok(()) => GrimoireResponse::success("credential updated", ()),
            Err(e) => GrimoireResponse::failure("failed to update credential", vec![e.into()]),
        }
    }

    /// list credentials for a user as metadata rows (id, created_at, last_used_at).
    /// does not deserialise the passkey blob - safe to call regardless of webauthn feature flag.
    pub async fn list_credentials_meta(
        &self,
        user_id: &str,
    ) -> GrimoireResponse<Vec<WebAuthnCredential>> {
        let pool = match haruspex_pool().await {
            Ok(p) => p,
            Err(e) => return GrimoireResponse::failure("failed to list credentials", vec![e]),
        };
        let identity_id = haruspex_bridge::identity_id_for_existing_user(user_id);
        let credentials = SqliteCredentialStore::new(pool);
        let rows = match credentials.list_for_identity(identity_id).await {
            Ok(rows) => rows,
            Err(e) => {
                return GrimoireResponse::failure("failed to list credentials", vec![e.into()])
            }
        };

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            match to_webauthn_credential(row, user_id) {
                Ok(cred) => out.push(cred),
                Err(e) => {
                    return GrimoireResponse::failure("failed to encode credential", vec![e.into()])
                }
            }
        }

        GrimoireResponse::success(format!("found {} credential(s)", out.len()), out)
    }

    /// delete one of a user's credentials by row id. scoped to the owning
    /// user: a row id that doesn't belong to `user_id` is a no-op, never an
    /// error, matching the original scoped-delete semantics.
    pub async fn delete_credential(
        &self,
        credential_row_id: &str,
        user_id: &str,
    ) -> GrimoireResponse<()> {
        let pool = match haruspex_pool().await {
            Ok(p) => p,
            Err(e) => return GrimoireResponse::failure("failed to delete credential", vec![e]),
        };
        let identity_id = haruspex_bridge::identity_id_for_existing_user(user_id);
        let credentials = SqliteCredentialStore::new(pool);
        let rows = match credentials.list_for_identity(identity_id).await {
            Ok(rows) => rows,
            Err(e) => {
                return GrimoireResponse::failure("failed to delete credential", vec![e.into()])
            }
        };

        let Some(target) = rows.into_iter().find(|c| c.id == credential_row_id) else {
            return GrimoireResponse::success("credential deleted", ());
        };

        match credentials.remove_credential(&target.credential_id).await {
            Ok(()) => GrimoireResponse::success("credential deleted", ()),
            Err(e) => GrimoireResponse::failure("failed to delete credential", vec![e.into()]),
        }
    }

    /// update the name on a passkey, scoped to the owning user.
    pub async fn update_passkey_name(
        &self,
        credential_row_id: &str,
        user_id: &str,
        name: Option<&str>,
    ) -> GrimoireResponse<()> {
        let pool = match haruspex_pool().await {
            Ok(p) => p,
            Err(e) => return GrimoireResponse::failure("failed to update passkey name", vec![e]),
        };
        let identity_id = haruspex_bridge::identity_id_for_existing_user(user_id);
        let credentials = SqliteCredentialStore::new(pool);
        let owns_row = match credentials.list_for_identity(identity_id).await {
            Ok(rows) => rows.iter().any(|c| c.id == credential_row_id),
            Err(e) => {
                return GrimoireResponse::failure("failed to update passkey name", vec![e.into()])
            }
        };
        if !owns_row {
            return GrimoireResponse::success("passkey name updated", ());
        }

        match credentials
            .rename_credential(credential_row_id, name.map(str::to_string))
            .await
        {
            Ok(()) => GrimoireResponse::success("passkey name updated", ()),
            Err(e) => GrimoireResponse::failure("failed to update passkey name", vec![e.into()]),
        }
    }

    /// look up which grimoire user owns a credential by its raw credential_id bytes.
    /// used in the discoverable authentication flow.
    #[cfg(feature = "webauthn")]
    pub async fn get_user_id_by_credential_id(
        &self,
        credential_id: &[u8],
    ) -> GrimoireResponse<Option<String>> {
        let pool = match haruspex_pool().await {
            Ok(p) => p,
            Err(e) => return GrimoireResponse::failure("failed to look up credential", vec![e]),
        };
        let credentials = SqliteCredentialStore::new(pool.clone());
        let row = match credentials.get_credential(credential_id).await {
            Ok(row) => row,
            Err(e) => {
                return GrimoireResponse::failure("failed to look up credential", vec![e.into()])
            }
        };
        let Some(row) = row else {
            return GrimoireResponse::success("ok", None);
        };

        let identities = haruspex::sqlite::SqliteIdentityStore::new(pool);
        match haruspex_bridge::grimoire_user_id_for_identity(&identities, row.identity_id).await {
            Ok(user_id) => GrimoireResponse::success("ok", user_id),
            Err(e) => GrimoireResponse::failure("failed to look up credential", vec![e.into()]),
        }
    }
}

impl Default for WebAuthnService {
    fn default() -> Self {
        Self::new()
    }
}
