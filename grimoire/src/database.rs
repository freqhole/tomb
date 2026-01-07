//! internal database module - single SQLite database connection
//! consumers use grimoire apis that handle connections internally

use crate::config::get_config;
use crate::error::{GrimoireError, GrimoireResult};
use sqlx::SqlitePool;

/// connect to the main grimoire database
pub(crate) async fn connect() -> GrimoireResult<SqlitePool> {
    let config = get_config();
    let db_path = config.database_path();

    // Check that database file exists
    if !db_path.exists() {
        return Err(GrimoireError::DatabaseNotFound(format!(
            "Database file does not exist: {}\n\
             Run: grimoire config init",
            db_path.display()
        )));
    }

    let connection_string = format!("sqlite:{}?mode=rwc", db_path.display());
    let pool = SqlitePool::connect(&connection_string).await?;

    // Configure SQLite settings via PRAGMA statements
    sqlx::query("PRAGMA journal_mode = WAL")
        .execute(&pool)
        .await?;
    sqlx::query("PRAGMA synchronous = NORMAL")
        .execute(&pool)
        .await?;
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&pool)
        .await?;

    // Run migrations if enabled
    if config.database.auto_run_migrations {
        sqlx::migrate!("../migrations").run(&pool).await?;
    }

    Ok(pool)
}

// Legacy compatibility functions - all delegate to main database
#[deprecated(note = "Use connect() instead - all data is now in single database")]
pub(crate) async fn connect_media_blobz() -> GrimoireResult<SqlitePool> {
    connect().await
}

#[deprecated(note = "Use connect() instead - all data is now in single database")]
pub(crate) async fn connect_blob_data() -> GrimoireResult<SqlitePool> {
    connect().await
}

#[deprecated(note = "Use connect() instead - all data is now in single database")]
pub(crate) async fn connect_music() -> GrimoireResult<SqlitePool> {
    connect().await
}

#[deprecated(note = "Use connect() instead - all data is now in single database")]
pub(crate) async fn connect_app_state() -> GrimoireResult<SqlitePool> {
    connect().await
}
