//! Music-specific user models
//!
//! This module contains user-related types that are specific to music domain:
//! - Favorites (songs, artists, albums, genres, playlists)
//! - Ratings (songs, artists, albums)

use serde::{Deserialize, Serialize};
use std::fmt;

use crate::users::models::AuthError;

/// Target types for favorites
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
