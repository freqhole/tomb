//! authenticated radio discovery - the full station list (including
//! non-public stations) for a caller who actually resolved to a real
//! identity: a genuine HTTP session, or a registered iroh peer. mirrors
//! `offal::public::radio`'s anonymous `radio_stations` route, which only
//! ever shows `is_public` stations - see that module's doc comments for
//! why the two are split instead of one route branching on caller.

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::offal::caller::Caller;
use crate::radio::playlist::RadioItemKind;
use crate::response::GrimoireResponse;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use zod_gen_derive::ZodSchema;

/// request for `radio_submit_request` - any authenticated member may
/// submit to any station with `accepts_requests` set (deliberately
/// simpler than a per-station allowlist).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SubmitRadioRequestRequest {
    pub station_id: String,
    /// `"song"` | `"video"`
    pub kind: String,
    pub item_id: String,
}

/// request for `radio_list_requests`/`radio_clear_requests`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioStationRequestsRequest {
    pub station_id: String,
}

/// request for `radio_remove_request`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RemoveRadioRequestRequest {
    pub station_id: String,
    pub request_id: String,
}

/// one queued request, resolved with enough display metadata for the
/// client's "queue" tab to render a row identical in shape to a history
/// row.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioQueuedRequestInfo {
    pub id: String,
    /// `"song"` | `"video"`
    pub kind: String,
    pub item_id: String,
    pub requested_by: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_ms: Option<i64>,
    pub art_blob_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioRequestsListResponse {
    pub requests: Vec<RadioQueuedRequestInfo>,
}

pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "radio_stations_full",
        path: "/api/radio/stations/full",
        method: Method::GET,
        // `Domain::App` (not `Music`) so the generated client groups this
        // alongside its sibling `radioStations`/`radioInfo` in `client.app.*`,
        // matching where the caller actually looks for it - domain here is
        // just client codegen grouping, independent of which rust module
        // physically implements the dispatch.
        domain: Domain::App,
        request_type: "String",
        response_type: "RadioStationsResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "radio_submit_request",
        path: "/api/radio/requests/submit",
        method: Method::POST,
        domain: Domain::App,
        request_type: "SubmitRadioRequestRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "radio_list_requests",
        path: "/api/radio/requests/list",
        method: Method::POST,
        domain: Domain::App,
        request_type: "RadioStationRequestsRequest",
        response_type: "RadioRequestsListResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "radio_remove_request",
        path: "/api/radio/requests/remove",
        method: Method::POST,
        domain: Domain::App,
        request_type: "RemoveRadioRequestRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "radio_clear_requests",
        path: "/api/radio/requests/clear",
        method: Method::POST,
        domain: Domain::App,
        request_type: "RadioStationRequestsRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Authenticated,
    },
];

/// any authenticated caller (any role) can see every station, public or
/// not - `is_public` on `RadioStation` governs cross-node/peer tune-in
/// access, not intra-node member visibility (see its own doc comment).
pub async fn stations_full(_caller: &Caller, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    crate::offal::public::radio::stations_full().await
}

