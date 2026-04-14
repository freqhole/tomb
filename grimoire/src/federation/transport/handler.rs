//! incoming P2P request handler
//!
//! handles incoming P2P requests by dispatching to offal
//!
//! used by:
//! - tauri app for local P2P serving
//! - CLI for standalone P2P serving mode
//!
//! peer validation flow (in order):
//! 1. is_known_peer - check if node_id is in user_peer_nodez (fast local DB check)
//! 2. resolve_peer - if haruspex configured, lookup via haruspex (may auto-create user)
//! 3. knocking_enabled - if true, allow connection but restrict to public routes only

use crate::api_registry::Method as OffalMethod;
use crate::blobz;
use crate::config::get_config;
use crate::federation::resolver::{is_knocking_enabled, is_known_peer, resolve_peer};
use crate::federation::transport::protocol::PeerMessage;
use crate::media_blobz::get_media_blob_with_data;
use crate::offal::dispatch as offal_dispatch;
use crate::offal::Caller;
use crate::users::{UserRole, UserService};

use iroh::PublicKey;
use serde_json::{json, Value as JsonValue};
use tokio::fs::File;

/// convert string method to offal Method
fn to_offal_method(method: &str) -> Option<OffalMethod> {
    match method.to_uppercase().as_str() {
        "GET" => Some(OffalMethod::GET),
        "POST" => Some(OffalMethod::POST),
        "PATCH" => Some(OffalMethod::PATCH),
        "HEAD" => Some(OffalMethod::HEAD),
        _ => None,
    }
}
use tokio::io::AsyncReadExt;
use tracing::{debug, info, warn};

/// handle an incoming connection from a peer
///
/// this is the main entry point for P2P request handling.
/// accepts streams and processes requests via offal::dispatch().
///
/// validates peer is allowed: known peer, haruspex-resolved, or knocking enabled
pub async fn handle_incoming(peer_node_id: PublicKey, conn: iroh::endpoint::Connection) {
    let node_id_str = peer_node_id.to_string();
    let node_id_short = &node_id_str[..16];

    // check if allowed: known peer > haruspex lookup > knocking
    let known = is_known_peer(&node_id_str).await;
    let resolved = !known && resolve_peer(&node_id_str).await.user.is_some();
    let knocking = is_knocking_enabled();

    if known {
        info!(
            "[p2p-handler] connection from known peer: {}",
            node_id_short
        );
    } else if resolved {
        info!(
            "[p2p-handler] connection from haruspex-resolved peer: {}",
            node_id_short
        );
    } else if knocking {
        info!(
            "[p2p-handler] connection from unknown peer (knocking): {}",
            node_id_short
        );
    } else {
        warn!("[p2p-handler] rejecting unknown peer: {}", node_id_short);
        conn.close(1u32.into(), b"sorry");
        return;
    }

    // accept streams in a loop
    loop {
        debug!("[p2p-handler] waiting for stream from {}", node_id_short);
        match conn.accept_bi().await {
            Ok((send, recv)) => {
                info!("[p2p-handler] accepted stream from {}", node_id_short);
                let node_id_str = node_id_str.clone();
                let node_id_short = node_id_short.to_string();

                // handle each stream concurrently
                tokio::spawn(async move {
                    if let Err(e) = handle_stream(send, recv, &node_id_str, &node_id_short).await {
                        warn!("[p2p-handler] stream error from {}: {}", node_id_short, e);
                    }
                });
            }
            Err(e) => {
                info!(
                    "[p2p-handler] connection closed from {}: {}",
                    node_id_short, e
                );
                break;
            }
        }
    }
}

