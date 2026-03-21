//! shared server control logic for menu and tray
//!
//! centralizes quit and navigation handling

use tauri::{AppHandle, Manager, Wry};

use crate::wizard::open_setup_wizard_at_route;

/// quit the app (cleanup tray)
pub fn quit_app(app: &AppHandle<Wry>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // explicitly remove tray icon before exit (prevents panel crashes on linux)
        if let Some(tray) = app.tray_by_id("main") {
            // clear menu and icon before removal
            let _ = tray.set_menu(None::<tauri::menu::Menu<Wry>>);
            let _ = tray.set_visible(false);
        }

        // small delay for cleanup to propagate
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

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
