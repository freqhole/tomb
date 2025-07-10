use crate::jobs::ThumbnailJobQueue;
use crate::maintenance::{MaintenanceConfig, MaintenanceScheduler};
use crate::notifications::NotificationInfrastructure;
use crate::storage::SessionStore;
use crate::websocket::handlers::ConnectionManager;
use grimoire::analytics::AnalyticsConfig;
use grimoire::config::{ConfigService, StorageBackend};
use grimoire::notifications::NotificationConfig;

use grimoire::wordlist::{initialize_wordlist, ManagementWordlistConfig as WordlistConfig};
use grimoire::{AppConfig, DatabaseConnection};

use std::sync::Arc;
use tokio::fs;

use webauthn_rs::prelude::*;

/*
 * Webauthn RS server side app state and setup code.
 */

// Configure the Webauthn instance by using the WebauthnBuilder. This defines
// the options needed for your site, and has some implications. One of these is that
// you can NOT change your rp_id (relying party id), without invalidating all
// webauthn credentials. Remember, rp_id is derived from your URL origin, meaning
// that it is your effective domain name.

#[derive(Clone)]
pub struct AppState {
    // Webauthn has no mutable inner state, so Arc and read only is sufficient.
    // Alternately, you could use a reference here provided you can work out
    // lifetimes.
    pub webauthn: Arc<Webauthn>,
    // Database connection for persistent storage
    pub database: DatabaseConnection,
    // Analytics configuration for request tracking
    pub analytics_config: AnalyticsConfig,
    // Session store for tower-sessions
    pub session_store: SessionStore,
    // Application configuration
    pub config: AppConfig,
    // Thumbnail job queue for background processing
    pub thumbnail_queue: Arc<tokio::sync::Mutex<ThumbnailJobQueue>>,
    // WebSocket connection manager for real-time notifications
    pub connection_manager: ConnectionManager,
    // Maintenance scheduler for cleanup tasks
    pub maintenance_scheduler: Option<Arc<MaintenanceScheduler>>,
    // Notification infrastructure for PostgreSQL LISTEN/NOTIFY
    pub notification_infrastructure: Option<Arc<tokio::sync::Mutex<NotificationInfrastructure>>>,
}

