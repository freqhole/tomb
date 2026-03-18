//! federation endpoint - wraps iroh Endpoint for P2P connections
//!
//! this is the main entry point for iroh networking in freqhole.
//! handles binding the endpoint, accepting connections, and connecting to peers.

use crate::error::{GrimoireError, GrimoireResult};
use crate::federation::identity;
use crate::federation::transport::protocol::FREQHOLE_ALPN;
use iroh::{Endpoint, EndpointAddr, PublicKey, SecretKey};
use std::sync::Arc;
use tracing::{info, warn};

/// federation endpoint - manages iroh P2P connections
pub struct FederationEndpoint {
    endpoint: Endpoint,
    node_id: PublicKey,
    /// callback for handling incoming connections
    /// stored so we can spawn the accept loop
    #[allow(dead_code)]
    accept_handle: Option<tokio::task::JoinHandle<()>>,
}

impl FederationEndpoint {
    /// create a new federation endpoint
    ///
    /// loads or generates the iroh keypair, binds the endpoint,
    /// and optionally starts the accept loop for incoming connections.
    pub async fn new() -> GrimoireResult<Self> {
        // load our keypair
        let secret_key = identity::load_or_generate_keypair()?;
        let node_id = secret_key.public();

        info!("starting federation endpoint, node_id: {}", node_id);

        // build and bind the endpoint
        let endpoint = Self::build_endpoint(secret_key).await?;

        Ok(Self {
            endpoint,
            node_id,
            accept_handle: None,
        })
    }

    /// build the iroh endpoint with our config
    async fn build_endpoint(secret_key: SecretKey) -> GrimoireResult<Endpoint> {
        let endpoint = Endpoint::builder()
            .secret_key(secret_key)
            .alpns(vec![FREQHOLE_ALPN.to_vec()])
            .bind()
            .await
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to bind iroh endpoint: {}", e),
            })?;

        Ok(endpoint)
    }

    /// get our node_id
    pub fn node_id(&self) -> PublicKey {
        self.node_id
    }

    /// get the underlying endpoint (for advanced use)
    pub fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }

    /// start accepting incoming connections
    ///
    /// spawns a background task that accepts connections and calls the handler
    /// for each one. the handler receives the peer's node_id and connection.
    pub fn start_accept_loop<F>(&mut self, handler: F)
    where
        F: Fn(PublicKey, iroh::endpoint::Connection) + Send + Sync + 'static,
    {
        let endpoint = self.endpoint.clone();
        let handler = Arc::new(handler);

        info!("[p2p-endpoint] starting accept loop");

        let handle = tokio::spawn(async move {
            loop {
                info!("[p2p-endpoint] waiting for incoming connection...");
                match endpoint.accept().await {
                    Some(incoming) => {
                        info!("[p2p-endpoint] got incoming connection, awaiting handshake...");
                        let handler = handler.clone();

                        tokio::spawn(async move {
                            match incoming.await {
                                Ok(conn) => {
                                    let peer_id = conn.remote_id();
                                    info!(
                                        "[p2p-endpoint] accepted connection from peer: {}",
                                        peer_id
                                    );
                                    handler(peer_id, conn);
                                }
                                Err(e) => {
                                    warn!("[p2p-endpoint] failed to accept connection: {}", e);
                                }
                            }
                        });
                    }
                    None => {
                        info!("[p2p-endpoint] endpoint closed, stopping accept loop");
                        break;
                    }
                }
            }
        });

        self.accept_handle = Some(handle);
    }

    /// connect to a peer by node_id
    ///
    /// iroh will try direct connection first, then fall back to relay.
    pub async fn connect(
        &self,
        peer_node_id: PublicKey,
    ) -> GrimoireResult<iroh::endpoint::Connection> {
        let addr = EndpointAddr::from_parts(peer_node_id, []);

        info!("connecting to peer: {}", peer_node_id);

        let conn = self
            .endpoint
            .connect(addr, FREQHOLE_ALPN)
            .await
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to connect to peer {}: {}", peer_node_id, e),
            })?;

        info!("connected to peer: {}", peer_node_id);
        Ok(conn)
    }

    /// gracefully close the endpoint
    pub async fn close(self) {
        info!("closing federation endpoint");
        self.endpoint.close().await;
    }
}
