//! rathole — ratatui-based terminal client for freqhole.
//!
//! see [docs/TUI_PLAN.md](../../docs/TUI_PLAN.md).

pub mod app;
pub mod transport;
pub mod views;
pub mod widgets;

use std::path::PathBuf;

/// launch options for rathole. mirrors the cli's `--config` flow.
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
    let result = run_inner(terminal, opts).await;
    ratatui::restore();
    result
}

async fn run_inner(
    terminal: ratatui::DefaultTerminal,
    opts: LaunchOpts,
) -> color_eyre::Result<()> {
    let app = app::App::new(opts).await?;
    app.run(terminal).await
}
