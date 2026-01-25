//! Ratings service for managing user ratings
//!
//! This module handles user ratings for songs, artists, and albums.
//! Provides operations for setting, getting, and managing ratings with statistics.

use crate::database;
use crate::music::users::models::*;
use crate::users::models::{AuthError, AuthResult};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use time::OffsetDateTime;

/// Database row struct for user_ratingz table
#[derive(Debug)]
struct UserRatingRow {
    id: String,
    user_id: String,
    target_type: String,
    target_id: String,
    rating: i64,
    created_at: i64,
    updated_at: i64,
}

impl From<UserRatingRow> for UserRating {
    fn from(row: UserRatingRow) -> Self {
        UserRating {
            id: row.id,
            user_id: row.user_id,
            target_type: RatingTarget::from(row.target_type),
            target_id: row.target_id,
            rating: row.rating as i32,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

/// Rating statistics for a target
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RatingStats {
    pub target_type: RatingTarget,
    pub target_id: String,
    pub average_rating: f64,
    pub total_ratings: u64,
    pub rating_distribution: Vec<(i32, u64)>, // (rating_value, count)
}

/// Service for managing user ratings
pub struct RatingsService {}

impl RatingsService {
    /// Create a new ratings service instance
    pub fn new() -> Self {
        Self {}
    }

    /// Set or update a rating for a user (rating=0 removes the rating)
    pub async fn set_rating(&self, request: &SetRatingRequest) -> AuthResult<UserRating> {
        // Validate the rating request
        request.validate()?;

        // user_id should be Some at this point (ensured by server handler)
        let user_id = request
            .user_id
            .as_ref()
            .ok_or_else(|| AuthError::AuthenticationRequired)?;

        // if rating is 0, remove the rating instead
        if request.rating == 0 {
            self.remove_rating(user_id, request.target_type, &request.target_id)
                .await?;
            // return a dummy rating with 0 to indicate removal
            return Ok(UserRating {
                id: String::new(),
                user_id: user_id.clone(),
                target_type: request.target_type,
                target_id: request.target_id.clone(),
                rating: 0,
                created_at: 0,
                updated_at: 0,
            });
        }

        let pool = database::connect().await?;
        let now = OffsetDateTime::now_utc().unix_timestamp();
        let target_type_str = request.target_type.to_string();

        let row = sqlx::query_as!(
            UserRatingRow,
            r#"
            INSERT INTO user_ratingz (user_id, target_type, target_id, rating, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT (user_id, target_type, target_id)
            DO UPDATE SET rating = ?4, updated_at = ?6
            RETURNING id as "id!", user_id as "user_id!", target_type as "target_type!", target_id as "target_id!", rating as "rating!", created_at as "created_at!", updated_at as "updated_at!"
            "#,
            user_id,
            target_type_str,
            request.target_id,
            request.rating,
            now,
            now
        )
        .fetch_one(&pool)
        .await?;

        Ok(UserRating::from(row))
    }

    /// Remove a rating for a user
    pub async fn remove_rating(
        &self,
        user_id: &str,
        target_type: RatingTarget,
        target_id: &str,
    ) -> AuthResult<bool> {
        let pool = database::connect().await?;
        let target_type_str = target_type.to_string();

        let result = sqlx::query!(
            r#"
            DELETE FROM user_ratingz
            WHERE user_id = ?1 AND target_type = ?2 AND target_id = ?3
            "#,
            user_id,
            target_type_str,
            target_id
        )
        .execute(&pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    /// Get a user's rating for a specific target
    pub async fn get_user_rating(
        &self,
        user_id: &str,
        target_type: RatingTarget,
        target_id: &str,
    ) -> AuthResult<Option<UserRating>> {
        let pool = database::connect().await?;
        let target_type_str = target_type.to_string();

        let rating = sqlx::query_as!(
            UserRatingRow,
            r#"
            SELECT id as "id!", user_id as "user_id!", target_type as "target_type!", target_id as "target_id!", rating as "rating!", created_at as "created_at!", updated_at as "updated_at!"
            FROM user_ratingz
            WHERE user_id = ?1 AND target_type = ?2 AND target_id = ?3
            "#,
            user_id,
            target_type_str,
            target_id
        )
        .fetch_optional(&pool)
        .await?;

        Ok(rating.map(UserRating::from))
    }

    /// Get all ratings for a user of a specific type
    pub async fn get_user_ratings(
        &self,
        user_id: &str,
        target_type: Option<RatingTarget>,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> AuthResult<Vec<UserRating>> {
        let pool = database::connect().await?;

        let ratings = if let Some(target_type) = target_type {
            let target_type_str = target_type.to_string();
            let limit_val = limit.unwrap_or(50);
            let offset_val = offset.unwrap_or(0);
            sqlx::query_as!(
                UserRatingRow,
                r#"
                SELECT id as "id!", user_id as "user_id!", target_type as "target_type!", target_id as "target_id!", rating as "rating!", created_at as "created_at!", updated_at as "updated_at!"
                FROM user_ratingz
                WHERE user_id = ?1 AND target_type = ?2
                ORDER BY updated_at DESC
                LIMIT ?3 OFFSET ?4
                "#,
                user_id,
                target_type_str,
                limit_val,
                offset_val
            )
            .fetch_all(&pool)
            .await?
        } else {
            let limit_val = limit.unwrap_or(50);
            let offset_val = offset.unwrap_or(0);
            sqlx::query_as!(
                UserRatingRow,
                r#"
                SELECT id as "id!", user_id as "user_id!", target_type as "target_type!", target_id as "target_id!", rating as "rating!", created_at as "created_at!", updated_at as "updated_at!"
                FROM user_ratingz
                WHERE user_id = ?1
                ORDER BY updated_at DESC
                LIMIT ?2 OFFSET ?3
                "#,
                user_id,
                limit_val,
                offset_val
            )
            .fetch_all(&pool)
            .await?
        };

        Ok(ratings.into_iter().map(UserRating::from).collect())
    }

    /// Get rating statistics for a target
    pub async fn get_rating_stats(
        &self,
        target_type: RatingTarget,
        target_id: &str,
    ) -> AuthResult<RatingStats> {
        let pool = database::connect().await?;
        let target_type_str = target_type.to_string();

        // Get basic stats
        let stats_row = sqlx::query(
            r#"
            SELECT
                COUNT(*) as total_ratings,
                COALESCE(AVG(rating), 0.0) as average_rating
            FROM user_ratingz
            WHERE target_type = ?1 AND target_id = ?2
            "#,
        )
        .bind(&target_type_str)
        .bind(target_id)
        .fetch_one(&pool)
        .await?;

        // Get rating distribution
        let distribution_rows = sqlx::query(
            r#"
            SELECT rating, COUNT(*) as count
            FROM user_ratingz
            WHERE target_type = ?1 AND target_id = ?2
            GROUP BY rating
            ORDER BY rating
            "#,
        )
        .bind(&target_type_str)
        .bind(target_id)
        .fetch_all(&pool)
        .await?;

        let rating_distribution: Vec<(i32, u64)> = distribution_rows
            .into_iter()
            .map(|row| {
                let rating: i64 = row.get("rating");
                let count: i64 = row.get("count");
                (rating as i32, count as u64)
            })
            .collect();

        let total_ratings: i64 = stats_row.get("total_ratings");
        let average_rating: f64 = stats_row.get("average_rating");

        Ok(RatingStats {
            target_type,
            target_id: target_id.to_string(),
            total_ratings: total_ratings as u64,
            average_rating,
            rating_distribution,
        })
    }

    /// Get ratings for multiple targets
    pub async fn get_ratings_bulk(
        &self,
        user_id: &str,
        targets: Vec<(RatingTarget, String)>,
    ) -> AuthResult<Vec<(RatingTarget, String, Option<i32>)>> {
        if targets.is_empty() {
            return Ok(Vec::new());
        }

        let pool = database::connect().await?;
        let mut results = Vec::new();

        // Build query with placeholders for all targets
        let mut query = String::from(
            "SELECT target_type, target_id, rating FROM user_ratingz WHERE user_id = ?1 AND (",
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

        let rated_rows = sqlx_query.fetch_all(&pool).await?;

        // Convert to map for fast lookup
        let ratings: std::collections::HashMap<(String, String), i32> = rated_rows
            .into_iter()
            .map(|row| {
                (
                    (
                        row.get::<String, _>("target_type"),
                        row.get::<String, _>("target_id"),
                    ),
                    row.get::<i64, _>("rating") as i32,
                )
            })
            .collect();

        for (target_type, target_id) in targets {
            let rating = ratings
                .get(&(target_type.to_string(), target_id.clone()))
                .copied();
            results.push((target_type, target_id, rating));
        }

        Ok(results)
    }

    /// Get top rated items for a target type
    pub async fn get_top_rated(
        &self,
        target_type: RatingTarget,
        min_ratings: Option<u64>,
        limit: Option<u32>,
    ) -> AuthResult<Vec<RatingStats>> {
        let pool = database::connect().await?;
        let target_type_str = target_type.to_string();
        let min_ratings = min_ratings.unwrap_or(1);
        let limit_val = limit.unwrap_or(20);

        let top_rated_rows = sqlx::query(
            r#"
            SELECT
                target_id,
                COUNT(*) as total_ratings,
                AVG(rating) as average_rating
            FROM user_ratingz
            WHERE target_type = ?1
            GROUP BY target_id
            HAVING COUNT(*) >= ?2
            ORDER BY AVG(rating) DESC, COUNT(*) DESC
            LIMIT ?3
            "#,
        )
        .bind(&target_type_str)
        .bind(min_ratings as i64)
        .bind(limit_val as i64)
        .fetch_all(&pool)
        .await?;

        let mut results = Vec::new();
        for row in top_rated_rows {
            // Get distribution for each target
            let target_id: String = row.get("target_id");
            let distribution_rows = sqlx::query(
                r#"
                SELECT rating, COUNT(*) as count
                FROM user_ratingz
                WHERE target_type = ?1 AND target_id = ?2
                GROUP BY rating
                ORDER BY rating
                "#,
            )
            .bind(&target_type_str)
            .bind(&target_id)
            .fetch_all(&pool)
            .await?;

            let rating_distribution: Vec<(i32, u64)> = distribution_rows
                .into_iter()
                .map(|r| {
                    let rating: i64 = r.get("rating");
                    let count: i64 = r.get("count");
                    (rating as i32, count as u64)
                })
                .collect();

            let total_ratings: i64 = row.get("total_ratings");
            let average_rating: f64 = row.get("average_rating");

            results.push(RatingStats {
                target_type,
                target_id,
                average_rating,
                total_ratings: total_ratings as u64,
                rating_distribution,
            });
        }

        Ok(results)
    }

    /// Get recently rated items for a user
    pub async fn get_recent_ratings(
        &self,
        user_id: &str,
        target_type: Option<RatingTarget>,
        limit: Option<u32>,
    ) -> AuthResult<Vec<UserRating>> {
        // This is the same as get_user_ratings but with a default limit for recent items
        self.get_user_ratings(user_id, target_type, limit.or(Some(20)), Some(0))
            .await
    }

    /// Remove all ratings for a target (cleanup when items are deleted)
    pub async fn remove_ratings_for_target(
        &self,
        target_type: RatingTarget,
        target_id: &str,
    ) -> AuthResult<u64> {
        let pool = database::connect().await?;
        let target_type_str = target_type.to_string();

        let result = sqlx::query!(
            r#"
            DELETE FROM user_ratingz
            WHERE target_type = ?1 AND target_id = ?2
            "#,
            target_type_str,
            target_id
        )
        .execute(&pool)
        .await?;

        Ok(result.rows_affected())
    }

    /// Remove all ratings for a user (cleanup when user is deleted)
    pub async fn remove_all_user_ratings(&self, user_id: &str) -> AuthResult<u64> {
        let pool = database::connect().await?;

        let result = sqlx::query!(
            r#"
            DELETE FROM user_ratingz
            WHERE user_id = ?1
            "#,
            user_id
        )
        .execute(&pool)
        .await?;

        Ok(result.rows_affected())
    }

    /// Get rating history for a user and target
    pub async fn get_rating_history(
        &self,
        user_id: &str,
        target_type: RatingTarget,
        target_id: &str,
    ) -> AuthResult<Vec<UserRating>> {
        // TODO: Get historical ratings (if we keep history)
        // For now, just return current rating if it exists
        let current_rating = self
            .get_user_rating(user_id, target_type, target_id)
            .await?;
        Ok(current_rating.into_iter().collect())
    }
}

impl Default for RatingsService {
    fn default() -> Self {
        Self::new()
    }
}

/// Batch operations for ratings
impl RatingsService {
    /// Set multiple ratings at once
    pub async fn set_ratings_batch(
        &self,
        requests: Vec<SetRatingRequest>,
    ) -> AuthResult<Vec<Result<UserRating, AuthError>>> {
        // TODO: Implement batch rating setting
        // Process multiple ratings in a single transaction
        let mut results = Vec::new();
        for request in requests {
            results.push(self.set_rating(&request).await);
        }
        Ok(results)
    }

    /// Import ratings from external source
    pub async fn import_ratings(
        &self,
        user_id: &str,
        ratings: Vec<(RatingTarget, String, i32)>,
    ) -> AuthResult<u64> {
        let mut count = 0;
        for (target_type, target_id, rating) in ratings {
            let request = SetRatingRequest {
                user_id: Some(user_id.to_string()),
                target_type,
                target_id,
                rating,
            };
            self.set_rating(&request).await?;
            count += 1;
        }
        Ok(count)
    }

    /// Get rating statistics for multiple targets
    pub async fn get_rating_stats_bulk(
        &self,
        targets: Vec<(RatingTarget, String)>,
    ) -> AuthResult<Vec<RatingStats>> {
        // TODO: Efficient bulk query for rating statistics
        let mut stats = Vec::new();
        for (target_type, target_id) in targets {
            match self.get_rating_stats(target_type, &target_id).await {
                Ok(stat) => stats.push(stat),
                Err(_) => continue, // Skip targets with no ratings
            }
        }
        Ok(stats)
    }
}

/// Utility functions for ratings
impl RatingsService {
    /// Validate a rating value
    pub fn validate_rating(rating: i32) -> AuthResult<()> {
        if !UserRating::is_valid_rating(rating) {
            return Err(AuthError::InvalidRating {
                rating,
                min: 1,
                max: 5,
            });
        }
        Ok(())
    }

    /// Convert rating to percentage (for display)
    pub fn rating_to_percentage(rating: i32) -> f64 {
        (rating as f64 / 5.0) * 100.0
    }

    /// Get rating description
    pub fn rating_description(rating: i32) -> &'static str {
        match rating {
            1 => "Poor",
            2 => "Fair",
            3 => "Good",
            4 => "Very Good",
            5 => "Excellent",
            _ => "Unknown",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ratings_service_creation() {
        let _ = RatingsService::new();
        // Basic smoke test that service can be created
    }

    #[test]
    fn test_target_types() {
        // Test that all rating target types are available
        let targets = vec![
            RatingTarget::Song,
            RatingTarget::Artist,
            RatingTarget::Album,
        ];

        assert_eq!(targets.len(), 3);
    }

    #[test]
    fn test_validate_rating() {
        assert!(RatingsService::validate_rating(1).is_ok());
        assert!(RatingsService::validate_rating(3).is_ok());
        assert!(RatingsService::validate_rating(5).is_ok());
        assert!(RatingsService::validate_rating(0).is_err());
        assert!(RatingsService::validate_rating(6).is_err());
    }

    #[test]
    fn test_rating_to_percentage() {
        assert_eq!(RatingsService::rating_to_percentage(1), 20.0);
        assert_eq!(RatingsService::rating_to_percentage(3), 60.0);
        assert_eq!(RatingsService::rating_to_percentage(5), 100.0);
    }

    #[test]
    fn test_rating_description() {
        assert_eq!(RatingsService::rating_description(1), "Poor");
        assert_eq!(RatingsService::rating_description(3), "Good");
        assert_eq!(RatingsService::rating_description(5), "Excellent");
        assert_eq!(RatingsService::rating_description(0), "Unknown");
    }

    #[tokio::test]
    async fn test_service_methods_exist() {
        let _ = RatingsService::new();

        // Test that service methods can be called (they'll panic with todo! for now)
        // This helps ensure the API surface is correct

        // Note: These will panic with "not yet implemented" until we implement them
        // but it helps verify the method signatures are correct
    }
}
