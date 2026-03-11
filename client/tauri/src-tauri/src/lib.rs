//! freqhole tauri app

mod app_config;
mod commands;
mod menu;
mod p2p_commands;
mod server_controls;
mod sidecar;
mod spume_bridge;
mod tray;
mod wizard;

use app_config::{get_server_config_path_resolved, is_setup_complete};
#[cfg(not(debug_assertions))]
use std::path::PathBuf;
use std::sync::Arc;
use tauri::webview::Color;
use tauri::{Manager, RunEvent, Theme, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};
use tokio_util::sync::CancellationToken;

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
    tauri::Builder::default()
        .manage(sidecar::new_server_manager())
        .manage(ShutdownToken::new())
        .setup(|app| {
            // check if setup wizard should run
            let needs_setup = !is_setup_complete(app.handle());

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

                let state = app.state::<sidecar::ServerManager>().inner().clone();
                let app_handle = app.handle().clone();
                let app_handle_for_server = app_handle.clone();
                let config_path_for_p2p = config_path.clone();
                let shutdown_token = app.state::<ShutdownToken>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    let result =
                        sidecar::start_server(&state, config_path, Some(&app_handle_for_server))
                            .await;
                    if !result.success {
                        eprintln!("[tauri] failed to start server: {}", result.message);
                    } else {
                        eprintln!("[tauri] server started successfully");

                        // initialize P2P client endpoint for outbound connections
                        // (runs in Tauri process, separate from server's endpoint)
                        if let Err(e) = p2p_commands::init_p2p_client(&config_path_for_p2p).await {
                            eprintln!("[tauri] failed to init P2P client: {}", e);
                        }

                        // server started - check for pending jobs and resume polling
                        commands::resume_pending_jobs_polling(app_handle, shutdown_token).await;
                    }
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

            // setup system tray (non-fatal on linux - may fail without appindicator)
            #[cfg(target_os = "linux")]
            if let Err(e) = tray::setup_tray(app.handle()) {
                eprintln!(
                    "warning: system tray setup failed (install libayatana-appindicator3-dev): {e}"
                );
            }
            #[cfg(not(target_os = "linux"))]
            tray::setup_tray(app.handle())?;

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
            commands::generate_auto_auth_invite,
            commands::deactivate_invite,
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
            commands::allow_peer,
            commands::list_peer_nodes,
            commands::remove_peer_node,
            sidecar::server_status,
            sidecar::server_start,
            sidecar::server_stop,
            sidecar::server_restart,
            sidecar::server_health_check,
            sidecar::get_server_logs,
            wizard::open_setup_wizard,
            wizard::close_setup_wizard,
            // P2P native transport commands
            p2p_commands::p2p_is_available,
            p2p_commands::p2p_get_node_id,
            p2p_commands::p2p_proxy_request,
            p2p_commands::p2p_fetch_blob,
            p2p_commands::p2p_upload_blob,
            p2p_commands::p2p_close_connection,
            p2p_commands::p2p_close_all_connections,
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
                eprintln!("[shutdown] poll tasks should be stopped");

                // stop server on app exit
                eprintln!("[shutdown] about to call stop_server...");
                let state = app.state::<sidecar::ServerManager>().inner().clone();
                tauri::async_runtime::block_on(async move {
                    eprintln!("[shutdown] inside block_on, calling stop_server");
                    let result = sidecar::stop_server(&state).await;
                    eprintln!("[shutdown] stop_server returned: {}", result.message);
                });
                eprintln!("[shutdown] cleanup complete");
            }
        });
}
