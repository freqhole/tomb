//! system tray for freqhole server control
//!
//! provides a menu bar icon with:
//! - server status indicator
//! - start/stop/restart controls
//! - quick access to settings

use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};

use crate::server_controls::{execute_server_action, open_wizard_at_route, quit_app, ServerAction};
use crate::sidecar::{self, ServerManager};

/// menu item IDs
const MENU_STATUS: &str = "status";
const MENU_START: &str = "start";
const MENU_STOP: &str = "stop";
const MENU_RESTART: &str = "restart";
const MENU_LOGS: &str = "logs";
const MENU_QUIT: &str = "quit";

/// create and register system tray
pub fn setup_tray(app: &AppHandle<Wry>) -> tauri::Result<()> {
    // build initial menu (server not running yet)
    let menu = build_tray_menu(app, false)?;

    // create tray icon (use a simple colored square for now)
    // in production, use actual icon assets
    let icon = create_tray_icon(false);

    let _tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .menu(&menu)
        .tooltip("freqhole")
        .on_menu_event(|app: &AppHandle<Wry>, event| {
            handle_menu_event(app, event.id.as_ref());
        })
        .build(app)?;

    // start status update task
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        update_tray_status_loop(app_handle).await;
    });

    Ok(())
}

/// create a simple tray icon
/// hot pink when running, gray when stopped
fn create_tray_icon(running: bool) -> Image<'static> {
    // 22x22 RGBA icon (good size for retina displays)
    let size = 22usize;
    let mut rgba = vec![0u8; size * size * 4];

    let (r, g, b) = if running {
        (0xFF, 0x1A, 0x9E) // hot pink
    } else {
        (0x9C, 0xA3, 0xAF) // gray
    };

    // draw the freqhole triangle (inverted, pointing down)
    // original SVG coords: top-left (125,155), top-right (375,155), bottom (250,405)
    // normalized to 0-1: top-left (0,0), top-right (1,0), bottom (0.5,1)
    // scale to icon size with small margin
    let margin = 2.0;
    let w = (size as f32) - margin * 2.0;
    let h = (size as f32) - margin * 2.0;

    // triangle vertices in pixel coordinates
    let top_left = (margin, margin);
    let top_right = (margin + w, margin);
    let bottom = (margin + w / 2.0, margin + h);

    // check if point is inside triangle using barycentric coordinates
    fn point_in_triangle(px: f32, py: f32, v0: (f32, f32), v1: (f32, f32), v2: (f32, f32)) -> bool {
        let area =
            0.5 * (-v1.1 * v2.0 + v0.1 * (-v1.0 + v2.0) + v0.0 * (v1.1 - v2.1) + v1.0 * v2.1);
        let s = 1.0 / (2.0 * area)
            * (v0.1 * v2.0 - v0.0 * v2.1 + (v2.1 - v0.1) * px + (v0.0 - v2.0) * py);
        let t = 1.0 / (2.0 * area)
            * (v0.0 * v1.1 - v0.1 * v1.0 + (v0.1 - v1.1) * px + (v1.0 - v0.0) * py);
        s >= 0.0 && t >= 0.0 && (s + t) <= 1.0
    }

    for y in 0..size {
        for x in 0..size {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;

            let idx = (y * size + x) * 4;
            if point_in_triangle(px, py, top_left, top_right, bottom) {
                rgba[idx] = r;
                rgba[idx + 1] = g;
                rgba[idx + 2] = b;
                rgba[idx + 3] = 255;
            }
        }
    }

    Image::new_owned(rgba, size as u32, size as u32)
}

/// handle menu item clicks
fn handle_menu_event(app: &AppHandle<Wry>, id: &str) {
    match id {
        MENU_START => {
            execute_server_action(app, ServerAction::Start);
        }
        MENU_STOP => {
            execute_server_action(app, ServerAction::Stop);
        }
        MENU_RESTART => {
            execute_server_action(app, ServerAction::Restart);
        }
        MENU_LOGS => {
            open_wizard_at_route(app, "/logs");
        }
        MENU_QUIT => {
            quit_app(app);
        }
        _ => {}
    }
}

/// periodically update tray icon and menu based on server status
async fn update_tray_status_loop(app: AppHandle<Wry>) {
    let mut last_running = false;

    loop {
        // check server status
        let state: tauri::State<'_, ServerManager> = app.state();
        let status = sidecar::get_status(&state).await;

        // update tray icon
        if let Some(tray) = app.tray_by_id("main") {
            let icon = create_tray_icon(status.running);
            let _ = tray.set_icon(Some(icon));

            let tooltip = if status.running {
                format!("freqhole - Running ({}s)", status.uptime_secs.unwrap_or(0))
            } else {
                "freqhole - Stopped".to_string()
            };
            let _ = tray.set_tooltip(Some(&tooltip));

            // rebuild menu if running state changed
            if status.running != last_running {
                if let Ok(menu) = build_tray_menu(&app, status.running) {
                    let _ = tray.set_menu(Some(menu));
                }
                last_running = status.running;
            }
        }

        // sleep before next check
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
}

/// build the tray menu with correct enabled/disabled states
fn build_tray_menu(app: &AppHandle<Wry>, running: bool) -> tauri::Result<tauri::menu::Menu<Wry>> {
    let status_text = if running {
        "freqhole: running"
    } else {
        "freqhole: stopped"
    };

    let status_item = MenuItemBuilder::with_id(MENU_STATUS, status_text)
        .enabled(false)
        .build(app)?;

    let start_item = MenuItemBuilder::with_id(MENU_START, "start")
        .enabled(!running)
        .build(app)?;

    let stop_item = MenuItemBuilder::with_id(MENU_STOP, "stop")
        .enabled(running)
        .build(app)?;

    let restart_item = MenuItemBuilder::with_id(MENU_RESTART, "restart")
        .enabled(running)
        .build(app)?;

    let logs_item = MenuItemBuilder::with_id(MENU_LOGS, "view logs").build(app)?;
    let quit_item = MenuItemBuilder::with_id(MENU_QUIT, "quit").build(app)?;

    MenuBuilder::new(app)
        .item(&status_item)
        .separator()
        .item(&start_item)
        .item(&stop_item)
        .item(&restart_item)
        .separator()
        .item(&logs_item)
        .separator()
        .item(&quit_item)
        .build()
}
