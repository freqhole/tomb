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

    // route logs to a file — stdout is owned by ratatui and writing to it
    // would scribble over the rendered ui.
    init_file_logging();

    rathole::run(rathole::LaunchOpts { config }).await
}

fn init_file_logging() {
    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::util::SubscriberInitExt;

    let level = grimoire::config::get_config().logging.level.clone();
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(level));
    let log_path = grimoire::config::get_config().data_dir.join("rathole.log");
    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        Ok(file) => {
            let layer = tracing_subscriber::fmt::layer()
                .with_writer(std::sync::Mutex::new(file))
                .with_ansi(false);
            let _ = tracing_subscriber::registry()
                .with(filter)
                .with(layer)
                .try_init();
        }
        Err(_) => {
            // silence rather than corrupt the tui.
            let _ = tracing_subscriber::registry().with(filter).try_init();
        }
    }
}