impl AppState {
    pub async fn new(config: AppConfig) -> Result<Self, Box<dyn std::error::Error>> {
        // For backwards compatibility, create default WebAuthn instance with first origin
        let default_origin = config
            .webauthn
            .rp_origins
            .first()
            .unwrap_or(&config.webauthn.rp_origin);
        let rp_origin = Url::parse(default_origin)?;
        let builder = WebauthnBuilder::new(&config.webauthn.rp_id, &rp_origin)?;

        // Configure WebAuthn with settings from config
        let builder = builder.rp_name(&config.webauthn.rp_name);

        // Note: User verification and timeout settings may need to be configured
        // differently based on the webauthn-rs version and available methods
        // For now, using the basic builder configuration

        // Consume the builder and create our webauthn instance.
        let webauthn = Arc::new(builder.build()?);

        // Connect to the database using config
        println!("ZOMG DB URL: {}", &config.database_url());
        let database_url = config.database_url();

        // Configure connection pool
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(config.database.pool.max_connections)
            .min_connections(config.database.pool.min_connections)
            .acquire_timeout(std::time::Duration::from_secs(
                config.database.pool.connect_timeout_seconds,
            ))
            .idle_timeout(std::time::Duration::from_secs(
                config.database.pool.idle_timeout_seconds,
            ))
            .connect(&database_url)
            .await?;

        let database = DatabaseConnection::new(pool.clone());

        // Create analytics configuration
        // Analytics service will be created at usage sites to avoid lifetime issues
        let analytics_config = AnalyticsConfig::default();

        // Create session store based on storage configuration
        let session_store = match config.storage.sessions {
            StorageBackend::Memory => SessionStore::new_memory(),
            StorageBackend::Postgres => SessionStore::new_postgres(pool.clone()).await?,
        };

        // Run migrations if enabled
        if config.database.migrations.auto_run {
            database.migrate().await?;
        }

        // Initialize wordlist for invite code generation
        let wordlist_config = WordlistConfig::default();
        if let Err(e) = initialize_wordlist(&wordlist_config) {
            tracing::warn!("Wordlist initialization failed: {}", e);
            tracing::warn!("Word-based invite codes will not be available");
            tracing::warn!("To fix this, run: cargo run --bin cli wordlist generate");
        } else {
            tracing::info!("Wordlist initialized successfully for invite code generation");
        }

        // Create upload directory for large files
        if let Err(e) = fs::create_dir_all(&config.static_files.upload_directory).await {
            tracing::warn!(
                "Failed to create upload directory {}: {}",
                config.static_files.upload_directory,
                e
            );
        } else {
            tracing::info!(
                "Upload directory ready: {}",
                config.static_files.upload_directory
            );
        }

        // Validate thumbnail generation tools if enabled
        if config.media.thumbnails.enabled {
            tracing::info!("Validating thumbnail generation tools...");
            let config_service = ConfigService::new();
            let thumbnail_config = config_service.to_thumbnail_config(&config);

            match config_service
                .validate_thumbnail_tools(&thumbnail_config)
                .await
            {
                Ok(_) => {
                    tracing::info!("✅ Thumbnail tools validated successfully");
                    tracing::info!(
                        "ImageMagick: {}",
                        thumbnail_config
                            .imagemagick_path
                            .as_deref()
                            .unwrap_or("system PATH")
                    );
                    tracing::info!(
                        "FFmpeg: {}",
                        thumbnail_config
                            .ffmpeg_path
                            .as_deref()
                            .unwrap_or("system PATH")
                    );
                }
                Err(e) => {
                    tracing::error!("❌ Thumbnail tool validation failed: {}", e);
                    tracing::error!("Thumbnail generation will be disabled");
                    tracing::error!("To fix this:");
                    tracing::error!(
                        "  - Install ImageMagick: https://imagemagick.org/script/download.php"
                    );
                    tracing::error!("  - Install FFmpeg: https://ffmpeg.org/download.html");
                    tracing::error!("  - Or set custom paths in configuration");
                    tracing::warn!("Server will continue but thumbnail generation will not work");
                }
            }
        } else {
            tracing::info!("Thumbnail generation is disabled in configuration");
        }

        // Create shared connection manager for WebSocket and thumbnail notifications
        let connection_manager = ConnectionManager::new();
        let notification_tx = connection_manager.get_notification_sender();

        // Initialize thumbnail job queue with notification support
        let config_service = ConfigService::new();
        let thumbnail_config = config_service.to_thumbnail_config(&config);
        let mut thumbnail_queue = ThumbnailJobQueue::new_with_notifications(
            database.clone(),
            thumbnail_config,
            notification_tx,
        );

        // Start workers if thumbnail generation is enabled
        if config.media.thumbnails.enabled {
            let worker_count = config.media.thumbnails.max_concurrent_jobs;
            match thumbnail_queue.start_workers(worker_count).await {
                Ok(_) => {
                    tracing::info!("✅ Started {} thumbnail job workers", worker_count);
                }
                Err(e) => {
                    tracing::error!("❌ Failed to start thumbnail workers: {}", e);
                    tracing::warn!("Thumbnail generation will not be available");
                }
            }
        }

        // Initialize maintenance scheduler
        let maintenance_scheduler = if config.media.thumbnails.enabled {
            let maintenance_config = MaintenanceConfig {
                auto_run: false,        // Disabled by default for safety
                interval_seconds: 3600, // Run every hour
                max_completed_job_age_days: 30,
                cleanup_orphaned_files: true,
                max_jobs_per_cycle: 1000,
            };

            let scheduler = MaintenanceScheduler::new(maintenance_config);
            tracing::info!("🧹 Maintenance scheduler configured (auto_run: disabled)");
            tracing::info!("💡 Enable maintenance in production with appropriate configuration");

            Some(Arc::new(scheduler))
        } else {
            None
        };

        // Initialize notification infrastructure
        let notification_infrastructure = if config.features.notifications_enabled {
            let notification_config = NotificationConfig::default();
            let mut infrastructure = NotificationInfrastructure::new(notification_config);

            let websocket_tx = connection_manager.get_notification_sender();

            match infrastructure.start(database.clone(), websocket_tx).await {
                Ok(_) => {
                    tracing::info!("✅ Notification infrastructure started successfully");
                    Some(Arc::new(tokio::sync::Mutex::new(infrastructure)))
                }
                Err(e) => {
                    tracing::error!("❌ Failed to start notification infrastructure: {}", e);
                    tracing::warn!("Real-time notifications will not be available");
                    None
                }
            }
        } else {
            tracing::info!("🔕 Notifications are disabled in configuration");
            None
        };

        Ok(AppState {
            webauthn,
            database,
            analytics_config,
            session_store,
            config,
            thumbnail_queue: Arc::new(tokio::sync::Mutex::new(thumbnail_queue)),
            connection_manager,
            maintenance_scheduler,
            notification_infrastructure,
        })
    }

