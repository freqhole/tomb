//! `FriendzService` - the presence/heartbeat/dispatch engine.
//!
//! built to satisfy PHASE_4_HARUSPEX_RUST.md's transport-agnostic design
//! tenet: `FriendzService` only tracks presence (who's online, when they
//! were last seen) and local identity/profile data, and [`dispatch`] is a
//! plain function that takes a caller identity and a parsed message and
//! returns what (if anything) to send back. it has zero knowledge of iroh,
//! streams, or connections - a transport (the `iroh` feature's
//! `FriendzProtocolHandler`, or a hypothetical http/
//! websocket binding) is a thin shell around `dispatch` that does nothing
//! but framing + identity extraction, per the design tenet.
//!
//! # what dispatch does and does not decide
//!
//! `dispatch` only auto-replies to messages it can answer from the local
//! presence/profile state it already holds: `profile-request` (if a local
//! profile is configured), `hello` (if local capabilities are configured),
//! and `heartbeat` (echoes back on a peer's first-seen transition, exactly
//! like skein's handler). every other message - friend requests, knocks,
//! acl changes, gossip digests, blob seeks, identity updates, errors, and
//! app extensions - carries real business logic that depends on stores
//! (`FriendStore`, `KnockStore`, `GrantStore`, ...) this service does not
//! hold a handle to by design (per the acl module's own separation of
//! evaluation from storage). those messages are surfaced as
//! [`FriendzEvent::MessageReceived`] for app-level code (holding the
//! relevant stores) to act on.
//!
//! # presence tracks the caller, not the message body
//!
//! `dispatch` keys presence bookkeeping off `caller.node_id` - the identity
//! a transport already verified (e.g. iroh's `remote_id()`) - never off a
//! message's own embedded `nodeId` field, which a peer could set to
//! anything. a heartbeat claiming to be from a different node than the one
//! actually holding the connection is not trusted.

use std::collections::HashMap;

use tokio::sync::{mpsc, Mutex, RwLock};
use tokio::time::Instant;

use crate::acl::caller::Caller;

use super::messages::{Capabilities, CoreMessage, FriendzMessage, HEARTBEAT_TIMEOUT_MS};

// ---------------------------------------------------------------------------
// local profile
// ---------------------------------------------------------------------------

/// the local peer's own profile data, used to answer `profile-request`.
/// mirrors `profile-response`'s fields (minus `v`).
#[derive(Debug, Clone, Default)]
pub struct LocalProfile {
    pub username: String,
    pub bio: String,
    pub avatar_data_url: String,
    pub accent_color: Option<i64>,
    pub profile_doc_id: Option<String>,
    pub profile_updated_at: Option<String>,
    /// self-declared: true if this peer is a reliquary hub node.
    pub is_hub: Option<bool>,
}

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

/// events emitted by [`dispatch`] for app-level code to process. carries
/// zero iroh types - `node_id`/`message` are plain data, matching skein's
/// original `FriendzEvent` (which was already transport-agnostic; only the
/// `ProtocolHandler` impl around it was iroh-coupled).
#[derive(Debug, Clone, PartialEq)]
pub enum FriendzEvent {
    /// a peer sent its first heartbeat (or `hello`) - it's now online.
    PeerOnline { node_id: String, username: String },
    /// a peer timed out or sent an offline announcement.
    PeerOffline { node_id: String },
    /// any message was received from a peer (including ones `dispatch`
    /// already auto-replied to) - the single hook app-level code uses to
    /// react to friend requests, knocks, acl changes, gossip digests, blob
    /// seeks, identity updates, and app extensions.
    MessageReceived {
        from_node_id: String,
        message: Box<FriendzMessage>,
    },
}

// ---------------------------------------------------------------------------
// the response a dispatch call produces
// ---------------------------------------------------------------------------

/// what [`dispatch`] wants the transport to do after handling one inbound
/// message.
#[derive(Debug, Clone, PartialEq)]
pub enum FriendzResponse {
    /// nothing to send back over this connection.
    None,
    /// send exactly one message back to the caller.
    Message(FriendzMessage),
}

// ---------------------------------------------------------------------------
// FriendzService
// ---------------------------------------------------------------------------

struct PresenceState {
    last_seen: HashMap<String, Instant>,
}

