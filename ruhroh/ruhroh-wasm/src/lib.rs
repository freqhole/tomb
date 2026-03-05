//! ruhroh-wasm: browser client for P2P federation
//!
//! uses iroh to connect to ruhroh peers from the browser

use iroh::{Endpoint, EndpointAddr, SecretKey};
use js_sys::Uint8Array;
use serde::{Deserialize, Serialize};
use tracing::info;
use tracing::level_filters::LevelFilter;
use tracing_subscriber_wasm::MakeConsoleWriter;
use wasm_bindgen::{prelude::wasm_bindgen, JsError, JsValue};

/// ALPN protocol identifier (must match native client)
const RUHROH_ALPN: &[u8] = b"ruhroh/1";

/// Protocol messages (matches ruhroh-client)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum RuhrohMessage {
    Chat { from: String, text: String },
    ProxyRequest {
        id: u64,
        method: String,
        path: String,
        body: Option<String>,
    },
    ProxyResponse {
        id: u64,
        status: u16,
        body: String,
    },
    BlobRequest {
        id: u64,
        blob_id: String,
    },
    BlobResponse {
        id: u64,
        ticket: Option<String>,
        error: Option<String>,
    },
    BlobStreamRequest {
        id: u64,
        blob_id: String,
    },
    BlobStreamResponse {
        id: u64,
        size: Option<u64>,
        content_type: Option<String>,
        error: Option<String>,
    },
}

#[wasm_bindgen(start)]
fn start() {
    console_error_panic_hook::set_once();

    tracing_subscriber::fmt()
        .with_max_level(LevelFilter::DEBUG)
        .with_writer(MakeConsoleWriter::default().map_trace_level_to(tracing::Level::DEBUG))
        .without_time()
        .with_ansi(false)
        .init();

    info!("ruhroh-wasm initialized");
}

/// Browser P2P node
#[wasm_bindgen]
pub struct RuhrohNode {
    endpoint: Endpoint,
    display_name: String,
}

#[wasm_bindgen]
impl RuhrohNode {
    /// Create a new node with random identity
    #[wasm_bindgen(constructor)]
    pub async fn new(display_name: String) -> Result<RuhrohNode, JsError> {
        info!("Creating ruhroh node for {}", display_name);

        // Generate random secret key
        let mut bytes = [0u8; 32];
        getrandom::getrandom(&mut bytes).map_err(|e| JsError::new(&e.to_string()))?;
        let secret_key = SecretKey::from_bytes(&bytes);

        // Create endpoint
        let endpoint = Endpoint::builder()
            .secret_key(secret_key)
            .alpns(vec![RUHROH_ALPN.to_vec()])
            .bind()
            .await
            .map_err(to_js_err)?;

        // Wait for relay connection
        endpoint.online().await;

        info!("Node ready: {}", endpoint.secret_key().public());

        Ok(RuhrohNode {
            endpoint,
            display_name,
        })
    }

    /// Get our endpoint ID (public key)
    pub fn endpoint_id(&self) -> String {
        self.endpoint.secret_key().public().to_string()
    }

    /// Get our full endpoint address (includes relay info)
    pub fn endpoint_addr(&self) -> Result<String, JsError> {
        let addr = self.endpoint.addr();
        serde_json::to_string(&addr).map_err(to_js_err)
    }

    /// Send a chat message to a peer
    pub async fn send_chat(&self, peer_addr_json: &str, message: &str) -> Result<(), JsError> {
        let addr: EndpointAddr = serde_json::from_str(peer_addr_json).map_err(to_js_err)?;

        info!("Connecting to peer {}", addr.id);
        let conn = self
            .endpoint
            .connect(addr, RUHROH_ALPN)
            .await
            .map_err(to_js_err)?;

        let (mut send, _recv) = conn.open_bi().await.map_err(to_js_err)?;

        let msg = RuhrohMessage::Chat {
            from: self.display_name.clone(),
            text: message.to_string(),
        };
        let bytes = serde_json::to_vec(&msg).map_err(to_js_err)?;

        send.write_all(&bytes).await.map_err(to_js_err)?;
        send.finish().map_err(to_js_err)?;

        // Give time for transmission
        n0_future::time::sleep(std::time::Duration::from_millis(100)).await;

        info!("Message sent");
        Ok(())
    }

