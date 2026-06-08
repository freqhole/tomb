//! job-event subscribe + snapshot handlers (p3 of the bi-di plan).
//!
//! both routes accept an `EventFilter` body. snapshot returns the
//! current state of matching jobs as a single response; subscribe
//! returns a live stream of `JobEvent`s the caller is allowed to see.

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::jobs::job_events::{self, CloseReason, EventFilter};
use crate::offal::caller::Caller;
use crate::offal::EventStream;
use crate::response::GrimoireResponse;
use futures_util::StreamExt;
use serde_json::Value as JsonValue;

pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "events_snapshot",
        path: "/api/jobs/events/snapshot",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "EventFilter",
        response_type: "Vec<JobStateSnapshot>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "events_subscribe",
        path: "/api/jobs/events/subscribe",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "EventFilter",
        // wire shape: a stream of `JobEvent`s. transports frame each
        // item as one message (ws text frame, sse `data:`, iroh bi-stream
        // length-prefixed json). on `CloseReason::Lagged` the transport
        // closes the connection and the client re-snapshots + reconnects.
        response_type: "JobEvent",
        auth: RouteAuth::Authenticated,
    },
];

/// snapshot handler: returns the current state of every job matching
/// the filter that the caller is allowed to see.
///
/// path: POST /api/jobs/events/snapshot
pub async fn snapshot(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let filter: EventFilter = match serde_json::from_value(body) {
        Ok(f) => f,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "invalid EventFilter body",
                    e.to_string(),
                )],
            );
        }
    };
    let snaps = job_events::snapshot(&filter, caller).await;
    match serde_json::to_value(&snaps) {
        Ok(v) => GrimoireResponse::success("ok", v),
        Err(e) => GrimoireResponse::failure(
            "serialization error",
            vec![ErrorDetail::new(
                "serialization_error",
                "failed to serialize snapshot",
                e.to_string(),
            )],
        ),
    }
}

/// subscribe handler: returns a live stream of `JobEvent`s the caller
/// can see, pre-serialized to `JsonValue` so transports stay agnostic
/// to grimoire's event types.
///
/// path: POST /api/jobs/events/subscribe
///
/// note: this is synchronous (returns the stream immediately) — the
/// underlying broker `subscribe_filtered` is `fn`, not `async fn`.
pub fn subscribe(caller: Caller, body: JsonValue) -> EventStream {
    let filter: EventFilter = serde_json::from_value(body).unwrap_or_default();
    let stream = job_events::subscribe_filtered(filter, caller).map(|res| match res {
        Ok(evt) => serde_json::to_value(&evt)
            .map_err(|_| CloseReason::Internal("event serialization failed".to_string())),
        Err(reason) => Err(reason),
    });
    stream.boxed()
}
