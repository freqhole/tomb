//! Storage abstractions for the server
//!
//! This module provides storage backends for sessions and other server-specific data.
//! Analytics functionality has been moved to the grimoire crate.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tower_sessions::MemoryStore;
use tower_sessions_sqlx_store::PostgresStore;

/// Storage backend configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StorageBackend {
    Memory,
    Postgres,
}

impl Default for StorageBackend {
    fn default() -> Self {
        Self::Memory
    }
}

/// Configuration for storage backends
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageConfig {
    /// Session storage backend
    #[serde(default)]
    pub sessions: StorageBackend,
    /// Cache storage backend (reserved for future use)
    #[serde(default)]
    pub cache: StorageBackend,
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            sessions: StorageBackend::Memory,
            cache: StorageBackend::Memory,
        }
    }
}

/// Session store wrapper that provides a unified interface
/// for different session storage backends
#[derive(Debug, Clone)]
pub enum SessionStore {
    Memory(MemoryStore),
    Postgres(PostgresStore),
}

impl SessionStore {
    /// Create a new memory-based session store
    pub fn new_memory() -> Self {
        Self::Memory(MemoryStore::default())
    }

    /// Create a new PostgreSQL-based session store
    pub async fn new_postgres(pool: PgPool) -> Result<Self, sqlx::Error> {
        let store = PostgresStore::new(pool);
        store.migrate().await?;
        Ok(Self::Postgres(store))
    }

    /// Get the underlying store for use with tower-sessions
    pub fn into_memory_store(self) -> Option<MemoryStore> {
        match self {
            Self::Memory(store) => Some(store),
            _ => None,
        }
    }

    /// Get the underlying store for use with tower-sessions
    pub fn into_postgres_store(self) -> Option<PostgresStore> {
        match self {
            Self::Postgres(store) => Some(store),
            _ => None,
        }
    }

    /// Get a reference to the memory store if this is a memory backend
    pub fn as_memory_store(&self) -> Option<&MemoryStore> {
        match self {
            Self::Memory(store) => Some(store),
            _ => None,
        }
    }

    /// Get a reference to the postgres store if this is a postgres backend
    pub fn as_postgres_store(&self) -> Option<&PostgresStore> {
        match self {
            Self::Postgres(store) => Some(store),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_storage_backend_default() {
        let backend = StorageBackend::default();
        assert!(matches!(backend, StorageBackend::Memory));
    }

    #[test]
    fn test_storage_config_default() {
        let config = StorageConfig::default();
        assert!(matches!(config.sessions, StorageBackend::Memory));
        assert!(matches!(config.cache, StorageBackend::Memory));
    }

    #[test]
    fn test_memory_session_store() {
        let store = SessionStore::new_memory();
        assert!(matches!(store, SessionStore::Memory(_)));
        assert!(store.as_memory_store().is_some());
        assert!(store.as_postgres_store().is_none());
    }
}
