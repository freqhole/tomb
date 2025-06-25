//! Configuration domain module
//!
//! This module contains all configuration-related domain logic including
//! application config, service implementations, and validation.

pub mod app_config;
pub mod service;

// Re-export commonly used types
pub use app_config::{AppConfig, ConfigError as AppConfigError};
pub use service::{
    ConfigDisplayFormat, ConfigError, ConfigGenerationOptions, ConfigService,
    ConfigValidationResult,
};
