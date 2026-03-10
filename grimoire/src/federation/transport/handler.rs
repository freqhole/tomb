//! incoming request handler
//!
//! handles requests from peers by proxying HTTP requests to the local
//! freqhole server. this avoids having to manually wrap every API.

use crate::config::get_config;
use crate::federation::transport::protocol::PeerMessage;
use crate::response::GrimoireResponse;
use crate::users::UserService;
use futures_util::StreamExt;
use iroh::PublicKey;
use tracing::{debug, info, warn};

/// handle an incoming connection from a peer
///
/// accepts streams and processes requests:
/// - ProxyRequest: forward to local HTTP server with bearer auth
/// - BlobStreamRequest: stream blob bytes to peer
pub async fn handle_incoming(peer_node_id: PublicKey, conn: iroh::endpoint::Connection) {
    let node_id_str = peer_node_id.to_string();
    let node_id_short = &node_id_str[..16];
    info!("incoming connection from peer: {}", node_id_short);

    // get local server config
    let config = get_config();
    let (host, port) = match &config.server {
        Some(s) => (s.host.clone(), s.port),
        None => ("127.0.0.1".to_string(), 8080),
    };
    let base_url = format!("http://{}:{}", host, port);

    // create HTTP client for this connection
    let http_client = reqwest::Client::new();

    // accept streams in a loop
    loop {
        match conn.accept_bi().await {
            Ok((send, recv)) => {
                let base_url = base_url.clone();
                let http_client = http_client.clone();
                let node_id_str = node_id_str.clone();
                let node_id_short = node_id_short.to_string();

                // handle each stream concurrently
                tokio::spawn(async move {
                    if let Err(e) = handle_stream(
                        send,
                        recv,
                        &node_id_str,
                        &base_url,
                        &http_client,
                        &node_id_short,
                    )
                    .await
                    {
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
    base_url: &str,
    http_client: &reqwest::Client,
    node_id_short: &str,
) -> Result<(), String> {
    // read the request message - use configured max size
    let max_size = get_config()
        .federation
        .as_ref()
        .map(|f| f.max_message_size_bytes())
        .unwrap_or(10 * 1024 * 1024);
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
            debug!("proxy: {} {} from {}", method, path, node_id_short);

            // check if this is a public endpoint (no auth required)
            let is_public = is_public_endpoint(&method, &path);

            // for non-public endpoints, require API key
            let api_key = if is_public {
                None
            } else {
                match get_peer_api_key(node_id_str).await {
                    Some(key) => Some(key),
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

            let url = format!("{}{}", base_url, path);
            let response = match method.as_str() {
                "GET" => {
                    let mut req = http_client.get(&url);
                    if let Some(ref key) = api_key {
                        req = req.bearer_auth(key);
                    }
                    // add peer node_id header for public endpoints (e.g., invite redemption)
                    req = req.header("X-Peer-Node-Id", node_id_str);
                    req.send().await
                }
                "POST" => {
                    let mut req = http_client.post(&url);
                    if let Some(ref key) = api_key {
                        req = req.bearer_auth(key);
                    }
                    // add peer node_id header for public endpoints (e.g., invite redemption)
                    req = req.header("X-Peer-Node-Id", node_id_str);
                    if let Some(b) = body {
                        req = req.header("Content-Type", "application/json").body(b);
                    }
                    req.send().await
                }
                "PUT" => {
                    let mut req = http_client.put(&url);
                    if let Some(ref key) = api_key {
                        req = req.bearer_auth(key);
                    }
                    req = req.header("X-Peer-Node-Id", node_id_str);
                    if let Some(b) = body {
                        req = req.header("Content-Type", "application/json").body(b);
                    }
                    req.send().await
                }
                "DELETE" => {
                    let mut req = http_client.delete(&url);
                    if let Some(ref key) = api_key {
                        req = req.bearer_auth(key);
                    }
                    req = req.header("X-Peer-Node-Id", node_id_str);
                    req.send().await
                }
                "PATCH" => {
                    let mut req = http_client.patch(&url);
                    if let Some(ref key) = api_key {
                        req = req.bearer_auth(key);
                    }
                    req = req.header("X-Peer-Node-Id", node_id_str);
                    if let Some(b) = body {
                        req = req.header("Content-Type", "application/json").body(b);
                    }
                    req.send().await
                }
                _ => {
                    let resp = PeerMessage::ProxyResponse {
                        id,
                        status: 405,
                        body: format!("unsupported method: {}", method),
                    };
                    send_response(&mut send, &resp).await?;
                    return Ok(());
                }
            };

            let (status, body) = match response {
                Ok(r) => {
                    let status = r.status().as_u16();
                    let body = r.text().await.unwrap_or_default();
                    (status, body)
                }
                Err(e) => {
                    warn!("proxy HTTP request failed: {}", e);
                    (502, format!("proxy error: {}", e))
                }
            };

            let resp = PeerMessage::ProxyResponse { id, status, body };
            send_response(&mut send, &resp).await?;
        }

        PeerMessage::BlobStreamRequest { id, blob_id } => {
            debug!("blob stream: {} from {}", blob_id, node_id_short);

            // blob requests require auth
            let api_key = match get_peer_api_key(node_id_str).await {
                Some(key) => key,
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

            // stream blob via local server's blob endpoint
            let url = format!("{}/api/blobs/{}", base_url, blob_id);
            let response = http_client.get(&url).bearer_auth(&api_key).send().await;

            match response {
                Ok(r) => {
                    if !r.status().is_success() {
                        let resp = PeerMessage::BlobStreamResponse {
                            id,
                            size: None,
                            content_type: None,
                            error: Some(format!("blob not found: status {}", r.status())),
                        };
                        send_length_prefixed(&mut send, &resp).await?;
                        return Ok(());
                    }

                    // get size and content type from headers
                    let size = r
                        .headers()
                        .get("content-length")
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| v.parse().ok());
                    let content_type = r
                        .headers()
                        .get("content-type")
                        .and_then(|v| v.to_str().ok())
                        .map(|s| s.to_string());

                    // send header
                    let resp = PeerMessage::BlobStreamResponse {
                        id,
                        size,
                        content_type,
                        error: None,
                    };
                    send_length_prefixed(&mut send, &resp).await?;

                    // stream body
                    let mut body = r.bytes_stream();
                    while let Some(chunk) = body.next().await {
                        match chunk {
                            Ok(bytes) => {
                                send.write_all(&bytes)
                                    .await
                                    .map_err(|e| format!("failed to write blob chunk: {}", e))?;
                            }
                            Err(e) => {
                                warn!("error reading blob stream: {}", e);
                                break;
                            }
                        }
                    }
                    send.finish()
                        .map_err(|e| format!("failed to finish blob stream: {}", e))?;
                }
                Err(e) => {
                    let resp = PeerMessage::BlobStreamResponse {
                        id,
                        size: None,
                        content_type: None,
                        error: Some(format!("failed to fetch blob: {}", e)),
                    };
                    send_length_prefixed(&mut send, &resp).await?;
                }
            }
        }

        // ignore responses sent to us (shouldn't happen)
        PeerMessage::ProxyResponse { .. } | PeerMessage::BlobStreamResponse { .. } => {
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
///
/// public endpoints allow unknown peers to:
/// - get server info (/api/hello)
/// - register with invite code (/api/auth/invite)
///
/// note: webauthn/passkey registration is not supported over P2P -
/// invite code redemption links the peer's node_id to the user directly
fn is_public_endpoint(method: &str, path: &str) -> bool {
    match (method, path) {
        ("GET", "/api/hello") => true,
        ("POST", "/api/auth/invite") => true,
        _ => false,
    }
}

/// get API key for a peer by their node_id
async fn get_peer_api_key(node_id: &str) -> Option<String> {
    let user_service = UserService::new();
    match user_service.get_api_key_for_peer(node_id).await {
        GrimoireResponse {
            success: true,
            data: Some(api_key),
            ..
        } => Some(api_key),
        _ => None,
    }
}