    /// Create a WebAuthn instance for a specific origin
    /// This allows supporting multiple domains (ngrok, tailscale, etc.)
    pub fn create_webauthn_for_origin(
        &self,
        origin: &str,
    ) -> Result<Webauthn, Box<dyn std::error::Error>> {
        // Validate that the origin is in our allowed list
        let allowed_origins = if !self.config.webauthn.rp_origins.is_empty() {
            &self.config.webauthn.rp_origins
        } else {
            &vec![self.config.webauthn.rp_origin.clone()]
        };

        if !allowed_origins.contains(&origin.to_string()) {
            return Err(format!("Origin '{}' not in allowed WebAuthn origins", origin).into());
        }

        let rp_origin = Url::parse(origin)?;
        let builder = WebauthnBuilder::new(&self.config.webauthn.rp_id, &rp_origin)?;
        let builder = builder.rp_name(&self.config.webauthn.rp_name);
        Ok(builder.build()?)
    }

    /// Gracefully shutdown the application, stopping all background workers
    pub async fn shutdown(&self) -> Result<(), Box<dyn std::error::Error>> {
        tracing::info!("Shutting down application...");

        // Stop notification infrastructure
        if let Some(infrastructure) = &self.notification_infrastructure {
            let mut infra = infrastructure.lock().await;
            if let Err(e) = infra.shutdown().await {
                tracing::error!("Failed to stop notification infrastructure: {}", e);
            } else {
                tracing::info!("✅ Notification infrastructure stopped gracefully");
            }
        }

        // Stop maintenance scheduler
        if let Some(scheduler) = &self.maintenance_scheduler {
            scheduler.stop();
        }

        // Stop thumbnail job workers
        if self.config.media.thumbnails.enabled {
            let mut queue = self.thumbnail_queue.lock().await;
            if let Err(e) = queue.stop_workers().await {
                tracing::error!("Failed to stop thumbnail workers: {}", e);
            } else {
                tracing::info!("✅ Thumbnail workers stopped gracefully");
            }
        }

        tracing::info!("Application shutdown complete");
        Ok(())
    }
}

/// Validate external tools required for thumbnail generation
pub async fn validate_thumbnail_tools(
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    if !config.media.thumbnails.enabled {
        println!("Thumbnail generation is disabled in configuration");
        return Ok(());
    }

    println!("Validating thumbnail generation tools...");

    let config_service = ConfigService::new();
    let thumbnail_config = config_service.to_thumbnail_config(config);

    match config_service
        .validate_thumbnail_tools(&thumbnail_config)
        .await
    {
        Ok(_) => {
            println!("✅ All thumbnail tools are available:");
            println!(
                "  ImageMagick: {}",
                thumbnail_config
                    .imagemagick_path
                    .as_deref()
                    .unwrap_or("system PATH")
            );
            println!(
                "  FFmpeg: {}",
                thumbnail_config
                    .ffmpeg_path
                    .as_deref()
                    .unwrap_or("system PATH")
            );
            println!("Thumbnail generation is ready!");
            Ok(())
        }
        Err(e) => {
            eprintln!("❌ Thumbnail tool validation failed: {}", e);
            eprintln!("To fix this:");
            eprintln!("  - Install ImageMagick: https://imagemagick.org/script/download.php");
            eprintln!("  - Install FFmpeg: https://ffmpeg.org/download.html");
            eprintln!("  - Or set custom paths in configuration");
            Err(e.into())
        }
    }
}
