use crate::jobs::ThumbnailJobQueue;
use crate::storage::SessionStore;
use grimoire::analytics::AnalyticsConfig;
use grimoire::config::{ConfigService, StorageBackend};
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
}

impl AppState {
    pub async fn new(config: AppConfig) -> Result<Self, Box<dyn std::error::Error>> {
        // Build WebAuthn configuration from config
        let rp_origin = Url::parse(&config.webauthn.rp_origin)?;
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

        // Initialize thumbnail job queue
        let config_service = ConfigService::new();
        let thumbnail_config = config_service.to_thumbnail_config(&config);
        let mut thumbnail_queue = ThumbnailJobQueue::new(database.clone(), thumbnail_config);

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

        Ok(AppState {
            webauthn,
            database,
            analytics_config,
            session_store,
            config,
            thumbnail_queue: Arc::new(tokio::sync::Mutex::new(thumbnail_queue)),
        })
    }

    /// Gracefully shutdown the application, stopping all background workers
    pub async fn shutdown(&self) -> Result<(), Box<dyn std::error::Error>> {
        tracing::info!("Shutting down application...");

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
