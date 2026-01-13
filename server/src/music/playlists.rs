//! Playlist handlers

use axum::{extract::Extension, Json};
use grimoire::music::crud::{query_playlists, QueryParams};

use crate::{auth::middleware::AuthenticatedUser, error::ApiError};

/// List playlists
pub async fn list_playlists(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(params): Json<QueryParams>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let response = query_playlists(params).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(|data| Json(serde_json::to_value(data).unwrap()))
}
