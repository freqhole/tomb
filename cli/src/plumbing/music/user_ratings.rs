//! User ratings CLI commands (music domain) - uses offal dispatch

use crate::plumbing::dispatch::dispatch_to_offal;
use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use grimoire::users::RatingsService;
use serde_json::json;

#[derive(Subcommand)]
pub enum RatingsAction {
    /// Set a rating (1-5) for a song, artist, or album
    Set {
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
    /// Show top-rated entities (no offal route - direct call)
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
    match action {
        RatingsAction::Set {
            target_type,
            target_id,
            rating,
        } => {
            dispatch_to_offal(
                "/api/ratings/set",
                json!({
                    "target_type": target_type,
                    "target_id": target_id,
                    "rating": rating
                }),
            )
            .await
        }

        RatingsAction::Remove {
            target_type,
            target_id,
        } => {
            dispatch_to_offal(
                "/api/ratings/remove",
                json!({
                    "target_type": target_type,
                    "target_id": target_id
                }),
            )
            .await
        }

        RatingsAction::Stats {
            target_type,
            target_id,
        } => {
            dispatch_to_offal(
                "/api/ratings/stats",
                json!({
                    "target_type": target_type,
                    "target_id": target_id
                }),
            )
            .await
        }

        // TopRated has no offal route - use direct service call
        RatingsAction::TopRated {
            target_type,
            min_ratings,
            limit,
        } => {
            let rating_target = match target_type.to_lowercase().as_str() {
                "song" => grimoire::users::RatingTarget::Song,
                "artist" => grimoire::users::RatingTarget::Artist,
                "album" => grimoire::users::RatingTarget::Album,
                _ => {
                    return CommandOutput::failure(
                        "invalid target type - must be song, artist, or album",
                        vec![],
                        (),
                    )
                }
            };

            match RatingsService::new()
                .get_top_rated(rating_target, Some(min_ratings as u64), Some(limit as u32))
                .await
            {
                Ok(items) => CommandOutput::success(
                    format!("top {} rated {}", items.len(), target_type),
                    items,
                ),
                Err(e) => CommandOutput::failure(e.to_string(), vec![], ()),
            }
        }
    }
}
