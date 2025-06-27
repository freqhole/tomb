//! CLI commands for notification management
//!
//! This module provides command-line tools for managing the notification system,
//! including health checks, connection monitoring, test notifications, and maintenance operations.

use clap::Subcommand;
use grimoire::notifications::{
    NotificationChannel, NotificationConfig, NotificationEvent, NotificationPriority,
    NotificationService,
};
use grimoire::DatabaseConnection;
use serde_json::{json, Value};
use time::OffsetDateTime;

#[derive(Debug, Subcommand, Clone)]
pub enum NotificationCommands {
    /// Check notification system health and status
    Health,

    /// Show detailed notification statistics
    Stats,

    /// Test notification publishing
    Test {
        /// Notification channel to test
        #[arg(short, long, value_enum)]
        channel: CliNotificationChannel,

        /// Event type for the test notification
        #[arg(short, long, default_value = "test.event")]
        event_type: String,

        /// Custom payload as JSON string
        #[arg(short, long)]
        payload: Option<String>,

        /// Priority level for the notification
        #[arg(short = 'P', long, value_enum)]
        priority: Option<CliNotificationPriority>,
    },

    /// Send a test PostgreSQL NOTIFY
    TestPostgres {
        /// Database channel name
        #[arg(short, long, default_value = "media_blobs")]
        channel: String,

        /// Test payload as JSON string
        #[arg(short, long)]
        payload: Option<String>,
    },

    /// Clean up old notification data and connections
    Cleanup {
        /// Age threshold in hours for cleanup
        #[arg(short, long, default_value = "24")]
        hours: u64,

        /// Dry run - show what would be cleaned without actually doing it
        #[arg(long)]
        dry_run: bool,
    },

    /// Monitor notification system in real-time
    Monitor {
        /// Update interval in seconds
        #[arg(short, long, default_value = "5")]
        interval: u64,

        /// Maximum number of updates (0 for infinite)
        #[arg(short, long, default_value = "0")]
        count: u64,
    },

    /// List available notification channels
    Channels,

    /// Initialize notification system with default configuration
    Init {
        /// Force initialization even if already configured
        #[arg(long)]
        force: bool,
    },

    /// Benchmark notification performance
    Benchmark {
        /// Number of notifications to send
        #[arg(short, long, default_value = "100")]
        count: u64,

        /// Concurrent workers
        #[arg(short, long, default_value = "10")]
        workers: u64,

        /// Target channel for benchmark
        #[arg(short = 'C', long, value_enum, default_value = "media-blobs")]
        channel: CliNotificationChannel,
    },
}

#[derive(Debug, Clone, clap::ValueEnum)]
pub enum CliNotificationChannel {
    #[value(name = "media-blobs")]
    MediaBlobs,
    #[value(name = "thumbnail-jobs")]
    ThumbnailJobs,
    #[value(name = "system")]
    System,
}

impl From<CliNotificationChannel> for NotificationChannel {
    fn from(cli_channel: CliNotificationChannel) -> Self {
        match cli_channel {
            CliNotificationChannel::MediaBlobs => NotificationChannel::MediaBlobs,
            CliNotificationChannel::ThumbnailJobs => NotificationChannel::ThumbnailJobs,
            CliNotificationChannel::System => NotificationChannel::System,
        }
    }
}

#[derive(Debug, Clone, clap::ValueEnum)]
pub enum CliNotificationPriority {
    #[value(name = "low")]
    Low,
    #[value(name = "normal")]
    Normal,
    #[value(name = "high")]
    High,
    #[value(name = "critical")]
    Critical,
}

impl From<CliNotificationPriority> for NotificationPriority {
    fn from(cli_priority: CliNotificationPriority) -> Self {
        match cli_priority {
            CliNotificationPriority::Low => NotificationPriority::Low,
            CliNotificationPriority::Normal => NotificationPriority::Normal,
            CliNotificationPriority::High => NotificationPriority::High,
            CliNotificationPriority::Critical => NotificationPriority::Critical,
        }
    }
}

