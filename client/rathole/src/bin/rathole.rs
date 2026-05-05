//! standalone rathole binary entry (tty shell). delegates to the
//! library `run`.
//!
//! initialises grimoire config + database here so the binary works
//! when invoked directly (not via `freqhole rathole`).
//!
//! config path: first positional arg, then `$FREQHOLE_CONFIG`, then
//! the cli's own defaults.

use std::path::PathBuf;

#[tokio::main(flavor = "current_thread")]
async fn main() -> color_eyre::Result<()> {
    color_eyre::install()?;

    let config: Option<PathBuf> = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .or_else(|| std::env::var("FREQHOLE_CONFIG").ok().map(PathBuf::from));

    grimoire::config::init_config(config.clone())
        .map_err(|e| color_eyre::eyre::eyre!("failed to initialize config: {e}"))?;
    grimoire::database::initialize()
        .await
        .map_err(|e| color_eyre::eyre::eyre!("failed to initialize database: {e}"))?;
    grimoire::database::run_migrations()
        .await
        .map_err(|e| color_eyre::eyre::eyre!("failed to run migrations: {e}"))?;

    rathole::run(rathole::LaunchOpts { config }).await
}
