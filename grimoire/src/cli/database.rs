//! Database operations CLI commands

use crate::error::GrimoireResult;
use clap::Subcommand;

#[derive(Subcommand)]
pub enum DatabaseAction {
    /// Test database connection
    Test,
    /// Show database information
    Info,
}

/// Handle database commands
pub async fn handle_command(action: DatabaseAction) -> GrimoireResult<()> {
    match action {
        DatabaseAction::Test => {
            println!("testing database connection...");

            let pool = crate::database::connect().await?;

            // Test basic query
            let result: (i64,) = sqlx::query_as("SELECT 1").fetch_one(&pool).await?;

            if result.0 == 1 {
                println!("database connection successful");
            } else {
                println!("database connection test failed");
            }

            // Test tables exist
            println!("\nchecking tables:");
            let tables = vec![
                "media_blobz",
                "blob_data",
                "songz",
                "artistz",
                "albumz",
                "genrez",
                "jobz",
                "job_sessionz",
            ];

            for table in tables {
                let count_result = sqlx::query(&format!("SELECT COUNT(*) as count FROM {}", table))
                    .fetch_one(&pool)
                    .await;

                match count_result {
                    Ok(row) => {
                        let count: i64 = row.get("count");
                        println!("  {}: {} records", table, count);
                    }
                    Err(_) => {
                        println!("  {}: table not found or error", table);
                    }
                }
            }
        }

        DatabaseAction::Info => {
            println!("database information:");

            let config = crate::config::get_config();
            let db_path = config.database_path();

            println!("  data directory: {}", config.data_dir.display());
            println!("  database file: {}", db_path.display());

            // Check if file exists and get size
            if let Ok(metadata) = std::fs::metadata(&db_path) {
                println!("  file size: {:.2} mb", metadata.len() as f64 / 1_024_000.0);
                println!("  file exists: yes");
            } else {
                println!("  file exists: no");
            }

            // Test connection and get SQLite info
            if let Ok(pool) = crate::database::connect().await {
                if let Ok(row) = sqlx::query("SELECT sqlite_version()")
                    .fetch_one(&pool)
                    .await
                {
                    let version: String = row.get(0);
                    println!("  sqlite version: {}", version);
                }

                if let Ok(row) = sqlx::query("PRAGMA journal_mode").fetch_one(&pool).await {
                    let journal_mode: String = row.get(0);
                    println!("  journal mode: {}", journal_mode);
                }

                if let Ok(row) = sqlx::query("PRAGMA foreign_keys").fetch_one(&pool).await {
                    let foreign_keys: i64 = row.get(0);
                    println!(
                        "  foreign keys: {}",
                        if foreign_keys == 1 { "on" } else { "off" }
                    );
                }
            }
        }
    }

    Ok(())
}
