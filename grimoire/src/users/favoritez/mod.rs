//! domain-agnostic favorites + ratings functionality
//!
//! favorites/ratings target any `FavoriteTarget`/`RatingTarget` (song, artist,
//! album, taxon, playlist, video, ...) by (target_type, target_id) pair - not
//! tied to any one domain. historically this lived under `music::users`, but
//! the service layer itself never depended on music-only concepts (the only
//! music-specific bit is a best-effort feed-event integration in
//! `crate::music::analytics::feed_events`, which simply no-ops for target
//! types it doesn't recognize yet, e.g. video).

pub mod favorites;
pub mod models;
pub mod ratings;

// Re-export main types for convenience
pub use favorites::FavoritesService;
pub use models::{
    FavoriteTarget, RatingTarget, SetFavoriteRequest, SetRatingRequest, UserFavorite, UserRating,
};
pub use ratings::{RatingStats, RatingsService};
