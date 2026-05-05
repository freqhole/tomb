//! noop transport for the m0 wasm spike. always returns a
//! "not connected" failure response. swap for `MiddenTransport`
//! once iroh-p2p admin dispatch is wired through skein/midden.

use async_trait::async_trait;
use serde_json::Value as JsonValue;

use crate::ratcore::app::DispatchResponse;
use crate::ratcore::transport::Transport;

pub struct NoopTransport;

#[async_trait(?Send)]
impl Transport for NoopTransport {
    async fn admin_dispatch(&self, _cmd: &str, _args: JsonValue) -> DispatchResponse {
        DispatchResponse {
            success: false,
            message: "not connected — wasm shell is the m0 spike, no transport wired yet"
                .to_string(),
            data: None,
        }
    }
}
