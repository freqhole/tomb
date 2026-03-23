//! system tray for freqhole P2P endpoint control
//!
//! provides a menu bar icon with:
//! - P2P endpoint status (icon color)
//! - P2P start/stop/restart controls
//! - quick access to logs
//! - quit

use std::sync::Arc;

use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};

use crate::p2p_state::{P2pState, P2pStatus};
use crate::server_controls::{open_wizard_at_route, quit_app};

/// menu item IDs
const MENU_STATUS: &str = "status";
const MENU_START: &str = "start";
const MENU_STOP: &str = "stop";
const MENU_RESTART: &str = "restart";
const MENU_LOGS: &str = "logs";
const MENU_QUIT: &str = "quit";

/// create and register system tray
pub fn setup_tray(app: &AppHandle<Wry>) -> tauri::Result<()> {
    let state = app.state::<Arc<P2pState>>();
    let status = state.status();

    // build tray menu
    let menu = build_tray_menu(app, status)?;

    // create tray icon based on current P2P status
    let icon = create_tray_icon_for_status(status);

    let _tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .menu(&menu)
        .tooltip("freqhole")
        .on_menu_event(|app: &AppHandle<Wry>, event| {
            handle_menu_event(app, event.id.as_ref());
        })
        .build(app)?;

    // start status watcher to update icon/menu on status changes
    let app_handle = app.clone();
    let state_clone = app.state::<Arc<P2pState>>().inner().clone();
    tauri::async_runtime::spawn(async move {
        let mut rx = state_clone.subscribe();
        loop {
            if rx.changed().await.is_err() {
                break;
            }
            let status = *rx.borrow();
            update_tray_for_status(&app_handle, status);
        }
    });

    Ok(())
}

/// update tray icon and menu for new status
fn update_tray_for_status(app: &AppHandle<Wry>, status: P2pStatus) {
    if let Some(tray) = app.tray_by_id("main") {
        // update icon
        let icon = create_tray_icon_for_status(status);
        let _ = tray.set_icon(Some(icon));

        // rebuild menu with new status
        if let Ok(menu) = build_tray_menu(app, status) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

/// create tray icon with color based on P2P status
pub fn create_tray_icon_for_status(status: P2pStatus) -> Image<'static> {
    // 22x22 RGBA icon (good size for retina displays)
    let size = 22usize;
    let mut rgba = vec![0u8; size * size * 4];

    // color based on status:
    // - stopped: gray
    // - starting: yellow/orange
    // - connecting: yellow/orange (same as starting)
    // - online: magenta (hot pink)
    // - offline: red
    let (r, g, b) = match status {
        P2pStatus::Stopped => (0x88, 0x88, 0x88), // gray
        P2pStatus::Starting | P2pStatus::Connecting => (0xFF, 0xA5, 0x00), // orange
        P2pStatus::Online => (0xFF, 0x1A, 0x9E),  // magenta
        P2pStatus::Offline => (0xFF, 0x44, 0x44), // red
    };

    // draw the freqhole shape (4-sided polygon)
    let margin = 2.0;
    let w = (size as f32) - margin * 2.0;
    let h = (size as f32) - margin * 2.0;

    // polygon vertices in pixel coordinates (clockwise order)
    let vertices: [(f32, f32); 4] = [
        (margin, margin),                       // top-left
        (margin + w, margin),                   // top-right
        (margin + w * 0.8, margin + h * 0.743), // notch
        (margin + w * 0.5, margin + h),         // bottom
    ];

    // check if point is inside convex polygon using cross product method
    fn point_in_polygon(px: f32, py: f32, verts: &[(f32, f32); 4]) -> bool {
        let mut sign = None;
        for i in 0..4 {
            let (x1, y1) = verts[i];
            let (x2, y2) = verts[(i + 1) % 4];
            let cross = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
            let s = cross >= 0.0;
            match sign {
                None => sign = Some(s),
                Some(prev) if prev != s => return false,
                _ => {}
            }
        }
        true
    }

    for y in 0..size {
        for x in 0..size {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;

            let idx = (y * size + x) * 4;
            if point_in_polygon(px, py, &vertices) {
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
            let state = app.state::<Arc<P2pState>>().inner().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = state.start().await {
                    tracing::error!(error = %e, "failed to start P2P");
                }
            });
        }
        MENU_STOP => {
            let state = app.state::<Arc<P2pState>>().inner().clone();
            tauri::async_runtime::spawn(async move {
                state.stop().await;
            });
        }
        MENU_RESTART => {
            let state = app.state::<Arc<P2pState>>().inner().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = state.restart().await {
                    tracing::error!(error = %e, "failed to restart P2P");
                }
            });
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

/// build the tray menu with current status
fn build_tray_menu(
    app: &AppHandle<Wry>,
    status: P2pStatus,
) -> tauri::Result<tauri::menu::Menu<Wry>> {
    let status_label = format!("P2P: {}", status.as_str());
    let status_item = MenuItemBuilder::with_id(MENU_STATUS, status_label)
        .enabled(false)
        .build(app)?;

    // only disable during brief Starting phase, not during Connecting
    let can_start = status == P2pStatus::Stopped || status == P2pStatus::Offline;
    let can_stop = status != P2pStatus::Stopped && status != P2pStatus::Starting;

    let start_item = MenuItemBuilder::with_id(MENU_START, "start")
        .enabled(can_start)
        .build(app)?;

    let stop_item = MenuItemBuilder::with_id(MENU_STOP, "stop")
        .enabled(can_stop)
        .build(app)?;

    let restart_item = MenuItemBuilder::with_id(MENU_RESTART, "restart")
        .enabled(can_stop)
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
