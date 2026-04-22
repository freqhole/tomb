//! tauri commands for the shared remote registry (`remotez` table)
//!
//! these commands are used by both the spume player and the wizard admin app
//! when running in tauri context. pure-web spume builds do not call these.
//!
//! see grimoire/src/remotez/ for the underlying repository.

use grimoire::remotez::{Remote, RemoteRepository, UpsertRemoteRequest};

use crate::commands::ensure_initialized_pub as ensure_initialized;

/// list all remotes, ordered by `updated_at` descending
#[tauri::command]
pub async fn remotez_list(app_handle: tauri::AppHandle) -> Result<Vec<Remote>, String> {
    ensure_initialized(&app_handle).await?;
    RemoteRepository::new()
        .list()
        .await
        .map_err(|e| e.to_string())
}

/// fetch a single remote by id
#[tauri::command]
pub async fn remotez_get(
    app_handle: tauri::AppHandle,
    remote_id: String,
) -> Result<Option<Remote>, String> {
    ensure_initialized(&app_handle).await?;
    RemoteRepository::new()
        .get(&remote_id)
        .await
        .map_err(|e| e.to_string())
}

/// fetch a single remote by peer_addr (P2P node id or json endpoint)
#[tauri::command]
pub async fn remotez_get_by_peer_addr(
    app_handle: tauri::AppHandle,
    peer_addr: String,
) -> Result<Option<Remote>, String> {
    ensure_initialized(&app_handle).await?;
    RemoteRepository::new()
        .get_by_peer_addr(&peer_addr)
        .await
        .map_err(|e| e.to_string())
}

/// insert or update a remote
#[tauri::command]
pub async fn remotez_upsert(
    app_handle: tauri::AppHandle,
    request: UpsertRemoteRequest,
) -> Result<Remote, String> {
    ensure_initialized(&app_handle).await?;
    RemoteRepository::new()
        .upsert(&request)
        .await
        .map_err(|e| e.to_string())
}

/// delete a remote by id. returns true if a row was removed.
#[tauri::command]
pub async fn remotez_remove(
    app_handle: tauri::AppHandle,
    remote_id: String,
) -> Result<bool, String> {
    ensure_initialized(&app_handle).await?;
    RemoteRepository::new()
        .remove(&remote_id)
        .await
        .map_err(|e| e.to_string())
}

/// mark a remote as the active one. clears is_active on all other rows.
#[tauri::command]
pub async fn remotez_mark_active(
    app_handle: tauri::AppHandle,
    remote_id: String,
) -> Result<(), String> {
    ensure_initialized(&app_handle).await?;
    RemoteRepository::new()
        .mark_active(&remote_id)
        .await
        .map_err(|e| e.to_string())
}