/// the transport-agnostic presence/heartbeat/dispatch engine. clone is
/// cheap conceptually, but this type is normally shared behind an `Arc` (see
/// the `iroh` feature's `FriendzProtocolHandler`, which wraps
/// `Arc<FriendzService>`).
pub struct FriendzService {
    local_node_id: String,
    local_username: RwLock<String>,
    local_profile: RwLock<Option<LocalProfile>>,
    local_capabilities: RwLock<Option<Capabilities>>,
    presence: Mutex<PresenceState>,
    events: mpsc::UnboundedSender<FriendzEvent>,
}

impl std::fmt::Debug for FriendzService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FriendzService")
            .field("local_node_id", &self.local_node_id)
            .finish_non_exhaustive()
    }
}

impl FriendzService {
    /// create a new service. returns the service and a receiver for events
    /// dispatch emits (peer online/offline, every received message).
    pub fn new(
        local_node_id: impl Into<String>,
        local_username: impl Into<String>,
    ) -> (Self, mpsc::UnboundedReceiver<FriendzEvent>) {
        let (events, event_rx) = mpsc::unbounded_channel();
        let service = Self {
            local_node_id: local_node_id.into(),
            local_username: RwLock::new(local_username.into()),
            local_profile: RwLock::new(None),
            local_capabilities: RwLock::new(None),
            presence: Mutex::new(PresenceState {
                last_seen: HashMap::new(),
            }),
            events,
        };
        (service, event_rx)
    }

    pub fn local_node_id(&self) -> &str {
        &self.local_node_id
    }

    pub async fn set_local_username(&self, username: impl Into<String>) {
        *self.local_username.write().await = username.into();
    }

    /// configure the local profile `dispatch` uses to answer
    /// `profile-request`. leave unset (the default) to answer no
    /// `profile-request` at all (`FriendzResponse::None`).
    pub async fn set_local_profile(&self, profile: LocalProfile) {
        *self.local_profile.write().await = Some(profile);
    }

    /// configure the local capabilities `dispatch` uses to answer `hello`.
    /// leave unset (the default) to answer no `hello` at all.
    pub async fn set_local_capabilities(&self, capabilities: Capabilities) {
        *self.local_capabilities.write().await = Some(capabilities);
    }

    /// check if a peer is considered online (heartbeat within the timeout
    /// window).
    pub async fn is_online(&self, node_id: &str) -> bool {
        let state = self.presence.lock().await;
        state
            .last_seen
            .get(node_id)
            .map(|t| t.elapsed().as_millis() < HEARTBEAT_TIMEOUT_MS as u128)
            .unwrap_or(false)
    }

