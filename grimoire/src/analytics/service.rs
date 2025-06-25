//! Analytics service for the client package
//!
//! This module provides high-level analytics services that will handle
//! analytics data retrieval, user activity tracking, and cleanup operations.

// use server::storage::AnalyticsService as StorageAnalyticsService; // Temporarily removed to fix circular dependency
use std::fmt;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;

/// Errors that can occur in analytics services
#[derive(Debug, Error)]
pub enum AnalyticsError {
    #[error("Invalid user ID format: {user_id}")]
    InvalidUserId { user_id: String },

    #[error("Invalid time range: {0}")]
    InvalidTimeRange(String),

    #[error("Analytics backend error: {0}")]
    Backend(String),

    #[error("Feature not implemented: {0}")]
    NotImplemented(String),
}

/// Configuration for analytics queries
#[derive(Debug, Clone)]
pub struct AnalyticsQuery {
    pub hours: i32,
    pub limit: i64,
}

impl Default for AnalyticsQuery {
    fn default() -> Self {
        Self {
            hours: 24,
            limit: 10,
        }
    }
}

/// Configuration for user activity queries
#[derive(Debug, Clone)]
pub struct UserActivityQuery {
    pub user_id: Uuid,
    pub limit: i64,
}

/// Configuration for analytics cleanup
#[derive(Debug, Clone)]
pub struct CleanupConfig {
    pub days_to_keep: i32,
    pub dry_run: bool,
}

impl Default for CleanupConfig {
    fn default() -> Self {
        Self {
            days_to_keep: 30,
            dry_run: true,
        }
    }
}

/// Result of analytics query
#[derive(Debug, Clone)]
pub struct AnalyticsResult {
    pub period_hours: i32,
    pub total_requests: i64,
    pub unique_users: i64,
    pub top_paths: Vec<PathMetric>,
}

impl fmt::Display for AnalyticsResult {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "📊 Request Analytics (last {} hours)", self.period_hours)?;
        writeln!(f)?;
        writeln!(f, "Overview:")?;
        writeln!(f, "  Total requests: {}", self.total_requests)?;
        writeln!(f, "  Unique users: {}", self.unique_users)?;
        writeln!(f)?;

        if !self.top_paths.is_empty() {
            writeln!(f, "Top paths:")?;
            for (i, path) in self.top_paths.iter().enumerate() {
                writeln!(f, "  {}: {} ({} requests)", i + 1, path.path, path.count)?;
            }
        }

        Ok(())
    }
}

/// Path request metrics
#[derive(Debug, Clone)]
pub struct PathMetric {
    pub path: String,
    pub count: i64,
}

/// Result of user activity query
#[derive(Debug, Clone)]
pub struct UserActivityResult {
    pub user_id: Uuid,
    pub request_count: i64,
    pub recent_requests: Vec<ActivityRecord>,
}

impl fmt::Display for UserActivityResult {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "👤 User Activity: {}", self.user_id)?;
        writeln!(f, "  Total requests: {}", self.request_count)?;
        writeln!(f, "  Showing last {} requests", self.recent_requests.len())?;
        writeln!(f)?;

        if !self.recent_requests.is_empty() {
            writeln!(f, "Recent activity:")?;
            for request in &self.recent_requests {
                writeln!(
                    f,
                    "  {} - {} ({})",
                    request
                        .timestamp
                        .format(&time::format_description::well_known::Iso8601::DEFAULT)
                        .unwrap_or_else(|_| "Invalid date".to_string()),
                    request.path,
                    request.method
                )?;
            }
        }

        Ok(())
    }
}

/// Individual activity record
#[derive(Debug, Clone)]
pub struct ActivityRecord {
    pub timestamp: OffsetDateTime,
    pub path: String,
    pub method: String,
}

/// Result of cleanup operation
#[derive(Debug, Clone)]
pub struct CleanupResult {
    pub dry_run: bool,
    pub days_kept: i32,
    pub cutoff_date: OffsetDateTime,
    pub records_affected: i64,
}

