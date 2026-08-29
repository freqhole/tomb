//! federation endpoint - wraps iroh Endpoint for P2P connections
//!
//! this is the main entry point for iroh networking in freqhole.
//! handles binding the endpoint, accepting connections, and connecting to peers.
//!
//! uses iroh's Router pattern to handle multiple protocols:
//! - freqhole/1: existing P2P api protocol
//! - freqhole-blobz: iroh-blobs verified streaming (audio files)

use crate::blobz::BLOBS_ALPN;
use crate::config::{get_config, FederationConfig, RelayModeConfig};
use crate::error::{GrimoireError, GrimoireResult};
use crate::federation::identity;
use crate::federation::transport::admin_iroh::AdminProtocol;
use crate::federation::transport::admin_protocol::ADMIN_ALPN;
use crate::federation::transport::events_protocol::{EventsProtocol, EVENTS_ALPN};
use crate::federation::transport::freqhole_protocol::FreqholeProtocol;
use crate::federation::transport::protocol::FREQHOLE_ALPN;
use iroh::endpoint::{presets, RelayMode};
use iroh::protocol::{Router, RouterBuilder};
use iroh::{Endpoint, EndpointAddr, PublicKey, RelayMap, RelayUrl, SecretKey};
use iroh_blobs::provider::events::{EventMask, EventSender};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use tracing::{info, warn};

/// resolve the iroh relay mode from federation config.
///
/// returns `Ok(None)` when the public iroh relay should be used as-is (the
/// default, matching the preset). returns `Ok(Some(mode))` to override the
/// preset's relay setup:
/// - `custom_only`: route through `relay_url` only, no public fallback.
/// - `prefer_custom`: include both `relay_url` and the public n0 relays so the
///   endpoint can use whichever is reachable / lowest-latency (custom acts as
///   the preferred home relay when it is the closest).
///
/// errors when a custom mode is selected but `relay_url` is missing or invalid.
fn resolve_relay_mode(fed: Option<&FederationConfig>) -> GrimoireResult<Option<RelayMode>> {
    let fed = match fed {
        Some(f) => f,
        None => return Ok(None),
    };

    match fed.relay_mode {
        RelayModeConfig::Default => Ok(None),
        RelayModeConfig::CustomOnly => {
            let url = parse_relay_url(fed.relay_url.as_deref())?;
            info!("using custom iroh relay only: {}", url);
            Ok(Some(RelayMode::custom([url])))
        }
        RelayModeConfig::PreferCustom => {
            let url = parse_relay_url(fed.relay_url.as_deref())?;
            // start with the custom relay, then add the public n0 relays as
            // fallback. iroh selects its home relay by reachability/latency.
            let map = RelayMap::from(url.clone());
            map.extend(&RelayMode::Default.relay_map());
            info!("preferring custom iroh relay {} with public fallback", url);
            Ok(Some(RelayMode::Custom(map)))
        }
    }
}

