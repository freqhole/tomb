//! musicbrainz handlers

use axum::{extract::Extension, Json};
use grimoire::api_registry::{Domain, Method, RouteInfo};
use grimoire::music::musicbrainz::{
    GetReleaseRequest, MusicBrainzClient, ReleaseSearchQuery, SearchReleasesRequest,
};

use crate::{auth::middleware::AuthenticatedUser, error::ApiError, AppState};

/// search for releases (albums) on musicbrainz
pub async fn search_releases_handler(
    Extension(state): Extension<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<SearchReleasesRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // check if musicbrainz is enabled in config
    if !state.config.musicbrainz.enabled {
        return Err(ApiError::Internal(
            "musicbrainz integration is disabled in config".to_string(),
        ));
    }

    // use default internal config
    let client = MusicBrainzClient::new(state.config.musicbrainz.clone())
        .map_err(|e| ApiError::Internal(format!("failed to create musicbrainz client: {}", e)))?;

    // build query
    let mut query = ReleaseSearchQuery::new();

    if let Some(artist) = req.artist {
        query = query.artist(&artist);
    }

    if let Some(release) = req.release {
        query = query.release(&release);
    }

    if let Some(limit) = req.limit {
        query = query.limit(limit);
    }

    if let Some(offset) = req.offset {
        query = query.offset(offset);
    }

    let response = client.search_releases(&query).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .and_then(|data| {
            serde_json::to_value(&data)
                .map(Json)
                .map_err(|e| ApiError::Internal(format!("failed to serialize response: {}", e)))
        })
}

inventory::submit! {
    RouteInfo {
        name: "search_musicbrainz_releases",
        path: "/api/musicbrainz/search/releases",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SearchReleasesRequest",
        response_type: "serde_json::Value",
    }
}

/// get a specific release by mbid
pub async fn get_release_handler(
    Extension(state): Extension<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<GetReleaseRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // check if musicbrainz is enabled in config
    if !state.config.musicbrainz.enabled {
        return Err(ApiError::Internal(
            "musicbrainz integration is disabled in config".to_string(),
        ));
    }

    // use default internal config
    let client = MusicBrainzClient::new(state.config.musicbrainz.clone())
        .map_err(|e| ApiError::Internal(format!("failed to create musicbrainz client: {}", e)))?;

    let response = client.get_release(&req.mbid).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .and_then(|data| {
            serde_json::to_value(&data)
                .map(Json)
                .map_err(|e| ApiError::Internal(format!("failed to serialize response: {}", e)))
        })
}

inventory::submit! {
    RouteInfo {
        name: "get_musicbrainz_release",
        path: "/api/musicbrainz/release",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetReleaseRequest",
        response_type: "serde_json::Value",
    }
}
