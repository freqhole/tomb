//! CLI-specific analytics types and display implementations
//!
//! This module provides types and implementations specifically designed
//! for CLI output and user interaction.

use std::fmt;
use time::OffsetDateTime;
use uuid::Uuid;

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

/// Result of analytics query for CLI display
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

/// Path request metrics for CLI display
#[derive(Debug, Clone)]
pub struct PathMetric {
    pub path: String,
    pub count: i64,
}

/// Result of user activity query for CLI display
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

/// Individual activity record for CLI display
#[derive(Debug, Clone)]
pub struct ActivityRecord {
    pub timestamp: OffsetDateTime,
    pub path: String,
    pub method: String,
}

/// Result of cleanup operation for CLI display
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

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn test_analytics_result_display() {
        let result = AnalyticsResult {
            period_hours: 24,
            total_requests: 100,
            unique_users: 10,
            top_paths: vec![PathMetric {
                path: "/api/test".to_string(),
                count: 50,
            }],
        };

        let output = format!("{}", result);
        assert!(output.contains("📊 Request Analytics (last 24 hours)"));
        assert!(output.contains("Total requests: 100"));
        assert!(output.contains("Unique users: 10"));
        assert!(output.contains("/api/test"));
    }

    #[test]
    fn test_cleanup_result_display() {
        let result = CleanupResult {
            dry_run: true,
            days_kept: 30,
            cutoff_date: OffsetDateTime::now_utc(),
            records_affected: 42,
        };

        let output = format!("{}", result);
        assert!(output.contains("🧹 Analytics Cleanup"));
        assert!(output.contains("DRY RUN"));
        assert!(output.contains("42 records"));
    }
}