    /// Make a proxy request to a peer's freqhole API
    pub async fn proxy_request(
        &self,
        peer_addr_json: &str,
        method: &str,
        path: &str,
        body: Option<String>,
    ) -> Result<JsValue, JsError> {
        let addr: EndpointAddr = serde_json::from_str(peer_addr_json).map_err(to_js_err)?;

        info!("Proxy {} {} to {}", method, path, addr.id);
        let conn = self
            .endpoint
            .connect(addr, RUHROH_ALPN)
            .await
            .map_err(to_js_err)?;

        let (mut send, mut recv) = conn.open_bi().await.map_err(to_js_err)?;

        let request = RuhrohMessage::ProxyRequest {
            id: 1,
            method: method.to_string(),
            path: path.to_string(),
            body,
        };
        let bytes = serde_json::to_vec(&request).map_err(to_js_err)?;

        send.write_all(&bytes).await.map_err(to_js_err)?;
        send.finish().map_err(to_js_err)?;

        // Read response
        let response_bytes = recv.read_to_end(1024 * 1024).await.map_err(to_js_err)?;
        let response: RuhrohMessage =
            serde_json::from_slice(&response_bytes).map_err(to_js_err)?;

        match response {
            RuhrohMessage::ProxyResponse { status, body, .. } => {
                let result = serde_json::json!({
                    "status": status,
                    "body": body
                });
                Ok(serde_wasm_bindgen::to_value(&result)?)
            }
            _ => Err(JsError::new("unexpected response type")),
        }
    }

    /// Request a blob from a peer (streams bytes directly)
    pub async fn request_blob(
        &self,
        peer_addr_json: &str,
        blob_id: &str,
    ) -> Result<Uint8Array, JsError> {
        let addr: EndpointAddr = serde_json::from_str(peer_addr_json).map_err(to_js_err)?;

        info!("Requesting blob stream {} from {}", blob_id, addr.id);
        let conn = self
            .endpoint
            .connect(addr, RUHROH_ALPN)
            .await
            .map_err(to_js_err)?;

        let (mut send, mut recv) = conn.open_bi().await.map_err(to_js_err)?;

        // Send BlobStreamRequest
        let request = RuhrohMessage::BlobStreamRequest {
            id: 1,
            blob_id: blob_id.to_string(),
        };
        let bytes = serde_json::to_vec(&request).map_err(to_js_err)?;

        send.write_all(&bytes).await.map_err(to_js_err)?;
        send.finish().map_err(to_js_err)?;

        // Read length-prefixed header
        let mut len_buf = [0u8; 4];
        recv.read_exact(&mut len_buf).await.map_err(to_js_err)?;
        let header_len = u32::from_be_bytes(len_buf) as usize;

        // Read header
        let mut header_buf = vec![0u8; header_len];
        recv.read_exact(&mut header_buf).await.map_err(to_js_err)?;

        let response: RuhrohMessage =
            serde_json::from_slice(&header_buf).map_err(to_js_err)?;

        match response {
            RuhrohMessage::BlobStreamResponse { size, error, .. } => {
                if let Some(err) = error {
                    return Err(JsError::new(&err));
                }

                let expected_size = size.unwrap_or(0) as usize;
                info!("Receiving {} bytes", expected_size);

                // Read all remaining bytes (the file content)
                let data = recv
                    .read_to_end(100 * 1024 * 1024) // 100MB max
                    .await
                    .map_err(to_js_err)?;

                info!("Received {} bytes", data.len());

                // Return as Uint8Array
                Ok(Uint8Array::from(&data[..]))
            }
            _ => Err(JsError::new("unexpected response type")),
        }
    }
}

fn to_js_err<E: std::fmt::Display>(e: E) -> JsError {
    JsError::new(&e.to_string())
}
