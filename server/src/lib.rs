//! server library
//!
//! http server for freqhole music system

pub mod error;
pub mod routes;
pub mod server;
pub mod state;

pub use error::ApiError;
pub use server::start_server;
pub use state::AppState;
