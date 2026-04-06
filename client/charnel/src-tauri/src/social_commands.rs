//! social IPC commands
//!
//! handles all `social_*` actions dispatched through `skein_dispatch`.
//! each handler reads the local admin user_id from `FreqholeAppConfig`,
//! calls into `grimoire::social`, and returns JSON results.
//! after any mutation, emits a `social-state-changed` tauri event so the
//! typescript adapter can refetch the snapshot.

use serde_json::{json, Value as JsonValue};
use tauri::Emitter;

use crate::app_config::FreqholeAppConfig;

/// event name emitted after any social mutation
const SOCIAL_STATE_CHANGED_EVENT: &str = "social-state-changed";

/// dispatch a social_* action. returns Ok(json) on success, Err(string) on failure.
///
/// called from `skein_dispatch` for any action starting with "social_".
pub async fn dispatch(
    app_handle: &tauri::AppHandle,
    action: &str,
    payload: &JsonValue,
) -> Result<JsonValue, String> {
    match action {
        "social_get_state" => social_get_state(app_handle).await,
        "social_update_profile" => social_update_profile(app_handle, payload).await,
        "social_update_settings" => social_update_settings(app_handle, payload).await,
        "social_list_friends" => social_list_friends(app_handle).await,
        "social_add_friend" => social_add_friend(app_handle, payload).await,
        "social_update_friend" => social_update_friend(app_handle, payload).await,
        "social_set_friend_alias" => social_set_friend_alias(app_handle, payload).await,
        "social_remove_friend" => social_remove_friend(app_handle, payload).await,
        "social_list_requests" => social_list_requests(app_handle).await,
        "social_create_request" => social_create_request(app_handle, payload).await,
        "social_update_request" => social_update_request(app_handle, payload).await,
        "social_delete_request" => social_delete_request(app_handle, payload).await,
        "social_list_groups" => social_list_groups(app_handle).await,
        "social_upsert_group" => social_upsert_group(app_handle, payload).await,
        "social_delete_group" => social_delete_group(app_handle, payload).await,
        "social_update_node_profile" => social_update_node_profile(app_handle, payload).await,
        "social_resolve_node" => social_resolve_node(app_handle, payload).await,
        _ => Err(format!("unknown social action: {}", action)),
    }
}

// -- helpers --

/// load admin user_id from charnel app config
fn get_admin_user_id(app_handle: &tauri::AppHandle) -> Result<String, String> {
    let config = FreqholeAppConfig::load(app_handle)
        .ok_or_else(|| "app config not found — run setup first".to_string())?;
    config
        .admin_user
        .user_id
        .ok_or_else(|| "admin user_id not configured — run setup first".to_string())
}

/// get the local iroh node_id (hex string)
fn get_local_node_id() -> Result<String, String> {
    grimoire::federation::p2p_client::get_node_id()
        .map_err(|e| format!("P2P not initialized: {}", e))
}

/// emit the social-state-changed event (fire-and-forget)
fn emit_changed(app_handle: &tauri::AppHandle) {
    if let Err(e) = app_handle.emit(SOCIAL_STATE_CHANGED_EVENT, ()) {
        tracing::warn!(error = %e, "failed to emit social-state-changed event");
    }
}

/// shorthand for converting AuthError to a dispatch error string
fn auth_err(e: grimoire::AuthError) -> String {
    format!("social error: {}", e)
}

// -- read-only actions --

/// fetch the full social state snapshot for UI initialization
async fn social_get_state(app_handle: &tauri::AppHandle) -> Result<JsonValue, String> {
    let user_id = get_admin_user_id(app_handle)?;
    let node_id = get_local_node_id().unwrap_or_default();

    let service = grimoire::SocialService::new();
    let snapshot = service
        .get_social_snapshot(&user_id, &node_id)
        .await
        .map_err(auth_err)?;

    serde_json::to_value(&snapshot).map_err(|e| format!("serialization error: {}", e))
}

/// list all friends with denormalized details
async fn social_list_friends(app_handle: &tauri::AppHandle) -> Result<JsonValue, String> {
    let user_id = get_admin_user_id(app_handle)?;

    let repo = grimoire::SocialRepository::new();
    let friends = repo.list_friends(&user_id).await.map_err(auth_err)?;

    serde_json::to_value(&friends).map_err(|e| format!("serialization error: {}", e))
}

/// list friend requests (both inbound + outbound)
async fn social_list_requests(app_handle: &tauri::AppHandle) -> Result<JsonValue, String> {
    let user_id = get_admin_user_id(app_handle)?;

    let repo = grimoire::SocialRepository::new();
    let requests = repo
        .list_requests(&user_id, None, None)
        .await
        .map_err(auth_err)?;

    serde_json::to_value(&requests).map_err(|e| format!("serialization error: {}", e))
}

