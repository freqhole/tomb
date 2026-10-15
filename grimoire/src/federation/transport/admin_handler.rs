//! incoming `freqhole-admin/1` request handler
//!
//! gates incoming admin connections on:
//! 1. `[remote_admin].enabled = true` in federation config
//! 2. peer node_id resolves to a User with `role == Admin`
//! 3. if `[remote_admin].allowed_node_ids` is non-empty, the peer node_id
//!    must appear in it
//!
//! requests are deserialized as `AdminMessage::Request` and dispatched to
//! `admin_dispatch::handle()`. responses are serialized as
//! `AdminMessage::Response` and written back on the same bi-stream.
//!
//! gate 1 (feature disabled server-wide) still hard-closes the connection
//! - there's no admin capability for anyone to reach in that case. gates
//!   2/3 are per-caller instead: rather than closing the connection (which
//!   surfaced to spume as an opaque transport error with no classification
//!   at all - see AddToStationModal.tsx's own "forbidden just means this
//!   caller isn't an admin, not a real error" handling, which depends on a
//!   real `AdminCommandError` and never actually got one here), each stream
//!   on a not-authorized connection still gets a normal `AdminMessage::
//!   Response { success: false, errors: [{ error_type: "forbidden", .. }] }`,
//!   mirroring exactly what `admin_dispatch::helpers::forbidden()` returns
//!   for a role-gated command.
//!
//! see docs/wizard-remote-admin.md for the full plan.

use crate::admin_dispatch;
use crate::config::get_config;
use crate::error::ErrorDetail;
use crate::federation::transport::admin_protocol::AdminMessage;
use crate::offal::Caller;
use crate::users::UserService;

use iroh::PublicKey;
use serde_json::Value as JsonValue;
use tracing::{info, warn};

/// handle an incoming admin connection from a peer
pub async fn handle_incoming(peer_node_id: PublicKey, conn: iroh::endpoint::Connection) {
    let node_id_str = peer_node_id.to_string();
    let node_id_short = &node_id_str[..16.min(node_id_str.len())];

    // gate 1: feature must be enabled server-wide - no admin capability
    // exists for anyone in this case, so a hard close is appropriate.
    let admin_cfg = match get_config()
        .federation
        .as_ref()
        .and_then(|f| f.remote_admin.clone())
    {
        Some(cfg) if cfg.enabled => cfg,
        _ => {
            warn!(
                "[admin-p2p] rejecting connection from {}: remote_admin disabled",
                node_id_short
            );
            conn.close(1u32.into(), b"remote_admin disabled");
            return;
        }
    };

    // gates 2 (peer resolves to an admin user) and 3 (optional allowlist)
    // are per-caller - rather than hard-closing the connection, keep it
    // open and reply to each stream with a clean forbidden response (see
    // the module doc comment above for why).
    let caller_or_reason: Result<Caller, &'static str> =
        match resolve_admin_caller(&node_id_str).await {
            Some(caller) if admin_cfg.is_allowed_node(&node_id_str) => Ok(caller),
            Some(_) => Err("node not in remote_admin.allowed_node_ids"),
            None => Err("admin role required"),
        };

    match &caller_or_reason {
        Ok(caller) => info!(
            "[admin-p2p] accepted admin connection from {} (user={})",
            node_id_short, caller.username
        ),
        Err(reason) => warn!(
            "[admin-p2p] {} is not authorized ({}) - replying forbidden on each stream",
            node_id_short, reason
        ),
    }

    // accept streams in a loop
    let max_size = admin_cfg.max_message_size_bytes();
    loop {
        match conn.accept_bi().await {
            Ok((send, recv)) => {
                let caller_or_reason = caller_or_reason.clone();
                let node_id_short = node_id_short.to_string();
                tokio::spawn(async move {
                    let result = match &caller_or_reason {
                        Ok(caller) => {
                            handle_stream(send, recv, caller, &node_id_short, max_size).await
                        }
                        Err(reason) => reject_stream(send, recv, reason, max_size).await,
                    };
                    if let Err(e) = result {
                        warn!("[admin-p2p] stream error from {}: {}", node_id_short, e);
                    }
                });
            }
            Err(e) => {
                info!(
                    "[admin-p2p] connection closed from {}: {}",
                    node_id_short, e
                );
                break;
            }
        }
    }
}