/// handle a single bidirectional stream
async fn handle_stream(
    mut send: iroh::endpoint::SendStream,
    mut recv: iroh::endpoint::RecvStream,
    node_id_str: &str,
    node_id_short: &str,
) -> Result<(), String> {
    // read the request message
    let federation_config = get_config().federation.clone();
    let max_size = federation_config
        .as_ref()
        .map(|f| f.max_message_size_bytes())
        .unwrap_or(10 * 1024 * 1024);
    // read the full message as JSON
    let msg_bytes = recv
        .read_to_end(max_size)
        .await
        .map_err(|e| format!("failed to read message: {}", e))?;

    let msg: PeerMessage = serde_json::from_slice(&msg_bytes)
        .map_err(|e| format!("failed to parse message: {}", e))?;

    match msg {
        PeerMessage::ProxyRequest {
            id,
            method,
            path,
            body,
        } => {
            info!(
                "[p2p-handler] dispatch: {} {} from {}",
                method, path, node_id_short
            );

            // check if this is a public endpoint (no auth required)
            let is_public = is_public_endpoint(&method, &path);

            // get caller for this peer
            let caller = if is_public {
                // public endpoints get a viewer caller (lowest privilege)
                Caller::new("guest", "guest", UserRole::Viewer)
            } else {
                match get_caller_for_peer(node_id_str).await {
                    Some(c) => c,
                    None => {
                        warn!(
                            "rejecting request from unknown peer: {} {} from {}",
                            method, path, node_id_short
                        );
                        let resp = PeerMessage::ProxyResponse {
                            id,
                            status: 401,
                            body:
                                r#"{"success":false,"message":"unauthorized: peer not registered"}"#
                                    .to_string(),
                        };
                        send_response(&mut send, &resp).await?;
                        return Ok(());
                    }
                }
            };

            // parse request body
            let mut json_body: JsonValue = body
                .as_ref()
                .and_then(|b| serde_json::from_str(b).ok())
                .unwrap_or(JsonValue::Null);

            // inject node_id for routes that need to know who's connecting
            // (knock/invite for pending requests, upload for iroh-blobs pull)
            if path == "/api/knock"
                || path == "/api/knock/status"
                || path == "/api/auth/invite"
                || path == "/api/upload/music-by-blake3"
            {
                if let Some(obj) = json_body.as_object_mut() {
                    obj.insert(
                        "node_id".to_string(),
                        JsonValue::String(node_id_str.to_string()),
                    );
                } else if json_body.is_null() {
                    json_body = json!({ "node_id": node_id_str });
                }
            }

            // dispatch via offal
            let response =
                offal_dispatch(&path, &caller, json_body, to_offal_method(&method)).await;

            // convert GrimoireResponse to HTTP-like response
            let (status, response_body) = if response.success {
                (200u16, serde_json::to_string(&response).unwrap_or_default())
            } else {
                // map error types to status codes
                let status = if response.errors.iter().any(|e| e.error_type == "forbidden") {
                    403
                } else if response.errors.iter().any(|e| e.error_type == "not_found") {
                    404
                } else if response
                    .errors
                    .iter()
                    .any(|e| e.error_type == "route_not_found")
                {
                    404
                } else if response
                    .errors
                    .iter()
                    .any(|e| e.error_type == "bad_request")
                {
                    400
                } else {
                    500
                };
                (status, serde_json::to_string(&response).unwrap_or_default())
            };

            let resp = PeerMessage::ProxyResponse {
                id,
                status,
                body: response_body,
            };
            send_response(&mut send, &resp).await?;
        }

        PeerMessage::HelloImageRequest { id } => {
            debug!("hello image request from {}", node_id_short);

            // public endpoint - use offal dispatch
            let caller = Caller::new("guest", "guest", UserRole::Viewer);
            let response = offal_dispatch(
                "/api/hello/image",
                &caller,
                JsonValue::Null,
                Some(OffalMethod::GET),
            )
            .await;

            if response.success {
                // the response should contain blob info - extract and stream
                if let Some(data) = response.data {
                    if let Some(blob_id) = data.get("blob_id").and_then(|v| v.as_str()) {
                        // stream the blob
                        match get_media_blob_with_data(blob_id).await {
                            Ok((blob, db_data)) => {
                                let bytes = if let Some(data) = db_data {
                                    Some(data)
                                } else if let Some(ref local_path) = blob.local_path {
                                    read_file_to_bytes(local_path).await.ok()
                                } else {
                                    None
                                };

                                if let Some(bytes) = bytes {
                                    let resp = PeerMessage::HelloImageResponse {
                                        id,
                                        size: Some(bytes.len() as u64),
                                        content_type: blob.mime.clone(),
                                        error: None,
                                    };
                                    send_length_prefixed(&mut send, &resp).await?;
                                    send.write_all(&bytes).await.map_err(|e| {
                                        format!("failed to write image data: {}", e)
                                    })?;
                                    send.finish().map_err(|e| {
                                        format!("failed to finish image stream: {}", e)
                                    })?;
                                    return Ok(());
                                }
                            }
                            Err(_) => {}
                        }
                    }
                }

                // no image available
                let resp = PeerMessage::HelloImageResponse {
                    id,
                    size: None,
                    content_type: None,
                    error: Some("server image not configured".to_string()),
                };
                send_length_prefixed(&mut send, &resp).await?;
            } else {
                let resp = PeerMessage::HelloImageResponse {
                    id,
                    size: None,
                    content_type: None,
                    error: Some(response.message),
                };
                send_length_prefixed(&mut send, &resp).await?;
            }
        }

        PeerMessage::EnsureBlobRequest { id, blake3_hash } => {
            debug!(
                "ensure blob request: {} from {}",
                &blake3_hash[..16.min(blake3_hash.len())],
                node_id_short
            );

            // require auth
            let _caller = match get_caller_for_peer(node_id_str).await {
                Some(c) => c,
                None => {
                    let resp = PeerMessage::EnsureBlobResponse {
                        id,
                        available: false,
                        error: Some("unauthorized: peer not registered".to_string()),
                    };
                    send_response(&mut send, &resp).await?;
                    return Ok(());
                }
            };

            // ensure blob is loaded into FsStore
            match blobz::ensure_blob_by_blake3(&blake3_hash).await {
                Ok(available) => {
                    let resp = PeerMessage::EnsureBlobResponse {
                        id,
                        available,
                        error: None,
                    };
                    send_response(&mut send, &resp).await?;
                }
                Err(e) => {
                    let resp = PeerMessage::EnsureBlobResponse {
                        id,
                        available: false,
                        error: Some(format!("failed to ensure blob: {}", e)),
                    };
                    send_response(&mut send, &resp).await?;
                }
            }
        }

        PeerMessage::ComputeBlake3Request { id, blob_id } => {
            debug!(
                "compute blake3 request: {} from {}",
                &blob_id[..16.min(blob_id.len())],
                node_id_short
            );

            // require auth
            let _caller = match get_caller_for_peer(node_id_str).await {
                Some(c) => c,
                None => {
                    let resp = PeerMessage::ComputeBlake3Response {
                        id,
                        blake3: None,
                        error: Some("unauthorized: peer not registered".to_string()),
                    };
                    send_response(&mut send, &resp).await?;
                    return Ok(());
                }
            };

            // compute blake3 hash for blob (also adds to FsStore)
            match blobz::ensure_blake3_hash(&blob_id).await {
                Ok(blake3) => {
                    let resp = PeerMessage::ComputeBlake3Response {
                        id,
                        blake3: Some(blake3),
                        error: None,
                    };
                    send_response(&mut send, &resp).await?;
                }
                Err(e) => {
                    let resp = PeerMessage::ComputeBlake3Response {
                        id,
                        blake3: None,
                        error: Some(format!("failed to compute blake3: {}", e)),
                    };
                    send_response(&mut send, &resp).await?;
                }
            }
        }

        // ignore responses sent to us (shouldn't happen)
        PeerMessage::ProxyResponse { .. }
        | PeerMessage::HelloImageResponse { .. }
        | PeerMessage::EnsureBlobResponse { .. }
        | PeerMessage::ComputeBlake3Response { .. } => {
            debug!("unexpected response message from {}", node_id_short);
        }
    }

    Ok(())
}

