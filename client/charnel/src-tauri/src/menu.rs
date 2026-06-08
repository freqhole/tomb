//! application menu for freqhole
//!
//! provides the standard macOS application menu with:
//! - about freqhole
//! - P2P endpoint controls (start/stop/restart)
//! - open config directory
//! - preferences
//! - quit

use std::sync::Arc;

use tauri::menu::{Menu, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Manager, Wry};

use crate::commands::open_config_dir;
use crate::p2p_state::{P2pState, P2pStatus};
use crate::server_controls::{open_wizard_at_route, quit_app};

/// menu item IDs
const MENU_ABOUT: &str = "about";
const MENU_CHECK_UPDATES: &str = "check_updates";
const MENU_P2P_STATUS: &str = "p2p_status";
const MENU_P2P_START: &str = "p2p_start";
const MENU_P2P_STOP: &str = "p2p_stop";
const MENU_P2P_RESTART: &str = "p2p_restart";
const MENU_OPEN_CONFIG: &str = "open_config";
const MENU_LOGS: &str = "logs";
const MENU_LIBRARY: &str = "library";
const MENU_USERS: &str = "users";
const MENU_RADIO: &str = "radio";
const MENU_FEDERATION: &str = "federation";
const MENU_SETTINGS: &str = "settings";
const MENU_CONFIG: &str = "config";
const MENU_DEVTOOLS: &str = "devtools";
const MENU_QUIT: &str = "quit";

/// create and set application menu
pub fn setup_app_menu(app: &AppHandle<Wry>) -> tauri::Result<()> {
    build_and_set_menu(app)?;

    // handle menu events
    app.on_menu_event(move |app_handle, event| {
        handle_menu_event(app_handle, event.id.as_ref());
    });

    // start status watcher to update menu on P2P status changes (only if federation enabled)
    start_p2p_status_watcher(app);

    Ok(())
}

/// start watching P2P status to update menu (only if federation enabled)
fn start_p2p_status_watcher(app: &AppHandle<Wry>) {
    if is_federation_enabled() {
        let app_handle = app.clone();
        let state_clone = app.state::<Arc<P2pState>>().inner().clone();
        tauri::async_runtime::spawn(async move {
            let mut rx = state_clone.subscribe();
            loop {
                if rx.changed().await.is_err() {
                    break;
                }
                let status = *rx.borrow();
                update_menu_for_status(&app_handle, status);
            }
        });
    }
}

/// rebuild and set the app menu (call when federation config changes)
pub fn refresh_app_menu(app: &AppHandle<Wry>) {
    if let Err(e) = build_and_set_menu(app) {
        tracing::error!(error = %e, "failed to refresh menu");
    }
    // restart status watcher if federation is now enabled
    start_p2p_status_watcher(app);
}

/// internal: build all menus and set on app
fn build_and_set_menu(app: &AppHandle<Wry>) -> tauri::Result<()> {
    // build app submenu
    let app_submenu = build_app_submenu(app)?;

    // build view submenu
    let logs_item = MenuItemBuilder::with_id(MENU_LOGS, "logs").build(app)?;
    let library_item = MenuItemBuilder::with_id(MENU_LIBRARY, "library").build(app)?;
    let users_item = MenuItemBuilder::with_id(MENU_USERS, "users").build(app)?;
    let radio_item = MenuItemBuilder::with_id(MENU_RADIO, "radio").build(app)?;
    let federation_item = MenuItemBuilder::with_id(MENU_FEDERATION, "federation").build(app)?;
    let settings_item = MenuItemBuilder::with_id(MENU_SETTINGS, "settings")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let config_item = MenuItemBuilder::with_id(MENU_CONFIG, "config").build(app)?;
    let devtools_item = MenuItemBuilder::with_id(MENU_DEVTOOLS, "developer tools")
        .accelerator("CmdOrCtrl+Shift+I")
        .build(app)?;

    let view_submenu = SubmenuBuilder::with_id(app, "view", "view")
        .item(&logs_item)
        .item(&library_item)
        .item(&users_item)
        .item(&radio_item)
        .item(&federation_item)
        .item(&settings_item)
        .item(&config_item)
        .separator()
        .item(&devtools_item)
        .build()?;

    // build Edit submenu with standard keyboard shortcuts
    let edit_submenu = SubmenuBuilder::with_id(app, "edit", "edit")
        .item(&PredefinedMenuItem::undo(app, Some("undo"))?)
        .item(&PredefinedMenuItem::redo(app, Some("redo"))?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some("cut"))?)
        .item(&PredefinedMenuItem::copy(app, Some("copy"))?)
        .item(&PredefinedMenuItem::paste(app, Some("paste"))?)
        .item(&PredefinedMenuItem::select_all(app, Some("select all"))?)
        .build()?;

    // build menu bar
    let menu = Menu::with_items(app, &[&app_submenu, &edit_submenu, &view_submenu])?;

    // set as app menu
    app.set_menu(menu)?;

    Ok(())
}

