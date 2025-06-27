//! Notification System Demo
//!
//! This example demonstrates the Phase 3 real-time notification system including:
//! - PostgreSQL NOTIFY/LISTEN integration
//! - WebSocket broadcasting
//! - CLI management tools
//! - Client-side JavaScript integration
//!
//! Run with: cargo run --example notification_demo

use grimoire::notifications::{
    NotificationChannel, NotificationConfig, NotificationEvent, NotificationService,
};
use grimoire::{AppConfig, DatabaseConnection};
use serde_json::json;
use sqlx::PgPool;
use std::time::Duration;
use tokio::time::sleep;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter("notification_demo=info,grimoire=debug")
        .init();

    println!("🚀 Notification System Demo");
    println!("===========================\n");

    // Load configuration
    let config = AppConfig::default();
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://postgres:password@localhost:5432/webauthn_rs".to_string());

    // Connect to database
    println!("📊 Connecting to database...");
    let pool = PgPool::connect(&database_url).await?;
    let db = DatabaseConnection::new(pool);

    // Run migrations to ensure triggers are in place
    println!("🔧 Running database migrations...");
    db.migrate().await?;

    // Create notification service
    println!("⚙️  Setting up notification service...");
    let notification_config = NotificationConfig::default();
    let notification_service = NotificationService::new(notification_config);

    println!("✅ Notification system initialized!\n");

    // Demo 1: Manual notification publishing
    demo_manual_notifications(&notification_service).await?;

    // Demo 2: Database trigger testing
    demo_database_triggers(&db).await?;

    // Demo 3: PostgreSQL NOTIFY testing
    demo_postgres_notify(&db).await?;

    // Demo 4: Notification channels
    demo_notification_channels(&notification_service).await?;

    println!("\n🎉 Demo completed successfully!");
    println!("\n📋 Next Steps:");
    println!("1. Start the server: cargo run --bin server");
    println!("2. Open WebSocket connection to ws://localhost:3000/ws");
    println!("3. Use CLI tools: cargo run --bin cli notifications --help");
    println!("4. Test HTTP API endpoints at http://localhost:3000/notifications/");
    println!("5. Try the JavaScript client in client/js/notification-client.js");

    Ok(())
}

async fn demo_manual_notifications(
    service: &NotificationService,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("📝 Demo 1: Manual Notification Publishing");
    println!("------------------------------------------");

    // Create different types of notifications
    let notifications = vec![
        NotificationEvent::new(
            NotificationChannel::MediaBlobs,
            "media_blob.created".to_string(),
            json!({
                "blob_id": "123e4567-e89b-12d3-a456-426614174000",
                "filename": "demo_photo.jpg",
                "size_bytes": 2048000,
                "mime_type": "image/jpeg",
                "source_client_id": "demo_client",
                "message": "Demo photo uploaded successfully"
            }),
        ),
        NotificationEvent::new(
            NotificationChannel::ThumbnailJobs,
            "thumbnail_job.started".to_string(),
            json!({
                "job_id": "job_456",
                "media_blob_id": "123e4567-e89b-12d3-a456-426614174000",
                "dimensions": {"width": 200, "height": 200},
                "priority": "Normal"
            }),
        ),
        NotificationEvent::new(
            NotificationChannel::System,
            "system.maintenance".to_string(),
            json!({
                "message": "System maintenance scheduled for 2:00 AM UTC",
                "scheduled_time": "2024-01-15T02:00:00Z",
                "duration_minutes": 30,
                "affected_services": ["thumbnails", "uploads"]
            }),
        ),
    ];

    for (i, event) in notifications.iter().enumerate() {
        println!("  {}. Publishing {} event...", i + 1, event.event_type);

        match service.publish_event(event.clone()).await {
            Ok(()) => println!("     ✅ Published successfully"),
            Err(e) => println!("     ❌ Failed: {}", e),
        }
    }

    // Show service statistics
    let stats = service.get_stats().await;
    println!("\n📊 Service Statistics:");
    println!("   Total published: {}", stats.total_published);
    println!("   Total delivered: {}", stats.total_delivered);
    println!("   Total failed: {}", stats.total_failed);
    println!("   Active subscriptions: {}", stats.total_subscriptions);

    sleep(Duration::from_millis(500)).await;
    Ok(())
}

