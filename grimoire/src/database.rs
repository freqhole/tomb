//! internal database module - single SQLite database connection
//! consumers use grimoire apis that handle connections internally
//!
//! startup flow:
//! 1. server/cli main calls `initialize()` once to open the pool
//! 2. `run_migrations()` applies migrations + recreates views
//! 3. all other code calls `connect()` which returns the singleton pool
//!
//! IMPORTANT: pools are singletons - created once, reused for all requests.
//! `connect_blob_data()` opens `blob_data.db` on demand rather than eagerly
//! at startup - the file and its table are only ever created by whichever
//! caller reaches for them first (historical data still lives there;
//! `blob_data`'s crud functions and the reliquary migration tooling are the
//! only remaining callers).

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Executor, SqlitePool};
use tokio::sync::OnceCell;

use crate::config::get_config;
use crate::error::{GrimoireError, GrimoireResult};

// singleton pools - initialized once, reused for all requests
static MAIN_POOL: OnceCell<SqlitePool> = OnceCell::const_new();
static BLOB_POOL: OnceCell<SqlitePool> = OnceCell::const_new();
static HARUSPEX_POOL: OnceCell<SqlitePool> = OnceCell::const_new();
static RELIQUARY_POOL: OnceCell<SqlitePool> = OnceCell::const_new();
static STORAGE_NODE: OnceCell<reliquary::StorageNode> = OnceCell::const_new();
static CHUNKED_IMPORT: OnceCell<reliquary::ChunkedImport> = OnceCell::const_new();
static TRANSFER_REGISTRY: OnceCell<std::sync::Arc<reliquary::gate::TransferRegistry>> =
    OnceCell::const_new();

// view SQL files embedded at compile time, in dependency order
// availability dependencies must exist before query views are recreated.
mod views {
    pub struct View {
        pub sql: &'static str,
    }

