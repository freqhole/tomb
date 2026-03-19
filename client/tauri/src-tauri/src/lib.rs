//! freqhole tauri app

mod app_config;
mod commands;
mod menu;
mod p2p_commands;
mod p2p_state;
mod server_controls;
mod spume_bridge;
mod tray;
mod wizard;

use std::sync::Arc;

use app_config::{get_server_config_path_resolved, is_setup_complete, FreqholeAppConfig};
#[cfg(not(debug_assertions))]
use std::path::PathBuf;
use tauri::webview::Color;
use tauri::{Emitter, Manager, RunEvent, Theme, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let p2p_state = Arc::new(P2pState::new());

    tauri::Builder::default()
        .manage(ShutdownToken::new())
        .manage(p2p_state.clone())
        .setup(|app| {
            // load app config
            let app_config = FreqholeAppConfig::load(app.handle()).unwrap_or_default();

            // check if setup wizard should run
            let needs_setup = !is_setup_complete(app.handle());

            // silently upgrade app config if needed (with backup)
            if !needs_setup && app_config::app_config_needs_upgrade(app.handle()) {
                match app_config::upgrade_app_config(app.handle()) {
                    Ok(result) => {
                        eprintln!(
                            "[tauri] silently upgraded app config: {} → {} (backup: {})",
                            result.old_version,
                            result.new_version,
                            result.backup_path.display()
                        );
                    }
                    Err(e) => {
                        eprintln!("[tauri] failed to upgrade app config: {}", e);
                    }
                }
            }

            if needs_setup {
                // setup wizard runs on port 1421 (tauri UI)
                // main app (spume) runs on port 1420
                #[cfg(debug_assertions)]
                let wizard_url = WebviewUrl::External("http://localhost:1421".parse().unwrap());
                #[cfg(not(debug_assertions))]
                let wizard_url = WebviewUrl::App(PathBuf::from("wizard/index.html"));

                let _wizard = WebviewWindowBuilder::new(app, "setup-wizard", wizard_url)
                    .title("freqhole setup")
                    .inner_size(800.0, 600.0)
                    .resizable(true)
                    .center()
                    .theme(Some(Theme::Dark))
                    .background_color(Color(0, 0, 0, 255))
                    .build()?;

                // wizard will start server when setup completes
            } else {
                // setup already complete - start server automatically
                // try to use saved config path from app config, fall back to default location
                eprintln!("[tauri] setup complete, starting server...");
                let config_path = get_server_config_path_resolved(app.handle())
                    .ok_or_else(|| "failed to determine config path".to_string())?;
                eprintln!("[tauri] config_path={}", config_path.display());

                // initialize grimoire config and run migrations before starting server
                grimoire::config::init_config(Some(config_path.clone()))
                    .map_err(|e| format!("failed to load config: {}", e))?;
                eprintln!("[tauri] running migrations...");
                tauri::async_runtime::block_on(async {
                    if let Err(e) = grimoire::database::run_migrations().await {
                        eprintln!("[tauri] migration warning: {}", e);
                    }
                });

                // spawn job runner in tauri process for tauri-local transport (api_call)
                // SQLite handles concurrent access safely.
                let job_runner_token = app.state::<ShutdownToken>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    eprintln!("[tauri] starting job runner...");
                    let result = grimoire::jobs::run_job_processor_with_token(
                        job_runner_token.0.as_ref().clone(),
                    )
                    .await;
                    if result.success {
                        eprintln!("[tauri] job runner stopped gracefully");
                    } else {
                        eprintln!("[tauri] job runner error: {}", result.message);
                    }
                });

                // spawn grimoire event listener for real-time UI updates
                let event_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let mut rx = grimoire::events::subscribe();
                    eprintln!("[tauri] grimoire event listener started");
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
                            eprintln!("[tauri] failed to emit freqhole event: {}", e);
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
                            eprintln!("[tauri] failed to init P2P client: {}", e);
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
                eprintln!("[tauri] creating main window...");
                let win_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                    .title("freqhole")
                    .inner_size(800.0, 600.0)
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
            }

            // setup system tray if enabled in config AND federation is enabled
            // (tray is purely for P2P controls, so only show if federation is on)
            let federation_enabled = grimoire::config::get_config()
                .federation
                .as_ref()
                .map(|f| f.enabled)
                .unwrap_or(false);

            if app_config.tray_enabled && federation_enabled {
                #[cfg(target_os = "linux")]
                if let Err(e) = tray::setup_tray(app.handle()) {
                    eprintln!(
                        "warning: system tray setup failed (install libayatana-appindicator3-dev): {e}"
                    );
                }
                #[cfg(not(target_os = "linux"))]
                tray::setup_tray(app.handle())?;
            }

            // setup application menu
            menu::setup_app_menu(app.handle())?;

            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_denylist(&["setup-wizard"])
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::check_setup_status,
            commands::check_dependencies,
            commands::get_setup_defaults,
            commands::run_setup_core,
            commands::create_admin_user,
            commands::get_default_data_dir,
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
            commands::check_config_needs_upgrade,
            commands::upgrade_config,
            // server config / image management
            commands::get_server_config,
            commands::get_server_image_thumbnail,
            commands::update_server_image,
            commands::update_server_info,
            // unified API dispatch (spike)
            commands::api_call,
            wizard::open_setup_wizard,
            wizard::close_setup_wizard,
            // P2P native transport commands
            p2p_commands::p2p_is_available,
            p2p_commands::p2p_get_node_id,
            p2p_commands::p2p_proxy_request,
            p2p_commands::p2p_fetch_blob,
            p2p_commands::p2p_fetch_hello_image,
            p2p_commands::p2p_upload_blob,
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
                eprintln!("[shutdown] RunEvent::Exit received");

                // cancel all background tasks first
                let shutdown_token = app.state::<ShutdownToken>().inner().clone();
                shutdown_token.cancel();
                eprintln!("[shutdown] shutdown token cancelled");

                // close all P2P client connections
                p2p_commands::p2p_close_all_connections();
                eprintln!("[shutdown] P2P connections closed");

                // brief pause to let poll tasks exit
                std::thread::sleep(std::time::Duration::from_millis(100));
                eprintln!("[shutdown] cleanup complete");
            }
        });
}
