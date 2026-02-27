//! shared server control logic for menu and tray
//!
//! centralizes start/stop/restart handling so both app menu and tray
//! can use the same code

use tauri::{AppHandle, Manager, Wry};

use crate::sidecar::{self, ServerManager};

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
                        .or_else(|| {
                            app.path()
                                .app_data_dir()
                                .ok()
                                .map(|p| p.join("freqhole-config.toml"))
                        })
                        .unwrap_or_default()
                };

                if config_path.exists() {
                    let result = sidecar::start_server(&state, config_path).await;
                    if result.success {
                        // push updated config to spume window
                        let _ = crate::spume_bridge::push_config_to_spume(&app);
                    }
                }
            }
            ServerAction::Stop => {
                let _ = sidecar::stop_server(&state).await;
            }
            ServerAction::Restart => {
                let result = sidecar::restart_server(&state).await;
                if result.success {
                    // push updated config to spume window
                    let _ = crate::spume_bridge::push_config_to_spume(&app);
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
    let _ = crate::wizard::open_setup_wizard_at_route(app.clone(), route);
}
