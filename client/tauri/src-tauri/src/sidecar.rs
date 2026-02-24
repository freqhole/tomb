//! sidecar process manager for freqhole server
//!
//! manages the lifecycle of the freqhole server process:
//! - spawn/kill the server
//! - health monitoring
//! - automatic restart with backoff
//! - log capture

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

/// strip ANSI escape codes from a string
fn strip_ansi_codes(s: &str) -> String {
    // matches ANSI escape sequences: ESC[ followed by any params and a final letter
    lazy_static::lazy_static! {
        static ref ANSI_RE: Regex = Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]").unwrap();
    }
    ANSI_RE.replace_all(s, "").to_string()
}

/// default server port
const DEFAULT_PORT: u16 = 8081;

/// minimal config struct for extracting server settings
#[derive(Debug, Deserialize)]
struct PartialConfig {
    #[serde(default)]
    server: PartialServerConfig,
}

#[derive(Debug, Default, Deserialize)]
struct PartialServerConfig {
    #[serde(default = "default_port")]
    port: u16,
}

fn default_port() -> u16 {
    DEFAULT_PORT
}

/// max log lines to keep in memory
const MAX_LOG_LINES: usize = 1000;

/// server process state
pub struct ServerState {
    process: Option<Child>,
    pub config_path: Option<PathBuf>,
    pub port: u16,
    started_at: Option<Instant>,
    pub restart_count: u32,
    last_restart: Option<Instant>,
    /// captured server logs (stdout + stderr)
    pub logs: VecDeque<String>,
}

impl Default for ServerState {
    fn default() -> Self {
        Self {
            process: None,
            config_path: None,
            port: DEFAULT_PORT,
            started_at: None,
            restart_count: 0,
            last_restart: None,
            logs: VecDeque::with_capacity(MAX_LOG_LINES),
        }
    }
}

/// thread-safe wrapper for server state
pub type ServerManager = Arc<Mutex<ServerState>>;

/// create a new server manager
pub fn new_server_manager() -> ServerManager {
    Arc::new(Mutex::new(ServerState::default()))
}

/// server status for the frontend
#[derive(Debug, Clone, Serialize)]
pub struct ServerStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub uptime_secs: Option<u64>,
    pub restart_count: u32,
    pub config_path: Option<String>,
    pub server_url: Option<String>,
}

/// result of a server operation
#[derive(Debug, Serialize)]
pub struct ServerResult {
    pub success: bool,
    pub message: String,
    pub status: Option<ServerStatus>,
}

impl ServerResult {
    pub fn ok(message: impl Into<String>, status: ServerStatus) -> Self {
        Self {
            success: true,
            message: message.into(),
            status: Some(status),
        }
    }

    pub fn err(message: impl Into<String>) -> Self {
        Self {
            success: false,
            message: message.into(),
            status: None,
        }
    }
}

/// find the freqhole binary path
fn find_freqhole_binary() -> Option<PathBuf> {
    // in dev, use target/debug or target/release
    // in prod, use the bundled sidecar

    // try relative to current exe first (bundled app)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            // macOS bundle: Contents/MacOS/freqhole
            let sidecar = parent.join("freqhole");
            if sidecar.exists() {
                return Some(sidecar);
            }

            // also check Resources folder for macOS
            let resources = parent.parent().map(|p| p.join("Resources/freqhole"));
            if let Some(ref path) = resources {
                if path.exists() {
                    return Some(path.clone());
                }
            }
        }
    }

    // dev mode: try workspace target directory
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let workspace_root = PathBuf::from(manifest_dir)
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .map(|p| p.to_path_buf());

        if let Some(root) = workspace_root {
            // try release first, then debug
            let release = root.join("target/release/freqhole");
            if release.exists() {
                return Some(release);
            }

            let debug = root.join("target/debug/freqhole");
            if debug.exists() {
                return Some(debug);
            }
        }
    }

    // fallback: try PATH
    which::which("freqhole").ok()
}

