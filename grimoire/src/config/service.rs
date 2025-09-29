//! Configuration service for the client package
//!
//! This module provides high-level configuration services that handle validation,
//! generation, schema creation, and environment file management.

use crate::config::AppConfig;
use std::fmt;
use std::path::Path;
use thiserror::Error;

/// Errors that can occur in config services
#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("File not found: {path}")]
    FileNotFound { path: String },

    #[error("File already exists: {path}")]
    FileAlreadyExists { path: String },

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Configuration error: {0}")]
    Config(#[from] crate::config::AppConfigError),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Unknown configuration section: {section}")]
    UnknownSection { section: String },

    #[error("Validation failed: {0}")]
    ValidationFailed(String),
}

/// Result of configuration validation
#[derive(Debug, Clone)]
pub struct ConfigValidationResult {
    pub is_valid: bool,
    pub config_loaded: bool,
    pub secrets_loaded: bool,
    pub validation_errors: Vec<String>,
    pub summary: ConfigSummary,
}

impl fmt::Display for ConfigValidationResult {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.config_loaded {
            writeln!(f, "✓ Configuration loaded successfully")?;
        } else {
            writeln!(f, "❌ Failed to load configuration")?;
        }

        if self.secrets_loaded {
            writeln!(f, "✓ Secrets loaded successfully")?;
        } else {
            writeln!(f, "ℹ️  No secrets file loaded (using defaults)")?;
        }

        if self.is_valid {
            writeln!(f, "✓ Configuration validation passed")?;
            writeln!(f)?;
            writeln!(f, "📊 Configuration summary:")?;
            write!(f, "{}", self.summary)?;
        } else {
            writeln!(f, "❌ Configuration validation failed:")?;
            for error in &self.validation_errors {
                writeln!(f, "  {}", error)?;
            }
        }

        Ok(())
    }
}

/// Summary of configuration settings
#[derive(Debug, Clone)]
pub struct ConfigSummary {
    pub app_name: String,
    pub environment: String,
    pub server_host: String,
    pub server_port: u16,
    pub webauthn_rp_id: String,
    pub database_host: String,
    pub registration_enabled: bool,
    pub analytics_enabled: bool,
}

impl fmt::Display for ConfigSummary {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "  App name: {}", self.app_name)?;
        writeln!(f, "  Environment: {}", self.environment)?;
        writeln!(f, "  Server: {}:{}", self.server_host, self.server_port)?;
        writeln!(f, "  WebAuthn RP ID: {}", self.webauthn_rp_id)?;
        writeln!(f, "  Database: {}", self.database_host)?;
        writeln!(f, "  Features:")?;
        writeln!(f, "    Registration: {}", self.registration_enabled)?;
        write!(f, "    Analytics: {}", self.analytics_enabled)
    }
}

/// Configuration for file generation
#[derive(Debug, Clone)]
pub struct ConfigGenerationOptions {
    pub force_overwrite: bool,
    pub with_secrets: bool,
    pub with_examples: bool,
}

impl Default for ConfigGenerationOptions {
    fn default() -> Self {
        Self {
            force_overwrite: false,
            with_secrets: false,
            with_examples: false,
        }
    }
}

/// Configuration service for high-level config operations
pub struct ConfigService;

impl ConfigService {
    /// Create a new ConfigService
    pub fn new() -> Self {
        Self
    }

    /// Initialize configuration files
    pub fn init_config(
        &self,
        config_path: &str,
        options: ConfigGenerationOptions,
    ) -> Result<Vec<String>, ConfigError> {
        let mut created_files = Vec::new();

        // Ensure the directory exists
        if let Some(parent) = Path::new(config_path).parent() {
            std::fs::create_dir_all(parent)?;
        }

        // Check if config file already exists
        if Path::new(config_path).exists() && !options.force_overwrite {
            return Err(ConfigError::FileAlreadyExists {
                path: config_path.to_string(),
            });
        }

        // Generate default config
        let default_config = AppConfig::default();
        let config_content = serde_json::to_string_pretty(&default_config)?;

        // Write config file
        std::fs::write(config_path, config_content)?;
        created_files.push(config_path.to_string());

        // Generate secrets file if requested
        if options.with_secrets {
            let secrets_path = config_path.replace("config.jsonc", "config.secrets.jsonc");
            let secrets_result = self.init_secrets(&secrets_path, options.force_overwrite);
            match secrets_result {
                Ok(()) => created_files.push(secrets_path),
                Err(e) => {
                    // If secrets generation fails, still return success for config
                    eprintln!("Warning: Failed to generate secrets file: {}", e);
                }
            }
        }

        Ok(created_files)
    }

