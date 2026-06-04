//! cross-remote relation/walk API handlers — phase 11.
//!
//! exposes the read-side primitives that power the graph
//! visualization's cross-remote walk + entity-merge machinery.
//!
//! routes:
//! * `POST /api/music/relations/albums-by-value` — fetch the full
//!   member set of a `(taxon_kind, taxon_value)` hub from a remote.
//! * `POST /api/music/entities/taxons` — batched taxon lookup for
//!   many album ids in one round-trip.
//! * `POST /api/music/relations/by-merged-key` — resolve a canonical
//!   merge key (`artist_lower::title_lower` for albums, `name_lower`
//!   for artists) to local entities, used to fold remote entities
//!   into their local counterparts.

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::music::crud::AlbumQueryResult;
use crate::music::entities::albums::Album;
use crate::music::entities::artists::Artist;
use crate::music::entities::relations::{
    find_albums_by_merged_key, find_artists_by_merged_key, get_album_taxons_batch,
    list_albums_by_taxon_value, list_albums_in_era_bin, list_era_bins, list_recently_added_albums,
    list_unassigned_albums, EraBin,
};
use crate::music::entities::taxonomy::TaxonRef;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use zod_gen_derive::ZodSchema;

/// route metadata.
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "albums_by_value",
        path: "/api/music/relations/albums-by-value",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "AlbumsByValueRequest",
        response_type: "AlbumsByValueResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "entity_taxons_batch",
        path: "/api/music/entities/taxons",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "EntityTaxonsBatchRequest",
        response_type: "EntityTaxonsBatchResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "find_by_merged_key",
        path: "/api/music/relations/by-merged-key",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "FindByMergedKeyRequest",
        response_type: "FindByMergedKeyResponse",
        auth: RouteAuth::Authenticated,
    },
    // ---- phase 22: synthesized first-order hubs ----
    RouteInfo {
        name: "era_bins",
        path: "/api/music/relations/era-bins",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "EraBinsRequest",
        response_type: "EraBinsResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "recently_added_albums",
        path: "/api/music/relations/recently-added-albums",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "RecentlyAddedAlbumsRequest",
        response_type: "RecentlyAddedAlbumsResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "era_albums",
        path: "/api/music/relations/era-albums",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "EraAlbumsRequest",
        response_type: "EraAlbumsResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "unassigned_albums",
        path: "/api/music/relations/unassigned-albums",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "UnassignedAlbumsRequest",
        response_type: "UnassignedAlbumsResponse",
        auth: RouteAuth::Authenticated,
    },
];

/// cap on ids/keys per batch request — keeps json_each scans
/// reasonable and bounds response size.
const BATCH_MAX_IDS: usize = 2000;

// ---- albums-by-value ----

/// list-albums-by-taxon-value request payload.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AlbumsByValueRequest {
    /// taxon-kind slug (e.g. `"genre"`, `"mood"`, `"era"`).
    pub kind: String,
    /// the value as the client already normalized it. matched against
    /// either the taxon's slug or its label (case-insensitive).
    pub value_norm: String,
    /// optional page size, default 200, capped server-side at 1000.
    pub limit: Option<u32>,
    /// optional offset; future-proofing for cursor-based paging.
    pub offset: Option<u32>,
}

/// list-albums-by-taxon-value response wrapper.
///
/// returns the enriched `AlbumQueryResult` shape (album + artist +
/// images + favorites/rating) so the graph view can render
/// walk-pulled albums without per-item follow-up fetches. matches
/// what `query_albums` already produces for the regular albums
/// listing route, so the client can use a single adapter.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AlbumsByValueResponse {
    pub kind: String,
    pub value_norm: String,
    pub albums: Vec<AlbumQueryResult>,
    /// total count returned in this page. callers should request the
    /// next page when this equals `limit`.
    pub count: u32,
}

