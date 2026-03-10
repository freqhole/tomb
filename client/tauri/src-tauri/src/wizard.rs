//! setup wizard window management
//!
//! commands for opening/closing the setup wizard window

use std::path::PathBuf;
use tauri::webview::Color;
use tauri::{AppHandle, Manager, Theme, TitleBarStyle, WebviewUrl, WebviewWindowBuilder, Wry};

use crate::app_config::save_server_config_path;
use crate::commands::save_invite_code;
use crate::sidecar::{start_server, ServerManager};

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
        .theme(Some(Theme::Dark))
        .background_color(Color(0, 0, 0, 255))
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// tauri command to close setup wizard and open main window
#[tauri::command]
pub async fn close_setup_wizard(
    app: AppHandle<Wry>,
    invite_code: Option<String>,
    config_path: Option<String>,
    _server_port: Option<u16>,
) -> Result<(), String> {
    eprintln!(
        "[close_setup_wizard] called with invite_code={}, config_path={:?}",
        invite_code.is_some(),
        config_path
    );

    // save invite code to file for persistent storage (used by get_freqhole_config)
    if let Some(code) = &invite_code {
        eprintln!("[close_setup_wizard] saving invite code...");
        save_invite_code(&app, code)?;
    }

    // save config path to app config for later use
    if let Some(path) = &config_path {
        eprintln!("[close_setup_wizard] saving config path: {}", path);
        if let Err(e) = save_server_config_path(&app, path) {
            eprintln!(
                "[close_setup_wizard] failed to save server config path: {}",
                e
            );
        }
    }

    // start server if config path provided
    if let Some(ref path) = config_path {
        let state = app.state::<ServerManager>();
        start_server(&state, PathBuf::from(path), Some(&app)).await;
    }

    if let Some(wizard) = app.get_webview_window("setup-wizard") {
        wizard.close().map_err(|e| e.to_string())?;
    }

    // create main window if it doesn't exist
    if app.get_webview_window("main").is_none() {
        // spume will call getConfig on startup to get server config

        #[cfg(debug_assertions)]
        let webview_url = WebviewUrl::External("http://localhost:1420".parse().unwrap());
        #[cfg(not(debug_assertions))]
        let webview_url = WebviewUrl::App(PathBuf::from("index.html"));

        let win_builder = WebviewWindowBuilder::new(&app, "main", webview_url)
            .title("")
            .inner_size(800.0, 600.0)
            .theme(Some(Theme::Dark));

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
