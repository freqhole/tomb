//! User ratings CLI commands (music domain)

use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use grimoire::error::GrimoireError;
use grimoire::users::{RatingTarget, RatingsService, SetRatingRequest};

#[derive(Subcommand)]
pub enum RatingsAction {
    /// Set a rating (1-5) for a song, artist, or album
    Set {
        /// User ID
        #[arg(long)]
        user_id: String,
        /// Target type (song, artist, album)
        #[arg(long)]
        target_type: String,
        /// Target ID
        #[arg(long)]
        target_id: String,
        /// Rating (1-5)
        #[arg(long)]
        rating: i32,
    },
    /// Remove a rating
    Remove {
        /// User ID
        #[arg(long)]
        user_id: String,
        /// Target type (song, artist, album)
        #[arg(long)]
        target_type: String,
        /// Target ID
        #[arg(long)]
        target_id: String,
    },
    /// Show rating statistics for an entity
    Stats {
        /// Target type (song, artist, album)
        #[arg(long)]
        target_type: String,
        /// Target ID
        #[arg(long)]
        target_id: String,
    },
    /// Show top-rated entities
    TopRated {
        /// Target type (song, artist, album)
        #[arg(long)]
        target_type: String,
        /// Minimum number of ratings required
        #[arg(long, default_value = "5")]
        min_ratings: i32,
        /// Maximum number of results
        #[arg(long, default_value = "20")]
        limit: i64,
    },
}

/// Handle ratings commands
pub async fn handle_command(action: RatingsAction) -> CommandOutput<serde_json::Value> {
    let ratings_service = RatingsService::new();

    match action {
        RatingsAction::Set {
            user_id,
            target_type,
            target_id,
            rating,
        } => {
            let rating_target = match parse_rating_target(&target_type) {
                Ok(target) => target,
                Err(e) => {
                    return CommandOutput::failure("Invalid target type", vec![e.into()], ());
                }
            };

            let request = SetRatingRequest {
                user_id: user_id.clone(),
                target_type: rating_target,
                target_id: target_id.clone(),
                rating,
            };

            match ratings_service.set_rating(&request).await {
                Ok(_) => {
                    let message = format!(
                        "Rating set: {} {} - {} stars",
                        target_type, target_id, rating
                    );
                    CommandOutput::success(message, ())
                }
                Err(e) => CommandOutput::failure(
                    "Failed to set rating",
                    vec![GrimoireError::ProcessingFailed {
                        message: e.to_string(),
                    }
                    .into()],
                    (),
                ),
            }
        }

        RatingsAction::Remove {
            user_id,
            target_type,
            target_id,
        } => {
            let rating_target = match parse_rating_target(&target_type) {
                Ok(target) => target,
                Err(e) => {
                    return CommandOutput::failure("Invalid target type", vec![e.into()], ());
                }
            };

            match ratings_service
                .remove_rating(&user_id, rating_target, &target_id)
                .await
            {
                Ok(_) => {
                    let message = format!("Rating removed: {} {}", target_type, target_id);
                    CommandOutput::success(message, ())
                }
                Err(e) => CommandOutput::failure(
                    "Failed to remove rating",
                    vec![GrimoireError::ProcessingFailed {
                        message: e.to_string(),
                    }
                    .into()],
                    (),
                ),
            }
        }

        RatingsAction::Stats {
            target_type,
            target_id,
        } => {
            let rating_target = match parse_rating_target(&target_type) {
                Ok(target) => target,
                Err(e) => {
                    return CommandOutput::failure("Invalid target type", vec![e.into()], ());
                }
            };

            match ratings_service
                .get_rating_stats(rating_target, &target_id)
                .await
            {
                Ok(stats) => {
                    let message = format!(
                        "Rating stats for {} {}: {:.1} stars ({} ratings)",
                        target_type, target_id, stats.average_rating, stats.total_ratings
                    );
                    CommandOutput::success(message, stats)
                }
                Err(e) => CommandOutput::failure(
                    "Failed to get rating stats",
                    vec![GrimoireError::ProcessingFailed {
                        message: e.to_string(),
                    }
                    .into()],
                    (),
                ),
            }
        }

        RatingsAction::TopRated {
            target_type,
            min_ratings,
            limit,
        } => {
            let rating_target = match parse_rating_target(&target_type) {
                Ok(target) => target,
                Err(e) => {
                    return CommandOutput::failure("Invalid target type", vec![e.into()], ());
                }
            };

            match ratings_service
                .get_top_rated(rating_target, Some(min_ratings as u64), Some(limit as u32))
                .await
            {
                Ok(items) => {
                    let message = format!(
                        "Top {} rated {}{}",
                        items.len(),
                        target_type,
                        if items.len() == 1 { "" } else { "s" }
                    );
                    CommandOutput::success(message, items)
                }
                Err(e) => CommandOutput::failure(
                    "Failed to get top rated",
                    vec![GrimoireError::ProcessingFailed {
                        message: e.to_string(),
                    }
                    .into()],
                    (),
                ),
            }
        }
    }
}

fn parse_rating_target(target_type: &str) -> Result<RatingTarget, GrimoireError> {
    match target_type.to_lowercase().as_str() {
        "song" => Ok(RatingTarget::Song),
        "artist" => Ok(RatingTarget::Artist),
        "album" => Ok(RatingTarget::Album),
        _ => Err(GrimoireError::ProcessingFailed {
            message: format!(
                "Invalid target type: {}. Must be 'song', 'artist', or 'album'",
                target_type
            ),
        }),
    }
}
