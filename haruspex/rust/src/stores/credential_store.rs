//! webauthn credential (passkey) storage.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::StoreError;

/// a webauthn credential, grounded in tomb's `user_credentialz` schema:
/// `credential_id` is the raw authenticator credential id, `credential_data`
/// is the serialized passkey json blob, plus an optional friendly name and
/// the usual lifecycle timestamps.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Credential {
    pub id: String,
    pub identity_id: Uuid,
    pub credential_id: Vec<u8>,
    pub credential_data: serde_json::Value,
    pub name: Option<String>,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
    pub deleted_at: Option<i64>,
}

#[async_trait]
pub trait CredentialStore: Send + Sync {
    async fn add_credential(&self, credential: Credential) -> Result<Credential, StoreError>;
    async fn get_credential(&self, credential_id: &[u8]) -> Result<Option<Credential>, StoreError>;
    /// active (non-deleted) credentials for an identity, most recent first.
    async fn list_for_identity(&self, identity_id: Uuid) -> Result<Vec<Credential>, StoreError>;
    async fn touch_last_used(
        &self,
        credential_id: &[u8],
        last_used_at: i64,
    ) -> Result<(), StoreError>;
    /// soft-delete a credential.
    async fn remove_credential(&self, credential_id: &[u8]) -> Result<(), StoreError>;
    /// rename a credential (set its human-readable display name). ownership
    /// checking - verifying the credential belongs to the expected identity -
    /// is the caller's responsibility; this method applies the rename
    /// unconditionally. pass `None` to clear the name.
    async fn rename_credential(
        &self,
        id: &str,
        new_name: Option<String>,
    ) -> Result<(), StoreError>;
}
