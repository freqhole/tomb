//! skein canvas window management
//!
//! provides functions to create/show/focus the skein canvas window
//! and helpers to show/focus the main (spume) music player window.

use tauri::webview::Color;
use tauri::{AppHandle, Manager, Theme, WebviewUrl, WebviewWindowBuilder, Wry};

/// skein window label
pub const SKEIN_WINDOW_LABEL: &str = "skein";

/// show the skein canvas window (create if needed, focus if already open)
pub fn show_skein_window(app: &AppHandle<Wry>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(SKEIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    #[cfg(debug_assertions)]
    let skein_url = WebviewUrl::External("http://localhost:1422/skein.html".parse().unwrap());
    #[cfg(not(debug_assertions))]
    let skein_url = WebviewUrl::App(std::path::PathBuf::from("skein/skein.html"));

    WebviewWindowBuilder::new(app, SKEIN_WINDOW_LABEL, skein_url)
        .title("skein")
        .inner_size(1024.0, 768.0)
        .resizable(true)
        .center()
        .theme(Some(Theme::Dark))
        .background_color(Color(0, 0, 0, 255))
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// show the main (spume) music player window (focus if exists)
pub fn show_main_window(app: &AppHandle<Wry>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    Err("main window not found".to_string())
}
