//! freqhole tauri app

mod app_config;
mod commands;
#[cfg(desktop)]
mod menu;
mod p2p_commands;
mod p2p_state;
mod server_controls;
mod spume_bridge;
#[cfg(desktop)]
mod tray;
mod wizard;

use std::path::PathBuf;
use std::sync::Arc;

use app_config::{get_server_config_path_resolved, is_setup_complete, FreqholeAppConfig};
use tauri::webview::Color;
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;
use tauri::{Emitter, Manager, RunEvent, Theme, WebviewUrl, WebviewWindowBuilder};
use tokio_util::sync::CancellationToken;

use p2p_state::P2pState;

/// shutdown token for cancelling background tasks on app exit
#[derive(Clone)]
pub struct ShutdownToken(pub Arc<CancellationToken>);

impl ShutdownToken {
    pub fn new() -> Self {
        Self(Arc::new(CancellationToken::new()))
    }

    pub fn cancel(&self) {
        self.0.cancel();
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.is_cancelled()
    }

    pub async fn cancelled(&self) {
        self.0.cancelled().await
    }
}

/// app identifier for computing data directory
const APP_IDENTIFIER: &str = "net.freqhole.charnel";
/// default log file name
const DEFAULT_LOG_FILE: &str = "charnel.log";
/// max log lines before truncation
const DEFAULT_MAX_LOG_LINES: usize = 10000;

/// get the app data directory path (without needing an AppHandle)
/// this is needed because tracing setup happens before tauri::Builder is run
fn get_app_data_dir() -> Option<PathBuf> {
    #[cfg(target_os = "android")]
    {
        // on android, use the app's internal data directory via environment
        // tauri sets this up; fall back to a reasonable default
        std::env::var_os("HOME")
            .or_else(|| std::env::var_os("TMPDIR"))
            .map(|h| PathBuf::from(h).join(APP_IDENTIFIER))
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| {
            PathBuf::from(h)
                .join("Library/Application Support")
                .join(APP_IDENTIFIER)
        })
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
            .map(|p| p.join(APP_IDENTIFIER))
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join(APP_IDENTIFIER))
    }
}

/// truncate log file if it exceeds max_lines (keeps the newest lines)
fn truncate_log_file_if_needed(path: &std::path::Path, max_lines: usize) {
    use std::io::{BufRead, BufReader, Write};

    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return,
    };

    let reader = BufReader::new(file);
    let lines: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();

    if lines.len() <= max_lines {
        return;
    }

    let keep_from = lines.len() - max_lines;
    let truncated: Vec<&str> = lines[keep_from..].iter().map(|s| s.as_str()).collect();

    if let Ok(mut file) = std::fs::File::create(path) {
        for line in truncated {
            let _ = writeln!(file, "{}", line);
        }
    }
}

/// set up tracing with file output
fn setup_tracing() {
    use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

    let filter = tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        tracing_subscriber::EnvFilter::new(
            "charnel=info,grimoire=info,iroh=error,iroh_relay=error,iroh_quinn=error",
        )
    });

    // try to set up file logging
    if let Some(app_dir) = get_app_data_dir() {
        // ensure app data dir exists
        let _ = std::fs::create_dir_all(&app_dir);

        let log_path = app_dir.join(DEFAULT_LOG_FILE);

        // truncate if too large
        truncate_log_file_if_needed(&log_path, DEFAULT_MAX_LOG_LINES);

        // open log file
        let file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path);

        if let Ok(file) = file {
            // both file and stdout logging
            let file_layer = tracing_subscriber::fmt::layer()
                .with_writer(std::sync::Mutex::new(file))
                .with_ansi(false);

            let stdout_layer = tracing_subscriber::fmt::layer();

            tracing_subscriber::registry()
                .with(filter)
                .with(file_layer)
                .with(stdout_layer)
                .init();

            return;
        }
    }

    // fallback: stdout only
    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer())
        .init();
}

