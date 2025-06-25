use super::models::{AuthError, InviteCode, User, UserRole};
use crate::database::DatabaseConnection;
use uuid::Uuid;
use webauthn_rs::prelude::Passkey;

/// Repository for authentication-related database operations
pub struct AuthRepository<'a> {
    db: &'a DatabaseConnection,
}

impl<'a> AuthRepository<'a> {
    /// Create a new AuthRepository
    pub fn new(db: &'a DatabaseConnection) -> Self {
        Self { db }
    }

    // ========== Invite Code Operations ==========

    /// Create a new invite code
    pub async fn create_invite_code(&self, code: &str) -> Result<InviteCode, AuthError> {
        // Validate code length
        Self::validate_invite_code_format(code)?;

        let row = sqlx::query!(
            r#"
            INSERT INTO invite_codes (code)
            VALUES ($1)
            RETURNING id, code, created_at, used_at, used_by_user_id, is_active,
                      code_type, link_for_user_id, link_expires_at
            "#,
            code
        )
        .fetch_one(self.db.pool())
        .await?;

        Ok(InviteCode {
            id: row.id,
            code: row.code,
            created_at: row.created_at,
            used_at: row.used_at,
            used_by_user_id: row.used_by_user_id,
            is_active: row.is_active,
            code_type: row.code_type,
            link_for_user_id: row.link_for_user_id,
            link_expires_at: row.link_expires_at,
        })
    }

    /// Get an invite code by its code string
    pub async fn get_invite_code(&self, code: &str) -> Result<Option<InviteCode>, AuthError> {
        let row = sqlx::query!(
            r#"
            SELECT id, code, created_at, used_at, used_by_user_id, is_active,
                   code_type, link_for_user_id, link_expires_at
            FROM invite_codes
            WHERE code = $1
            "#,
            code
        )
        .fetch_optional(self.db.pool())
        .await?;

        Ok(row.map(|r| InviteCode {
            id: r.id,
            code: r.code,
            created_at: r.created_at,
            used_at: r.used_at,
            used_by_user_id: r.used_by_user_id,
            is_active: r.is_active,
            code_type: r.code_type,
            link_for_user_id: r.link_for_user_id,
            link_expires_at: r.link_expires_at,
        }))
    }

    /// Mark an invite code as used by a user
    pub async fn use_invite_code(&self, code: &str, user_id: Uuid) -> Result<bool, AuthError> {
        let result = sqlx::query!(
            r#"
            UPDATE invite_codes
            SET used_at = NOW(), used_by_user_id = $2
            WHERE code = $1 AND is_active = TRUE AND used_at IS NULL
            "#,
            code,
            user_id
        )
        .execute(self.db.pool())
        .await?;

        Ok(result.rows_affected() > 0)
    }

    /// Link a new credential to an existing user using an account link code
    pub async fn link_credential_to_user(
        &self,
        account_link_code: &str,
        credential: &webauthn_rs::prelude::Passkey,
    ) -> Result<User, AuthError> {
        // Get and validate the account link code
        let invite_code = self
            .get_invite_code(account_link_code)
            .await?
            .ok_or(AuthError::InvalidInviteCode)?;

        if !invite_code.is_account_link_code() {
            return Err(AuthError::InvalidInviteCode);
        }

        if !invite_code.is_valid_for_use() {
            return Err(AuthError::InvalidInviteCode);
        }

        let target_user_id = invite_code
            .get_target_user_id()
            .ok_or(AuthError::InvalidInviteCode)?;

        // Get the target user
        let user = self
            .get_user_by_id(target_user_id)
            .await?
            .ok_or(AuthError::UserNotFound)?;

        // Save the new credential for this user
        self.save_credential(target_user_id, credential).await?;

        // Mark the account link code as used
        self.use_invite_code(account_link_code, target_user_id)
            .await?;

        Ok(user)
    }

    /// Get a user by their ID
    pub async fn get_user_by_id(&self, user_id: Uuid) -> Result<Option<User>, AuthError> {
        let row = sqlx::query!(
            r#"
            SELECT id, username, role, created_at, invite_code_used
            FROM users
            WHERE id = $1
            "#,
            user_id
        )
        .fetch_optional(self.db.pool())
        .await?;

        Ok(row.map(|r| User {
            id: r.id,
            username: r.username,
            role: match r.role.as_str() {
                "admin" => UserRole::Admin,
                _ => UserRole::Member,
            },
            created_at: r.created_at,
            invite_code_used: r.invite_code_used,
        }))
    }

