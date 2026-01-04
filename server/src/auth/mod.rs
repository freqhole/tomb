//! Authentication module
//!
//! This module handles all authentication-related functionality including:
//! - User registration and management
//! - Invite code system
//! - WebAuthn/FIDO2 authentication
//! - Session management
//! - Authentication middleware

pub mod handlers;
pub mod middleware;
pub mod routes;

// Re-export commonly used types from grimoire
pub use legacylib::auth::{AuthError, InviteCode, User, UserRole, WebauthnCredential};
pub use legacylib::AuthRepository;

// Re-export handlers
pub use handlers::*;

// Re-export middleware
pub use middleware::{
    require_admin, require_analytics_access, require_authentication, require_user,
    AuthenticatedUser,
};

// Re-export routes
pub use routes::build_auth_routes;

// Future exports (to be added as we move more code)
// pub mod service;
//
// pub use service::AuthService;
