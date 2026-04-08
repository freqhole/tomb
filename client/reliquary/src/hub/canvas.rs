//! canvas invite, update, and gossip digest handling for the hub peer.
//!
//! handles:
//! - auto-accepting canvas invites from friends
//! - relaying canvas updates to other online friends
//! - computing and sending gossip digests on peer-online events
//! - processing incoming gossip digests (canvas updates + pending invites)

use crate::protocol::messages::{
    CanvasRole, FriendzMessage, GossipDigestCanvasUpdate, GossipDigestPendingInvite,
};

use super::HubPeerService;

impl HubPeerService {
    /// compute and send a gossip digest to a specific peer.
    ///
    /// scans all canvas docs the hub participates in and builds a digest with:
    /// - canvas updates: canvases where lastModified > peer's lastSeenAt
    /// - pending invites: canvases with pending invites targeting this peer
    ///
    /// mirrors the JS `computeAndSendGossipDigest()` in friendz-wiring.ts.
    pub(crate) async fn compute_and_send_gossip_digest(&self, peer_node_id: &str) {
        let doc_ids: Vec<String> = {
            let ids = self.canvas_doc_ids.lock().await;
            ids.iter().cloned().collect()
        };

        if doc_ids.is_empty() {
            tracing::debug!(peer = %peer_node_id, "no canvas docs to gossip about");
            return;
        }

        let mut canvas_updates: Vec<GossipDigestCanvasUpdate> = Vec::new();
        let mut pending_invites: Vec<GossipDigestPendingInvite> = Vec::new();

        let repo = self.iroh_repo.repo();
        let peer_node_id_owned = peer_node_id.to_string();

        for doc_id_str in &doc_ids {
            // parse the document ID
            let doc_id: samod::DocumentId = match doc_id_str.parse() {
                Ok(id) => id,
                Err(e) => {
                    tracing::warn!(
                        doc_id = %doc_id_str,
                        error = %e,
                        "failed to parse canvas doc ID for gossip"
                    );
                    continue;
                }
            };

            // try to find the doc in the repo
            let handle = match repo.find(doc_id).await {
                Ok(Some(h)) => h,
                Ok(None) => {
                    tracing::debug!(doc_id = %doc_id_str, "canvas doc not found in repo for gossip");
                    continue;
                }
                Err(_) => {
                    tracing::debug!(doc_id = %doc_id_str, "repo stopped while finding doc for gossip");
                    continue;
                }
            };

            // read the automerge doc to extract metadata
            let peer_id = peer_node_id_owned.clone();
            let (update, invite) =
                tokio::task::spawn_blocking(move || read_canvas_for_gossip(&handle, &peer_id))
                    .await
                    .unwrap_or_default();

            if let Some(u) = update {
                canvas_updates.push(u);
            }
            if let Some(i) = invite {
                pending_invites.push(i);
            }
        }

        if canvas_updates.is_empty() && pending_invites.is_empty() {
            tracing::debug!(
                peer = %peer_node_id,
                canvas_count = doc_ids.len(),
                "gossip digest: nothing to report"
            );
            return;
        }

        tracing::info!(
            peer = %peer_node_id,
            updates = canvas_updates.len(),
            invites = pending_invites.len(),
            "sending gossip digest"
        );

        let digest = FriendzMessage::GossipDigest {
            canvas_updates,
            pending_invites,
        };

        if let Err(e) = self.friendz.send_message(peer_node_id, &digest).await {
            tracing::warn!(
                peer = %peer_node_id,
                error = %e,
                "failed to send gossip digest"
            );
        }
    }

