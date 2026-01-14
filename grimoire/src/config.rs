//! Configuration module for grimoire
//!
//! Provides configuration loading, validation, and global storage.
//! Config files use JSONC format (JSON with comments).

use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;

// Global config - initialized once at startup
static CONFIG: OnceCell<GrimoireConfig> = OnceCell::new();

/// Main grimoire configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrimoireConfig {
    /// Application metadata
    pub app: AppInfo,
    /// Data directory - base directory for all data
    pub data_dir: PathBuf,
    /// Database configuration
    pub database: DatabaseConfig,
    /// Media processing and categorization
    pub media: MediaConfig,
    /// MusicBrainz integration
    pub musicbrainz: MusicBrainzConfig,
    /// Logging configuration
    pub logging: LoggingConfig,
    /// Server configuration (optional - only needed for server mode)
    #[serde(default)]
    pub server: Option<ServerConfig>,
}

/// Application metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInfo {
    /// Application name
    pub name: String,
    /// Application version
    pub version: String,
    /// Optional description
    pub description: Option<String>,
    /// Unique identifier for this instance
    pub id: String,
}

/// Database configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseConfig {
    /// SQLite database filename (stored in data_dir)
    pub filename: String,
    /// Automatically run migrations on startup
    pub auto_run_migrations: bool,
}

/// Media processing configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaConfig {
    /// Maximum file size for filesystem storage (bytes)
    pub max_fs_file_size: u64,
    /// Supported audio file formats
    pub supported_audio_formats: Vec<String>,
    /// Download configuration
    pub downloads: DownloadsConfig,
    /// Predefined genres for categorization
    pub genres: Vec<GenreMapping>,
}

/// Download configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadsConfig {
    /// Enable downloading from URLs
    pub enabled: bool,
    /// Command to use for downloads
    pub ytdlp_command: String,
}

/// Genre mapping for categorization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenreMapping {
    /// Display name
    pub display: String,
    /// URL-safe slug
    pub slug: String,
    /// List of genre variations that map to this category
    pub genres: Vec<String>,
}

/// MusicBrainz integration configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicBrainzConfig {
    /// Enable MusicBrainz API integration
    pub enabled: bool,
}

/// Logging configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingConfig {
    /// Log level: trace, debug, info, warn, error
    pub level: String,
}

/// Server configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    /// Server host to bind to
    pub host: String,
    /// Server port to bind to
    pub port: u16,
    /// Authentication configuration
    pub auth: AuthConfig,
    /// Static file serving configuration
    pub static_files: StaticFilesConfig,
    /// CORS configuration
    pub cors: CorsConfig,
    /// Fetch music configuration
    #[serde(default)]
    pub fetch_music: Option<FetchMusicConfig>,
}

/// Authentication configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthConfig {
    /// Enable WebAuthn passkey authentication (requires binary built with webauthn feature)
    pub webauthn_enabled: bool,
    /// WebAuthn origin configurations (each origin needs its own rp_id and rp_origin)
    #[serde(default)]
    pub webauthn_origins: Vec<WebAuthnOriginConfig>,
}

/// WebAuthn origin configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebAuthnOriginConfig {
    /// Relying party ID (domain name, e.g., "example.com", "localhost")
    pub rp_id: String,
    /// Relying party origin (full URL, e.g., "https://app.example.com", "http://localhost:3000")
    pub rp_origin: String,
}

impl WebAuthnOriginConfig {
    /// Get just the origin string for validation
    pub fn origin(&self) -> &str {
        &self.rp_origin
    }
}

/// Static file serving configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StaticFilesConfig {
    /// Enable static file serving
    pub enabled: bool,
    /// Directory to serve static files from (relative to data_dir or absolute)
    pub directory: Option<PathBuf>,
}

/// CORS configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorsConfig {
    /// Enable CORS
    pub enabled: bool,
    /// Allowed origins (if not specified, uses auth.webauthn_origins as allowed origins)
    pub allowed_origins: Option<Vec<String>>,
}