async fn demo_database_triggers(db: &DatabaseConnection) -> Result<(), Box<dyn std::error::Error>> {
    println!("\n🗄️  Demo 2: Database Trigger Testing");
    println!("------------------------------------");

    println!("  1. Creating test media blob (should trigger notification)...");

    // Insert a test media blob to trigger PostgreSQL NOTIFY
    let result = sqlx::query(
        r#"
        INSERT INTO media_blobs (sha256, size, mime, metadata, source_client_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        "#,
    )
    .bind("demo_hash_123456789")
    .bind(1024i64)
    .bind("image/png")
    .bind(json!({"filename": "demo_trigger_test.png", "demo": true}))
    .bind("demo_client")
    .fetch_one(db.pool())
    .await;

    match result {
        Ok(row) => {
            let blob_id: uuid::Uuid = row.get("id");
            println!("     ✅ Media blob created: {}", blob_id);
            println!("     📡 PostgreSQL NOTIFY should have been triggered");

            // Update the blob to trigger update notification
            println!("  2. Updating media blob (should trigger update notification)...");
            let update_result = sqlx::query(
                "UPDATE media_blobs SET metadata = $1 WHERE id = $2"
            )
            .bind(json!({"filename": "demo_updated.png", "demo": true, "updated": true}))
            .bind(blob_id)
            .execute(db.pool())
            .await;

            if update_result.is_ok() {
                println!("     ✅ Media blob updated");
                println!("     📡 Update NOTIFY should have been triggered");
            }
        }
        Err(e) => println!("     ❌ Failed to create media blob: {}", e),
    }

    sleep(Duration::from_millis(500)).await;
    Ok(())
}

async fn demo_postgres_notify(db: &DatabaseConnection) -> Result<(), Box<dyn std::error::Error>> {
    println!("\n📡 Demo 3: Direct PostgreSQL NOTIFY Testing");
    println!("--------------------------------------------");

    let test_notifications = vec![
        ("media_blobs", json!({
            "event_type": "media_blob.demo",
            "source": "notification_demo",
            "message": "Direct NOTIFY test for media blobs channel",
            "timestamp": chrono::Utc::now().to_rfc3339()
        })),
        ("thumbnail_jobs", json!({
            "event_type": "thumbnail_job.demo",
            "source": "notification_demo",
            "message": "Direct NOTIFY test for thumbnail jobs channel",
            "job_id": "demo_job_999"
        })),
    ];

    for (i, (channel, payload)) in test_notifications.iter().enumerate() {
        println!("  {}. Sending NOTIFY to '{}' channel...", i + 1, channel);

        let result = sqlx::query("SELECT test_notification($1, $2)")
            .bind(channel)
            .bind(payload)
            .execute(db.pool())
            .await;

        match result {
            Ok(_) => println!("     ✅ NOTIFY sent successfully"),
            Err(e) => println!("     ❌ Failed: {}", e),
        }
    }

    sleep(Duration::from_millis(500)).await;
    Ok(())
}

async fn demo_notification_channels(
    service: &NotificationService,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("\n📋 Demo 4: Notification Channels Overview");
    println!("-----------------------------------------");

    println!("  Available notification channels:");
    println!("    📁 MediaBlobs - File upload, update, and deletion events");
    println!("    🖼️  ThumbnailJobs - Thumbnail generation status updates");
    println!("    🔧 System - System-wide notifications and admin messages");
    println!("    👤 UserAuth - User authentication events");
    println!("    📊 Analytics - Analytics and reporting events");

    println!("\n  Example events for each channel:");

    // MediaBlobs channel events
    let media_events = vec![
        "media_blob.created",
        "media_blob.updated",
        "media_blob.deleted",
    ];

    println!("    📁 MediaBlobs:");
    for event in media_events {
        println!("       • {}", event);
    }

    // ThumbnailJobs channel events
    let thumbnail_events = vec![
        "thumbnail_job.created",
        "thumbnail_job.started",
        "thumbnail_job.completed",
        "thumbnail_job.failed",
    ];

    println!("    🖼️  ThumbnailJobs:");
    for event in thumbnail_events {
        println!("       • {}", event);
    }

    // System channel events
    let system_events = vec![
        "system.maintenance",
        "system.alert",
        "admin.broadcast",
    ];

    println!("    🔧 System:");
    for event in system_events {
        println!("       • {}", event);
    }

    println!("\n  📊 Current service configuration:");
    println!("     • Rate limiting: enabled");
    println!("     • Event deduplication: enabled");
    println!("     • Priority filtering: enabled");
    println!("     • User permission filtering: available");

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_notification_creation() {
        let event = NotificationEvent::new(
            NotificationChannel::MediaBlobs,
            "test.event".to_string(),
            json!({"test": true}),
        );

        assert_eq!(event.channel, NotificationChannel::MediaBlobs);
        assert_eq!(event.event_type, "test.event");
        assert!(event.payload_value().get("test").is_some());
    }

    #[test]
    fn test_notification_config() {
        let config = NotificationConfig::default();
        // Basic test that config can be created
        assert!(config.get_channel_config(NotificationChannel::MediaBlobs).is_some());
    }
}