/// parse a configured relay url string into a `RelayUrl`, rejecting empty or
/// missing values (required when a custom relay mode is selected).
fn parse_relay_url(url: Option<&str>) -> GrimoireResult<RelayUrl> {
    let url = url
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| GrimoireError::FederationApiError {
            message: "federation.relay_mode requires a non-empty federation.relay_url".to_string(),
        })?;
    url.parse::<RelayUrl>()
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("invalid federation.relay_url '{}': {}", url, e),
        })
}

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
        let mut builder = Endpoint::builder(presets::N0).secret_key(secret_key);

        // apply a custom relay map when configured. when relay_mode is the
        // default (public iroh relay only), leave the preset's relay setup
        // untouched.
        if let Some(relay_mode) = resolve_relay_mode(get_config().federation.as_ref())? {
            builder = builder.relay_mode(relay_mode);
        }

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

    /// start the router with the default protocol handlers only
    ///
    /// sets up:
    /// - freqhole/1: P2P api protocol
    /// - /iroh-bytes/4: iroh-blobs verified streaming
    pub async fn start_router(&mut self) -> GrimoireResult<()> {
        self.start_router_with(|builder| builder).await
    }

    /// start the router with default handlers plus extra protocol handlers
    ///
    /// the `customize` closure receives the RouterBuilder after freqhole/1
    /// and iroh-blobs handlers are registered, allowing callers to chain
    /// additional `.accept(alpn, handler)` calls for their own protocols.
    ///
    /// example: charnel uses this to register skein's social ALPNs
    /// (freqhole-friendz/1, iroh/automerge-repo/1) so the endpoint can
    /// accept incoming connections for those protocols.
    pub async fn start_router_with<F>(&mut self, customize: F) -> GrimoireResult<()>
    where
        F: FnOnce(RouterBuilder) -> RouterBuilder,
    {
        info!("[p2p-endpoint] starting router with protocol handlers");

        // create freqhole/1 protocol handler
        let freqhole_handler = FreqholeProtocol::new();

        // create iroh-blobs protocol handler with event tracing enabled,
        // sourced from the shared storage node. attach this endpoint to the
        // node's downloader too, so it can drive verified peer-to-peer
        // fetches for any future consumer (e.g. the snatch engine).
        let storage_node = crate::database::storage_node().await?;
        let event_sender = EventSender::DEFAULT.tracing(EventMask::default());
        let blobs_handler = storage_node.blobs_protocol(Some(event_sender));
        storage_node.attach_endpoint(&self.endpoint);

        // build router with core protocols
        let builder = Router::builder(self.endpoint.clone())
            .accept(FREQHOLE_ALPN, freqhole_handler)
            .accept(BLOBS_ALPN, blobs_handler);

        // optional: admin ALPN, only when [remote_admin].enabled = true.
        // see docs/wizard-remote-admin.md.
        let admin_enabled = get_config()
            .federation
            .as_ref()
            .and_then(|f| f.remote_admin.as_ref())
            .is_some_and(|a| a.enabled);
        let builder = if admin_enabled {
            info!("[p2p-endpoint] registering freqhole-admin/1 ALPN");
            builder.accept(ADMIN_ALPN, AdminProtocol::new())
        } else {
            builder
        };

        // always-on: freqhole-events/1 streaming subscriptions. visibility
        // is enforced per-event by `caller_can_see`; unknown peers are
        // rejected at accept-time by `get_caller_for_peer`. see
        // docs/bidirectional-job-progress-plan.md (p4).
        info!("[p2p-endpoint] registering freqhole-events/1 ALPN");
        let builder = builder.accept(EVENTS_ALPN, EventsProtocol::new());

        // let caller add extra protocol handlers
        let builder = customize(builder);

        let router = builder.spawn();

        info!("[p2p-endpoint] router started");

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::RelayModeConfig;

    fn fed(relay_mode: RelayModeConfig, relay_url: Option<&str>) -> FederationConfig {
        FederationConfig {
            relay_mode,
            relay_url: relay_url.map(str::to_string),
            ..Default::default()
        }
    }

    #[test]
    fn relay_mode_default_leaves_preset_untouched() {
        // no federation config at all: no override.
        assert!(resolve_relay_mode(None).unwrap().is_none());

        // federation config present but relay_mode left at its default: still no override.
        let cfg = fed(RelayModeConfig::Default, None);
        assert!(resolve_relay_mode(Some(&cfg)).unwrap().is_none());
    }

    #[test]
    fn relay_mode_custom_only_routes_through_custom_relay_alone() {
        let cfg = fed(
            RelayModeConfig::CustomOnly,
            Some("https://relay.example.com"),
        );
        let mode = resolve_relay_mode(Some(&cfg)).unwrap().unwrap();
        let url: RelayUrl = "https://relay.example.com".parse().unwrap();

        match mode {
            RelayMode::Custom(map) => {
                assert!(map.contains(&url));
                assert_eq!(
                    map.len(),
                    1,
                    "custom_only must not include the public relays"
                );
            }
            other => panic!("expected RelayMode::Custom, got {other:?}"),
        }
    }

    #[test]
    fn relay_mode_prefer_custom_includes_public_fallback() {
        let cfg = fed(
            RelayModeConfig::PreferCustom,
            Some("https://relay.example.com"),
        );
        let mode = resolve_relay_mode(Some(&cfg)).unwrap().unwrap();
        let custom_url: RelayUrl = "https://relay.example.com".parse().unwrap();
        let public_map = RelayMode::Default.relay_map();

        match mode {
            RelayMode::Custom(map) => {
                assert!(map.contains(&custom_url), "custom relay must be present");
                assert!(
                    map.len() > public_map.len(),
                    "prefer_custom must include the public relays alongside the custom one"
                );
            }
            other => panic!("expected RelayMode::Custom, got {other:?}"),
        }
    }

    #[test]
    fn relay_mode_custom_requires_a_relay_url() {
        let cfg = fed(RelayModeConfig::CustomOnly, None);
        assert!(resolve_relay_mode(Some(&cfg)).is_err());

        let cfg = fed(RelayModeConfig::PreferCustom, Some("   "));
        assert!(resolve_relay_mode(Some(&cfg)).is_err());
    }
}