/// path: POST /api/music/relations/albums-by-value
pub async fn albums_by_value(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: AlbumsByValueRequest = match serde_json::from_value(body) {
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

    let resp = list_albums_by_taxon_value(
        &req.kind,
        &req.value_norm,
        req.limit,
        req.offset,
        Some(caller.user_id.as_str()),
    )
    .await;
    resp.map(|albums| {
        let count = albums.len() as u32;
        serde_json::to_value(AlbumsByValueResponse {
            kind: req.kind,
            value_norm: req.value_norm,
            albums,
            count,
        })
        .unwrap()
    })
}

// ---- entity-taxons-batch ----

/// entity-taxons-batch request payload.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct EntityTaxonsBatchRequest {
    /// `"album"` is currently the only supported value. `"artist"`
    /// returns an empty map (artist-level taxons are derived
    /// client-side from album membership for now).
    pub entity_kind: String,
    pub entity_ids: Vec<String>,
}

/// one entry per requested entity id; ids that have no taxons (or
/// don't exist) appear with an empty `taxons` vec.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct EntityTaxonsEntry {
    pub entity_id: String,
    pub taxons: Vec<TaxonRef>,
}

/// entity-taxons-batch response.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct EntityTaxonsBatchResponse {
    pub entity_kind: String,
    pub entries: Vec<EntityTaxonsEntry>,
}

/// path: POST /api/music/entities/taxons
pub async fn entity_taxons_batch(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: EntityTaxonsBatchRequest = match serde_json::from_value(body) {
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

    if req.entity_ids.len() > BATCH_MAX_IDS {
        return GrimoireResponse::failure(
            "too many ids",
            vec![ErrorDetail::new(
                "too_many_ids",
                "too many ids",
                &format!(
                    "got {}, max {} per batch",
                    req.entity_ids.len(),
                    BATCH_MAX_IDS
                ),
            )],
        );
    }

    match req.entity_kind.as_str() {
        "album" => {
            // dedup while preserving order so we can fill missing
            // entries with empty vecs in the final response.
            let mut seen = std::collections::HashSet::with_capacity(req.entity_ids.len());
            let mut order: Vec<String> = Vec::with_capacity(req.entity_ids.len());
            for id in &req.entity_ids {
                if seen.insert(id.clone()) {
                    order.push(id.clone());
                }
            }

            let resp = get_album_taxons_batch(&order).await;
            resp.map(|mut map| {
                let entries: Vec<EntityTaxonsEntry> = order
                    .into_iter()
                    .map(|id| {
                        let taxons = map.remove(&id).unwrap_or_default();
                        EntityTaxonsEntry {
                            entity_id: id,
                            taxons,
                        }
                    })
                    .collect();
                serde_json::to_value(EntityTaxonsBatchResponse {
                    entity_kind: req.entity_kind,
                    entries,
                })
                .unwrap()
            })
        }
        "artist" => {
            // artists don't have direct taxon links yet; clients
            // derive artist-level taxons by unioning their albums'
            // taxons. return an empty map so the route is forward-
            // compatible without lying about the data.
            let entries: Vec<EntityTaxonsEntry> = req
                .entity_ids
                .iter()
                .cloned()
                .map(|id| EntityTaxonsEntry {
                    entity_id: id,
                    taxons: Vec::new(),
                })
                .collect();
            GrimoireResponse::success(
                "artist taxons not yet supported; returning empty",
                serde_json::to_value(EntityTaxonsBatchResponse {
                    entity_kind: req.entity_kind,
                    entries,
                })
                .unwrap(),
            )
        }
        other => GrimoireResponse::failure(
            "unsupported entity kind",
            vec![ErrorDetail::new(
                "bad_request",
                "unsupported entity kind",
                &format!("entity_kind must be 'album' or 'artist', got {}", other),
            )],
        ),
    }
}

// ---- find-by-merged-key ----

/// find-by-merged-key request payload.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct FindByMergedKeyRequest {
    /// `"album"` or `"artist"`. determines how the merge key is
    /// matched server-side: albums match against
    /// `LOWER(artist_name) || '::' || LOWER(album_title)`, artists
    /// against `LOWER(name)`.
    pub entity_kind: String,
    /// canonical merge keys (already lowercased + delimited by the
    /// caller).
    pub keys: Vec<String>,
}