    pub const ALL: &[View] = &[
        View {
            sql: include_str!("../../migrations/views/library_source_availability.sql"),
        },
        View {
            sql: include_str!("../../migrations/views/library_container_availability.sql"),
        },
        View {
            sql: include_str!("../../migrations/views/artist_query_view.sql"),
        },
        View {
            sql: include_str!("../../migrations/views/album_query_view.sql"),
        },
        View {
            sql: include_str!("../../migrations/views/song_query_view.sql"),
        },
        View {
            sql: include_str!("../../migrations/views/playlist_query_view.sql"),
        },
        View {
            sql: include_str!("../../migrations/views/playlist_song_query_view.sql"),
        },
        View {
            sql: include_str!("../../migrations/views/video_query_view.sql"),
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

/// apply the main schema before initializing blob storage.
async fn run_migrations_internal(pool: &SqlitePool) -> GrimoireResult<()> {
    run_schema_migrations(pool).await?;

    // create freqhole-blobz directory for iroh-blobs FsStore
    let config = get_config();
    let blobz_path = config.freqhole_blobz_path();
    if !blobz_path.exists() {
        std::fs::create_dir_all(&blobz_path).map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to create freqhole-blobz directory: {}", e),
        })?;
        tracing::info!("created freqhole-blobz directory: {}", blobz_path.display());
    }

    // eagerly migrate blob storage alongside the main database.
    let step_start = std::time::Instant::now();
    let _reliquary_pool = connect_reliquary().await?;
    tracing::info!(elapsed_ms = %step_start.elapsed().as_millis(), "boot: reliquary db connected + migrated");

    Ok(())
}

pub(crate) async fn run_schema_migrations(pool: &SqlitePool) -> GrimoireResult<()> {
    // temporary boot-timing instrumentation (see slow-tauri-boot investigation) —
    // logs elapsed ms per step so a slow boot can be narrowed down without guessing.
    let step_start = std::time::Instant::now();
    let mut transaction = pool.begin_with("BEGIN IMMEDIATE").await?;

    // drop all views BEFORE running migrations.
    //
    // why: migrations that rebuild a table (e.g. CREATE _new + DROP old +
    // RENAME) cannot run while a view references the old table on stricter
    // sqlite builds (notably the older sqlite shipped with android). dropping
    // the views up front removes the dependency; they are recreated below
    // from the embedded view scripts after migrations finish.
    //
    // keep drops, migrations and recreation in one transaction: validation
    // failures must preserve existing views, and readers must not see the gap.
    //
    // we query sqlite_schema instead of only dropping views::ALL so legacy
    // views (for example old taxonomy views like `genre_query_view`) cannot
    // block table rebuild migrations.
    let existing_views = sqlx::query_scalar!(
        r#"SELECT name AS "name!" FROM sqlite_schema
           WHERE type = 'view' AND name NOT LIKE 'sqlite_%'"#,
    )
    .fetch_all(&mut *transaction)
    .await?;

    for view_name in existing_views {
        let escaped = view_name.replace('"', "\"\"");
        transaction
            .execute(format!("DROP VIEW IF EXISTS \"{}\";", escaped).as_str())
            .await?;
    }
    tracing::info!(elapsed_ms = %step_start.elapsed().as_millis(), "boot: dropped existing views");

    // run migrations
    let step_start = std::time::Instant::now();
    sqlx::migrate!("../migrations")
        .run_direct(&mut *transaction)
        .await?;
    tracing::info!(elapsed_ms = %step_start.elapsed().as_millis(), "boot: sqlx migrate! done");

    // recreate views in dependency order. each .sql has DROP IF EXISTS +
    // CREATE, so we use Executor::execute on the raw &str which runs all
    // statements in the script (sqlx::query() only runs the first).
    let step_start = std::time::Instant::now();
    for view in views::ALL {
        transaction.execute(view.sql).await?;
    }
    transaction.commit().await?;
    tracing::info!(elapsed_ms = %step_start.elapsed().as_millis(), "boot: recreated views");

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

    // built via SqliteConnectOptions (not a hand-formatted "sqlite:{path}"
    // string) so windows paths (drive letters, backslashes) parse correctly.
    let connect_options = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(config.database.max_connections)
        .acquire_timeout(std::time::Duration::from_secs(
            config.database.acquire_timeout_seconds,
        ))
        .idle_timeout(std::time::Duration::from_secs(
            config.database.idle_timeout_seconds,
        ))
        .connect_with(connect_options)
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

    // create file if it doesn't exist - same SqliteConnectOptions approach
    // as create_main_pool (a hand-formatted "sqlite:{path}" string breaks on
    // windows paths).
    let connect_options = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(config.database.max_connections)
        .acquire_timeout(std::time::Duration::from_secs(
            config.database.acquire_timeout_seconds,
        ))
        .idle_timeout(std::time::Duration::from_secs(
            config.database.idle_timeout_seconds,
        ))
        .connect_with(connect_options)
        .await?;

    // configure SQLite settings (runs ONCE)
    sqlx::query("PRAGMA journal_mode = WAL")
        .execute(&pool)
        .await?;
    sqlx::query("PRAGMA synchronous = NORMAL")
        .execute(&pool)
        .await?;

    // ensure the table exists: this pool is now opened lazily, on demand,
    // by whichever caller reaches for blob_data first (historical reads,
    // or the reliquary migration tooling) rather than eagerly at every
    // boot, so table creation has to happen here instead of at migration
    // time.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS blob_data (
            id TEXT PRIMARY KEY,
            data BLOB NOT NULL
        )",
    )
    .execute(&pool)
    .await?;

    tracing::debug!("blob_data pool initialized: {}", db_path.display());
    Ok(pool)
}

/// connect to haruspex's own sqlite database (`haruspex.db`, a sibling of
/// grimoire's own database file under `data_dir`). haruspex owns this
/// database's schema and migrations entirely - `haruspex::sqlite::open` runs
/// them on first connect, so this pool is ready to use as soon as it's
/// returned. returns a clone of the singleton pool (cheap - just Arc clone).
pub(crate) async fn connect_haruspex() -> GrimoireResult<SqlitePool> {
    let pool = HARUSPEX_POOL
        .get_or_try_init(|| async { create_haruspex_pool().await })
        .await?;
    Ok(pool.clone())
}

/// internal: open (and migrate) haruspex's database under grimoire's data dir
async fn create_haruspex_pool() -> GrimoireResult<SqlitePool> {
    let config = get_config();
    haruspex::sqlite::open(&config.data_dir)
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to open haruspex database: {e}"),
        })
}