    /// handle an incoming canvas invite from a friend.
    ///
    /// the hub auto-accepts all canvas invites from known friends:
    /// 1. send CanvasInviteAck (receipt acknowledgment)
    /// 2. send CanvasInviteAccept (auto-accept)
    /// 3. request the canvas document from samod (so the hub syncs it)
    /// 4. track the canvas doc ID for future gossip
    pub(crate) async fn handle_canvas_invite(
        &self,
        from_node_id: &str,
        invite_id: &str,
        canvas_doc_id: &str,
        canvas_title: &str,
        origin_node_id: &str,
        origin_username: &str,
        role: &CanvasRole,
    ) {
        tracing::info!(
            peer = %from_node_id,
            invite_id = %invite_id,
            canvas_doc_id = %canvas_doc_id,
            canvas_title = %canvas_title,
            origin = %origin_node_id,
            origin_username = %origin_username,
            role = ?role,
            "received canvas invite"
        );

        // gate on friendship: only accept from known friends
        if !self.is_friend(from_node_id).await {
            tracing::info!(
                peer = %from_node_id,
                "ignoring canvas invite from non-friend"
            );
            return;
        }

        // 1. send ack (receipt confirmation)
        let ack = FriendzMessage::CanvasInviteAck {
            invite_id: invite_id.to_string(),
            canvas_doc_id: canvas_doc_id.to_string(),
            acker_node_id: self.node_id_str.clone(),
        };
        if let Err(e) = self.friendz.send_message(from_node_id, &ack).await {
            tracing::warn!(
                peer = %from_node_id,
                error = %e,
                "failed to send canvas invite ack"
            );
        } else {
            tracing::info!(
                peer = %from_node_id,
                invite_id = %invite_id,
                "canvas invite ack sent"
            );
        }

        // 2. auto-accept
        let accept = FriendzMessage::CanvasInviteAccept {
            invite_id: invite_id.to_string(),
            canvas_doc_id: canvas_doc_id.to_string(),
            accepter_node_id: self.node_id_str.clone(),
        };
        if let Err(e) = self.friendz.send_message(from_node_id, &accept).await {
            tracing::warn!(
                peer = %from_node_id,
                error = %e,
                "failed to send canvas invite accept"
            );
        } else {
            tracing::info!(
                peer = %from_node_id,
                invite_id = %invite_id,
                canvas_doc_id = %canvas_doc_id,
                "canvas invite accepted"
            );
        }

        // 3. request the canvas document via samod — this tells samod to
        //    sync the document from connected peers
        self.request_canvas_doc(canvas_doc_id).await;

        // 4. track the canvas doc ID for gossip
        {
            let mut ids = self.canvas_doc_ids.lock().await;
            ids.insert(canvas_doc_id.to_string());
        }
        tracing::info!(
            canvas_doc_id = %canvas_doc_id,
            "canvas doc added to hub tracking set"
        );
    }

    /// request a canvas document from the samod repo.
    ///
    /// uses `repo.find()` which triggers the repo to request the document from
    /// connected peers via the sync protocol. if the doc is already local, this
    /// is a no-op (returns the existing handle).
    async fn request_canvas_doc(&self, canvas_doc_id: &str) {
        let doc_id: samod::DocumentId = match canvas_doc_id.parse() {
            Ok(id) => id,
            Err(e) => {
                tracing::warn!(
                    canvas_doc_id = %canvas_doc_id,
                    error = %e,
                    "failed to parse canvas doc ID — cannot request document"
                );
                return;
            }
        };

        match self.iroh_repo.repo().find(doc_id).await {
            Ok(Some(handle)) => {
                tracing::info!(
                    canvas_doc_id = %canvas_doc_id,
                    samod_doc_id = %handle.document_id(),
                    "canvas document found/requested via samod"
                );
            }
            Ok(None) => {
                tracing::info!(
                    canvas_doc_id = %canvas_doc_id,
                    "canvas document not yet available — will sync when peer connects"
                );
            }
            Err(e) => {
                tracing::warn!(
                    canvas_doc_id = %canvas_doc_id,
                    error = ?e,
                    "failed to find canvas document in samod repo"
                );
            }
        }
    }

