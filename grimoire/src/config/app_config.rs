use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

/// Storage backend configuration
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
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

#[derive(Error, Debug)]
pub enum ConfigError {
    #[error("Config file not found: {0}")]
    FileNotFound(String),
    #[error("Failed to read config file: {0}")]
    ReadError(#[from] std::io::Error),
    #[error("Failed to parse config: {0}")]
    ParseError(String),
    #[error("Config validation failed: {0}")]
    ValidationError(String),
    #[error("JSON Schema generation failed: {0}")]
    #[allow(dead_code)]
    SchemaError(String),
}

/// Main application configuration
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AppConfig {
    /// Application metadata and identification
    pub app: AppInfo,
    /// Database connection and pool settings
    pub database: DatabaseConfig,
    /// WebAuthn/FIDO2 authentication configuration
    pub webauthn: WebAuthnConfig,
    /// HTTP server configuration
    pub server: ServerConfig,
    /// Session management settings
    pub sessions: SessionConfig,
    /// Logging and tracing configuration
    pub logging: LoggingConfig,
    /// Analytics and metrics configuration
    pub analytics: AnalyticsConfig,
    /// Static file serving configuration
    pub static_files: StaticFilesConfig,
    /// Storage backend configuration
    pub storage: StorageConfig,
    /// Media and file upload configuration
    pub media: MediaConfig,
    /// Development-specific settings
    pub development: DevelopmentConfig,
    /// Feature flags
    pub features: FeatureFlags,
}

/// Application metadata
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AppInfo {
    /// Application name
    #[serde(default = "default_app_name")]
    pub name: String,
    /// Application version
    #[serde(default = "default_app_version")]
    pub version: String,
    /// Environment (development, staging, production)
    #[serde(default = "default_environment")]
    pub environment: String,
    /// Optional description
    pub description: Option<String>,
}

/// Database configuration
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DatabaseConfig {
    /// Database host
    #[serde(default = "default_db_host")]
    pub host: String,
    /// Database port
    #[serde(default = "default_db_port")]
    pub port: u16,
    /// Database name
    #[serde(default = "default_db_name")]
    pub name: String,
    /// Database user
    #[serde(default = "default_db_user")]
    pub user: String,
    /// Database password
    #[serde(default = "default_db_password")]
    pub password: String,
    /// Connection pool configuration
    pub pool: DatabasePoolConfig,
    /// Database migration settings
    pub migrations: MigrationConfig,
}

/// Database connection pool configuration
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DatabasePoolConfig {
    /// Maximum number of connections in the pool
    #[serde(default = "default_pool_max_connections")]
    pub max_connections: u32,
    /// Minimum number of connections in the pool
    #[serde(default = "default_pool_min_connections")]
    pub min_connections: u32,
    /// Connection timeout in seconds
    #[serde(default = "default_pool_connect_timeout")]
    pub connect_timeout_seconds: u64,
    /// Idle timeout in seconds
    #[serde(default = "default_pool_idle_timeout")]
    pub idle_timeout_seconds: u64,
}

/// Database migration configuration
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MigrationConfig {
    /// Automatically run migrations on startup
    #[serde(default = "default_auto_migrate")]
    pub auto_run: bool,
}

/// WebAuthn configuration
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct WebAuthnConfig {
    /// Relying Party ID (your domain)
    #[serde(default = "default_rp_id")]
    pub rp_id: String,
    /// Relying Party name (display name)
    #[serde(default = "default_rp_name")]
    pub rp_name: String,
    /// Relying Party origin URL
    #[serde(default = "default_rp_origin")]
    pub rp_origin: String,
}

/// HTTP server configuration
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ServerConfig {
    /// Server host to bind to
    #[serde(default = "default_server_host")]
    pub host: String,
    /// Server port to bind to
    #[serde(default = "default_server_port")]
    pub port: u16,
}

/// Media and file upload configuration
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MediaConfig {
    /// Maximum size for blob files stored in database (in bytes)
    #[serde(default = "default_max_blob_file_size")]
    pub max_blob_file_size: u64,
    /// Maximum size for files stored on filesystem (in bytes)
    #[serde(default = "default_max_fs_file_size")]
    pub max_fs_file_size: u64,
}

/// Session configuration
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SessionConfig {
    /// Session max age in seconds. Set to 0 or negative value for sessions that never expire.
    #[serde(default = "default_session_max_age")]
    pub max_age_seconds: i64,
    /// Secure cookie flag
    #[serde(default)]
    pub secure: bool,
    /// SameSite cookie attribute
    #[serde(default = "default_session_same_site")]
    pub same_site: String,
    /// HttpOnly cookie flag
    #[serde(default = "default_session_http_only")]
    pub http_only: bool,
}

/// Logging configuration
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct LoggingConfig {
    /// Log level (trace, debug, info, warn, error)
    #[serde(default = "default_log_level")]
    pub level: String,
    /// HTTP access logging configuration
    pub access_log: Option<AccessLogConfig>,
}

/// Access log configuration for HTTP requests
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AccessLogConfig {
    /// Enable HTTP access logging
    #[serde(default)]
    pub enabled: bool,
    /// Access log file path
    #[serde(default = "default_access_log_path")]
    pub file_path: String,
    /// Log format (common, combined, custom)
    #[serde(default = "default_access_log_format")]
    pub format: String,
    /// Custom format template (used when format = "custom")
    pub custom_template: Option<String>,
    /// Also log to application logger
    #[serde(default)]
    pub also_log_to_tracing: bool,
}

/// Analytics configuration
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct AnalyticsConfig {
    /// Metrics endpoints configuration
    pub metrics: MetricsConfig,
}

/// Metrics configuration
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MetricsConfig {
    /// Enable metrics endpoints
    #[serde(default)]
    pub enabled: bool,
    /// Prometheus metrics endpoint path
    #[serde(default = "default_prometheus_path")]
    pub prometheus_endpoint: String,
    /// Health check endpoint path
    #[serde(default = "default_health_path")]
    pub health_endpoint: String,
}

/// Static file serving configuration
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct StaticFilesConfig {
    /// Public directory path
    #[serde(default = "default_public_dir")]
    pub public_directory: String,
    /// Private directory path
    #[serde(default = "default_private_dir")]
    pub private_directory: String,
    /// Main assets directory (contains js, css, images, etc.)
    #[serde(default = "default_assets_dir")]
    pub assets_directory: String,
    /// Upload directory for large files (>10MB)
    #[serde(default = "default_upload_dir")]
    pub upload_directory: String,
}

/// Development configuration
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DevelopmentConfig {
    /// Auto-generate invite codes on startup
    #[serde(default)]
    pub auto_generate_invites: bool,
}

/// Storage backend configuration
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct StorageConfig {
    /// Analytics storage backend
    #[serde(default)]
    pub analytics: StorageBackend,
    /// Session storage backend
    #[serde(default)]
    pub sessions: StorageBackend,
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            analytics: StorageBackend::Memory,
            sessions: StorageBackend::Memory,
        }
    }
}