/// list friend groups
async fn social_list_groups(app_handle: &tauri::AppHandle) -> Result<JsonValue, String> {
    let user_id = get_admin_user_id(app_handle)?;

    let repo = grimoire::SocialRepository::new();
    let groups = repo.list_groups(&user_id).await.map_err(auth_err)?;

    serde_json::to_value(&groups).map_err(|e| format!("serialization error: {}", e))
}

// -- mutation actions --

/// update the local user's identity-level profile
async fn social_update_profile(
    app_handle: &tauri::AppHandle,
    payload: &JsonValue,
) -> Result<JsonValue, String> {
    let user_id = get_admin_user_id(app_handle)?;

    let req = grimoire::UpdateProfileRequest {
        username: payload["username"].as_str().map(String::from),
        alias: payload["alias"].as_str().map(String::from),
        bio: payload["bio"].as_str().map(String::from),
        avatar_url: payload["avatar_url"].as_str().map(String::from),
        accent_color: payload["accent_color"].as_i64(),
    };

    let repo = grimoire::SocialRepository::new();
    repo.update_profile(&user_id, &req).await.map_err(auth_err)?;

    // also update the local node's per-node profile to stay consistent
    if let Ok(node_id) = get_local_node_id() {
        let node_req = grimoire::UpdateNodeProfileRequest {
            display_name: req.alias.clone().or(req.username.clone()),
            bio: req.bio.clone(),
            avatar_url: req.avatar_url.clone(),
            accent_color: req.accent_color,
        };
        // best-effort — the node might not exist yet
        let _ = repo.update_node_profile(&node_id, &node_req).await;
    }

    // fetch updated profile to return
    let profile = repo.get_profile(&user_id).await.map_err(auth_err)?;

    emit_changed(app_handle);

    serde_json::to_value(&profile).map_err(|e| format!("serialization error: {}", e))
}

/// update social privacy/preference settings
async fn social_update_settings(
    app_handle: &tauri::AppHandle,
    payload: &JsonValue,
) -> Result<JsonValue, String> {
    let user_id = get_admin_user_id(app_handle)?;

    let repo = grimoire::SocialRepository::new();

    // read current settings, merge in provided fields
    let mut settings = repo
        .get_social_settings(&user_id)
        .await
        .map_err(auth_err)?;

    if let Some(v) = payload["profile_visibility"].as_str() {
        settings.profile_visibility = v.to_string();
    }
    if let Some(v) = payload["friend_requests_from"].as_str() {
        settings.friend_requests_from = v.to_string();
    }

    repo.update_social_settings(&user_id, &settings)
        .await
        .map_err(auth_err)?;

    emit_changed(app_handle);

    serde_json::to_value(&settings).map_err(|e| format!("serialization error: {}", e))
}

/// add a friend by node_id. resolves node -> user, creates friendship.
///
/// payload: `{ node_id: string, alias?: string }`
async fn social_add_friend(
    app_handle: &tauri::AppHandle,
    payload: &JsonValue,
) -> Result<JsonValue, String> {
    let user_id = get_admin_user_id(app_handle)?;
    let node_id = payload["node_id"]
        .as_str()
        .ok_or("missing node_id")?;
    let alias = payload["alias"].as_str();

    let service = grimoire::SocialService::new();

    // resolve node_id to a user (creates if needed)
    let resolved = service
        .resolve_or_create_user_for_node(node_id, alias)
        .await
        .map_err(auth_err)?;

    // set alias on the friend's user_accountz if provided
    if let Some(alias_val) = alias {
        if !alias_val.is_empty() {
            let repo = grimoire::SocialRepository::new();
            repo.update_user_alias(&resolved.user_id, alias_val)
                .await
                .map_err(auth_err)?;
        }
    }

    // create the friendship (ignore duplicate errors — might already be friends)
    let repo = grimoire::SocialRepository::new();
    let result = repo.add_friend(&user_id, &resolved.user_id, None).await;

    match result {
        Ok(friend) => {
            emit_changed(app_handle);
            serde_json::to_value(&friend).map_err(|e| format!("serialization error: {}", e))
        }
        Err(grimoire::AuthError::Database(ref msg)) if msg.contains("UNIQUE constraint") => {
            // already friends — not an error, just return the existing list
            emit_changed(app_handle);
            Ok(json!({ "already_friends": true, "friend_user_id": resolved.user_id }))
        }
        Err(e) => Err(auth_err(e)),
    }
}

