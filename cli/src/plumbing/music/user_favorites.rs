//! User favorites CLI commands (music domain) - uses offal dispatch

use crate::plumbing::dispatch::dispatch_to_offal;
use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use serde_json::json;

#[derive(Subcommand)]
pub enum FavoritesAction {
    /// Set a favorite (song, artist, album)
    Set {
        /// Target type (song, artist, album, genre, playlist)
        #[arg(long)]
        target_type: String,
        /// Target ID
        #[arg(long)]
        target_id: String,
    },
    /// Remove a favorite
    Remove {
        /// Target type (song, artist, album, genre, playlist)
        #[arg(long)]
        target_type: String,
        /// Target ID
        #[arg(long)]
        target_id: String,
    },
    /// List user's favorites
    List {
        /// Filter by target type
        #[arg(long)]
        target_type: Option<String>,
        /// Maximum number of results
        #[arg(long, default_value = "50")]
        limit: i64,
    },
}

/// Handle favorites commands
pub async fn handle_command(action: FavoritesAction) -> CommandOutput<serde_json::Value> {
    match action {
        FavoritesAction::Set {
            target_type,
            target_id,
        } => {
            dispatch_to_offal(
                "/api/favorites/set",
                json!({
                    "target_type": target_type,
                    "target_id": target_id,
                    "is_favorite": true
                }),
            )
            .await
        }

        FavoritesAction::Remove {
            target_type,
            target_id,
        } => {
            dispatch_to_offal(
                "/api/favorites/set",
                json!({
                    "target_type": target_type,
                    "target_id": target_id,
                    "is_favorite": false
                }),
            )
            .await
        }

        FavoritesAction::List { target_type, limit } => {
            dispatch_to_offal(
                "/api/favorites/list",
                json!({
                    "target_type": target_type,
                    "limit": limit
                }),
            )
            .await
        }
    }
}
