//! Favorites service for managing user favorites
//!
//! This module handles user favorites for songs, artists, albums, genres, and playlists.
//! Provides operations for setting, getting, and managing favorite status.

use crate::database;
use crate::music::users::models::*;
use crate::response::GrimoireResponse;
use crate::users::models::AuthResult;
use sqlx::Row;
use time::OffsetDateTime;

/// Database row struct for user_favoritez table
#[derive(Debug)]
struct UserFavoriteRow {
    id: String,
    user_id: String,
    target_type: String,
    target_id: String,
    created_at: i64,
}

impl From<UserFavoriteRow> for UserFavorite {
    fn from(row: UserFavoriteRow) -> Self {
        UserFavorite {
            id: row.id,
            user_id: row.user_id,
            target_type: FavoriteTarget::from(row.target_type),
            target_id: row.target_id,
            created_at: row.created_at,
        }
    }
}

/// Service for managing user favorites
pub struct FavoritesService {}

impl FavoritesService {
    /// Create a new favorites service instance
    pub fn new() -> Self {
        Self {}
    }

    /// Set or unset a favorite for a user
    pub async fn set_favorite(&self, request: &SetFavoriteRequest) -> GrimoireResponse<()> {
        let pool = match database::connect().await {
            Ok(pool) => pool,
            Err(err) => {
                return GrimoireResponse::failure("Failed to connect to database", vec![err.into()])
            }
        };

        if request.is_favorite {
            // Insert new favorite (ignore if already exists)
            let now = OffsetDateTime::now_utc().unix_timestamp();
            let target_type = request.target_type.to_string();

            if let Err(err) = sqlx::query!(
                r#"
                INSERT OR IGNORE INTO user_favoritez (user_id, target_type, target_id, created_at)
                VALUES (?1, ?2, ?3, ?4)
                "#,
                request.user_id,
                target_type,
                request.target_id,
                now
            )
            .execute(&pool)
            .await
            {
                return GrimoireResponse::failure("Failed to add favorite", vec![err.into()]);
            }
        } else {
            // Remove existing favorite
            let target_type = request.target_type.to_string();

            if let Err(err) = sqlx::query!(
                r#"
                DELETE FROM user_favoritez
                WHERE user_id = ?1 AND target_type = ?2 AND target_id = ?3
                "#,
                request.user_id,
                target_type,
                request.target_id
            )
            .execute(&pool)
            .await
            {
                return GrimoireResponse::failure("Failed to remove favorite", vec![err.into()]);
            }
        }

        GrimoireResponse::success("Favorite updated successfully", ())
    }

    /// Toggle favorite status for a target
    pub async fn toggle_favorite(
        &self,
        user_id: &str,
        target_type: FavoriteTarget,
        target_id: &str,
    ) -> GrimoireResponse<bool> {
        let is_currently_favorited =
            match self.check_favorited(user_id, target_type, target_id).await {
                Ok(status) => status,
                Err(err) => {
                    return GrimoireResponse::failure(
                        "Failed to check favorite status",
                        vec![err.into()],
                    );
                }
            };
        let new_status = !is_currently_favorited;

        let request = SetFavoriteRequest {
            user_id: user_id.to_string(),
            target_type,
            target_id: target_id.to_string(),
            is_favorite: new_status,
        };

        let set_response = self.set_favorite(&request).await;
        if !set_response.is_success() {
            return GrimoireResponse::failure("Failed to toggle favorite", set_response.errors);
        }

        GrimoireResponse::success(
            if new_status {
                "Favorite added"
            } else {
                "Favorite removed"
            },
            new_status,
        )
    }

    /// Check if a target is favorited by a user (internal helper)
    async fn check_favorited(
        &self,
        user_id: &str,
        target_type: FavoriteTarget,
        target_id: &str,
    ) -> AuthResult<bool> {
        let pool = database::connect().await?;
        let target_type_str = target_type.to_string();

        let result = sqlx::query!(
            r#"
            SELECT id
            FROM user_favoritez
            WHERE user_id = ?1 AND target_type = ?2 AND target_id = ?3
            "#,
            user_id,
            target_type_str,
            target_id
        )
        .fetch_optional(&pool)
        .await?;

        Ok(result.is_some())
    }

    /// Check if a target is favorited by a user
    pub async fn is_favorited(
        &self,
        user_id: &str,
        target_type: FavoriteTarget,
        target_id: &str,
    ) -> GrimoireResponse<bool> {
        match self.check_favorited(user_id, target_type, target_id).await {
            Ok(is_favorited) => GrimoireResponse::success("Favorite status checked", is_favorited),
            Err(err) => {
                GrimoireResponse::failure("Failed to check favorite status", vec![err.into()])
            }
        }
    }

