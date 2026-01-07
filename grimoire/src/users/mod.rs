//! User system module
//!
//! This module contains all user-related domain logic including
//! user authentication, authorization, favorites, and ratings.

pub mod favorites;
pub mod models;
pub mod ratings;
pub mod repository;
pub mod service;

// Re-export commonly used types
pub use favorites::{FavoriteTarget, FavoritesService};
pub use models::{
    AuthError, CreateInviteCodeRequest, CreateUserRequest, InviteCode, InviteCodeType,
    SetFavoriteRequest, SetRatingRequest, UpdateUserRequest, User, UserFavorite, UserQueryParams,
    UserRating, UserRole, UserSession, WebAuthnCredential,
};
pub use ratings::{RatingStats, RatingTarget, RatingsService};
pub use repository::UserRepository;
pub use service::UserService;
