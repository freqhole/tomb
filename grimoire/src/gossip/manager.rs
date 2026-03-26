//! gossip manager — owns the iroh Gossip instance, manages topic subscriptions
//!
//! created after the federation endpoint starts its router.
//! on startup, resubscribes to all persisted channels.
//! routes incoming messages to the service layer for persistence.

use crate::error::GrimoireResult;
use crate::gossip::protocol::GossipEnvelope;
use crate::gossip::repository;
use crate::gossip::service::GossipService;
use futures_util::StreamExt;
use iroh_gossip::api::{GossipReceiver, GossipSender};
use iroh_gossip::{Gossip, TopicId};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio_util::bytes::Bytes;
use tracing::{info, warn};

/// active subscription for a gossip topic
struct ActiveSubscription {
    sender: GossipSender,
    recv_task: JoinHandle<()>,
}

/// manages the Gossip instance and all active topic subscriptions
pub struct GossipManager {
    gossip: Gossip,
    subscriptions: Arc<Mutex<HashMap<String, ActiveSubscription>>>,
}

impl GossipManager {
    /// create a new GossipManager with the given Gossip instance
    pub fn new(gossip: Gossip) -> Self {
        Self {
            gossip,
            subscriptions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// resubscribe to all persisted channels on startup
    pub async fn resubscribe_all(&self) -> GrimoireResult<()> {
        let channels = repository::list_channels().await?;
        if channels.is_empty() {
            info!("[gossip] no channels to resubscribe to");
            return Ok(());
        }

        info!(
            "[gossip] resubscribing to {} channel(s)",
            channels.len()
        );

        for channel in &channels {
            // get bootstrap peers from channel members
            let members = repository::list_members(&channel.topic_id).await?;
            let bootstrap: Vec<iroh::EndpointId> = members
                .iter()
                .filter_map(|m| {
                    m.node_id
                        .parse::<iroh::PublicKey>()
                        .ok()
                        .map(iroh::EndpointId::from)
                })
                .collect();

            match self
                .subscribe(&channel.topic_id, bootstrap)
                .await
            {
                Ok(()) => {
                    info!(
                        "[gossip] resubscribed to '{}' ({})",
                        channel.name,
                        &channel.topic_id[..16]
                    );
                }
                Err(e) => {
                    warn!(
                        "[gossip] failed to resubscribe to '{}': {}",
                        channel.name, e
                    );
                }
            }
        }

        Ok(())
    }

    /// subscribe to a topic (without waiting for peers to join)
    pub async fn subscribe(
        &self,
        topic_id_hex: &str,
        bootstrap: Vec<iroh::EndpointId>,
    ) -> GrimoireResult<()> {
        let topic_id = parse_topic_id(topic_id_hex)?;

        let topic = self
            .gossip
            .subscribe(topic_id, bootstrap)
            .await
            .map_err(|e| crate::error::GrimoireError::ProcessingFailed {
                message: format!("gossip subscribe failed: {}", e),
            })?;

        let (sender, receiver) = topic.split();

        // spawn background task to handle incoming messages
        let topic_id_str = topic_id_hex.to_string();
        let recv_task = tokio::spawn(Self::recv_loop(topic_id_str.clone(), receiver));

        let mut subs = self.subscriptions.lock().await;
        subs.insert(
            topic_id_hex.to_string(),
            ActiveSubscription { sender, recv_task },
        );

        Ok(())
    }

    /// unsubscribe from a topic
    pub async fn unsubscribe(&self, topic_id_hex: &str) -> GrimoireResult<()> {
        let mut subs = self.subscriptions.lock().await;
        if let Some(sub) = subs.remove(topic_id_hex) {
            sub.recv_task.abort();
            info!(
                "[gossip] unsubscribed from topic {}",
                &topic_id_hex[..16]
            );
        }
        Ok(())
    }

    /// broadcast a message to a subscribed topic
    pub async fn broadcast(
        &self,
        topic_id_hex: &str,
        envelope: &GossipEnvelope,
    ) -> GrimoireResult<()> {
        let subs = self.subscriptions.lock().await;
        let sub = subs.get(topic_id_hex).ok_or_else(|| {
            crate::error::GrimoireError::ProcessingFailed {
                message: format!("not subscribed to topic {}", &topic_id_hex[..16]),
            }
        })?;

        let data = serde_json::to_vec(envelope)?;
        sub.sender
            .broadcast(Bytes::from(data))
            .await
            .map_err(|e| crate::error::GrimoireError::ProcessingFailed {
                message: format!("gossip broadcast failed: {}", e),
            })?;

        Ok(())
    }

    /// background receive loop for a topic — persists incoming messages
    async fn recv_loop(topic_id: String, mut receiver: GossipReceiver) {
        use iroh_gossip::api::Event;

        loop {
            match receiver.next().await {
                Some(Ok(Event::Received(msg))) => {
                    match serde_json::from_slice::<GossipEnvelope>(&msg.content) {
                        Ok(envelope) => {
                            if let Err(e) =
                                GossipService::handle_incoming_envelope(&topic_id, &envelope).await
                            {
                                warn!(
                                    "[gossip] failed to handle message in {}: {}",
                                    &topic_id[..16],
                                    e
                                );
                            }
                        }
                        Err(e) => {
                            warn!(
                                "[gossip] failed to parse envelope in {}: {}",
                                &topic_id[..16],
                                e
                            );
                        }
                    }
                }
                Some(Ok(Event::NeighborUp(id))) => {
                    info!("[gossip] neighbor up in {}: {}", &topic_id[..16], id);
                }
                Some(Ok(Event::NeighborDown(id))) => {
                    info!("[gossip] neighbor down in {}: {}", &topic_id[..16], id);
                }
                Some(Ok(Event::Lagged)) => {
                    warn!("[gossip] lagged in topic {}", &topic_id[..16]);
                }
                Some(Err(e)) => {
                    warn!(
                        "[gossip] recv error in {}: {}",
                        &topic_id[..16],
                        e
                    );
                    break;
                }
                None => {
                    info!("[gossip] topic {} closed", &topic_id[..16]);
                    break;
                }
            }
        }
    }

    /// check if we're subscribed to a topic
    pub async fn is_subscribed(&self, topic_id_hex: &str) -> bool {
        let subs = self.subscriptions.lock().await;
        subs.contains_key(topic_id_hex)
    }
}

/// parse a hex-encoded topic ID
fn parse_topic_id(hex_str: &str) -> GrimoireResult<TopicId> {
    let bytes = hex::decode(hex_str).map_err(|e| crate::error::GrimoireError::ProcessingFailed {
        message: format!("invalid topic id hex: {}", e),
    })?;
    if bytes.len() != 32 {
        return Err(crate::error::GrimoireError::ProcessingFailed {
            message: "topic id must be 32 bytes (64 hex chars)".to_string(),
        });
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    Ok(TopicId::from(arr))
}
