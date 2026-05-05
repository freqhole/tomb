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
}
