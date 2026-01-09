//! User management CLI commands

use crate::cli::output::{CommandOutput, OutputFormat};
use crate::error::{GrimoireError, GrimoireResult};
use crate::users::{
    CreateInviteCodeRequest, CreateUserRequest, FavoriteTarget, FavoritesService, RatingTarget,
    RatingsService, SetFavoriteRequest, SetRatingRequest, UpdateUserRequest, User, UserQueryParams,
    UserRepository, UserRole, UserService,
};
use clap::Subcommand;
use serde::Serialize;

#[derive(Subcommand)]
pub enum UserAction {
    /// Create a new user
    Create {
        /// Username
        #[arg(long)]
        username: String,
        /// User role (admin, user, etc)
        #[arg(long)]
        role: Option<String>,
        /// Invite code to use
        #[arg(long)]
        invite_code: Option<String>,
        /// Bootstrap mode (skip invite code check)
        #[arg(long)]
        bootstrap: bool,
    },
    /// List users
    List {
        /// Filter by role
        #[arg(long)]
        role: Option<String>,
        /// Include deleted users
        #[arg(long)]
        include_deleted: bool,
        /// Maximum number of results
        #[arg(long, default_value = "50")]
        limit: i64,
        /// Offset for pagination
        #[arg(long, default_value = "0")]
        offset: i64,
    },
    /// Update user
    Update {
        /// User ID
        #[arg(long)]
        user_id: String,
        /// New role
        #[arg(long)]
        role: Option<String>,
    },
    /// Delete user
    Delete {
        /// User ID
        #[arg(long)]
        user_id: String,
    },
    /// Generate invite codes
    GenerateInvites {
        /// Number of codes to generate
        #[arg(long, default_value = "1")]
        count: usize,
        /// Number of words per code
        #[arg(long, default_value = "3")]
        word_count: usize,
        /// Code type (wordlist, random, etc)
        #[arg(long)]
        code_type: Option<String>,
        /// Expiration time in hours
        #[arg(long)]
        expires_hours: Option<i64>,
    },
    /// List invite codes
    ListInvites {
        /// Show only active codes
        #[arg(long)]
        active_only: bool,
    },
    /// Deactivate an invite code
    DeactivateInvite {
        /// Invite code
        code: String,
    },
    /// Set a favorite (song, artist, album)
    SetFavorite {
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
    /// Remove a favorite
    RemoveFavorite {
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
    /// List user's favorites
    ListFavorites {
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
    /// Set a rating (1-5) for a song, artist, or album
    SetRating {
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
    RemoveRating {
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
    RatingStats {
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

#[derive(Debug, Clone, Serialize)]
pub struct UserCreated {
    pub id: String,
    pub username: String,
    pub role: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct UserList {
    pub users: Vec<UserInfo>,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct UserInfo {
    pub id: String,
    pub username: String,
    pub role: String,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct InviteCodesGenerated {
    pub codes: Vec<InviteCodeInfo>,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct InviteCodeInfo {
    pub code: String,
    pub expires_at: Option<i64>,
}

/// Handle user commands
pub async fn handle_command(action: UserAction, format: OutputFormat) -> GrimoireResult<()> {
    let service = UserService::new();

    match action {
        UserAction::Create {
            username,
            role,
            invite_code,
            bootstrap,
        } => {
            println!("creating user: {}", username);

            let user_role = role.map(|r| match r.to_lowercase().as_str() {
                "admin" => UserRole::Admin,
                _ => UserRole::Member,
            });

            let request = CreateUserRequest {
                username: username.clone(),
                role: user_role,
                invite_code: if bootstrap { None } else { invite_code },
            };

            // Use bootstrap user creation for first admin, regular registration otherwise
            let user = if bootstrap {
                if user_role != Some(UserRole::Admin) {
                    return Err(GrimoireError::ProcessingFailed {
                        message: "bootstrap flag can only be used with --role admin".to_string(),
                    });
                }
                let repository = UserRepository::new();
                repository.create_user(&request).await.map_err(|e| {
                    GrimoireError::ProcessingFailed {
                        message: format!("Failed to create user: {}", e),
                    }
                })?
            } else {
                service.register_user(&request).await.map_err(|e| {
                    GrimoireError::ProcessingFailed {
                        message: format!("Failed to register user: {}", e),
                    }
                })?
            };

            let data = UserCreated {
                id: user.id,
                username: user.username,
                role: format!("{}", user.role),
                created_at: user.created_at,
            };

            let message = format!("User created: {}", data.username);
            let output = CommandOutput::success(message, data);
            print!("{}", output.format(format));
        }
        UserAction::List {
            role,
            include_deleted,
            limit,
            offset,
        } => {
            let user_role = role.map(|r| match r.to_lowercase().as_str() {
                "admin" => UserRole::Admin,
                _ => UserRole::Member,
            });

            let params = UserQueryParams {
                username: None,
                role: user_role,
                include_deleted: Some(include_deleted),
                limit: Some(limit as u32),
                offset: Some(offset as u32),
            };

            let admin_user = User {
                id: "cli-admin".to_string(),
                username: "cli".to_string(),
                role: UserRole::Admin,
                created_at: 0,
                updated_at: 0,
                deleted_at: None,
            };

            let users = service
                .list_users(&params, &admin_user)
                .await
                .map_err(|e| GrimoireError::ProcessingFailed {
                    message: format!("Failed to list users: {}", e),
                })?;

            let user_infos: Vec<UserInfo> = users
                .iter()
                .map(|u| UserInfo {
                    id: u.id.clone(),
                    username: u.username.clone(),
                    role: format!("{}", u.role),
                    deleted: u.is_deleted(),
                })
                .collect();

            let data = UserList {
                total: user_infos.len(),
                users: user_infos,
            };

            let message = format!(
                "Found {} user{}",
                data.total,
                if data.total == 1 { "" } else { "s" }
            );
            let output = CommandOutput::success(message, data);
            print!("{}", output.format(format));
        }
        UserAction::Update { user_id, role } => {
            let user_role = role.map(|r| match r.to_lowercase().as_str() {
                "admin" => UserRole::Admin,
                _ => UserRole::Member,
            });

            let request = UpdateUserRequest { role: user_role };

            let admin_user = User {
                id: "cli-admin".to_string(),
                username: "cli".to_string(),
                role: UserRole::Admin,
                created_at: 0,
                updated_at: 0,
                deleted_at: None,
            };

            let user = service
                .update_user(&user_id, &request, &admin_user)
                .await
                .map_err(|e| GrimoireError::ProcessingFailed {
                    message: format!("Failed to update user: {}", e),
                })?;

            let data = UserCreated {
                id: user.id,
                username: user.username,
                role: format!("{}", user.role),
                created_at: user.updated_at,
            };

            let message = format!("User updated: {}", data.username);
            let output = CommandOutput::success(message, data);
            print!("{}", output.format(format));
        }
        UserAction::Delete { user_id } => {
            let admin_user = User {
                id: "cli-admin".to_string(),
                username: "cli".to_string(),
                role: UserRole::Admin,
                created_at: 0,
                updated_at: 0,
                deleted_at: None,
            };

            service
                .delete_user(&user_id, &admin_user)
                .await
                .map_err(|e| GrimoireError::ProcessingFailed {
                    message: format!("Failed to delete user: {}", e),
                })?;

            let message = format!("User deleted: {}", user_id);
            let output = CommandOutput::success(message, ());
            print!("{}", output.format(format));
        }
        UserAction::GenerateInvites {
            count,
            word_count,
            code_type,
            expires_hours,
        } => {
            if !crate::wordlist::is_initialized() {
                let config = crate::wordlist::ManagementWordlistConfig::default();
                crate::wordlist::initialize_wordlist(&config).map_err(|e| {
                    GrimoireError::ProcessingFailed {
                        message: format!(
                            "Failed to initialize wordlist (file: {}): {}",
                            config.file_path, e
                        ),
                    }
                })?;
            }

            let invite_type = code_type
                .map(|ct| match ct.to_lowercase().as_str() {
                    "account-link" => crate::users::InviteCodeType::AccountLink,
                    _ => crate::users::InviteCodeType::Invite,
                })
                .unwrap_or_default();

            let request = CreateInviteCodeRequest {
                code_type: Some(invite_type),
                link_for_user_id: None,
                expires_hours: expires_hours.map(|h| h as u32),
            };

            let admin_user = User {
                id: "cli-admin".to_string(),
                username: "cli".to_string(),
                role: UserRole::Admin,
                created_at: 0,
                updated_at: 0,
                deleted_at: None,
            };

            let codes = service
                .generate_invite_codes(&request, count as u32, word_count, &admin_user)
                .await
                .map_err(|e| GrimoireError::ProcessingFailed {
                    message: format!("Failed to generate invite codes: {}", e),
                })?;

            let code_infos: Vec<InviteCodeInfo> = codes
                .iter()
                .map(|c| InviteCodeInfo {
                    code: c.code.clone(),
                    expires_at: c.link_expires_at,
                })
                .collect();

            let data = InviteCodesGenerated {
                count: code_infos.len(),
                codes: code_infos,
            };

            let message = format!(
                "Generated {} invite code{}",
                data.count,
                if data.count == 1 { "" } else { "s" }
            );
            let output = CommandOutput::success(message, data);
            print!("{}", output.format(format));
        }
        UserAction::ListInvites { active_only } => {
            let admin_user = User {
                id: "cli-admin".to_string(),
                username: "cli".to_string(),
                role: UserRole::Admin,
                created_at: 0,
                updated_at: 0,
                deleted_at: None,
            };

            let codes = service
                .list_invite_codes(active_only, &admin_user)
                .await
                .map_err(|e| GrimoireError::ProcessingFailed {
                    message: format!("Failed to list invite codes: {}", e),
                })?;

            let message = format!(
                "Found {} invite code{}",
                codes.len(),
                if codes.len() == 1 { "" } else { "s" }
            );
            let output = CommandOutput::success(message, codes);
            print!("{}", output.format(format));
        }
        UserAction::DeactivateInvite { code } => {
            let admin_user = User {
                id: "cli-admin".to_string(),
                username: "cli".to_string(),
                role: UserRole::Admin,
                created_at: 0,
                updated_at: 0,
                deleted_at: None,
            };

            service
                .deactivate_invite_code(&code, &admin_user)
                .await
                .map_err(|e| GrimoireError::ProcessingFailed {
                    message: format!("Failed to deactivate invite code: {}", e),
                })?;

            let message = format!("Invite code deactivated: {}", code);
            let output = CommandOutput::success(message, ());
            print!("{}", output.format(format));
        }
        UserAction::SetFavorite {
            user_id,
            target_type,
            target_id,
        } => {
            let favorite_target = match target_type.to_lowercase().as_str() {
                "song" => FavoriteTarget::Song,
                "artist" => FavoriteTarget::Artist,
                "album" => FavoriteTarget::Album,
                "genre" => FavoriteTarget::Genre,
                "playlist" => FavoriteTarget::Playlist,
                _ => {
                    return Err(GrimoireError::ProcessingFailed {
                        message: format!(
                            "Invalid target type: {}. Must be 'song', 'artist', 'album', 'genre', or 'playlist'",
                            target_type
                        ),
                    });
                }
            };

            let request = SetFavoriteRequest {
                user_id: user_id.clone(),
                target_type: favorite_target,
                target_id: target_id.clone(),
                is_favorite: true,
            };

            let favorites_service = FavoritesService::new();
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
        UserAction::RemoveFavorite {
            user_id,
            target_type,
            target_id,
        } => {
            let favorite_target = match target_type.to_lowercase().as_str() {
                "song" => FavoriteTarget::Song,
                "artist" => FavoriteTarget::Artist,
                "album" => FavoriteTarget::Album,
                "genre" => FavoriteTarget::Genre,
                "playlist" => FavoriteTarget::Playlist,
                _ => {
                    return Err(GrimoireError::ProcessingFailed {
                        message: format!(
                            "Invalid target type: {}. Must be 'song', 'artist', 'album', 'genre', or 'playlist'",
                            target_type
                        ),
                    });
                }
            };

            let request = SetFavoriteRequest {
                user_id: user_id.clone(),
                target_type: favorite_target,
                target_id: target_id.clone(),
                is_favorite: false,
            };

            let favorites_service = FavoritesService::new();
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
        UserAction::ListFavorites {
            user_id,
            target_type,
            limit,
        } => {
            let target_filter = target_type.and_then(|t| match t.to_lowercase().as_str() {
                "song" => Some(FavoriteTarget::Song),
                "artist" => Some(FavoriteTarget::Artist),
                "album" => Some(FavoriteTarget::Album),
                "genre" => Some(FavoriteTarget::Genre),
                "playlist" => Some(FavoriteTarget::Playlist),
                _ => None,
            });

            let favorites_service = FavoritesService::new();
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
        UserAction::SetRating {
            user_id,
            target_type,
            target_id,
            rating,
        } => {
            let rating_target = match target_type.to_lowercase().as_str() {
                "song" => RatingTarget::Song,
                "artist" => RatingTarget::Artist,
                "album" => RatingTarget::Album,
                _ => {
                    return Err(GrimoireError::ProcessingFailed {
                        message: format!(
                            "Invalid target type: {}. Must be 'song', 'artist', or 'album'",
                            target_type
                        ),
                    });
                }
            };

            let request = SetRatingRequest {
                user_id: user_id.clone(),
                target_type: rating_target,
                target_id: target_id.clone(),
                rating,
            };

            let ratings_service = RatingsService::new();
            ratings_service.set_rating(&request).await.map_err(|e| {
                GrimoireError::ProcessingFailed {
                    message: format!("Failed to set rating: {}", e),
                }
            })?;

            let message = format!(
                "Rating set: {} {} - {} stars",
                target_type, target_id, rating
            );
            let output = CommandOutput::success(message, ());
            print!("{}", output.format(format));
        }
        UserAction::RemoveRating {
            user_id,
            target_type,
            target_id,
        } => {
            let rating_target = match target_type.to_lowercase().as_str() {
                "song" => RatingTarget::Song,
                "artist" => RatingTarget::Artist,
                "album" => RatingTarget::Album,
                _ => {
                    return Err(GrimoireError::ProcessingFailed {
                        message: format!(
                            "Invalid target type: {}. Must be 'song', 'artist', or 'album'",
                            target_type
                        ),
                    });
                }
            };

            let ratings_service = RatingsService::new();
            ratings_service
                .remove_rating(&user_id, rating_target, &target_id)
                .await
                .map_err(|e| GrimoireError::ProcessingFailed {
                    message: format!("Failed to remove rating: {}", e),
                })?;

            let message = format!("Rating removed: {} {}", target_type, target_id);
            let output = CommandOutput::success(message, ());
            print!("{}", output.format(format));
        }
        UserAction::RatingStats {
            target_type,
            target_id,
        } => {
            let rating_target = match target_type.to_lowercase().as_str() {
                "song" => RatingTarget::Song,
                "artist" => RatingTarget::Artist,
                "album" => RatingTarget::Album,
                _ => {
                    return Err(GrimoireError::ProcessingFailed {
                        message: format!(
                            "Invalid target type: {}. Must be 'song', 'artist', or 'album'",
                            target_type
                        ),
                    });
                }
            };

            let ratings_service = RatingsService::new();
            let stats = ratings_service
                .get_rating_stats(rating_target, &target_id)
                .await
                .map_err(|e| GrimoireError::ProcessingFailed {
                    message: format!("Failed to get rating stats: {}", e),
                })?;

            let message = format!(
                "Rating stats for {} {}: {:.1} stars ({} ratings)",
                target_type, target_id, stats.average_rating, stats.total_ratings
            );
            let output = CommandOutput::success(message, stats);
            print!("{}", output.format(format));
        }
        UserAction::TopRated {
            target_type,
            min_ratings,
            limit,
        } => {
            let rating_target = match target_type.to_lowercase().as_str() {
                "song" => RatingTarget::Song,
                "artist" => RatingTarget::Artist,
                "album" => RatingTarget::Album,
                _ => {
                    return Err(GrimoireError::ProcessingFailed {
                        message: format!(
                            "Invalid target type: {}. Must be 'song', 'artist', or 'album'",
                            target_type
                        ),
                    });
                }
            };

            let ratings_service = RatingsService::new();
            let items = ratings_service
                .get_top_rated(rating_target, Some(min_ratings as u64), Some(limit as u32))
                .await
                .map_err(|e| GrimoireError::ProcessingFailed {
                    message: format!("Failed to get top rated: {}", e),
                })?;

            let message = format!(
                "Top {} rated {}{}",
                items.len(),
                target_type,
                if items.len() == 1 { "" } else { "s" }
            );
            let output = CommandOutput::success(message, items);
            print!("{}", output.format(format));
        }
    }

    Ok(())
}
