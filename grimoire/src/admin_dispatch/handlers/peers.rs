//! peer-node management handlers (list/remove/restore/allow).

use crate::admin_dispatch::helpers::{bad_request, decode, map_response, parse_role, to_value};
use crate::admin_dispatch::types::peers::{
    AdminPeerNodeSummary, AdminPeerSummary, AdminPeersAllowRequest, AdminPeersAllowResponse,
    AdminPeersListAllRequest, AdminPeersListForUserRequest, AdminPeersRemoveRequest,
    AdminPeersRestoreRequest,
};
use crate::response::GrimoireResponse;
use crate::users::{CreateUserRequest, UserRole, UserService};
use serde_json::Value as JsonValue;

pub(in crate::admin_dispatch) async fn list_for_user(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let req: AdminPeersListForUserRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let include_deleted = req.include_deleted.unwrap_or(false);
    let resp = UserService::new()
        .get_user_peer_nodes(&req.user_id, include_deleted)
        .await;
    to_value(map_response(resp, |peers| {
        peers
            .into_iter()
            .map(AdminPeerNodeSummary::from)
            .collect::<Vec<_>>()
    }))
}

pub(in crate::admin_dispatch) async fn list_all(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: AdminPeersListAllRequest = if args.is_null() {
        AdminPeersListAllRequest::default()
    } else {
        match decode(args) {
            Ok(v) => v,
            Err(r) => return r,
        }
    };
    let include_deleted = req.include_deleted.unwrap_or(false);
    let resp = UserService::new().get_all_peer_nodes(include_deleted).await;
    to_value(map_response(resp, |peers| {
        peers
            .into_iter()
            .map(AdminPeerSummary::from)
            .collect::<Vec<_>>()
    }))
}

pub(in crate::admin_dispatch) async fn remove(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: AdminPeersRemoveRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let resp = UserService::new()
        .remove_peer_node(&req.user_id, &req.node_id)
        .await;
    to_value(map_response(resp, |_| ()))
}

pub(in crate::admin_dispatch) async fn restore(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: AdminPeersRestoreRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let resp = UserService::new()
        .restore_peer_node(&req.user_id, &req.node_id)
        .await;
    to_value(map_response(resp, |_| ()))
}

/// allow a peer node by linking (or creating) a user with the given role.
/// args: `{ node_id, username?, role?, user_id? }`
/// - if `user_id` is set, links to that existing user
/// - else if `username` matches an existing user, links to it
/// - else creates a new user (`username` defaults to `peer_<first8>`)
/// returns `{ user_id, username, node_id, created_user }` to mirror the
/// legacy `allow_peer` tauri command shape.
pub(in crate::admin_dispatch) async fn allow(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: AdminPeersAllowRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };

    let node_id = req.node_id;
    if node_id.len() != 64 || !node_id.chars().all(|c| c.is_ascii_hexdigit()) {
        return bad_request("invalid node_id: expected 64 hex characters");
    }

    let user_role = match req.role.as_deref() {
        None => UserRole::Viewer,
        Some(s) => match parse_role(s) {
            Ok(r) => r,
            Err(e) => return bad_request(e),
        },
    };
    if user_role == UserRole::Root {
        return bad_request("cannot allow peer with root role".to_string());
    }

    let service = UserService::new();
    let (user, created_user) = if let Some(uid) = req.user_id {
        match service.get_user(&uid).await.data {
            Some(u) => (u, false),
            None => return bad_request(format!("user not found: {}", uid)),
        }
    } else {
        let username = req
            .username
            .unwrap_or_else(|| format!("peer_{}", &node_id[..8]));

        if let Some(existing) = service.get_user_by_username(&username).await.data {
            (existing, false)
        } else {
            let create_req = CreateUserRequest {
                username: username.clone(),
                role: Some(user_role),
                invite_code: None,
            };
            match service.register_user(&create_req).await {
                GrimoireResponse { data: Some(u), .. } => (u, true),
                resp => {
                    return GrimoireResponse::failure("failed to create user", resp.errors);
                }
            }
        }
    };

    let peer_resp = service.upsert_peer_node(&user.id, &node_id, None).await;
    if peer_resp.data.is_none() {
        return GrimoireResponse::failure("failed to link peer node", peer_resp.errors);
    }

    let body = AdminPeersAllowResponse {
        user_id: user.id,
        username: user.username,
        node_id,
        created_user,
    };
    to_value(GrimoireResponse::success("peer node linked", body))
}
