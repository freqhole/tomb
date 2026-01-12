//! User system models
//!
//! This module contains all data types and structures used in the user system,
//! including users, roles, invite codes, favorites, ratings, and authentication.

use crate::error::ErrorDetail;
use serde::{Deserialize, Serialize};
use std::fmt;
use thiserror::Error;
use time::OffsetDateTime;

/// User roles in the system
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    /// System administrator with full access
    Admin,
    /// Regular authenticated user
    #[default]
    Member,
    /// Read-only viewer (can browse/play/favorite, cannot upload/edit/fetch)
    Viewer,
}

impl UserRole {
    /// Check if this role has admin privileges
    pub fn is_admin(&self) -> bool {
        matches!(self, UserRole::Admin)
    }

    /// Check if this role is viewer (read-only)
    pub fn is_viewer(&self) -> bool {
        matches!(self, UserRole::Viewer)
    }
}

impl fmt::Display for UserRole {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            UserRole::Admin => write!(f, "admin"),
            UserRole::Member => write!(f, "member"),
            UserRole::Viewer => write!(f, "viewer"),
        }
    }
}

impl From<String> for UserRole {
    fn from(s: String) -> Self {
        match s.to_lowercase().as_str() {
            "admin" => UserRole::Admin,
            "viewer" => UserRole::Viewer,
            _ => UserRole::Member,
        }
    }
}

/// User account information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub username: String,
    pub role: UserRole,
    pub api_key: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

impl User {
    /// Check if this user has admin privileges
    pub fn is_admin(&self) -> bool {
        self.role.is_admin()
    }

    /// Check if this user is a viewer (read-only)
    pub fn is_viewer(&self) -> bool {
        self.role.is_viewer()
    }

    /// Check if this user account is soft-deleted
    pub fn is_deleted(&self) -> bool {
        self.deleted_at.is_some()
    }
}

/// Invite code types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum InviteCodeType {
    /// Regular invite code for new user registration
    #[default]
    Invite,
    /// Account linking code for existing users
    AccountLink,
}

impl fmt::Display for InviteCodeType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            InviteCodeType::Invite => write!(f, "invite"),
            InviteCodeType::AccountLink => write!(f, "account-link"),
        }
    }
}

impl From<String> for InviteCodeType {
    fn from(s: String) -> Self {
        match s.to_lowercase().as_str() {
            "account-link" => InviteCodeType::AccountLink,
            _ => InviteCodeType::Invite,
        }
    }
}

/// Invite code for user registration and account linking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InviteCode {
    pub id: String,
    pub code: String,
    pub created_at: i64,
    pub used_at: Option<i64>,
    pub used_by_id: Option<String>,
    pub is_active: bool,
    pub code_type: InviteCodeType,
    pub link_for_user_id: Option<String>,
    pub link_expires_at: Option<i64>,
}

impl InviteCode {
    /// Check if this is an account link code (vs regular invite code)
    pub fn is_account_link_code(&self) -> bool {
        self.code_type == InviteCodeType::AccountLink
    }

    /// Check if this is a regular invite code
    pub fn is_invite_code(&self) -> bool {
        self.code_type == InviteCodeType::Invite
    }

    /// Check if the account link code has expired
    pub fn is_expired(&self) -> bool {
        if let Some(expires_at) = self.link_expires_at {
            OffsetDateTime::now_utc().unix_timestamp() > expires_at
        } else {
            false
        }
    }

    /// Check if the code is valid for use (active, not used, not expired)
    pub fn is_valid_for_use(&self) -> bool {
        self.is_active && self.used_at.is_none() && !self.is_expired()
    }

    /// Get the target user ID for account link codes
    pub fn get_target_user_id(&self) -> Option<&String> {
        if self.is_account_link_code() {
            self.link_for_user_id.as_ref()
        } else {
            None
        }
    }
}

/// WebAuthn credential storage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebAuthnCredential {
    pub id: String,
    pub user_id: String,
    pub credential_id: Vec<u8>,
    pub credential_data: String,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
    pub deleted_at: Option<i64>,
}