    /// every peer node id currently considered online.
    pub async fn online_peers(&self) -> Vec<String> {
        let state = self.presence.lock().await;
        state
            .last_seen
            .iter()
            .filter(|(_, t)| t.elapsed().as_millis() < HEARTBEAT_TIMEOUT_MS as u128)
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// remove every peer that has timed out and emit `PeerOffline` for each.
    /// a transport's heartbeat loop calls this periodically (see the `iroh`
    /// feature's `run_heartbeat_loop`) since actually detecting a timeout
    /// (as opposed to reacting to one already recorded) requires a clock
    /// tick, which is the transport loop's job, not dispatch's.
    pub async fn sweep_timeouts(&self) -> Vec<String> {
        let timeout = std::time::Duration::from_millis(HEARTBEAT_TIMEOUT_MS);
        let mut state = self.presence.lock().await;
        let timed_out: Vec<String> = state
            .last_seen
            .iter()
            .filter(|(_, t)| t.elapsed() >= timeout)
            .map(|(id, _)| id.clone())
            .collect();
        for id in &timed_out {
            state.last_seen.remove(id);
            let _ = self.events.send(FriendzEvent::PeerOffline {
                node_id: id.clone(),
            });
        }
        timed_out
    }

    /// build a heartbeat message announcing the local node, for a
    /// transport's heartbeat loop to send.
    pub async fn build_heartbeat(&self) -> FriendzMessage {
        FriendzMessage::Core(CoreMessage::Heartbeat {
            v: 1,
            node_id: self.local_node_id.clone(),
            username: self.local_username.read().await.clone(),
            app_payload: None,
        })
    }

    /// the transport-agnostic dispatch entry point (inherent-method
    /// ergonomic wrapper - see the free function [`dispatch`] for the exact
    /// shape PHASE_4_HARUSPEX_RUST.md's transport-agnostic design tenet
    /// asks for).
    pub async fn dispatch(&self, caller: &Caller, msg: FriendzMessage) -> FriendzResponse {
        dispatch(self, caller, msg).await
    }
}

// ---------------------------------------------------------------------------
// dispatch - the transport-agnostic core
// ---------------------------------------------------------------------------

/// given a caller identity and a parsed message, update presence state as
/// needed and return what (if anything) to send back. zero iroh types in
/// this signature - a transport shell (the `iroh` feature's
/// `FriendzProtocolHandler::accept`, or any future http/websocket binding)
/// does nothing but: extract the caller's identity, read a framed message
/// via `crate::protocol::codec`, call this function, write the response
/// back via the codec.
pub async fn dispatch(
    service: &FriendzService,
    caller: &Caller,
    msg: FriendzMessage,
) -> FriendzResponse {
    let response = match &msg {
        FriendzMessage::Core(CoreMessage::ProfileRequest { .. }) => {
            handle_profile_request(service).await
        }
        FriendzMessage::Core(CoreMessage::Hello { .. }) => handle_hello(service, caller).await,
        FriendzMessage::Core(CoreMessage::Heartbeat { .. }) => {
            handle_heartbeat(service, caller).await
        }
        FriendzMessage::Core(CoreMessage::OfflineAnnouncement { .. }) => {
            handle_offline_announcement(service, caller).await
        }
        // every other message is real business logic (friend accept/reject
        // decisions, knock accept/deny, acl changes, gossip merges, blob
        // fetches, identity updates, protocol errors, app extensions) that
        // depends on stores this service does not hold - see the module
        // doc comment. `MessageReceived` (emitted unconditionally below)
        // is how app-level code learns about them.
        _ => FriendzResponse::None,
    };

    let _ = service.events.send(FriendzEvent::MessageReceived {
        from_node_id: caller.node_id.clone(),
        message: Box::new(msg),
    });

    response
}

async fn handle_profile_request(service: &FriendzService) -> FriendzResponse {
    let profile = service.local_profile.read().await;
    match profile.as_ref() {
        Some(p) => FriendzResponse::Message(FriendzMessage::Core(CoreMessage::ProfileResponse {
            v: 1,
            username: p.username.clone(),
            bio: p.bio.clone(),
            avatar_data_url: p.avatar_data_url.clone(),
            accent_color: p.accent_color,
            profile_doc_id: p.profile_doc_id.clone(),
            profile_updated_at: p.profile_updated_at.clone(),
            is_hub: p.is_hub,
        })),
        None => FriendzResponse::None,
    }
}

async fn handle_hello(service: &FriendzService, caller: &Caller) -> FriendzResponse {
    mark_online_if_new(service, &caller.node_id, "").await;

    let capabilities = service.local_capabilities.read().await;
    match *capabilities {
        Some(capabilities) => {
            FriendzResponse::Message(FriendzMessage::Core(CoreMessage::HelloOk {
                v: 1,
                node_id: service.local_node_id.clone(),
                username: Some(service.local_username.read().await.clone()),
                avatar_blob_id: None,
                capabilities,
            }))
        }
        None => FriendzResponse::None,
    }
}

async fn handle_heartbeat(service: &FriendzService, caller: &Caller) -> FriendzResponse {
    let was_online = mark_online_if_new(service, &caller.node_id, "").await;
    if was_online {
        return FriendzResponse::None;
    }
    FriendzResponse::Message(service.build_heartbeat().await)
}

async fn handle_offline_announcement(service: &FriendzService, caller: &Caller) -> FriendzResponse {
    let mut state = service.presence.lock().await;
    if state.last_seen.remove(&caller.node_id).is_some() {
        drop(state);
        let _ = service.events.send(FriendzEvent::PeerOffline {
            node_id: caller.node_id.clone(),
        });
    }
    FriendzResponse::None
}

/// record a heartbeat/hello from `node_id`. returns `true` if the peer was
/// already online (so callers can skip the "just came online" side
/// effects), `false` (and emits `PeerOnline`) on a first-seen transition.
async fn mark_online_if_new(service: &FriendzService, node_id: &str, username: &str) -> bool {
    let was_online;
    {
        let mut state = service.presence.lock().await;
        let now = Instant::now();
        was_online = state
            .last_seen
            .get(node_id)
            .map(|t| now.duration_since(*t).as_millis() < HEARTBEAT_TIMEOUT_MS as u128)
            .unwrap_or(false);
        state.last_seen.insert(node_id.to_string(), now);
    }
    if !was_online {
        let _ = service.events.send(FriendzEvent::PeerOnline {
            node_id: node_id.to_string(),
            username: username.to_string(),
        });
    }
    was_online
}

#[cfg(test)]
mod tests {
    use super::super::messages::BrowseCapability;
    use super::*;
    use crate::stores::Role;

