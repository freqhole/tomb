//! internal database module - simple connection helpers
//! consumers use grimoire apis that handle connections internally

use crate::error::GrimoireResult;
use sqlx::SqlitePool;
use std::path::Path;

/// connect to media_blobz database
pub(crate) async fn connect_media_blobz<P: AsRef<Path>>(path: P) -> GrimoireResult<SqlitePool> {
    let connection_string = format!(
        "sqlite://{}?mode=rwc&journal_mode=WAL&synchronous=NORMAL",
        path.as_ref().display()
    );

    let pool = SqlitePool::connect(&connection_string).await?;

    // run migrations
    sqlx::migrate!("../migrations").run(&pool).await?;

    Ok(pool)
}

/// connect to blob_data database
pub(crate) async fn connect_blob_data<P: AsRef<Path>>(path: P) -> GrimoireResult<SqlitePool> {
    let connection_string = format!(
        "sqlite://{}?mode=rwc&journal_mode=WAL&synchronous=NORMAL",
        path.as_ref().display()
    );

    let pool = SqlitePool::connect(&connection_string).await?;
    sqlx::migrate!("../migrations").run(&pool).await?;
    Ok(pool)
}

/// connect to music database
pub(crate) async fn connect_music<P: AsRef<Path>>(path: P) -> GrimoireResult<SqlitePool> {
    let connection_string = format!(
        "sqlite://{}?mode=rwc&journal_mode=WAL&synchronous=NORMAL",
        path.as_ref().display()
    );

    let pool = SqlitePool::connect(&connection_string).await?;
    sqlx::migrate!("../migrations").run(&pool).await?;
    Ok(pool)
}

/// connect to app_state database
pub(crate) async fn connect_app_state<P: AsRef<Path>>(path: P) -> GrimoireResult<SqlitePool> {
    let connection_string = format!(
        "sqlite://{}?mode=rwc&journal_mode=WAL&synchronous=NORMAL",
        path.as_ref().display()
    );

    let pool = SqlitePool::connect(&connection_string).await?;
    sqlx::migrate!("../migrations").run(&pool).await?;
    Ok(pool)
}