/// get current server status
pub async fn get_status(state: &ServerManager) -> ServerStatus {
    let mut guard = state.lock().await;

    // check if process is still running
    if let Some(ref mut child) = guard.process {
        match child.try_wait() {
            Ok(Some(_exit_status)) => {
                // process has exited
                guard.process = None;
                guard.started_at = None;
            }
            Ok(None) => {
                // still running
            }
            Err(_) => {
                guard.process = None;
                guard.started_at = None;
            }
        }
    }

    let running = guard.process.is_some();
    let pid = guard.process.as_ref().map(|c| c.id());
    let uptime_secs = guard.started_at.map(|t| t.elapsed().as_secs());
    let port = guard.port;

    ServerStatus {
        running,
        pid,
        uptime_secs,
        restart_count: guard.restart_count,
        config_path: guard.config_path.as_ref().map(|p| p.display().to_string()),
        server_url: if running {
            Some(format!("http://localhost:{}", port))
        } else {
            None
        },
    }
}

/// start the server
pub async fn start_server(state: &ServerManager, config_path: PathBuf) -> ServerResult {
    let state_clone = Arc::clone(state);

    let mut guard = state.lock().await;

    // check if already running
    if let Some(ref mut child) = guard.process {
        if child.try_wait().ok().flatten().is_none() {
            return ServerResult::err("server is already running");
        }
    }

    // find the binary
    let binary = match find_freqhole_binary() {
        Some(path) => path,
        None => return ServerResult::err("could not find freqhole binary"),
    };

    // verify config exists
    if !config_path.exists() {
        return ServerResult::err(format!("config file not found: {}", config_path.display()));
    }

    // parse config to get port
    let port = match std::fs::read_to_string(&config_path) {
        Ok(content) => match json5::from_str::<PartialConfig>(&content) {
            Ok(config) => config.server.port,
            Err(_) => DEFAULT_PORT,
        },
        Err(_) => DEFAULT_PORT,
    };

    // clear previous logs
    guard.logs.clear();
    guard.logs.push_back(format!(
        "[sidecar] starting server with config: {}",
        config_path.display()
    ));

    // spawn the server process
    let result = Command::new(&binary)
        .arg("server")
        .arg("--config")
        .arg(&config_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    match result {
        Ok(mut child) => {
            let pid = child.id();

            // take stdout/stderr for log capture
            let stdout = child.stdout.take();
            let stderr = child.stderr.take();

            guard.process = Some(child);
            guard.config_path = Some(config_path.clone());
            guard.port = port;
            guard.started_at = Some(Instant::now());
            guard.restart_count = 0;
            guard.last_restart = None;

            // drop the guard before spawning log readers
            drop(guard);

            // spawn stdout reader
            if let Some(stdout) = stdout {
                let state_for_stdout = Arc::clone(&state_clone);
                std::thread::spawn(move || {
                    let reader = BufReader::new(stdout);
                    for line in reader.lines() {
                        if let Ok(line) = line {
                            if let Ok(mut guard) = state_for_stdout.try_lock() {
                                if guard.logs.len() >= MAX_LOG_LINES {
                                    guard.logs.pop_front();
                                }
                                guard
                                    .logs
                                    .push_back(format!("[stdout] {}", strip_ansi_codes(&line)));
                            }
                        }
                    }
                });
            }

            // spawn stderr reader
            if let Some(stderr) = stderr {
                let state_for_stderr = Arc::clone(&state_clone);
                std::thread::spawn(move || {
                    let reader = BufReader::new(stderr);
                    for line in reader.lines() {
                        if let Ok(line) = line {
                            if let Ok(mut guard) = state_for_stderr.try_lock() {
                                if guard.logs.len() >= MAX_LOG_LINES {
                                    guard.logs.pop_front();
                                }
                                guard
                                    .logs
                                    .push_back(format!("[stderr] {}", strip_ansi_codes(&line)));
                            }
                        }
                    }
                });
            }

            let status = ServerStatus {
                running: true,
                pid: Some(pid),
                uptime_secs: Some(0),
                restart_count: 0,
                config_path: Some(config_path.display().to_string()),
                server_url: Some(format!("http://localhost:{}", port)),
            };

            ServerResult::ok("server started", status)
        }
        Err(e) => ServerResult::err(format!("failed to start server: {}", e)),
    }
}

/// stop the server
pub async fn stop_server(state: &ServerManager) -> ServerResult {
    let mut guard = state.lock().await;

    match guard.process.take() {
        Some(mut child) => {
            // try graceful shutdown first (SIGTERM)
            #[cfg(unix)]
            {
                use std::os::unix::process::CommandExt;
                let _ = Command::new("kill")
                    .arg("-TERM")
                    .arg(child.id().to_string())
                    .exec();
            }

            // wait briefly for graceful shutdown
            let graceful_timeout = Duration::from_secs(5);
            let start = Instant::now();

            loop {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) => {
                        if start.elapsed() > graceful_timeout {
                            // force kill
                            let _ = child.kill();
                            let _ = child.wait();
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    Err(_) => break,
                }
            }

            guard.started_at = None;

            let status = ServerStatus {
                running: false,
                pid: None,
                uptime_secs: None,
                restart_count: guard.restart_count,
                config_path: guard.config_path.as_ref().map(|p| p.display().to_string()),
                server_url: None,
            };

            ServerResult::ok("server stopped", status)
        }
        None => ServerResult::err("server is not running"),
    }
}

/// restart the server
pub async fn restart_server(state: &ServerManager) -> ServerResult {
    let config_path = {
        let guard = state.lock().await;
        guard.config_path.clone()
    };

    match config_path {
        Some(path) => {
            // stop first
            let _ = stop_server(state).await;

            // brief pause
            tokio::time::sleep(Duration::from_millis(500)).await;

            // track restart
            {
                let mut guard = state.lock().await;
                guard.restart_count += 1;
                guard.last_restart = Some(Instant::now());
            }

            // start again
            start_server(state, path).await
        }
        None => ServerResult::err("no config path set - start the server first"),
    }
}

/// check server health via HTTP
pub async fn check_health(base_url: &str) -> bool {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build();

    let client = match client {
        Ok(c) => c,
        Err(_) => return false,
    };

    let health_url = format!("{}/health", base_url);

    match client.get(&health_url).send().await {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}

// --- tauri commands ---

/// get server status
#[tauri::command]
pub async fn server_status(state: tauri::State<'_, ServerManager>) -> Result<ServerStatus, String> {
    Ok(get_status(&state).await)
}

/// start the server with config path
#[tauri::command]
pub async fn server_start(
    state: tauri::State<'_, ServerManager>,
    config_path: String,
) -> Result<ServerResult, String> {
    let path = PathBuf::from(config_path);
    Ok(start_server(&state, path).await)
}

/// stop the server
#[tauri::command]
pub async fn server_stop(state: tauri::State<'_, ServerManager>) -> Result<ServerResult, String> {
    Ok(stop_server(&state).await)
}

/// restart the server
#[tauri::command]
pub async fn server_restart(
    state: tauri::State<'_, ServerManager>,
) -> Result<ServerResult, String> {
    Ok(restart_server(&state).await)
}

/// check if server is healthy
#[tauri::command]
pub async fn server_health_check(state: tauri::State<'_, ServerManager>) -> Result<bool, String> {
    let guard = state.lock().await;
    let port = guard.port;
    drop(guard);
    Ok(check_health(&format!("http://localhost:{}", port)).await)
}

/// get server logs
#[tauri::command]
pub async fn get_server_logs(
    state: tauri::State<'_, ServerManager>,
    max_lines: Option<usize>,
) -> Result<Vec<String>, String> {
    let guard = state.lock().await;
    let max = max_lines.unwrap_or(100).min(MAX_LOG_LINES);
    let logs: Vec<String> = guard.logs.iter().rev().take(max).cloned().collect();
    Ok(logs.into_iter().rev().collect())
}
