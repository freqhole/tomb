//! social module
//!
//! unified peer identity and social relationship system.
//! builds on top of `user_accountz` and `user_peer_nodez` to provide
//! friendship management, friend requests, profile handling, and social settings.

pub mod models;
pub mod repository;
pub mod service;

pub use models::*;
pub use repository::SocialRepository;
pub use service::SocialService;