    /// handle an incoming canvas update notification.
    ///
    /// if the hub participates in this canvas, log the update info for
    /// future gossip relay to other peers.
    pub(crate) async fn handle_canvas_update(
        &self,
        from_node_id: &str,
        canvas_doc_id: &str,
        last_modified_at: &str,
        widget_count: u32,
        modified_by_node_id: &str,
        modified_by_username: &str,
    ) {
        let is_tracked = {
            let ids = self.canvas_doc_ids.lock().await;
            ids.contains(canvas_doc_id)
        };

        if is_tracked {
            tracing::info!(
                peer = %from_node_id,
                canvas_doc_id = %canvas_doc_id,
                last_modified_at = %last_modified_at,
                widget_count = widget_count,
                modified_by = %modified_by_node_id,
                modified_by_username = %modified_by_username,
                "canvas update on tracked canvas (available for gossip relay)"
            );

            // relay this update to other online friends who are on this canvas
            // (but not the sender and not the modifier)
            let online_peers = self.friendz.get_online_peers().await;
            for peer_id in &online_peers {
                if peer_id == from_node_id || peer_id == modified_by_node_id {
                    continue;
                }
                // only relay to friends
                if !self.is_friend(peer_id).await {
                    continue;
                }
                let update = FriendzMessage::CanvasUpdate {
                    canvas_doc_id: canvas_doc_id.to_string(),
                    last_modified_at: last_modified_at.to_string(),
                    widget_count,
                    modified_by_node_id: modified_by_node_id.to_string(),
                    modified_by_username: modified_by_username.to_string(),
                };
                if let Err(e) = self.friendz.send_message(peer_id, &update).await {
                    tracing::debug!(
                        peer = %peer_id,
                        error = %e,
                        "failed to relay canvas update"
                    );
                } else {
                    tracing::debug!(
                        peer = %peer_id,
                        canvas_doc_id = %canvas_doc_id,
                        "relayed canvas update"
                    );
                }
            }
        } else {
            tracing::debug!(
                peer = %from_node_id,
                canvas_doc_id = %canvas_doc_id,
                "received canvas update for untracked canvas — ignoring"
            );
        }
    }

