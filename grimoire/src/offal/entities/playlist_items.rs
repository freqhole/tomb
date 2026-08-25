//! generic playlist item API handlers (`playlist_itemz`)
//!
//! additive alongside the existing song-only `/api/playlists/*` routes
//! (`crate::offal::music::playlists`) - those stay untouched for backward
//! compat with the music-only playlist UI. `playlist_itemz.playlist_id`
//! still references the same shared `playlistz` table, so ownership here
//! is checked the same way: owner of the playlist, or an admin.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use zod_gen_derive::ZodSchema;

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::music::entities::playlists::get_playlist;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;

use super::resolve_video_entity_type;

/// request for listing every item in a playlist
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListPlaylistItemsRequest {
    pub playlist_id: String,
}

/// request for adding an entity to a playlist
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AddPlaylistItemRequest {
    pub playlist_id: String,
    pub entity_type: String,
    pub entity_id: String,
    /// position to insert at - omit to auto-append at the end
    pub position: Option<i64>,
}

/// request for removing an entity from a playlist
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RemovePlaylistItemRequest {
    pub playlist_id: String,
    pub entity_type: String,
    pub entity_id: String,
}

/// a single (entity_type, entity_id) ref, used by the reorder request to
/// describe a playlist's complete new item order
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PlaylistItemRef {
    pub entity_type: String,
    pub entity_id: String,
}

/// request for reordering every item in a playlist. `ordered_entity_refs`
/// must contain every item currently in the playlist, in the desired new
/// order - see `crate::video::reorder_playlist_items` for why a full
/// ordered list (rather than a move-to-position delta) is required.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ReorderPlaylistItemsRequest {
    pub playlist_id: String,
    pub ordered_entity_refs: Vec<PlaylistItemRef>,
}

/// route metadata for generic playlist items
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "list_playlist_items",
        path: "/api/entities/playlists/items/list",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "ListPlaylistItemsRequest",
        response_type: "Vec<PlaylistItem>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "add_playlist_item",
        path: "/api/entities/playlists/items/add",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "AddPlaylistItemRequest",
        response_type: "PlaylistItem",
        auth: RouteAuth::OwnerOr(UserRole::Admin),
    },
    RouteInfo {
        name: "remove_playlist_item",
        path: "/api/entities/playlists/items/remove",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "RemovePlaylistItemRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::OwnerOr(UserRole::Admin),
    },
    RouteInfo {
        name: "reorder_playlist_items",
        path: "/api/entities/playlists/items/reorder",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "ReorderPlaylistItemsRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::OwnerOr(UserRole::Admin),
    },
];

/// list every item in a playlist, ordered by position
///
/// path: POST /api/entities/playlists/items/list
pub async fn list(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: ListPlaylistItemsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    e.to_string(),
                )],
            )
        }
    };

    let response = crate::video::list_playlist_items(&req.playlist_id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// add an entity to a playlist
///
/// path: POST /api/entities/playlists/items/add
pub async fn add(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: AddPlaylistItemRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    e.to_string(),
                )],
            )
        }
    };

    let playlist_response = get_playlist(&req.playlist_id).await;
    if let Some(playlist) = &playlist_response.data {
        if let Err(resp) = crate::acl_bridge::require_owner_or_scope(
            playlist.created_by_id.as_deref(),
            caller,
            "add_playlist_item",
        )
        .await
        {
            return resp;
        }
    }

    let entity_type = match resolve_video_entity_type(&req.entity_type) {
        Ok(t) => t,
        Err(resp) => return resp,
    };

    let response = crate::video::add_playlist_item(
        &req.playlist_id,
        entity_type,
        &req.entity_id,
        req.position,
        Some(caller.user_id.clone()),
    )
    .await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// remove an entity from a playlist
///
/// path: POST /api/entities/playlists/items/remove
pub async fn remove(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RemovePlaylistItemRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    e.to_string(),
                )],
            )
        }
    };

    let playlist_response = get_playlist(&req.playlist_id).await;
    if let Some(playlist) = &playlist_response.data {
        if let Err(resp) = crate::acl_bridge::require_owner_or_scope(
            playlist.created_by_id.as_deref(),
            caller,
            "remove_playlist_item",
        )
        .await
        {
            return resp;
        }
    }

    let entity_type = match resolve_video_entity_type(&req.entity_type) {
        Ok(t) => t,
        Err(resp) => return resp,
    };

    let response =
        crate::video::remove_playlist_item(&req.playlist_id, entity_type, &req.entity_id).await;
    response.map(|_| JsonValue::Null)
}

/// reorder every item in a playlist
///
/// path: POST /api/entities/playlists/items/reorder
pub async fn reorder(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: ReorderPlaylistItemsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    e.to_string(),
                )],
            )
        }
    };

    let playlist_response = get_playlist(&req.playlist_id).await;
    if let Some(playlist) = &playlist_response.data {
        if let Err(resp) = crate::acl_bridge::require_owner_or_scope(
            playlist.created_by_id.as_deref(),
            caller,
            "reorder_playlist_items",
        )
        .await
        {
            return resp;
        }
    }

    let mut resolved_refs = Vec::with_capacity(req.ordered_entity_refs.len());
    for item_ref in &req.ordered_entity_refs {
        match resolve_video_entity_type(&item_ref.entity_type) {
            Ok(t) => resolved_refs.push((t, item_ref.entity_id.clone())),
            Err(resp) => return resp,
        }
    }

    let response = crate::video::reorder_playlist_items(&req.playlist_id, &resolved_refs).await;
    response.map(|_| JsonValue::Null)
}
