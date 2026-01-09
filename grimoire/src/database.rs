//! internal database module - single SQLite database connection
//! consumers use grimoire apis that handle connections internally

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::config::get_config;
use crate::error::{GrimoireError, GrimoireResult};

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

// #TODO: so i guess it could be neat to have a standalone blob_data sqlite db file?
// #[deprecated(note = "Use connect() instead - all data is now in single database")]
// pub(crate) async fn connect_blob_data() -> GrimoireResult<SqlitePool> {
//     connect().await
// }

/// Response for database connection test (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseTestResponse {
    pub connection_ok: bool,
    pub tables: Vec<TableInfoResponse>,
}

/// Response for individual table info (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfoResponse {
    pub name: String,
    pub record_count: i64,
    pub exists: bool,
}

/// Response for database information (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseInfoResponse {
    pub data_directory: String,
    pub database_file: String,
    pub file_exists: bool,
    pub file_size_mb: Option<f64>,
    pub sqlite_version: Option<String>,
    pub journal_mode: Option<String>,
    pub foreign_keys_enabled: Option<bool>,
}