    /// handle an incoming gossip digest from a peer that just came online.
    ///
    /// processes two categories:
    /// - canvas_updates: for canvases the hub knows about, log the update
    ///   (the hub sees changes via automerge sync anyway)
    /// - pending_invites: for canvases the hub doesn't know about yet, treat
    ///   as a new invite — request the doc and start tracking it
    pub(crate) async fn handle_gossip_digest(
        &self,
        from_node_id: &str,
        canvas_updates: Vec<GossipDigestCanvasUpdate>,
        pending_invites: Vec<GossipDigestPendingInvite>,
    ) {
        tracing::info!(
            peer = %from_node_id,
            updates = canvas_updates.len(),
            invites = pending_invites.len(),
            "received gossip digest"
        );

        // process canvas update notifications
        for update in &canvas_updates {
            let is_tracked = {
                let ids = self.canvas_doc_ids.lock().await;
                ids.contains(&update.canvas_doc_id)
            };

            if is_tracked {
                tracing::info!(
                    peer = %from_node_id,
                    canvas_doc_id = %update.canvas_doc_id,
                    last_modified_at = %update.last_modified_at,
                    last_modified_by = %update.last_modified_by,
                    "gossip: canvas has updates (hub will sync via automerge)"
                );
            } else {
                tracing::debug!(
                    peer = %from_node_id,
                    canvas_doc_id = %update.canvas_doc_id,
                    "gossip: canvas update for untracked canvas — ignoring"
                );
            }
        }

        // process pending invite notifications — treat as new invites for
        // canvases the hub doesn't already participate in
        for invite in &pending_invites {
            let already_tracked = {
                let ids = self.canvas_doc_ids.lock().await;
                ids.contains(&invite.canvas_doc_id)
            };

            if already_tracked {
                tracing::debug!(
                    canvas_doc_id = %invite.canvas_doc_id,
                    "gossip: pending invite for already-tracked canvas — skipping"
                );
                continue;
            }

            tracing::info!(
                peer = %from_node_id,
                canvas_doc_id = %invite.canvas_doc_id,
                canvas_title = %invite.canvas_title,
                invited_by = %invite.invited_by,
                invited_by_username = %invite.invited_by_username,
                role = ?invite.role,
                "gossip: treating pending invite as new canvas invite"
            );

            // request the canvas document via samod
            self.request_canvas_doc(&invite.canvas_doc_id).await;

            // track it
            {
                let mut ids = self.canvas_doc_ids.lock().await;
                ids.insert(invite.canvas_doc_id.clone());
            }

            // send accept back to the inviter (if they're online and not the
            // relay peer, send to them; otherwise send to the relay peer)
            let accept_target = if self.friendz.is_online(&invite.invited_by).await {
                &invite.invited_by
            } else {
                from_node_id
            };

            let invite_id = uuid::Uuid::new_v4().to_string();
            let accept = FriendzMessage::CanvasInviteAccept {
                invite_id,
                canvas_doc_id: invite.canvas_doc_id.clone(),
                accepter_node_id: self.node_id_str.clone(),
            };
            if let Err(e) = self.friendz.send_message(accept_target, &accept).await {
                tracing::debug!(
                    peer = %accept_target,
                    error = %e,
                    "failed to send canvas invite accept for gossip invite"
                );
            } else {
                tracing::info!(
                    peer = %accept_target,
                    canvas_doc_id = %invite.canvas_doc_id,
                    "sent canvas invite accept for gossip-relayed invite"
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// automerge doc reading helpers
// ---------------------------------------------------------------------------

/// read a canvas document's automerge state to extract gossip-relevant data
/// for a specific peer.
///
/// returns (optional canvas update, optional pending invite) for gossip digest.
/// runs inside spawn_blocking because `with_document` takes a mutex lock.
fn read_canvas_for_gossip(
    handle: &samod::DocHandle,
    peer_node_id: &str,
) -> (
    Option<GossipDigestCanvasUpdate>,
    Option<GossipDigestPendingInvite>,
) {
    use automerge::ReadDoc;

    let canvas_doc_id = handle.document_id().to_string();

    // helper: read a string field from an automerge object
    fn read_str(doc: &automerge::Automerge, obj: &automerge::ObjId, key: &str) -> String {
        use automerge::ReadDoc;
        doc.get(obj, key)
            .ok()
            .flatten()
            .and_then(|(v, _)| v.to_str().map(|s| s.to_string()))
            .unwrap_or_default()
    }

    handle.with_document(|doc| {
        let mut update: Option<GossipDigestCanvasUpdate> = None;
        let mut invite: Option<GossipDigestPendingInvite> = None;

        // read lastModified
        let last_modified: String = read_str(doc, &automerge::ROOT, "lastModified");

        // read lastModifiedBy
        let last_modified_by: String = read_str(doc, &automerge::ROOT, "lastModifiedBy");

        // check if peer is on this canvas and has stale state
        if let Ok(Some((_, peers_obj))) = doc.get(automerge::ROOT, "peers") {
            if let Ok(Some((_, peer_entry_obj))) = doc.get(peers_obj, peer_node_id) {
                // peer is on this canvas — check if they have stale data
                let peer_last_seen = read_str(doc, &peer_entry_obj, "lastSeenAt");

                if !last_modified.is_empty() && last_modified > peer_last_seen {
                    update = Some(GossipDigestCanvasUpdate {
                        canvas_doc_id: canvas_doc_id.clone(),
                        last_modified_at: last_modified.clone(),
                        last_modified_by: last_modified_by.clone(),
                    });
                }
            }
        }

        // check for pending invites targeting this peer
        if let Ok(Some((_, pending_obj))) = doc.get(automerge::ROOT, "pendingInvites") {
            if let Ok(Some((_, invite_obj))) = doc.get(pending_obj, peer_node_id) {
                // there's a pending invite for this peer — check they haven't already joined
                let peer_is_member = doc
                    .get(automerge::ROOT, "peers")
                    .ok()
                    .flatten()
                    .and_then(|(_, peers_obj)| doc.get(peers_obj, peer_node_id).ok().flatten())
                    .is_some();

                if !peer_is_member {
                    let invited_by = read_str(doc, &invite_obj, "invitedBy");
                    let invited_by_username = read_str(doc, &invite_obj, "invitedByUsername");

                    let role_str = read_str(doc, &invite_obj, "role");
                    let role = match role_str.as_str() {
                        "viewer" => CanvasRole::Viewer,
                        _ => CanvasRole::Editor,
                    };

                    let invited_at = read_str(doc, &invite_obj, "invitedAt");

                    // read canvas metadata for the invite
                    let title = read_str(doc, &automerge::ROOT, "title");
                    let description = read_str(doc, &automerge::ROOT, "description");

                    let color: u32 = doc
                        .get(automerge::ROOT, "color")
                        .ok()
                        .flatten()
                        .and_then(|(v, _)| v.to_u64().map(|n| n as u32))
                        .unwrap_or(0);

                    let preview_url = read_str(doc, &automerge::ROOT, "previewUrl");

                    invite = Some(GossipDigestPendingInvite {
                        canvas_doc_id: canvas_doc_id.clone(),
                        canvas_title: title,
                        canvas_description: description,
                        canvas_color: color,
                        canvas_preview_url: preview_url,
                        invited_by,
                        invited_by_username,
                        role,
                        invited_at,
                    });
                }
            }
        }

        (update, invite)
    })
}
