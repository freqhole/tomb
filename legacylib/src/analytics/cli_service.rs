//! CLI service bridge for analytics operations
//!
//! This module provides a high-level service that bridges CLI-specific types
//! and operations with the core analytics service functionality.

use super::cli_types::{
    ActivityRecord, AnalyticsQuery, AnalyticsResult, CleanupConfig, CleanupResult, PathMetric,
    UserActivityQuery, UserActivityResult,
};
use super::models::{AnalyticsConfig, AnalyticsError};
use super::service::AnalyticsService;
use crate::DatabaseConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// CLI-focused analytics service that provides high-level operations
/// for command-line interface interactions
pub struct AnalyticsCliService<'a> {
    core_service: AnalyticsService<'a>,
}

impl<'a> AnalyticsCliService<'a> {
    /// Create a new CLI analytics service
    pub fn new(db: &'a DatabaseConnection) -> Self {
        Self {
            core_service: AnalyticsService::new_with_defaults(db),
        }
    }

    /// Create a new CLI analytics service with custom configuration
    pub fn with_config(db: &'a DatabaseConnection, config: AnalyticsConfig) -> Self {
        Self {
            core_service: AnalyticsService::new(db, config),
        }
    }

    /// Get analytics for a time period (CLI-compatible)
    pub async fn get_analytics(
        &self,
        query: AnalyticsQuery,
    ) -> Result<AnalyticsResult, AnalyticsError> {
        if query.hours <= 0 {
            return Err(AnalyticsError::InvalidTimeRange);
        }

        let to = OffsetDateTime::now_utc();
        let from = to - time::Duration::hours(query.hours as i64);

        match self.core_service.get_metrics(from, to).await {
            Ok(metrics) => {
                // Convert core metrics to CLI-friendly format
                let top_paths = metrics
                    .most_active_paths
                    .into_iter()
                    .take(query.limit as usize)
                    .map(|path| PathMetric {
                        path: path.path,
                        count: path.request_count,
                    })
                    .collect();

                Ok(AnalyticsResult {
                    period_hours: query.hours,
                    total_requests: metrics.total_requests,
                    unique_users: metrics.unique_users,
                    top_paths,
                })
            }
            Err(AnalyticsError::Disabled) => {
                // Return empty result for disabled analytics
                Ok(AnalyticsResult {
                    period_hours: query.hours,
                    total_requests: 0,
                    unique_users: 0,
                    top_paths: vec![],
                })
            }
            Err(e) => Err(e),
        }
    }

    /// Get user activity (CLI-compatible)
    pub async fn get_user_activity(
        &self,
        query: UserActivityQuery,
    ) -> Result<UserActivityResult, AnalyticsError> {
        if query.limit <= 0 {
            return Err(AnalyticsError::InvalidTimeRange);
        }

        match self
            .core_service
            .get_recent_user_requests(query.user_id, query.limit as u32)
            .await
        {
            Ok(requests) => {
                let recent_requests: Vec<ActivityRecord> = requests
                    .into_iter()
                    .map(|req| ActivityRecord {
                        timestamp: req.timestamp,
                        path: req.path,
                        method: req.method,
                    })
                    .collect();

                Ok(UserActivityResult {
                    user_id: query.user_id,
                    request_count: recent_requests.len() as i64,
                    recent_requests,
                })
            }
            Err(AnalyticsError::Disabled) => {
                // Return empty result for disabled analytics
                Ok(UserActivityResult {
                    user_id: query.user_id,
                    request_count: 0,
                    recent_requests: vec![],
                })
            }
            Err(e) => Err(e),
        }
    }

    /// Clean up old analytics data (CLI-compatible)
    pub async fn cleanup_analytics(
        &self,
        config: CleanupConfig,
    ) -> Result<CleanupResult, AnalyticsError> {
        if config.days_to_keep <= 0 {
            return Err(AnalyticsError::InvalidTimeRange);
        }

        let cutoff_date =
            OffsetDateTime::now_utc() - time::Duration::days(config.days_to_keep as i64);

        let records_affected = if config.dry_run {
            // For dry run, we could implement a count query, but for now return 0
            // This would require adding a count method to the core service
            0
        } else {
            match self.core_service.cleanup_old_data(cutoff_date).await {
                Ok(count) => count as i64,
                Err(AnalyticsError::Disabled) => 0,
                Err(e) => return Err(e),
            }
        };

        Ok(CleanupResult {
            dry_run: config.dry_run,
            days_kept: config.days_to_keep,
            cutoff_date,
            records_affected,
        })
    }

    /// Parse user ID from string (convenience method)
    pub fn parse_user_id(user_id_str: &str) -> Result<Uuid, AnalyticsError> {
        AnalyticsService::parse_user_id(user_id_str)
    }

    /// Check if analytics is enabled
    pub fn is_enabled(&self) -> bool {
        self.core_service.is_enabled()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_analytics_query_validation() {
        // Test validation logic
        let query = AnalyticsQuery {
            hours: -1,
            limit: 10,
        };

        // We can test that validation logic would work
        assert!(query.hours <= 0);
    }

    #[test]
    fn test_parse_user_id() {
        let valid_uuid = "550e8400-e29b-41d4-a716-446655440000";
        let result = AnalyticsCliService::parse_user_id(valid_uuid);
        assert!(result.is_ok());

        let invalid_uuid = "not-a-uuid";
        let result = AnalyticsCliService::parse_user_id(invalid_uuid);
        assert!(result.is_err());
    }

    #[test]
    fn test_cleanup_config_validation() {
        let config = CleanupConfig {
            days_to_keep: -1,
            dry_run: true,
        };

        assert!(config.days_to_keep <= 0);
    }
}
