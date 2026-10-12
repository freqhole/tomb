//! single tauri command for every pending-remote operation
//!
//! mirrors `video_window::video_window_command`'s shape - one tagged-enum
//! command (`PendingRemoteCommand`) instead of a command-per-operation, so
//! this registers as exactly one entry in `lib.rs`'s `invoke_handler!` and
//! the ACL permissions file, not seven.
//!
//! used by the spume player in tauri context. pure-web spume builds do not
//! call this (they keep using IndexedDB - see
//! `client/spume/src/app/services/storage/db.ts`'s pending-remote
//! functions, now backend-selected the same way `remoteManager.ts`
//! already picks between `sqliteBackend`/`idbBackend`).
//!
//! see grimoire/src/pending_remotez/ for the underlying repository - it
//! operates on the same `remotez` table established remotes use, not a
//! separate table.

use grimoire::pending_remotez::{PendingRemoteCommand, PendingRemoteRepository};
use serde_json::Value as JsonValue;

use crate::commands::ensure_initialized_pub as ensure_initialized;

#[tauri::command]
pub async fn pending_remotez_command(
    app_handle: tauri::AppHandle,
    command: PendingRemoteCommand,
) -> Result<JsonValue, String> {
    ensure_initialized(&app_handle).await?;
    let repo = PendingRemoteRepository::new();

    let value = match command {
        PendingRemoteCommand::List => {
            serde_json::to_value(repo.list().await.map_err(|e| e.to_string())?)
        }
        PendingRemoteCommand::Get { id } => {
            serde_json::to_value(repo.get(&id).await.map_err(|e| e.to_string())?)
        }
        PendingRemoteCommand::GetByPeerAddr { peer_addr } => serde_json::to_value(
            repo.get_by_peer_addr(&peer_addr)
                .await
                .map_err(|e| e.to_string())?,
        ),
        PendingRemoteCommand::Create { request } => {
            serde_json::to_value(repo.create(&request).await.map_err(|e| e.to_string())?)
        }
        PendingRemoteCommand::Update { id, request } => serde_json::to_value(
            repo.update(&id, &request)
                .await
                .map_err(|e| e.to_string())?,
        ),
        PendingRemoteCommand::Remove { id } => {
            serde_json::to_value(repo.remove(&id).await.map_err(|e| e.to_string())?)
        }
        PendingRemoteCommand::RemoveByPeerAddr { peer_addr } => serde_json::to_value(
            repo.remove_by_peer_addr(&peer_addr)
                .await
                .map_err(|e| e.to_string())?,
        ),
    };

    value.map_err(|e| e.to_string())
}