    fn caller(node_id: &str) -> Caller {
        Caller::new(node_id, Role::Viewer)
    }

    #[tokio::test]
    async fn profile_request_with_no_local_profile_gets_no_reply() {
        let (service, _events) = FriendzService::new("local-node", "me");
        let response = service
            .dispatch(
                &caller("node-a"),
                FriendzMessage::Core(CoreMessage::ProfileRequest { v: 1 }),
            )
            .await;
        assert_eq!(response, FriendzResponse::None);
    }

    #[tokio::test]
    async fn profile_request_with_local_profile_gets_profile_response() {
        let (service, _events) = FriendzService::new("local-node", "me");
        service
            .set_local_profile(LocalProfile {
                username: "me".to_string(),
                bio: "hi".to_string(),
                avatar_data_url: String::new(),
                accent_color: None,
                profile_doc_id: Some("doc-1".to_string()),
                profile_updated_at: Some("2026-07-07T00:00:00Z".to_string()),
                is_hub: None,
            })
            .await;

        let response = service
            .dispatch(
                &caller("node-a"),
                FriendzMessage::Core(CoreMessage::ProfileRequest { v: 1 }),
            )
            .await;

        match response {
            FriendzResponse::Message(FriendzMessage::Core(CoreMessage::ProfileResponse {
                username,
                profile_doc_id,
                ..
            })) => {
                assert_eq!(username, "me");
                assert_eq!(profile_doc_id, Some("doc-1".to_string()));
            }
            other => panic!("expected ProfileResponse, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn heartbeat_first_seen_replies_and_emits_peer_online() {
        let (service, mut events) = FriendzService::new("local-node", "me");
        let response = service
            .dispatch(
                &caller("node-a"),
                FriendzMessage::Core(CoreMessage::Heartbeat {
                    v: 1,
                    node_id: "node-a".to_string(),
                    username: "alice".to_string(),
                    app_payload: None,
                }),
            )
            .await;

        assert!(matches!(
            response,
            FriendzResponse::Message(FriendzMessage::Core(CoreMessage::Heartbeat { .. }))
        ));
        assert!(service.is_online("node-a").await);

        let mut saw_online = false;
        let mut saw_message = false;
        while let Ok(event) = events.try_recv() {
            match event {
                FriendzEvent::PeerOnline { node_id, .. } => {
                    assert_eq!(node_id, "node-a");
                    saw_online = true;
                }
                FriendzEvent::MessageReceived { from_node_id, .. } => {
                    assert_eq!(from_node_id, "node-a");
                    saw_message = true;
                }
                other => panic!("unexpected event: {other:?}"),
            }
        }
        assert!(saw_online);
        assert!(saw_message);
    }

    #[tokio::test]
    async fn heartbeat_already_online_gets_no_reply() {
        let (service, _events) = FriendzService::new("local-node", "me");
        let hb = || {
            FriendzMessage::Core(CoreMessage::Heartbeat {
                v: 1,
                node_id: "node-a".to_string(),
                username: "alice".to_string(),
                app_payload: None,
            })
        };
        let _ = service.dispatch(&caller("node-a"), hb()).await;
        let second = service.dispatch(&caller("node-a"), hb()).await;
        assert_eq!(second, FriendzResponse::None);
    }

    #[tokio::test]
    async fn offline_announcement_removes_presence_and_emits_peer_offline() {
        let (service, mut events) = FriendzService::new("local-node", "me");
        let _ = service
            .dispatch(
                &caller("node-a"),
                FriendzMessage::Core(CoreMessage::Heartbeat {
                    v: 1,
                    node_id: "node-a".to_string(),
                    username: "alice".to_string(),
                    app_payload: None,
                }),
            )
            .await;
        assert!(service.is_online("node-a").await);

        let response = service
            .dispatch(
                &caller("node-a"),
                FriendzMessage::Core(CoreMessage::OfflineAnnouncement {
                    v: 1,
                    node_id: "node-a".to_string(),
                }),
            )
            .await;
        assert_eq!(response, FriendzResponse::None);
        assert!(!service.is_online("node-a").await);

        let mut saw_offline = false;
        while let Ok(event) = events.try_recv() {
            if let FriendzEvent::PeerOffline { node_id } = event {
                assert_eq!(node_id, "node-a");
                saw_offline = true;
            }
        }
        assert!(saw_offline);
    }

    #[tokio::test]
    async fn presence_tracks_the_caller_not_the_message_body() {
        // a message body claiming a different nodeId than the transport-
        // verified caller must not affect presence for that other id.
        let (service, _events) = FriendzService::new("local-node", "me");
        let _ = service
            .dispatch(
                &caller("real-node"),
                FriendzMessage::Core(CoreMessage::Heartbeat {
                    v: 1,
                    node_id: "claimed-node".to_string(),
                    username: "alice".to_string(),
                    app_payload: None,
                }),
            )
            .await;

        assert!(service.is_online("real-node").await);
        assert!(!service.is_online("claimed-node").await);
    }

    #[tokio::test]
    async fn friend_request_gets_no_auto_reply_but_is_emitted_as_an_event() {
        let (service, mut events) = FriendzService::new("local-node", "me");
        let response = service
            .dispatch(
                &caller("node-a"),
                FriendzMessage::Core(CoreMessage::FriendRequest {
                    v: 1,
                    from_node_id: "node-a".to_string(),
                    from_username: "alice".to_string(),
                    bio: None,
                    avatar_data_url: None,
                    accent_color: None,
                    is_hub: None,
                }),
            )
            .await;
        assert_eq!(response, FriendzResponse::None);

        let event = events.try_recv().expect("event should have been emitted");
        assert!(matches!(event, FriendzEvent::MessageReceived { .. }));
    }

    #[tokio::test]
    async fn hello_with_no_capabilities_configured_gets_no_reply() {
        let (service, _events) = FriendzService::new("local-node", "me");
        let response = service
            .dispatch(
                &caller("node-a"),
                FriendzMessage::Core(CoreMessage::Hello {
                    v: 1,
                    node_id: "node-a".to_string(),
                    username: None,
                    avatar_blob_id: None,
                    capabilities: Capabilities {
                        browse: BrowseCapability::Public,
                    },
                }),
            )
            .await;
        assert_eq!(response, FriendzResponse::None);
    }

    #[tokio::test]
    async fn hello_with_capabilities_configured_gets_hello_ok() {
        let (service, _events) = FriendzService::new("local-node", "me");
        service
            .set_local_capabilities(Capabilities {
                browse: BrowseCapability::Knock,
            })
            .await;

        let response = service
            .dispatch(
                &caller("node-a"),
                FriendzMessage::Core(CoreMessage::Hello {
                    v: 1,
                    node_id: "node-a".to_string(),
                    username: Some("alice".to_string()),
                    avatar_blob_id: None,
                    capabilities: Capabilities {
                        browse: BrowseCapability::Public,
                    },
                }),
            )
            .await;

        match response {
            FriendzResponse::Message(FriendzMessage::Core(CoreMessage::HelloOk {
                node_id,
                capabilities,
                ..
            })) => {
                assert_eq!(node_id, "local-node");
                assert_eq!(capabilities.browse, BrowseCapability::Knock);
            }
            other => panic!("expected HelloOk, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn sweep_timeouts_is_a_noop_before_the_timeout_elapses() {
        let (service, _events) = FriendzService::new("local-node", "me");
        let _ = service
            .dispatch(
                &caller("node-a"),
                FriendzMessage::Core(CoreMessage::Heartbeat {
                    v: 1,
                    node_id: "node-a".to_string(),
                    username: "alice".to_string(),
                    app_payload: None,
                }),
            )
            .await;

        let timed_out = service.sweep_timeouts().await;
        assert!(timed_out.is_empty());
        assert!(service.is_online("node-a").await);
    }
}
