//! transport implementations for the web shell.
//!
//! - `NoopTransport`: returns a helpful "not connected" error. used
//!   when the page loads without a `?peer=<node_id>` query param.
//! - `MiddenTransport`: opens a `freqhole-admin/1` bi-stream to the
//!   given peer via the sibling `midden` crate (iroh-in-the-browser),
//!   serializes `AdminMessage::Request` (matching grimoire's wire
//!   format), awaits a `Response`, returns a `DispatchResponse`.
//!
//! server side is fully wired: grimoire's `AdminProtocol` registers
//! the alpn (gated by `[federation.remote_admin].enabled = true`),
//! resolves caller via peer node_id, and dispatches through
//! `admin_dispatch::handle`. see
//! `grimoire/src/federation/transport/admin_handler.rs`.

use async_trait::async_trait;
use js_sys::Uint8Array;
use midden::MiddenNode;
use serde_json::Value as JsonValue;
use std::cell::Cell;
use std::rc::Rc;
use wasm_bindgen::{JsError, JsValue};
use web_sys::console;

use crate::ratcore::app::DispatchResponse;
use crate::ratcore::transport::Transport;

pub struct NoopTransport;

#[async_trait(?Send)]
impl Transport for NoopTransport {
    async fn admin_dispatch(&self, _cmd: &str, _args: JsonValue) -> DispatchResponse {
        DispatchResponse {
            success: false,
            message: "not connected — pass `?peer=<node_id>` in the url to enable p2p".to_string(),
            data: None,
        }
    }
}

/// p2p transport backed by midden. one `MiddenNode` per page,
/// one bi-stream per dispatch (open_bi → write request → read response
/// → drop). matches grimoire's `send_admin_request` framing exactly.
///
/// max response size is 16 MiB (mirrors the server default for
/// `[federation.remote_admin].max_message_size_bytes`).
pub struct MiddenTransport {
    node: Rc<MiddenNode>,
    peer_addr: String,
    next_id: Cell<u64>,
}

impl MiddenTransport {
    pub fn new(node: Rc<MiddenNode>, peer_addr: String) -> Self {
        Self {
            node,
            peer_addr,
            next_id: Cell::new(0),
        }
    }
}

const ADMIN_ALPN: &str = "freqhole-admin/1";
const MAX_RESPONSE_BYTES: u32 = 16 * 1024 * 1024;

#[async_trait(?Send)]
impl Transport for MiddenTransport {
    async fn admin_dispatch(&self, cmd: &str, args: JsonValue) -> DispatchResponse {
        let id = self.next_id.get();
        self.next_id.set(id.wrapping_add(1));

        console::log_1(
            &format!(
                "rathole: admin_dispatch cmd={cmd} id={id} peer={}",
                short_addr(&self.peer_addr)
            )
            .into(),
        );

        let request = serde_json::json!({
            "type": "request",
            "id": id,
            "command": cmd,
            "args": args,
        });

        let req_bytes = match serde_json::to_vec(&request) {
            Ok(b) => b,
            Err(e) => return logged_fail(cmd, format!("serialize request: {e}")),
        };

        let stream = match self.node.open_bi(&self.peer_addr, ADMIN_ALPN).await {
            Ok(s) => s,
            Err(e) => return logged_fail(cmd, format!("open_bi: {}", js_err_str(e))),
        };

        if let Err(e) = stream.write_raw_and_finish(&req_bytes).await {
            return logged_fail(cmd, format!("write request: {}", js_err_str(e)));
        }

        let resp_js = match stream.read_to_end(MAX_RESPONSE_BYTES).await {
            Ok(v) => v,
            Err(e) => return logged_fail(cmd, format!("read response: {}", js_err_str(e))),
        };

        let resp_bytes = Uint8Array::new(&resp_js).to_vec();
        if resp_bytes.is_empty() {
            return logged_fail(cmd, "empty response from peer".to_string());
        }

        let resp_json: JsonValue = match serde_json::from_slice(&resp_bytes) {
            Ok(v) => v,
            Err(e) => return logged_fail(cmd, format!("parse response: {e}")),
        };

        // sanity: correlate request/response ids if present
        if let Some(resp_id) = resp_json.get("id").and_then(|v| v.as_u64()) {
            if resp_id != id {
                return logged_fail(
                    cmd,
                    format!("response id mismatch: sent {id}, got {resp_id}"),
                );
            }
        }

        let success = resp_json
            .get("success")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let message = resp_json
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let data = resp_json.get("data").cloned().filter(|v| !v.is_null());

        DispatchResponse {
            success,
            message,
            data,
        }
    }

