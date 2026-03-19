//! setup wizard shared logic
//!
//! provides dependency checks, defaults, and a setup service for CLI and Tauri.
//! the UI/prompting is handled by each frontend, but the core logic lives here.

mod checks;
mod defaults;
mod embedded_assets;
mod service;

pub use checks::{check_dependencies, DependencyStatus};
pub use defaults::{get_defaults, get_local_defaults, SetupDefaults};
pub use embedded_assets::{
    extract_spume_to, has_embedded_spume, update_spume_to, ExtractResult, UpdateSpumeError,
    UpdateSpumeResult, SPUME_DIST,
};
pub use service::{ScanDir, SetupConfig, SetupResult, SetupService, SYSTEM_ROOT_USERNAME};
