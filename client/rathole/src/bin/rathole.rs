//! standalone rathole binary entry (tty shell). delegates to the
//! library `run`.
//!
//! initialises grimoire config + database here so the binary works
//! when invoked directly (not via `freqhole rathole`).
//!
//! args: `--player` starts directly in the cenotaph-compatible pairing
//! view (see docs/rathole-headless-player-plan.md phase 4). the first
//! remaining (non-flag) arg is the config path, then `$FREQHOLE_CONFIG`,
//! then the cli's own defaults.

use std::path::PathBuf;

#[tokio::main(flavor = "current_thread")]
async fn main() -> color_eyre::Result<()> {
    color_eyre::install()?;

    let args: Vec<String> = std::env::args().skip(1).collect();
    let player = args.iter().any(|a| a == "--player");
    let config: Option<PathBuf> = args
        .iter()
        .find(|a| !a.starts_with("--"))
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
    let log_file = init_file_logging();
    // and route raw stderr (CoreAudio / symphonia / iroh-blobs C
    // shims that bypass tracing and `fprintf` straight to fd 2)
    // into the same log file. without this, audio-driver warnings
    // emitted on first playback corrupt the ratatui alt-screen.
    if let Some(log_file) = log_file {
        if let Err(e) = redirect_stderr_to_log(log_file) {
            eprintln!("failed to redirect stderr to rathole log: {e}");
        }
    }

    rathole::run(rathole::LaunchOpts {
        config,
        serve_capable: false,
        player,
    })
    .await
}

fn init_file_logging() -> Option<grimoire::log_file::LogFile> {
    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::util::SubscriberInitExt;

    let level = grimoire::config::get_config().logging.level.clone();
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(level));
    let log_path = grimoire::config::get_config().data_dir.join("rathole.log");
    match grimoire::log_file::LogFile::open(
        &log_path,
        grimoire::config::get_config().logging.max_lines,
    ) {
        Ok(file) => {
            let file_layer = tracing_subscriber::fmt::layer()
                .with_writer(file.clone())
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
            Some(file)
        }
        Err(e) => {
            eprintln!("failed to open rathole log {}: {e}", log_path.display());
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
            None
        }
    }
}

#[cfg(unix)]
fn redirect_stderr_to_log(mut log_file: grimoire::log_file::LogFile) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::net::UnixStream;

    let (mut reader, writer) = UnixStream::pair()?;
    let original_fd = unsafe { libc::fcntl(2, libc::F_DUPFD_CLOEXEC, 0) };
    if original_fd < 0 {
        return Err(std::io::Error::last_os_error());
    }
    let mut original_stderr = unsafe { std::fs::File::from_raw_fd(original_fd) };
    std::thread::Builder::new()
        .name("rathole-stderr-log".into())
        .spawn(move || {
            if let Err(e) = std::io::copy(&mut reader, &mut log_file) {
                let _ = writeln!(original_stderr, "failed to write rathole stderr log: {e}");
                if let Err(e) = std::io::copy(&mut reader, &mut original_stderr) {
                    let _ = writeln!(original_stderr, "failed to forward stderr: {e}");
                }
            }
        })?;
    if unsafe { libc::dup2(writer.as_raw_fd(), 2) } < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(unix))]
fn redirect_stderr_to_log(_log_file: grimoire::log_file::LogFile) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "stderr redirection is not supported",
    ))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn stderr_is_bounded() {
        const CHILD_PATH: &str = "RATHOLE_STDERR_TEST_PATH";
        if let Some(path) = std::env::var_os(CHILD_PATH) {
            let path = PathBuf::from(path);
            redirect_stderr_to_log(grimoire::log_file::LogFile::open(&path, 10).unwrap()).unwrap();
            let input = (0..100).map(|i| format!("{i}\n")).collect::<String>();
            let written = unsafe { libc::write(2, input.as_ptr().cast(), input.len()) };
            assert_eq!(written, input.len() as isize);
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            while !std::fs::read_to_string(&path).unwrap().ends_with("99\n") {
                assert!(
                    std::time::Instant::now() < deadline,
                    "stderr was not captured"
                );
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            return;
        }

        let path = std::env::temp_dir().join(format!(
            "rathole-stderr-test-{}-{}.log",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "tests::stderr_is_bounded", "--nocapture"])
            .env(CHILD_PATH, &path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "child failed: {} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.lines().count() <= 10);
        assert_eq!(content.lines().last(), Some("99"));
        std::fs::remove_file(path).unwrap();
    }
}