/// on mobile, run the same setup wizard logic headlessly with sensible defaults.
/// uses SetupService::run_setup which handles: directories, config, database creation,
/// migrations, wordlist, and root user — the same path the desktop wizard takes.
#[cfg(mobile)]
fn mobile_auto_init(app_handle: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let app_data_dir = app_handle.path().app_data_dir()?;
    let data_dir = app_data_dir.join("data");
    let config_path = app_data_dir.join("freqhole-config.toml");

    tracing::info!(
        config_path = %config_path.display(),
        data_dir = %data_dir.display(),
        "starting mobile auto-init (headless wizard)"
    );

    // run the same setup service the desktop wizard uses
    let setup_config = grimoire::setup::SetupConfig {
        config_path: config_path.clone(),
        data_dir: data_dir.clone(),
        server_name: "freqhole".to_string(),
        server_port: 8081,
        image_path: None,
        admin_username: None,
        generate_api_key: false,
        generate_invite_code: false,
        ytdlp_available: false,
        fetch_music_dir: None,
        initial_scan_dirs: Vec::new(),
        allowed_origins: Some(vec!["tauri://localhost".to_string()]),
        ffmpeg_path: None,
        ffprobe_path: None,
        ytdlp_path: None,
        server_enabled: Some(false),
        federation_enabled: Some(true),
        knocking_enabled: Some(false),
    };

    let service = grimoire::setup::SetupService::new();
    let result = tauri::async_runtime::block_on(service.run_setup(setup_config));

    if result.success {
        tracing::info!(
            config_path = %result.config_path,
            data_dir = %result.data_dir,
            root_user = ?result.root_username,
            errors = ?result.errors,
            "mobile auto-init setup complete"
        );

        // create a default admin user for mobile
        let user_service = grimoire::users::UserService::new();
        let admin_request = grimoire::users::CreateUserRequest {
            username: "admin".to_string(),
            role: Some(grimoire::users::UserRole::Admin),
            invite_code: None,
        };
        match tauri::async_runtime::block_on(user_service.register_user(&admin_request)).data {
            Some(user) => {
                if let Err(e) = app_config::save_admin_user(app_handle, &user.id, &user.username) {
                    tracing::warn!(error = %e, "failed to save admin user to app config");
                }
                tracing::info!(username = %user.username, user_id = %user.id, "created mobile admin user");
            }
            None => {
                tracing::warn!("failed to create mobile admin user");
            }
        }
    } else {
        let err_msg = result.errors.join("; ");
        tracing::error!(errors = %err_msg, "mobile auto-init setup failed");
        return Err(err_msg.into());
    }

    // save config path to charnel-config.toml so is_setup_complete returns true
    app_config::save_server_config_path(app_handle, &config_path.display().to_string())
        .map_err(|e| format!("failed to save server config path: {}", e))?;

    // generate iroh keypair for P2P identity
    match grimoire::federation::load_or_generate_keypair() {
        Ok(secret_key) => {
            let node_id = secret_key.public();
            tracing::info!(%node_id, "iroh keypair ready");
        }
        Err(e) => {
            tracing::warn!(error = %e, "failed to generate iroh keypair (non-fatal)");
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    setup_tracing();

    let p2p_state = Arc::new(P2pState::new());

    let builder = tauri::Builder::default()
        .manage(ShutdownToken::new())
        .manage(p2p_state.clone())
        .setup(|app| {
            // load app config
            let app_config = FreqholeAppConfig::load(app.handle()).unwrap_or_default();

            // on mobile, auto-initialize if needed (skip wizard entirely)
            #[cfg(mobile)]
            if !is_setup_complete(app.handle()) {
                if let Err(e) = mobile_auto_init(app.handle()) {
                    tracing::error!(error = %e, "mobile auto-init failed");
                    // still continue — the else branch will fail gracefully
                }
            }

            // on mobile, wizard is never shown (auto-init handles setup)
            #[cfg(desktop)]
            let needs_setup = !is_setup_complete(app.handle());
            #[cfg(mobile)]
            let needs_setup = false;

            // silently upgrade app config if needed (with backup)
            if !needs_setup && app_config::app_config_needs_upgrade(app.handle()) {
                match app_config::upgrade_app_config(app.handle()) {
                    Ok(result) => {
                        tracing::info!(
                            old_version = %result.old_version,
                            new_version = %result.new_version,
                            backup = %result.backup_path.display(),
                            "silently upgraded app config"
                        );
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "failed to upgrade app config");
                    }
                }
            }

            if needs_setup {
                // setup wizard runs on port 1421 (tauri UI)
                // main app (spume) runs on port 1420
                // on mobile, always use bundled assets (no dev server)
                #[cfg(all(debug_assertions, desktop))]
                let wizard_url = WebviewUrl::External("http://localhost:1421".parse().unwrap());
                #[cfg(not(all(debug_assertions, desktop)))]
                let wizard_url = WebviewUrl::App(PathBuf::from("wizard/index.html"));

                let wizard_builder = WebviewWindowBuilder::new(app, "setup-wizard", wizard_url);
                #[cfg(desktop)]
                let wizard_builder = wizard_builder
                    .resizable(true)
                    .center()
                    .inner_size(800.0, 600.0)
                    .title("freqhole setup")
                    .theme(Some(Theme::Dark))
                    .background_color(Color(0, 0, 0, 255));
                let _wizard = wizard_builder.build()?;

                // wizard will start server when setup completes
            } else {
                // setup already complete - start server automatically
                // try to use saved config path from app config, fall back to default location
                tracing::info!("setup complete, starting server...");
                let config_path = get_server_config_path_resolved(app.handle())
                    .ok_or_else(|| "failed to determine config path".to_string())?;
                tracing::info!(config_path = %config_path.display(), "loaded config");

                // initialize grimoire config and run migrations before starting server
                grimoire::config::init_config(Some(config_path.clone()))
                    .map_err(|e| format!("failed to load config: {}", e))?;
                tracing::info!("running migrations...");
                tauri::async_runtime::block_on(async {
                    if let Err(e) = grimoire::database::run_migrations().await {
                        tracing::warn!(error = %e, "migration warning");
                    }
                });

                // spawn job runner in tauri process for tauri-local transport (api_call)
                // SQLite handles concurrent access safely.
                let job_runner_token = app.state::<ShutdownToken>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    tracing::info!("starting job runner...");
                    let result = grimoire::jobs::run_job_processor_with_token(
                        job_runner_token.0.as_ref().clone(),
                    )
                    .await;
                    if result.success {
                        tracing::info!("job runner stopped gracefully");
                    } else {
                        tracing::error!(error = %result.message, "job runner error");
                    }
                });

                // spawn grimoire event listener for real-time UI updates
                let event_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let mut rx = grimoire::events::subscribe();
                    tracing::info!("grimoire event listener started");
                    while let Ok(event) = rx.recv().await {
                        // transform grimoire event to spume's expected format
                        let spume_event = match &event {
                            grimoire::events::GrimoireEvent::KnockCreated { id, username, node_id, message } => {
                                serde_json::json!({
                                    "type": "knock-created",
                                    "data": {
                                        "id": id,
                                        "username": username,
                                        "node_id": node_id,
                                        "message": if message.is_empty() { None } else { Some(message) }
                                    }
                                })
                            }
                            grimoire::events::GrimoireEvent::KnockProcessed { id, status, username } => {
                                serde_json::json!({
                                    "type": "knock-processed",
                                    "data": {
                                        "id": id,
                                        "status": status,
                                        "username": username
                                    }
                                })
                            }
                            grimoire::events::GrimoireEvent::JobProgress { session_id, directory, songs_added, jobs_pending, jobs_total } => {
                                serde_json::json!({
                                    "type": "job-progress",
                                    "data": {
                                        "session_id": session_id,
                                        "directory": directory,
                                        "songs_added": songs_added,
                                        "jobs_pending": jobs_pending,
                                        "jobs_total": jobs_total
                                    }
                                })
                            }
                            grimoire::events::GrimoireEvent::JobSessionComplete { session_id, songs_added, albums_added, artists_added } => {
                                serde_json::json!({
                                    "type": "job-session-complete",
                                    "data": {
                                        "session_id": session_id,
                                        "songs_added": songs_added,
                                        "albums_added": albums_added,
                                        "artists_added": artists_added
                                    }
                                })
                            }
                        };
                        // emit to frontend as tauri event (matching spume's event channel)
                        if let Err(e) = event_handle.emit("freqhole:event", spume_event) {
                            tracing::error!(error = %e, "failed to emit freqhole event");
                        }
                    }
                });

                // check federation config to decide whether to init P2P
                let federation_enabled_for_p2p = grimoire::config::get_config()
                    .federation
                    .as_ref()
                    .map(|f| f.enabled)
                    .unwrap_or(false);

                // initialize P2P client endpoint for outbound connections (only if federation enabled)
                let app_handle = app.handle().clone();
                let shutdown_token = app.state::<ShutdownToken>().inner().clone();

                if federation_enabled_for_p2p {
                    let config_path_for_p2p = config_path.clone();
                    let p2p_state_clone = app.state::<Arc<P2pState>>().inner().clone();
                    p2p_state_clone.set_config_path(config_path_for_p2p.clone());

                    tauri::async_runtime::spawn(async move {
                        // start P2P endpoint via state manager
                        if let Err(e) = p2p_state_clone.start().await {
                            tracing::error!(error = %e, "failed to init P2P client");
                        }
                    });

                    // start status watcher for tray/menu updates
                    P2pState::start_status_watcher(app.state::<Arc<P2pState>>().inner().clone());
                }

                // check for pending jobs and resume polling (always, regardless of federation)
                tauri::async_runtime::spawn(async move {
                    commands::resume_pending_jobs_polling(app_handle, shutdown_token).await;
                });

                // show main window (spume will call getConfig on startup)
                tracing::info!("creating main window...");
                let win_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default());
                #[cfg(desktop)]
                let win_builder = win_builder
                    .inner_size(800.0, 600.0)
                    .title("freqhole")
                    .theme(Some(Theme::Dark))
                    .background_color(Color(0, 0, 0, 255));

                #[cfg(target_os = "macos")]
                let win_builder = win_builder.title_bar_style(TitleBarStyle::Transparent);

                let window = win_builder.build()?;

                // set background color only when building for macOS
                #[cfg(target_os = "macos")]
                #[allow(deprecated)]
                {
                    use cocoa::appkit::{NSColor, NSWindow};
                    use cocoa::base::{id, nil};

                    let ns_window = window.ns_window().unwrap() as id;
                    unsafe {
                        let bg_color =
                            NSColor::colorWithRed_green_blue_alpha_(nil, 0.0, 0.0, 0.0, 1.0);
                        ns_window.setBackgroundColor_(bg_color);
                    }
                }

                // setup system tray if enabled in config AND federation is enabled
                // (tray is purely for P2P controls, so only show if federation is on)
                let federation_enabled = grimoire::config::get_config()
                    .federation
                    .as_ref()
                    .map(|f| f.enabled)
                    .unwrap_or(false);

                #[cfg(desktop)]
                {
                    if app_config.tray_enabled && federation_enabled {
                        #[cfg(target_os = "linux")]
                        if let Err(e) = tray::setup_tray(app.handle()) {
                            tracing::warn!(
                                error = %e,
                                "system tray setup failed (install libayatana-appindicator3-dev)"
                            );
                        }
                        #[cfg(not(target_os = "linux"))]
                        tray::setup_tray(app.handle())?;
                    }

                    // setup application menu
                    menu::setup_app_menu(app.handle())?;
                }
            }

            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::new()
            .with_denylist(&["setup-wizard"])
            .build(),
    );

    builder
        .invoke_handler(tauri::generate_handler![
            commands::check_setup_status,
            commands::check_dependencies,
            commands::get_setup_defaults,
            commands::run_setup_core,
            commands::create_admin_user,
            commands::get_default_data_dir,
            commands::resolve_path,
            commands::get_os_username,
            commands::get_app_version,
            commands::get_config_path,
            commands::get_data_dir,
            commands::get_freqhole_config,
            commands::open_config_dir,
            commands::read_config_file,
            commands::save_config_file,
            commands::list_users,
            commands::update_user_role,
            commands::delete_user,
            commands::list_invites,
            commands::generate_invites,
            commands::generate_account_link_code,
            commands::deactivate_invite,
            commands::deactivate_all_invites,
            commands::update_invite_role,
            commands::scan_directory,
            commands::rescan_directories,
            commands::list_scanned_directories,
            commands::remove_scanned_directory,
            commands::get_federation_status,
            commands::federation_setup,
            commands::federation_sync,
            commands::federation_logout,
            commands::toggle_federation_enabled,
            commands::reload_config,
            commands::allow_peer,
            commands::list_peer_nodes,
            commands::remove_peer_node,
            commands::list_knocks,
            commands::accept_knock,
            commands::reject_knock,
            commands::delete_knock,
            commands::reject_all_knocks,
            // app config settings
            commands::get_sync_queue_to_local,
            commands::set_sync_queue_to_local,
            commands::check_config_needs_upgrade,
            commands::upgrade_config,
            // server config / image management
            commands::get_server_config,
            commands::get_server_image_thumbnail,
            commands::update_server_image,
            commands::update_server_info,
            // log management
            commands::read_logs,
            commands::get_log_file_path,
            // unified API dispatch (spike)
            commands::api_call,
            wizard::open_setup_wizard,
            wizard::close_setup_wizard,
            // P2P native transport commands
            p2p_commands::p2p_is_available,
            p2p_commands::p2p_get_node_id,
            p2p_commands::p2p_proxy_request,
            p2p_commands::p2p_fetch_blob_verified,
            p2p_commands::p2p_fetch_blob_verified_by_id,
            p2p_commands::p2p_probe_blob,
            p2p_commands::p2p_fetch_hello_image,
            p2p_commands::p2p_import_blob,
            p2p_commands::p2p_import_blob_bytes,
            p2p_commands::p2p_close_connection,
            p2p_commands::p2p_close_all_connections,
            // P2P state control commands
            p2p_state::p2p_get_status,
            p2p_state::p2p_start,
            p2p_state::p2p_stop,
            p2p_state::p2p_restart,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                tracing::info!("shutdown: RunEvent::Exit received");

                // cancel all background tasks first
                let shutdown_token = app.state::<ShutdownToken>().inner().clone();
                shutdown_token.cancel();
                tracing::info!("shutdown: token cancelled");

                // close all P2P client connections
                p2p_commands::p2p_close_all_connections();
                tracing::info!("shutdown: P2P connections closed");

                // brief pause to let poll tasks exit
                std::thread::sleep(std::time::Duration::from_millis(100));
                tracing::info!("shutdown: cleanup complete");
            }
        });
}
