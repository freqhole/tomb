//! User favorites CLI commands (music domain)

use crate::cli::utils::{CommandOutput, OutputFormat};
use crate::error::{GrimoireError, GrimoireResult};
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
pub async fn handle_command(action: FavoritesAction, format: OutputFormat) -> GrimoireResult<()> {
    let favorites_service = FavoritesService::new();

    match action {
        FavoritesAction::Set {
            user_id,
            target_type,
            target_id,
        } => {
            let favorite_target = parse_favorite_target(&target_type)?;

            let request = SetFavoriteRequest {
                user_id: user_id.clone(),
                target_type: favorite_target,
                target_id: target_id.clone(),
                is_favorite: true,
            };

            favorites_service
                .set_favorite(&request)
                .await
                .map_err(|e| GrimoireError::ProcessingFailed {
                    message: format!("Failed to set favorite: {}", e),
                })?;

            let message = format!("Favorite set: {} {}", target_type, target_id);
            let output = CommandOutput::success(message, ());
            print!("{}", output.format(format));
        }

        FavoritesAction::Remove {
            user_id,
            target_type,
            target_id,
        } => {
            let favorite_target = parse_favorite_target(&target_type)?;

            let request = SetFavoriteRequest {
                user_id: user_id.clone(),
                target_type: favorite_target,
                target_id: target_id.clone(),
                is_favorite: false,
            };

            favorites_service
                .set_favorite(&request)
                .await
                .map_err(|e| GrimoireError::ProcessingFailed {
                    message: format!("Failed to remove favorite: {}", e),
                })?;

            let message = format!("Favorite removed: {} {}", target_type, target_id);
            let output = CommandOutput::success(message, ());
            print!("{}", output.format(format));
        }

        FavoritesAction::List {
            user_id,
            target_type,
            limit,
        } => {
            let target_filter = target_type
                .as_ref()
                .map(|t| parse_favorite_target(t))
                .transpose()?;

            let favorites = favorites_service
                .get_user_favorites(&user_id, target_filter, Some(limit as u32), None)
                .await
                .map_err(|e| GrimoireError::ProcessingFailed {
                    message: format!("Failed to get favorites: {}", e),
                })?;

            let message = format!(
                "Found {} favorite{}",
                favorites.len(),
                if favorites.len() == 1 { "" } else { "s" }
            );
            let output = CommandOutput::success(message, favorites);
            print!("{}", output.format(format));
        }
    }

    Ok(())
}

fn parse_favorite_target(target_type: &str) -> GrimoireResult<FavoriteTarget> {
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