/// one match group keyed by the requested merge key. `albums` and
/// `artists` are mutually exclusive — only the field matching
/// `entity_kind` is populated.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct MergedKeyMatch {
    pub merged_key: String,
    pub albums: Vec<Album>,
    pub artists: Vec<Artist>,
}

/// find-by-merged-key response.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct FindByMergedKeyResponse {
    pub entity_kind: String,
    pub matches: Vec<MergedKeyMatch>,
}

/// path: POST /api/music/relations/by-merged-key
pub async fn find_by_merged_key(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: FindByMergedKeyRequest = match serde_json::from_value(body) {
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

    if req.keys.len() > BATCH_MAX_IDS {
        return GrimoireResponse::failure(
            "too many keys",
            vec![ErrorDetail::new(
                "too_many_keys",
                "too many keys",
                &format!("got {}, max {} per batch", req.keys.len(), BATCH_MAX_IDS),
            )],
        );
    }

    // dedup keys while preserving caller order so the response is
    // predictable for the client merge code.
    let mut seen = std::collections::HashSet::with_capacity(req.keys.len());
    let mut order: Vec<String> = Vec::with_capacity(req.keys.len());
    for k in &req.keys {
        if seen.insert(k.clone()) {
            order.push(k.clone());
        }
    }

    match req.entity_kind.as_str() {
        "album" => {
            let resp = find_albums_by_merged_key(&order).await;
            resp.map(|mut map: HashMap<String, Vec<Album>>| {
                let matches: Vec<MergedKeyMatch> = order
                    .into_iter()
                    .map(|k| MergedKeyMatch {
                        albums: map.remove(&k).unwrap_or_default(),
                        artists: Vec::new(),
                        merged_key: k,
                    })
                    .collect();
                serde_json::to_value(FindByMergedKeyResponse {
                    entity_kind: req.entity_kind,
                    matches,
                })
                .unwrap()
            })
        }
        "artist" => {
            let resp = find_artists_by_merged_key(&order).await;
            resp.map(|mut map: HashMap<String, Vec<Artist>>| {
                let matches: Vec<MergedKeyMatch> = order
                    .into_iter()
                    .map(|k| MergedKeyMatch {
                        artists: map.remove(&k).unwrap_or_default(),
                        albums: Vec::new(),
                        merged_key: k,
                    })
                    .collect();
                serde_json::to_value(FindByMergedKeyResponse {
                    entity_kind: req.entity_kind,
                    matches,
                })
                .unwrap()
            })
        }
        other => GrimoireResponse::failure(
            "unsupported entity kind",
            vec![ErrorDetail::new(
                "bad_request",
                "unsupported entity kind",
                &format!("entity_kind must be 'album' or 'artist', got {}", other),
            )],
        ),
    }
}

// ---- phase 22: synthesized first-order hubs ----

/// era-bins request — no parameters yet; bin-size targets are
/// fixed server-side for v1.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct EraBinsRequest {
    /// optional soft minimum albums per bin (default 10). currently
    /// advisory only — the binning heuristic is not yet implemented.
    pub target_min: Option<u32>,
    /// optional soft maximum albums per bin (default 32). currently
    /// advisory only.
    pub target_max: Option<u32>,
}

/// era-bins response.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct EraBinsResponse {
    pub bins: Vec<EraBin>,
    pub count: u32,
}

/// path: POST /api/music/relations/era-bins
///
/// **stub:** see [`crate::music::entities::relations::list_era_bins`].
/// returns an empty `bins` vec until the greedy decade-aware binning
/// heuristic lands (phase 22). client can ship the hub-rendering
/// wiring against this route now and degrade gracefully to zero
/// bins.
pub async fn era_bins(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    // body is optional — accept either an explicit object, null, or
    // a missing field. unknown fields are ignored.
    let req: EraBinsRequest = if body.is_null() {
        EraBinsRequest {
            target_min: None,
            target_max: None,
        }
    } else {
        match serde_json::from_value(body) {
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
        }
    };

    let resp = list_era_bins(req.target_min, req.target_max).await;
    resp.map(|bins| {
        let count = bins.len() as u32;
        serde_json::to_value(EraBinsResponse { bins, count }).unwrap()
    })
}

