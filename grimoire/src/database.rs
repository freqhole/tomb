//! internal database module - simple connection helpers
//! consumers use grimoire apis that handle connections internally

use crate::config::AppConfig;
use crate::error::GrimoireResult;
use sqlx::SqlitePool;

/// connect to media_blobz database
pub(crate) async fn connect_media_blobz() -> GrimoireResult<SqlitePool> {
    let config = AppConfig::default();
    let connection_string = format!(
        "sqlite://{}?mode=rwc&journal_mode=WAL&synchronous=NORMAL",
        config.database.media_blobz_path
    );

    let pool = SqlitePool::connect(&connection_string).await?;

    // run migrations
    sqlx::migrate!("../migrations").run(&pool).await?;

    Ok(pool)
}

/// connect to blob_data database
pub(crate) async fn connect_blob_data() -> GrimoireResult<SqlitePool> {
    let config = AppConfig::default();
    let connection_string = format!(
        "sqlite://{}?mode=rwc&journal_mode=WAL&synchronous=NORMAL",
        config.database.blob_data_path
    );

    let pool = SqlitePool::connect(&connection_string).await?;
    sqlx::migrate!("../migrations").run(&pool).await?;
    Ok(pool)
}

/// connect to music database
pub(crate) async fn connect_music() -> GrimoireResult<SqlitePool> {
    let config = AppConfig::default();
    let connection_string = format!(
        "sqlite://{}?mode=rwc&journal_mode=WAL&synchronous=NORMAL",
        config.database.music_path
    );

    let pool = SqlitePool::connect(&connection_string).await?;
    sqlx::migrate!("../migrations").run(&pool).await?;
    Ok(pool)
}

/// connect to app_state database
pub(crate) async fn connect_app_state() -> GrimoireResult<SqlitePool> {
    let config = AppConfig::default();
    let connection_string = format!(
        "sqlite://{}?mode=rwc&journal_mode=WAL&synchronous=NORMAL",
        config.database.app_state_path
    );

    let pool = SqlitePool::connect(&connection_string).await?;
    sqlx::migrate!("../migrations").run(&pool).await?;
    Ok(pool)
}