    /// Initialize secrets configuration file
    pub fn init_secrets(&self, secrets_path: &str, force: bool) -> Result<(), ConfigError> {
        // Ensure the directory exists
        if let Some(parent) = Path::new(secrets_path).parent() {
            std::fs::create_dir_all(parent)?;
        }

        // Check if secrets file already exists
        if Path::new(secrets_path).exists() && !force {
            return Err(ConfigError::FileAlreadyExists {
                path: secrets_path.to_string(),
            });
        }

        // Generate example secrets structure
        let secrets_content = r#"{
  // Database connection secrets
  "database": {
    "password": "your_database_password_here"
  },

  // Session encryption key (generate a secure random key)
  "session_key": "your_session_encryption_key_here",

  // Optional: External service API keys
  "external": {
    // "api_key": "your_api_key_here"
  }
}
"#;

        std::fs::write(secrets_path, secrets_content)?;
        Ok(())
    }

    /// Validate configuration files
    pub fn validate_config(
        &self,
        config_path: &str,
        secrets_path: Option<&str>,
    ) -> Result<ConfigValidationResult, ConfigError> {
        let mut validation_errors = Vec::new();

        // Check if files exist
        if !Path::new(config_path).exists() {
            return Err(ConfigError::FileNotFound {
                path: config_path.to_string(),
            });
        }

        let secrets_path_opt =
            secrets_path.and_then(|p| if Path::new(p).exists() { Some(p) } else { None });

        // Load configuration
        let (config, secrets) =
            AppConfig::from_files(config_path, secrets_path_opt).map_err(ConfigError::Config)?;

        let config_loaded = true;
        let secrets_loaded = secrets.is_some();

        // Validate the configuration
        let is_valid = match config.validate() {
            Ok(()) => true,
            Err(e) => {
                validation_errors.push(e.to_string());
                false
            }
        };

        let summary = ConfigSummary {
            app_name: config.app.name.clone(),
            environment: config.app.environment.clone(),
            server_host: config.server.host.clone(),
            server_port: config.server.port,
            webauthn_rp_id: config.webauthn.rp_id.clone(),
            database_host: config.database.host.clone(),
            registration_enabled: config.features.registration_enabled,
            analytics_enabled: config.features.analytics_enabled,
        };

        Ok(ConfigValidationResult {
            is_valid,
            config_loaded,
            secrets_loaded,
            validation_errors,
            summary,
        })
    }

    /// Generate JSON schema for configuration
    pub fn generate_schema(&self) -> Result<String, ConfigError> {
        let schema = serde_json::json!({
            "$schema": "http://json-schema.org/draft-07/schema#",
            "title": "AppConfig",
            "type": "object",
            "description": "WebAuthn Server Configuration",
            "properties": {
                "app": {
                    "type": "object",
                    "description": "Application settings"
                },
                "server": {
                    "type": "object",
                    "description": "Server configuration"
                },
                "database": {
                    "type": "object",
                    "description": "Database connection settings"
                },
                "webauthn": {
                    "type": "object",
                    "description": "WebAuthn configuration"
                },
                "features": {
                    "type": "object",
                    "description": "Feature flags"
                },
                "logging": {
                    "type": "object",
                    "description": "Logging configuration"
                },
                "sessions": {
                    "type": "object",
                    "description": "Session management"
                },
                "analytics": {
                    "type": "object",
                    "description": "Analytics configuration"
                },
                "storage": {
                    "type": "object",
                    "description": "Storage backends"
                },
                "static_files": {
                    "type": "object",
                    "description": "Static file serving"
                },
                "development": {
                    "type": "object",
                    "description": "Development options"
                }
            }
        });

        Ok(serde_json::to_string_pretty(&schema)?)
    }

    /// Generate environment file from configuration
    pub fn generate_env_file(
        &self,
        config_path: &str,
        secrets_path: Option<&str>,
        with_examples: bool,
    ) -> Result<String, ConfigError> {
        // Load configuration if it exists
        let config = if Path::new(config_path).exists() {
            let secrets_path_opt =
                secrets_path.and_then(|p| if Path::new(p).exists() { Some(p) } else { None });

            match AppConfig::from_files(config_path, secrets_path_opt) {
                Ok((config, _)) => config,
                Err(_) => AppConfig::default(),
            }
        } else {
            AppConfig::default()
        };

        // Generate environment variables
        let mut content = String::new();

        if with_examples {
            content.push_str("# CONFIG_PATH=assets/config/config.jsonc\n");
            content.push_str("# SECRETS_PATH=assets/config/config.secrets.jsonc\n\n");
        }

        // Basic environment variables
        content.push_str(&format!("DATABASE_URL={}\n", config.database_url()));
        content.push_str(&format!("SERVER_HOST={}\n", config.server.host));
        content.push_str(&format!("SERVER_PORT={}\n", config.server.port));
        content.push_str(&format!("WEBAUTHN_RP_ID={}\n", config.webauthn.rp_id));
        content.push_str(&format!("WEBAUTHN_RP_NAME={}\n", config.webauthn.rp_name));
        content.push_str(&format!(
            "WEBAUTHN_RP_ORIGINS={}\n",
            config.webauthn.rp_origins.join(",")
        ));

        Ok(content)
    }

    /// Display configuration in different formats
    pub fn format_config(
        &self,
        config_path: &str,
        secrets_path: Option<&str>,
        format: ConfigDisplayFormat,
        section: Option<&str>,
    ) -> Result<String, ConfigError> {
        let secrets_path_opt =
            secrets_path.and_then(|p| if Path::new(p).exists() { Some(p) } else { None });

        let (config, _) =
            AppConfig::from_files(config_path, secrets_path_opt).map_err(ConfigError::Config)?;

        match format {
            ConfigDisplayFormat::Json => {
                if let Some(section) = section {
                    let value = self.extract_config_section(&config, section)?;
                    Ok(serde_json::to_string_pretty(&value)?)
                } else {
                    Ok(serde_json::to_string_pretty(&config)?)
                }
            }
            ConfigDisplayFormat::Debug => {
                if let Some(section) = section {
                    Ok(self.format_config_section_debug(&config, section)?)
                } else {
                    Ok(format!("Configuration: {:#?}", config))
                }
            }
        }
    }

    /// Extract a specific section from configuration
    fn extract_config_section(
        &self,
        config: &AppConfig,
        section: &str,
    ) -> Result<serde_json::Value, ConfigError> {
        let value = match section {
            "app" => serde_json::to_value(&config.app)?,
            "server" => serde_json::to_value(&config.server)?,
            "database" => serde_json::to_value(&config.database)?,
            "webauthn" => serde_json::to_value(&config.webauthn)?,
            "features" => serde_json::to_value(&config.features)?,
            "logging" => serde_json::to_value(&config.logging)?,
            "sessions" => serde_json::to_value(&config.sessions)?,
            "analytics" => serde_json::to_value(&config.analytics)?,
            "storage" => serde_json::to_value(&config.storage)?,
            "static_files" => serde_json::to_value(&config.static_files)?,
            "development" => serde_json::to_value(&config.development)?,
            _ => {
                return Err(ConfigError::UnknownSection {
                    section: section.to_string(),
                });
            }
        };
        Ok(value)
    }

    /// Format a specific config section in debug format
    fn format_config_section_debug(
        &self,
        config: &AppConfig,
        section: &str,
    ) -> Result<String, ConfigError> {
        let formatted = match section {
            "app" => format!("App: {:#?}", config.app),
            "server" => format!("Server: {:#?}", config.server),
            "database" => format!("Database: {:#?}", config.database),
            "webauthn" => format!("WebAuthn: {:#?}", config.webauthn),
            "features" => format!("Features: {:#?}", config.features),
            "logging" => format!("Logging: {:#?}", config.logging),
            "sessions" => format!("Sessions: {:#?}", config.sessions),
            "analytics" => format!("Analytics: {:#?}", config.analytics),
            "storage" => format!("Storage: {:#?}", config.storage),
            "static_files" => format!("Static Files: {:#?}", config.static_files),
            "development" => format!("Development: {:#?}", config.development),
            _ => {
                return Err(ConfigError::UnknownSection {
                    section: section.to_string(),
                });
            }
        };
        Ok(formatted)
    }

    /// Convert AppConfig thumbnail configuration to grimoire ThumbnailConfig
    pub fn to_thumbnail_config(
        &self,
        app_config: &crate::AppConfig,
    ) -> crate::thumbnails::ThumbnailConfig {
        let config_thumbnails = &app_config.media.thumbnails;

        crate::thumbnails::ThumbnailConfig {
            enabled: config_thumbnails.enabled,
            imagemagick_path: config_thumbnails.imagemagick_path.clone(),
            ffmpeg_path: config_thumbnails.ffmpeg_path.clone(),
            max_concurrent_jobs: config_thumbnails.max_concurrent_jobs,
            storage_path: config_thumbnails.storage_path.clone(),
            upload_directory: app_config.static_files.upload_directory.clone(),
            default_dimensions: crate::thumbnails::ThumbnailDimensions {
                width: config_thumbnails.default_dimensions.width,
                height: config_thumbnails.default_dimensions.height,
                maintain_aspect_ratio: config_thumbnails.default_dimensions.maintain_aspect_ratio,
                crop_strategy: self
                    .parse_crop_strategy(&config_thumbnails.default_dimensions.crop_strategy),
            },
            quality: config_thumbnails.quality,
            formats: crate::thumbnails::ThumbnailFormats {
                image_format: config_thumbnails.formats.image_format.clone(),
                waveform_format: config_thumbnails.formats.waveform_format.clone(),
                video_format: config_thumbnails.formats.video_format.clone(),
            },
            timeouts: crate::thumbnails::ThumbnailTimeouts {
                image_processing_seconds: config_thumbnails.timeouts.image_processing_seconds,
                video_processing_seconds: config_thumbnails.timeouts.video_processing_seconds,
                audio_processing_seconds: config_thumbnails.timeouts.audio_processing_seconds,
            },
        }
    }

    /// Parse crop strategy string to CropStrategy enum
    fn parse_crop_strategy(&self, strategy: &str) -> crate::thumbnails::CropStrategy {
        match strategy {
            "center" => crate::thumbnails::CropStrategy::Center,
            "top" => crate::thumbnails::CropStrategy::Top,
            "bottom" => crate::thumbnails::CropStrategy::Bottom,
            "left" => crate::thumbnails::CropStrategy::Left,
            "right" => crate::thumbnails::CropStrategy::Right,
            "fit" => crate::thumbnails::CropStrategy::Fit,
            "fill" => crate::thumbnails::CropStrategy::Fill,
            _ => crate::thumbnails::CropStrategy::Center, // Default fallback
        }
    }

    /// Validate external tools availability for thumbnail generation
    pub async fn validate_thumbnail_tools(
        &self,
        config: &crate::thumbnails::ThumbnailConfig,
    ) -> Result<(), ConfigError> {
        if !config.enabled {
            return Ok(());
        }

        let mut errors = Vec::new();

        // Check ImageMagick
        let imagemagick_cmd = config.imagemagick_path.as_deref().unwrap_or("convert");
        if !self.is_tool_available(imagemagick_cmd).await {
            errors.push(format!(
                "ImageMagick not found at '{}'. Please install ImageMagick or set custom path.",
                imagemagick_cmd
            ));
        }

        // Check FFmpeg
        let ffmpeg_cmd = config.ffmpeg_path.as_deref().unwrap_or("ffmpeg");
        if !self.is_tool_available(ffmpeg_cmd).await {
            errors.push(format!(
                "FFmpeg not found at '{}'. Please install FFmpeg or set custom path.",
                ffmpeg_cmd
            ));
        }

        if !errors.is_empty() {
            return Err(ConfigError::ValidationFailed(errors.join("; ")));
        }

        Ok(())
    }

    /// Check if external tool is available
    async fn is_tool_available(&self, tool_command: &str) -> bool {
        tokio::process::Command::new(tool_command)
            .arg("--version")
            .output()
            .await
            .is_ok()
    }

    /// Get notification configuration from AppConfig
    pub fn get_notification_config<'a>(
        &self,
        app_config: &'a crate::AppConfig,
    ) -> &'a crate::notifications::NotificationConfig {
        &app_config.notifications
    }

    /// Validate notification configuration
    pub fn validate_notification_config(
        &self,
        config: &crate::notifications::NotificationConfig,
    ) -> Result<(), ConfigError> {
        if let Err(e) = config.validate() {
            return Err(ConfigError::ValidationFailed(e));
        }

        // Additional validation for specific environments
        if config.rate_limiting.global_events_per_minute == 0 && config.rate_limiting.enabled {
            return Err(ConfigError::ValidationFailed(
                "Rate limiting is enabled but global events per minute is 0".to_string(),
            ));
        }

        // Validate WebSocket configuration
        if config.websocket.enabled && config.websocket.max_connections == 0 {
            return Err(ConfigError::ValidationFailed(
                "WebSocket is enabled but max connections is 0".to_string(),
            ));
        }

        // Validate PostgreSQL configuration
        if config.postgres.enabled && config.postgres.listener_connections == 0 {
            return Err(ConfigError::ValidationFailed(
                "PostgreSQL notifications enabled but listener connections is 0".to_string(),
            ));
        }

        Ok(())
    }

    /// Create a development-optimized notification configuration
    pub fn create_development_notification_config(
        &self,
    ) -> crate::notifications::NotificationConfig {
        crate::notifications::NotificationConfig::development()
    }

    /// Create a production-optimized notification configuration
    pub fn create_production_notification_config(
        &self,
    ) -> crate::notifications::NotificationConfig {
        crate::notifications::NotificationConfig::production()
    }

    /// Update notification configuration in AppConfig
    pub fn update_notification_config(
        &self,
        app_config: &mut crate::AppConfig,
        notification_config: crate::notifications::NotificationConfig,
    ) -> Result<(), ConfigError> {
        // Validate the new configuration first
        self.validate_notification_config(&notification_config)?;

        // Update the configuration
        app_config.notifications = notification_config;

        Ok(())
    }
}

