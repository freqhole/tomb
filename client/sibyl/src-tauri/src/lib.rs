//! sibyl tauri shell. responsibilities:
//! - bind the iroh node (via sibyl-core)
//! - spawn the rodio audio thread
//! - register the single `sibyl_call` ipc dispatcher
//! - set COOP/COEP headers so `crossOriginIsolated` is true and SAB works
//!
//! all real work lives in `sibyl_core` (the library) or `ipc.rs`
//! (the dispatcher). this file is intentionally thin.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cache;
mod ipc;
mod rodio_backend;

use tauri::Manager;
use tokio::sync::Mutex;

use ipc::{sibyl_call, SibylState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // spawn rodio audio thread (best-effort — no audio device → degraded)
            let rodio = match rodio_backend::spawn_audio_thread() {
                Ok(s) => {
                    eprintln!("rodio: audio thread spawned");
                    Some(s)
                }
                Err(e) => {
                    eprintln!("rodio init failed: {e}");
                    None
                }
            };

            // resolve app data dir up front so both the FsStore and the
            // disk cache live under a single per-app root. tauri's
            // `app_data_dir()` is the per-app, per-user dir
            // (e.g. ~/.local/share/<bundle-id> on linux).
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve tauri app data dir");
            let blobs_dir = data_dir.join("sibyl").join("blobs");

            // build sibyl iroh node on the tauri runtime, then store state.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = tokio::fs::create_dir_all(&blobs_dir).await {
                    eprintln!("sibyl: failed to create blobs dir {blobs_dir:?}: {e}");
                    return;
                }
                match sibyl_core::SibylNode::spawn_with_store_path(blobs_dir.clone()).await {
                    Ok(node) => {
                        handle.manage(SibylState {
                            node,
                            rodio,
                            hosts: Mutex::new(Vec::new()),
                            peers: std::sync::Arc::new(
                                Mutex::new(std::collections::HashMap::new()),
                            ),
                            data_dir,
                        });
                        eprintln!("sibyl: node spawned with FsStore at {blobs_dir:?}");
                    }
                    Err(e) => eprintln!("sibyl: node spawn failed: {e}"),
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![sibyl_call, read_audio_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// utility command kept from dumb-player so the file picker can read
/// arbitrary paths into a `Uint8Array`. used by phase 1 (load a static
/// mp3 from disk before iroh-blobs is wired).
#[tauri::command]
async fn read_audio_file(path: String) -> Result<Vec<u8>, String> {
    tokio::fs::read(&path).await.map_err(|e| e.to_string())
}
