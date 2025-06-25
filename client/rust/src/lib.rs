//! Client Rust Package
//!
//! This package provides centralized domain logic and abstractions that can be
//! consumed by HTTP route handlers, WebSocket handlers, the CLI package, and
//! potentially future Rust consumers like a Tauri desktop app.

pub mod analytics;
pub mod auth;
pub mod config;
pub mod wordlist;

// Re-export the new service types
pub use analytics::{
    AnalyticsError, AnalyticsQuery, AnalyticsService, CleanupConfig, UserActivityQuery,
};
pub use auth::{
    AccountLinkConfig, AccountLinkResult, AuthService, AuthServiceError, AuthStats,
    InviteGenerationConfig, InviteGenerationResult,
};
pub use config::{
    ConfigDisplayFormat, ConfigError, ConfigGenerationOptions, ConfigService,
    ConfigValidationResult,
};
pub use wordlist::{
    WordlistConfig, WordlistError, WordlistGenerationResult, WordlistService, WordlistStats,
    WordlistValidationResult,
};

// Re-export server types that clients need
pub use server::auth::models::{AuthError, InviteCode, User, UserRole};
pub use server::database::DatabaseConnection;