/// connect to reliquary's own sqlite database (`reliquary.db` by default, a
/// sibling of grimoire's own database file under `data_dir`). reliquary owns
/// this database's schema and migrations entirely - `reliquary::db::open_at`
/// runs them on first connect, so this pool is ready to use as soon as it's
/// returned. returns a clone of the singleton pool (cheap - just Arc clone).
pub(crate) async fn connect_reliquary() -> GrimoireResult<SqlitePool> {
    let pool = RELIQUARY_POOL
        .get_or_try_init(|| async { create_reliquary_pool().await })
        .await?;
    Ok(pool.clone())
}

/// internal: open (and migrate) reliquary's database at its configured path
async fn create_reliquary_pool() -> GrimoireResult<SqlitePool> {
    let step_start = std::time::Instant::now();
    let config = get_config();
    let result = reliquary::db::open_at(&config.reliquary_db_path())
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to open reliquary database: {e}"),
        });
    tracing::info!(elapsed_ms = %step_start.elapsed().as_millis(), "boot: reliquary::db::open_at done");
    result
}

/// the shared iroh-blobs storage node (fs_store + gc-protection), backed by
/// reliquary's blobz metadata store. lazily initialized on first use, like
/// every other pool in this file.
pub(crate) async fn storage_node() -> GrimoireResult<&'static reliquary::StorageNode> {
    STORAGE_NODE
        .get_or_try_init(|| async {
            let step_start = std::time::Instant::now();
            let reliquary_pool = connect_reliquary().await?;
            let config = get_config();
            let blobz: std::sync::Arc<dyn reliquary::blobz::BlobStore> = std::sync::Arc::new(
                reliquary::blobz::SqliteBlobStore::new(reliquary_pool, &config.data_dir),
            );
            let result = reliquary::StorageNode::init_local(
                &config.data_dir,
                blobz,
                reliquary::StorageNodeOptions::default(),
            )
            .await
            .map_err(|e| GrimoireError::ProcessingFailed {
                message: format!("failed to initialize storage node: {}", e),
            });
            tracing::info!(elapsed_ms = %step_start.elapsed().as_millis(), "boot: StorageNode::init_local done (first call, lazily triggered)");
            result
        })
        .await
}

/// the shared chunked-upload session tracker: bytes accumulate into a temp
/// file across multiple calls (e.g. one http/ipc request per chunk), then
/// get adopted into the storage node's blobz store once the upload
/// completes. lazily initialized on first use, like every other singleton
/// in this file.
pub(crate) async fn chunked_import() -> &'static reliquary::ChunkedImport {
    CHUNKED_IMPORT
        .get_or_init(|| async {
            reliquary::ChunkedImport::new(get_config().temp_dir().join("uploads"))
        })
        .await
}

