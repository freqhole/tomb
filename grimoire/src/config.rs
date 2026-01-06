//! simplified config module for grimoire
//! focuses on single sqlite database path and minimal settings

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// main application configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub database: DatabaseConfig,
    pub media: MediaConfig,
}

/// database configuration using DATABASE_URL
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseConfig {
    /// database connection URL (e.g., "sqlite:data/grimoire.db")
    #[serde(default = "default_database_url")]
    pub database_url: String,
}

/// media processing configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaConfig {
    /// maximum file size for processing (bytes)
    #[serde(default = "default_max_file_size")]
    pub max_file_size: u64,

    /// supported audio file extensions
    #[serde(default = "default_audio_extensions")]
    pub audio_extensions: Vec<String>,

    /// directory for storing large files
    #[serde(default = "default_storage_directory")]
    pub storage_directory: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            database: DatabaseConfig::default(),
            media: MediaConfig::default(),
        }
    }
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        Self {
            database_url: default_database_url(),
        }
    }
}

impl Default for MediaConfig {
    fn default() -> Self {
        Self {
            max_file_size: default_max_file_size(),
            audio_extensions: default_audio_extensions(),
            storage_directory: default_storage_directory(),
        }
    }
}

// default value functions
fn default_database_url() -> String {
    // Check environment variable first, fall back to default
    std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite:data/grimoire.db".to_string())
}

fn default_max_file_size() -> u64 {
    1000 * 1024 * 1024 // 1000mb
}

fn default_audio_extensions() -> Vec<String> {
    vec![
        "mp3".to_string(),
        "flac".to_string(),
        "wav".to_string(),
        "m4a".to_string(),
        "ogg".to_string(),
        "aif".to_string(),
        "aiff".to_string(),
    ]
}

fn default_storage_directory() -> String {
    "data/storage".to_string()
}

impl AppConfig {
    /// load configuration from file
    pub fn from_file<P: AsRef<std::path::Path>>(
        path: P,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let content = std::fs::read_to_string(path)?;
        let config: AppConfig = serde_json::from_str(&content)?;
        Ok(config)
    }

    /// create default configuration
    pub fn default_config() -> Self {
        Self::default()
    }

    /// extract file path from DATABASE_URL
    pub fn database_file_path(&self) -> String {
        // Strip "sqlite:" prefix if present
        self.database
            .database_url
            .strip_prefix("sqlite:")
            .unwrap_or(&self.database.database_url)
            .to_string()
    }

    /// ensure data directories exist
    pub fn ensure_directories(&self) -> std::io::Result<()> {
        // Ensure parent directory of database file exists
        let db_path = self.database_file_path();
        if let Some(parent) = PathBuf::from(&db_path).parent() {
            std::fs::create_dir_all(parent)?;
        }

        // Ensure storage directory exists
        std::fs::create_dir_all(&self.media.storage_directory)?;
        Ok(())
    }
}
