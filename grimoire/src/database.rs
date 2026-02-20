//! internal database module - single SQLite database connection
//! consumers use grimoire apis that handle connections internally
//!
//! startup flow:
//! 1. server/cli main calls `initialize()` once
//! 2. initialize() runs migrations + creates views
//! 3. all other code calls `connect()` which just returns a pool

use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

use crate::config::get_config;
use crate::error::{GrimoireError, GrimoireResult};

// view SQL files embedded at compile time
mod views {
    pub const ARTIST_QUERY_VIEW: &str =
        include_str!("../../migrations/views/artist_query_view.sql");
    pub const ALBUM_QUERY_VIEW: &str = include_str!("../../migrations/views/album_query_view.sql");
    pub const GENRE_QUERY_VIEW: &str = include_str!("../../migrations/views/genre_query_view.sql");
    pub const SONG_QUERY_VIEW: &str = include_str!("../../migrations/views/song_query_view.sql");
    pub const PLAYLIST_QUERY_VIEW: &str =
        include_str!("../../migrations/views/playlist_query_view.sql");
    pub const PLAYLIST_SONG_QUERY_VIEW: &str =
        include_str!("../../migrations/views/playlist_song_query_view.sql");
    pub const FEED_QUERY_VIEW: &str = include_str!("../../migrations/views/feed_query_view.sql");
}

/// initialize database - call ONCE at application startup (server/cli main)
/// runs migrations and creates views if auto_run_migrations is enabled
pub async fn initialize() -> GrimoireResult<()> {
    let config = get_config();
    let pool = connect().await?;

    if config.database.auto_run_migrations {
        // run migrations
        sqlx::migrate!("../migrations").run(&pool).await?;

        // create views in dependency order (each .sql has DROP IF EXISTS + CREATE)
        sqlx::query(views::ARTIST_QUERY_VIEW).execute(&pool).await?;
        sqlx::query(views::ALBUM_QUERY_VIEW).execute(&pool).await?;
        sqlx::query(views::GENRE_QUERY_VIEW).execute(&pool).await?;
        sqlx::query(views::SONG_QUERY_VIEW).execute(&pool).await?;
        sqlx::query(views::PLAYLIST_QUERY_VIEW)
            .execute(&pool)
            .await?;
        sqlx::query(views::PLAYLIST_SONG_QUERY_VIEW)
            .execute(&pool)
            .await?;
        sqlx::query(views::FEED_QUERY_VIEW).execute(&pool).await?;
    }

    Ok(())
}

/// connect to the main grimoire database
/// does NOT run migrations or setup views - call initialize() once at startup
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

    Ok(pool)
}

// #TODO: so i guess it could be neat to have a standalone blob_data sqlite db file?
// #[deprecated(note = "Use connect() instead - all data is now in single database")]
// pub(crate) async fn connect_blob_data() -> GrimoireResult<SqlitePool> {
//     connect().await
// }
