//! setup wizard shared logic
//!
//! provides dependency checks, defaults, and a setup service for CLI and Tauri.
//! the UI/prompting is handled by each frontend, but the core logic lives here.

mod checks;
mod defaults;
mod service;

pub use checks::{check_dependencies, DependencyStatus};
pub use defaults::{get_defaults, get_local_defaults, SetupDefaults};
pub use service::{ScanDir, SetupConfig, SetupResult, SetupService};
