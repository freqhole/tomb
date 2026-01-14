//! tags handlers

use axum::{extract::Extension, Json};
use grimoire::api_registry::{Domain, Method, RouteInfo};
use grimoire::music::entities::tags::{
    add_album_tags, delete_tag, get_album_tags, get_tag, list_tags, query_tags, remove_album_tags,
    replace_album_tags, AddAlbumTagsRequest, DeleteTagRequest, GetAlbumTagsRequest, GetTagRequest,
    QueryTagsRequest, RemoveAlbumTagsRequest, ReplaceAlbumTagsRequest, Tag,
};
use grimoire::EmptyResponse;

use crate::{auth::middleware::AuthenticatedUser, error::ApiError};

/// list all tags
pub async fn list_tags_handler(
    Extension(_user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<Tag>>, ApiError> {
    let response = list_tags().await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "list_tags",
        path: "/api/tags/list",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "String",
        response_type: "Vec<Tag>",
    }
}

/// query/search tags
pub async fn query_tags_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<QueryTagsRequest>,
) -> Result<Json<Vec<Tag>>, ApiError> {
    let search = req.search.unwrap_or_default();
    let response = query_tags(&search).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "query_tags",
        path: "/api/tags/query",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "QueryTagsRequest",
        response_type: "Vec<Tag>",
    }
}

/// get a single tag by id
pub async fn get_tag_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<GetTagRequest>,
) -> Result<Json<Tag>, ApiError> {
    let response = get_tag(&req.tag_id).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "get_tag",
        path: "/api/tags/get",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetTagRequest",
        response_type: "Tag",
    }
}

/// delete a tag
pub async fn delete_tag_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<DeleteTagRequest>,
) -> Result<Json<EmptyResponse>, ApiError> {
    let deleted_by = req.deleted_by.or(Some(user.user_id));
    let response = delete_tag(&req.tag_id, deleted_by).await;

    response
        .data
        .map(|_| Json(EmptyResponse::ok()))
        .ok_or_else(|| ApiError::Internal(response.message))
}

inventory::submit! {
    RouteInfo {
        name: "delete_tag",
        path: "/api/tags/delete",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "DeleteTagRequest",
        response_type: "EmptyResponse",
    }
}

/// get tags for an album
pub async fn get_album_tags_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<GetAlbumTagsRequest>,
) -> Result<Json<Vec<Tag>>, ApiError> {
    let response = get_album_tags(&req.album_id).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "get_album_tags",
        path: "/api/tags/album/get",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetAlbumTagsRequest",
        response_type: "Vec<Tag>",
    }
}

/// add tags to an album
pub async fn add_album_tags_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<AddAlbumTagsRequest>,
) -> Result<Json<EmptyResponse>, ApiError> {
    let response = add_album_tags(&req.album_id, req.tag_ids).await;

    response
        .data
        .map(|_| Json(EmptyResponse::ok()))
        .ok_or_else(|| ApiError::Internal(response.message))
}

inventory::submit! {
    RouteInfo {
        name: "add_album_tags",
        path: "/api/tags/album/add",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "AddAlbumTagsRequest",
        response_type: "EmptyResponse",
    }
}

/// remove tags from an album
pub async fn remove_album_tags_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<RemoveAlbumTagsRequest>,
) -> Result<Json<EmptyResponse>, ApiError> {
    let response = remove_album_tags(&req.album_id, req.tag_ids).await;

    response
        .data
        .map(|_| Json(EmptyResponse::ok()))
        .ok_or_else(|| ApiError::Internal(response.message))
}

inventory::submit! {
    RouteInfo {
        name: "remove_album_tags",
        path: "/api/tags/album/remove",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "RemoveAlbumTagsRequest",
        response_type: "EmptyResponse",
    }
}

/// replace all tags for an album
pub async fn replace_album_tags_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<ReplaceAlbumTagsRequest>,
) -> Result<Json<EmptyResponse>, ApiError> {
    let response = replace_album_tags(&req.album_id, req.tag_ids).await;

    response
        .data
        .map(|_| Json(EmptyResponse::ok()))
        .ok_or_else(|| ApiError::Internal(response.message))
}

inventory::submit! {
    RouteInfo {
        name: "replace_album_tags",
        path: "/api/tags/album/replace",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ReplaceAlbumTagsRequest",
        response_type: "EmptyResponse",
    }
}