impl WebAuthnCredential {
    /// Check if this credential is soft-deleted
    pub fn is_deleted(&self) -> bool {
        self.deleted_at.is_some()
    }
}

/// User session information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserSession {
    pub id: String,
    pub user_id: String,
    pub created_at: i64,
    pub last_accessed_at: i64,
    pub expires_at: Option<i64>,
    pub user_agent: Option<String>,
    pub ip_address: Option<String>,
}

impl UserSession {
    /// Check if the session has expired
    pub fn is_expired(&self) -> bool {
        if let Some(expires_at) = self.expires_at {
            OffsetDateTime::now_utc().unix_timestamp() > expires_at
        } else {
            false
        }
    }

    /// Check if the session is valid (not expired)
    pub fn is_valid(&self) -> bool {
        !self.is_expired()
    }
}

// Music-specific types (FavoriteTarget, RatingTarget, UserFavorite, UserRating)
// have been moved to music::users::models
// Re-exported from users::mod for backwards compatibility

/// Request to create a new user
#[derive(Debug, Clone, Serialize, Deserialize, clap::Parser)]
pub struct CreateUserRequest {
    /// Username for the new user
    #[arg(long)]
    pub username: String,
    /// User role (admin or member)
    #[arg(long)]
    pub role: Option<UserRole>,
    /// Invite code to validate registration
    #[arg(long)]
    pub invite_code: Option<String>,
}

/// Request to update an existing user
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateUserRequest {
    pub role: Option<UserRole>,
}

/// Request to create an invite code
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateInviteCodeRequest {
    pub code_type: Option<InviteCodeType>,
    pub link_for_user_id: Option<String>,
    pub expires_hours: Option<u32>,
}

// Music-specific request types (SetFavoriteRequest, SetRatingRequest)
// have been moved to music::users::models
// Re-exported from users::mod for backwards compatibility

