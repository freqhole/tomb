//! friendz message dispatch for the hub peer service.
//!
//! handles incoming friendz events (peer online/offline, messages) and
//! dispatches to the appropriate handler. friend request/accept logic,
//! profile exchange, and routing to canvas/gossip handlers all live here.

use std::collections::HashSet;

use crate::protocol::handler::FriendzEvent;
use crate::protocol::messages::FriendzMessage;

use super::friendz_msg_type_name;
use super::HubPeerService;

impl HubPeerService {
    /// handle a single friendz event.
    ///
    /// this is where hub-specific behavior goes: auto-accepting canvas invites,
    /// participating in gossip, etc.
    pub(crate) async fn handle_friendz_event(&self, event: FriendzEvent) {
        match event {
            FriendzEvent::PeerOnline { node_id, username } => {
                tracing::info!(
                    peer = %node_id,
                    username = %username,
                    "peer came online"
                );
                // update last_seen_at in grimoire
                let user_service = grimoire::users::UserService::new();
                let result = user_service.touch_peer_node(&node_id).await;
                if result.data.is_none() {
                    tracing::debug!(peer = %node_id, "touch_peer_node: peer not in grimoire (not a registered friend)");
                }

                // send gossip digest to this peer if they're a friend
                if self.is_friend(&node_id).await {
                    // NOTE: the hub does NOT dial peers for automerge sync.
                    // the JS side dials the hub, and the hub's acceptor
                    // handles inbound connections correctly.

                    // delay gossip slightly to allow the peer to establish
                    // automerge sync via the acceptor path
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;

                    self.compute_and_send_gossip_digest(&node_id).await;
                }
            }
            FriendzEvent::PeerOffline { node_id } => {
                tracing::info!(peer = %node_id, "peer went offline");

                // clear peer blob inventory when peer goes offline
                let mut inventory = self.peer_blob_inventory.lock().await;
                if inventory.remove(&node_id).is_some() {
                    tracing::debug!(peer = %node_id, "cleared peer blob inventory");
                }
            }
            FriendzEvent::MessageReceived {
                from_node_id,
                message,
            } => {
                tracing::info!(
                    from = %from_node_id,
                    msg_type = %friendz_msg_type_name(&message),
                    "received friendz message"
                );
                self.handle_message(&from_node_id, message).await;
            }
        }
    }

