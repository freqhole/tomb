//! User system module
//!
//! This module contains application-level user domain logic including
//! user authentication, authorization, and account management.
//!
//! Music-specific user functionality (favorites, ratings) has been moved
//! to `music::users` module to maintain clear domain boundaries.

pub mod models;
pub mod repository;
pub mod service;
pub mod webauthn;
pub mod webauthn_models;

// Re-export commonly used types
pub use models::{
    // API response types
    ApiKeyRegenerateResponse,
    ApiKeyStatusResponse,
    AuthError,
    CreateInviteCodeRequest,
    CreateUserRequest,
    InviteCode,
    // CLI response types
    InviteCodeInfoResponse,
    InviteCodeType,
    InviteCodesGeneratedResponse,
    PeerNodeWithUser,
    RedeemInviteRequest,
    UpdateUserRequest,
    User,
    UserCreatedResponse,
    UserInfoResponse,
    UserListResponse,
    // Federation / P2P types
    UserPeerNode,
    UserQueryParams,
    UserRole,
    UserSession,
    WebAuthnCredential,
    WhoAmIResponse,
};
pub use service::UserService;
pub use webauthn::WebAuthnService;
pub use webauthn_models::{RegisterStartRequest, StartLoginRequest};

// Re-export music-specific user types from music::users for backwards compatibility
pub use crate::music::users::{
    FavoriteTarget, FavoritesService, RatingStats, RatingTarget, RatingsService,
    SetFavoriteRequest, SetRatingRequest, UserFavorite, UserRating,
};

/// Find a user by their API key (for authentication)
pub async fn find_user_by_api_key(api_key: &str) -> crate::response::GrimoireResponse<User> {
    let service = UserService::new();
    service.get_user_by_api_key(api_key).await
}

/// Get a user by their ID
pub async fn get_user(user_id: &str) -> crate::response::GrimoireResponse<User> {
    let service = UserService::new();
    service.get_user(user_id).await
}

/// Get the first root user's ID (for system operations like scanning)
///
/// Returns None if no root user exists.
pub async fn get_root_user_id() -> Option<String> {
    let service = UserService::new();
    let response = service.get_first_root_user().await;
    response.data.map(|u| u.id)
}
