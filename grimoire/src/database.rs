//! internal database module - single SQLite database connection
//! consumers use grimoire apis that handle connections internally
//!
//! startup flow:
//! 1. server/cli main calls `initialize()` once
//! 2. initialize() runs migrations + creates views + creates blob_data db
//! 3. all other code calls `connect()` or `connect_blob_data()` which return singleton pools
//!
//! IMPORTANT: pools are singletons - created once, reused for all requests.

use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{Executor, SqlitePool};
use tokio::sync::OnceCell;

use crate::config::get_config;
use crate::error::{GrimoireError, GrimoireResult};

// singleton pools - initialized once, reused for all requests
static MAIN_POOL: OnceCell<SqlitePool> = OnceCell::const_new();
static BLOB_POOL: OnceCell<SqlitePool> = OnceCell::const_new();

// view SQL files embedded at compile time, in dependency order
// (drop runs in reverse, create runs forward).
mod views {
    pub struct View {
        pub name: &'static str,
        pub sql: &'static str,
    }

    pub const ALL: &[View] = &[
        View {
            name: "artist_query_view",
            sql: include_str!("../../migrations/views/artist_query_view.sql"),
        },
        View {
            name: "album_query_view",
            sql: include_str!("../../migrations/views/album_query_view.sql"),
        },
        View {
            name: "genre_query_view",
            sql: include_str!("../../migrations/views/genre_query_view.sql"),
        },
        View {
            name: "song_query_view",
            sql: include_str!("../../migrations/views/song_query_view.sql"),
        },
        View {
            name: "playlist_query_view",
            sql: include_str!("../../migrations/views/playlist_query_view.sql"),
        },
        View {
            name: "playlist_song_query_view",
            sql: include_str!("../../migrations/views/playlist_song_query_view.sql"),
        },
        View {
            name: "feed_query_view",
            sql: include_str!("../../migrations/views/feed_query_view.sql"),
        },
    ];
}

/// initialize database - call ONCE at application startup (server/cli main).
/// pre-warms the singleton pool. migrations are NOT run here — call
/// `run_migrations()` explicitly at startup if needed.
pub async fn initialize() -> GrimoireResult<()> {
    let _pool = connect().await?;
    Ok(())
}

/// explicitly run migrations and setup views/blob_data
/// call this during setup wizard or when you need manual migration control
pub async fn run_migrations() -> GrimoireResult<()> {
    let pool = connect().await?;
    run_migrations_internal(&pool).await
}

/// internal migration runner - shared by initialize() and run_migrations()
async fn run_migrations_internal(pool: &SqlitePool) -> GrimoireResult<()> {
    // drop all query views BEFORE running migrations.
    //
    // why: migrations that rebuild a table (e.g. CREATE _new + DROP old +
    // RENAME) cannot run while a view references the old table on stricter
    // sqlite builds (notably the older sqlite shipped with android). dropping
    // the views up front removes the dependency; they are recreated below
    // from the embedded view scripts after migrations finish.
    //
    // safe to drop unconditionally: views are pure projections recreated on
    // every startup and contain no persistent data. drop in reverse
    // dependency order.
    for view in views::ALL.iter().rev() {
        pool.execute(format!("DROP VIEW IF EXISTS {};", view.name).as_str())
            .await?;
    }

    // run migrations
    sqlx::migrate!("../migrations").run(pool).await?;

    // recreate views in dependency order. each .sql has DROP IF EXISTS +
    // CREATE, so we use Executor::execute on the raw &str which runs all
    // statements in the script (sqlx::query() only runs the first).
    for view in views::ALL {
        pool.execute(view.sql).await?;
    }

    // initialize blob_data database (separate file for raw binary storage)
    let blob_pool = connect_blob_data().await?;
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS blob_data (
            id TEXT PRIMARY KEY,
            data BLOB NOT NULL
        )",
    )
    .execute(&blob_pool)
    .await?;

    // create freqhole-blobz directory for iroh-blobs FsStore
    let config = get_config();
    let blobz_path = config.freqhole_blobz_path();
    if !blobz_path.exists() {
        std::fs::create_dir_all(&blobz_path).map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to create freqhole-blobz directory: {}", e),
        })?;
        tracing::info!("created freqhole-blobz directory: {}", blobz_path.display());
    }

    Ok(())
}

/// connect to the main grimoire database
/// returns a clone of the singleton pool (cheap - just Arc clone)
/// PRAGMAs are only run once on first connection
pub(crate) async fn connect() -> GrimoireResult<SqlitePool> {
    let pool = MAIN_POOL
        .get_or_try_init(|| async { create_main_pool().await })
        .await?;
    Ok(pool.clone())
}

/// internal: create and configure the main database pool
async fn create_main_pool() -> GrimoireResult<SqlitePool> {
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
    let pool = SqlitePoolOptions::new()
        .max_connections(config.database.max_connections)
        .acquire_timeout(std::time::Duration::from_secs(
            config.database.acquire_timeout_seconds,
        ))
        .idle_timeout(std::time::Duration::from_secs(
            config.database.idle_timeout_seconds,
        ))
        .connect(&connection_string)
        .await?;

    // Configure SQLite settings via PRAGMA statements (runs ONCE)
    sqlx::query("PRAGMA journal_mode = WAL")
        .execute(&pool)
        .await?;
    sqlx::query("PRAGMA synchronous = NORMAL")
        .execute(&pool)
        .await?;
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&pool)
        .await?;

    tracing::debug!("database pool initialized: {}", db_path.display());
    Ok(pool)
}

/// connect to the blob_data database (separate file for raw binary storage)
/// returns a clone of the singleton pool (cheap - just Arc clone)
pub(crate) async fn connect_blob_data() -> GrimoireResult<SqlitePool> {
    let pool = BLOB_POOL
        .get_or_try_init(|| async { create_blob_pool().await })
        .await?;
    Ok(pool.clone())
}

/// internal: create and configure the blob_data database pool
async fn create_blob_pool() -> GrimoireResult<SqlitePool> {
    let config = get_config();
    let db_path = config.blob_data_path();

    // create file if it doesn't exist (using mode=rwc)
    let connection_string = format!("sqlite:{}?mode=rwc", db_path.display());
    let pool = SqlitePoolOptions::new()
        .max_connections(config.database.max_connections)
        .acquire_timeout(std::time::Duration::from_secs(
            config.database.acquire_timeout_seconds,
        ))
        .idle_timeout(std::time::Duration::from_secs(
            config.database.idle_timeout_seconds,
        ))
        .connect(&connection_string)
        .await?;

    // configure SQLite settings (runs ONCE)
    sqlx::query("PRAGMA journal_mode = WAL")
        .execute(&pool)
        .await?;
    sqlx::query("PRAGMA synchronous = NORMAL")
        .execute(&pool)
        .await?;

    tracing::debug!("blob_data pool initialized: {}", db_path.display());
    Ok(pool)
}
