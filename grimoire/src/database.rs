//! internal database module - single SQLite database connection
//! consumers use grimoire apis that handle connections internally

use crate::config::AppConfig;
use crate::error::GrimoireResult;
use sqlx::SqlitePool;

/// connect to the main grimoire database
pub(crate) async fn connect() -> GrimoireResult<SqlitePool> {
    let config = AppConfig::default();

    // Extract file path and build connection string with proper SQLite options
    let db_file = config.database_file_path();
    let connection_string = format!("sqlite:{}?mode=rwc", db_file);

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

    // run migrations
    sqlx::migrate!("../migrations").run(&pool).await?;

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