    /// handle a specific friendz message from a peer.
    ///
    /// the hub peer shares its profile with everyone (no visibility gate) and
    /// auto-accepts friend requests from peers that are already registered in
    /// grimoire's user_peer_nodez table (i.e. admin has run `allow-peer`).
    pub(crate) async fn handle_message(&self, from_node_id: &str, message: FriendzMessage) {
        match message {
            FriendzMessage::ProfileRequest => {
                // hub peer shares its profile with anyone — no visibility check
                tracing::info!(
                    peer = %from_node_id,
                    username = %self.profile_username,
                    bio_len = self.profile_bio.len(),
                    avatar_len = self.profile_avatar_data_url.len(),
                    "responding to profile request"
                );
                let response = FriendzMessage::ProfileResponse {
                    username: self.profile_username.clone(),
                    bio: self.profile_bio.clone(),
                    avatar_data_url: self.profile_avatar_data_url.clone(),
                };
                if let Err(e) = self.friendz.send_message(from_node_id, &response).await {
                    tracing::warn!(
                        peer = %from_node_id,
                        error = %e,
                        "failed to send profile response"
                    );
                }
            }
            FriendzMessage::ProfileResponse {
                username,
                bio,
                avatar_data_url,
            } => {
                // update the remote peer's profile in grimoire
                tracing::debug!(
                    peer = %from_node_id,
                    username = %username,
                    "received profile response"
                );
                let social_service = grimoire::SocialService::new();
                if let Err(e) = social_service
                    .update_remote_node_profile(
                        from_node_id,
                        &username,
                        &bio,
                        &avatar_data_url,
                        0x6366f1,
                    )
                    .await
                {
                    tracing::debug!(
                        peer = %from_node_id,
                        error = %e,
                        "failed to update remote node profile"
                    );
                }
            }
            FriendzMessage::FriendRequest {
                from_node_id: _req_node_id,
                from_username,
            } => {
                // auto-accept only if the peer's node_id is already in user_peer_nodez
                // (admin must have run `freqhole federation allow-peer <node-id>` first)
                tracing::info!(
                    peer = %from_node_id,
                    username = %from_username,
                    "received friend request"
                );

                let user_service = grimoire::users::UserService::new();
                let response = user_service.get_user_by_node_id(from_node_id).await;
                let peer_user = match response.data {
                    Some(user) => user,
                    None => {
                        tracing::info!(
                            peer = %from_node_id,
                            "ignoring friend request from unknown peer (not in user_peer_nodez)"
                        );
                        return;
                    }
                };

                // add the friendship: hub_user -> peer_user
                let social_repo = grimoire::social::repository::SocialRepository::new();
                match social_repo
                    .add_friend(&self.hub_user_id, &peer_user.id, None)
                    .await
                {
                    Ok(_) => {
                        tracing::info!(
                            peer = %from_node_id,
                            peer_user_id = %peer_user.id,
                            "added friend relationship"
                        );
                    }
                    Err(e) => {
                        // UNIQUE constraint violation means already friends — that's fine
                        tracing::debug!(
                            peer = %from_node_id,
                            error = %e,
                            "add_friend result (may already exist)"
                        );
                    }
                }

                // send friend-accept back with the hub's username from config
                tracing::info!(
                    peer = %from_node_id,
                    hub_username = %self.profile_username,
                    hub_node_id = %self.node_id_str,
                    "sending friend-accept"
                );
                let accept = FriendzMessage::FriendAccept {
                    from_node_id: self.node_id_str.clone(),
                    from_username: self.profile_username.clone(),
                };
                match self.friendz.send_message(from_node_id, &accept).await {
                    Ok(()) => {
                        tracing::info!(peer = %from_node_id, "friend-accept sent successfully");
                    }
                    Err(e) => {
                        tracing::warn!(
                            peer = %from_node_id,
                            error = %e,
                            "failed to send friend-accept"
                        );
                    }
                }

                // proactively send our profile so the peer has our display name,
                // bio, and avatar immediately (without waiting for a profile-request)
                let profile_resp = FriendzMessage::ProfileResponse {
                    username: self.profile_username.clone(),
                    bio: self.profile_bio.clone(),
                    avatar_data_url: self.profile_avatar_data_url.clone(),
                };
                match self.friendz.send_message(from_node_id, &profile_resp).await {
                    Ok(()) => {
                        tracing::info!(peer = %from_node_id, "profile-response sent after friend-accept");
                    }
                    Err(e) => {
                        tracing::warn!(
                            peer = %from_node_id,
                            error = %e,
                            "failed to send profile after friend-accept"
                        );
                    }
                }

                // request their profile so we have their display name, bio, avatar
                let profile_req = FriendzMessage::ProfileRequest;
                match self.friendz.send_message(from_node_id, &profile_req).await {
                    Ok(()) => {
                        tracing::info!(peer = %from_node_id, "profile-request sent after friend-accept");
                    }
                    Err(e) => {
                        tracing::warn!(
                            peer = %from_node_id,
                            error = %e,
                            "failed to request profile after friend-accept"
                        );
                    }
                }

                // NOTE: no outbound sync dial — see PeerOnline handler comment.
                // the JS side will establish sync when it needs to.
            }
            FriendzMessage::FriendAccept {
                from_node_id: _accept_node_id,
                from_username,
            } => {
                // a peer accepted our friend request (or is confirming mutual friendship).
                // ensure the friendship exists in grimoire.
                tracing::info!(
                    peer = %from_node_id,
                    username = %from_username,
                    "received friend-accept"
                );

                let user_service = grimoire::users::UserService::new();
                if let Some(peer_user) = user_service.get_user_by_node_id(from_node_id).await.data {
                    let social_repo = grimoire::social::repository::SocialRepository::new();
                    if let Err(e) = social_repo
                        .add_friend(&self.hub_user_id, &peer_user.id, None)
                        .await
                    {
                        tracing::debug!(
                            peer = %from_node_id,
                            error = %e,
                            "add_friend on accept (may already exist)"
                        );
                    }
                }

                // send ack to complete the two-phase handshake
                let ack = FriendzMessage::FriendAcceptAck {
                    from_node_id: self.node_id_str.clone(),
                };
                if let Err(e) = self.friendz.send_message(from_node_id, &ack).await {
                    tracing::debug!(
                        peer = %from_node_id,
                        error = %e,
                        "failed to send friend-accept-ack"
                    );
                }

                // request their profile
                let profile_req = FriendzMessage::ProfileRequest;
                if let Err(e) = self.friendz.send_message(from_node_id, &profile_req).await {
                    tracing::debug!(
                        peer = %from_node_id,
                        error = %e,
                        "failed to request profile after friend-accept"
                    );
                }

                // NOTE: no outbound sync dial — see PeerOnline handler comment.
                // the JS side will establish sync when it needs to.
            }
            FriendzMessage::FriendAcceptAck {
                from_node_id: _ack_node_id,
            } => {
                tracing::debug!(
                    peer = %from_node_id,
                    "received friend-accept-ack, handshake complete"
                );
            }
            FriendzMessage::Heartbeat { .. } => {
                // heartbeats are handled by the handler layer (presence tracking).
                // nothing extra to do here.
            }
            FriendzMessage::CanvasInvite {
                invite_id,
                canvas_doc_id,
                canvas_title,
                origin_node_id,
                origin_username,
                role,
                ..
            } => {
                self.handle_canvas_invite(
                    from_node_id,
                    &invite_id,
                    &canvas_doc_id,
                    &canvas_title,
                    &origin_node_id,
                    &origin_username,
                    &role,
                )
                .await;
            }
            FriendzMessage::CanvasInviteAck {
                invite_id,
                canvas_doc_id,
                acker_node_id,
            } => {
                tracing::info!(
                    peer = %from_node_id,
                    invite_id = %invite_id,
                    canvas_doc_id = %canvas_doc_id,
                    acker = %acker_node_id,
                    "received canvas invite ack"
                );
            }
            FriendzMessage::CanvasInviteAccept {
                invite_id,
                canvas_doc_id,
                accepter_node_id,
            } => {
                tracing::info!(
                    peer = %from_node_id,
                    invite_id = %invite_id,
                    canvas_doc_id = %canvas_doc_id,
                    accepter = %accepter_node_id,
                    "received canvas invite accept"
                );
            }
            FriendzMessage::CanvasInviteDecline {
                invite_id,
                canvas_doc_id,
                decliner_node_id,
            } => {
                tracing::info!(
                    peer = %from_node_id,
                    invite_id = %invite_id,
                    canvas_doc_id = %canvas_doc_id,
                    decliner = %decliner_node_id,
                    "received canvas invite decline"
                );
            }
            FriendzMessage::CanvasUpdate {
                canvas_doc_id,
                last_modified_at,
                widget_count,
                modified_by_node_id,
                modified_by_username,
            } => {
                self.handle_canvas_update(
                    from_node_id,
                    &canvas_doc_id,
                    &last_modified_at,
                    widget_count,
                    &modified_by_node_id,
                    &modified_by_username,
                )
                .await;
            }
            FriendzMessage::GossipDigest {
                canvas_updates,
                pending_invites,
                shared_canvas_ids,
            } => {
                self.handle_gossip_digest(
                    from_node_id,
                    canvas_updates,
                    pending_invites,
                    shared_canvas_ids,
                )
                .await;
            }
            FriendzMessage::AclChange {
                canvas_doc_id,
                canvas_title,
                target_node_id,
                new_role,
                changed_by,
                changed_by_username,
            } => {
                tracing::info!(
                    peer = %from_node_id,
                    canvas_doc_id = %canvas_doc_id,
                    canvas_title = %canvas_title,
                    target = %target_node_id,
                    new_role = ?new_role,
                    changed_by = %changed_by,
                    changed_by_username = %changed_by_username,
                    "received ACL change notification"
                );
            }
            FriendzMessage::FriendReject {
                from_node_id: reject_node_id,
            } => {
                tracing::info!(
                    peer = %from_node_id,
                    reject_from = %reject_node_id,
                    "received friend rejection"
                );
            }
            FriendzMessage::OfflineAnnouncement { node_id } => {
                tracing::info!(
                    peer = %from_node_id,
                    announced_node = %node_id,
                    "received offline announcement"
                );
            }
            FriendzMessage::BlobSeek { needed } => {
                tracing::info!(
                    peer = %from_node_id,
                    count = needed.len(),
                    "received blob seek, checking local availability"
                );

                // check grimoire for each requested blake3 hash
                let mut available = Vec::new();
                for hash in &needed {
                    match grimoire::media_blobz::get_media_blob_by_blake3(hash).await {
                        Ok(_blob) => {
                            available.push(hash.clone());
                        }
                        Err(_) => {
                            // don't have this blob
                        }
                    }
                }

                tracing::info!(
                    peer = %from_node_id,
                    requested = needed.len(),
                    available = available.len(),
                    "responding to blob seek with blob offer"
                );

                if !available.is_empty() {
                    let offer = FriendzMessage::BlobOffer { available };
                    if let Err(e) = self.friendz.send_message(from_node_id, &offer).await {
                        tracing::warn!(
                            peer = %from_node_id,
                            error = %e,
                            "failed to send blob offer"
                        );
                    }
                }
            }
            FriendzMessage::BlobOffer { available } => {
                tracing::info!(
                    peer = %from_node_id,
                    count = available.len(),
                    "received blob offer, updating peer inventory"
                );

                // store in peer blob inventory
                let mut inventory = self.peer_blob_inventory.lock().await;
                let entry = inventory
                    .entry(from_node_id.to_string())
                    .or_insert_with(HashSet::new);
                for hash in available {
                    entry.insert(hash);
                }

                // trigger a snatch scan since we now have new information about
                // where blobs might be available
                self.snatch_trigger.notify_one();
            }
        }
    }
}
