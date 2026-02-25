//! freqhole tauri app
//!
//! provides a custom protocol handler for proxying blob requests with auth headers

mod commands;
mod menu;
mod server_controls;
mod sidecar;
mod tray;
mod wizard;

#[cfg(not(debug_assertions))]
use std::path::PathBuf;
use tauri::http::{Request, Response};
use tauri::{Manager, RunEvent, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};

/// proxy a blob request with authorization header (blocking)
///
/// the freqhole:// protocol expects URLs like:
/// freqhole://proxy?url=https%3A%2F%2Fserver%2Fapi%2Fblobs%2Fid&key=apikey
fn proxy_blob_request(
    request: Request<Vec<u8>>,
) -> Result<Response<Vec<u8>>, Box<dyn std::error::Error + Send + Sync>> {
    let uri = request.uri().to_string();

    // parse query params from the URI
    // format: freqhole://proxy?url=<encoded>&key=<encoded>
    let parsed = url::Url::parse(&uri)?;
    let params: std::collections::HashMap<_, _> = parsed.query_pairs().collect();

    let target_url = params
        .get("url")
        .ok_or("missing url parameter")?
        .to_string();

    let api_key = params.get("key").map(|s| s.to_string());

    // build the proxied request using blocking client
    let client = reqwest::blocking::Client::new();
    let mut req_builder = client.get(&target_url);

    if let Some(key) = api_key {
        req_builder = req_builder.header("Authorization", format!("Bearer {}", key));
    }

    // make the request
    let response = req_builder.send()?;

    // build response
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    let body = response.bytes()?.to_vec();

    let response = Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("Access-Control-Allow-Origin", "*")
        .body(body)?;

    Ok(response)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(sidecar::new_server_manager())
        .setup(|app| {
            // check if setup wizard should run
            let needs_setup = app
                .path()
                .app_data_dir()
                .map(|dir| !dir.join("freqhole-config.toml").exists())
                .unwrap_or(true);

            if needs_setup {
                // setup wizard runs on port 1421 (tauri UI)
                // main app (spume) runs on port 1420
                #[cfg(debug_assertions)]
                let wizard_url = WebviewUrl::External("http://localhost:1421".parse().unwrap());
                #[cfg(not(debug_assertions))]
                let wizard_url = WebviewUrl::App(PathBuf::from("wizard/index.html"));

                let _wizard = WebviewWindowBuilder::new(app, "setup-wizard", wizard_url)
                    .title("freqhole setup")
                    .inner_size(800.0, 600.0)
                    .resizable(true)
                    .center()
                    .build()?;

                // wizard will start server when setup completes
            } else {
                // setup already complete - start server automatically
                let config_path = app
                    .path()
                    .app_data_dir()
                    .map(|dir| dir.join("freqhole-config.toml"))
                    .map_err(|e| e.to_string())?;

                let state = app.state::<sidecar::ServerManager>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    let result = sidecar::start_server(&state, config_path).await;
                    if !result.success {
                        eprintln!("[tauri] failed to start server: {}", result.message);
                    }
                });

                // show main window
                let win_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                    .title("")
                    .inner_size(800.0, 600.0);

                #[cfg(target_os = "macos")]
                let win_builder = win_builder.title_bar_style(TitleBarStyle::Transparent);

                let window = win_builder.build()?;

                // set background color only when building for macOS
                #[cfg(target_os = "macos")]
                #[allow(deprecated)]
                {
                    use cocoa::appkit::{NSColor, NSWindow};
                    use cocoa::base::{id, nil};

                    let ns_window = window.ns_window().unwrap() as id;
                    unsafe {
                        let bg_color =
                            NSColor::colorWithRed_green_blue_alpha_(nil, 0.0, 0.0, 0.0, 1.0);
                        ns_window.setBackgroundColor_(bg_color);
                    }
                }
            }

            // setup system tray
            tray::setup_tray(app.handle())?;

            // setup application menu
            menu::setup_app_menu(app.handle())?;

            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_denylist(&["setup-wizard"])
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::check_setup_status,
            commands::create_config,
            commands::init_from_config,
            commands::create_root_user,
            commands::get_default_data_dir,
            commands::get_os_username,
            commands::get_config_path,
            commands::get_data_dir,
            commands::open_config_dir,
            commands::read_config_file,
            commands::save_config_file,
            commands::list_users,
            commands::update_user_role,
            commands::delete_user,
            commands::list_invites,
            commands::generate_invites,
            commands::deactivate_invite,
            commands::scan_directory,
            commands::list_scanned_directories,
            commands::remove_scanned_directory,
            sidecar::server_status,
            sidecar::server_start,
            sidecar::server_stop,
            sidecar::server_restart,
            sidecar::server_health_check,
            sidecar::get_server_logs,
            wizard::open_setup_wizard,
            wizard::close_setup_wizard,
        ])
        .register_asynchronous_uri_scheme_protocol("freqhole", |_ctx, request, responder| {
            // spawn blocking task in a thread to avoid blocking the UI
            std::thread::spawn(move || match proxy_blob_request(request) {
                Ok(response) => responder.respond(response),
                Err(e) => {
                    eprintln!("proxy error: {}", e);
                    let error_response = Response::builder()
                        .status(500)
                        .header("Content-Type", "text/plain")
                        .body(format!("proxy error: {}", e).into_bytes())
                        .unwrap();
                    responder.respond(error_response);
                }
            });
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                // stop server on app exit
                let state = app.state::<sidecar::ServerManager>().inner().clone();
                tauri::async_runtime::block_on(async move {
                    let _ = sidecar::stop_server(&state).await;
                });
            }
        });
}
