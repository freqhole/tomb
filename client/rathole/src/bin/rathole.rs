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
    // and route raw stderr (CoreAudio / symphonia / iroh-blobs C
    // shims that bypass tracing and `fprintf` straight to fd 2)
    // into the same log file. without this, audio-driver warnings
    // emitted on first playback corrupt the ratatui alt-screen.
    redirect_stderr_to_log();

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
            let file_layer = tracing_subscriber::fmt::layer()
                .with_writer(std::sync::Mutex::new(file))
                .with_ansi(false);
            // also mirror everything into a process-wide ring
            // buffer so the `/logs` slash command can dump recent
            // log lines into the result panel without having to
            // tail the on-disk file.
            let ring = rathole::log_buffer::install();
            let ring_layer = tracing_subscriber::fmt::layer()
                .with_writer(ring)
                .with_ansi(false);
            let _ = tracing_subscriber::registry()
                .with(filter)
                .with(file_layer)
                .with(ring_layer)
                .try_init();
        }
        Err(_) => {
            // even without a file, install the ring buffer so
            // /logs still works in-memory.
            let ring = rathole::log_buffer::install();
            let ring_layer = tracing_subscriber::fmt::layer()
                .with_writer(ring)
                .with_ansi(false);
            let _ = tracing_subscriber::registry()
                .with(filter)
                .with(ring_layer)
                .try_init();
        }
    }
}

/// dup file descriptor 2 (stderr) to the rathole log file so any
/// raw `fprintf(stderr, ...)` from C audio shims (CoreAudio,
/// symphonia's underlying decoders, iroh-relay native bits) lands
/// in the log instead of scribbling over the ratatui alt-screen.
/// best-effort: failures here just leave stderr alone, which is no
/// worse than the previous behaviour.
fn redirect_stderr_to_log() {
    use std::os::fd::AsRawFd;
    let log_path = grimoire::config::get_config().data_dir.join("rathole.log");
    let Ok(file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    else {
        return;
    };
    // SAFETY: dup2 is async-signal-safe and only touches fd 2 in
    // this process. failure is ignored — we don't want a missing
    // libc symbol to take down the binary.
    #[cfg(unix)]
    unsafe {
        let target_fd = file.as_raw_fd();
        if target_fd >= 0 {
            let _ = libc::dup2(target_fd, 2);
        }
    }
    // keep `file` alive for the program lifetime so the dup'd fd
    // remains valid (closing `file` would close the underlying
    // description shared with fd 2 but only after the last
    // reference; leaking it is the safest path).
    std::mem::forget(file);
}