/// send a response message (no length prefix, read to end)
async fn send_response(
    send: &mut iroh::endpoint::SendStream,
    msg: &PeerMessage,
) -> Result<(), String> {
    let bytes =
        serde_json::to_vec(msg).map_err(|e| format!("failed to serialize response: {}", e))?;
    send.write_all(&bytes)
        .await
        .map_err(|e| format!("failed to write response: {}", e))?;
    send.finish()
        .map_err(|e| format!("failed to finish response: {}", e))?;
    Ok(())
}

/// send a length-prefixed message (for streaming responses)
async fn send_length_prefixed(
    send: &mut iroh::endpoint::SendStream,
    msg: &PeerMessage,
) -> Result<(), String> {
    let bytes =
        serde_json::to_vec(msg).map_err(|e| format!("failed to serialize message: {}", e))?;
    let len = bytes.len() as u32;
    send.write_all(&len.to_be_bytes())
        .await
        .map_err(|e| format!("failed to write length: {}", e))?;
    send.write_all(&bytes)
        .await
        .map_err(|e| format!("failed to write message: {}", e))?;
    Ok(())
}

/// check if a request is for a public endpoint (no auth required)
fn is_public_endpoint(method: &str, path: &str) -> bool {
    match (method, path) {
        ("GET", "/api/hello") => true,
        ("POST", "/api/auth/invite") => true,
        ("POST", "/api/knock") => true,
        ("GET", "/api/knock/status") => true,
        _ => false,
    }
}

/// get a Caller for a peer by their node_id
///
/// looks up the user associated with this peer's iroh node_id
/// and creates a Caller with their user_id and role.
async fn get_caller_for_peer(node_id: &str) -> Option<Caller> {
    let service = UserService::new();
    // use repository directly via service's internal access
    match service.get_user_by_peer_node_id(node_id).await {
        crate::response::GrimoireResponse {
            success: true,
            data: Some(user),
            ..
        } => Some(Caller::new(&user.id, &user.username, user.role)),
        _ => None,
    }
}

/// read a file to bytes
async fn read_file_to_bytes(path: &str) -> Result<Vec<u8>, String> {
    let mut file = File::open(path)
        .await
        .map_err(|e| format!("failed to open file: {}", e))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .await
        .map_err(|e| format!("failed to read file: {}", e))?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_public_endpoint() {
        assert!(is_public_endpoint("GET", "/api/hello"));
        assert!(is_public_endpoint("POST", "/api/auth/invite"));
        assert!(is_public_endpoint("POST", "/api/knock"));
        assert!(is_public_endpoint("GET", "/api/knock/status"));

        assert!(!is_public_endpoint("GET", "/api/songs/query"));
        assert!(!is_public_endpoint("POST", "/api/albums/update"));
    }
}
