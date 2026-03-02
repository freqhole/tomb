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
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::app_config::{save_freqhole_bin_path, FreqholeAppConfig};
use crate::spume_bridge::push_config_to_spume;

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

/// find the freqhole binary path (internal discovery logic)
fn discover_freqhole_binary() -> Option<PathBuf> {
    // in dev, use target/debug or target/release
    // in prod, use the bundled resource

    // try relative to current exe first (bundled app)
    if let Ok(exe_path) = std::env::current_exe() {
        eprintln!("[sidecar] exe path: {:?}", exe_path);
        if let Some(parent) = exe_path.parent() {
            // same directory as exe
            let sidecar = parent.join("freqhole");
            eprintln!("[sidecar] checking: {:?}", sidecar);
            if sidecar.exists() {
                eprintln!("[sidecar] found freqhole at: {:?}", sidecar);
                return Some(sidecar);
            }

            // bin subfolder (Tauri resources)
            let bin_sidecar = parent.join("bin/freqhole");
            eprintln!("[sidecar] checking: {:?}", bin_sidecar);
            if bin_sidecar.exists() {
                eprintln!("[sidecar] found freqhole at: {:?}", bin_sidecar);
                return Some(bin_sidecar);
            }

            // Linux RPM/DEB: /usr/lib/<app-name>/bin/freqhole
            // exe is at /usr/bin/freqhole-app, binary is at /usr/lib/freqhole-app/bin/freqhole
            if let Some(exe_name) = exe_path.file_name() {
                let lib_path = PathBuf::from("/usr/lib")
                    .join(exe_name)
                    .join("bin/freqhole");
                eprintln!("[sidecar] checking: {:?}", lib_path);
                if lib_path.exists() {
                    eprintln!("[sidecar] found freqhole at: {:?}", lib_path);
                    return Some(lib_path);
                }
            }

            // macOS bundle: Contents/Resources/bin/freqhole
            let resources = parent.parent().map(|p| p.join("Resources/bin/freqhole"));
            if let Some(ref path) = resources {
                eprintln!("[sidecar] checking: {:?}", path);
                if path.exists() {
                    eprintln!("[sidecar] found freqhole at: {:?}", path);
                    return Some(path.clone());
                }
            }

            // macOS bundle: Contents/Resources/freqhole (legacy)
            let resources_legacy = parent.parent().map(|p| p.join("Resources/freqhole"));
            if let Some(ref path) = resources_legacy {
                eprintln!("[sidecar] checking: {:?}", path);
                if path.exists() {
                    eprintln!("[sidecar] found freqhole at: {:?}", path);
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

/// find the freqhole binary path
/// checks app config first, falls back to discovery, and caches result
fn find_freqhole_binary(app_handle: Option<&tauri::AppHandle>) -> Option<PathBuf> {
    // first, check if we have a cached path in app config
    if let Some(app) = app_handle {
        let config = FreqholeAppConfig::load(app);
        if let Some(ref config) = config {
            if let Some(path) = config.get_freqhole_bin_path() {
                if path.exists() {
                    eprintln!("[sidecar] using cached binary path: {:?}", path);
                    return Some(path);
                } else {
                    eprintln!("[sidecar] cached binary path no longer exists: {:?}", path);
                }
            }
        }
    }

    // discover the binary
    let discovered = discover_freqhole_binary()?;

    // cache the discovered path for next time
    if let Some(app) = app_handle {
        let path_str = discovered.display().to_string();
        if let Err(e) = save_freqhole_bin_path(app, &path_str) {
            eprintln!("[sidecar] failed to cache binary path: {}", e);
        } else {
            eprintln!("[sidecar] cached binary path: {:?}", discovered);
        }
    }

    Some(discovered)
}

/// get current server status
pub async fn get_status(state: &ServerManager) -> ServerStatus {
    let mut guard = state.lock().unwrap();

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
pub async fn start_server(
    state: &ServerManager,
    config_path: PathBuf,
    app_handle: Option<&tauri::AppHandle>,
) -> ServerResult {
    let state_clone = Arc::clone(state);

    let mut guard = state.lock().unwrap();

    // check if already running
    if let Some(ref mut child) = guard.process {
        if child.try_wait().ok().flatten().is_none() {
            return ServerResult::err("server is already running");
        }
    }

    // find the binary
    let binary = match find_freqhole_binary(app_handle) {
        Some(path) => path,
        None => {
            eprintln!("[sidecar] could not find freqhole binary");
            return ServerResult::err("could not find freqhole binary");
        }
    };

    // verify config exists
    if !config_path.exists() {
        let msg = format!("config file not found: {}", config_path.display());
        eprintln!("[sidecar] {}", msg);
        return ServerResult::err(msg);
    }

    // parse config to get port
    let port = match std::fs::read_to_string(&config_path) {
        Ok(content) => match toml::from_str::<PartialConfig>(&content) {
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
                            let stripped = strip_ansi_codes(&line);
                            // also print to stderr so it shows in terminal during dev
                            eprintln!("[server stderr] {}", stripped);
                            if let Ok(mut guard) = state_for_stderr.try_lock() {
                                if guard.logs.len() >= MAX_LOG_LINES {
                                    guard.logs.pop_front();
                                }
                                guard.logs.push_back(format!("[stderr] {}", stripped));
                            }
                        }
                    }
                });
            }

            // wait a moment and check if process exited immediately (crash on startup)
            std::thread::sleep(Duration::from_millis(500));
            {
                let mut guard = state_clone.lock().unwrap();
                if let Some(ref mut child) = guard.process {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            // process exited immediately - this is a crash
                            let msg = format!(
                                "server process exited immediately with status: {}",
                                status
                            );
                            eprintln!("[sidecar] {}", msg);
                            guard.process = None;
                            guard.started_at = None;
                            // get any captured logs for context
                            let recent_logs: Vec<String> =
                                guard.logs.iter().rev().take(10).cloned().collect();
                            drop(guard);
                            let log_context = if recent_logs.is_empty() {
                                String::new()
                            } else {
                                format!(
                                    "\nRecent logs:\n{}",
                                    recent_logs.into_iter().rev().collect::<Vec<_>>().join("\n")
                                )
                            };
                            return ServerResult::err(format!("{}{}", msg, log_context));
                        }
                        Ok(None) => {
                            // still running - good!
                            eprintln!("[sidecar] server still running after startup check");
                        }
                        Err(e) => {
                            eprintln!("[sidecar] error checking process status: {}", e);
                        }
                    }
                }
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
        Err(e) => {
            let msg = format!("failed to spawn server process: {}", e);
            eprintln!("[sidecar] {}", msg);
            ServerResult::err(msg)
        }
    }
}

/// stop the server
pub async fn stop_server(state: &ServerManager) -> ServerResult {
    eprintln!("[stop_server] acquiring lock...");
    let mut guard = state.lock().unwrap();
    eprintln!("[stop_server] lock acquired");

    match guard.process.take() {
        Some(mut child) => {
            let pid = child.id();
            eprintln!("[stop_server] stopping process pid={}", pid);

            // try graceful shutdown first (SIGTERM)
            #[cfg(unix)]
            {
                use nix::sys::signal::{kill, Signal};
                use nix::unistd::Pid;
                eprintln!("[stop_server] sending SIGTERM");
                let _ = kill(Pid::from_raw(pid as i32), Signal::SIGTERM);
            }

            // wait briefly for graceful shutdown
            let graceful_timeout = Duration::from_secs(10);
            let start = Instant::now();

            loop {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        eprintln!("[stop_server] process exited with status: {:?}", status);
                        break;
                    }
                    Ok(None) => {
                        let elapsed = start.elapsed();
                        if elapsed > graceful_timeout {
                            eprintln!("[stop_server] timeout after {:?}, force killing", elapsed);
                            let _ = child.kill();
                            let _ = child.wait();
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    Err(e) => {
                        eprintln!("[stop_server] try_wait error: {}", e);
                        break;
                    }
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
pub async fn restart_server(
    state: &ServerManager,
    app_handle: Option<&tauri::AppHandle>,
) -> ServerResult {
    let config_path = {
        let guard = state.lock().unwrap();
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
                let mut guard = state.lock().unwrap();
                guard.restart_count += 1;
                guard.last_restart = Some(Instant::now());
            }

            // start again
            start_server(state, path, app_handle).await
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
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, ServerManager>,
    config_path: String,
) -> Result<ServerResult, String> {
    let path = PathBuf::from(config_path);
    let result = start_server(&state, path, Some(&app_handle)).await;
    if result.success {
        // push updated config to spume window
        let _ = push_config_to_spume(&app_handle);
    }
    Ok(result)
}

/// stop the server
#[tauri::command]
pub async fn server_stop(state: tauri::State<'_, ServerManager>) -> Result<ServerResult, String> {
    Ok(stop_server(&state).await)
}

/// restart the server
#[tauri::command]
pub async fn server_restart(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, ServerManager>,
) -> Result<ServerResult, String> {
    let result = restart_server(&state, Some(&app_handle)).await;
    if result.success {
        // push updated config to spume window
        let _ = push_config_to_spume(&app_handle);
    }
    Ok(result)
}

/// check if server is healthy
#[tauri::command]
pub async fn server_health_check(state: tauri::State<'_, ServerManager>) -> Result<bool, String> {
    let port = {
        let guard = state.lock().unwrap();
        guard.port
    };
    Ok(check_health(&format!("http://localhost:{}", port)).await)
}

/// get server logs
#[tauri::command]
pub async fn get_server_logs(
    state: tauri::State<'_, ServerManager>,
    max_lines: Option<usize>,
) -> Result<Vec<String>, String> {
    let guard = state.lock().unwrap();
    let max = max_lines.unwrap_or(100).min(MAX_LOG_LINES);
    let logs: Vec<String> = guard.logs.iter().rev().take(max).cloned().collect();
    Ok(logs.into_iter().rev().collect())
}
