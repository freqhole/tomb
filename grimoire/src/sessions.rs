//! session store initialization
//!
//! provides session store for tower-sessions using sqlite backend
//! keeps database/sqlx concerns in grimoire, not in server

use tower_sessions_sqlx_store::SqliteStore;

use crate::{database, error::GrimoireError};

/// initialize sqlite session store
///
/// creates and migrates the tower-sessions sqlite store
/// returns concrete SqliteStore for use with SessionManagerLayer
pub async fn init_session_store() -> Result<SqliteStore, GrimoireError> {
    let pool = database::connect().await?;

    let store = SqliteStore::new(pool);
    store.migrate().await.map_err(|e| GrimoireError::from(e))?;

    Ok(store)
}