/// Feature flags
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct FeatureFlags {
    /// Enable user registration
    #[serde(default = "default_true")]
    pub registration_enabled: bool,
    /// Require invite codes for registration
    #[serde(default = "default_true")]
    pub invite_codes_required: bool,
    /// Enable analytics collection
    #[serde(default = "default_true")]
    pub analytics_enabled: bool,
}

// Default value functions
fn default_app_name() -> String {
    "WebAuthn Demo".to_string()
}
fn default_app_version() -> String {
    "1.0.0".to_string()
}
fn default_environment() -> String {
    "development".to_string()
}

fn default_db_host() -> String {
    "localhost".to_string()
}
fn default_db_port() -> u16 {
    5432
}
fn default_db_name() -> String {
    "webauthn_db".to_string()
}
fn default_db_user() -> String {
    "postgres".to_string()
}
fn default_db_password() -> String {
    "postgres".to_string()
}

fn default_pool_max_connections() -> u32 {
    10
}
fn default_pool_min_connections() -> u32 {
    1
}
fn default_pool_connect_timeout() -> u64 {
    30
}
fn default_pool_idle_timeout() -> u64 {
    600
}

fn default_auto_migrate() -> bool {
    true
}

fn default_rp_id() -> String {
    "localhost".to_string()
}
fn default_rp_name() -> String {
    "WebAuthn Demo".to_string()
}
fn default_rp_origin() -> String {
    "http://localhost:8080".to_string()
}

fn default_server_host() -> String {
    "0.0.0.0".to_string()
}
fn default_server_port() -> u16 {
    8080
}

fn default_session_max_age() -> i64 {
    3600
}

fn default_max_blob_file_size() -> u64 {
    10 * 1024 * 1024 // 10MB
}

fn default_max_fs_file_size() -> u64 {
    1024 * 1024 * 1024 // 1GB
}

fn default_session_same_site() -> String {
    "strict".to_string()
}
fn default_session_http_only() -> bool {
    true
}

