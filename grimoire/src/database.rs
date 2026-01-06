//! internal database module - single SQLite database connection
//! consumers use grimoire apis that handle connections internally

use crate::config::AppConfig;
use crate::error::GrimoireResult;
use sqlx::SqlitePool;

/// connect to the main grimoire database
pub(crate) async fn connect() -> GrimoireResult<SqlitePool> {
    let config = AppConfig::default();

    // Extract file path and build standardized connection string
    let db_file = config.database_file_path();
    let connection_string = format!(
        "sqlite:{}?mode=rwc&journal_mode=WAL&synchronous=NORMAL&foreign_keys=on",
        db_file
    );

    let pool = SqlitePool::connect(&connection_string).await?;

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
