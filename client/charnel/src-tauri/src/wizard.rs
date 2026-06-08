//! setup wizard window management
//!
//! commands for opening/closing the setup wizard window

use std::path::PathBuf;
use std::sync::Arc;

use tauri::webview::Color;
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;
use tauri::{AppHandle, Emitter, Manager, Theme, WebviewUrl, WebviewWindowBuilder, Wry};

#[cfg(not(desktop))]
use crate::app_config::save_server_config_path;
#[cfg(desktop)]
use crate::app_config::{save_server_config_path, FreqholeAppConfig};
use crate::commands;
use crate::p2p_state::P2pState;
use crate::ShutdownToken;
#[cfg(desktop)]
use crate::{menu, tray};

/// tauri command to open setup wizard at specified route (defaults to /setup)
#[tauri::command]
pub async fn open_setup_wizard(app: AppHandle<Wry>, route: Option<String>) -> Result<(), String> {
    let target_route = route.as_deref().unwrap_or("/setup");
    open_setup_wizard_at_route(app, target_route)
}

/// open setup wizard window at a specific route
pub fn open_setup_wizard_at_route(app: AppHandle<Wry>, route: &str) -> Result<(), String> {
    // build URL with hash route
    // on mobile, always use bundled assets (no dev server)
    #[cfg(all(debug_assertions, desktop))]
    let url_str = format!("http://localhost:1421#{}", route);
    #[cfg(not(all(debug_assertions, desktop)))]
    let url_str = format!("wizard/index.html#{}", route);

    // check if wizard is already open
    if let Some(window) = app.get_webview_window("setup-wizard") {
        // navigate to requested route and focus
        #[cfg(all(debug_assertions, desktop))]
        let url: url::Url = url_str.parse().unwrap();
        #[cfg(not(all(debug_assertions, desktop)))]
        let url: url::Url = format!("tauri://localhost/{}", url_str).parse().unwrap();

        let _ = window.navigate(url);
        #[cfg(desktop)]
        {
            let _ = window.show();
            let _ = window.set_focus();
        }
        return Ok(());
    }

    // create new window with route in URL
    #[cfg(all(debug_assertions, desktop))]
    let wizard_url = WebviewUrl::External(url_str.parse().unwrap());
    #[cfg(not(all(debug_assertions, desktop)))]
    let wizard_url = WebviewUrl::App(PathBuf::from(url_str));

    let win_builder = WebviewWindowBuilder::new(&app, "setup-wizard", wizard_url);
    #[cfg(desktop)]
    let win_builder = win_builder
        .resizable(true)
        .center()
        .inner_size(800.0, 600.0)
        .title("freqhole wizard")
        .theme(Some(Theme::Dark))
        .background_color(Color(0, 0, 0, 255));

    win_builder
        .build()
        .map_err(|e: tauri::Error| e.to_string())?;

    Ok(())
}

