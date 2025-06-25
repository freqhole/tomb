use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

/// User roles in the system
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    /// System administrator with full access
    Admin,
    /// Regular authenticated user
    Member,
}

impl Default for UserRole {
    fn default() -> Self {
        UserRole::Member
    }
}

impl UserRole {
    /// Check if this role has admin privileges
    pub fn is_admin(&self) -> bool {
        matches!(self, UserRole::Admin)
    }

    /// Check if this role can access analytics
    pub fn can_access_analytics(&self) -> bool {
        self.is_admin()
    }

    /// Check if this role can manage invite codes
    pub fn can_manage_invites(&self) -> bool {
        self.is_admin()
    }
}

/// User account information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub role: UserRole,
    pub created_at: OffsetDateTime,
    pub invite_code_used: Option<String>,
}

impl User {
    /// Check if this user has admin privileges
    pub fn is_admin(&self) -> bool {
        self.role.is_admin()
    }

    /// Check if this user can access analytics
    pub fn can_access_analytics(&self) -> bool {
        self.role.can_access_analytics()
    }

    /// Check if this user can manage invite codes
    pub fn can_manage_invites(&self) -> bool {
        self.role.can_manage_invites()
    }
}

/// Invite code for user registration
/// Invite code model
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InviteCode {
    pub id: Uuid,
    pub code: String,
    pub created_at: OffsetDateTime,
    pub used_at: Option<OffsetDateTime>,
    pub used_by_user_id: Option<Uuid>,
    pub is_active: bool,
    pub code_type: String,
    pub link_for_user_id: Option<Uuid>,
    pub link_expires_at: Option<OffsetDateTime>,
}

impl InviteCode {
    /// Check if this is an account link code (vs regular invite code)
    pub fn is_account_link_code(&self) -> bool {
        self.code_type == "account-link"
    }

    /// Check if this is a regular invite code
    pub fn is_invite_code(&self) -> bool {
        self.code_type == "invite"
    }

    /// Check if the account link code has expired
    pub fn is_expired(&self) -> bool {
        if let Some(expires_at) = self.link_expires_at {
            time::OffsetDateTime::now_utc() > expires_at
        } else {
            false
        }
    }

    /// Check if the code is valid for use (active, not used, not expired)
    pub fn is_valid_for_use(&self) -> bool {
        self.is_active && self.used_at.is_none() && !self.is_expired()
    }

    /// Get the target user ID for account link codes
    pub fn get_target_user_id(&self) -> Option<Uuid> {
        if self.is_account_link_code() {
            self.link_for_user_id
        } else {
            None
        }
    }
}

/// WebAuthn credential storage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebauthnCredential {
    pub id: Uuid,
    pub user_id: Uuid,
    pub credential_id: Vec<u8>,
    pub credential_data: String,
    pub created_at: OffsetDateTime,
    pub last_used_at: Option<OffsetDateTime>,
}

/// Session information for authenticated users
#[derive(Debug, Clone)]
pub struct AuthenticatedUser {
    pub user: User,
    pub session_id: String,
    pub authenticated_at: OffsetDateTime,
}

/// Authentication errors
#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("User not found")]
    UserNotFound,
    #[error("Invalid invite code")]
    InvalidInviteCode,
    #[error("Invalid invite code format: {0}")]
    InvalidInviteCodeFormat(String),
    #[error("Invite code too short: minimum {min} characters, got {actual}")]
    InviteCodeTooShort { min: usize, actual: usize },
    #[error("Invite code too long: maximum {max} characters, got {actual}")]
    InviteCodeTooLong { max: usize, actual: usize },
    #[error("Invite code already used")]
    InviteCodeAlreadyUsed,
    #[error("Username already exists")]
    UsernameAlreadyExists,
    #[error("Authentication required")]
    AuthenticationRequired,
    #[error("Insufficient permissions")]
    InsufficientPermissions,
    #[error("Admin access required")]
    AdminRequired,
    #[error("WebAuthn error: {0}")]
    WebAuthn(String),
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

impl From<webauthn_rs::prelude::WebauthnError> for AuthError {
    fn from(err: webauthn_rs::prelude::WebauthnError) -> Self {
        AuthError::WebAuthn(err.to_string())
    }
}
