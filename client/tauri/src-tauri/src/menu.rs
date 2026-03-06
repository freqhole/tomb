//! application menu for freqhole
//!
//! provides the standard macOS application menu with:
//! - about freqhole
//! - server controls (start/stop/restart)
//! - open config directory
//! - preferences
//! - quit

use tauri::menu::{Menu, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Manager, Wry};

use crate::commands::open_config_dir;
use crate::server_controls::{execute_server_action, open_wizard_at_route, quit_app, ServerAction};
use crate::sidecar::{self, ServerManager};

/// menu item IDs
const MENU_ABOUT: &str = "about";
const MENU_OPEN_CONFIG: &str = "open_config";
const MENU_STATUS: &str = "app_status";
const MENU_LOGS: &str = "logs";
const MENU_LIBRARY: &str = "library";
const MENU_USERS: &str = "users";
const MENU_FEDERATION: &str = "federation";
const MENU_SETTINGS: &str = "settings";
const MENU_DEVTOOLS: &str = "devtools";
const MENU_START: &str = "app_start";
const MENU_STOP: &str = "app_stop";
const MENU_RESTART: &str = "app_restart";
const MENU_QUIT: &str = "quit";

/// create and set application menu
pub fn setup_app_menu(app: &AppHandle<Wry>) -> tauri::Result<()> {
    // build initial menu (server not running yet)
    let app_submenu = build_app_submenu(app, false)?;

    // build view submenu
    let logs_item = MenuItemBuilder::with_id(MENU_LOGS, "logs").build(app)?;
    let library_item = MenuItemBuilder::with_id(MENU_LIBRARY, "library").build(app)?;
    let users_item = MenuItemBuilder::with_id(MENU_USERS, "users").build(app)?;
    let federation_item = MenuItemBuilder::with_id(MENU_FEDERATION, "federation").build(app)?;
    let settings_item = MenuItemBuilder::with_id(MENU_SETTINGS, "settings")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let devtools_item = MenuItemBuilder::with_id(MENU_DEVTOOLS, "developer tools")
        .accelerator("CmdOrCtrl+Shift+I")
        .build(app)?;

    let view_submenu = SubmenuBuilder::with_id(app, "view", "view")
        .item(&logs_item)
        .item(&library_item)
        .item(&users_item)
        .item(&federation_item)
        .item(&settings_item)
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

    // handle menu events
    app.on_menu_event(move |app_handle, event| {
        handle_menu_event(app_handle, event.id.as_ref());
    });

    // start status update task to keep menu in sync with server state
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        update_menu_status_loop(app_handle).await;
    });

    Ok(())
}

/// build the freqhole app submenu with correct enabled/disabled states
fn build_app_submenu(app: &AppHandle<Wry>, running: bool) -> tauri::Result<Submenu<Wry>> {
    let about_item = MenuItemBuilder::with_id(MENU_ABOUT, "about freqhole").build(app)?;

    let status_text = if running {
        "freqhole: running"
    } else {
        "freqhole: stopped"
    };
    let status_item = MenuItemBuilder::with_id(MENU_STATUS, status_text)
        .enabled(false)
        .build(app)?;

    // server control items with dynamic enable/disable
    let start_item = MenuItemBuilder::with_id(MENU_START, "start")
        .enabled(!running)
        .build(app)?;
    let stop_item = MenuItemBuilder::with_id(MENU_STOP, "stop")
        .enabled(running)
        .build(app)?;
    let restart_item = MenuItemBuilder::with_id(MENU_RESTART, "restart")
        .enabled(running)
        .build(app)?;

    let open_config_item =
        MenuItemBuilder::with_id(MENU_OPEN_CONFIG, "open data folder...").build(app)?;

    let quit_item = MenuItemBuilder::with_id(MENU_QUIT, "quit")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;

    SubmenuBuilder::with_id(app, "freqhole", "freqhole")
        .item(&about_item)
        .separator()
        .item(&status_item)
        .item(&start_item)
        .item(&stop_item)
        .item(&restart_item)
        .separator()
        .item(&open_config_item)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("hide freqhole"))?)
        .item(&PredefinedMenuItem::hide_others(app, Some("hide others"))?)
        .item(&PredefinedMenuItem::show_all(app, Some("show all"))?)
        .separator()
        .item(&quit_item)
        .build()
}

/// periodically update app menu based on server status
async fn update_menu_status_loop(app: AppHandle<Wry>) {
    let mut last_running = false;

    loop {
        // check server status
        let state: tauri::State<'_, ServerManager> = app.state();
        let status = sidecar::get_status(&state).await;

        // rebuild menu if running state changed
        if status.running != last_running {
            if let Ok(new_submenu) = build_app_submenu(&app, status.running) {
                // get current menu and update the freqhole submenu
                if let Some(menu) = app.menu() {
                    // remove old submenu and insert new one
                    let _ = menu.remove_at(0);
                    let _ = menu.insert(&new_submenu, 0);
                }
            }
            last_running = status.running;
        }

        // sleep before next check
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
}

/// handle application menu item clicks
fn handle_menu_event(app: &AppHandle<Wry>, id: &str) {
    match id {
        MENU_ABOUT => {
            // show about dialog or window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
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
        MENU_LOGS | MENU_LIBRARY | MENU_USERS | MENU_FEDERATION | MENU_SETTINGS => {
            let route = match id {
                MENU_LOGS => "/logs",
                MENU_LIBRARY => "/library",
                MENU_USERS => "/users",
                MENU_FEDERATION => "/federation",
                MENU_SETTINGS => "/settings",
                _ => "/logs",
            };
            open_wizard_at_route(app, route);
        }
        MENU_START => {
            execute_server_action(app, ServerAction::Start);
        }
        MENU_STOP => {
            execute_server_action(app, ServerAction::Stop);
        }
        MENU_RESTART => {
            execute_server_action(app, ServerAction::Restart);
        }
        MENU_QUIT => {
            quit_app(app);
        }
        _ => {}
    }
}
