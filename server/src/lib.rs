//! server library
//!
//! http server for freqhole music system

pub mod adapter;
pub mod auth;
pub mod blobs;
pub mod error;
pub mod health;
pub mod routes;
pub mod run;
pub mod server;
pub mod state;
pub mod static_files;
pub mod upload;

pub use error::ApiError;
pub use run::{run_server, ServerOptions};
pub use server::start_server;
pub use state::AppState;