/// Fetch music configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchMusicConfig {
    /// Enable media fetching functionality
    pub enabled: bool,
    /// Absolute path where fetched files are temporarily stored
    pub output_dir: Option<String>,
    /// Command to extract metadata without downloading (for precheck/deduplication)
    pub precheck_command: Option<String>,
    /// Command to actually fetch media files
    pub fetch_command: Option<String>,
}

impl ServerConfig {
    /// Get all allowed origins (from webauthn configs or cors config)
    pub fn get_allowed_origins(&self) -> Vec<String> {
        if let Some(cors_origins) = &self.cors.allowed_origins {
            cors_origins.clone()
        } else {
            self.auth
                .webauthn_origins
                .iter()
                .map(|c| c.rp_origin.clone())
                .collect()
        }
    }

    /// Find webauthn config for a given origin
    pub fn find_webauthn_config(&self, origin: &str) -> Option<&WebAuthnOriginConfig> {
        self.auth
            .webauthn_origins
            .iter()
            .find(|c| c.rp_origin == origin)
    }
}

impl GrimoireConfig {
    /// Load config from file
    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self, ConfigError> {
        let path_ref = path.as_ref();
        let content = std::fs::read_to_string(path_ref).map_err(|e| ConfigError::FileNotFound {
            path: path_ref.display().to_string(),
            error: e.to_string(),
        })?;

        let config: GrimoireConfig =
            json5::from_str(&content).map_err(|e| ConfigError::ParseError(e.to_string()))?;

        config.validate()?;
        Ok(config)
    }

    /// Validate configuration
    fn validate(&self) -> Result<(), ConfigError> {
        // Validate logging level
        let valid_levels = ["trace", "debug", "info", "warn", "error"];
        if !valid_levels.contains(&self.logging.level.as_str()) {
            return Err(ConfigError::InvalidValue(format!(
                "Invalid log level: '{}'. Must be one of: {}",
                self.logging.level,
                valid_levels.join(", ")
            )));
        }

        // Validate database filename is not empty
        if self.database.filename.is_empty() {
            return Err(ConfigError::InvalidValue(
                "database.filename cannot be empty".to_string(),
            ));
        }

        Ok(())
    }

    /// Get path to SQLite database file
    pub fn database_path(&self) -> PathBuf {
        self.data_dir.join(&self.database.filename)
    }

    /// Get path to temp directory
    pub fn temp_dir(&self) -> PathBuf {
        self.data_dir.join("tmp")
    }

    /// Get path to wordlist file
    pub fn wordlist_path(&self) -> PathBuf {
        self.data_dir.join("wordlist.txt")
    }
}

/// Initialize global config from file path (call once at app startup)
pub fn init_config(path: Option<PathBuf>) -> Result<(), ConfigError> {
    let config_path = find_config(path)?;
    let config = GrimoireConfig::load(config_path)?;
    CONFIG
        .set(config)
        .map_err(|_| ConfigError::AlreadyInitialized)?;
    Ok(())
}

/// Get global config reference (available after init_config)
pub(crate) fn get_config() -> &'static GrimoireConfig {
    CONFIG
        .get()
        .expect("Config not initialized - call init_config first")
}

