//! server library
//!
//! http server for freqhole music system

pub mod adapter;
pub mod auth;
pub mod blobs;
pub mod error;
pub mod health;
pub mod media_server;
pub mod routes;
pub mod run;
pub mod server;
pub mod state;
pub mod static_files;
pub mod upload;

pub use error::ApiError;
pub use media_server::{spawn_local_media_server, spawn_media_server_on, MediaServerHandle};
pub use run::{run_server, ServeMode, ServerOptions};
pub use server::start_server;
pub use state::AppState;
