//! tty shell — terminal entry point for rathole.
//!
//! owns: ratatui terminal lifecycle, crossterm event loop, the
//! grimoire-backed `LocalTransport`, and the toml statefile.

mod persist;
mod run;
mod transport;

pub use transport::LocalTransport;

use std::path::PathBuf;

/// launch options for the tty shell.
#[derive(Debug, Clone, Default)]
pub struct LaunchOpts {
    /// path to a `freqhole-config.toml`. when `None`, falls back to
    /// the same defaults as the rest of the cli.
    pub config: Option<PathBuf>,
}

/// run the rathole tui. expects grimoire's config + database to be
/// initialised already (the cli does this before calling us).
///
/// owns the terminal lifecycle: `ratatui::init()` on entry, restore
/// on exit (including on error).
pub async fn run(opts: LaunchOpts) -> color_eyre::Result<()> {
    let terminal = ratatui::init();
    let result = run::run(terminal, opts).await;
    ratatui::restore();
    result
}