/// Find config file using search strategy
///
/// Search order:
/// 1. Explicit path if provided (e.g. from --config flag)
/// 2. GRIMOIRE_CONFIG env var
/// 3. ./config.jsonc (current directory)
/// 4. Walk up directory tree looking for assets/config/config.jsonc (dev mode)
pub fn find_config(explicit_path: Option<PathBuf>) -> Result<PathBuf, ConfigError> {
    // 1. Explicit path (e.g. from --config flag)
    if let Some(path) = explicit_path {
        if path.exists() {
            return Ok(path);
        }
        return Err(ConfigError::FileNotFound {
            path: path.display().to_string(),
            error: "Specified config file does not exist".to_string(),
        });
    }

    // 2. GRIMOIRE_CONFIG env var
    if let Ok(path_str) = std::env::var("GRIMOIRE_CONFIG") {
        let path = PathBuf::from(path_str);
        if path.exists() {
            return Ok(path);
        }
    }

    // 3. ./config.jsonc in current directory
    let local = PathBuf::from("config.jsonc");
    if local.exists() {
        return Ok(local);
    }

    // 4. Search up directory tree for assets/config/config.jsonc (dev mode)
    if let Ok(mut current) = std::env::current_dir() {
        loop {
            let candidate = current.join("assets/config/config.jsonc");
            if candidate.exists() {
                return Ok(candidate);
            }
            if !current.pop() {
                break;
            }
        }
    }

    Err(ConfigError::NotFound)
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("Config file not found: {path}\nError: {error}")]
    FileNotFound { path: String, error: String },

    #[error("Failed to parse config: {0}")]
    ParseError(String),

    #[error("Invalid config value: {0}")]
    InvalidValue(String),

    #[error("Config already initialized")]
    AlreadyInitialized,

    #[error(
        "No config file found. Searched:\n  \
         - ./config.jsonc\n  \
         - GRIMOIRE_CONFIG env var\n  \
         - assets/config/config.jsonc (walking up tree)\n\n\
         Run: grimoire config init"
    )]
    NotFound,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_helper_methods() {
        let config = GrimoireConfig {
            app: AppInfo {
                name: "test".to_string(),
                version: "1.0.0".to_string(),
                description: None,
                id: "test-id".to_string(),
            },
            data_dir: PathBuf::from("/data"),
            database: DatabaseConfig {
                filename: "test.db".to_string(),
                auto_run_migrations: true,
            },
            media: MediaConfig {
                max_fs_file_size: 1000,
                supported_audio_formats: vec!["mp3".to_string()],
                downloads: DownloadsConfig {
                    enabled: false,
                    ytdlp_command: "yt-dlp".to_string(),
                },
                genres: vec![],
            },
            musicbrainz: MusicBrainzConfig { enabled: false },
            logging: LoggingConfig {
                level: "info".to_string(),
            },
            server: None,
        };

        assert_eq!(config.database_path(), PathBuf::from("/data/test.db"));
        assert_eq!(config.temp_dir(), PathBuf::from("/data/tmp"));
        assert_eq!(config.wordlist_path(), PathBuf::from("/data/wordlist.txt"));
    }

    #[test]
    fn test_config_validation_invalid_log_level() {
        let config = GrimoireConfig {
            app: AppInfo {
                name: "test".to_string(),
                version: "1.0.0".to_string(),
                description: None,
                id: "test-id".to_string(),
            },
            data_dir: PathBuf::from("/data"),
            database: DatabaseConfig {
                filename: "test.db".to_string(),
                auto_run_migrations: true,
            },
            media: MediaConfig {
                max_fs_file_size: 1000,
                supported_audio_formats: vec![],
                downloads: DownloadsConfig {
                    enabled: false,
                    ytdlp_command: "yt-dlp".to_string(),
                },
                genres: vec![],
            },
            musicbrainz: MusicBrainzConfig { enabled: false },
            logging: LoggingConfig {
                level: "invalid".to_string(),
            },
            server: None,
        };

        assert!(config.validate().is_err());
    }

    #[test]
    fn test_config_validation_empty_filename() {
        let config = GrimoireConfig {
            app: AppInfo {
                name: "test".to_string(),
                version: "1.0.0".to_string(),
                description: None,
                id: "test-id".to_string(),
            },
            data_dir: PathBuf::from("/data"),
            database: DatabaseConfig {
                filename: "".to_string(),
                auto_run_migrations: true,
            },
            media: MediaConfig {
                max_fs_file_size: 1000,
                supported_audio_formats: vec![],
                downloads: DownloadsConfig {
                    enabled: false,
                    ytdlp_command: "yt-dlp".to_string(),
                },
                genres: vec![],
            },
            musicbrainz: MusicBrainzConfig { enabled: false },
            logging: LoggingConfig {
                level: "info".to_string(),
            },
            server: None,
        };

        assert!(config.validate().is_err());
    }
}

/// Response for config validation (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigValidationResponse {
    pub valid: bool,
    pub config_path: String,
    pub app_name: String,
    pub app_version: String,
    pub data_dir: String,
    pub database_path: String,
}
