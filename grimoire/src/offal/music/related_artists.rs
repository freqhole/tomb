//! related-artists API handlers — phase 13h.
//!
//! exposes the `related_artistz` cross-source index over http.
//!
//! routes:
//! * `POST /api/related-artists/list` → list rows for a source artist,
//!   each enriched with a derived `in_library` bool.
//! * `POST /api/related-artists/set-bandcamp` → admin-only manual
//!   override for a related artist's bandcamp profile + albums.

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::music::entities::related_artists::{
    list_related_for_artist, list_related_for_artists, set_related_bandcamp, BandcampAlbumLink,
    ExternalUrl, RelatedArtist,
};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use zod_gen_derive::ZodSchema;

/// route metadata
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "list_related_artists",
        path: "/api/related-artists/list",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ListRelatedArtistsRequest",
        response_type: "ListRelatedArtistsResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "list_related_artists_batch",
        path: "/api/related-artists/list-batch",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ListRelatedArtistsBatchRequest",
        response_type: "ListRelatedArtistsBatchResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "set_related_artist_bandcamp",
        path: "/api/related-artists/set-bandcamp",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SetRelatedArtistBandcampRequest",
        response_type: "RelatedArtistApi",
        auth: RouteAuth::Role(UserRole::Admin),
    },
];

/// list-related request payload.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListRelatedArtistsRequest {
    /// id of the local artist whose related-artist rows we want.
    pub artist_id: String,
}

/// set-bandcamp request payload.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SetRelatedArtistBandcampRequest {
    /// related-artist row id.
    pub id: String,
    /// new bandcamp profile url. `None` clears the field.
    pub bandcamp_url: Option<String>,
    /// new bandcamp album list. capped at 25 server-side.
    pub bandcamp_albums: Vec<BandcampAlbumLink>,
}

/// api shape for a related-artist row. mirrors the storage struct but
/// with the `_urlz` json strings parsed and an `in_library` bool
/// derived from `related_artist_id`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RelatedArtistApi {
    pub id: String,
    pub source_artist_id: String,
    pub related_artist_id: Option<String>,
    pub related_name: String,
    pub related_name_key: String,
    pub related_mbid: Option<String>,
    pub source: String,
    pub match_score: Option<f64>,
    pub bandcamp_url: Option<String>,
    pub bandcamp_albums: Vec<BandcampAlbumLink>,
    pub image_url: Option<String>,
    pub external_urls: Vec<ExternalUrl>,
    pub in_library: bool,
    pub fetched_at: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<RelatedArtist> for RelatedArtistApi {
    fn from(r: RelatedArtist) -> Self {
        let bandcamp_albums = r.bandcamp_albums();
        let external_urls = r.external_urls();
        let in_library = r.in_library();
        Self {
            id: r.id,
            source_artist_id: r.source_artist_id,
            related_artist_id: r.related_artist_id,
            related_name: r.related_name,
            related_name_key: r.related_name_key,
            related_mbid: r.related_mbid,
            source: r.source,
            match_score: r.match_score,
            bandcamp_url: r.bandcamp_url,
            bandcamp_albums,
            image_url: r.image_url,
            external_urls,
            in_library,
            fetched_at: r.fetched_at,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

/// list response wrapper.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListRelatedArtistsResponse {
    pub artist_id: String,
    pub items: Vec<RelatedArtistApi>,
}

/// batch-list request payload.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListRelatedArtistsBatchRequest {
    /// ids of the local artists whose related-artist rows we want.
    /// duplicates are tolerated server-side; capped to avoid huge
    /// queries (see `BATCH_MAX_IDS`).
    pub artist_ids: Vec<String>,
}

/// one entry in the batch response.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RelatedArtistsBatchEntry {
    pub artist_id: String,
    pub items: Vec<RelatedArtistApi>,
}

/// batch-list response: one entry per requested `artist_id`. entries
/// preserve request order; ids that yield no rows still appear with
/// an empty `items` vec.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListRelatedArtistsBatchResponse {
    pub entries: Vec<RelatedArtistsBatchEntry>,
}

/// cap on artist ids per batch request — keeps json_each scans
/// reasonable and bounds response size.
const BATCH_MAX_IDS: usize = 2000;

/// path: POST /api/related-artists/list
pub async fn list(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: ListRelatedArtistsRequest = match serde_json::from_value(body) {
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

    let resp = list_related_for_artist(&req.artist_id).await;
    resp.map(|rows| {
        let items: Vec<RelatedArtistApi> = rows.into_iter().map(RelatedArtistApi::from).collect();
        serde_json::to_value(ListRelatedArtistsResponse {
            artist_id: req.artist_id,
            items,
        })
        .unwrap()
    })
}

/// path: POST /api/related-artists/list-batch
///
/// returns related-artist rows for many source artists in one query.
/// preserves request order so callers can zip results back to inputs;
/// duplicates in the input are coalesced and ids that yield no rows
/// still appear with an empty `items` vec.
pub async fn list_batch(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: ListRelatedArtistsBatchRequest = match serde_json::from_value(body) {
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

    if req.artist_ids.len() > BATCH_MAX_IDS {
        return GrimoireResponse::failure(
            "too many ids",
            vec![ErrorDetail::new(
                "too_many_ids",
                "too many ids",
                &format!(
                    "got {}, max {} per batch",
                    req.artist_ids.len(),
                    BATCH_MAX_IDS
                ),
            )],
        );
    }

    // dedup while preserving first-seen order so the response matches
    // the request's intent without re-querying duplicate ids.
    let mut seen = std::collections::HashSet::with_capacity(req.artist_ids.len());
    let mut order: Vec<String> = Vec::with_capacity(req.artist_ids.len());
    for id in &req.artist_ids {
        if seen.insert(id.clone()) {
            order.push(id.clone());
        }
    }

    let resp = list_related_for_artists(&order).await;
    resp.map(|mut grouped| {
        let entries: Vec<RelatedArtistsBatchEntry> = order
            .into_iter()
            .map(|id| {
                let rows = grouped.remove(&id).unwrap_or_default();
                RelatedArtistsBatchEntry {
                    items: rows.into_iter().map(RelatedArtistApi::from).collect(),
                    artist_id: id,
                }
            })
            .collect();
        serde_json::to_value(ListRelatedArtistsBatchResponse { entries }).unwrap()
    })
}

/// path: POST /api/related-artists/set-bandcamp
pub async fn set_bandcamp(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: SetRelatedArtistBandcampRequest = match serde_json::from_value(body) {
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

    let resp = set_related_bandcamp(&req.id, req.bandcamp_url, req.bandcamp_albums).await;
    resp.map(|row| serde_json::to_value(RelatedArtistApi::from(row)).unwrap())
}
