//! Artist handlers

use axum::{extract::Extension, Json};
use grimoire::api_registry::{Domain, Method, RouteInfo};
use grimoire::music::entities::artists::{create_artist, Artist, CreateArtistRequest};

use crate::{auth::middleware::AuthenticatedUser, error::ApiError};

/// Create a new artist
pub async fn create_artist_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Json(mut req): Json<CreateArtistRequest>,
) -> Result<Json<Artist>, ApiError> {
    // inject authenticated user id
    req.created_by = Some(user.user_id);

    let response = create_artist(req).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "create_artist",
        path: "/api/music/artists",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "CreateArtistRequest",
        response_type: "Artist",
    }
}
