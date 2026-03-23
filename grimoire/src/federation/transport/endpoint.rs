//! federation endpoint - wraps iroh Endpoint for P2P connections
//!
//! this is the main entry point for iroh networking in freqhole.
//! handles binding the endpoint, accepting connections, and connecting to peers.
//!
//! uses iroh's Router pattern to handle multiple protocols:
//! - freqhole/1: existing P2P proxy protocol
//! - freqhole-blobz: iroh-blobs verified streaming (audio files)

use crate::blobz::{get_blobs_store, BLOBS_ALPN};
use crate::config::get_config;
use crate::error::{GrimoireError, GrimoireResult};
use crate::federation::identity;
use crate::federation::transport::freqhole_protocol::FreqholeProtocol;
use crate::federation::transport::protocol::FREQHOLE_ALPN;
use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::{Endpoint, EndpointAddr, PublicKey, SecretKey};
use iroh_blobs::provider::events::{EventMask, EventSender};
use iroh_blobs::BlobsProtocol;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use tracing::{info, warn};

/// federation endpoint - manages iroh P2P connections
pub struct FederationEndpoint {
    endpoint: Endpoint,
    node_id: PublicKey,
    /// router handle for protocol dispatch
    router: Option<Router>,
}

impl FederationEndpoint {
    /// create a new federation endpoint
    ///
    /// loads or generates the iroh keypair, binds the endpoint,
    /// and sets up protocol handlers for freqhole/1 and freqhole-blobz.
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
            router: None,
        })
    }

    /// build the iroh endpoint with our config
    async fn build_endpoint(secret_key: SecretKey) -> GrimoireResult<Endpoint> {
        // check if a specific bind port is configured (for port forwarding)
        // 0 means disabled (use random port), same as omitting the value
        let bind_port = get_config()
            .federation
            .as_ref()
            .and_then(|f| f.bind_port)
            .filter(|&p| p != 0);

        // use N0 preset for relay + DNS discovery (peers can find each other)
        let builder = Endpoint::builder(presets::N0).secret_key(secret_key);

        let endpoint = if let Some(port) = bind_port {
            // bind to specific port (for users with manual router port forwarding)
            let bind_addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, port));
            info!(
                "binding iroh endpoint to UDP port {} (port forwarding mode)",
                port
            );
            builder
                .bind_addr(bind_addr)
                .map_err(|e| GrimoireError::FederationApiError {
                    message: format!("invalid bind address for port {}: {}", port, e),
                })?
                .bind()
                .await
                .map_err(|e| GrimoireError::FederationApiError {
                    message: format!("failed to bind iroh endpoint to port {}: {}", port, e),
                })?
        } else {
            // bind to random available port (default)
            builder
                .bind()
                .await
                .map_err(|e| GrimoireError::FederationApiError {
                    message: format!("failed to bind iroh endpoint: {}", e),
                })?
        };

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

    /// start the router with both protocol handlers
    ///
    /// sets up:
    /// - freqhole/1: existing P2P proxy protocol
    /// - freqhole-blobz: iroh-blobs verified streaming
    pub async fn start_router(&mut self) -> GrimoireResult<()> {
        info!("[p2p-endpoint] starting router with dual protocol support");

        // create freqhole/1 protocol handler
        let freqhole_handler = FreqholeProtocol::new();

        // create iroh-blobs protocol handler with event tracing enabled
        let blobs_store = get_blobs_store().await?;
        let event_sender = EventSender::DEFAULT.tracing(EventMask::default());
        let blobs_handler = BlobsProtocol::new(blobs_store, Some(event_sender));

        // build router with both protocols
        let router = Router::builder(self.endpoint.clone())
            .accept(FREQHOLE_ALPN, freqhole_handler)
            .accept(BLOBS_ALPN, blobs_handler)
            .spawn();

        info!("[p2p-endpoint] router started with ALPNs: freqhole/1, /iroh-bytes/4");

        self.router = Some(router);
        Ok(())
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

    /// connect to a peer for iroh-blobs streaming
    ///
    /// uses the freqhole-blobz ALPN for verified streaming
    pub async fn connect_for_blobs(
        &self,
        peer_node_id: PublicKey,
    ) -> GrimoireResult<iroh::endpoint::Connection> {
        let addr = EndpointAddr::from_parts(peer_node_id, []);

        info!("connecting to peer for blobs: {}", peer_node_id);

        let conn = self.endpoint.connect(addr, BLOBS_ALPN).await.map_err(|e| {
            GrimoireError::FederationApiError {
                message: format!(
                    "failed to connect to peer {} for blobs: {}",
                    peer_node_id, e
                ),
            }
        })?;

        info!("connected to peer for blobs: {}", peer_node_id);
        Ok(conn)
    }

    /// gracefully close the endpoint
    pub async fn close(self) {
        info!("closing federation endpoint");

        // shutdown router if running
        if let Some(router) = self.router {
            if let Err(e) = router.shutdown().await {
                warn!("error shutting down router: {:?}", e);
            }
        }

        self.endpoint.close().await;
    }
}