impl Default for ConfigService {
    fn default() -> Self {
        Self::new()
    }
}

/// Format options for displaying configuration
#[derive(Debug, Clone)]
pub enum ConfigDisplayFormat {
    Json,
    Debug,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_generate_schema() {
        let service = ConfigService::new();
        let schema = service.generate_schema().unwrap();
        assert!(schema.contains("AppConfig"));
        assert!(schema.contains("WebAuthn Server Configuration"));
    }

    #[test]
    fn test_generate_env_file() {
        let service = ConfigService::new();
        let env_content = service
            .generate_env_file("nonexistent.jsonc", None, false)
            .unwrap();

        assert!(env_content.contains("DATABASE_URL="));
        assert!(env_content.contains("SERVER_HOST="));
        assert!(env_content.contains("WEBAUTHN_RP_ID="));
    }

    #[test]
    fn test_init_secrets() {
        let service = ConfigService::new();
        let temp_dir = tempdir().unwrap();
        let secrets_path = temp_dir.path().join("secrets.jsonc");

        service
            .init_secrets(secrets_path.to_str().unwrap(), false)
            .unwrap();

        assert!(secrets_path.exists());
        let content = std::fs::read_to_string(&secrets_path).unwrap();
        assert!(content.contains("database"));
        assert!(content.contains("session_key"));
    }

