//! Analytics module
//!
//! This module handles all analytics-related CLI commands including:
//! - Analytics data retrieval and display
//! - User activity tracking
//! - Data cleanup operations
//! - Analytics statistics

use clap::Subcommand;
use legacylib::analytics::{AnalyticsCliService, AnalyticsQuery, CleanupConfig, UserActivityQuery};
use legacylib::DatabaseConnection;

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
    /// Report on legacy media events data
    LegacyReport,
    /// Drop all media events (development reset)
    DropAll {
        /// Confirm the destructive operation
        #[arg(long)]
        confirm: bool,
    },
    /// Drop all media events before current time
    DropBeforeNow {
        /// Confirm the destructive operation
        #[arg(long)]
        confirm: bool,
    },
}

impl AnalyticsCommands {
    pub async fn handle(&self, db: &DatabaseConnection) -> Result<(), Box<dyn std::error::Error>> {
        let analytics_service = AnalyticsCliService::new(db);

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
            AnalyticsCommands::LegacyReport => Self::legacy_report(db).await,
            AnalyticsCommands::DropAll { confirm } => {
                Self::drop_all_media_events(db, *confirm).await
            }
            AnalyticsCommands::DropBeforeNow { confirm } => {
                Self::drop_media_events_before_now(db, *confirm).await
            }
        }
    }

    async fn show_analytics(
        analytics: &AnalyticsCliService<'_>,
        hours: i32,
        limit: i64,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let query = AnalyticsQuery { hours, limit };

        match analytics.get_analytics(query).await {
            Ok(result) => {
                println!("{}", result);
                if !analytics.is_enabled() {
                    println!();
                    println!("Note: Analytics is currently disabled. Enable it in configuration to see real data.");
                } else if result.total_requests == 0 {
                    println!();
                    println!("Note: No analytics data found for the specified time period.");
                }
            }
            Err(e) => {
                eprintln!("failed to get analytics: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn show_user_activity(
        analytics: &AnalyticsCliService<'_>,
        user_id: &str,
        limit: i64,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // Parse user ID
        let user_uuid = match AnalyticsCliService::parse_user_id(user_id) {
            Ok(uuid) => uuid,
            Err(e) => {
                eprintln!("invalid user id format: {}", user_id);
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
                if !analytics.is_enabled() {
                    println!();
                    println!("Note: Analytics is currently disabled. Enable it in configuration to track user activity.");
                } else if result.request_count == 0 {
                    println!();
                    println!("Note: No activity found for this user in the available data.");
                }
            }
            Err(e) => {
                eprintln!("failed to get user activity: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn cleanup_analytics(
        analytics: &AnalyticsCliService<'_>,
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
                if result.dry_run && result.records_affected > 0 {
                    println!();
                    println!("Run with --execute to perform the actual cleanup");
                } else if !analytics.is_enabled() {
                    println!();
                    println!("Note: Analytics is currently disabled.");
                }
            }
            Err(e) => {
                eprintln!("failed to cleanup analytics: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn legacy_report(db: &DatabaseConnection) -> Result<(), Box<dyn std::error::Error>> {
        let total_events = sqlx::query_scalar!("SELECT COUNT(*) FROM media_events")
            .fetch_one(db.pool())
            .await?
            .unwrap_or(0);

        let legacy_events = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM media_events WHERE array_length(domain_ids, 1) = 1 AND domain_ids[1] ~ '^[0-9a-f-]+$'"
        )
        .fetch_one(db.pool())
        .await?
        .unwrap_or(0);

        let composite_events = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM media_events WHERE EXISTS (SELECT 1 FROM unnest(domain_ids) AS d WHERE d ~ '.*:.*')"
        )
        .fetch_one(db.pool())
        .await?
        .unwrap_or(0);

        println!("📊 Media Events Legacy Report");
        println!("═══════════════════════════");
        println!("Total media events: {}", total_events);
        println!("Legacy UUID events: {}", legacy_events);
        println!("Composite string events: {}", composite_events);
        println!(
            "Clean events: {}",
            total_events - legacy_events - composite_events
        );

        if legacy_events > 0 || composite_events > 0 {
            println!("\n⚠️  Legacy data detected! Consider running cleanup commands.");
        } else {
            println!("\n✅ All events use proper format!");
        }

        Ok(())
    }

    async fn drop_all_media_events(
        db: &DatabaseConnection,
        confirm: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if !confirm {
            println!("⚠️  This will delete ALL media events data!");
            println!("Run with --confirm to proceed.");
            return Ok(());
        }

        let count = sqlx::query_scalar!("SELECT COUNT(*) FROM media_events")
            .fetch_one(db.pool())
            .await?
            .unwrap_or(0);

        sqlx::query!("DELETE FROM media_events")
            .execute(db.pool())
            .await?;

        println!("🗑️  Deleted {} media events", count);
        Ok(())
    }

    async fn drop_media_events_before_now(
        db: &DatabaseConnection,
        confirm: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if !confirm {
            println!("⚠️  This will delete all media events before current time!");
            println!("Run with --confirm to proceed.");
            return Ok(());
        }

        let count =
            sqlx::query_scalar!("SELECT COUNT(*) FROM media_events WHERE created_at < NOW()")
                .fetch_one(db.pool())
                .await?
                .unwrap_or(0);

        sqlx::query!("DELETE FROM media_events WHERE created_at < NOW()")
            .execute(db.pool())
            .await?;

        println!("🗑️  Deleted {} media events before current time", count);
        Ok(())
    }
}
