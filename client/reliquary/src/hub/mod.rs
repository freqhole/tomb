//! hub peer service — orchestrates the always-on P2P hub.
//!
//! ties together the iroh endpoint, hub_repo (automerge sync via custom
//! CBOR handler), friendz handler (presence + messaging), iroh-blobs
//! (blob serving + downloading), and blob snatcher into a single service
//! that can be started from the CLI.
//!
//! split into submodules:
//! - `messages`: friendz message dispatch (friend requests, profile, heartbeat)
//! - `canvas`: canvas invite, update, and gossip digest handling

mod canvas;
mod messages;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::freqhole::{FreqholeHandler, FREQHOLE_ALPN};
use crate::hub_repo::HubRepo;
use crate::protocol::handler::FriendzHandler;
use crate::protocol::messages::FRIENDZ_ALPN;
use crate::snatch::BlobSnatcher;

use crate::sync::{IrohRepo, AUTOMERGE_REPO_ALPN};

use crate::protocol::handler::FriendzEvent;
use crate::protocol::messages::FriendzMessage;

use iroh_blobs::api::downloader::Downloader;
use iroh_blobs::BlobsProtocol;

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

/// errors that can occur during hub peer startup or operation.
#[derive(Debug, thiserror::Error)]
pub enum HubError {
    #[error("identity error: {0}")]
    Identity(#[from] crate::identity::IdentityError),

    #[error("storage error: {0}")]
    Storage(#[from] sqlx::Error),

    #[error("endpoint error: {0}")]
    Endpoint(String),

    #[error("iroh repo error: {0}")]
    IrohRepo(String),

    #[error("grimoire error: {0}")]
    Grimoire(String),
}

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

/// configuration for the hub peer service.
pub struct HubPeerConfig {
    /// path to the data directory (contains identity key, automerge db, etc.)
    pub data_dir: PathBuf,
    /// path to the automerge SQLite database file
    pub automerge_db_path: PathBuf,
    /// local username for the hub peer (used in heartbeats)
    pub username: String,
    /// bio for the hub peer's profile
    pub bio: String,
    /// path to avatar image file (processed into a WebP thumbnail on boot)
    pub avatar_path: String,
    /// optional: bind the iroh endpoint to a specific UDP port
    pub bind_port: Option<u16>,
}

// ---------------------------------------------------------------------------
// service
// ---------------------------------------------------------------------------

/// the hub peer service — an always-on peer that syncs automerge documents,
/// participates in the friendz protocol, serves and snatches blobs.
pub struct HubPeerService {
    pub(crate) endpoint: iroh::Endpoint,
    router: iroh::protocol::Router,
    pub(crate) iroh_repo: IrohRepo,
    /// custom automerge sync handler — processes CBOR messages from JS peers
    pub(crate) hub_repo: HubRepo,
    pub(crate) friendz: FriendzHandler,
    friendz_events: tokio::sync::mpsc::UnboundedReceiver<FriendzEvent>,
    /// the hub peer's grimoire user_id
    pub(crate) hub_user_id: String,
    /// the hub peer's iroh node ID as a string
    pub(crate) node_id_str: String,
    /// cached profile: username (from config, updated on boot)
    pub(crate) profile_username: String,
    /// cached profile: bio (from config, updated on boot)
    pub(crate) profile_bio: String,
    /// cached profile: processed avatar data URL (WebP thumbnail, generated on boot)
    pub(crate) profile_avatar_data_url: String,
    /// canvas doc IDs the hub is participating in (for gossip and relay)
    pub(crate) canvas_doc_ids: Arc<Mutex<HashSet<String>>>,
    /// iroh-blobs downloader for verified blob transfers (FsStore-backed)
    blobs_downloader: Downloader,
    /// trigger to wake the blob snatcher for an immediate scan
    pub(crate) snatch_trigger: Arc<tokio::sync::Notify>,
}

impl HubPeerService {
    /// start the hub peer service.
    ///
    /// this creates the iroh endpoint, hub_repo, and protocol handlers,
    /// wires them together, and starts the iroh router. after this returns,
    /// the service is ready to accept connections.
    pub async fn start(config: HubPeerConfig) -> Result<Self, HubError> {
        // 1. load or generate identity
        let secret_key = crate::identity::load_or_generate_keypair(&config.data_dir)?;
        let node_id = secret_key.public();
        let node_id_str = node_id.to_string();
        tracing::info!(node_id = %node_id_str, "hub peer identity loaded");

        // 1.5. bootstrap grimoire user account for the hub peer.
        // uses resolve_or_create_user_for_node which either finds an existing user
        // linked to this node_id, or creates a new one.
        let social_service = grimoire::SocialService::new();
        let resolved = social_service
            .resolve_or_create_user_for_node(&node_id_str, Some(&config.username))
            .await
            .map_err(|e| HubError::Grimoire(format!("failed to bootstrap hub user: {e}")))?;

        if resolved.created {
            tracing::info!(
                user_id = %resolved.user_id,
                username = %resolved.username,
                "created new grimoire user for hub peer"
            );
        } else {
            tracing::info!(
                user_id = %resolved.user_id,
                username = %resolved.username,
                "using existing grimoire user for hub peer"
            );
        }

        // process avatar image if configured
        let avatar_data_url = if !config.avatar_path.is_empty() {
            let avatar_file = if std::path::Path::new(&config.avatar_path).is_absolute() {
                PathBuf::from(&config.avatar_path)
            } else {
                config.data_dir.join(&config.avatar_path)
            };
            match std::fs::read(&avatar_file) {
                Ok(image_data) => {
                    match grimoire::blob_data::resize_to_square_webp(&image_data, 128) {
                        Ok(webp_data) => {
                            use base64::Engine;
                            let b64 = base64::engine::general_purpose::STANDARD.encode(&webp_data);
                            let data_url = format!("data:image/webp;base64,{}", b64);
                            tracing::info!(
                                path = %avatar_file.display(),
                                size_bytes = webp_data.len(),
                                "processed hub peer avatar"
                            );
                            data_url
                        }
                        Err(e) => {
                            tracing::warn!(
                                path = %avatar_file.display(),
                                error = %e,
                                "failed to process hub peer avatar image"
                            );
                            String::new()
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        path = %avatar_file.display(),
                        error = %e,
                        "failed to read hub peer avatar file"
                    );
                    String::new()
                }
            }
        } else {
            String::new()
        };

        // cache profile fields for responding to profile requests at runtime
        let profile_username = config.username.clone();
        let profile_bio = config.bio.clone();

        // update the hub peer's node profile on every boot so config changes take effect
        if let Err(e) = social_service
            .update_remote_node_profile(
                &node_id_str,
                &config.username,
                &config.bio,
                &avatar_data_url,
                0x6366f1, // default indigo accent color
            )
            .await
        {
            tracing::warn!(error = %e, "failed to update hub peer node profile");
        }

        let hub_user_id = resolved.user_id;

        // 2. create iroh endpoint
        let builder = iroh::Endpoint::builder(iroh::endpoint::presets::N0).secret_key(secret_key);
        let builder = if let Some(port) = config.bind_port {
            use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
            let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, port));
            tracing::info!(port, "binding to specific UDP port");
            builder
                .bind_addr(addr)
                .map_err(|e| HubError::Endpoint(e.to_string()))?
        } else {
            builder
        };
        let endpoint = builder
            .bind()
            .await
            .map_err(|e| HubError::Endpoint(e.to_string()))?;
        tracing::info!("iroh endpoint bound");

        // 3. create hub_repo — custom automerge sync handler that speaks
        // the JS automerge-repo v2.x CBOR wire format directly
        let hub_repo = HubRepo::new(node_id_str.clone(), &config.automerge_db_path)
            .await
            .map_err(|e| HubError::IrohRepo(format!("failed to create hub repo: {e}")))?;
        tracing::info!("hub_repo loaded");

        // 4. create IrohRepo (automerge sync bridge) using hub_repo
        let iroh_repo = IrohRepo::new(endpoint.clone(), hub_repo.clone());

        // 5. create FriendzHandler
        let (friendz, friendz_events) =
            FriendzHandler::new(endpoint.clone(), node_id_str.clone(), config.username);

        // 6. setup iroh-blobs with FsStore for blob serving + downloading.
        // blobs are loaded on-demand from grimoire via ensure_blob_by_blake3 (reference mode,
        // only stores outboard tree). downloaded blobs land on FsStore disk instead of RAM.
        let fs_store = grimoire::blobz::get_blobs_store()
            .await
            .map_err(|e| HubError::Grimoire(format!("failed to init FsStore: {e}")))?;
        let blobs_downloader = Downloader::new(fs_store, &endpoint);
        let blobs_protocol = BlobsProtocol::new(fs_store, None);
        let freqhole_handler = FreqholeHandler::new(fs_store);
        tracing::info!("iroh-blobs FsStore and freqhole/1 handler initialized");

        // 7. build and start the iroh router with all protocol handlers
        let router = iroh::protocol::Router::builder(endpoint.clone())
            .accept(AUTOMERGE_REPO_ALPN, iroh_repo.clone())
            .accept(FRIENDZ_ALPN, friendz.clone())
            .accept(FREQHOLE_ALPN, freqhole_handler)
            .accept(iroh_blobs::ALPN, blobs_protocol)
            .spawn();
        tracing::info!(
            "iroh router started with automerge-repo, friendz, freqhole/1, and iroh-blobs protocols"
        );

        let snatch_trigger = Arc::new(tokio::sync::Notify::new());

        Ok(Self {
            endpoint,
            router,
            iroh_repo,
            hub_repo,
            friendz,
            friendz_events,
            hub_user_id,
            node_id_str,
            profile_username,
            profile_bio,
            profile_avatar_data_url: avatar_data_url,
            canvas_doc_ids: Arc::new(Mutex::new(HashSet::new())),
            blobs_downloader,
            snatch_trigger,
        })
    }

    /// run the hub peer service until the cancellation token is cancelled.
    ///
    /// this drives the friendz heartbeat loop and processes incoming events.
    /// on cancellation, sends offline announcements to all online peers before
    /// shutting down gracefully.
    pub async fn run(mut self, cancel: CancellationToken) {
        tracing::info!(
            node_id = %self.endpoint.id(),
            "hub peer service running"
        );

        // spawn the blob snatcher scan loop
        let snatcher = BlobSnatcher::new(
            self.hub_repo.clone(),
            self.endpoint.clone(),
            self.blobs_downloader.clone(),
            self.node_id_str.clone(),
            self.snatch_trigger.clone(),
        );
        let snatch_cancel = cancel.clone();
        let snatch_handle = tokio::spawn(async move {
            snatcher.run_scan_loop(snatch_cancel).await;
        });
        tracing::info!("blob snatcher scan loop started");

        // spawn a debouncer that listens for doc changes and triggers a blob
        // snatch scan shortly after activity settles. this gives near-instant
        // snatching when new file attachments arrive via automerge sync.
        let debounce_trigger = self.snatch_trigger.clone();
        let mut doc_rx = self.hub_repo.subscribe_doc_changes();
        let debounce_cancel = cancel.clone();
        tokio::spawn(async move {
            loop {
                // wait for the first doc change (or cancellation)
                tokio::select! {
                    _ = debounce_cancel.cancelled() => break,
                    result = doc_rx.recv() => {
                        match result {
                            Ok(doc_id) => {
                                tracing::debug!(doc_id, "doc change detected, starting debounce");
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                                tracing::debug!(skipped = n, "doc_notify lagged, triggering scan");
                                debounce_trigger.notify_one();
                                continue;
                            }
                            Err(_) => break, // channel closed
                        }
                    }
                }

                // debounce: drain changes for 3 seconds of quiet
                loop {
                    match tokio::time::timeout(Duration::from_secs(3), doc_rx.recv()).await {
                        Ok(Ok(_)) => continue, // more changes, keep draining
                        Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(_))) => continue,
                        _ => break, // timeout (quiet period) or channel closed
                    }
                }

                tracing::info!("doc changes settled, triggering blob snatch scan");
                debounce_trigger.notify_one();
            }
        });