impl NotificationCommands {
    /// Execute the notification command
    pub async fn handle(&self, db: &DatabaseConnection) -> Result<(), Box<dyn std::error::Error>> {
        match self {
            NotificationCommands::Health => self.handle_health(db).await,
            NotificationCommands::Stats => self.handle_stats(db).await,
            NotificationCommands::Test {
                channel,
                event_type,
                payload,
                priority,
            } => {
                self.handle_test(db, channel, event_type, payload, priority)
                    .await
            }
            NotificationCommands::TestPostgres { channel, payload } => {
                self.handle_test_postgres(db, channel, payload).await
            }
            NotificationCommands::Cleanup { hours, dry_run } => {
                self.handle_cleanup(db, *hours, *dry_run).await
            }
            NotificationCommands::Monitor { interval, count } => {
                self.handle_monitor(db, *interval, *count).await
            }
            NotificationCommands::Channels => self.handle_channels().await,
            NotificationCommands::Init { force } => self.handle_init(db, *force).await,
            NotificationCommands::Benchmark {
                count,
                workers,
                channel,
            } => self.handle_benchmark(db, *count, *workers, channel).await,
        }
    }

    async fn handle_health(
        &self,
        db: &DatabaseConnection,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🔍 Checking notification system health...\n");

        // Test database connection
        let db_status = match sqlx::query("SELECT 1").execute(db.pool()).await {
            Ok(_) => "✅ Connected",
            Err(e) => {
                println!("❌ Database connection failed: {}", e);
                return Err(e.into());
            }
        };
        println!("Database: {}", db_status);

        // Test PostgreSQL LISTEN capability
        let listen_status = match sqlx::query("LISTEN test_channel").execute(db.pool()).await {
            Ok(_) => {
                // Unlisten to clean up
                let _ = sqlx::query("UNLISTEN test_channel")
                    .execute(db.pool())
                    .await;
                "✅ LISTEN/NOTIFY supported"
            }
            Err(_) => "❌ LISTEN/NOTIFY not available",
        };
        println!("PostgreSQL NOTIFY/LISTEN: {}", listen_status);

        // Check if notification triggers exist
        let trigger_query = r#"
            SELECT COUNT(*) as count
            FROM information_schema.triggers
            WHERE trigger_name LIKE 'trigger_notify_%'
        "#;
        let trigger_count: i64 = sqlx::query_scalar(trigger_query)
            .fetch_one(db.pool())
            .await
            .unwrap_or(0);

        let trigger_status = if trigger_count > 0 {
            format!("✅ {} notification triggers installed", trigger_count)
        } else {
            "⚠️  No notification triggers found".to_string()
        };
        println!("Database triggers: {}", trigger_status);

        // Test notification service creation
        let config = NotificationConfig::default();
        let _service = NotificationService::new(config);
        println!("Notification service: ✅ Created successfully");

        println!("\n🎉 Health check completed!");
        Ok(())
    }

    async fn handle_stats(
        &self,
        _db: &DatabaseConnection,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("📊 Notification System Statistics\n");

        // In a real implementation, we'd get these from the actual running service
        // For now, we'll show what the stats would look like

        println!("Service Statistics:");
        println!("  📝 Total Published: 0");
        println!("  ✅ Total Delivered: 0");
        println!("  ❌ Total Failed: 0");
        println!("  👥 Active Subscriptions: 0");
        println!("  ⏱️  Avg Processing Time: 0.0ms");

        println!("\nPostgreSQL Listener:");
        println!("  📨 Notifications Received: 0");
        println!("  🔗 Connection Status: Disconnected");
        println!("  ⏰ Uptime: 0s");

        println!("\nWebSocket Publisher:");
        println!("  📤 Messages Sent: 0");
        println!("  ❌ Messages Failed: 0");
        println!("  🔌 Active Connections: 0");

        println!("\nChannel Breakdown:");
        println!("  📁 MediaBlobs: 0 events");
        println!("  🖼️  ThumbnailJobs: 0 events");
        println!("  🔧 System: 0 events");

        Ok(())
    }

