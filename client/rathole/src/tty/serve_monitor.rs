//! subprocess monitor for `freqhole serve` modes.
//!
//! the tty shell uses this to start/stop the http and/or p2p
//! endpoints from inside the running tui without trying to embed
//! `server::run_server` (which owns global tracing init + signal
//! handlers and would fight ratatui's terminal). we just spawn the
//! current binary with the appropriate subcommand, redirect its
//! stdout/stderr away from the tui, and track liveness via
//! `try_wait`.
//!
//! shape is intentionally tiny — one struct, four methods, no
//! background tasks. the tui polls `refresh()` on every tick to
//! pick up exits, and the header reads `status()` for rendering.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

/// which serve mode a subprocess was launched with. lines up with
/// `server::ServeMode` but we keep our own copy so this module
/// stays decoupled from the server crate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServeKind {
    /// `freqhole serve` — both http + p2p (subject to config flags)
    Auto,
    /// `freqhole http` — http only
    Http,
    /// `freqhole p2p` — p2p only
    P2p,
}

impl ServeKind {
    fn arg(self) -> &'static str {
        match self {
            Self::Auto => "serve",
            Self::Http => "http",
            Self::P2p => "p2p",
        }
    }
}

/// snapshot of the monitor state, cheap to clone for the ui layer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServeStatus {
    /// no child has been spawned (or the last one was reaped).
    Stopped,
    /// child is alive. pid is informational only — actual liveness
    /// is checked via `try_wait`.
    Running { kind: ServeKind, pid: u32 },
    /// child exited on its own. `code` is `None` for signal exits.
    Exited { kind: ServeKind, code: Option<i32> },
    /// failed to spawn the child at all (e.g. current_exe lookup
    /// failed, fork/exec failed). `message` is for ui display.
    SpawnError { message: String },
}

impl ServeStatus {
    /// true while the child is believed to be alive. the header
    /// uses this to pick the "on" color for badge rendering.
    pub fn is_running(&self) -> bool {
        matches!(self, Self::Running { .. })
    }

    /// kind of the active or last-exited child, for ui labelling.
    pub fn kind(&self) -> Option<ServeKind> {
        match self {
            Self::Running { kind, .. } | Self::Exited { kind, .. } => Some(*kind),
            _ => None,
        }
    }
}

/// owns the child handle + a shared snapshot. the snapshot is the
/// only thing the ui ever reads; mutation is funneled through
/// `start` / `stop` / `refresh` so we don't have to thread a `&mut`
/// monitor through every render path.
pub struct ServeMonitor {
    /// path to the freqhole binary to invoke. usually
    /// `std::env::current_exe()` but configurable for tests.
    binary: PathBuf,
    /// optional path to the config file passed to the child via
    /// `--config <path>`. mirrors the user's tui invocation so the
    /// child operates on the same db.
    config_path: Option<PathBuf>,
    child: Option<Child>,
    snapshot: Arc<Mutex<ServeStatus>>,
}

impl ServeMonitor {
    pub fn new(binary: PathBuf, config_path: Option<PathBuf>) -> Self {
        Self {
            binary,
            config_path,
            child: None,
            snapshot: Arc::new(Mutex::new(ServeStatus::Stopped)),
        }
    }

    /// cheap clone of the status snapshot for the ui.
    pub fn status(&self) -> ServeStatus {
        self.snapshot
            .lock()
            .map(|g| g.clone())
            .unwrap_or(ServeStatus::Stopped)
    }

    /// shared handle to the snapshot — let the shell hand this to
    /// any view that needs to read status without holding a borrow
    /// on the monitor itself.
    pub fn snapshot_handle(&self) -> Arc<Mutex<ServeStatus>> {
        self.snapshot.clone()
    }

    /// spawn the child. fails if a child is already alive (caller
    /// should `stop()` first).
    pub fn start(&mut self, kind: ServeKind) -> Result<(), String> {
        if let Some(child) = self.child.as_mut() {
            // if the previous child is still alive, refuse to spawn
            // another one. if it's dead, reap it and continue.
            match child.try_wait() {
                Ok(Some(_)) => {
                    let _ = self.child.take();
                }
                Ok(None) => return Err("a serve subprocess is already running".into()),
                Err(e) => return Err(format!("failed to query existing child: {e}")),
            }
        }

        let mut cmd = Command::new(&self.binary);
        cmd.arg(kind.arg());
        if let Some(cfg) = &self.config_path {
            // top-level --config flag is global on the freqhole cli
            cmd.arg("--config").arg(cfg);
        }
        // detach stdio so the child's logs don't smear the tui.
        // server logs still go to its configured log_file.
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        match cmd.spawn() {
            Ok(child) => {
                let pid = child.id();
                self.child = Some(child);
                self.set_status(ServeStatus::Running { kind, pid });
                Ok(())
            }
            Err(e) => {
                let msg = format!("failed to spawn serve subprocess: {e}");
                self.set_status(ServeStatus::SpawnError {
                    message: msg.clone(),
                });
                Err(msg)
            }
        }
    }

    /// kill the running child (if any). best-effort: if the kill
    /// fails (e.g. child already exited), the next `refresh()` will
    /// reap it normally.
    pub fn stop(&mut self) -> Result<(), String> {
        let Some(child) = self.child.as_mut() else {
            return Err("no serve subprocess is running".into());
        };
        if let Err(e) = child.kill() {
            return Err(format!("failed to kill serve subprocess: {e}"));
        }
        // wait briefly so the subsequent refresh sees the exit
        let _ = child.wait();
        let kind = self.status().kind().unwrap_or(ServeKind::Auto);
        self.child = None;
        self.set_status(ServeStatus::Exited { kind, code: None });
        Ok(())
    }

    /// non-blocking liveness poll. call this once per ui tick so
    /// the snapshot reflects child exits promptly.
    pub fn refresh(&mut self) {
        let Some(child) = self.child.as_mut() else {
            return;
        };
        match child.try_wait() {
            Ok(Some(status)) => {
                let kind = self.status().kind().unwrap_or(ServeKind::Auto);
                let code = status.code();
                self.child = None;
                self.set_status(ServeStatus::Exited { kind, code });
            }
            Ok(None) => { /* still running */ }
            Err(_) => { /* leave snapshot alone, retry next tick */ }
        }
    }

    fn set_status(&self, s: ServeStatus) {
        if let Ok(mut guard) = self.snapshot.lock() {
            *guard = s;
        }
    }
}

impl Drop for ServeMonitor {
    /// kill any surviving child on tui shutdown so we don't leave
    /// orphan servers behind when the user quits rathole.
    fn drop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
