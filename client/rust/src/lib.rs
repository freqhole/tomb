//! Client Rust Package
//!
//! This package provides centralized domain logic and abstractions that can be
//! consumed by HTTP route handlers, WebSocket handlers, the CLI package, and
//! potentially future Rust consumers like a Tauri desktop app.

pub mod auth;

// Re-export commonly used types
pub use auth::*;

// Re-export server types that clients need
pub use server::auth::models::{AuthError, InviteCode, User, UserRole};
pub use server::database::DatabaseConnection;