/// submit a member request to a station's in-memory queue (see
/// `crate::radio::requests`). checks: station exists + `accepts_requests`
/// is set + the requested kind is compatible with the station's
/// `content_mode` - the queue itself trusts the caller past that point
/// (no per-station allowlist beyond "authenticated").
pub async fn submit_request(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: SubmitRadioRequestRequest = match serde_json::from_value(body) {
        Ok(v) => v,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    e.to_string(),
                )],
            )
        }
    };

    let kind = match req.kind.as_str() {
        "song" => RadioItemKind::Song,
        "video" => RadioItemKind::Video,
        other => {
            return GrimoireResponse::failure(
                "invalid kind",
                vec![ErrorDetail::new(
                    "validation",
                    "invalid kind",
                    format!("kind must be \"song\" or \"video\", got \"{other}\""),
                )],
            )
        }
    };

    let station = match crate::radio::stations::get_station(&req.station_id).await {
        Ok(Some(s)) => s,
        Ok(None) => {
            return GrimoireResponse::failure(
                "station not found",
                vec![ErrorDetail::new(
                    "not_found",
                    "station not found",
                    format!("no station with id {}", req.station_id),
                )],
            )
        }
        Err(e) => return GrimoireResponse::failure("failed to look up station", vec![e.into()]),
    };

    if station.accepts_requests == 0 {
        return GrimoireResponse::failure(
            "station does not accept requests",
            vec![ErrorDetail::new(
                "validation",
                "station does not accept requests",
                format!("station {} has accepts_requests = false", req.station_id),
            )],
        );
    }

    let content_mode = station.content_mode.trim().to_ascii_lowercase();
    let incompatible = matches!(
        (kind, content_mode.as_str()),
        (RadioItemKind::Song, "video_only") | (RadioItemKind::Video, "audio_only")
    );
    if incompatible {
        return GrimoireResponse::failure(
            "request kind not accepted by this station",
            vec![ErrorDetail::new(
                "validation",
                "request kind not accepted by this station",
                format!(
                    "station content_mode is \"{content_mode}\", which does not accept \"{}\" requests",
                    req.kind
                ),
            )],
        );
    }

    crate::radio::requests::submit(&req.station_id, kind, req.item_id, caller.user_id.clone())
        .await;

    GrimoireResponse::success("request submitted", JsonValue::Null)
}

/// list every currently-queued request for a station, resolved with
/// display metadata (title/artist/album/art) so the client's "queue" tab
/// can render rows identical in shape to a history row. any authenticated
/// caller may list any station's queue (mirrors submit's permission
/// model - no per-station allowlist).
pub async fn list_requests(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RadioStationRequestsRequest = match serde_json::from_value(body) {
        Ok(v) => v,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new("bad_request", "bad request", e.to_string())],
            )
        }
    };

    let queued = crate::radio::requests::list(&req.station_id).await;
    let mut requests = Vec::with_capacity(queued.len());
    for r in queued {
        // best-effort metadata resolution: an item that's since become
        // unfetchable (deleted, etc.) still needs to be listed so it can
        // be deleted from the queue, not silently dropped from the response.
        let (title, artist, album, duration_ms, art_blob_id) =
            match crate::radio::playlist::fetch_track(r.kind, &r.item_id).await {
                Ok(track) => (
                    track.title,
                    track.artist,
                    track.album,
                    track.duration_ms,
                    track.art_blob_id,
                ),
                Err(_) => ("(unavailable)".to_string(), None, None, None, None),
            };
        requests.push(RadioQueuedRequestInfo {
            id: r.id,
            kind: r.kind.as_str().to_string(),
            item_id: r.item_id,
            requested_by: r.requested_by,
            title,
            artist,
            album,
            duration_ms,
            art_blob_id,
        });
    }

    match serde_json::to_value(RadioRequestsListResponse { requests }) {
        Ok(v) => GrimoireResponse::success("ok", v),
        Err(e) => GrimoireResponse::failure(
            "failed to serialize response",
            vec![ErrorDetail::new(
                "internal_error",
                "failed to serialize response",
                e.to_string(),
            )],
        ),
    }
}

/// remove one specific queued request. any authenticated caller may
/// remove any request from any station's queue - members and admins
/// alike (this is member-submitted content, not admin-owned
/// configuration).
pub async fn remove_request(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RemoveRadioRequestRequest = match serde_json::from_value(body) {
        Ok(v) => v,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new("bad_request", "bad request", e.to_string())],
            )
        }
    };

    let removed = crate::radio::requests::remove(&req.station_id, &req.request_id).await;
    if !removed {
        return GrimoireResponse::failure(
            "request not found",
            vec![ErrorDetail::new(
                "not_found",
                "request not found",
                format!(
                    "no queued request {} for station {}",
                    req.request_id, req.station_id
                ),
            )],
        );
    }
    GrimoireResponse::success("request removed", JsonValue::Null)
}

/// clear every queued request for a station at once. same permission
/// model as `remove_request`.
pub async fn clear_requests(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RadioStationRequestsRequest = match serde_json::from_value(body) {
        Ok(v) => v,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new("bad_request", "bad request", e.to_string())],
            )
        }
    };

    crate::radio::requests::clear(&req.station_id).await;
    GrimoireResponse::success("queue cleared", JsonValue::Null)
}