    /// Get all favorites for a user of a specific type
    pub async fn get_user_favorites(
        &self,
        user_id: &str,
        target_type: Option<FavoriteTarget>,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> GrimoireResponse<Vec<UserFavorite>> {
        let pool = match database::connect().await {
            Ok(pool) => pool,
            Err(err) => {
                return GrimoireResponse::failure("Failed to connect to database", vec![err.into()])
            }
        };

        let favorites = if let Some(target_type) = target_type {
            let target_type_str = target_type.to_string();
            let limit_val = limit.unwrap_or(50);
            let offset_val = offset.unwrap_or(0);
            match sqlx::query_as!(
                UserFavoriteRow,
                r#"
                SELECT id as "id!", user_id as "user_id!", target_type as "target_type!", target_id as "target_id!", created_at as "created_at!"
                FROM user_favoritez
                WHERE user_id = ?1 AND target_type = ?2
                ORDER BY created_at DESC
                LIMIT ?3 OFFSET ?4
                "#,
                user_id,
                target_type_str,
                limit_val,
                offset_val
            )
            .fetch_all(&pool)
            .await
            {
                Ok(rows) => rows,
                Err(err) => {
                    return GrimoireResponse::failure("Failed to get favorites", vec![err.into()]);
                }
            }
        } else {
            let limit_val = limit.unwrap_or(50);
            let offset_val = offset.unwrap_or(0);
            match sqlx::query_as!(
                UserFavoriteRow,
                r#"
                SELECT id as "id!", user_id as "user_id!", target_type as "target_type!", target_id as "target_id!", created_at as "created_at!"
                FROM user_favoritez
                WHERE user_id = ?1
                ORDER BY created_at DESC
                LIMIT ?2 OFFSET ?3
                "#,
                user_id,
                limit_val,
                offset_val
            )
            .fetch_all(&pool)
            .await
            {
                Ok(rows) => rows,
                Err(err) => {
                    return GrimoireResponse::failure("Failed to get favorites", vec![err.into()]);
                }
            }
        };

        let result: Vec<UserFavorite> = favorites.into_iter().map(UserFavorite::from).collect();
        GrimoireResponse::success(format!("Found {} favorite(s)", result.len()), result)
    }

    /// Get favorite status for multiple targets
    pub async fn get_favorite_status_bulk(
        &self,
        user_id: &str,
        targets: Vec<(FavoriteTarget, String)>,
    ) -> GrimoireResponse<Vec<(FavoriteTarget, String, bool)>> {
        if targets.is_empty() {
            return GrimoireResponse::success("No targets to check", Vec::new());
        }

        let pool = match database::connect().await {
            Ok(pool) => pool,
            Err(err) => {
                return GrimoireResponse::failure("Failed to connect to database", vec![err.into()])
            }
        };
        let mut results = Vec::new();

        // Build query with placeholders for all targets
        let mut query = String::from(
            "SELECT target_type, target_id FROM user_favoritez WHERE user_id = ?1 AND (",
        );
        let mut params = vec![user_id.to_string()];

        for (i, (target_type, target_id)) in targets.iter().enumerate() {
            if i > 0 {
                query.push_str(" OR ");
            }
            query.push_str(&format!(
                "(target_type = ?{} AND target_id = ?{})",
                params.len() + 1,
                params.len() + 2
            ));
            params.push(target_type.to_string());
            params.push(target_id.clone());
        }
        query.push(')');

        let mut sqlx_query = sqlx::query(&query);
        for param in &params {
            sqlx_query = sqlx_query.bind(param);
        }

        let favorited_rows = match sqlx_query.fetch_all(&pool).await {
            Ok(rows) => rows,
            Err(err) => {
                return GrimoireResponse::failure(
                    "Failed to get favorite status",
                    vec![err.into()],
                );
            }
        };

        // Convert to set for fast lookup
        let favorited: std::collections::HashSet<(String, String)> = favorited_rows
            .into_iter()
            .map(|row| {
                (
                    row.get::<String, _>("target_type"),
                    row.get::<String, _>("target_id"),
                )
            })
            .collect();

        for (target_type, target_id) in targets {
            let is_favorited = favorited.contains(&(target_type.to_string(), target_id.clone()));
            results.push((target_type, target_id, is_favorited));
        }

        GrimoireResponse::success(format!("Checked {} target(s)", results.len()), results)
    }

    /// Remove all favorites for a target (cleanup when items are deleted)
    pub async fn remove_favorites_for_target(
        &self,
        target_type: FavoriteTarget,
        target_id: &str,
    ) -> GrimoireResponse<u64> {
        let pool = match database::connect().await {
            Ok(pool) => pool,
            Err(err) => {
                return GrimoireResponse::failure("Failed to connect to database", vec![err.into()])
            }
        };
        let target_type_str = target_type.to_string();

        match sqlx::query!(
            r#"
            DELETE FROM user_favoritez
            WHERE target_type = ?1 AND target_id = ?2
            "#,
            target_type_str,
            target_id
        )
        .execute(&pool)
        .await
        {
            Ok(result) => {
                let count = result.rows_affected();
                GrimoireResponse::success(format!("Removed {} favorite(s)", count), count)
            }
            Err(err) => GrimoireResponse::failure("Failed to remove favorites", vec![err.into()]),
        }
    }

    /// Get count of users who favorited a target
    pub async fn get_favorite_count(
        &self,
        target_type: FavoriteTarget,
        target_id: &str,
    ) -> GrimoireResponse<u64> {
        let pool = match database::connect().await {
            Ok(pool) => pool,
            Err(err) => {
                return GrimoireResponse::failure("Failed to connect to database", vec![err.into()])
            }
        };
        let target_type_str = target_type.to_string();

        match sqlx::query!(
            r#"
            SELECT COUNT(*) as count
            FROM user_favoritez
            WHERE target_type = ?1 AND target_id = ?2
            "#,
            target_type_str,
            target_id
        )
        .fetch_one(&pool)
        .await
        {
            Ok(result) => {
                let count = result.count as u64;
                GrimoireResponse::success(format!("{} user(s) favorited this item", count), count)
            }
            Err(err) => GrimoireResponse::failure("Failed to get favorite count", vec![err.into()]),
        }
    }

    /// Get recently favorited items for a user
    pub async fn get_recent_favorites(
        &self,
        user_id: &str,
        target_type: Option<FavoriteTarget>,
        limit: Option<u32>,
    ) -> GrimoireResponse<Vec<UserFavorite>> {
        // This is the same as get_user_favorites but with a default limit for recent items
        self.get_user_favorites(user_id, target_type, limit.or(Some(20)), Some(0))
            .await
    }

    /// Remove all favorites for a user (cleanup when user is deleted)
    pub async fn remove_all_user_favorites(&self, user_id: &str) -> GrimoireResponse<u64> {
        let pool = match database::connect().await {
            Ok(pool) => pool,
            Err(err) => {
                return GrimoireResponse::failure("Failed to connect to database", vec![err.into()])
            }
        };

        match sqlx::query!(
            r#"
            DELETE FROM user_favoritez
            WHERE user_id = ?1
            "#,
            user_id
        )
        .execute(&pool)
        .await
        {
            Ok(result) => {
                let count = result.rows_affected();
                GrimoireResponse::success(format!("Removed {} favorite(s)", count), count)
            }
            Err(err) => GrimoireResponse::failure("Failed to remove favorites", vec![err.into()]),
        }
    }
}

impl Default for FavoritesService {
    fn default() -> Self {
        Self::new()
    }
}

/// Batch operations for favorites
impl FavoritesService {
    /// Set multiple favorites at once
    pub async fn set_favorites_batch(
        &self,
        requests: Vec<SetFavoriteRequest>,
    ) -> GrimoireResponse<Vec<bool>> {
        let mut results = Vec::new();
        for request in requests {
            let response = self.set_favorite(&request).await;
            results.push(response.is_success());
        }
        let success_count = results.iter().filter(|&&s| s).count();
        GrimoireResponse::success(
            format!("{}/{} favorites updated", success_count, results.len()),
            results,
        )
    }

