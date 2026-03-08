//! shared server control logic for menu and tray
//!
//! centralizes start/stop/restart handling so both app menu and tray
//! can use the same code

use tauri::{AppHandle, Manager, Wry};

use crate::app_config::get_server_config_path_resolved;
use crate::sidecar::{self, ServerManager};
use crate::spume_bridge::{push_auth_refresh_to_spume, push_config_to_spume};
use crate::wizard::open_setup_wizard_at_route;

/// server control action
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerAction {
    Start,
    Stop,
    Restart,
}

/// execute a server control action
pub fn execute_server_action(app: &AppHandle<Wry>, action: ServerAction) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state: tauri::State<'_, ServerManager> = app.state();

        match action {
            ServerAction::Start => {
                let config_path = {
                    let guard = state.lock().unwrap();
                    guard
                        .config_path
                        .clone()
                        .or_else(|| get_server_config_path_resolved(&app))
                        .unwrap_or_default()
                };

                if config_path.exists() {
                    let result = sidecar::start_server(&state, config_path, Some(&app)).await;
                    if result.success {
                        // push updated config to spume window
                        let _ = push_config_to_spume(&app);
                        // give server a moment to be fully ready, then push fresh auth
                        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                        let _ = push_auth_refresh_to_spume(&app).await;
                    }
                }
            }
            ServerAction::Stop => {
                let _ = sidecar::stop_server(&state).await;
            }
            ServerAction::Restart => {
                let result = sidecar::restart_server(&state, Some(&app)).await;
                if result.success {
                    // push updated config to spume window
                    let _ = push_config_to_spume(&app);
                    // give server a moment to be fully ready, then push fresh auth
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                    let _ = push_auth_refresh_to_spume(&app).await;
                }
            }
        }
    });
}

/// quit the app (stop server first)
pub fn quit_app(app: &AppHandle<Wry>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state: tauri::State<'_, ServerManager> = app.state();
        let _ = sidecar::stop_server(&state).await;
        app.exit(0);
    });
}

/// open wizard window at a specific route
pub fn open_wizard_at_route(app: &AppHandle<Wry>, route: &str) {
    if let Some(window) = app.get_webview_window("setup-wizard") {
        // navigate to the route using proper URL
        #[cfg(debug_assertions)]
        let url: url::Url = format!("http://localhost:1421#{}", route).parse().unwrap();
        #[cfg(not(debug_assertions))]
        let url: url::Url = format!("tauri://localhost/wizard/index.html#{}", route)
            .parse()
            .unwrap();

        let _ = window.navigate(url);
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let _ = open_setup_wizard_at_route(app.clone(), route);
}