impl fmt::Display for CleanupResult {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "🧹 Analytics Cleanup")?;
        writeln!(f, "  Keeping last {} days of data", self.days_kept)?;
        writeln!(
            f,
            "  Cutoff date: {}",
            self.cutoff_date
                .format(&time::format_description::well_known::Iso8601::DEFAULT)
                .unwrap_or_else(|_| "Invalid date".to_string())
        )?;

        if self.dry_run {
            writeln!(
                f,
                "  DRY RUN - Use execute mode to actually perform cleanup"
            )?;
            writeln!(f, "  Would affect {} records", self.records_affected)?;
        } else {
            writeln!(f, "  ✓ Cleaned up {} records", self.records_affected)?;
        }

        Ok(())
    }
}

/// Analytics service for high-level analytics operations
pub struct AnalyticsService {
    // #[allow(dead_code)] // Placeholder for future implementation
    // storage: &'a StorageAnalyticsService, // Temporarily removed to fix circular dependency
}

impl AnalyticsService {
    /// Create a new AnalyticsService
    pub fn new() -> Self {
        Self {
            // storage, // Temporarily removed to fix circular dependency
        }
    }

    /// Get analytics for a time period
    pub async fn get_analytics(
        &self,
        query: AnalyticsQuery,
    ) -> Result<AnalyticsResult, AnalyticsError> {
        // Placeholder implementation
        // TODO: Implement actual analytics querying when storage methods are available

        if query.hours <= 0 {
            return Err(AnalyticsError::InvalidTimeRange(
                "Hours must be positive".to_string(),
            ));
        }

        // For now, return placeholder data
        Ok(AnalyticsResult {
            period_hours: query.hours,
            total_requests: 0,
            unique_users: 0,
            top_paths: vec![],
        })
    }

    /// Get user activity
    pub async fn get_user_activity(
        &self,
        query: UserActivityQuery,
    ) -> Result<UserActivityResult, AnalyticsError> {
        // Placeholder implementation
        // TODO: Implement actual user activity querying when storage methods are available

        if query.limit <= 0 {
            return Err(AnalyticsError::InvalidTimeRange(
                "Limit must be positive".to_string(),
            ));
        }

        // For now, return placeholder data
        Ok(UserActivityResult {
            user_id: query.user_id,
            request_count: 0,
            recent_requests: vec![],
        })
    }

    /// Clean up old analytics data
    pub async fn cleanup_analytics(
        &self,
        config: CleanupConfig,
    ) -> Result<CleanupResult, AnalyticsError> {
        // Placeholder implementation
        // TODO: Implement actual cleanup when storage methods are available

        if config.days_to_keep <= 0 {
            return Err(AnalyticsError::InvalidTimeRange(
                "Days to keep must be positive".to_string(),
            ));
        }

        let cutoff_date =
            OffsetDateTime::now_utc() - time::Duration::days(config.days_to_keep as i64);

        // For now, return placeholder data
        Ok(CleanupResult {
            dry_run: config.dry_run,
            days_kept: config.days_to_keep,
            cutoff_date,
            records_affected: 0,
        })
    }

    /// Parse user ID from string
    pub fn parse_user_id(user_id_str: &str) -> Result<Uuid, AnalyticsError> {
        Uuid::parse_str(user_id_str).map_err(|_| AnalyticsError::InvalidUserId {
            user_id: user_id_str.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_user_id_valid() {
        let uuid_str = "550e8400-e29b-41d4-a716-446655440000";
        let result = AnalyticsService::parse_user_id(uuid_str);
        assert!(result.is_ok());
    }

    #[test]
    fn test_parse_user_id_invalid() {
        let invalid_uuid = "not-a-uuid";
        let result = AnalyticsService::parse_user_id(invalid_uuid);
        assert!(result.is_err());
    }

    #[test]
    fn test_analytics_query_default() {
        let query = AnalyticsQuery::default();
        assert_eq!(query.hours, 24);
        assert_eq!(query.limit, 10);
    }

    #[test]
    fn test_cleanup_config_default() {
        let config = CleanupConfig::default();
        assert_eq!(config.days_to_keep, 30);
        assert!(config.dry_run);
    }
}