        // run the friendz heartbeat loop and event processing concurrently
        let friendz = self.friendz.clone();
        let hub_user_id = self.hub_user_id.clone();
        let local_node_id = self.node_id_str.clone();
        let heartbeat_handle = tokio::spawn(async move {
            friendz
                .run_heartbeat_loop(move || {
                    // read friends from grimoire's SQLite tables, same as the tauri app.
                    // this queries peer_friendz + user_peer_nodez and extracts all node IDs.
                    let social_service = grimoire::SocialService::new();
                    let snapshot = tokio::task::block_in_place(|| {
                        tokio::runtime::Handle::current().block_on(
                            social_service.get_social_snapshot(&hub_user_id, &local_node_id),
                        )
                    });
                    match snapshot {
                        Ok(snap) => {
                            let mut ids = Vec::new();
                            for friend in &snap.friends {
                                for node in &friend.node_ids {
                                    if node.node_id != local_node_id {
                                        ids.push(node.node_id.clone());
                                    }
                                }
                            }
                            tracing::debug!(
                                friend_count = snap.friends.len(),
                                node_count = ids.len(),
                                "loaded friend node IDs from grimoire"
                            );
                            ids
                        }
                        Err(e) => {
                            tracing::warn!(error = %e, "failed to load friends from grimoire");
                            Vec::new()
                        }
                    }
                })
                .await;
        });