fn default_log_level() -> String {
    "info".to_string()
}

fn default_access_log_path() -> String {
    "logs/access.log".to_string()
}

fn default_access_log_format() -> String {
    "combined".to_string()
}

fn default_prometheus_path() -> String {
    "/metrics".to_string()
}
fn default_health_path() -> String {
    "/health".to_string()
}

fn default_public_dir() -> String {
    "assets/public".to_string()
}
fn default_private_dir() -> String {
    "assets/private".to_string()
}
fn default_assets_dir() -> String {
    "assets".to_string()
}
fn default_upload_dir() -> String {
    "assets/private/uploads".to_string()
}

fn default_true() -> bool {
    true
}

impl AppConfig {
    /// Load configuration from a JSONC file
    pub fn from_file<P: AsRef<Path>>(path: P) -> Result<Self, ConfigError> {
        let path = path.as_ref();

        if !path.exists() {
            return Err(ConfigError::FileNotFound(path.display().to_string()));
        }

        let content = std::fs::read_to_string(path)?;
        let config: AppConfig = json5::from_str(&content)
            .map_err(|e| ConfigError::ParseError(format!("JSON5 parse error: {}", e)))?;

        Ok(config)
    }

    /// Load configuration with secrets from separate files
    pub fn from_files<P: AsRef<Path>>(
        config_path: P,
        _secrets_path: Option<P>,
    ) -> Result<(Self, Option<()>), ConfigError> {
        let config = Self::from_file(config_path)?;

        // Validate configuration
        config.validate()?;

        Ok((config, None))
    }

    /// Generate a default configuration file
    pub fn generate_default() -> Self {
        Self {
            app: AppInfo {
                name: default_app_name(),
                version: default_app_version(),
                environment: default_environment(),
                description: Some("WebAuthn authentication server with invite codes".to_string()),
            },
            database: DatabaseConfig {
                host: default_db_host(),
                port: default_db_port(),
                name: default_db_name(),
                user: default_db_user(),
                password: default_db_password(),
                pool: DatabasePoolConfig {
                    max_connections: default_pool_max_connections(),
                    min_connections: default_pool_min_connections(),
                    connect_timeout_seconds: default_pool_connect_timeout(),
                    idle_timeout_seconds: default_pool_idle_timeout(),
                },
                migrations: MigrationConfig {
                    auto_run: default_auto_migrate(),
                },
            },
            webauthn: WebAuthnConfig {
                rp_id: default_rp_id(),
                rp_name: default_rp_name(),
                rp_origin: default_rp_origin(),
            },
            server: ServerConfig {
                host: default_server_host(),
                port: default_server_port(),
            },
            sessions: SessionConfig {
                max_age_seconds: default_session_max_age(),
                secure: false,
                same_site: default_session_same_site(),
                http_only: default_session_http_only(),
            },
            logging: LoggingConfig {
                level: default_log_level(),
                access_log: Some(AccessLogConfig {
                    enabled: false,
                    file_path: default_access_log_path(),
                    format: default_access_log_format(),
                    custom_template: None,
                    also_log_to_tracing: false,
                }),
            },
            analytics: AnalyticsConfig {
                metrics: MetricsConfig {
                    enabled: false,
                    prometheus_endpoint: default_prometheus_path(),
                    health_endpoint: default_health_path(),
                },
            },
            static_files: StaticFilesConfig {
                public_directory: default_public_dir(),
                private_directory: default_private_dir(),
                assets_directory: default_assets_dir(),
                upload_directory: default_upload_dir(),
            },
            storage: StorageConfig::default(),
            media: MediaConfig {
                max_blob_file_size: default_max_blob_file_size(),
                max_fs_file_size: default_max_fs_file_size(),
            },
            development: DevelopmentConfig {
                auto_generate_invites: false,
            },
            features: FeatureFlags {
                registration_enabled: true,
                invite_codes_required: true,
                analytics_enabled: true,
            },
        }
    }