    #[test]
    fn test_extract_config_section() {
        let service = ConfigService::new();
        let config = AppConfig::default();

        let app_section = service.extract_config_section(&config, "app").unwrap();
        assert!(app_section.is_object());

        let result = service.extract_config_section(&config, "invalid");
        assert!(result.is_err());
    }

    #[test]
    fn test_thumbnail_config_conversion() {
        let service = ConfigService::new();
        let app_config = crate::AppConfig::default();

        let thumbnail_config = service.to_thumbnail_config(&app_config);

        assert_eq!(thumbnail_config.enabled, true);
        assert_eq!(thumbnail_config.max_concurrent_jobs, 4);
        assert_eq!(thumbnail_config.quality, 85);
        assert_eq!(thumbnail_config.default_dimensions.width, 200);
        assert_eq!(thumbnail_config.default_dimensions.height, 200);
        assert_eq!(thumbnail_config.formats.image_format, "webp");
        assert_eq!(thumbnail_config.timeouts.image_processing_seconds, 30);
    }

    #[test]
    fn test_parse_crop_strategy() {
        let service = ConfigService::new();

        assert!(matches!(
            service.parse_crop_strategy("center"),
            crate::thumbnails::CropStrategy::Center
        ));
        assert!(matches!(
            service.parse_crop_strategy("top"),
            crate::thumbnails::CropStrategy::Top
        ));
        assert!(matches!(
            service.parse_crop_strategy("fit"),
            crate::thumbnails::CropStrategy::Fit
        ));
        assert!(matches!(
            service.parse_crop_strategy("invalid"),
            crate::thumbnails::CropStrategy::Center
        ));
    }

