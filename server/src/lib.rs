//! server library
//!
//! http server for freqhole music system

pub mod auth;
pub mod blobs;
pub mod error;
pub mod health;
pub mod jobs;
pub mod music;
pub mod routes;
pub mod server;
pub mod state;
pub mod static_files;

pub use error::ApiError;
pub use server::start_server;
pub use state::AppState;
