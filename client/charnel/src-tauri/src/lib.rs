//! freqhole tauri app

mod admin_commands;
mod app_config;
mod commands;
mod ephemeral_blob_commands;

#[cfg(desktop)]
mod menu;
mod p2p_commands;
mod p2p_state;
#[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
mod player_commands;
#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
mod player_commands {
    //! mobile fallback: rodio is desktop-only. these stubs satisfy the
    //! single `invoke_handler!` list so spume can call them on every
    //! target; on mobile they reply with a structured "unsupported"
    //! error and the frontend falls back to the html backend.
    use serde_json::Value;

    #[derive(Default)]
    pub struct PlayerState;
    impl PlayerState {
        pub fn new() -> Self {
            Self
        }
    }

    #[tauri::command]
    pub async fn player_send(_cmd: Value) -> Result<(), String> {
        Err("rodio backend is desktop-only".to_string())
    }

    #[tauri::command]
    pub async fn player_snapshot() -> Result<Value, String> {
        Err("rodio backend is desktop-only".to_string())
    }

    #[tauri::command]
    pub async fn player_init() -> Result<(), String> {
        Err("rodio backend is desktop-only".to_string())
    }

    #[tauri::command]
    pub async fn resolve_blob_path(_blob_id: String) -> Result<Value, String> {
        Err("rodio backend is desktop-only".to_string())
    }
}
mod jobs_events_commands;
mod radio_commands;
mod remotez_commands;
mod server_controls;
mod spume_bridge;
#[cfg(desktop)]
mod tray;
mod wizard;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use app_config::{get_server_config_path_resolved, is_setup_complete, FreqholeAppConfig};
use tauri::webview::Color;
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;
use tauri::{Emitter, Manager, RunEvent, Theme, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_deep_link::DeepLinkExt;
use tokio_util::sync::CancellationToken;

use p2p_state::P2pState;

/// pending deep-link URLs received before the main window's JS listeners were
/// ready. spume drains this on startup via the `take_pending_deep_links`
/// command. urls received after the window is up are emitted as
/// `freqhole:event` (type: "share-link-received"), so this only matters for
/// cold-start handoff (clicking a `freqhole://` link with the app closed).
#[derive(Default, Clone)]
pub struct PendingDeepLinks(pub Arc<Mutex<Vec<String>>>);

impl PendingDeepLinks {
    pub fn push(&self, url: String) {
        if let Ok(mut guard) = self.0.lock() {
            guard.push(url);
        }
    }

    pub fn drain(&self) -> Vec<String> {
        self.0
            .lock()
            .map(|mut g| std::mem::take(&mut *g))
            .unwrap_or_default()
    }
}

/// shutdown token for cancelling background tasks on app exit
#[derive(Clone)]
pub struct ShutdownToken(pub Arc<CancellationToken>);

impl Default for ShutdownToken {
    fn default() -> Self {
        Self::new()
    }
}

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
    let lines: Vec<String> = reader.lines().map_while(Result::ok).collect();

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
        // mobile (android) headless setup: charnel manages this remote
        // locally and surfaces it as the user's on-device library. give it
        // a friendlier default than "freqhole" so it's distinguishable
        // from any remote freqhole server they later add.
        server_name: "local library".to_string(),
        server_port: 8081,
        description: None,
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
        remote_admin_enabled: Some(false),
        radio_enabled: Some(false),
        fetch_music_enabled: Some(false),
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
    // android only: install rustls' ring crypto provider before anything
    // can construct a TLS client. wry's android WebViewClient.handleRequest
    // builds a reqwest client to fetch http(s) subresources, and rustls
    // 0.23 panics ("No provider set") if no default provider is installed,
    // which aborts the whole process. desktop targets are unaffected.
    #[cfg(target_os = "android")]
    {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }

    // desktop terminal-passthrough: if the binary was invoked with any
    // additional argv beyond the program name (e.g. `freqhole users list`,
    // `freqhole rathole`, `freqhole --help`) hand off to the cli library
    // and exit instead of bringing up the gui. this lets a single binary
    // serve as both gui app (no args) and full cli (any args) without
    // bundling a second executable. mobile targets never have argv so
    // skip this entirely.
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
    {
        let argc = std::env::args().count();
        // tauri itself sometimes injects flags on macos when launched
        // from finder (e.g. `-psn_<pid>`). filter those out so the gui
        // still launches when double-clicked from finder.
        let real_args: Vec<String> = std::env::args()
            .skip(1)
            .filter(|a| !a.starts_with("-psn_"))
            .collect();
        if argc > 1 && !real_args.is_empty() {
            let rt = match tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    eprintln!("failed to start tokio runtime for cli: {e}");
                    std::process::exit(1);
                }
            };
            let exit_code = match rt.block_on(cli::run()) {
                Ok(()) => 0,
                Err(e) => {
                    eprintln!("error: {e}");
                    1
                }
            };
            std::process::exit(exit_code);
        }
    }

    setup_tracing();

    let p2p_state = Arc::new(P2pState::new());

    let builder = tauri::Builder::default()
        .manage(ShutdownToken::new())
        .manage(p2p_state.clone())
        .manage(PendingDeepLinks::default());

    // rodio player state. on desktop this is the real supervised
    // controller-holder; on mobile it's a zero-sized stub so the
    // single invoke_handler list works on every target.
    let builder = builder.manage(player_commands::PlayerState::new());

    let builder = builder
        .setup(|app| {
            // ---- deep-link plugin -----------------------------------------
            // register `freqhole://` handler. on_open_url fires for runtime
            // url opens; cold-start urls are drained from the pending queue
            // by spume on startup. on linux/windows, runtime registration is
            // required so the os knows to dispatch the scheme to us.
            #[cfg(any(target_os = "linux", windows))]
            {
                if let Err(e) = app.deep_link().register("freqhole") {
                    tracing::warn!(error = %e, "failed to register freqhole:// scheme at runtime");
                }
            }
            // capture cold-start url, if any.
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                let pending = app.state::<PendingDeepLinks>().inner().clone();
                for url in urls {
                    tracing::info!(url = %url, "deep link cold start");
                    pending.push(url.to_string());
                }
            }
            // runtime url handler
            let url_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let pending = url_handle.state::<PendingDeepLinks>().inner().clone();
                for url in event.urls() {
                    let url_string = url.to_string();
                    tracing::info!(url = %url_string, "deep link received");
                    // always queue so a slow main-window startup still picks it up.
                    pending.push(url_string.clone());
                    // emit immediately too — the listener may already be live.
                    let payload = serde_json::json!({
                        "type": "share-link-received",
                        "data": { "url": url_string }
                    });
                    if let Err(e) = url_handle.emit("freqhole:event", payload) {
                        tracing::warn!(error = %e, "failed to emit deep link event");
                    }
                }
            });

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

            // on mobile, also silently upgrade the server config (freqhole-config.toml).
            // desktop still surfaces a toast so the user can review changes via the
            // wizard, but mobile has no wizard ui to act on it — just take the upgrade.
            #[cfg(mobile)]
            if !needs_setup {
                if let Some(server_config_path) = get_server_config_path_resolved(app.handle()) {
                    match grimoire::config::config_needs_upgrade(&server_config_path) {
                        Ok(true) => match grimoire::config::upgrade_config(&server_config_path) {
                            Ok(result) => {
                                tracing::info!(
                                    old_version = %result.old_version,
                                    new_version = %result.new_version,
                                    backup = %result.backup_path.display(),
                                    "silently upgraded server config (mobile)"
                                );
                            }
                            Err(e) => {
                                tracing::error!(error = %e, "failed to silently upgrade server config (mobile)");
                            }
                        },
                        Ok(false) => {}
                        Err(e) => {
                            tracing::warn!(error = %e, "failed to check server config upgrade status (mobile)");
                        }
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

                // (the embedded http loopback media server used to be
                // spawned here. it's been removed in favor of the rodio
                // backend, which bypasses html `<audio>` entirely on linux.
                // see `client/spume/src/music/services/audio/`.)

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
                // suppress unused variable warning on non-macOS
                let _ = &window;

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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_android_media_session::init());

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
            commands::take_pending_deep_links,
            commands::get_config_path,
            commands::get_data_dir,
            commands::get_freqhole_config,
            commands::get_client_config,
            commands::open_config_dir,
            commands::scan_directory,
            commands::rescan_directories,
            commands::get_federation_status,
            commands::federation_setup,
            commands::federation_sync,
            commands::federation_logout,
            commands::toggle_federation_enabled,
            commands::reload_config,
            // app config settings
            commands::get_sync_queue_to_local,
            commands::set_sync_queue_to_local,
            commands::get_rodio_playback,
            commands::set_rodio_playback,
            commands::check_config_needs_upgrade,
            commands::upgrade_config,
            // server config / image management
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
            // radio listener (freqhole-radio/1)
            radio_commands::radio_tune,
            radio_commands::radio_tune_local,
            radio_commands::radio_leave,
            // job events broker bridge (local in-process; remote path tbd)
            jobs_events_commands::jobs_events_snapshot,
            jobs_events_commands::jobs_events_subscribe,
            jobs_events_commands::jobs_events_unsubscribe,
            // P2P state control commands
            p2p_state::p2p_get_status,
            p2p_state::p2p_start,
            p2p_state::p2p_stop,
            p2p_state::p2p_restart,
            // shared remote registry (used by spume + wizard)
            remotez_commands::remotez_list,
            remotez_commands::remotez_get,
            remotez_commands::remotez_get_by_peer_addr,
            remotez_commands::remotez_upsert,
            remotez_commands::remotez_remove,
            remotez_commands::remotez_mark_active,
            // single dispatch entry-point for wizard / settings admin ops
            admin_commands::admin_dispatch,
            admin_commands::admin_dispatch_remote,
            // rust rodio player (desktop-real, mobile-stub)
            player_commands::player_send,
            player_commands::player_snapshot,
            player_commands::player_init,
            player_commands::resolve_blob_path,
            // ephemeral blob fetch + cleanup (sync_queue_to_local OFF path)
            ephemeral_blob_commands::fetch_ephemeral_blob,
            ephemeral_blob_commands::delete_ephemeral_blob,
            ephemeral_blob_commands::purge_ephemeral_dir,
            ephemeral_blob_commands::list_ephemeral_blobs,
            ephemeral_blob_commands::reconcile_ephemeral_dir,
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
