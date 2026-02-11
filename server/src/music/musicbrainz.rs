//! musicbrainz handlers

use axum::{extract::Extension, Json};
use grimoire::api_registry::{Domain, Method, RouteInfo};
use grimoire::music::musicbrainz::{
    GetReleaseRequest, MbCoverArtImage, MbReleaseDetail, MbSearchReleasesResponse,
    ReleaseSearchQuery, SearchReleasesRequest,
};

use crate::{auth::middleware::AuthenticatedUser, error::ApiError, AppState};

/// check if any error detail indicates a rate limit issue
fn is_rate_limit_error(errors: &[grimoire::error::ErrorDetail]) -> bool {
    errors.iter().any(|e| {
        e.error_type == "music_brainz_rate_limit"
            || e.detail.contains("rate limit")
            || e.detail.contains("503")
            || e.detail.contains("429")
    })
}

/// search for releases (albums) on musicbrainz
pub async fn search_releases_handler(
    Extension(state): Extension<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<SearchReleasesRequest>,
) -> Result<Json<MbSearchReleasesResponse>, ApiError> {
    let client = state.musicbrainz_client.as_ref().ok_or_else(|| {
        ApiError::Internal("musicbrainz integration is not available".to_string())
    })?;

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

    if !response.success {
        let error_details: Vec<String> = response
            .errors
            .iter()
            .map(|e| format!("{}: {} - {}", e.error_type, e.title, e.detail))
            .collect();
        let detail_str = error_details.join("; ");
        let msg = format!(
            "{}{}",
            response.message,
            if detail_str.is_empty() {
                String::new()
            } else {
                format!(" ({})", detail_str)
            }
        );

        if is_rate_limit_error(&response.errors) {
            tracing::warn!("musicbrainz search_releases rate limited: {}", msg);
            return Err(ApiError::RateLimited(msg));
        }

        tracing::error!("musicbrainz search_releases failed: {}", msg);
        return Err(ApiError::Internal(msg));
    }

    response
        .data
        .ok_or_else(|| ApiError::Internal("search succeeded but returned no data".to_string()))
        .map(|data| Json(MbSearchReleasesResponse::from(data)))
}

inventory::submit! {
    RouteInfo {
        name: "search_musicbrainz_releases",
        path: "/api/musicbrainz/search/releases",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SearchReleasesRequest",
        response_type: "MbSearchReleasesResponse",
    }
}

/// get a specific release by mbid
pub async fn get_release_handler(
    Extension(state): Extension<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<GetReleaseRequest>,
) -> Result<Json<MbReleaseDetail>, ApiError> {
    let client = state.musicbrainz_client.as_ref().ok_or_else(|| {
        ApiError::Internal("musicbrainz integration is not available".to_string())
    })?;

    let response = client.get_release(&req.mbid).await;

    if !response.success {
        let error_details: Vec<String> = response
            .errors
            .iter()
            .map(|e| format!("{}: {} - {}", e.error_type, e.title, e.detail))
            .collect();
        let detail_str = error_details.join("; ");
        let msg = format!(
            "{}{}",
            response.message,
            if detail_str.is_empty() {
                String::new()
            } else {
                format!(" ({})", detail_str)
            }
        );

        if is_rate_limit_error(&response.errors) {
            tracing::warn!(
                "musicbrainz get_release rate limited (mbid={}): {}",
                req.mbid,
                msg
            );
            return Err(ApiError::RateLimited(msg));
        }

        tracing::error!(
            "musicbrainz get_release failed (mbid={}): {}",
            req.mbid,
            msg
        );
        return Err(ApiError::Internal(msg));
    }

    let mut detail = response
        .data
        .ok_or_else(|| ApiError::Internal("lookup succeeded but returned no data".to_string()))
        .map(MbReleaseDetail::from)?;

    // always try to fetch cover art from cover art archive
    // (release lookups don't include cover-art-archive info, so has_cover_art
    // may be false even when art exists — just try and handle the 404)
    let cover_art_response = client.get_cover_art(&req.mbid).await;
    if let Some(images) = cover_art_response.data {
        if !images.is_empty() {
            detail.has_cover_art = true;
            detail.cover_art_images = images.into_iter().map(MbCoverArtImage::from).collect();
        }
    }

    Ok(Json(detail))
}

inventory::submit! {
    RouteInfo {
        name: "get_musicbrainz_release",
        path: "/api/musicbrainz/release",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetReleaseRequest",
        response_type: "MbReleaseDetail",
    }
}
