//! unified API dispatch
//!
//! all transports (HTTP, Tauri, CLI, P2P) route through here.
//! dispatch owns authorization - transports handle authentication.

mod caller;
mod dispatch;

pub use caller::Caller;
pub use dispatch::dispatch;

// route handlers organized by domain
pub mod admin;
pub mod auth;
pub mod media_blobz;
pub mod music;
pub mod public; // unauthenticated routes (hello, knock)
pub mod upload;