    #[test]
    fn test_get_notification_config() {
        let service = ConfigService::new();
        let app_config = AppConfig::default();

        let notification_config = service.get_notification_config(&app_config);

        assert!(notification_config.rate_limiting.enabled);
        assert_eq!(
            notification_config.rate_limiting.global_events_per_minute,
            5000
        );
        assert!(notification_config.websocket.enabled);
        assert!(notification_config.postgres.enabled);
    }

    #[test]
    fn test_validate_notification_config() {
        let service = ConfigService::new();
        let valid_config = crate::notifications::NotificationConfig::default();

        assert!(service.validate_notification_config(&valid_config).is_ok());

        // Test invalid config - rate limiting enabled but 0 events per minute
        let mut invalid_config = valid_config.clone();
        invalid_config.rate_limiting.enabled = true;
        invalid_config.rate_limiting.global_events_per_minute = 0;

        assert!(service
            .validate_notification_config(&invalid_config)
            .is_err());
    }

    #[test]
    fn test_create_development_notification_config() {
        let service = ConfigService::new();
        let dev_config = service.create_development_notification_config();

        assert_eq!(dev_config.rate_limiting.global_events_per_minute, 10000);
        assert!(dev_config.general.enable_debug_logging);
        assert_eq!(dev_config.general.default_delivery_timeout_seconds, 3);
    }

    #[test]
    fn test_create_production_notification_config() {
        let service = ConfigService::new();
        let prod_config = service.create_production_notification_config();

        assert_eq!(prod_config.rate_limiting.global_events_per_minute, 1000);
        assert!(!prod_config.general.enable_debug_logging);
        assert_eq!(prod_config.general.default_delivery_timeout_seconds, 30);
        assert!(prod_config.queue.enable_persistence);
    }

    #[test]
    fn test_update_notification_config() {
        let service = ConfigService::new();
        let mut app_config = AppConfig::default();
        let new_notification_config = service.create_development_notification_config();

        let result =
            service.update_notification_config(&mut app_config, new_notification_config.clone());
        assert!(result.is_ok());

        // Verify the config was updated
        assert_eq!(
            app_config
                .notifications
                .rate_limiting
                .global_events_per_minute,
            new_notification_config
                .rate_limiting
                .global_events_per_minute
        );
    }
}