    /// Import favorites from external source
    pub async fn import_favorites(
        &self,
        user_id: &str,
        favorites: Vec<(FavoriteTarget, String)>,
    ) -> GrimoireResponse<u64> {
        let mut count = 0;
        for (target_type, target_id) in favorites {
            let request = SetFavoriteRequest {
                user_id: user_id.to_string(),
                target_type,
                target_id,
                is_favorite: true,
            };
            let response = self.set_favorite(&request).await;
            if response.is_success() {
                count += 1;
            }
        }
        GrimoireResponse::success(format!("Imported {} favorite(s)", count), count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_favorites_service_creation() {
        let _ = FavoritesService::new();
        // Basic smoke test that service can be created
    }

    #[test]
    fn test_target_types() {
        // Test that all favorite target types are available
        let targets = vec![
            FavoriteTarget::Song,
            FavoriteTarget::Artist,
            FavoriteTarget::Album,
            FavoriteTarget::Genre,
            FavoriteTarget::Playlist,
        ];

        assert_eq!(targets.len(), 5);
    }

    #[tokio::test]
    async fn test_service_methods_exist() {
        let _ = FavoritesService::new();

        // Test that service methods can be called (they'll panic with todo! for now)
        // This helps ensure the API surface is correct

        // Note: These will panic with "not yet implemented" until we implement them
        // but it helps verify the method signatures are correct
    }
}
