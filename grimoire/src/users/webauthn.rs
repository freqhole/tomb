//! WebAuthn credential management
//!
//! This module handles storage and retrieval of WebAuthn credentials (passkeys).
//! Credentials are stored as serialized JSON in the database.

use crate::database;
use crate::response::GrimoireResponse;
use crate::users::models::{AuthError, AuthResult, WebAuthnCredential};
use time::OffsetDateTime;

#[cfg(feature = "webauthn")]
use webauthn_rs::prelude::Passkey;

/// Repository for webauthn credential database operations
pub(crate) struct WebAuthnRepository;

impl WebAuthnRepository {
    /// Create a new webauthn repository instance
    pub fn new() -> Self {
        Self
    }

    /// Save a webauthn credential for a user
    pub async fn save_credential(
        &self,
        user_id: &str,
        credential_id: &[u8],
        credential_data: &str,
    ) -> AuthResult<WebAuthnCredential> {
        let pool = database::connect().await?;

        let now = OffsetDateTime::now_utc().unix_timestamp();

        let credential = sqlx::query_as!(
            WebAuthnCredential,
            r#"
            INSERT INTO user_credentialz (user_id, credential_id, credential_data, created_at)
            VALUES (?1, ?2, ?3, ?4)
            RETURNING id as "id!", user_id as "user_id!", credential_id as "credential_id!", credential_data as "credential_data!", created_at as "created_at!", last_used_at, deleted_at
            "#,
            user_id,
            credential_id,
            credential_data,
            now
        )
        .fetch_one(&pool)
        .await?;

        Ok(credential)
    }

    /// Get all credentials for a user
    pub async fn get_user_credentials(&self, user_id: &str) -> AuthResult<Vec<WebAuthnCredential>> {
        let pool = database::connect().await?;

        let credentials = sqlx::query_as!(
            WebAuthnCredential,
            r#"
            SELECT id as "id!", user_id as "user_id!", credential_id as "credential_id!", credential_data as "credential_data!", created_at as "created_at!", last_used_at, deleted_at
            FROM user_credentialz
            WHERE user_id = ?1 AND deleted_at IS NULL
            ORDER BY created_at DESC
            "#,
            user_id
        )
        .fetch_all(&pool)
        .await?;

        Ok(credentials)
    }

    /// Update a credential's last used timestamp
    pub async fn update_credential_last_used(
        &self,
        credential_id: &[u8],
        last_used_at: i64,
    ) -> AuthResult<()> {
        let pool = database::connect().await?;

        sqlx::query!(
            r#"
            UPDATE user_credentialz
            SET last_used_at = ?1
            WHERE credential_id = ?2
            "#,
            last_used_at,
            credential_id
        )
        .execute(&pool)
        .await?;

        Ok(())
    }
}

impl Default for WebAuthnRepository {
    fn default() -> Self {
        Self::new()
    }
}

/// Service for webauthn credential operations
pub struct WebAuthnService {
    repository: WebAuthnRepository,
}

impl WebAuthnService {
    /// Create a new webauthn service instance
    pub fn new() -> Self {
        Self {
            repository: WebAuthnRepository::new(),
        }
    }

    /// Save a webauthn credential (passkey serialized as JSON)
    #[cfg(feature = "webauthn")]
    pub async fn save_credential(
        &self,
        user_id: &str,
        passkey: &Passkey,
    ) -> GrimoireResponse<WebAuthnCredential> {
        // Serialize the passkey to JSON
        let credential_data = match serde_json::to_string(passkey) {
            Ok(data) => data,
            Err(e) => {
                return GrimoireResponse::failure(
                    "Failed to serialize credential",
                    vec![AuthError::Serialization(e).into()],
                );
            }
        };

        let credential_id = passkey.cred_id().as_ref().to_vec();

        match self
            .repository
            .save_credential(user_id, &credential_id, &credential_data)
            .await
        {
            Ok(cred) => GrimoireResponse::success("Credential saved successfully", cred),
            Err(err) => GrimoireResponse::failure("Failed to save credential", vec![err.into()]),
        }
    }

    /// Get all webauthn credentials for a user (deserialize passkeys from JSON)
    #[cfg(feature = "webauthn")]
    pub async fn get_credentials(&self, user_id: &str) -> GrimoireResponse<Vec<Passkey>> {
        let credentials = match self.repository.get_user_credentials(user_id).await {
            Ok(creds) => creds,
            Err(err) => {
                return GrimoireResponse::failure("Failed to get credentials", vec![err.into()]);
            }
        };

        let mut passkeys = Vec::new();
        for cred in credentials {
            match serde_json::from_str::<Passkey>(&cred.credential_data) {
                Ok(passkey) => passkeys.push(passkey),
                Err(e) => {
                    tracing::warn!("Failed to deserialize credential {}: {}", cred.id, e);
                    // Skip invalid credentials but don't fail the whole request
                }
            }
        }

        GrimoireResponse::success(format!("Found {} credential(s)", passkeys.len()), passkeys)
    }

    /// Update credential last used timestamp
    pub async fn update_credential_last_used(&self, credential_id: &[u8]) -> GrimoireResponse<()> {
        let now = OffsetDateTime::now_utc().unix_timestamp();

        match self
            .repository
            .update_credential_last_used(credential_id, now)
            .await
        {
            Ok(_) => GrimoireResponse::success("Credential updated", ()),
            Err(err) => GrimoireResponse::failure("Failed to update credential", vec![err.into()]),
        }
    }
}

impl Default for WebAuthnService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_repository_creation() {
        let _ = WebAuthnRepository::new();
        // Basic smoke test
        assert!(true);
    }

    #[test]
    fn test_service_creation() {
        let _ = WebAuthnService::new();
        // Basic smoke test
        assert!(true);
    }
}