/// update app menu P2P items for new status
fn update_menu_for_status(app: &AppHandle<Wry>, status: P2pStatus) {
    // get the app menu, then the freqhole submenu
    let Some(menu) = app.menu() else {
        return;
    };

    let Some(freqhole_item) = menu.get("freqhole") else {
        return;
    };

    let Some(freqhole_submenu) = freqhole_item.as_submenu() else {
        return;
    };

    // update the status menu item text
    if let Some(item) = freqhole_submenu.get(MENU_P2P_STATUS) {
        if let Some(menu_item) = item.as_menuitem() {
            let _ = menu_item.set_text(format!("P2P: {}", status.as_str()));
        }
    }

    // update enabled state of start/stop/restart items
    // only disable during brief Starting phase, not during Connecting
    let can_start = status == P2pStatus::Stopped || status == P2pStatus::Offline;
    let can_stop = status != P2pStatus::Stopped && status != P2pStatus::Starting;

    if let Some(item) = freqhole_submenu.get(MENU_P2P_START) {
        if let Some(menu_item) = item.as_menuitem() {
            let _ = menu_item.set_enabled(can_start);
        }
    }
    if let Some(item) = freqhole_submenu.get(MENU_P2P_STOP) {
        if let Some(menu_item) = item.as_menuitem() {
            let _ = menu_item.set_enabled(can_stop);
        }
    }
    if let Some(item) = freqhole_submenu.get(MENU_P2P_RESTART) {
        if let Some(menu_item) = item.as_menuitem() {
            let _ = menu_item.set_enabled(can_stop);
        }
    }
}

/// check if federation is enabled in grimoire config
fn is_federation_enabled() -> bool {
    if !grimoire::is_config_initialized() {
        return false;
    }
    grimoire::config::get_config()
        .federation
        .as_ref()
        .map(|f| f.enabled)
        .unwrap_or(false)
}

/// build the freqhole app submenu
fn build_app_submenu(app: &AppHandle<Wry>) -> tauri::Result<Submenu<Wry>> {
    let about_item = MenuItemBuilder::with_id(MENU_ABOUT, "about freqhole").build(app)?;

    let check_updates_item =
        MenuItemBuilder::with_id(MENU_CHECK_UPDATES, "check for updates...").build(app)?;

    let open_config_item =
        MenuItemBuilder::with_id(MENU_OPEN_CONFIG, "open data folder...").build(app)?;

    let quit_item = MenuItemBuilder::with_id(MENU_QUIT, "quit")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;

    let mut builder = SubmenuBuilder::with_id(app, "freqhole", "freqhole")
        .item(&about_item)
        .item(&check_updates_item)
        .separator();

    // only show P2P controls if federation is enabled in config
    if is_federation_enabled() {
        let state = app.state::<Arc<P2pState>>();
        let status = state.status();
        let status_label = format!("P2P: {}", status.as_str());

        let p2p_status_item = MenuItemBuilder::with_id(MENU_P2P_STATUS, status_label)
            .enabled(false)
            .build(app)?;

        // only disable during brief Starting phase, not during Connecting
        let can_start = status == P2pStatus::Stopped || status == P2pStatus::Offline;
        let can_stop = status != P2pStatus::Stopped && status != P2pStatus::Starting;

        let p2p_start_item = MenuItemBuilder::with_id(MENU_P2P_START, "start")
            .enabled(can_start)
            .build(app)?;

        let p2p_stop_item = MenuItemBuilder::with_id(MENU_P2P_STOP, "stop")
            .enabled(can_stop)
            .build(app)?;

        let p2p_restart_item = MenuItemBuilder::with_id(MENU_P2P_RESTART, "restart")
            .enabled(can_stop)
            .build(app)?;

        builder = builder
            .item(&p2p_status_item)
            .item(&p2p_start_item)
            .item(&p2p_stop_item)
            .item(&p2p_restart_item)
            .separator();
    }

    builder
        .item(&open_config_item)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("hide freqhole"))?)
        .item(&PredefinedMenuItem::hide_others(app, Some("hide others"))?)
        .item(&PredefinedMenuItem::show_all(app, Some("show all"))?)
        .separator()
        .item(&quit_item)
        .build()
}

