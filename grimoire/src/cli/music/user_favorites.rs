//! User favorites CLI commands (music domain)

use crate::cli::utils::CommandOutput;
use crate::error::GrimoireError;
use crate::users::{FavoriteTarget, FavoritesService, SetFavoriteRequest};
use clap::Subcommand;

#[derive(Subcommand)]
pub enum FavoritesAction {
    /// Set a favorite (song, artist, album)
    Set {
        /// User ID
        #[arg(long)]
        user_id: String,
        /// Target type (song, artist, album, genre, playlist)
        #[arg(long)]
        target_type: String,
        /// Target ID
        #[arg(long)]
        target_id: String,
    },
    /// Remove a favorite
    Remove {
        /// User ID
        #[arg(long)]
        user_id: String,
        /// Target type (song, artist, album, genre, playlist)
        #[arg(long)]
        target_type: String,
        /// Target ID
        #[arg(long)]
        target_id: String,
    },
    /// List user's favorites
    List {
        /// User ID
        #[arg(long)]
        user_id: String,
        /// Filter by target type
        #[arg(long)]
        target_type: Option<String>,
        /// Maximum number of results
        #[arg(long, default_value = "50")]
        limit: i64,
    },
}

/// Handle favorites commands
pub async fn handle_command(action: FavoritesAction) -> CommandOutput<()> {
    let favorites_service = FavoritesService::new();

    match action {
        FavoritesAction::Set {
            user_id,
            target_type,
            target_id,
        } => {
            let favorite_target = match parse_favorite_target(&target_type) {
                Ok(target) => target,
                Err(e) => {
                    return CommandOutput::failure("Invalid target type", vec![e.into()], ());
                }
            };

            let request = SetFavoriteRequest {
                user_id: user_id.clone(),
                target_type: favorite_target,
                target_id: target_id.clone(),
                is_favorite: true,
            };

            let response = favorites_service.set_favorite(&request).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let message = format!("Favorite set: {} {}", target_type, target_id);
            CommandOutput::success(message, ())
        }

        FavoritesAction::Remove {
            user_id,
            target_type,
            target_id,
        } => {
            let favorite_target = match parse_favorite_target(&target_type) {
                Ok(target) => target,
                Err(e) => {
                    return CommandOutput::failure("Invalid target type", vec![e.into()], ());
                }
            };

            let request = SetFavoriteRequest {
                user_id: user_id.clone(),
                target_type: favorite_target,
                target_id: target_id.clone(),
                is_favorite: false,
            };

            let response = favorites_service.set_favorite(&request).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let message = format!("Favorite removed: {} {}", target_type, target_id);
            CommandOutput::success(message, ())
        }

        FavoritesAction::List {
            user_id,
            target_type,
            limit,
        } => {
            let target_filter = match target_type.as_ref() {
                Some(t) => match parse_favorite_target(t) {
                    Ok(target) => Some(target),
                    Err(e) => {
                        return CommandOutput::failure("Invalid target type", vec![e.into()], ());
                    }
                },
                None => None,
            };

            let response = favorites_service
                .get_user_favorites(&user_id, target_filter, Some(limit as u32), Some(0))
                .await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(favorites) = response.data else {
                return CommandOutput::failure("No favorites data returned", vec![], ());
            };

            let message = format!(
                "Found {} favorite{}",
                favorites.len(),
                if favorites.len() == 1 { "" } else { "s" }
            );
            CommandOutput::success(message, favorites).map_data(|_| ())
        }
    }
}

fn parse_favorite_target(target_type: &str) -> Result<FavoriteTarget, GrimoireError> {
    match target_type.to_lowercase().as_str() {
        "song" => Ok(FavoriteTarget::Song),
        "artist" => Ok(FavoriteTarget::Artist),
        "album" => Ok(FavoriteTarget::Album),
        "genre" => Ok(FavoriteTarget::Genre),
        "playlist" => Ok(FavoriteTarget::Playlist),
        _ => Err(GrimoireError::ProcessingFailed {
            message: format!(
                "Invalid target type: {}. Must be 'song', 'artist', 'album', 'genre', or 'playlist'",
                target_type
            ),
        }),
    }
}
