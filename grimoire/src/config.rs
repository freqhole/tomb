//! simplified config module for grimoire
//! focuses on sqlite database paths and minimal settings

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// main application configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub database: DatabaseConfig,
    pub media: MediaConfig,
}

/// database configuration with sqlite file paths
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseConfig {
    /// path to media_blobz.db
    #[serde(default = "default_media_blobz_path")]
    pub media_blobz_path: String,

    /// path to blob_data.db
    #[serde(default = "default_blob_data_path")]
    pub blob_data_path: String,

    /// path to music.db
    #[serde(default = "default_music_path")]
    pub music_path: String,

    /// path to app_state.db
    #[serde(default = "default_app_state_path")]
    pub app_state_path: String,
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
            media_blobz_path: default_media_blobz_path(),
            blob_data_path: default_blob_data_path(),
            music_path: default_music_path(),
            app_state_path: default_app_state_path(),
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
fn default_media_blobz_path() -> String {
    "data/media_blobz.db".to_string()
}

fn default_blob_data_path() -> String {
    "data/blob_data.db".to_string()
}

fn default_music_path() -> String {
    "data/music.db".to_string()
}

fn default_app_state_path() -> String {
    "data/app_state.db".to_string()
}

fn default_max_file_size() -> u64 {
    100 * 1024 * 1024 // 100mb
}

fn default_audio_extensions() -> Vec<String> {
    vec![
        "mp3".to_string(),
        "flac".to_string(),
        "wav".to_string(),
        "m4a".to_string(),
        "ogg".to_string(),
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

    /// ensure data directories exist
    pub fn ensure_directories(&self) -> std::io::Result<()> {
        for path in [
            &self.database.media_blobz_path,
            &self.database.blob_data_path,
            &self.database.music_path,
            &self.database.app_state_path,
        ] {
            if let Some(parent) = PathBuf::from(path).parent() {
                std::fs::create_dir_all(parent)?;
            }
        }

        std::fs::create_dir_all(&self.media.storage_directory)?;
        Ok(())
    }
}