    /// List all invite codes, ordered by creation date
    pub async fn list_invite_codes(&self) -> Result<Vec<InviteCode>, AuthError> {
        let rows = sqlx::query!(
            r#"
            SELECT id, code, created_at, used_at, used_by_user_id, is_active,
                   code_type, link_for_user_id, link_expires_at
            FROM invite_codes
            ORDER BY created_at DESC
            "#,
        )
        .fetch_all(self.db.pool())
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| InviteCode {
                id: r.id,
                code: r.code,
                created_at: r.created_at,
                used_at: r.used_at,
                used_by_user_id: r.used_by_user_id,
                is_active: r.is_active,
                code_type: r.code_type,
                link_for_user_id: r.link_for_user_id,
                link_expires_at: r.link_expires_at,
            })
            .collect())
    }

    // ========== User Operations ==========

    /// Create a new user account
    pub async fn create_user(
        &self,
        username: &str,
        invite_code: Option<&str>,
    ) -> Result<User, AuthError> {
        self.create_user_with_role(username, invite_code, UserRole::Member)
            .await
    }

    /// Create a new user account with a specific role
    pub async fn create_user_with_role(
        &self,
        username: &str,
        invite_code: Option<&str>,
        role: UserRole,
    ) -> Result<User, AuthError> {
        let role_str = match role {
            UserRole::Admin => "admin",
            UserRole::Member => "member",
        };

        let row = sqlx::query!(
            r#"
            INSERT INTO users (username, role, invite_code_used)
            VALUES ($1, $2, $3)
            RETURNING id, username, role, created_at, invite_code_used
            "#,
            username,
            role_str,
            invite_code
        )
        .fetch_one(self.db.pool())
        .await?;

        let role = match row.role.as_str() {
            "admin" => UserRole::Admin,
            "member" => UserRole::Member,
            _ => UserRole::Member, // Default fallback
        };

        Ok(User {
            id: row.id,
            username: row.username,
            role,
            created_at: row.created_at,
            invite_code_used: row.invite_code_used,
        })
    }

    /// Get a user by their username
    pub async fn get_user_by_username(&self, username: &str) -> Result<Option<User>, AuthError> {
        let row = sqlx::query!(
            r#"
            SELECT id, username, role, created_at, invite_code_used
            FROM users
            WHERE username = $1
            "#,
            username
        )
        .fetch_optional(self.db.pool())
        .await?;

        Ok(row.map(|r| {
            let role = match r.role.as_str() {
                "admin" => UserRole::Admin,
                "member" => UserRole::Member,
                _ => UserRole::Member, // Default fallback
            };

            User {
                id: r.id,
                username: r.username,
                role,
                created_at: r.created_at,
                invite_code_used: r.invite_code_used,
            }
        }))
    }

    /// Update a user's role
    pub async fn update_user_role(&self, user_id: Uuid, role: UserRole) -> Result<(), AuthError> {
        let role_str = match role {
            UserRole::Admin => "admin",
            UserRole::Member => "member",
        };

        sqlx::query!(
            r#"
            UPDATE users
            SET role = $2
            WHERE id = $1
            "#,
            user_id,
            role_str
        )
        .execute(self.db.pool())
        .await?;

        Ok(())
    }

    /// List all users (admin function)
    pub async fn list_users(&self) -> Result<Vec<User>, AuthError> {
        let rows = sqlx::query!(
            r#"
            SELECT id, username, role, created_at, invite_code_used
            FROM users
            ORDER BY created_at DESC
            "#,
        )
        .fetch_all(self.db.pool())
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| {
                let role = match r.role.as_str() {
                    "admin" => UserRole::Admin,
                    "member" => UserRole::Member,
                    _ => UserRole::Member, // Default fallback
                };

                User {
                    id: r.id,
                    username: r.username,
                    role,
                    created_at: r.created_at,
                    invite_code_used: r.invite_code_used,
                }
            })
            .collect())
    }

    // ========== WebAuthn Credential Operations ==========

    /// Save a WebAuthn credential for a user
    pub async fn save_credential(&self, user_id: Uuid, passkey: &Passkey) -> Result<(), AuthError> {
        let credential_id = passkey.cred_id().as_ref().to_vec();
        let credential_data = serde_json::to_string(passkey)?;

        sqlx::query!(
            r#"
            INSERT INTO webauthn_credentials (user_id, credential_id, credential_data)
            VALUES ($1, $2, $3)
            ON CONFLICT (credential_id)
            DO UPDATE SET credential_data = $3, last_used_at = NOW()
            "#,
            user_id,
            credential_id,
            credential_data
        )
        .execute(self.db.pool())
        .await?;

        Ok(())
    }

    /// Get all WebAuthn credentials for a user
    pub async fn get_user_credentials(&self, user_id: Uuid) -> Result<Vec<Passkey>, AuthError> {
        let rows = sqlx::query!(
            r#"
            SELECT credential_data
            FROM webauthn_credentials
            WHERE user_id = $1
            "#,
            user_id
        )
        .fetch_all(self.db.pool())
        .await?;

        let mut credentials = Vec::new();
        for row in rows {
            let credential_data: String = row.credential_data;
            match serde_json::from_str::<Passkey>(&credential_data) {
                Ok(passkey) => credentials.push(passkey),
                Err(e) => {
                    tracing::error!("Failed to deserialize passkey: {}", e);
                }
            }
        }

        Ok(credentials)
    }

    /// Update an existing WebAuthn credential - using sqlx::query! for demo
    pub async fn update_credential(
        &self,
        user_id: Uuid,
        passkey: &Passkey,
    ) -> Result<(), AuthError> {
        let credential_id = passkey.cred_id().as_ref().to_vec();
        let credential_data = serde_json::to_string(passkey)?;

        // This one stays as sqlx::query! as an example of named parameters
        sqlx::query!(
            r#"
            UPDATE webauthn_credentials
            SET credential_data = $3, last_used_at = NOW()
            WHERE user_id = $1 AND credential_id = $2
            "#,
            user_id,         // $1
            credential_id,   // $2
            credential_data  // $3
        )
        .execute(self.db.pool())
        .await?;

        Ok(())
    }

    // ========== Validation Helpers ==========

    /// Validate invite code format and constraints
    fn validate_invite_code_format(code: &str) -> Result<(), AuthError> {
        const MIN_LENGTH: usize = 8;
        const MAX_LENGTH: usize = 128;

        if code.is_empty() {
            return Err(AuthError::InvalidInviteCodeFormat(
                "Code cannot be empty".to_string(),
            ));
        }

        if code.len() < MIN_LENGTH {
            return Err(AuthError::InviteCodeTooShort {
                min: MIN_LENGTH,
                actual: code.len(),
            });
        }

        if code.len() > MAX_LENGTH {
            return Err(AuthError::InviteCodeTooLong {
                max: MAX_LENGTH,
                actual: code.len(),
            });
        }

        // Ensure code only contains safe characters (alphanumeric, hyphens, underscores)
        if !code
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(AuthError::InvalidInviteCodeFormat(
                "Code must contain only alphanumeric characters, hyphens, and underscores"
                    .to_string(),
            ));
        }

        Ok(())
    }

    /// Create an account link code for an existing user
    pub async fn create_account_link_code(
        &self,
        user_id: Uuid,
        code: &str,
        expires_at: time::OffsetDateTime,
    ) -> Result<InviteCode, AuthError> {
        // Validate code format
        Self::validate_invite_code_format(code)?;

        let row = sqlx::query!(
            r#"
            INSERT INTO invite_codes (code, code_type, link_for_user_id, link_expires_at, is_active)
            VALUES ($1, 'account-link', $2, $3, true)
            RETURNING id, code, created_at, used_at, used_by_user_id, is_active,
                      code_type, link_for_user_id, link_expires_at
            "#,
            code,
            user_id,
            expires_at
        )
        .fetch_one(self.db.pool())
        .await?;

        Ok(InviteCode {
            id: row.id,
            code: row.code,
            created_at: row.created_at,
            used_at: row.used_at,
            used_by_user_id: row.used_by_user_id,
            is_active: row.is_active,
            code_type: row.code_type,
            link_for_user_id: row.link_for_user_id,
            link_expires_at: row.link_expires_at,
        })
    }
}