/// tauri command to close setup wizard and open main window
///
/// after setup completes, this function:
/// 1. saves the config path for persistence
/// 2. initializes grimoire config, database and runs migrations
/// 3. starts background job runner and event listener
/// 4. initializes P2P client if federation is enabled
/// 5. sets up system tray and app menu
/// 6. opens main window at specified route (defaults to /songs for post-setup)
#[tauri::command]
pub async fn close_setup_wizard(
    app: AppHandle<Wry>,
    config_path: Option<String>,
    route: Option<String>,
) -> Result<(), String> {
    tracing::info!(
        config_path = ?config_path,
        route = ?route,
        "close_setup_wizard called"
    );

    let config_path_buf = config_path.clone().map(PathBuf::from);

    // save config path to app config for later use
    if let Some(path) = &config_path {
        tracing::info!(path = %path, "saving config path");
        if let Err(e) = save_server_config_path(&app, path) {
            tracing::error!(error = %e, "failed to save server config path");
        }
    }

    // initialize grimoire config and database
    if let Some(ref config_path) = config_path_buf {
        tracing::info!("initializing grimoire config...");

        // init config from saved path
        if let Err(e) = grimoire::config::init_config(Some(config_path.clone())) {
            tracing::error!(error = %e, "failed to init config");
            return Err(format!("failed to init config: {}", e));
        }

        // run migrations
        tracing::info!("running database migrations...");
        if let Err(e) = grimoire::database::run_migrations().await {
            tracing::error!(error = %e, "failed to run migrations");
            return Err(format!("failed to run migrations: {}", e));
        }

        // start job runner (same as lib.rs)
        let job_runner_token = app.state::<ShutdownToken>().inner().clone();
        tracing::info!("starting job runner...");
        tauri::async_runtime::spawn(async move {
            let result =
                grimoire::jobs::run_job_processor_with_token(job_runner_token.0.as_ref().clone())
                    .await;
            if result.success {
                tracing::info!("job runner stopped gracefully");
            } else {
                tracing::error!(error = %result.message, "job runner error");
            }
        });

        // start event listener for frontend events (same as lib.rs)
        let event_handle = app.clone();
        tracing::info!("starting event listener...");
        tauri::async_runtime::spawn(async move {
            let mut rx = grimoire::events::subscribe();
            tracing::info!("grimoire event listener started");
            while let Ok(event) = rx.recv().await {
                let spume_event = match &event {
                    grimoire::events::GrimoireEvent::KnockCreated {
                        id,
                        username,
                        node_id,
                        message,
                    } => {
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
                    grimoire::events::GrimoireEvent::KnockProcessed {
                        id,
                        status,
                        username,
                    } => {
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
                if let Err(e) = event_handle.emit("freqhole:event", spume_event) {
                    tracing::error!(error = %e, "failed to emit freqhole event");
                }
            }
        });

        // check federation config to decide whether to init P2P
        let grimoire_config = grimoire::config::get_config();
        let federation_enabled = grimoire_config
            .federation
            .as_ref()
            .map(|f| f.enabled)
            .unwrap_or(false);

        if federation_enabled {
            let p2p_state = app.state::<Arc<P2pState>>().inner().clone();
            p2p_state.set_config_path(config_path.clone());

            tracing::info!("starting P2P client...");
            tauri::async_runtime::spawn(async move {
                if let Err(e) = p2p_state.start().await {
                    tracing::error!(error = %e, "failed to init P2P client");
                }
            });

            // start status watcher for tray/menu updates
            P2pState::start_status_watcher(app.state::<Arc<P2pState>>().inner().clone());

            // setup tray if enabled
            #[cfg(desktop)]
            {
                let app_config = FreqholeAppConfig::load(&app).unwrap_or_default();
                if app_config.tray_enabled {
                    #[cfg(target_os = "linux")]
                    if let Err(e) = tray::setup_tray(&app) {
                        tracing::warn!(
                            error = %e,
                            "tray setup failed (install libayatana-appindicator3-dev)"
                        );
                    }
                    #[cfg(not(target_os = "linux"))]
                    if let Err(e) = tray::setup_tray(&app) {
                        tracing::warn!(error = %e, "tray setup failed");
                    }
                }
            }
        }

        // resume pending jobs polling
        let app_for_polling = app.clone();
        let shutdown_token_for_polling = app.state::<ShutdownToken>().inner().clone();
        tauri::async_runtime::spawn(async move {
            commands::resume_pending_jobs_polling(app_for_polling, shutdown_token_for_polling)
                .await;
        });

        // setup application menu (always, regardless of federation)
        #[cfg(desktop)]
        if let Err(e) = menu::setup_app_menu(&app) {
            tracing::warn!(error = %e, "menu setup failed");
        }
    }

    // close wizard window
    if let Some(wizard) = app.get_webview_window("setup-wizard") {
        #[cfg(desktop)]
        wizard.close().map_err(|e| e.to_string())?;
    }

    // default to /songs route for post-setup (first-time experience)
    let target_route = route.unwrap_or_else(|| "/songs".to_string());

    // create main window if it doesn't exist
    if app.get_webview_window("main").is_none() {
        tracing::info!(route = %target_route, "creating main window");

        #[cfg(all(debug_assertions, desktop))]
        let url_str = format!("http://localhost:1420#{}", target_route);
        #[cfg(not(all(debug_assertions, desktop)))]
        let url_str = format!("index.html#{}", target_route);

        #[cfg(all(debug_assertions, desktop))]
        let webview_url = WebviewUrl::External(url_str.parse().unwrap());
        #[cfg(not(all(debug_assertions, desktop)))]
        let webview_url = WebviewUrl::App(PathBuf::from(url_str));

        let win_builder = WebviewWindowBuilder::new(&app, "main", webview_url);
        #[cfg(desktop)]
        let win_builder = win_builder
            .inner_size(800.0, 600.0)
            .title("")
            .theme(Some(Theme::Dark));

        #[cfg(target_os = "macos")]
        let win_builder = win_builder.title_bar_style(TitleBarStyle::Transparent);

        let window = win_builder
            .build()
            .map_err(|e: tauri::Error| e.to_string())?;
        // suppress unused variable warning on non-macOS
        let _ = &window;

        #[cfg(target_os = "macos")]
        #[allow(deprecated)]
        {
            use cocoa::appkit::{NSColor, NSWindow};
            use cocoa::base::{id, nil};

            let ns_window = window.ns_window().unwrap() as id;
            unsafe {
                let bg_color = NSColor::colorWithRed_green_blue_alpha_(nil, 0.0, 0.0, 0.0, 1.0);
                ns_window.setBackgroundColor_(bg_color);
            }
        }
    }

    Ok(())
}