/// update a friendship's group assignment
///
/// payload: `{ id: string, group_name?: string }`
async fn social_update_friend(
    app_handle: &tauri::AppHandle,
    payload: &JsonValue,
) -> Result<JsonValue, String> {
    let id = payload["id"].as_str().ok_or("missing id")?;
    let group_name = payload["group_name"].as_str();

    let repo = grimoire::SocialRepository::new();
    repo.update_friend(id, group_name)
        .await
        .map_err(auth_err)?;

    emit_changed(app_handle);
    Ok(json!({}))
}

/// set the alias on a friend's user_accountz row
///
/// payload: `{ friend_user_id: string, alias: string }`
async fn social_set_friend_alias(
    app_handle: &tauri::AppHandle,
    payload: &JsonValue,
) -> Result<JsonValue, String> {
    let friend_user_id = payload["friend_user_id"]
        .as_str()
        .ok_or("missing friend_user_id")?;
    let alias = payload["alias"].as_str().ok_or("missing alias")?;

    let repo = grimoire::SocialRepository::new();
    repo.update_user_alias(friend_user_id, alias)
        .await
        .map_err(auth_err)?;

    emit_changed(app_handle);
    Ok(json!({}))
}

/// remove a friend relationship
///
/// payload: `{ id: string }`
async fn social_remove_friend(
    app_handle: &tauri::AppHandle,
    payload: &JsonValue,
) -> Result<JsonValue, String> {
    let id = payload["id"].as_str().ok_or("missing id")?;

    let repo = grimoire::SocialRepository::new();
    repo.remove_friend(id).await.map_err(auth_err)?;

    emit_changed(app_handle);
    Ok(json!({}))
}

/// create a friend request (inbound or outbound)
///
/// payload: `{ node_id: string, direction: "inbound" | "outbound", display_name?: string }`
async fn social_create_request(
    app_handle: &tauri::AppHandle,
    payload: &JsonValue,
) -> Result<JsonValue, String> {
    let user_id = get_admin_user_id(app_handle)?;
    let node_id = payload["node_id"]
        .as_str()
        .ok_or("missing node_id")?;
    let direction = payload["direction"]
        .as_str()
        .ok_or("missing direction (inbound or outbound)")?;

    if direction != "inbound" && direction != "outbound" {
        return Err("direction must be 'inbound' or 'outbound'".to_string());
    }

    let service = grimoire::SocialService::new();

    // resolve node_id to a user first
    let display_name = payload["display_name"].as_str();
    let resolved = service
        .resolve_or_create_user_for_node(node_id, display_name)
        .await
        .map_err(auth_err)?;

    // check for existing request in the same direction
    let repo = grimoire::SocialRepository::new();
    let existing = repo
        .find_request(&user_id, &resolved.user_id, direction)
        .await
        .map_err(auth_err)?;

    if let Some(req) = existing {
        // return existing request instead of creating duplicate
        return serde_json::to_value(&req).map_err(|e| format!("serialization error: {}", e));
    }

    let request = repo
        .create_request(&user_id, &resolved.user_id, direction)
        .await
        .map_err(auth_err)?;

    emit_changed(app_handle);

    serde_json::to_value(&request).map_err(|e| format!("serialization error: {}", e))
}

/// update a friend request's status
///
/// payload: `{ id: string, status: string }`
///
/// handles several flows:
/// - status "accepted" on a pending inbound request: runs the full accept flow
///   (updates status to accepted-pending-ack, creates friendship)
/// - status "accepted" on an accepted-pending-ack request: completes the ack
///   handshake (updates status to accepted)
/// - status "rejected" on an inbound request: rejects via the service layer
/// - status "rejected" on an outbound request: cancels via direct status update
/// - status "accepted-pending-ack" or "pending": direct status update for
///   protocol handshake steps
async fn social_update_request(
    app_handle: &tauri::AppHandle,
    payload: &JsonValue,
) -> Result<JsonValue, String> {
    let user_id = get_admin_user_id(app_handle)?;
    let request_id = payload["id"].as_str().ok_or("missing id")?;
    let status = payload["status"].as_str().ok_or("missing status")?;

    let service = grimoire::SocialService::new();

    match status {
        "accepted" => {
            // try the full accept flow first (works when request is in "pending" state).
            // if that fails with InsufficientPermissions, the request is likely in
            // "accepted-pending-ack" state — complete the ack handshake instead.
            match service
                .accept_friend_request(request_id, &user_id)
                .await
            {
                Ok(friend) => {
                    emit_changed(app_handle);
                    serde_json::to_value(&friend)
                        .map_err(|e| format!("serialization error: {}", e))
                }
                Err(grimoire::AuthError::InsufficientPermissions) => {
                    // request already past "pending" — complete the ack handshake
                    service
                        .handle_friend_accept_ack(request_id)
                        .await
                        .map_err(auth_err)?;
                    emit_changed(app_handle);
                    Ok(json!({}))
                }
                Err(e) => Err(auth_err(e)),
            }
        }
        "rejected" => {
            // try inbound reject first (service validates direction + status).
            // if that fails with UserNotFound, the request is likely outbound —
            // fall back to a direct status update for cancellation.
            match service
                .reject_friend_request(request_id, &user_id)
                .await
            {
                Ok(()) => {
                    emit_changed(app_handle);
                    Ok(json!({}))
                }
                Err(grimoire::AuthError::UserNotFound) => {
                    // not found as inbound — try direct update (outbound cancel)
                    let repo = grimoire::SocialRepository::new();
                    repo.update_request_status(request_id, "rejected")
                        .await
                        .map_err(auth_err)?;
                    emit_changed(app_handle);
                    Ok(json!({}))
                }
                Err(e) => Err(auth_err(e)),
            }
        }
        "accepted-pending-ack" | "pending" => {
            // direct status update for protocol handshake steps
            let repo = grimoire::SocialRepository::new();
            repo.update_request_status(request_id, status)
                .await
                .map_err(auth_err)?;
            emit_changed(app_handle);
            Ok(json!({}))
        }
        _ => Err(format!(
            "invalid status '{}' — expected accepted, rejected, accepted-pending-ack, or pending",
            status
        )),
    }
}

