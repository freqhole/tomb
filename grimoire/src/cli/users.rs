//! User management CLI commands

use crate::error::GrimoireResult;
use crate::users::{
    CreateInviteCodeRequest, CreateUserRequest, FavoriteTarget, RatingTarget, SetFavoriteRequest,
    SetRatingRequest, UpdateUserRequest, UserQueryParams, UserRepository, UserRole, UserService,
};
use clap::Subcommand;

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

/// Handle user commands
pub async fn handle_command(action: UserAction) -> GrimoireResult<()> {
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
            let result = if bootstrap {
                if user_role != Some(UserRole::Admin) {
                    eprintln!("bootstrap flag can only be used with --role admin");
                    std::process::exit(1);
                }
                // Directly use repository to bypass invite code validation for bootstrap
                let repository = UserRepository::new();
                repository.create_user(&request).await
            } else {
                service.register_user(&request).await
            };

            match result {
                Ok(user) => {
                    println!("user created successfully:");
                    println!("  ID: {}", user.id);
                    println!("  Username: {}", user.username);
                    println!("  Role: {}", user.role);
                    println!(
                        "  Created: {}",
                        super::utils::format_timestamp(user.created_at)
                    );
                }
                Err(e) => {
                    eprintln!("failed to create user: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::List {
            role,
            include_deleted,
            limit,
            offset,
        } => {
            println!("listing users...");

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

            // For CLI, we'll create a dummy admin user for authorization
            let admin_user = crate::users::User {
                id: "cli-admin".to_string(),
                username: "cli".to_string(),
                role: UserRole::Admin,
                created_at: 0,
                updated_at: 0,
                deleted_at: None,
            };

            match service.list_users(&params, &admin_user).await {
                Ok(users) => {
                    if users.is_empty() {
                        println!("no users found");
                    } else {
                        println!("found {} users:", users.len());
                        for user in users {
                            let status = if user.is_deleted() { " (DELETED)" } else { "" };
                            println!(
                                "  {} - {} ({}){}",
                                user.id, user.username, user.role, status
                            );
                        }
                    }
                }
                Err(e) => {
                    eprintln!("failed to list users: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::Update { user_id, role } => {
            println!("updating user: {}", user_id);

            let user_role = role.map(|r| match r.to_lowercase().as_str() {
                "admin" => UserRole::Admin,
                _ => UserRole::Member,
            });

            let request = UpdateUserRequest { role: user_role };

            let admin_user = crate::users::User {
                id: "cli-admin".to_string(),
                username: "cli".to_string(),
                role: UserRole::Admin,
                created_at: 0,
                updated_at: 0,
                deleted_at: None,
            };

            match service.update_user(&user_id, &request, &admin_user).await {
                Ok(user) => {
                    println!("user updated successfully:");
                    println!("  ID: {}", user.id);
                    println!("  Username: {}", user.username);
                    println!("  Role: {}", user.role);
                    println!(
                        "  Updated: {}",
                        super::utils::format_timestamp(user.updated_at)
                    );
                }
                Err(e) => {
                    eprintln!("failed to update user: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::Delete { user_id } => {
            println!("deleting user: {}", user_id);

            let admin_user = crate::users::User {
                id: "cli-admin".to_string(),
                username: "cli".to_string(),
                role: UserRole::Admin,
                created_at: 0,
                updated_at: 0,
                deleted_at: None,
            };

            match service.delete_user(&user_id, &admin_user).await {
                Ok(()) => {
                    println!("user deleted successfully");
                }
                Err(e) => {
                    eprintln!("failed to delete user: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::GenerateInvites {
            count,
            word_count,
            code_type,
            expires_hours,
        } => {
            println!(
                "generating {} invite codes with {} words each...",
                count, word_count
            );

            // Initialize wordlist if not already done - CLI responsibility
            if !crate::wordlist::is_initialized() {
                let config = crate::wordlist::ManagementWordlistConfig::default();
                if let Err(e) = crate::wordlist::initialize_wordlist(&config) {
                    eprintln!("failed to initialize wordlist: {}", e);
                    eprintln!("ensure wordlist file exists at: {}", config.file_path);
                    std::process::exit(1);
                }
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

            let admin_user = crate::users::User {
                id: "cli-admin".to_string(),
                username: "cli".to_string(),
                role: UserRole::Admin,
                created_at: 0,
                updated_at: 0,
                deleted_at: None,
            };

            match service
                .generate_invite_codes(&request, count as u32, word_count, &admin_user)
                .await
            {
                Ok(codes) => {
                    println!("generated {} invite codes:", codes.len());
                    for (i, code) in codes.iter().enumerate() {
                        println!("  {}: {}", i + 1, code.code);
                        if let Some(expires) = code.link_expires_at {
                            println!("    Expires: {}", super::utils::format_timestamp(expires));
                        }
                    }
                }
                Err(e) => {
                    eprintln!("failed to generate invite codes: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::ListInvites { active_only } => {
            println!("listing invite codes...");

            let admin_user = crate::users::User {
                id: "cli-admin".to_string(),
                username: "cli".to_string(),
                role: UserRole::Admin,
                created_at: 0,
                updated_at: 0,
                deleted_at: None,
            };

            match service.list_invite_codes(active_only, &admin_user).await {
                Ok(codes) => {
                    if codes.is_empty() {
                        println!("no invite codes found");
                    } else {
                        println!("found {} invite codes:", codes.len());
                        for code in codes {
                            let status = if code.used_at.is_some() {
                                " (USED)"
                            } else if !code.is_active {
                                " (INACTIVE)"
                            } else if code.is_expired() {
                                " (EXPIRED)"
                            } else {
                                ""
                            };
                            println!(
                                "  {} - {} ({}){}",
                                code.id, code.code, code.code_type, status
                            );
                        }
                    }
                }
                Err(e) => {
                    eprintln!("failed to list invite codes: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::DeactivateInvite { code } => {
            println!("deactivating invite code: {}", code);

            let admin_user = crate::users::User {
                id: "cli-admin".to_string(),
                username: "cli".to_string(),
                role: UserRole::Admin,
                created_at: 0,
                updated_at: 0,
                deleted_at: None,
            };

            match service.deactivate_invite_code(&code, &admin_user).await {
                Ok(()) => {
                    println!("invite code deactivated successfully");
                }
                Err(e) => {
                    eprintln!("failed to deactivate invite code: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::SetFavorite {
            user_id,
            target_type,
            target_id,
        } => {
            println!(
                "setting favorite: {} {} for user {}",
                target_type, target_id, user_id
            );

            let favorite_target = match target_type.to_lowercase().as_str() {
                "song" => FavoriteTarget::Song,
                "artist" => FavoriteTarget::Artist,
                "album" => FavoriteTarget::Album,
                "genre" => FavoriteTarget::Genre,
                "playlist" => FavoriteTarget::Playlist,
                _ => {
                    eprintln!(
                        "invalid target type: {}. Must be 'song', 'artist', 'album', 'genre', or 'playlist'",
                        target_type
                    );
                    std::process::exit(1);
                }
            };

            let favorites_service = crate::users::favorites::FavoritesService::new();
            let request = SetFavoriteRequest {
                user_id: user_id.clone(),
                target_type: favorite_target,
                target_id: target_id.clone(),
                is_favorite: true,
            };

            match favorites_service.set_favorite(&request).await {
                Ok(()) => {
                    println!("favorite set successfully");
                }
                Err(e) => {
                    eprintln!("failed to set favorite: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::RemoveFavorite {
            user_id,
            target_type,
            target_id,
        } => {
            println!(
                "removing favorite: {} {} for user {}",
                target_type, target_id, user_id
            );

            let favorite_target = match target_type.to_lowercase().as_str() {
                "song" => FavoriteTarget::Song,
                "artist" => FavoriteTarget::Artist,
                "album" => FavoriteTarget::Album,
                "genre" => FavoriteTarget::Genre,
                "playlist" => FavoriteTarget::Playlist,
                _ => {
                    eprintln!(
                        "invalid target type: {}. Must be 'song', 'artist', 'album', 'genre', or 'playlist'",
                        target_type
                    );
                    std::process::exit(1);
                }
            };

            let favorites_service = crate::users::favorites::FavoritesService::new();
            let request = SetFavoriteRequest {
                user_id: user_id.clone(),
                target_type: favorite_target,
                target_id: target_id.clone(),
                is_favorite: false,
            };

            match favorites_service.set_favorite(&request).await {
                Ok(()) => {
                    println!("favorite removed successfully");
                }
                Err(e) => {
                    eprintln!("failed to remove favorite: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::ListFavorites {
            user_id,
            target_type,
            limit,
        } => {
            println!("listing favorites for user: {}", user_id);

            let target_filter = target_type.map(|t| match t.to_lowercase().as_str() {
                "song" => FavoriteTarget::Song,
                "artist" => FavoriteTarget::Artist,
                "album" => FavoriteTarget::Album,
                "genre" => FavoriteTarget::Genre,
                "playlist" => FavoriteTarget::Playlist,
                _ => {
                    eprintln!(
                        "invalid target type: {}. Must be 'song', 'artist', 'album', 'genre', or 'playlist'",
                        t
                    );
                    std::process::exit(1);
                }
            });

            let favorites_service = crate::users::favorites::FavoritesService::new();

            match favorites_service
                .get_user_favorites(&user_id, target_filter, Some(limit as u32), None)
                .await
            {
                Ok(favorites) => {
                    if favorites.is_empty() {
                        println!("no favorites found");
                    } else {
                        for favorite in favorites {
                            println!(
                                "  {} {}: {} (created: {})",
                                favorite.target_type,
                                favorite.target_id,
                                match favorite.target_type {
                                    FavoriteTarget::Song => "♪",
                                    FavoriteTarget::Artist => "👤",
                                    FavoriteTarget::Album => "💿",
                                    FavoriteTarget::Genre => "🏷️",
                                    FavoriteTarget::Playlist => "📂",
                                },
                                super::utils::format_timestamp(favorite.created_at)
                            );
                        }
                    }
                }
                Err(e) => {
                    eprintln!("failed to list favorites: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::SetRating {
            user_id,
            target_type,
            target_id,
            rating,
        } => {
            if rating < 1 || rating > 5 {
                eprintln!("rating must be between 1 and 5");
                std::process::exit(1);
            }

            println!(
                "setting rating: {} {} = {} stars for user {}",
                target_type, target_id, rating, user_id
            );

            let rating_target = match target_type.to_lowercase().as_str() {
                "song" => RatingTarget::Song,
                "artist" => RatingTarget::Artist,
                "album" => RatingTarget::Album,
                _ => {
                    eprintln!(
                        "invalid target type: {}. Must be 'song', 'artist', or 'album'",
                        target_type
                    );
                    std::process::exit(1);
                }
            };

            let ratings_service = crate::users::ratings::RatingsService::new();
            let request = SetRatingRequest {
                user_id: user_id.clone(),
                target_type: rating_target,
                target_id: target_id.clone(),
                rating,
            };

            match ratings_service.set_rating(&request).await {
                Ok(_rating) => {
                    println!("rating set successfully");
                }
                Err(e) => {
                    eprintln!("failed to set rating: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::RemoveRating {
            user_id,
            target_type,
            target_id,
        } => {
            println!(
                "removing rating: {} {} for user {}",
                target_type, target_id, user_id
            );

            let rating_target = match target_type.to_lowercase().as_str() {
                "song" => RatingTarget::Song,
                "artist" => RatingTarget::Artist,
                "album" => RatingTarget::Album,
                _ => {
                    eprintln!(
                        "invalid target type: {}. Must be 'song', 'artist', or 'album'",
                        target_type
                    );
                    std::process::exit(1);
                }
            };

            let ratings_service = crate::users::ratings::RatingsService::new();

            match ratings_service
                .remove_rating(&user_id, rating_target, &target_id)
                .await
            {
                Ok(_removed) => {
                    println!("rating removed successfully");
                }
                Err(e) => {
                    eprintln!("failed to remove rating: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::RatingStats {
            target_type,
            target_id,
        } => {
            println!(
                "getting rating statistics for: {} {}",
                target_type, target_id
            );

            let rating_target = match target_type.to_lowercase().as_str() {
                "song" => RatingTarget::Song,
                "artist" => RatingTarget::Artist,
                "album" => RatingTarget::Album,
                _ => {
                    eprintln!(
                        "invalid target type: {}. Must be 'song', 'artist', or 'album'",
                        target_type
                    );
                    std::process::exit(1);
                }
            };

            let ratings_service = crate::users::ratings::RatingsService::new();

            match ratings_service
                .get_rating_stats(rating_target, &target_id)
                .await
            {
                Ok(stats) => {
                    println!("  Target: {} {}", stats.target_type, stats.target_id);
                    println!("  Total ratings: {}", stats.total_ratings);
                    println!("  Average rating: {:.1} stars", stats.average_rating);
                    println!("  Rating distribution:");
                    for (rating, count) in stats.rating_distribution {
                        let stars = "★".repeat(rating as usize);
                        println!("    {} ({}): {}", stars, rating, count);
                    }
                }
                Err(e) => {
                    eprintln!("failed to get rating statistics: {}", e);
                    std::process::exit(1);
                }
            }
        }
        UserAction::TopRated {
            target_type,
            min_ratings,
            limit,
        } => {
            println!("getting top rated {} items...", target_type);

            let rating_target = match target_type.to_lowercase().as_str() {
                "song" => RatingTarget::Song,
                "artist" => RatingTarget::Artist,
                "album" => RatingTarget::Album,
                _ => {
                    eprintln!(
                        "invalid target type: {}. Must be 'song', 'artist', or 'album'",
                        target_type
                    );
                    std::process::exit(1);
                }
            };

            let ratings_service = crate::users::ratings::RatingsService::new();

            match ratings_service
                .get_top_rated(rating_target, Some(min_ratings as u64), Some(limit as u32))
                .await
            {
                Ok(items) => {
                    if items.is_empty() {
                        println!("no rated items found");
                    } else {
                        for (i, item) in items.iter().enumerate() {
                            println!(
                                "{}. {} {} - {:.1} stars ({} ratings)",
                                i + 1,
                                if item.target_type == RatingTarget::Song {
                                    "♪"
                                } else if item.target_type == RatingTarget::Artist {
                                    "👤"
                                } else {
                                    "💿"
                                },
                                item.target_id,
                                item.average_rating,
                                item.total_ratings
                            );
                        }
                    }
                }
                Err(e) => {
                    eprintln!("failed to get top rated items: {}", e);
                    std::process::exit(1);
                }
            }
        }
    }

    Ok(())
}
