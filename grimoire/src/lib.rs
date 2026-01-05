//! grimoire package
//!
//! sqlite-focused music library with minimal dependencies.
//! provides centralized domain logic for music metadata and blob storage.

pub mod config;
mod database;
pub mod error;
pub mod jobs;
pub mod media_blob;
pub mod music;
pub mod thumbnails;

// re-export only domain types, no database internals
pub use config::AppConfig;
pub use error::{GrimoireError, GrimoireResult};
pub use media_blob::{CreateMediaBlobRequest, MediaBlob};
pub use music::{Album, Artist, Song};

/// initialize grimoire - ensures databases exist and migrations are run
pub async fn init(config: &AppConfig) -> GrimoireResult<()> {
    tracing::info!("initializing grimoire");

    // ensure directories exist for database files
    config.ensure_directories()?;

    // just ensure databases exist and migrations run
    // actual connections happen per-operation
    let _ = database::connect_media_blobz().await?;
    let _ = database::connect_blob_data().await?;
    let _ = database::connect_music().await?;
    let _ = database::connect_app_state().await?;

    tracing::info!("grimoire initialized successfully");
    Ok(())
}