        // periodic sync health check — log connected peers every 30s
        // uses hub_repo for actual connection state
        let sync_health_hub_repo = self.hub_repo.clone();
        let sync_health_canvas_ids = self.canvas_doc_ids.clone();
        let sync_health_cancel = cancel.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
            interval.tick().await; // skip first immediate tick
            loop {
                tokio::select! {
                    _ = sync_health_cancel.cancelled() => break,
                    _ = interval.tick() => {
                        let peer_ids = sync_health_hub_repo.connected_peer_ids().await;
                        let peer_count = peer_ids.len();
                        let canvas_count = sync_health_canvas_ids.lock().await.len();

                        // also check how many docs hub_repo has received
                        let doc_count = sync_health_hub_repo.document_count().await;

                        tracing::info!(
                            connected_peers = ?peer_ids,
                            total_connections = peer_count,
                            synced_documents = doc_count,
                            tracked_canvases = canvas_count,
                            "sync health check"
                        );
                    }
                }
            }
        });

        // process friendz events until cancellation.
        // the inner select! ensures that cancel interrupts even a long-running
        // handler (e.g. the 3s gossip delay, repo.find(), send_message() to an
        // unreachable peer) instead of waiting for it to finish.
        loop {
            let event = tokio::select! {
                _ = cancel.cancelled() => {
                    tracing::info!("shutdown requested");
                    break;
                }
                event = self.friendz_events.recv() => {
                    match event {
                        Some(e) => e,
                        None => {
                            tracing::info!("friendz event channel closed");
                            break;
                        }
                    }
                }
            };

            tokio::select! {
                _ = cancel.cancelled() => {
                    tracing::info!("shutdown requested during event handling, dropping event");
                    break;
                }
                _ = self.handle_friendz_event(event) => {}
            }
        }

        // graceful shutdown: announce offline, stop heartbeat + snatcher, close everything
        heartbeat_handle.abort();
        snatch_handle.abort();
        self.shutdown().await;
    }

    /// check whether a node_id belongs to a friend of the hub peer.
    ///
    /// if the peer is in `user_peer_nodez` (an allowed peer) but doesn't have
    /// a `peer_friendz` row yet, the friendship is auto-created. this handles
    /// the common case where the browser sent a FriendRequest while the hub was
    /// offline — the friendz protocol doesn't queue messages, so the hub never
    /// saw it and never created the friendship row.
    pub(crate) async fn is_friend(&self, node_id: &str) -> bool {
        let user_service = grimoire::users::UserService::new();
        let response = user_service.get_user_by_node_id(node_id).await;
        let peer_user = match response.data {
            Some(user) => user,
            None => {
                tracing::debug!(
                    peer = %node_id,
                    "is_friend: peer not in user_peer_nodez"
                );
                return false;
            }
        };

        let social_repo = grimoire::social::repository::SocialRepository::new();
        match social_repo
            .is_friend(&self.hub_user_id, &peer_user.id)
            .await
        {
            Ok(true) => return true,
            Ok(false) => {
                // peer is an allowed peer (in user_peer_nodez) but no friendship
                // row exists — auto-create it. this covers the case where the
                // browser sent a FriendRequest while the hub was offline.
                tracing::info!(
                    peer = %node_id,
                    peer_user_id = %peer_user.id,
                    peer_username = %peer_user.username,
                    "is_friend: allowed peer has no friendship row, auto-creating"
                );
                match social_repo
                    .add_friend(&self.hub_user_id, &peer_user.id, None)
                    .await
                {
                    Ok(_) => {
                        tracing::info!(
                            peer = %node_id,
                            peer_user_id = %peer_user.id,
                            "is_friend: auto-created friendship for allowed peer"
                        );
                        true
                    }
                    Err(e) => {
                        // UNIQUE constraint = already exists (race condition), treat as friend
                        tracing::debug!(
                            peer = %node_id,
                            error = %e,
                            "is_friend: add_friend result (may already exist)"
                        );
                        true
                    }
                }
            }
            Err(e) => {
                tracing::warn!(
                    peer = %node_id,
                    error = %e,
                    "is_friend: database error checking friendship"
                );
                false
            }
        }
    }

    /// gracefully shut down the hub peer service.
    pub async fn shutdown(self) {
        tracing::info!("shutting down hub peer service");

        // shutdown router (also shuts down protocol handlers including repo.stop())
        // use a timeout to avoid hanging forever if something is stuck
        tracing::debug!("shutting down iroh router...");
        let router_shutdown = self.router.shutdown();
        match tokio::time::timeout(std::time::Duration::from_secs(10), router_shutdown).await {
            Ok(Ok(())) => {
                tracing::debug!("iroh router shut down cleanly");
            }
            Ok(Err(e)) => {
                tracing::warn!(error = ?e, "error shutting down router");
            }
            Err(_) => {
                tracing::warn!("router shutdown timed out after 10s, continuing");
            }
        }

        // close iroh endpoint
        tracing::debug!("closing iroh endpoint...");
        self.endpoint.close().await;

        tracing::info!("hub peer service stopped");
    }

    /// get the iroh endpoint's node ID.
    pub fn node_id(&self) -> iroh::PublicKey {
        self.endpoint.id()
    }

    /// get the hub peer's grimoire user ID.
    pub fn hub_user_id(&self) -> &str {
        &self.hub_user_id
    }

    /// get a reference to the iroh repo (for doc management).
    pub fn iroh_repo(&self) -> &IrohRepo {
        &self.iroh_repo
    }

    /// get a reference to the friendz handler (for sending messages).
    pub fn friendz(&self) -> &FriendzHandler {
        &self.friendz
    }
}

