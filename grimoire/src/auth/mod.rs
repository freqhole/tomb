//! Authentication domain module
//!
//! This module contains all authentication-related domain logic including
//! models, repository, and service implementations.

pub mod models;
pub mod repository;
pub mod service;

// Re-export commonly used types
pub use models::*;
// #todo: don't export repository::
pub use repository::AuthRepository;
pub use service::*;
