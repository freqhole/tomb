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

// Re-export commonly used types
pub use models::{
    AuthError,
    CreateInviteCodeRequest,
    CreateUserRequest,
    InviteCode,
    // CLI response types
    InviteCodeInfoResponse,
    InviteCodeType,
    InviteCodesGeneratedResponse,
    UpdateUserRequest,
    User,
    UserCreatedResponse,
    UserInfoResponse,
    UserListResponse,
    UserQueryParams,
    UserRole,
    UserSession,
    WebAuthnCredential,
};
pub use repository::UserRepository;
pub use service::UserService;

// Re-export music-specific user types from music::users for backwards compatibility
pub use crate::music::users::{
    FavoriteTarget, FavoritesService, RatingStats, RatingTarget, RatingsService,
    SetFavoriteRequest, SetRatingRequest, UserFavorite, UserRating,
};
