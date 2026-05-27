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
use crate::music::entities::artists::get_artist;
use crate::music::entities::related_artists::{
    list_incoming_for_artist, list_related_for_artist, list_related_for_artists, name_key,
    set_related_bandcamp, BandcampAlbumLink, ExternalUrl, IncomingRelatedArtistRow, RelatedArtist,
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
    /// when true, include rows with `status = 'pending'` alongside
    /// accepted ones. defaults to false to preserve the legacy
    /// accepted-only behaviour for callers that haven't opted in
    /// (e.g. the enrichment review panel).
    #[serde(default)]
    pub include_pending: Option<bool>,
    /// when true, also include rows where *other* local artists
    /// list the queried artist as related (the reverse direction).
    /// merged with outgoing rows server-side, deduped by the
    /// "other artist" key. defaults to false for back-compat.
    #[serde(default)]
    pub include_incoming: Option<bool>,
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
    /// `"outgoing"` — the queried artist lists the related artist;
    /// `"incoming"` — the related artist lists the queried artist;
    /// `"both"`     — each lists the other (merged from two rows).
    pub direction: String,
    /// review state of the underlying row: `"accepted"` or
    /// `"pending"`. for `"both"` entries, this is the *best* status
    /// across the merged rows (accepted wins over pending).
    pub status: String,
    pub fetched_at: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<RelatedArtist> for RelatedArtistApi {
    fn from(r: RelatedArtist) -> Self {
        let bandcamp_albums = r.bandcamp_albums();
        let external_urls = r.external_urls();
        let in_library = r.in_library();
        let status = r.status.clone();
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
            direction: "outgoing".to_string(),
            status,
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
    /// when true, include `pending` rows alongside accepted. note:
    /// the batch endpoint does NOT perform the bidirectional merge
    /// (only `list` does); batch callers get outgoing-only rows.
    #[serde(default)]
    pub include_pending: Option<bool>,
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

    let include_pending = req.include_pending.unwrap_or(false);
    let include_incoming = req.include_incoming.unwrap_or(false);

    let outgoing_resp = list_related_for_artist(&req.artist_id, include_pending).await;
    let outgoing_rows = match outgoing_resp.data {
        Some(rows) => rows,
        None => {
            return GrimoireResponse::failure(outgoing_resp.message, outgoing_resp.errors);
        }
    };

    let mut items: Vec<RelatedArtistApi> = outgoing_rows
        .into_iter()
        .map(RelatedArtistApi::from)
        .collect();

    if include_incoming {
        // need the queried artist's display name to drive the
        // related_name_key fallback in `list_incoming_for_artist`.
        // if the artist lookup fails we skip the incoming merge
        // rather than blowing up the whole request — callers still
        // get outgoing rows.
        let artist_name = match get_artist(&req.artist_id).await.data {
            Some(a) => a.name,
            None => String::new(),
        };
        if !artist_name.is_empty() {
            let incoming_resp =
                list_incoming_for_artist(&req.artist_id, &artist_name, include_pending).await;
            if let Some(incoming_rows) = incoming_resp.data {
                merge_incoming(&mut items, incoming_rows, &req.artist_id);
            }
        }
    }

    // final sort: in-library first, then bidirectional, then by
    // score, then alpha. this matches and supersedes the per-query
    // ORDER BY since merged entries need re-sorting.
    items.sort_by(|a, b| {
        b.in_library
            .cmp(&a.in_library)
            .then((b.direction == "both").cmp(&(a.direction == "both")))
            .then(
                b.match_score
                    .partial_cmp(&a.match_score)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
            .then(
                a.related_name
                    .to_lowercase()
                    .cmp(&b.related_name.to_lowercase()),
            )
    });

    GrimoireResponse::success(
        "ok",
        serde_json::to_value(ListRelatedArtistsResponse {
            artist_id: req.artist_id,
            items,
        })
        .unwrap(),
    )
}

/// merge incoming rows into the outgoing-derived `items` list,
/// deduping by the "other artist" identity (related_artist_id when
/// set, falling back to related_name_key). matched entries are
/// upgraded to `direction = "both"` with the best `match_score` and
/// the best `status` (accepted wins). unmatched incoming rows are
/// appended as fresh `direction = "incoming"` entries with the
/// other artist's details pulled from the joined `artistz` row.
fn merge_incoming(
    items: &mut Vec<RelatedArtistApi>,
    incoming: Vec<IncomingRelatedArtistRow>,
    queried_artist_id: &str,
) {
    use std::collections::HashMap;

    // index existing items by both keys for O(1) lookup.
    let mut by_id: HashMap<String, usize> = HashMap::new();
    let mut by_namekey: HashMap<String, usize> = HashMap::new();
    for (idx, it) in items.iter().enumerate() {
        if let Some(rid) = &it.related_artist_id {
            by_id.insert(rid.clone(), idx);
        }
        if !it.related_name_key.is_empty() {
            by_namekey.entry(it.related_name_key.clone()).or_insert(idx);
        }
    }

    // group incoming rows by the "other artist" id (source_artist_id
    // on the incoming row) so multiple sources reporting the same
    // pairing collapse to a single merged entry.
    let mut grouped: HashMap<String, Vec<IncomingRelatedArtistRow>> = HashMap::new();
    for inc in incoming {
        grouped
            .entry(inc.row.source_artist_id.clone())
            .or_default()
            .push(inc);
    }

    for (other_id, group) in grouped {
        // best score + best status across the group.
        let mut best_score: Option<f64> = None;
        let mut any_accepted = false;
        let mut rep: Option<IncomingRelatedArtistRow> = None;
        for row in group {
            if let Some(s) = row.row.match_score {
                best_score = Some(match best_score {
                    Some(prev) => prev.max(s),
                    None => s,
                });
            }
            if row.row.status == "accepted" {
                any_accepted = true;
            }
            if rep.is_none() {
                rep = Some(row);
            }
        }
        let Some(rep) = rep else { continue };
        let other_name_key = name_key(&rep.source_name);

        // first try to match an existing outgoing entry by other-id.
        let mut matched_idx: Option<usize> = by_id.get(&other_id).copied();
        // fall back to name_key match (covers outgoing rows whose
        // related_artist_id was never backfilled).
        if matched_idx.is_none() && !other_name_key.is_empty() {
            matched_idx = by_namekey.get(&other_name_key).copied();
        }

        if let Some(idx) = matched_idx {
            let existing = &mut items[idx];
            existing.direction = "both".to_string();
            // accepted beats pending; otherwise leave alone.
            if any_accepted && existing.status != "accepted" {
                existing.status = "accepted".to_string();
            }
            // promote score upward when incoming is stronger.
            if let Some(s) = best_score {
                existing.match_score = Some(match existing.match_score {
                    Some(prev) => prev.max(s),
                    None => s,
                });
            }
            // backfill related_artist_id if the outgoing entry lost it.
            if existing.related_artist_id.is_none() {
                existing.related_artist_id = Some(other_id.clone());
                by_id.insert(other_id.clone(), idx);
            }
        } else {
            // new incoming-only entry. flip perspective so the api
            // row describes the "other" artist (the one who listed us).
            let status_str = if any_accepted {
                "accepted".to_string()
            } else {
                rep.row.status.clone()
            };
            let api = RelatedArtistApi {
                id: rep.row.id,
                source_artist_id: queried_artist_id.to_string(),
                related_artist_id: Some(other_id.clone()),
                related_name: rep.source_name,
                related_name_key: other_name_key.clone(),
                related_mbid: rep.source_mbid,
                source: rep.row.source,
                match_score: best_score.or(rep.row.match_score),
                // bandcamp / external / image describe the *related*
                // side of the underlying row (us, in the incoming
                // case), so they don't apply when describing the
                // other artist — leave empty.
                bandcamp_url: None,
                bandcamp_albums: Vec::new(),
                image_url: None,
                external_urls: Vec::new(),
                in_library: true,
                direction: "incoming".to_string(),
                status: status_str,
                fetched_at: rep.row.fetched_at,
                created_at: rep.row.created_at,
                updated_at: rep.row.updated_at,
            };
            let new_idx = items.len();
            by_id.insert(other_id, new_idx);
            if !other_name_key.is_empty() {
                by_namekey.entry(other_name_key).or_insert(new_idx);
            }
            items.push(api);
        }
    }
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

    let resp = list_related_for_artists(&order, req.include_pending.unwrap_or(false)).await;
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
