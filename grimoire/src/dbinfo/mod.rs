//! Database information and testing operations

use crate::config::get_config;
use crate::database::connect;
use crate::error::GrimoireResult;
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfoResponse {
    pub name: String,
    pub record_count: i64,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseTestResponse {
    pub connection_ok: bool,
    pub tables: Vec<TableInfoResponse>,
}

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

/// Test database connection and verify tables
pub async fn test_database() -> GrimoireResult<DatabaseTestResponse> {
    let pool = connect().await?;

    // Test basic query
    let result: (i64,) = sqlx::query_as("SELECT 1").fetch_one(&pool).await?;

    let connection_ok = result.0 == 1;

    // Check tables
    let table_names = vec![
        "media_blobz",
        "blob_data",
        "songz",
        "artistz",
        "albumz",
        "taxonz",
        "jobz",
        "job_sessionz",
    ];

    let mut tables = Vec::new();
    for table in table_names {
        let count_result = sqlx::query(&format!("SELECT COUNT(*) as count FROM {}", table))
            .fetch_one(&pool)
            .await;

        match count_result {
            Ok(row) => {
                let count: i64 = row.get("count");
                tables.push(TableInfoResponse {
                    name: table.to_string(),
                    record_count: count,
                    exists: true,
                });
            }
            Err(_) => {
                tables.push(TableInfoResponse {
                    name: table.to_string(),
                    record_count: 0,
                    exists: false,
                });
            }
        }
    }

    Ok(DatabaseTestResponse {
        connection_ok,
        tables,
    })
}

/// Get database information
pub async fn get_database_info() -> GrimoireResult<DatabaseInfoResponse> {
    let config = get_config();
    let db_path = config.database_path();

    let (file_exists, file_size_mb) = if let Ok(metadata) = std::fs::metadata(&db_path) {
        (true, Some(metadata.len() as f64 / 1_024_000.0))
    } else {
        (false, None)
    };

    let mut sqlite_version = None;
    let mut journal_mode = None;
    let mut foreign_keys_enabled = None;

    // Get SQLite info if connected
    if let Ok(pool) = connect().await {
        if let Ok(row) = sqlx::query("SELECT sqlite_version()")
            .fetch_one(&pool)
            .await
        {
            sqlite_version = Some(row.get(0));
        }

        if let Ok(row) = sqlx::query("PRAGMA journal_mode").fetch_one(&pool).await {
            journal_mode = Some(row.get(0));
        }

        if let Ok(row) = sqlx::query("PRAGMA foreign_keys").fetch_one(&pool).await {
            let fk: i64 = row.get(0);
            foreign_keys_enabled = Some(fk == 1);
        }
    }

    Ok(DatabaseInfoResponse {
        data_directory: config.data_dir.display().to_string(),
        database_file: db_path.display().to_string(),
        file_exists,
        file_size_mb,
        sqlite_version,
        journal_mode,
        foreign_keys_enabled,
    })
}