/// handle application menu item clicks
fn handle_menu_event(app: &AppHandle<Wry>, id: &str) {
    match id {
        MENU_ABOUT => {
            // show about window (or focus if already open)
            if let Some(about_window) = app.get_webview_window("about") {
                let _ = about_window.show();
                let _ = about_window.set_focus();
            } else {
                // create about window
                #[cfg(debug_assertions)]
                let about_url = tauri::WebviewUrl::External(
                    "http://localhost:1421/about.html".parse().unwrap(),
                );
                #[cfg(not(debug_assertions))]
                let about_url = tauri::WebviewUrl::App(std::path::PathBuf::from("about.html"));

                let _ = tauri::WebviewWindowBuilder::new(app, "about", about_url)
                    .title("about freqhole")
                    .inner_size(280.0, 320.0)
                    .resizable(false)
                    .center()
                    .theme(Some(tauri::Theme::Dark))
                    .build();
            }
        }
        MENU_P2P_START => {
            let state = app.state::<Arc<P2pState>>().inner().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = state.start().await {
                    tracing::error!(error = %e, "failed to start P2P");
                }
            });
        }
        MENU_P2P_STOP => {
            let state = app.state::<Arc<P2pState>>().inner().clone();
            tauri::async_runtime::spawn(async move {
                state.stop().await;
            });
        }
        MENU_P2P_RESTART => {
            let state = app.state::<Arc<P2pState>>().inner().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = state.restart().await {
                    tracing::error!(error = %e, "failed to restart P2P");
                }
            });
        }
        MENU_CHECK_UPDATES => {
            // run an ungated update check (works even when automatic checks are
            // disabled in config) and push the result to spume as a toast.
            let app_clone = app.clone();
            tauri::async_runtime::spawn(async move {
                let (available, current, latest, download_url, error) =
                    match grimoire::check_for_update_now().await {
                        Ok(status) => (
                            status.update_available,
                            status.current_version,
                            status.latest_version,
                            status.download_url,
                            None,
                        ),
                        Err(e) => (
                            false,
                            grimoire::config::get_binary_version().to_string(),
                            None,
                            grimoire::updates::DOWNLOAD_URL.to_string(),
                            Some(e.to_string()),
                        ),
                    };
                let _ = crate::spume_bridge::notify_update_check_result(
                    &app_clone,
                    available,
                    &current,
                    latest,
                    &download_url,
                    error,
                );
            });
        }
        MENU_OPEN_CONFIG => {
            // use our command to open the proper data directory
            let app_clone = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = open_config_dir(app_clone);
            });
        }
        MENU_DEVTOOLS => {
            // open devtools for the focused window
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }
            if let Some(wizard) = app.get_webview_window("setup-wizard") {
                wizard.open_devtools();
            }
        }
        MENU_LOGS | MENU_LIBRARY | MENU_USERS | MENU_RADIO | MENU_FEDERATION | MENU_SETTINGS
        | MENU_CONFIG => {
            let route = match id {
                MENU_LOGS => "/logs",
                MENU_LIBRARY => "/library",
                MENU_USERS => "/users",
                MENU_RADIO => "/radio",
                MENU_FEDERATION => "/federation",
                MENU_SETTINGS => "/settings",
                MENU_CONFIG => "/config",
                _ => "/logs",
            };
            open_wizard_at_route(app, route);
        }
        MENU_QUIT => {
            quit_app(app);
        }
        _ => {}
    }
}
