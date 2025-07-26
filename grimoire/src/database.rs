use sqlx::PgPool;

/// Core database connection wrapper
#[derive(Clone)]
pub struct DatabaseConnection {
    pool: PgPool,
}

impl DatabaseConnection {
    /// Create a new DatabaseConnection instance with the given connection pool
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Get a reference to the underlying connection pool
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Run embedded database migrations
    /// Migrations are embedded in the binary at compile time from ../migrations directory
    pub async fn migrate(&self) -> Result<(), sqlx::Error> {
        tracing::info!("Running database migrations...");

        // Run embedded migrations - this embeds all .sql files from ../migrations at compile time
        sqlx::migrate!("../migrations").run(&self.pool).await?;

        tracing::info!("Database migrations completed successfully");
        Ok(())
    }
}

// Re-export for convenient access to repositories
pub use crate::analytics::AnalyticsRepository;
pub use crate::auth::AuthRepository;
pub use crate::thumbnails::ThumbnailRepository;