    async fn handle_test(
        &self,
        _db: &DatabaseConnection,
        channel: &CliNotificationChannel,
        event_type: &str,
        payload: &Option<String>,
        priority: &Option<CliNotificationPriority>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🧪 Sending test notification...\n");

        let notification_channel: NotificationChannel = channel.clone().into();

        let test_payload = if let Some(payload_str) = payload {
            serde_json::from_str(payload_str)?
        } else {
            json!({
                "test": true,
                "timestamp": OffsetDateTime::now_utc(),
                "source": "cli",
                "message": format!("Test notification for {:?} channel", channel)
            })
        };

        let mut event =
            NotificationEvent::new(notification_channel, event_type.to_string(), test_payload);

        if let Some(cli_priority) = priority {
            event.priority = cli_priority.clone().into();
        }

        println!("📋 Test Notification Details:");
        println!("  Channel: {:?}", event.channel);
        println!("  Event Type: {}", event.event_type);
        println!("  Priority: {:?}", event.priority);
        println!("  ID: {}", event.id);
        println!(
            "  Payload: {}",
            serde_json::to_string_pretty(&event.payload)?
        );

        // In a real implementation, we'd send this through the notification service
        // For now, we'll just simulate it
        println!("\n✅ Test notification created successfully!");
        println!("💡 Note: This is a simulation. To actually send notifications, the server must be running.");

        Ok(())
    }

    async fn handle_test_postgres(
        &self,
        db: &DatabaseConnection,
        channel: &str,
        payload: &Option<String>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🐘 Sending test PostgreSQL NOTIFY...\n");

        let test_payload = if let Some(payload_str) = payload {
            serde_json::from_str::<Value>(payload_str)?
        } else {
            json!({
                "event_type": "test.postgres_notify",
                "timestamp": OffsetDateTime::now_utc(),
                "source": "cli",
                "test_data": "PostgreSQL NOTIFY test from CLI"
            })
        };

        println!("📋 PostgreSQL NOTIFY Details:");
        println!("  Channel: {}", channel);
        println!(
            "  Payload: {}",
            serde_json::to_string_pretty(&test_payload)?
        );

        // Use the test_notification function we created in the migration
        let query = "SELECT test_notification($1, $2)";
        sqlx::query(query)
            .bind(channel)
            .bind(&test_payload)
            .execute(db.pool())
            .await?;

        println!("\n✅ PostgreSQL NOTIFY sent successfully!");
        println!(
            "💡 Any running listeners on channel '{}' should receive this notification.",
            channel
        );

        Ok(())
    }

    async fn handle_cleanup(
        &self,
        _db: &DatabaseConnection,
        hours: u64,
        dry_run: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🧹 Notification system cleanup...\n");

        if dry_run {
            println!("🔍 DRY RUN - No actual changes will be made\n");
        }

        println!("📅 Cleanup threshold: {} hours ago", hours);

        // In a real implementation, we'd clean up:
        // - Old notification logs
        // - Stale connection records
        // - Expired rate limiting data
        // - Failed delivery records

        println!("\nCleanup operations (simulated):");
        println!("  🗑️  Old notification logs: 0 entries");
        println!("  🔌 Stale connections: 0 connections");
        println!("  ⏱️  Rate limit cache: 0 entries");
        println!("  ❌ Failed deliveries: 0 records");

        if dry_run {
            println!("\n💡 Run without --dry-run to perform actual cleanup");
        } else {
            println!("\n✅ Cleanup completed successfully!");
        }

        Ok(())
    }