    /// Validate the configuration
    pub fn validate(&self) -> Result<(), ConfigError> {
        let mut errors = Vec::new();

        // Validate server configuration
        if self.server.port == 0 {
            errors.push("Server port cannot be 0".to_string());
        }

        // Validate WebAuthn configuration
        if self.webauthn.rp_id.is_empty() {
            errors.push("WebAuthn RP ID cannot be empty".to_string());
        }

        if !self.webauthn.rp_origin.starts_with("http://")
            && !self.webauthn.rp_origin.starts_with("https://")
        {
            errors.push("WebAuthn RP origin must be a valid HTTP/HTTPS URL".to_string());
        }

        // Validate database configuration
        if self.database.host.is_empty() {
            errors.push("Database host cannot be empty".to_string());
        }

        if self.database.name.is_empty() {
            errors.push("Database name cannot be empty".to_string());
        }

        if self.database.pool.max_connections == 0 {
            errors.push("Database max_connections cannot be 0".to_string());
        }

        if self.database.pool.min_connections > self.database.pool.max_connections {
            errors.push(
                "Database min_connections cannot be greater than max_connections".to_string(),
            );
        }

        // Validate logging level
        if !["trace", "debug", "info", "warn", "error"].contains(&self.logging.level.as_str()) {
            errors
                .push("Logging level must be one of: trace, debug, info, warn, error".to_string());
        }

        // Validate session same_site
        if !["strict", "lax", "none"].contains(&self.sessions.same_site.as_str()) {
            errors.push("Session same_site must be 'strict', 'lax', or 'none'".to_string());
        }

        // Validate storage backends
        if matches!(self.storage.sessions, StorageBackend::Postgres)
            && self.database.host.is_empty()
        {
            errors.push(
                "PostgreSQL session storage requires valid database configuration".to_string(),
            );
        }

        if matches!(self.storage.analytics, StorageBackend::Postgres)
            && self.database.host.is_empty()
        {
            errors.push(
                "PostgreSQL analytics storage requires valid database configuration".to_string(),
            );
        }

        if !errors.is_empty() {
            return Err(ConfigError::ValidationError(errors.join("; ")));
        }

        Ok(())
    }

    /// Get the complete database URL
    pub fn database_url(&self) -> String {
        format!(
            "postgresql://{}:{}@{}:{}/{}",
            self.database.user,
            self.database.password,
            self.database.host,
            self.database.port,
            self.database.name
        )
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            app: AppInfo {
                name: default_app_name(),
                version: default_app_version(),
                environment: default_environment(),
                description: None,
            },
            database: DatabaseConfig {
                host: default_db_host(),
                port: default_db_port(),
                name: default_db_name(),
                password: default_db_password(),
                user: default_db_user(),
                pool: DatabasePoolConfig {
                    max_connections: default_pool_max_connections(),
                    min_connections: default_pool_min_connections(),
                    connect_timeout_seconds: default_pool_connect_timeout(),
                    idle_timeout_seconds: default_pool_idle_timeout(),
                },
                migrations: MigrationConfig {
                    auto_run: default_auto_migrate(),
                },
            },
            webauthn: WebAuthnConfig {
                rp_id: default_rp_id(),
                rp_name: default_rp_name(),
                rp_origin: default_rp_origin(),
            },
            server: ServerConfig {
                host: default_server_host(),
                port: default_server_port(),
            },
            sessions: SessionConfig {
                max_age_seconds: default_session_max_age(),
                secure: false,
                same_site: default_session_same_site(),
                http_only: default_session_http_only(),
            },
            logging: LoggingConfig {
                level: default_log_level(),
                access_log: None,
            },
            analytics: AnalyticsConfig {
                metrics: MetricsConfig {
                    enabled: false,
                    prometheus_endpoint: default_prometheus_path(),
                    health_endpoint: default_health_path(),
                },
            },
            static_files: StaticFilesConfig {
                public_directory: default_public_dir(),
                private_directory: default_private_dir(),
                assets_directory: default_assets_dir(),
                upload_directory: default_upload_dir(),
            },
            storage: StorageConfig::default(),
            media: MediaConfig {
                max_blob_file_size: default_max_blob_file_size(),
                max_fs_file_size: default_max_fs_file_size(),
            },
            development: DevelopmentConfig {
                auto_generate_invites: false,
            },
            features: FeatureFlags {
                registration_enabled: default_true(),
                invite_codes_required: default_true(),
                analytics_enabled: default_true(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config_validation() {
        let config = AppConfig::default();
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_database_url_generation() {
        let config = AppConfig::default();
        let url = config.database_url();
        assert!(url.starts_with("postgresql://"));
        assert!(url.contains("localhost:5432"));
    }

    #[test]
    fn test_config_validation_errors() {
        let mut config = AppConfig::default();
        config.server.port = 0;
        config.webauthn.rp_id = "".to_string();

        let result = config.validate();
        assert!(result.is_err());

        if let Err(ConfigError::ValidationError(msg)) = result {
            assert!(msg.contains("port cannot be 0"));
            assert!(msg.contains("RP ID cannot be empty"));
        }
    }
}
