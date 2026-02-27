//! setup wizard window management
//!
//! commands for opening/closing the setup wizard window

use tauri::webview::Color;
use tauri::{AppHandle, Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder, Wry};

#[cfg(not(debug_assertions))]
use std::path::PathBuf;

/// tauri command to open setup wizard at default route
#[tauri::command]
pub async fn open_setup_wizard(app: AppHandle<Wry>) -> Result<(), String> {
    open_setup_wizard_at_route(app, "/setup")
}

/// open setup wizard window at a specific route
pub fn open_setup_wizard_at_route(app: AppHandle<Wry>, route: &str) -> Result<(), String> {
    // build URL with hash route
    #[cfg(debug_assertions)]
    let url_str = format!("http://localhost:1421#{}", route);
    #[cfg(not(debug_assertions))]
    let url_str = format!("wizard/index.html#{}", route);

    // check if wizard is already open
    if let Some(window) = app.get_webview_window("setup-wizard") {
        // navigate to requested route and focus
        #[cfg(debug_assertions)]
        let url: url::Url = url_str.parse().unwrap();
        #[cfg(not(debug_assertions))]
        let url: url::Url = format!("tauri://localhost/{}", url_str).parse().unwrap();

        let _ = window.navigate(url);
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    // create new window with route in URL
    #[cfg(debug_assertions)]
    let wizard_url = WebviewUrl::External(url_str.parse().unwrap());
    #[cfg(not(debug_assertions))]
    let wizard_url = WebviewUrl::App(PathBuf::from(url_str));

    WebviewWindowBuilder::new(&app, "setup-wizard", wizard_url)
        .title("freqhole wizard")
        .inner_size(800.0, 600.0)
        .resizable(true)
        .center()
        .background_color(Color(0, 0, 0, 255))
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// tauri command to close setup wizard and open main window
#[tauri::command]
pub async fn close_setup_wizard(
    app: AppHandle<Wry>,
    api_key: Option<String>,
    config_path: Option<String>,
    _server_port: Option<u16>,
) -> Result<(), String> {
    // save api key to file for persistent storage (used by get_freqhole_config)
    if let Some(key) = &api_key {
        crate::commands::save_api_key(&app, key)?;
    }

    // start server if config path provided
    if let Some(path) = config_path {
        let state = app.state::<crate::sidecar::ServerManager>();
        crate::sidecar::start_server(&state, std::path::PathBuf::from(path)).await;
    }

    if let Some(wizard) = app.get_webview_window("setup-wizard") {
        wizard.close().map_err(|e| e.to_string())?;
    }

    // create main window if it doesn't exist
    if app.get_webview_window("main").is_none() {
        // inject config via initialization script (works in dev + release)
        let init_script = crate::spume_bridge::get_init_script(&app);

        #[cfg(debug_assertions)]
        let webview_url = WebviewUrl::External("http://localhost:1420".parse().unwrap());
        #[cfg(not(debug_assertions))]
        let webview_url = WebviewUrl::App(std::path::PathBuf::from("index.html"));

        let win_builder = WebviewWindowBuilder::new(&app, "main", webview_url)
            .title("")
            .inner_size(800.0, 600.0)
            .initialization_script(&init_script);

        #[cfg(target_os = "macos")]
        let win_builder = win_builder.title_bar_style(TitleBarStyle::Transparent);

        let window = win_builder.build().map_err(|e| e.to_string())?;

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
