//! Grimoire Package
//!
//! This package provides centralized domain logic and abstractions that can be
//! consumed by HTTP route handlers, WebSocket handlers, the CLI package, and
//! potentially future Rust consumers like a Tauri desktop app.
//!
//! The grimoire contains all the magical spells (business logic) needed to
//! power the application! 🧙‍♀️✨

pub mod analytics;
pub mod auth;
pub mod config;
pub mod database;
pub mod wordlist;

// Re-export analytics types
pub use analytics::{
    AnalyticsError, AnalyticsQuery, AnalyticsService, CleanupConfig, UserActivityQuery,
};

// Re-export auth types
pub use auth::{
    AccountLinkConfig, AccountLinkResult, AuthError, AuthRepository, AuthService, AuthServiceError,
    AuthStats, InviteCode, InviteGenerationConfig, InviteGenerationResult, User, UserRole,
};

// Re-export config types
pub use config::{
    AppConfig, ConfigDisplayFormat, ConfigError, ConfigGenerationOptions, ConfigService,
    ConfigValidationResult,
};

// Re-export wordlist types
pub use wordlist::{
    WordlistConfig, WordlistGenerationResult, WordlistService, WordlistValidationResult,
};

// Re-export database connection
pub use database::DatabaseConnection;