/// get a human-readable name for a friendz message type (for logging).
pub(crate) fn friendz_msg_type_name(msg: &FriendzMessage) -> &'static str {
    match msg {
        FriendzMessage::ProfileRequest => "profile-request",
        FriendzMessage::ProfileResponse { .. } => "profile-response",
        FriendzMessage::FriendRequest { .. } => "friend-request",
        FriendzMessage::FriendAccept { .. } => "friend-accept",
        FriendzMessage::FriendAcceptAck { .. } => "friend-accept-ack",
        FriendzMessage::FriendReject { .. } => "friend-reject",
        FriendzMessage::Heartbeat { .. } => "heartbeat",
        FriendzMessage::CanvasInvite { .. } => "canvas-invite",
        FriendzMessage::CanvasInviteAck { .. } => "canvas-invite-ack",
        FriendzMessage::CanvasInviteAccept { .. } => "canvas-invite-accept",
        FriendzMessage::CanvasInviteDecline { .. } => "canvas-invite-decline",
        FriendzMessage::AclChange { .. } => "acl-change",
        FriendzMessage::CanvasUpdate { .. } => "canvas-update",
        FriendzMessage::OfflineAnnouncement { .. } => "offline-announcement",
        FriendzMessage::GossipDigest { .. } => "gossip-digest",
    }
}
