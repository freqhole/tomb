//! search API handlers

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::config::MusicBrainzConfig;
use crate::error::ErrorDetail;
use crate::music::musicbrainz::{
    GetReleaseRequest, MbCoverArtImage, MbReleaseDetail, MbSearchReleasesResponse,
    MusicBrainzClient, ReleaseSearchQuery, SearchReleasesRequest,
};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::search::{get_suggestions, search, SearchRequest, SuggestionsRequest};
use crate::users::UserRole;
use serde_json::Value as JsonValue;

/// route metadata for search
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "search",
        path: "/api/music/search",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SearchRequest",
        response_type: "SearchResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "suggestions",
        path: "/api/music/suggestions",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SuggestionsRequest",
        response_type: "SuggestionsResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "search_musicbrainz_releases",
        path: "/api/musicbrainz/search/releases",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SearchReleasesRequest",
        response_type: "MbSearchReleasesResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "get_musicbrainz_release",
        path: "/api/musicbrainz/release",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetReleaseRequest",
        response_type: "MbReleaseDetail",
        auth: RouteAuth::Role(UserRole::Admin),
    },
];

/// full-text search
///
/// path: POST /api/music/search
pub async fn search_handler(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: SearchRequest = match serde_json::from_value(body) {
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

    let user_id = Some(caller.user_id.as_str());
    let response = search(req, user_id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// search suggestions (typeahead)
///
/// path: POST /api/music/suggestions
pub async fn suggestions(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: SuggestionsRequest = match serde_json::from_value(body) {
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

    let user_id = Some(caller.user_id.as_str());
    let response = get_suggestions(req, user_id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// search musicbrainz releases
///
/// path: POST /api/musicbrainz/search/releases
pub async fn musicbrainz_search_releases(
    caller: &Caller,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: SearchReleasesRequest = match serde_json::from_value(body) {
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

    let client = match MusicBrainzClient::new(MusicBrainzConfig { enabled: true, ..Default::default() }) {
        Ok(c) => c,
        Err(e) => {
            return GrimoireResponse::failure(
                "musicbrainz not available",
                vec![ErrorDetail::new(
                    "musicbrainz_error",
                    "musicbrainz not configured",
                    &e.to_string(),
                )],
            )
        }
    };

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
    response.map(|data| serde_json::to_value(MbSearchReleasesResponse::from(data)).unwrap())
}

/// get musicbrainz release by mbid
///
/// path: POST /api/musicbrainz/release
pub async fn musicbrainz_get_release(
    caller: &Caller,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: GetReleaseRequest = match serde_json::from_value(body) {
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

    let client = match MusicBrainzClient::new(MusicBrainzConfig { enabled: true, ..Default::default() }) {
        Ok(c) => c,
        Err(e) => {
            return GrimoireResponse::failure(
                "musicbrainz not available",
                vec![ErrorDetail::new(
                    "musicbrainz_error",
                    "musicbrainz not configured",
                    &e.to_string(),
                )],
            )
        }
    };

    let response = client.get_release(&req.mbid).await;
    if !response.success {
        return GrimoireResponse::failure(&response.message, response.errors);
    }

    let mut detail = match response.data {
        Some(data) => MbReleaseDetail::from(data),
        None => {
            return GrimoireResponse::failure(
                "lookup succeeded but returned no data",
                vec![ErrorDetail::new(
                    "no_data",
                    "no data",
                    "musicbrainz lookup returned no data",
                )],
            )
        }
    };

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

    GrimoireResponse::success("release fetched", serde_json::to_value(detail).unwrap())
}
