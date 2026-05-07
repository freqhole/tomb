//! ratcore — portable rathole core. compiles on every target
//! (terminal, browser, eventually anywhere ratatui draws).
//!
//! NO platform-specific deps allowed here:
//! - no grimoire (links sqlx/iroh/rodio — not portable)
//! - no crossterm (terminal-only)
//! - no tokio runtime (use `async-trait` for the seam, let shells
//!   pick spawn implementations)
//! - no filesystem assumptions (statefile lives in the shell)
//!
//! shells (`tty`, `web`) inject:
//! - a [`transport::Transport`] impl
//! - a list of [`app::AdminCommand`] entries
//! - a [`app::PersistedState`] (loaded however the shell sees fit)

pub mod app;
pub mod catalog;
pub mod palette_filter;
pub mod player_row_keys;
pub mod repl_keys;
pub mod slash;
pub mod text_input;
pub mod theme;
pub mod transport;
pub mod views;
pub mod widgets;
