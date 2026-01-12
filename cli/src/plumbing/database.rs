//! Database operations CLI commands

use grimoire::plumbing::utils::CommandOutput;
use grimoire::database::{DatabaseInfoResponse, DatabaseTestResponse, TableInfoResponse};
use clap::Subcommand;
use sqlx::Row;

#[derive(Subcommand)]
pub enum DatabaseAction {
    /// Test database connection
    Test,
    /// Show database information
    Info,
}

/// Handle database commands
pub async fn handle_command(action: DatabaseAction) -> CommandOutput<serde_json::Value> {
    match action {
        DatabaseAction::Test => {
            let pool = match crate::database::connect().await {
                Ok(p) => p,
                Err(e) => {
                    return CommandOutput::failure(
                        "Failed to connect to database",
                        vec![e.into()],
                        (),
                    )
                    
                }
            };

            // Test basic query
            let result: (i64,) = match sqlx::query_as("SELECT 1").fetch_one(&pool).await {
                Ok(r) => r,
                Err(e) => {
                    return CommandOutput::failure(
                        "Failed to execute test query",
                        vec![e.into()],
                        (),
                    )
                    
                }
            };
            let connection_ok = result.0 == 1;

            // Check tables
            let table_names = vec![
                "media_blobz",
                "blob_data",
                "songz",
                "artistz",
                "albumz",
                "genrez",
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

            let result = DatabaseTestResponse {
                connection_ok,
                tables,
            };

            let message = if connection_ok {
                "Database connection successful"
            } else {
                "Database connection test failed"
            };

            CommandOutput::success(message, result)
        }

        DatabaseAction::Info => {
            let config = crate::config::get_config();
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
            if let Ok(pool) = crate::database::connect().await {
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

            let info = DatabaseInfoResponse {
                data_directory: config.data_dir.display().to_string(),
                database_file: db_path.display().to_string(),
                file_exists,
                file_size_mb,
                sqlite_version,
                journal_mode,
                foreign_keys_enabled,
            };

            let message = format!("Database: {}", db_path.display());
            CommandOutput::success(message, info)
        }
    }
}
