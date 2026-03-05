//! protocol handler for incoming connections

use anyhow::Result;
use iroh::endpoint::Connection;
use iroh::protocol::{AcceptError, ProtocolHandler};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

use crate::blobs::{get_blob_for_streaming, serve_blob_request, BlobSource};
use crate::protocol::RuhrohMessage;

/// Protocol handler for ruhroh - handles incoming connections
#[derive(Debug, Clone)]
pub struct RuhrohHandler {
    pub messages: Arc<RwLock<Vec<String>>>,
    /// URL of local freqhole server for proxy requests
    pub local_server: String,
    /// API key for local freqhole server
    pub local_api_key: String,
    /// HTTP client for making proxy requests
    pub http_client: reqwest::Client,
    /// Data directory for blob storage
    pub data_dir: PathBuf,
}

impl RuhrohHandler {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            messages: Arc::new(RwLock::new(Vec::new())),
            local_server: "http://localhost:8080".to_string(),
            local_api_key: "ca01aef9e1f3bbe92130df71f43b5422aa005798d03ed22033406bcf29c5ad17"
                .to_string(),
            http_client: reqwest::Client::new(),
            data_dir,
        }
    }
}

impl ProtocolHandler for RuhrohHandler {
    async fn accept(&self, connection: Connection) -> Result<(), AcceptError> {
        let remote_id = connection.remote_id();

        // Accept bidirectional stream for request/response
        let (mut send_stream, mut recv_stream) = connection.accept_bi().await?;

        // Read the message
        let msg = recv_stream
            .read_to_end(256 * 1024)
            .await
            .map_err(|e| std::io::Error::other(e.to_string()))?;

        // Try to parse as JSON protocol message
        match serde_json::from_slice::<RuhrohMessage>(&msg) {
            Ok(RuhrohMessage::ProxyRequest {
                id,
                method,
                path,
                body,
            }) => {
                info!(
                    "Proxy: {} {} from {}",
                    method,
                    path,
                    &remote_id.to_string()[..8]
                );

                // Make local HTTP request with auth
                let url = format!("{}{}", self.local_server, path);
                let response = match method.as_str() {
                    "GET" => {
                        self.http_client
                            .get(&url)
                            .bearer_auth(&self.local_api_key)
                            .send()
                            .await
                    }
                    "POST" => {
                        let mut req = self
                            .http_client
                            .post(&url)
                            .bearer_auth(&self.local_api_key);
                        if let Some(b) = body {
                            req = req.header("Content-Type", "application/json").body(b);
                        }
                        req.send().await
                    }
                    _ => {
                        let resp = RuhrohMessage::ProxyResponse {
                            id,
                            status: 400,
                            body: format!("unsupported method: {}", method),
                        };
                        let resp_bytes = serde_json::to_vec(&resp).unwrap();
                        send_stream
                            .write_all(&resp_bytes)
                            .await
                            .map_err(|e| std::io::Error::other(e.to_string()))?;
                        send_stream
                            .finish()
                            .map_err(|e| std::io::Error::other(e.to_string()))?;
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
                        info!("HTTP request failed: {}", e);
                        (502, format!("proxy error: {}", e))
                    }
                };

                let resp = RuhrohMessage::ProxyResponse { id, status, body };
                let resp_bytes = serde_json::to_vec(&resp).unwrap();
                send_stream
                    .write_all(&resp_bytes)
                    .await
                    .map_err(|e| std::io::Error::other(e.to_string()))?;
                send_stream
                    .finish()
                    .map_err(|e| std::io::Error::other(e.to_string()))?;
                // Give time for response to be transmitted
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            }
            Ok(RuhrohMessage::Chat { from, text }) => {
                use std::io::Write;
                print!("\n\x1b[36m[{}]\x1b[0m {}\n> ", from, text);
                let _ = std::io::stdout().flush();
                self.messages
                    .write()
                    .await
                    .push(format!("{}: {}", from, text));
            }
            Ok(RuhrohMessage::ProxyResponse { .. }) => {
                // shouldn't receive responses as a server
                info!("Unexpected proxy response");
            }
            Ok(RuhrohMessage::BlobRequest { id, blob_id }) => {
                info!(
                    "Blob request: {} from {}",
                    blob_id,
                    &remote_id.to_string()[..8]
                );

                // Look up blob in grimoire and create ticket
                let result = serve_blob_request(&self.data_dir, &blob_id).await;

                let resp = match result {
                    Ok(ticket) => RuhrohMessage::BlobResponse {
                        id,
                        ticket: Some(ticket),
                        error: None,
                    },
                    Err(e) => RuhrohMessage::BlobResponse {
                        id,
                        ticket: None,
                        error: Some(e.to_string()),
                    },
                };

                let resp_bytes = serde_json::to_vec(&resp).unwrap();
                send_stream
                    .write_all(&resp_bytes)
                    .await
                    .map_err(|e| std::io::Error::other(e.to_string()))?;
                send_stream
                    .finish()
                    .map_err(|e| std::io::Error::other(e.to_string()))?;
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            }
            Ok(RuhrohMessage::BlobResponse { .. }) => {
                // shouldn't receive responses as a server
                info!("Unexpected blob response");
            }
            Ok(RuhrohMessage::BlobStreamRequest { id, blob_id }) => {
                info!(
                    "Blob stream request: {} from {}",
                    blob_id,
                    &remote_id.to_string()[..8]
                );

                // Look up blob and get file info
                match get_blob_for_streaming(&self.data_dir, &blob_id).await {
                    Ok((source, size, content_type)) => {
                        // Send response header
                        let resp = RuhrohMessage::BlobStreamResponse {
                            id,
                            size: Some(size),
                            content_type: Some(content_type),
                            error: None,
                        };
                        let resp_bytes = serde_json::to_vec(&resp).unwrap();
                        
                        // Write length-prefixed header
                        let len = resp_bytes.len() as u32;
                        send_stream
                            .write_all(&len.to_be_bytes())
                            .await
                            .map_err(|e| std::io::Error::other(e.to_string()))?;
                        send_stream
                            .write_all(&resp_bytes)
                            .await
                            .map_err(|e| std::io::Error::other(e.to_string()))?;

                        // Stream contents based on source type
                        info!("Streaming {} bytes", size);
                        match source {
                            BlobSource::File(file_path) => {
                                // Stream from file (audio)
                                let mut file = tokio::fs::File::open(&file_path)
                                    .await
                                    .map_err(|e| std::io::Error::other(e.to_string()))?;
                                
                                let mut buf = vec![0u8; 64 * 1024]; // 64KB chunks
                                loop {
                                    use tokio::io::AsyncReadExt;
                                    let n = file
                                        .read(&mut buf)
                                        .await
                                        .map_err(|e| std::io::Error::other(e.to_string()))?;
                                    if n == 0 {
                                        break;
                                    }
                                    send_stream
                                        .write_all(&buf[..n])
                                        .await
                                        .map_err(|e| std::io::Error::other(e.to_string()))?;
                                }
                            }
                            BlobSource::Data(data) => {
                                // Send raw bytes directly (images from db)
                                send_stream
                                    .write_all(&data)
                                    .await
                                    .map_err(|e| std::io::Error::other(e.to_string()))?;
                            }
                        }
                        
                        send_stream
                            .finish()
                            .map_err(|e| std::io::Error::other(e.to_string()))?;
                        
                        // Wait for the peer to receive all data
                        // stopped() resolves when the peer has received everything
                        let _ = send_stream.stopped().await;
                        info!("Blob stream complete");
                    }
                    Err(e) => {
                        // Send error response
                        let resp = RuhrohMessage::BlobStreamResponse {
                            id,
                            size: None,
                            content_type: None,
                            error: Some(e.to_string()),
                        };
                        let resp_bytes = serde_json::to_vec(&resp).unwrap();
                        let len = resp_bytes.len() as u32;
                        send_stream
                            .write_all(&len.to_be_bytes())
                            .await
                            .map_err(|e| std::io::Error::other(e.to_string()))?;
                        send_stream
                            .write_all(&resp_bytes)
                            .await
                            .map_err(|e| std::io::Error::other(e.to_string()))?;
                        send_stream
                            .finish()
                            .map_err(|e| std::io::Error::other(e.to_string()))?;
                    }
                }
            }
            Ok(RuhrohMessage::BlobStreamResponse { .. }) => {
                // shouldn't receive responses as a server
                info!("Unexpected blob stream response");
            }
            Err(_) => {
                // Legacy format: sender:message
                let msg_str = String::from_utf8_lossy(&msg);
                use std::io::Write;
                if let Some((sender, content)) = msg_str.split_once(':') {
                    print!("\n\x1b[36m[{}]\x1b[0m {}\n> ", sender, content);
                    self.messages
                        .write()
                        .await
                        .push(format!("{}: {}", sender, content));
                } else {
                    print!(
                        "\n\x1b[36m[{}]\x1b[0m {}\n> ",
                        &remote_id.to_string()[..8],
                        msg_str
                    );
                    self.messages
                        .write()
                        .await
                        .push(format!("{}: {}", remote_id, msg_str));
                }
                let _ = std::io::stdout().flush();
            }
        }

        Ok(())
    }
}
