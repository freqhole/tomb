//! Music-specific user functionality
//!
//! This module contains user features that are specific to the music domain:
//! - Favorites: User favorites for songs, artists, albums, genres, and playlists
//! - Ratings: User ratings for songs, artists, and albums
//!
//! This is separate from the main `users` module which handles application-level
//! user concerns (accounts, authentication, invites).

pub mod favorites;
pub mod models;
pub mod ratings;

// Re-export main types for convenience
pub use favorites::FavoritesService;
pub use models::{
    FavoriteTarget, RatingTarget, SetFavoriteRequest, SetRatingRequest, UserFavorite, UserRating,
};
pub use ratings::{RatingStats, RatingsService};
