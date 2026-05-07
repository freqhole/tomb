//! rathole — ratatui-based client for freqhole. ships two shells:
//!
//! - `tty` (terminal, default for non-wasm targets)
//! - `web` (browser via ratzilla, target_arch = "wasm32")
//!
//! see [docs/TUI_PLAN.md](../../docs/TUI_PLAN.md).

pub mod ratcore;

#[cfg(not(target_arch = "wasm32"))]
pub mod tty;

#[cfg(not(target_arch = "wasm32"))]
pub mod wizard;

#[cfg(target_arch = "wasm32")]
pub mod web;

// re-export the tty entry at the crate root so `cli` can keep using
// `rathole::run(rathole::LaunchOpts {...})` unchanged.
#[cfg(not(target_arch = "wasm32"))]
pub use tty::{run, LaunchOpts};
