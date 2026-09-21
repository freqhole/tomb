//! authenticated radio discovery - the full station list (including
//! non-public stations) for a caller who actually resolved to a real
//! identity: a genuine HTTP session, or a registered iroh peer. mirrors
//! `offal::public::radio`'s anonymous `radio_stations` route, which only
//! ever shows `is_public` stations - see that module's doc comments for
//! why the two are split instead of one route branching on caller.

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

pub const ROUTES: &[RouteInfo] = &[RouteInfo {
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
}];

/// any authenticated caller (any role) can see every station, public or
/// not - `is_public` on `RadioStation` governs cross-node/peer tune-in
/// access, not intra-node member visibility (see its own doc comment).
pub async fn stations_full(_caller: &Caller, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    crate::offal::public::radio::stations_full().await
}