/// this node's live registry of OUTGOING blob transfers (this node serving
/// a blob to a peer over iroh-blobs) - fed by `federation::transport::
/// endpoint`'s `build_gated_blobs_events` wiring, read by the
/// `p2p_get_active_transfers` tauri command. mirrors midden's wasm-side
/// `get_active_transfers()`. lazily
/// initialized on first use, like every other singleton in this file.
pub(crate) async fn transfer_registry() -> std::sync::Arc<reliquary::gate::TransferRegistry> {
    TRANSFER_REGISTRY
        .get_or_init(|| async { reliquary::gate::TransferRegistry::new() })
        .await
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqliteJournalMode;

    #[tokio::test]
    async fn schema_migration_future_is_send() {
        fn assert_send(_: impl Send) {}
        let pool = SqlitePoolOptions::new()
            .connect_lazy("sqlite::memory:")
            .unwrap();
        assert_send(run_schema_migrations(&pool));
    }

    #[tokio::test]
    async fn startup_applies_pending_migrations_with_existing_data_and_views() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let mut previous = sqlx::migrate!("../migrations");
        previous.migrations = std::borrow::Cow::Owned(
            previous
                .iter()
                .filter(|migration| migration.version < 98)
                .cloned()
                .collect(),
        );
        previous.run(&pool).await.unwrap();
        sqlx::query!("INSERT INTO media_blobz (id) VALUES ('blob0001')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query!(
            "INSERT INTO songz (id, media_blob_id, title) VALUES ('song0001', 'blob0001', 'retained')"
        )
        .execute(&pool)
        .await
        .unwrap();
        pool.execute("CREATE VIEW legacy_song_view AS SELECT id FROM songz")
            .await
            .unwrap();
        run_schema_migrations(&pool).await.unwrap();
        assert_eq!(
            sqlx::query_scalar!(
                r#"SELECT song_title AS "title!" FROM song_query_view WHERE song_id = 'song0001'"#
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            "retained"
        );
        assert_eq!(
            sqlx::query_scalar!("SELECT COUNT(*) FROM library_sourcez")
                .fetch_one(&pool)
                .await
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn concurrent_readers_keep_views_during_startup() {
        let directory = tempfile::tempdir().unwrap();
        let pool = SqlitePoolOptions::new()
            .max_connections(2)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(directory.path().join("schema.db"))
                    .create_if_missing(true)
                    .journal_mode(SqliteJournalMode::Wal),
            )
            .await
            .unwrap();
        run_schema_migrations(&pool).await.unwrap();
        let names = sqlx::query_scalar!(
            r#"SELECT name AS "name!" FROM sqlite_schema WHERE type = 'view' ORDER BY name"#
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        tokio::join!(
            async {
                for _ in 0..5 {
                    run_schema_migrations(&pool).await.unwrap();
                }
            },
            async {
                for _ in 0..100 {
                    for name in &names {
                        let escaped = name.replace('"', "\"\"");
                        pool.execute(format!("SELECT * FROM \"{escaped}\" LIMIT 0").as_str())
                            .await
                            .unwrap();
                    }
                }
            }
        );
        pool.close().await;
    }

    #[tokio::test]
    async fn failed_migration_validation_preserves_existing_views() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_schema_migrations(&pool).await.unwrap();
        let original = sqlx::query!(
            r#"SELECT name AS "name!", sql AS "sql!" FROM sqlite_schema
               WHERE type = 'view' ORDER BY name"#
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        sqlx::query!("UPDATE _sqlx_migrations SET checksum = X'00' WHERE version = 98")
            .execute(&pool)
            .await
            .unwrap();
        assert!(run_schema_migrations(&pool).await.is_err());
        for view in original {
            let restored = sqlx::query_scalar!(
                r#"SELECT sql AS "sql!" FROM sqlite_schema WHERE type = 'view' AND name = ?"#,
                view.name
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(restored, view.sql);
            let name = view.name.replace('"', "\"\"");
            pool.execute(format!("SELECT * FROM \"{name}\" LIMIT 0").as_str())
                .await
                .unwrap();
        }
    }

    #[tokio::test]
    async fn startup_restores_all_views_idempotently() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        // views live in migrations/views/, never in numbered migrations
        sqlx::migrate!("../migrations").run(&pool).await.unwrap();
        let from_migrations = sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "count!: i64" FROM sqlite_schema WHERE type = 'view'"#
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(from_migrations, 0);

        run_schema_migrations(&pool).await.unwrap();
        let original = sqlx::query!(
            r#"SELECT name AS "name!", sql AS "sql!" FROM sqlite_schema
               WHERE type = 'view' ORDER BY name"#
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        for _ in 0..3 {
            run_schema_migrations(&pool).await.unwrap();
            for view in &original {
                let restored = sqlx::query_scalar!(
                    r#"SELECT sql AS "sql!" FROM sqlite_schema WHERE type = 'view' AND name = ?"#,
                    view.name
                )
                .fetch_one(&pool)
                .await
                .unwrap();
                assert_eq!(restored, view.sql, "{}", view.name);
            }
            let names = sqlx::query_scalar!(
                r#"SELECT name AS "name!" FROM sqlite_schema WHERE type = 'view' ORDER BY name"#
            )
            .fetch_all(&pool)
            .await
            .unwrap();
            assert_eq!(names.len(), 14);
            for name in names {
                let escaped = name.replace('"', "\"\"");
                pool.execute(format!("SELECT * FROM \"{escaped}\" LIMIT 0").as_str())
                    .await
                    .unwrap();
            }
        }
    }
}
