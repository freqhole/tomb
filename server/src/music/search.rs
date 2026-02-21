//! search API handlers

use axum::{extract::Extension, Json};
use grimoire::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use grimoire::response::GrimoireResponse;
use grimoire::search::{
    get_suggestions, search, SearchRequest, SearchResponse, SuggestionsRequest, SuggestionsResponse,
};
use inventory;

use crate::auth::middleware::AuthenticatedUser;
use crate::error::ApiError;

// ============================================================================
// route registration
// ============================================================================

inventory::submit! {
    RouteInfo {
        name: "suggestions",
        path: "/api/music/suggestions",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SuggestionsRequest",
        response_type: "SuggestionsResponse",
        auth: RouteAuth::Authenticated,
    }
}

inventory::submit! {
    RouteInfo {
        name: "search",
        path: "/api/music/search",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SearchRequest",
        response_type: "SearchResponse",
        auth: RouteAuth::Authenticated,
    }
}

// ============================================================================
// handlers
// ============================================================================

/// autocomplete/suggestions endpoint for fast typeahead search
///
/// POST /api/music/suggestions
///
/// returns grouped suggestions with confidence scores and highlighted matches
pub async fn suggestions_handler(
    user: Option<Extension<AuthenticatedUser>>,
    Json(request): Json<SuggestionsRequest>,
) -> Result<Json<GrimoireResponse<SuggestionsResponse>>, ApiError> {
    let user_id = user.as_ref().map(|u| u.user_id.as_str());

    tracing::debug!(
        "suggestions: field={:?}, partial={}, user_id={:?}",
        request.field,
        request.partial,
        user_id
    );

    let response = get_suggestions(request, user_id).await;

    Ok(Json(response))
}

/// full search endpoint with pagination and filtering
///
/// POST /api/music/search
///
/// returns comprehensive search results across all entity types with user preferences applied
pub async fn search_handler(
    user: Option<Extension<AuthenticatedUser>>,
    Json(request): Json<SearchRequest>,
) -> Result<Json<GrimoireResponse<SearchResponse>>, ApiError> {
    let user_id = user.as_ref().map(|u| u.user_id.as_str());

    tracing::debug!(
        "search: query={}, field={:?}, page={:?}, user_id={:?}",
        request.query,
        request.field,
        request.page,
        user_id
    );

    let response = search(request, user_id).await;

    Ok(Json(response))
}
