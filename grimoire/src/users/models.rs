//! User system models
//!
//! This module contains all data types and structures used in the user system,
//! including users, roles, invite codes, favorites, ratings, and authentication.

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

    /// Check if this role can manage other users
    pub fn can_manage_users(&self) -> bool {
        self.is_admin()
    }
}

impl fmt::Display for UserRole {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            UserRole::Admin => write!(f, "admin"),
            UserRole::Member => write!(f, "member"),
        }
    }
}

impl From<String> for UserRole {
    fn from(s: String) -> Self {
        match s.to_lowercase().as_str() {
            "admin" => UserRole::Admin,
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
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
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

    /// Check if this user can manage other users
    pub fn can_manage_users(&self) -> bool {
        self.role.can_manage_users()
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

/// Target types for favorites and ratings
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FavoriteTarget {
    Song,
    Artist,
    Album,
    Genre,
    Playlist,
}

impl fmt::Display for FavoriteTarget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FavoriteTarget::Song => write!(f, "song"),
            FavoriteTarget::Artist => write!(f, "artist"),
            FavoriteTarget::Album => write!(f, "album"),
            FavoriteTarget::Genre => write!(f, "genre"),
            FavoriteTarget::Playlist => write!(f, "playlist"),
        }
    }
}

impl From<String> for FavoriteTarget {
    fn from(s: String) -> Self {
        match s.to_lowercase().as_str() {
            "artist" => FavoriteTarget::Artist,
            "album" => FavoriteTarget::Album,
            "genre" => FavoriteTarget::Genre,
            "playlist" => FavoriteTarget::Playlist,
            _ => FavoriteTarget::Song,
        }
    }
}

/// Target types for ratings (subset of favorite targets)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RatingTarget {
    Song,
    Artist,
    Album,
}

impl fmt::Display for RatingTarget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RatingTarget::Song => write!(f, "song"),
            RatingTarget::Artist => write!(f, "artist"),
            RatingTarget::Album => write!(f, "album"),
        }
    }
}

impl From<String> for RatingTarget {
    fn from(s: String) -> Self {
        match s.to_lowercase().as_str() {
            "artist" => RatingTarget::Artist,
            "album" => RatingTarget::Album,
            _ => RatingTarget::Song,
        }
    }
}

impl From<FavoriteTarget> for Option<RatingTarget> {
    fn from(target: FavoriteTarget) -> Self {
        match target {
            FavoriteTarget::Song => Some(RatingTarget::Song),
            FavoriteTarget::Artist => Some(RatingTarget::Artist),
            FavoriteTarget::Album => Some(RatingTarget::Album),
            FavoriteTarget::Genre | FavoriteTarget::Playlist => None,
        }
    }
}

/// User favorite record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserFavorite {
    pub id: String,
    pub user_id: String,
    pub target_type: FavoriteTarget,
    pub target_id: String,
    pub created_at: i64,
}

/// User rating record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserRating {
    pub id: String,
    pub user_id: String,
    pub target_type: RatingTarget,
    pub target_id: String,
    pub rating: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

impl UserRating {
    /// Validate that rating is within acceptable range (1-5)
    pub fn is_valid_rating(rating: i32) -> bool {
        (1..=5).contains(&rating)
    }
}

/// Request to create a new user
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub role: Option<UserRole>,
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

/// Request to set a favorite
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetFavoriteRequest {
    pub user_id: String,
    pub target_type: FavoriteTarget,
    pub target_id: String,
    pub is_favorite: bool,
}

/// Request to set a rating
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetRatingRequest {
    pub user_id: String,
    pub target_type: RatingTarget,
    pub target_id: String,
    pub rating: i32,
}

impl SetRatingRequest {
    /// Validate the rating request
    pub fn validate(&self) -> Result<(), AuthError> {
        if !UserRating::is_valid_rating(self.rating) {
            return Err(AuthError::InvalidRating {
                rating: self.rating,
                min: 1,
                max: 5,
            });
        }
        Ok(())
    }
}

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

        assert!(admin.is_admin());
        assert!(admin.can_access_analytics());
        assert!(admin.can_manage_invites());
        assert!(admin.can_manage_users());

        assert!(!member.is_admin());
        assert!(!member.can_access_analytics());
        assert!(!member.can_manage_invites());
        assert!(!member.can_manage_users());
    }

    #[test]
    fn test_user_role_display() {
        assert_eq!(UserRole::Admin.to_string(), "admin");
        assert_eq!(UserRole::Member.to_string(), "member");
    }

    #[test]
    fn test_user_role_from_string() {
        assert_eq!(UserRole::from("admin".to_string()), UserRole::Admin);
        assert_eq!(UserRole::from("ADMIN".to_string()), UserRole::Admin);
        assert_eq!(UserRole::from("member".to_string()), UserRole::Member);
        assert_eq!(UserRole::from("unknown".to_string()), UserRole::Member);
    }

    #[test]
    fn test_invite_code_type_display() {
        assert_eq!(InviteCodeType::Invite.to_string(), "invite");
        assert_eq!(InviteCodeType::AccountLink.to_string(), "account-link");
    }

    #[test]
    fn test_target_type_display() {
        assert_eq!(FavoriteTarget::Song.to_string(), "song");
        assert_eq!(FavoriteTarget::Artist.to_string(), "artist");
        assert_eq!(RatingTarget::Album.to_string(), "album");
    }

    #[test]
    fn test_valid_rating() {
        assert!(UserRating::is_valid_rating(1));
        assert!(UserRating::is_valid_rating(3));
        assert!(UserRating::is_valid_rating(5));
        assert!(!UserRating::is_valid_rating(0));
        assert!(!UserRating::is_valid_rating(6));
    }

    #[test]
    fn test_set_rating_request_validation() {
        let valid_request = SetRatingRequest {
            user_id: "user1".to_string(),
            target_type: RatingTarget::Song,
            target_id: "song1".to_string(),
            rating: 4,
        };
        assert!(valid_request.validate().is_ok());

        let invalid_request = SetRatingRequest {
            user_id: "user1".to_string(),
            target_type: RatingTarget::Song,
            target_id: "song1".to_string(),
            rating: 0,
        };
        assert!(invalid_request.validate().is_err());
    }
}