/// Query parameters for user searches
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserQueryParams {
    pub username: Option<String>,
    pub role: Option<UserRole>,
    pub include_deleted: Option<bool>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

impl Default for UserQueryParams {
    fn default() -> Self {
        Self {
            username: None,
            role: None,
            include_deleted: Some(false),
            limit: Some(50),
            offset: Some(0),
        }
    }
}

/// Authentication and user system errors
#[derive(Debug, Error)]
pub enum AuthError {
    #[error("User not found")]
    UserNotFound,

    #[error("User not found: {username}")]
    UserNotFoundByUsername { username: String },

    #[error("User already exists: {username}")]
    UserAlreadyExists { username: String },

    #[error("Invalid invite code")]
    InvalidInviteCode,

    #[error("Invalid invite code format: {0}")]
    InvalidInviteCodeFormat(String),

    #[error("Invite code not found: {code}")]
    InviteCodeNotFound { code: String },

    #[error("Invite code already used")]
    InviteCodeAlreadyUsed,

    #[error("Invite code has expired")]
    InviteCodeExpired,

    #[error("Invalid rating: {rating} (must be between {min} and {max})")]
    InvalidRating { rating: i32, min: i32, max: i32 },

    #[error("Authentication required")]
    AuthenticationRequired,

    #[error("Insufficient permissions")]
    InsufficientPermissions,

    #[error("Admin access required")]
    AdminRequired,

    #[error("Invalid username: {reason}")]
    InvalidUsername { reason: String },

    #[error("WebAuthn error: {0}")]
    WebAuthn(String),

    #[error("Database error: {0}")]
    Database(String),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Configuration error: {0}")]
    Config(String),
}

impl From<sqlx::Error> for AuthError {
    fn from(err: sqlx::Error) -> Self {
        AuthError::Database(err.to_string())
    }
}

impl From<crate::error::GrimoireError> for AuthError {
    fn from(err: crate::error::GrimoireError) -> Self {
        AuthError::Database(err.to_string())
    }
}

impl From<AuthError> for ErrorDetail {
    fn from(err: AuthError) -> Self {
        let error_type = match &err {
            AuthError::UserNotFound => "user_not_found",
            AuthError::UserNotFoundByUsername { .. } => "user_not_found",
            AuthError::UserAlreadyExists { .. } => "user_already_exists",
            AuthError::InvalidInviteCode => "invalid_invite_code",
            AuthError::InvalidInviteCodeFormat(_) => "invalid_invite_code_format",
            AuthError::InviteCodeNotFound { .. } => "invite_code_not_found",
            AuthError::InviteCodeAlreadyUsed => "invite_code_already_used",
            AuthError::InviteCodeExpired => "invite_code_expired",
            AuthError::InvalidRating { .. } => "invalid_rating",
            AuthError::AuthenticationRequired => "authentication_required",
            AuthError::InsufficientPermissions => "insufficient_permissions",
            AuthError::AdminRequired => "admin_required",
            AuthError::InvalidUsername { .. } => "invalid_username",
            AuthError::WebAuthn(_) => "webauthn_error",
            AuthError::Database(_) => "database_error",
            AuthError::Serialization(_) => "serialization_error",
            AuthError::Config(_) => "config_error",
        };

        let title = error_type
            .split('_')
            .map(|word| {
                let mut chars = word.chars();
                match chars.next() {
                    None => String::new(),
                    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                }
            })
            .collect::<Vec<_>>()
            .join(" ");

        ErrorDetail {
            error_type: error_type.to_string(),
            title,
            detail: err.to_string(),
        }
    }
}

#[cfg(feature = "webauthn")]
impl From<webauthn_rs::prelude::WebauthnError> for AuthError {
    fn from(err: webauthn_rs::prelude::WebauthnError) -> Self {
        AuthError::WebAuthn(err.to_string())
    }
}

/// Result type for auth operations
pub type AuthResult<T> = Result<T, AuthError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_user_role_permissions() {
        let admin = UserRole::Admin;
        let member = UserRole::Member;
        let viewer = UserRole::Viewer;

        // admin permissions
        assert!(admin.is_admin());
        assert!(!admin.is_viewer());

        // member permissions
        assert!(!member.is_admin());
        assert!(!member.is_viewer());

        // viewer permissions (read-only)
        assert!(!viewer.is_admin());
        assert!(viewer.is_viewer());
    }

    #[test]
    fn test_user_role_display() {
        assert_eq!(UserRole::Admin.to_string(), "admin");
        assert_eq!(UserRole::Member.to_string(), "member");
        assert_eq!(UserRole::Viewer.to_string(), "viewer");
    }

    #[test]
    fn test_user_role_from_string() {
        assert_eq!(UserRole::from("admin".to_string()), UserRole::Admin);
        assert_eq!(UserRole::from("ADMIN".to_string()), UserRole::Admin);
        assert_eq!(UserRole::from("member".to_string()), UserRole::Member);
        assert_eq!(UserRole::from("viewer".to_string()), UserRole::Viewer);
        assert_eq!(UserRole::from("VIEWER".to_string()), UserRole::Viewer);
        assert_eq!(UserRole::from("unknown".to_string()), UserRole::Member);
    }

    #[test]
    fn test_invite_code_type_display() {
        assert_eq!(InviteCodeType::Invite.to_string(), "invite");
        assert_eq!(InviteCodeType::AccountLink.to_string(), "account-link");
    }

    // Tests for music-specific types (FavoriteTarget, RatingTarget, UserRating, SetRatingRequest)
    // have been moved to music/users/models.rs
}

// ============================================================================
// CLI Response Types
// ============================================================================

/// Response for user creation (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserCreatedResponse {
    pub id: String,
    pub username: String,
    pub role: String,
    pub created_at: i64,
}

/// Response for listing users (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserListResponse {
    pub users: Vec<UserInfoResponse>,
    pub total: usize,
}

/// Response for individual user info (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfoResponse {
    pub id: String,
    pub username: String,
    pub role: String,
    pub deleted: bool,
}

/// Response for invite code generation (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InviteCodesGeneratedResponse {
    pub codes: Vec<InviteCodeInfoResponse>,
    pub count: usize,
}

/// Response for individual invite code info (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InviteCodeInfoResponse {
    pub code: String,
    pub expires_at: Option<i64>,
}
