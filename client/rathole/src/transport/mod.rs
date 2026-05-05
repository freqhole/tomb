//! transport seam — abstracts "where to call grimoire".
//!
//! m0 ships only `LocalTransport` (in-process grimoire calls). m5 will
//! add `RemoteTransport` over iroh p2p. call sites must only depend
//! on the trait, never on the concrete impl.

pub mod local;

use async_trait::async_trait;
use grimoire::response::GrimoireResponse;
use serde_json::Value as JsonValue;

#[async_trait]
pub trait Transport: Send + Sync {
    /// dispatch an admin command. mirrors
    /// `grimoire::admin_dispatch::handle(cmd, args, &caller)` exactly.
    async fn admin_dispatch(&self, cmd: &str, args: JsonValue) -> GrimoireResponse<JsonValue>;
}

pub use local::LocalTransport;
