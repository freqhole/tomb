//! outbound `freqhole-admin/1` client
//!
//! sends an `AdminMessage::Request` to a remote peer and parses the
//! `AdminMessage::Response`. one bi-stream per request.
//!
//! used by the wizard `RemoteAdminTransport`. complements
//! `admin_handler::handle_incoming` on the server side.
//!
//! see docs/wizard-remote-admin.md.

use crate::config::get_config;
use crate::error::{ErrorDetail, GrimoireError, GrimoireResult};
use crate::federation::p2p_client::parse_peer_address;
use crate::federation::transport::admin_protocol::{AdminMessage, ADMIN_ALPN};
use crate::response::GrimoireResponse;

use serde_json::Value as JsonValue;
use std::sync::atomic::{AtomicU64, Ordering};
use tracing::debug;

static REQUEST_ID: AtomicU64 = AtomicU64::new(1);

/// send an admin command to a remote peer over `freqhole-admin/1`.
///
/// connects via the federation endpoint (must already be initialized via
/// `p2p_client::set_federation_endpoint`). returns a fully-shaped
/// `GrimoireResponse<JsonValue>` mirroring what the local
/// `admin_dispatch::handle()` would return.
pub async fn send_admin_request(
    peer_addr: &str,
    command: &str,
    args: JsonValue,
) -> GrimoireResult<GrimoireResponse<JsonValue>> {
    let endpoint = crate::federation::p2p_client::get_endpoint_arc()?;
    let addr = parse_peer_address(peer_addr)?;
    let node_id_short = &addr.id.to_string()[..16.min(addr.id.to_string().len())];

    let id = REQUEST_ID.fetch_add(1, Ordering::SeqCst);

    debug!(
        "[admin-p2p-client] {} to {} (id={})",
        command, node_id_short, id
    );

    let conn = endpoint
        .connect(addr.clone(), ADMIN_ALPN)
        .await
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!(
                "failed to connect to admin endpoint on {}: {}",
                node_id_short, e
            ),
        })?;

    let (mut send, mut recv) =
        conn.open_bi()
            .await
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to open admin stream: {}", e),
            })?;

    let request = AdminMessage::Request {
        id,
        command: command.to_string(),
        args,
    };
    let req_bytes =
        serde_json::to_vec(&request).map_err(|e| GrimoireError::FederationApiError {
            message: format!("failed to serialize admin request: {}", e),
        })?;

    send.write_all(&req_bytes)
        .await
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("failed to write admin request: {}", e),
        })?;
    send.finish()
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("failed to finish admin request: {}", e),
        })?;

    // mirror the server-side max — fall back to remote_admin's cap if local
    // config has the section, otherwise the federation default.
    let max_size = get_config()
        .federation
        .as_ref()
        .and_then(|f| f.remote_admin.as_ref().map(|r| r.max_message_size_bytes()))
        .unwrap_or(16 * 1024 * 1024);

    let resp_bytes =
        recv.read_to_end(max_size)
            .await
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to read admin response: {}", e),
            })?;

    let msg: AdminMessage =
        serde_json::from_slice(&resp_bytes).map_err(|e| GrimoireError::FederationApiError {
            message: format!("failed to parse admin response: {}", e),
        })?;

    match msg {
        AdminMessage::Response {
            id: resp_id,
            success,
            data,
            message,
            errors,
        } => {
            if resp_id != id {
                return Ok(GrimoireResponse::failure(
                    "admin response id mismatch",
                    vec![ErrorDetail::new(
                        "id_mismatch",
                        "admin response id mismatch",
                        &format!("expected {}, got {}", id, resp_id),
                    )],
                ));
            }
            Ok(GrimoireResponse {
                success,
                message,
                data: Some(data),
                errors,
            })
        }
        AdminMessage::Request { .. } => Err(GrimoireError::FederationApiError {
            message: "received Request on admin client stream".to_string(),
        }),
    }
}