/// resolve a peer node id to an admin caller, or return None
async fn resolve_admin_caller(node_id: &str) -> Option<Caller> {
    let service = UserService::new();
    match service.get_user_by_peer_node_id(node_id).await {
        crate::response::GrimoireResponse {
            success: true,
            data: Some(user),
            ..
        } if user.role.is_admin() => Some(Caller::new(&user.id, &user.username, user.role)),
        _ => None,
    }
}

/// handle a single bi-directional admin stream
async fn handle_stream(
    mut send: iroh::endpoint::SendStream,
    mut recv: iroh::endpoint::RecvStream,
    caller: &Caller,
    node_id_short: &str,
    max_size: usize,
) -> Result<(), String> {
    // read full request
    let bytes = recv
        .read_to_end(max_size)
        .await
        .map_err(|e| format!("failed to read admin request: {}", e))?;

    let msg: AdminMessage = serde_json::from_slice(&bytes)
        .map_err(|e| format!("failed to parse admin message: {}", e))?;

    let (id, command, args) = match msg {
        AdminMessage::Request { id, command, args } => (id, command, args),
        AdminMessage::Response { .. } => {
            return Err("received Response on admin server stream".to_string());
        }
    };

    info!("[admin-p2p] {} from {} (id={})", command, node_id_short, id);

    // dispatch
    let response = admin_dispatch::handle(&command, args, caller).await;

    // serialize as AdminMessage::Response — preserves errors vec
    let data = response.data.unwrap_or(JsonValue::Null);
    let reply = AdminMessage::Response {
        id,
        success: response.success,
        data,
        message: response.message,
        errors: response.errors,
    };

    let reply_bytes = serde_json::to_vec(&reply)
        .map_err(|e| format!("failed to serialize admin response: {}", e))?;
    send.write_all(&reply_bytes)
        .await
        .map_err(|e| format!("failed to write admin response: {}", e))?;
    send.finish()
        .map_err(|e| format!("failed to finish admin response: {}", e))?;

    Ok(())
}

/// handle a single bi-directional admin stream from a caller that failed
/// the per-caller gates in `handle_incoming` (not an admin, or not in the
/// allowlist) - still reads the request (to preserve its `id` for
/// correlation) and replies with a clean forbidden response instead of
/// dispatching, mirroring `admin_dispatch::helpers::forbidden()`'s shape
/// exactly so callers get a normal, classifiable `AdminCommandError`.
async fn reject_stream(
    mut send: iroh::endpoint::SendStream,
    mut recv: iroh::endpoint::RecvStream,
    reason: &str,
    max_size: usize,
) -> Result<(), String> {
    let bytes = recv
        .read_to_end(max_size)
        .await
        .map_err(|e| format!("failed to read admin request: {}", e))?;

    let msg: AdminMessage = serde_json::from_slice(&bytes)
        .map_err(|e| format!("failed to parse admin message: {}", e))?;

    let id = match msg {
        AdminMessage::Request { id, .. } => id,
        AdminMessage::Response { .. } => {
            return Err("received Response on admin server stream".to_string());
        }
    };

    let reply = AdminMessage::Response {
        id,
        success: false,
        data: JsonValue::Null,
        message: "forbidden".to_string(),
        errors: vec![ErrorDetail::new("forbidden", "forbidden", reason)],
    };

    let reply_bytes = serde_json::to_vec(&reply)
        .map_err(|e| format!("failed to serialize admin response: {}", e))?;
    send.write_all(&reply_bytes)
        .await
        .map_err(|e| format!("failed to write admin response: {}", e))?;
    send.finish()
        .map_err(|e| format!("failed to finish admin response: {}", e))?;

    Ok(())
}
