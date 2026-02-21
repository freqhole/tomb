//! tags handlers

use axum::{extract::Extension, Json};
use grimoire::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use grimoire::music::entities::tags::{
    add_albums_tags, delete_tag, get_albums_tags, get_tag, list_tags, query_tags,
    remove_albums_tags, replace_albums_tags, AddAlbumsTagsRequest, DeleteTagRequest,
    GetAlbumsTagsRequest, GetTagRequest, QueryTagsRequest, RemoveAlbumsTagsRequest,
    ReplaceAlbumsTagsRequest, Tag,
};
use grimoire::users::UserRole;
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
        auth: RouteAuth::Authenticated,
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
        auth: RouteAuth::Authenticated,
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
        auth: RouteAuth::Authenticated,
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
        auth: RouteAuth::Role(UserRole::Admin),
    }
}

/// get tags for multiple albums
pub async fn get_albums_tags_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<GetAlbumsTagsRequest>,
) -> Result<Json<Vec<Tag>>, ApiError> {
    let response = get_albums_tags(req.album_ids).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "get_albums_tags",
        path: "/api/tags/albums/get",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetAlbumsTagsRequest",
        response_type: "Vec<Tag>",
        auth: RouteAuth::Authenticated,
    }
}

/// add tags to multiple albums
pub async fn add_albums_tags_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<AddAlbumsTagsRequest>,
) -> Result<Json<EmptyResponse>, ApiError> {
    let response = add_albums_tags(req).await;

    response
        .data
        .map(|_| Json(EmptyResponse::ok()))
        .ok_or_else(|| ApiError::Internal(response.message))
}

inventory::submit! {
    RouteInfo {
        name: "add_albums_tags",
        path: "/api/tags/albums/add",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "AddAlbumsTagsRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    }
}

/// remove tags from multiple albums
pub async fn remove_albums_tags_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<RemoveAlbumsTagsRequest>,
) -> Result<Json<EmptyResponse>, ApiError> {
    let response = remove_albums_tags(req.album_ids, req.tag_ids).await;

    response
        .data
        .map(|_| Json(EmptyResponse::ok()))
        .ok_or_else(|| ApiError::Internal(response.message))
}

inventory::submit! {
    RouteInfo {
        name: "remove_albums_tags",
        path: "/api/tags/albums/remove",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "RemoveAlbumsTagsRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    }
}

/// replace all tags for multiple albums
pub async fn replace_albums_tags_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<ReplaceAlbumsTagsRequest>,
) -> Result<Json<EmptyResponse>, ApiError> {
    let response = replace_albums_tags(req.album_ids, req.tag_ids).await;

    response
        .data
        .map(|_| Json(EmptyResponse::ok()))
        .ok_or_else(|| ApiError::Internal(response.message))
}

inventory::submit! {
    RouteInfo {
        name: "replace_albums_tags",
        path: "/api/tags/albums/replace",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ReplaceAlbumsTagsRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    }
}