/// delete a friend request by id (used for clearing completed outbound requests)
///
/// payload: `{ id: string }`
async fn social_delete_request(
    app_handle: &tauri::AppHandle,
    payload: &JsonValue,
) -> Result<JsonValue, String> {
    let request_id = payload["id"].as_str().ok_or("missing id")?;

    let repo = grimoire::SocialRepository::new();
    repo.delete_request(request_id)
        .await
        .map_err(auth_err)?;

    emit_changed(app_handle);
    Ok(json!({}))
}

/// create or update a friend group
///
/// payload: `{ name: string, color: number }`
async fn social_upsert_group(
    app_handle: &tauri::AppHandle,
    payload: &JsonValue,
) -> Result<JsonValue, String> {
    let user_id = get_admin_user_id(app_handle)?;
    let name = payload["name"].as_str().ok_or("missing name")?;
    let color = payload["color"].as_i64().unwrap_or(0x6366f1); // default indigo

    let repo = grimoire::SocialRepository::new();
    let group = repo
        .upsert_group(&user_id, name, color)
        .await
        .map_err(auth_err)?;

    emit_changed(app_handle);

    serde_json::to_value(&group).map_err(|e| format!("serialization error: {}", e))
}

/// delete a friend group
///
/// payload: `{ name: string }`
async fn social_delete_group(
    app_handle: &tauri::AppHandle,
    payload: &JsonValue,
) -> Result<JsonValue, String> {
    let user_id = get_admin_user_id(app_handle)?;
    let name = payload["name"].as_str().ok_or("missing name")?;

    let repo = grimoire::SocialRepository::new();
    repo.delete_group(&user_id, name)
        .await
        .map_err(auth_err)?;

    emit_changed(app_handle);
    Ok(json!({}))
}

/// update a remote node's self-reported profile (called when receiving P2P profile-response)
///
/// payload: `{ node_id: string, display_name?: string, bio?: string, avatar_url?: string, accent_color?: number }`
async fn social_update_node_profile(
    app_handle: &tauri::AppHandle,
    payload: &JsonValue,
) -> Result<JsonValue, String> {
    let node_id = payload["node_id"]
        .as_str()
        .ok_or("missing node_id")?;

    let req = grimoire::UpdateNodeProfileRequest {
        display_name: payload["display_name"].as_str().map(String::from),
        bio: payload["bio"].as_str().map(String::from),
        avatar_url: payload["avatar_url"].as_str().map(String::from),
        accent_color: payload["accent_color"].as_i64(),
    };

    let repo = grimoire::SocialRepository::new();
    repo.update_node_profile(node_id, &req)
        .await
        .map_err(auth_err)?;

    emit_changed(app_handle);
    Ok(json!({}))
}

/// resolve a node_id to a user, creating if needed.
/// exposed as an IPC action so the typescript friend request protocol can use it.
///
/// payload: `{ node_id: string, display_name?: string }`
async fn social_resolve_node(
    _app_handle: &tauri::AppHandle,
    payload: &JsonValue,
) -> Result<JsonValue, String> {
    let node_id = payload["node_id"]
        .as_str()
        .ok_or("missing node_id")?;
    let display_name = payload["display_name"].as_str();

    let service = grimoire::SocialService::new();
    let resolved = service
        .resolve_or_create_user_for_node(node_id, display_name)
        .await
        .map_err(auth_err)?;

    Ok(json!({
        "user_id": resolved.user_id,
        "username": resolved.username,
        "created": resolved.created,
    }))
}