/// recently-added-albums request.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RecentlyAddedAlbumsRequest {
    /// page size; default 32, capped server-side at 256.
    pub limit: Option<u32>,
}

/// recently-added-albums response — same enriched album shape as
/// [`AlbumsByValueResponse::albums`].
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RecentlyAddedAlbumsResponse {
    pub albums: Vec<AlbumQueryResult>,
    pub count: u32,
}

/// path: POST /api/music/relations/recently-added-albums
pub async fn recently_added_albums(
    caller: &Caller,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let req: RecentlyAddedAlbumsRequest = if body.is_null() {
        RecentlyAddedAlbumsRequest { limit: None }
    } else {
        match serde_json::from_value(body) {
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
        }
    };

    let resp = list_recently_added_albums(req.limit, Some(caller.user_id.as_str())).await;
    resp.map(|albums| {
        let count = albums.len() as u32;
        serde_json::to_value(RecentlyAddedAlbumsResponse { albums, count }).unwrap()
    })
}

/// era-albums request — fan out one era bin to its member albums.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct EraAlbumsRequest {
    /// inclusive lower year of the bin (from `EraBin.min_year`).
    pub min_year: i32,
    /// inclusive upper year of the bin (from `EraBin.max_year`).
    pub max_year: i32,
    /// page size; default 200, capped server-side at 1000.
    pub limit: Option<u32>,
    /// optional offset for paging.
    pub offset: Option<u32>,
}

/// era-albums response — same enriched album shape as
/// [`AlbumsByValueResponse::albums`].
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct EraAlbumsResponse {
    pub min_year: i32,
    pub max_year: i32,
    pub albums: Vec<AlbumQueryResult>,
    pub count: u32,
}

/// path: POST /api/music/relations/era-albums
pub async fn era_albums(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: EraAlbumsRequest = match serde_json::from_value(body) {
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

    let resp = list_albums_in_era_bin(
        req.min_year,
        req.max_year,
        req.limit,
        req.offset,
        Some(caller.user_id.as_str()),
    )
    .await;
    resp.map(|albums| {
        let count = albums.len() as u32;
        serde_json::to_value(EraAlbumsResponse {
            min_year: req.min_year,
            max_year: req.max_year,
            albums,
            count,
        })
        .unwrap()
    })
}

/// unassigned-albums request — fan out the synthesized "unassigned"
/// hub to its member albums.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UnassignedAlbumsRequest {
    /// when Some, only consider albums missing taxons of this kind;
    /// when None or empty, only consider albums missing taxons of any
    /// kind (fully untagged).
    pub kind_slug: Option<String>,
    /// page size; default 100, capped server-side at 500.
    pub limit: Option<u32>,
    /// optional offset for paging.
    pub offset: Option<u32>,
}

/// unassigned-albums response — same enriched album shape as
/// [`AlbumsByValueResponse::albums`].
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UnassignedAlbumsResponse {
    pub albums: Vec<AlbumQueryResult>,
    pub count: u32,
}

/// path: POST /api/music/relations/unassigned-albums
pub async fn unassigned_albums(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: UnassignedAlbumsRequest = if body.is_null() {
        UnassignedAlbumsRequest {
            kind_slug: None,
            limit: None,
            offset: None,
        }
    } else {
        match serde_json::from_value(body) {
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
        }
    };

    let kind = req
        .kind_slug
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());

    let resp =
        list_unassigned_albums(kind, req.limit, req.offset, Some(caller.user_id.as_str())).await;
    resp.map(|albums| {
        let count = albums.len() as u32;
        serde_json::to_value(UnassignedAlbumsResponse { albums, count }).unwrap()
    })
}
