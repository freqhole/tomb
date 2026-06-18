//! WebAuthn credential management
//!
//! this module handles storage and retrieval of WebAuthn credentials (passkeys).
//! credentials are stored as serialized JSON in the database.

// note: allow dead code and unused imports to suppress warnings about things
// that are behind crate feature macros
#![allow(dead_code, unused_imports)]

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
            RETURNING id as "id!", user_id as "user_id!", credential_id as "credential_id!", credential_data as "credential_data!", created_at as "created_at!", last_used_at, deleted_at, name
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
            SELECT id as "id!", user_id as "user_id!", credential_id as "credential_id!", credential_data as "credential_data!", created_at as "created_at!", last_used_at, deleted_at, name
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

    /// Hard-delete a credential by row id. only the owning user's rows are affected.
    pub async fn hard_delete_credential(
        &self,
        credential_row_id: &str,
        user_id: &str,
    ) -> AuthResult<()> {
        let pool = database::connect().await?;

        sqlx::query!(
            r#"
            DELETE FROM user_credentialz
            WHERE id = ?1 AND user_id = ?2
            "#,
            credential_row_id,
            user_id,
        )
        .execute(&pool)
        .await?;

        Ok(())
    }

    /// Update the name on a passkey. scoped to the owning user.
    pub async fn update_passkey_name(
        &self,
        credential_row_id: &str,
        user_id: &str,
        name: Option<&str>,
    ) -> AuthResult<()> {
        let pool = database::connect().await?;
        sqlx::query!(
            r#"
            UPDATE user_credentialz
            SET name = ?1
            WHERE id = ?2 AND user_id = ?3
            "#,
            name,
            credential_row_id,
            user_id,
        )
        .execute(&pool)
        .await?;
        Ok(())
    }

    /// Look up the user_id that owns a credential by its raw credential_id bytes.
    /// used in the discoverable authentication flow where only the credential_id
    /// is known before the user has been identified.
    pub async fn get_user_id_by_credential_id(
        &self,
        credential_id: &[u8],
    ) -> AuthResult<Option<String>> {
        let pool = database::connect().await?;

        let row = sqlx::query!(
            r#"
            SELECT user_id as "user_id!"
            FROM user_credentialz
            WHERE credential_id = ?1 AND deleted_at IS NULL
            LIMIT 1
            "#,
            credential_id,
        )
        .fetch_optional(&pool)
        .await?;

        Ok(row.map(|r| r.user_id))
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
        tracing::info!(
            "save_credential: user={} cred_id len={} hex={}",
            user_id,
            credential_id.len(),
            credential_id
                .iter()
                .take(8)
                .map(|b| format!("{:02x}", b))
                .collect::<String>()
        );

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

    /// List credentials for a user as metadata rows (id, created_at, last_used_at).
    /// does not deserialise the passkey blob - safe to call regardless of webauthn feature flag.
    pub async fn list_credentials_meta(
        &self,
        user_id: &str,
    ) -> GrimoireResponse<Vec<crate::users::models::WebAuthnCredential>> {
        match self.repository.get_user_credentials(user_id).await {
            Ok(creds) => {
                GrimoireResponse::success(format!("found {} credential(s)", creds.len()), creds)
            }
            Err(err) => GrimoireResponse::failure("failed to list credentials", vec![err.into()]),
        }
    }

    /// Hard-delete a credential by row id. only the owning user may remove their own credentials.
    pub async fn delete_credential(
        &self,
        credential_row_id: &str,
        user_id: &str,
    ) -> GrimoireResponse<()> {
        match self
            .repository
            .hard_delete_credential(credential_row_id, user_id)
            .await
        {
            Ok(()) => GrimoireResponse::success("credential deleted", ()),
            Err(err) => GrimoireResponse::failure("failed to delete credential", vec![err.into()]),
        }
    }
    /// Update the user-supplied name on a passkey. scoped to the owning user.
    pub async fn update_passkey_name(
        &self,
        credential_row_id: &str,
        user_id: &str,
        name: Option<&str>,
    ) -> GrimoireResponse<()> {
        match self
            .repository
            .update_passkey_name(credential_row_id, user_id, name)
            .await
        {
            Ok(()) => GrimoireResponse::success("passkey name updated", ()),
            Err(err) => {
                GrimoireResponse::failure("failed to update passkey name", vec![err.into()])
            }
        }
    }
    /// Look up which user owns a credential by its raw credential_id bytes.
    /// used in the discoverable authentication flow.
    #[cfg(feature = "webauthn")]
    pub async fn get_user_id_by_credential_id(
        &self,
        credential_id: &[u8],
    ) -> GrimoireResponse<Option<String>> {
        match self
            .repository
            .get_user_id_by_credential_id(credential_id)
            .await
        {
            Ok(user_id) => GrimoireResponse::success("ok", user_id),
            Err(err) => GrimoireResponse::failure("failed to look up credential", vec![err.into()]),
        }
    }
}

impl Default for WebAuthnService {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// webauthn builder helper (used by p2p offal handlers)
// ============================================================================

/// lightweight webauthn wrapper for use in grimoire offal handlers.
///
/// mirrors the FreqWebauthn struct in server/src/auth/freq_webauthn.rs but
/// lives in grimoire so p2p handlers (which run inside grimoire) can call it
/// without depending on the server crate.
#[cfg(feature = "webauthn")]
pub struct GrimoireWebAuthn {
    rp_id: String,
    rp_name: String,
}

#[cfg(feature = "webauthn")]
impl GrimoireWebAuthn {
    pub fn new(rp_id: String, rp_name: String) -> Self {
        Self { rp_id, rp_name }
    }