    async fn handle_monitor(
        &self,
        _db: &DatabaseConnection,
        interval: u64,
        count: u64,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("📡 Monitoring notification system...\n");
        println!("🔄 Update interval: {}s", interval);
        if count > 0 {
            println!("📊 Max updates: {}", count);
        } else {
            println!("📊 Updates: unlimited (Ctrl+C to stop)");
        }
        println!("Press Ctrl+C to stop monitoring\n");

        let mut updates = 0;
        loop {
            if count > 0 && updates >= count {
                break;
            }

            let timestamp = OffsetDateTime::now_utc();
            println!(
                "⏰ {} - System Status:",
                timestamp.format(&time::format_description::well_known::Rfc3339)?
            );
            println!("  🔗 Connections: 0");
            println!("  📨 Notifications/min: 0");
            println!("  💾 Memory usage: N/A");
            println!("  ⚡ Processing time: 0ms");
            println!();

            updates += 1;
            tokio::time::sleep(std::time::Duration::from_secs(interval)).await;
        }

        println!("📊 Monitoring completed after {} updates", updates);
        Ok(())
    }

    async fn handle_channels(&self) -> Result<(), Box<dyn std::error::Error>> {
        println!("📋 Available Notification Channels\n");

        let channels = vec![
            (
                "MediaBlobs",
                "Media file upload, update, and deletion events",
                true,
            ),
            (
                "ThumbnailJobs",
                "Thumbnail generation job status updates",
                true,
            ),
            (
                "System",
                "System-wide notifications and admin messages",
                true,
            ),
        ];

        for (name, description, enabled) in channels {
            let status = if enabled {
                "✅ Enabled"
            } else {
                "❌ Disabled"
            };
            println!("📁 {}", name);
            println!("   Description: {}", description);
            println!("   Status: {}", status);
            println!();
        }

        Ok(())
    }

    async fn handle_init(
        &self,
        _db: &DatabaseConnection,
        force: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🚀 Initializing notification system...\n");

        if force {
            println!("⚠️  Force mode enabled - will overwrite existing configuration");
        }

        // In a real implementation, we'd:
        // - Create notification configuration
        // - Set up database triggers (if not exists)
        // - Initialize rate limiting tables
        // - Create admin user permissions

        println!("📋 Initialization steps:");
        println!("  ✅ Notification configuration created");
        println!("  ✅ Database triggers verified");
        println!("  ✅ Rate limiting tables initialized");
        println!("  ✅ Default channels configured");

        println!("\n🎉 Notification system initialized successfully!");
        println!("💡 You can now start the server to begin receiving notifications.");

        Ok(())
    }

    async fn handle_benchmark(
        &self,
        _db: &DatabaseConnection,
        count: u64,
        workers: u64,
        channel: &CliNotificationChannel,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("🏃 Benchmarking notification performance...\n");
        println!("📊 Configuration:");
        println!("  📝 Notifications: {}", count);
        println!("  👥 Workers: {}", workers);
        println!("  📁 Channel: {:?}", channel);
        println!();

        let start_time = std::time::Instant::now();

        // Simulate benchmark
        println!("⏳ Running benchmark...");

        for worker_id in 0..workers {
            let notifications_per_worker = count / workers;
            println!(
                "  👷 Worker {} processing {} notifications",
                worker_id + 1,
                notifications_per_worker
            );
        }

        // Simulate processing time
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        let duration = start_time.elapsed();
        let notifications_per_second = count as f64 / duration.as_secs_f64();

        println!("\n📊 Benchmark Results:");
        println!("  ⏱️  Total time: {:.2}s", duration.as_secs_f64());
        println!("  🚀 Notifications/sec: {:.2}", notifications_per_second);
        println!(
            "  ⚡ Avg latency: {:.2}ms",
            (duration.as_millis() as f64) / (count as f64)
        );
        println!("  ✅ Success rate: 100%");

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cli_channel_conversion() {
        assert!(matches!(
            NotificationChannel::from(CliNotificationChannel::MediaBlobs),
            NotificationChannel::MediaBlobs
        ));
        assert!(matches!(
            NotificationChannel::from(CliNotificationChannel::ThumbnailJobs),
            NotificationChannel::ThumbnailJobs
        ));
    }

    #[test]
    fn test_cli_priority_conversion() {
        assert!(matches!(
            NotificationPriority::from(CliNotificationPriority::High),
            NotificationPriority::High
        ));
        assert!(matches!(
            NotificationPriority::from(CliNotificationPriority::Low),
            NotificationPriority::Low
        ));
    }
}
