//! incoming P2P request handler
//!
//! handles incoming P2P requests by dispatching to offal
//!
//! used by:
//! - tauri app for local P2P serving
//! - CLI for standalone P2P serving mode

use crate::config::get_config;
use crate::federation::transport::protocol::PeerMessage;
use crate::media_blobz::get_media_blob_with_data;
use crate::offal::dispatch as offal_dispatch;
use crate::offal::Caller;
use crate::users::{UserRole, UserService};
use base64::Engine;
use iroh::PublicKey;
use serde_json::{json, Value as JsonValue};
use tokio::fs::File;
use tokio::io::AsyncReadExt;
use tracing::{debug, info, warn};

/// handle an incoming connection from a peer
///
/// this is the main entry point for P2P request handling.
/// accepts streams and processes requests via offal::dispatch().
pub async fn handle_incoming(peer_node_id: PublicKey, conn: iroh::endpoint::Connection) {
    let node_id_str = peer_node_id.to_string();
    let node_id_short = &node_id_str[..16];
    info!("incoming connection from peer: {}", node_id_short);

    // accept streams in a loop
    loop {
        match conn.accept_bi().await {
            Ok((send, recv)) => {
                let node_id_str = node_id_str.clone();
                let node_id_short = node_id_short.to_string();

                // handle each stream concurrently
                tokio::spawn(async move {
                    if let Err(e) = handle_stream(send, recv, &node_id_str, &node_id_short).await {
                        debug!("stream error from {}: {}", node_id_short, e);
                    }
                });
            }
            Err(e) => {
                debug!("connection closed from {}: {}", node_id_short, e);
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
    let max_upload_size = federation_config
        .as_ref()
        .map(|f| f.max_upload_size_bytes())
        .unwrap_or(500 * 1024 * 1024);

    // check for length-prefixed header (used by blob upload)
    let mut prefix_buf = [0u8; 4];
    recv.read_exact(&mut prefix_buf)
        .await
        .map_err(|e| format!("failed to read message prefix: {}", e))?;

    let prefix_len = u32::from_be_bytes(prefix_buf) as usize;

    // if prefix looks like a reasonable header length (1 byte to 64KB),
    // treat as length-prefixed message (for uploads)
    let (msg, blob_data) = if prefix_len > 0 && prefix_len < 65536 {
        let mut header_buf = vec![0u8; prefix_len];
        recv.read_exact(&mut header_buf)
            .await
            .map_err(|e| format!("failed to read header: {}", e))?;

        let msg: PeerMessage = serde_json::from_slice(&header_buf)
            .map_err(|e| format!("failed to parse header: {}", e))?;

        // if this is a blob upload, read the blob data
        let blob_data = if let PeerMessage::BlobUploadRequest { id, size, .. } = &msg {
            if *size as usize > max_upload_size {
                let resp = PeerMessage::BlobUploadResponse {
                    id: *id,
                    blob_id: None,
                    job_id: None,
                    error: Some(format!(
                        "file too large: {} bytes exceeds limit of {} MB",
                        size,
                        max_upload_size / (1024 * 1024)
                    )),
                    body: None,
                };
                send_response(&mut send, &resp).await?;
                return Ok(());
            }

            match recv.read_to_end(max_upload_size).await {
                Ok(data) => Some(data),
                Err(e) => {
                    let resp = PeerMessage::BlobUploadResponse {
                        id: *id,
                        blob_id: None,
                        job_id: None,
                        error: Some(format!("failed to read blob data: {}", e)),
                        body: None,
                    };
                    send_response(&mut send, &resp).await?;
                    return Ok(());
                }
            }
        } else {
            None
        };

        (msg, blob_data)
    } else {
        // regular message: prefix bytes are part of JSON
        let rest = recv
            .read_to_end(max_size)
            .await
            .map_err(|e| format!("failed to read message: {}", e))?;

        let mut msg_bytes = prefix_buf.to_vec();
        msg_bytes.extend(rest);

        let msg: PeerMessage = serde_json::from_slice(&msg_bytes)
            .map_err(|e| format!("failed to parse message: {}", e))?;

        (msg, None)
    };

    match msg {
        PeerMessage::ProxyRequest {
            id,
            method,
            path,
            body,
        } => {
            debug!("offal dispatch: {} {} from {}", method, path, node_id_short);

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
            let json_body: JsonValue = body
                .as_ref()
                .and_then(|b| serde_json::from_str(b).ok())
                .unwrap_or(JsonValue::Null);

            // dispatch via offal
            let response = offal_dispatch(&path, &caller, json_body).await;

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

        PeerMessage::BlobStreamRequest { id, blob_id } => {
            debug!("blob stream: {} from {}", blob_id, node_id_short);

            // blob requests require auth
            let _caller = match get_caller_for_peer(node_id_str).await {
                Some(c) => c,
                None => {
                    warn!(
                        "rejecting blob request from unknown peer: {} from {}",
                        blob_id, node_id_short
                    );
                    let resp = PeerMessage::BlobStreamResponse {
                        id,
                        size: None,
                        content_type: None,
                        error: Some("unauthorized: peer not registered".to_string()),
                    };
                    send_length_prefixed(&mut send, &resp).await?;
                    return Ok(());
                }
            };

            // get blob metadata and data
            match get_media_blob_with_data(&blob_id).await {
                Ok((blob, db_data)) => {
                    // determine how to get the blob data
                    let data = if let Some(data) = db_data {
                        // blob stored in database
                        Some(data)
                    } else if let Some(ref local_path) = blob.local_path {
                        // blob stored on filesystem - read it
                        match read_file_to_bytes(local_path).await {
                            Ok(data) => Some(data),
                            Err(e) => {
                                let resp = PeerMessage::BlobStreamResponse {
                                    id,
                                    size: None,
                                    content_type: None,
                                    error: Some(format!("failed to read blob file: {}", e)),
                                };
                                send_length_prefixed(&mut send, &resp).await?;
                                return Ok(());
                            }
                        }
                    } else {
                        None
                    };

                    match data {
                        Some(bytes) => {
                            // send header
                            let resp = PeerMessage::BlobStreamResponse {
                                id,
                                size: Some(bytes.len() as u64),
                                content_type: blob.mime.clone(),
                                error: None,
                            };
                            send_length_prefixed(&mut send, &resp).await?;

                            // stream body
                            send.write_all(&bytes)
                                .await
                                .map_err(|e| format!("failed to write blob data: {}", e))?;
                            send.finish()
                                .map_err(|e| format!("failed to finish blob stream: {}", e))?;
                        }
                        None => {
                            let resp = PeerMessage::BlobStreamResponse {
                                id,
                                size: None,
                                content_type: None,
                                error: Some("blob has no data".to_string()),
                            };
                            send_length_prefixed(&mut send, &resp).await?;
                        }
                    }
                }
                Err(e) => {
                    let resp = PeerMessage::BlobStreamResponse {
                        id,
                        size: None,
                        content_type: None,
                        error: Some(format!("blob not found: {}", e)),
                    };
                    send_length_prefixed(&mut send, &resp).await?;
                }
            }
        }

        PeerMessage::BlobUploadRequest {
            id,
            filename,
            content_type,
            size,
        } => {
            debug!(
                "blob upload: {} ({} bytes) from {}",
                filename, size, node_id_short
            );

            // uploads require auth
            let caller = match get_caller_for_peer(node_id_str).await {
                Some(c) => c,
                None => {
                    warn!(
                        "rejecting upload from unknown peer: {} from {}",
                        filename, node_id_short
                    );
                    let resp = PeerMessage::BlobUploadResponse {
                        id,
                        blob_id: None,
                        job_id: None,
                        error: Some("unauthorized: peer not registered".to_string()),
                        body: None,
                    };
                    send_response(&mut send, &resp).await?;
                    return Ok(());
                }
            };

            // get the blob data that was read earlier
            let data = match blob_data {
                Some(d) => d,
                None => {
                    let resp = PeerMessage::BlobUploadResponse {
                        id,
                        blob_id: None,
                        job_id: None,
                        error: Some("no blob data received".to_string()),
                        body: None,
                    };
                    send_response(&mut send, &resp).await?;
                    return Ok(());
                }
            };

            // verify size matches
            if data.len() as u64 != size {
                let resp = PeerMessage::BlobUploadResponse {
                    id,
                    blob_id: None,
                    job_id: None,
                    error: Some(format!(
                        "size mismatch: expected {} bytes, got {}",
                        size,
                        data.len()
                    )),
                    body: None,
                };
                send_response(&mut send, &resp).await?;
                return Ok(());
            }

            // dispatch to offal upload handler
            // encode data as base64 for the upload handler
            let base64_data = base64::engine::general_purpose::STANDARD.encode(&data);

            let upload_body = json!({
                "data": base64_data,
                "filename": filename,
                "content_type": content_type,
            });

            // determine upload path based on content type
            let upload_path = if content_type.starts_with("audio/") {
                "/api/upload/music"
            } else if content_type.starts_with("image/") {
                "/api/upload/image"
            } else {
                "/api/upload/music" // default to music
            };

            let response = offal_dispatch(upload_path, &caller, upload_body).await;

            if response.success {
                // extract blob_id and job_id from response
                let blob_id = response
                    .data
                    .as_ref()
                    .and_then(|d| d.get("blob_id"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let job_id = response
                    .data
                    .as_ref()
                    .and_then(|d| d.get("job_id"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let resp = PeerMessage::BlobUploadResponse {
                    id,
                    blob_id,
                    job_id,
                    error: None,
                    body: Some(serde_json::to_string(&response).unwrap_or_default()),
                };
                send_response(&mut send, &resp).await?;
            } else {
                let resp = PeerMessage::BlobUploadResponse {
                    id,
                    blob_id: None,
                    job_id: None,
                    error: Some(response.message.clone()),
                    body: Some(serde_json::to_string(&response).unwrap_or_default()),
                };
                send_response(&mut send, &resp).await?;
            }
        }

        PeerMessage::HelloImageRequest { id } => {
            debug!("hello image request from {}", node_id_short);

            // public endpoint - use offal dispatch
            let caller = Caller::new("guest", "guest", UserRole::Viewer);
            let response = offal_dispatch("/api/hello/image", &caller, JsonValue::Null).await;

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

        // ignore responses sent to us (shouldn't happen)
        PeerMessage::ProxyResponse { .. }
        | PeerMessage::BlobStreamResponse { .. }
        | PeerMessage::BlobUploadResponse { .. }
        | PeerMessage::HelloImageResponse { .. } => {
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
