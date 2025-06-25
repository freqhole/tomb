//! Analytics module
//!
//! This module handles all analytics-related CLI commands including:
//! - Analytics data retrieval and display
//! - User activity tracking
//! - Data cleanup operations
//! - Analytics statistics

use clap::Subcommand;
use grimoire::{AnalyticsQuery, AnalyticsService, CleanupConfig, UserActivityQuery};
use server::database::DatabaseConnection;
use server::storage::AnalyticsService as StorageAnalyticsService;

#[derive(Subcommand, Clone)]
pub enum AnalyticsCommands {
    /// Show request analytics
    Analytics {
        /// Time period in hours
        #[arg(long, default_value = "24")]
        hours: i32,
        /// Number of top paths to show
        #[arg(long, default_value = "10")]
        limit: i64,
    },
    /// Show user request history
    UserActivity {
        /// User ID to look up
        #[arg(long)]
        user_id: String,
        /// Number of recent requests to show
        #[arg(long, default_value = "20")]
        limit: i64,
    },
    /// Clean up old analytics data
    CleanupAnalytics {
        /// Days of data to keep
        #[arg(long, default_value = "30")]
        days: i32,
        /// Actually perform the cleanup (dry run by default)
        #[arg(long)]
        execute: bool,
    },
}

impl AnalyticsCommands {
    pub async fn handle(
        &self,
        storage: &StorageAnalyticsService,
        _db: &DatabaseConnection,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let analytics_service = AnalyticsService::new();

        match self {
            AnalyticsCommands::Analytics { hours, limit } => {
                Self::show_analytics(&analytics_service, *hours, *limit).await
            }
            AnalyticsCommands::UserActivity { user_id, limit } => {
                Self::show_user_activity(&analytics_service, user_id, *limit).await
            }
            AnalyticsCommands::CleanupAnalytics { days, execute } => {
                Self::cleanup_analytics(&analytics_service, *days, *execute).await
            }
        }
    }

    async fn show_analytics(
        analytics: &AnalyticsService,
        hours: i32,
        limit: i64,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let query = AnalyticsQuery { hours, limit };

        match analytics.get_analytics(query).await {
            Ok(result) => {
                println!("{}", result);
                println!();
                println!("Note: Analytics functionality is currently in development.");
                println!("Full analytics data will be available in a future update.");
            }
            Err(e) => {
                eprintln!("❌ Failed to get analytics: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn show_user_activity(
        analytics: &AnalyticsService,
        user_id: &str,
        limit: i64,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // Parse user ID
        let user_uuid = match AnalyticsService::parse_user_id(user_id) {
            Ok(uuid) => uuid,
            Err(e) => {
                eprintln!("❌ {}", e);
                return Err(e.into());
            }
        };

        let query = UserActivityQuery {
            user_id: user_uuid,
            limit,
        };

        match analytics.get_user_activity(query).await {
            Ok(result) => {
                println!("{}", result);
                println!();
                println!("Note: User activity tracking is currently in development.");
                println!("Full activity data will be available in a future update.");
            }
            Err(e) => {
                eprintln!("❌ Failed to get user activity: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn cleanup_analytics(
        analytics: &AnalyticsService,
        days: i32,
        execute: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let config = CleanupConfig {
            days_to_keep: days,
            dry_run: !execute,
        };

        match analytics.cleanup_analytics(config).await {
            Ok(result) => {
                println!("{}", result);
                println!();
                if result.dry_run {
                    println!("Run with --execute to perform the actual cleanup");
                }
                println!("Note: Analytics cleanup is currently in development.");
                println!("Full cleanup functionality will be available in a future update.");
            }
            Err(e) => {
                eprintln!("❌ Failed to cleanup analytics: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }
}
