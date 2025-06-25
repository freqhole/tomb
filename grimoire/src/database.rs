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

    /// Simple migration status check
    /// For actual migrations, use sqlx-cli or the migration files directly
    pub async fn migrate(&self) -> Result<(), sqlx::Error> {
        // Check if base tables exist
        let base_tables_exist = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'invite_codes')"
        )
        .fetch_one(&self.pool)
        .await?;

        if !base_tables_exist {
            tracing::warn!("Base tables don't exist. Please run migrations using sqlx-cli or apply the migration files manually.");
        }

        // Check if analytics table exists
        let analytics_table_exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'request_analytics')"
        )
        .fetch_one(&self.pool)
        .await?;

        if !analytics_table_exists {
            tracing::warn!("Analytics table doesn't exist. Please run migration 003_analytics.sql");
        }

        Ok(())
    }
}

// Re-export for convenient access to repositories
pub use crate::analytics::AnalyticsRepository;
pub use crate::auth::AuthRepository;
pub use crate::thumbnails::ThumbnailRepository;
