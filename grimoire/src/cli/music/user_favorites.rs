//! User favorites CLI commands (music domain)

use crate::cli::utils::{CommandOutput, OutputFormat};
use crate::error::{GrimoireError, GrimoireResult};
use crate::response::GrimoireResponse;
use crate::users::{FavoriteTarget, FavoritesService, SetFavoriteRequest};
use clap::Subcommand;

// Temporary adapter to convert GrimoireResponse to Result for CLI compatibility
// TODO: Phase 5 will update CLI to use GrimoireResponse directly
fn to_result<T>(response: GrimoireResponse<T>) -> GrimoireResult<T> {
    if response.success {
        response
            .data
            .ok_or_else(|| GrimoireError::ProcessingFailed {
                message: "Response succeeded but contained no data".to_string(),
            })
    } else {
        let error_messages: Vec<String> =
            response.errors.iter().map(|e| e.detail.clone()).collect();
        Err(GrimoireError::ProcessingFailed {
            message: format!("{}: {}", response.message, error_messages.join(", ")),
        })
    }
}

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

            to_result(favorites_service.set_favorite(&request).await)?;

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

            to_result(favorites_service.set_favorite(&request).await)?;

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

            let favorites = to_result(
                favorites_service
                    .get_user_favorites(&user_id, target_filter, Some(limit as u32), Some(0))
                    .await,
            )?;

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