    async fn public_dispatch(
        &self,
        method: &str,
        route: &str,
        body: JsonValue,
    ) -> DispatchResponse {
        console::log_1(
            &format!(
                "rathole: public_dispatch {method} {route} peer={}",
                short_addr(&self.peer_addr)
            )
            .into(),
        );

        let body_str = match serde_json::to_string(&body) {
            Ok(s) => s,
            Err(e) => return logged_fail(route, format!("serialize body: {e}")),
        };
        let resp = match self
            .node
            .proxy_request(&self.peer_addr, method, route, Some(body_str))
            .await
        {
            Ok(v) => v,
            Err(e) => return logged_fail(route, format!("proxy_request: {}", js_err_str(e))),
        };

        // resp is a JS object `{ status: u16, body: Option<String> }`.
        // round-trip through JSON.stringify to bring it back into serde-land
        // without pulling in `serde_wasm_bindgen` as a dep.
        let Some(json_str) = js_sys::JSON::stringify(&resp)
            .ok()
            .and_then(|s| s.as_string())
        else {
            return logged_fail(route, "could not stringify proxy_request response".to_string());
        };
        let parsed: JsonValue = match serde_json::from_str(&json_str) {
            Ok(v) => v,
            Err(e) => return logged_fail(route, format!("parse proxy response: {e}")),
        };
        let status = parsed
            .get("status")
            .and_then(JsonValue::as_u64)
            .unwrap_or(0);
        let body_str = parsed
            .get("body")
            .and_then(JsonValue::as_str)
            .unwrap_or("");
        if !(200..300).contains(&status) {
            return logged_fail(route, format!("http {status}: {body_str}"));
        }
        // grimoire endpoints wrap everything in `{ success, message, data, errors }`.
        // try to parse that envelope; if it doesn't look like one, hand back the
        // raw body as a successful response with `data = body`.
        match serde_json::from_str::<JsonValue>(body_str) {
            Ok(envelope) => {
                let success = envelope
                    .get("success")
                    .and_then(JsonValue::as_bool)
                    .unwrap_or(true);
                let message = envelope
                    .get("message")
                    .and_then(JsonValue::as_str)
                    .unwrap_or("")
                    .to_string();
                let data = envelope.get("data").cloned().filter(|v| !v.is_null());
                DispatchResponse {
                    success,
                    message,
                    data,
                }
            }
            Err(_) => DispatchResponse {
                success: true,
                message: format!("http {status}"),
                data: Some(JsonValue::String(body_str.to_string())),
            },
        }
    }
}

fn fail(message: String) -> DispatchResponse {
    DispatchResponse {
        success: false,
        message,
        data: None,
    }
}

/// `fail` + console.error so transport errors surface in devtools
/// (the tui collapses long messages into a single line).
fn logged_fail(cmd: &str, message: String) -> DispatchResponse {
    console::error_1(&format!("rathole: admin_dispatch cmd={cmd} FAILED: {message}").into());
    fail(message)
}

fn short_addr(addr: &str) -> String {
    let n = addr.len().min(16);
    format!("{}…", &addr[..n])
}

/// best-effort stringify for `JsError` — converts to `JsValue`, then to
/// String if possible, else uses Debug.
fn js_err_str(e: JsError) -> String {
    let v: JsValue = e.into();
    v.as_string().unwrap_or_else(|| format!("{v:?}"))
}
