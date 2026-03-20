//! tag API handlers

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::music::entities::tags::{
    add_albums_tags, delete_tag as grimoire_delete_tag, get_albums_tags,
    get_tag as grimoire_get_tag, list_tags, query_tags, remove_albums_tags, replace_albums_tags,
    AddAlbumsTagsRequest,
};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;
use serde::Deserialize;
use serde_json::Value as JsonValue;

/// route metadata for tags
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "list_tags",
        path: "/api/tags/list",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "String",
        response_type: "Vec<Tag>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "query_tags",
        path: "/api/tags/query",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "QueryTagsRequest",
        response_type: "Vec<Tag>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_tag",
        path: "/api/tags/get",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetTagRequest",
        response_type: "Tag",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "delete_tag",
        path: "/api/tags/delete",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "DeleteTagRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "get_albums_tags",
        path: "/api/tags/albums/get",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetAlbumsTagsRequest",
        response_type: "Vec<Tag>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "add_albums_tags",
        path: "/api/tags/albums/add",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "AddAlbumsTagsRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "remove_albums_tags",
        path: "/api/tags/albums/remove",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "RemoveAlbumsTagsRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "replace_albums_tags",
        path: "/api/tags/albums/replace",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ReplaceAlbumsTagsRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
];

/// list all tags
///
/// path: POST /api/tags/list
pub async fn list(_caller: &Caller, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    let response = list_tags().await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// search tags by query
///
/// path: POST /api/tags/query
#[derive(Deserialize)]
struct QueryRequest {
    query: String,
}

pub async fn query(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: QueryRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    let response = query_tags(&req.query).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// add tags to albums
///
/// path: POST /api/tags/add-to-albums
pub async fn add_to_albums(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: AddAlbumsTagsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    let response = add_albums_tags(req).await;
    response.map(|_| JsonValue::Null)
}

/// remove tags from albums
///
/// path: POST /api/tags/remove-from-albums
#[derive(Deserialize)]
struct RemoveAlbumsTagsRequest {
    album_ids: Vec<String>,
    tag_ids: Vec<String>,
}

pub async fn remove_from_albums(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: RemoveAlbumsTagsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    let response = remove_albums_tags(req.album_ids, req.tag_ids).await;
    response.map(|_| JsonValue::Null)
}

/// replace all tags on albums
///
/// path: POST /api/tags/replace-on-albums
#[derive(Deserialize)]
struct ReplaceAlbumsTagsRequest {
    album_ids: Vec<String>,
    tag_ids: Vec<String>,
}

pub async fn replace_on_albums(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: ReplaceAlbumsTagsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    let response = replace_albums_tags(req.album_ids, req.tag_ids).await;
    response.map(|_| JsonValue::Null)
}

/// get tags for albums
///
/// path: POST /api/tags/get-for-albums
#[derive(Deserialize)]
struct GetAlbumsTagsRequest {
    album_ids: Vec<String>,
}

pub async fn get_for_albums(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetAlbumsTagsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    let response = get_albums_tags(req.album_ids).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get a single tag by id
///
/// path: POST /api/tags/get
#[derive(Deserialize)]
struct GetTagRequest {
    id: String,
}

pub async fn get(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetTagRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    let response = grimoire_get_tag(&req.id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// delete a tag
///
/// path: POST /api/tags/delete
#[derive(Deserialize)]
struct DeleteTagRequest {
    id: String,
}

pub async fn delete(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: DeleteTagRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    let response = grimoire_delete_tag(&req.id, Some(caller.user_id.clone())).await;
    response.map(|_| JsonValue::Null)
}
