//! transport seam — abstracts "where to dispatch admin commands".
//!
//! shells provide concrete impls:
//! - `tty::transport::LocalTransport` — in-process grimoire calls
//! - `web::transport::NoopTransport` — m0 spike stub
//! - future `MiddenTransport` — iroh p2p via skein/midden

use async_trait::async_trait;
use serde_json::Value as JsonValue;

use super::app::DispatchResponse;

#[async_trait(?Send)]
pub trait Transport {
    /// dispatch an admin command. mirrors the shape of
    /// `grimoire::admin_dispatch::handle(cmd, args, &caller)`.
    async fn admin_dispatch(&self, cmd: &str, args: JsonValue) -> DispatchResponse;

    /// dispatch a public/anonymous request to a route on the peer.
    /// `route` is the http-style path (e.g. `"/api/knock"`); `method`
    /// is `"GET"`, `"POST"`, etc. transports that don't have a public
    /// channel return a `DispatchResponse` with `success = false`.
    async fn public_dispatch(
        &self,
        method: &str,
        route: &str,
        body: JsonValue,
    ) -> DispatchResponse {
        let _ = (method, route, body);
        DispatchResponse {
            success: false,
            message: "transport does not support public_dispatch".to_string(),
            data: None,
        }
    }
}