    fn build(&self, origin: &str) -> Result<webauthn_rs::Webauthn, String> {
        let rp_origin = webauthn_rs::prelude::Url::parse(origin)
            .map_err(|e| format!("invalid origin url: {}", e))?;
        webauthn_rs::WebauthnBuilder::new(&self.rp_id, &rp_origin)
            .map_err(|e| format!("failed to create webauthn builder: {}", e))?
            .rp_name(&self.rp_name)
            .build()
            .map_err(|e| format!("failed to build webauthn: {}", e))
    }

    pub fn start_registration(
        &self,
        origin: &str,
        user_id: &str,
        username: &str,
        exclude_credentials: Vec<webauthn_rs::prelude::CredentialID>,
    ) -> Result<
        (
            webauthn_rs::prelude::CreationChallengeResponse,
            webauthn_rs::prelude::PasskeyRegistration,
        ),
        String,
    > {
        let webauthn = self.build(origin)?;
        let user_unique_id = webauthn_rs::prelude::Uuid::new_v5(
            &webauthn_rs::prelude::Uuid::NAMESPACE_URL,
            user_id.as_bytes(),
        );
        webauthn
            .start_passkey_registration(
                user_unique_id,
                username,
                username,
                Some(exclude_credentials),
            )
            .map_err(|e| format!("start_registration failed: {}", e))
    }

    pub fn finish_registration(
        &self,
        origin: &str,
        reg: &webauthn_rs::prelude::RegisterPublicKeyCredential,
        state: &webauthn_rs::prelude::PasskeyRegistration,
    ) -> Result<Passkey, String> {
        let webauthn = self.build(origin)?;
        webauthn
            .finish_passkey_registration(reg, state)
            .map_err(|e| format!("finish_registration failed: {}", e))
    }

    pub fn start_authentication(
        &self,
        origin: &str,
        credentials: &[Passkey],
    ) -> Result<
        (
            webauthn_rs::prelude::RequestChallengeResponse,
            webauthn_rs::prelude::PasskeyAuthentication,
        ),
        String,
    > {
        let webauthn = self.build(origin)?;
        webauthn
            .start_passkey_authentication(credentials)
            .map_err(|e| format!("start_authentication failed: {}", e))
    }

    pub fn finish_authentication(
        &self,
        origin: &str,
        auth: &webauthn_rs::prelude::PublicKeyCredential,
        state: &webauthn_rs::prelude::PasskeyAuthentication,
    ) -> Result<webauthn_rs::prelude::AuthenticationResult, String> {
        let webauthn = self.build(origin)?;
        webauthn
            .finish_passkey_authentication(auth, state)
            .map_err(|e| format!("finish_authentication failed: {}", e))
    }

    /// start a discoverable-credential authentication challenge (no username required).
    /// the client sends an empty allowCredentials list; the platform authenticator
    /// presents whatever passkeys it has for this RP. use with finish_discoverable_authentication.
    pub fn start_discoverable_authentication(
        &self,
        origin: &str,
    ) -> Result<
        (
            webauthn_rs::prelude::RequestChallengeResponse,
            webauthn_rs::prelude::DiscoverableAuthentication,
        ),
        String,
    > {
        let webauthn = self.build(origin)?;
        webauthn
            .start_discoverable_authentication()
            .map_err(|e| format!("start_discoverable_authentication failed: {}", e))
    }

    /// extract the user UUID and credential ID from a discoverable credential response.
    /// call this before finish_discoverable_authentication to look up which user
    /// and which stored credential to verify against.
    /// security: this extracts the user_id the authenticator claims - it is NOT yet
    /// verified; verification happens in finish_discoverable_authentication.
    pub fn identify_discoverable_authentication<'a>(
        &self,
        origin: &str,
        reg: &'a webauthn_rs::prelude::PublicKeyCredential,
    ) -> Result<(uuid::Uuid, &'a [u8]), String> {
        let webauthn = self.build(origin)?;
        webauthn
            .identify_discoverable_authentication(reg)
            .map_err(|e| format!("identify_discoverable_authentication failed: {}", e))
    }

    /// complete a discoverable-credential authentication given the stored challenge
    /// and the specific credentials belonging to the identified user.
    pub fn finish_discoverable_authentication(
        &self,
        origin: &str,
        reg: &webauthn_rs::prelude::PublicKeyCredential,
        state: webauthn_rs::prelude::DiscoverableAuthentication,
        creds: &[webauthn_rs::prelude::Passkey],
    ) -> Result<webauthn_rs::prelude::AuthenticationResult, String> {
        let webauthn = self.build(origin)?;
        let discoverable_keys: Vec<webauthn_rs::prelude::DiscoverableKey> = creds
            .iter()
            .map(webauthn_rs::prelude::DiscoverableKey::from)
            .collect();
        webauthn
            .finish_discoverable_authentication(reg, state, &discoverable_keys)
            .map_err(|e| format!("finish_discoverable_authentication failed: {}", e))
    }
}
