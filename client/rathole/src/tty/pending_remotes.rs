//! helpers for managing pending remote entries in the tty statefile.
//!
//! pending remotes represent in-progress add-remote attempts: invite-code
//! redemptions and knock requests that are waiting for admin approval.
//! they are stored under `pending_remotes` in the same toml statefile as
//! `remotes` (`data/rathole/state.toml`).

use super::persist;
use crate::ratcore::app::PendingRemoteEntry;

/// generate a new id using ulid (time-sortable, url-safe).
fn new_id() -> String {
    ulid::Ulid::new().to_string()
}

/// current unix time in milliseconds.
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// load all pending remotes from the statefile.
pub fn list() -> Vec<PendingRemoteEntry> {
    persist::load().unwrap_or_default().pending_remotes
}

/// get a single pending remote by id.
pub fn get(id: &str) -> Option<PendingRemoteEntry> {
    list().into_iter().find(|e| e.id == id)
}

/// add a new pending remote. if an entry with the same `peer_addr` already
/// exists it is returned as-is (no duplicate). otherwise a new entry is
/// created with the given stage and optional fields, persisted, and returned.
pub fn add(
    peer_addr: &str,
    transport: &str,
    stage: &str,
    invite_code: Option<&str>,
    knock_username: Option<&str>,
    knock_message: Option<&str>,
) -> color_eyre::Result<PendingRemoteEntry> {
    let mut state = persist::load().unwrap_or_default();

    // return existing entry for the same peer_addr rather than duplicating.
    if let Some(existing) = state
        .pending_remotes
        .iter()
        .find(|e| e.peer_addr == peer_addr)
    {
        return Ok(existing.clone());
    }

    let now = now_ms();
    let entry = PendingRemoteEntry {
        id: new_id(),
        peer_addr: peer_addr.to_string(),
        transport: transport.to_string(),
        stage: stage.to_string(),
        created_at: now,
        updated_at: now,
        server_name: None,
        knock_id: None,
        knock_username: knock_username.map(|s| s.to_string()),
        knock_message: knock_message.map(|s| s.to_string()),
        invite_code: invite_code.map(|s| s.to_string()),
        error_message: None,
    };

    state.pending_remotes.push(entry.clone());
    persist::save(&state)?;
    Ok(entry)
}

/// update the stage (and optional error message) for an existing pending remote.
/// returns the updated entry, or `None` if no entry with that id exists.
pub fn update_stage(
    id: &str,
    stage: &str,
    error_message: Option<&str>,
    knock_id: Option<&str>,
    server_name: Option<&str>,
) -> color_eyre::Result<Option<PendingRemoteEntry>> {
    let mut state = persist::load().unwrap_or_default();
    let pos = state.pending_remotes.iter().position(|e| e.id == id);
    match pos {
        None => Ok(None),
        Some(i) => {
            let entry = &mut state.pending_remotes[i];
            entry.stage = stage.to_string();
            entry.updated_at = now_ms();
            if let Some(msg) = error_message {
                entry.error_message = Some(msg.to_string());
            }
            if let Some(kid) = knock_id {
                entry.knock_id = Some(kid.to_string());
            }
            if let Some(name) = server_name {
                entry.server_name = Some(name.to_string());
            }
            let updated = state.pending_remotes[i].clone();
            persist::save(&state)?;
            Ok(Some(updated))
        }
    }
}

/// remove a pending remote by id. returns true if an entry was found and removed.
pub fn remove(id: &str) -> color_eyre::Result<bool> {
    let mut state = persist::load().unwrap_or_default();
    let before = state.pending_remotes.len();
    state.pending_remotes.retain(|e| e.id != id);
    let removed = state.pending_remotes.len() < before;
    if removed {
        persist::save(&state)?;
    }
    Ok(removed)
}
