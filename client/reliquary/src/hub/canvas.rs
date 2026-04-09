//! canvas invite, update, and gossip digest handling for the hub peer.
//!
//! handles:
//! - auto-accepting canvas invites from friends
//! - writing the hub peer into the canvas doc's `peers` map on accept
//! - relaying canvas updates to other online friends
//! - computing and sending gossip digests on peer-online events
//! - processing incoming gossip digests (canvas updates + pending invites)

use std::collections::HashSet;

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
        let mut shared_canvas_ids: Vec<String> = Vec::new();

        let hub_repo = self.hub_repo.clone();
        let peer_node_id_owned = peer_node_id.to_string();

        for doc_id_str in &doc_ids {
            // look up the doc in hub_repo (local lookup, no parsing needed)
            let handle = match hub_repo.find(doc_id_str).await {
                Some(h) => h,
                None => {
                    tracing::debug!(doc_id = %doc_id_str, "canvas doc not found in hub_repo for gossip");
                    continue;
                }
            };

            // read the automerge doc to extract metadata
            let peer_id = peer_node_id_owned.clone();
            let (update, invite, peer_is_participant, is_deleted) =
                tokio::task::spawn_blocking(move || read_canvas_for_gossip(&handle, &peer_id))
                    .await
                    .unwrap_or_default();

            // tombstoned canvas — untrack and skip
            if is_deleted {
                tracing::info!(
                    doc_id = %doc_id_str,
                    "canvas is tombstoned, untracking from hub"
                );
                self.canvas_doc_ids.lock().await.remove(doc_id_str);
                self.hub_repo.remove_canvas_id(doc_id_str).await;
                continue;
            }

            if peer_is_participant {
                shared_canvas_ids.push(doc_id_str.clone());
            }
            if let Some(u) = update {
                canvas_updates.push(u);
            }
            if let Some(i) = invite {
                pending_invites.push(i);
            }
        }

        // only share canvas IDs where the peer is a participant

        if canvas_updates.is_empty() && pending_invites.is_empty() {
            tracing::debug!(
                peer = %peer_node_id,
                canvas_count = doc_ids.len(),
                "gossip digest: no updates or invites, but sending shared canvas IDs"
            );
        }

        tracing::info!(
            peer = %peer_node_id,
            updates = canvas_updates.len(),
            invites = pending_invites.len(),
            shared_canvases = shared_canvas_ids.len(),
            "sending gossip digest"
        );

        let digest = FriendzMessage::GossipDigest {
            canvas_updates,
            pending_invites,
            shared_canvas_ids,
        };

        if let Err(e) = self.friendz.send_message(peer_node_id, &digest).await {
            tracing::warn!(
                peer = %peer_node_id,
                error = %e,
                "failed to send gossip digest"
            );
        }

        // after gossip, send a blob seek to this peer with our missing blob hashes.
        // this helps populate the peer blob inventory for the snatcher.
        self.send_blob_seek_to_peer(peer_node_id).await;
    }

    /// handle an incoming canvas invite from a friend.
    ///
    /// the hub auto-accepts all canvas invites from known friends:
    /// 1. send CanvasInviteAck (receipt acknowledgment)
    /// 2. send CanvasInviteAccept (auto-accept)
    /// 3. track the canvas doc ID for future gossip
    /// 4. write ourselves into the canvas doc's peers map (async retry)
    ///
    /// hub_repo receives docs passively when the JS peer syncs them — no
    /// explicit document request is needed.
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

        // log hub_repo connection state for diagnostics
        {
            let peer_count = self.hub_repo.connected_peer_count().await;
            let peer_ids = self.hub_repo.connected_peer_ids().await;
            tracing::info!(
                connected_peers = ?peer_ids,
                total_connections = peer_count,
                "hub_repo sync state at invite handling time"
            );
        }

        // NOTE: the hub does NOT dial the inviting peer for automerge sync.
        // instead, the JS side establishes the sync connection after receiving
        // our canvas-invite-accept (via addPeer in onCanvasInviteAccept).
        // hub_repo receives the document passively when the JS peer syncs it.

        // 3. track the canvas doc ID for gossip
        {
            let mut ids = self.canvas_doc_ids.lock().await;
            ids.insert(canvas_doc_id.to_string());
        }
        self.hub_repo.save_canvas_id(canvas_doc_id).await;
        tracing::info!(
            canvas_doc_id = %canvas_doc_id,
            "canvas doc added to hub tracking set"
        );

        // 4. write ourselves into the canvas doc's peers map (async — doc may
        //    not be synced yet, so we retry in the background)
        self.schedule_write_self_to_canvas(canvas_doc_id);

        // 5. trigger a blob snatch scan after a delay — gives automerge sync
        //    time to deliver the canvas doc + widget state docs before scanning
        let trigger = self.snatch_trigger.clone();
        tokio::spawn(async move {
            // wait for automerge sync to deliver docs (canvas + widget state docs)
            tokio::time::sleep(std::time::Duration::from_secs(10)).await;
            trigger.notify_one();
            tracing::info!("triggered blob snatcher scan after canvas invite");
        });
    }

    /// schedule a background task to write the hub peer into a canvas doc's
    /// `peers` map and remove from `pendingInvites`.
    ///
    /// the document may not be synced yet when this is called, so the task
    /// retries up to ~30s with 2s intervals.
    /// mirrors what the JS client does in `registerAndReconnectPeers()`:
    /// `canvas.store.addPeer(identity.node_id)` +
    /// `canvas.store.removePendingInvite(identity.node_id)`.
    pub(crate) fn schedule_write_self_to_canvas(&self, canvas_doc_id: &str) {
        let hub_repo = self.hub_repo.clone();
        let node_id = self.node_id_str.clone();
        let doc_id_str = canvas_doc_id.to_string();

        tokio::spawn(async move {
            tracing::info!(
                canvas_doc_id = %doc_id_str,
                node_id = %node_id,
                "schedule_write_self_to_canvas: starting background peer-write task"
            );

            // retry up to 15 times with 2s delay = ~30s total
            for attempt in 0u32..15 {
                if attempt > 0 {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }

                tracing::info!(
                    doc_id = %doc_id_str,
                    attempt,
                    "peer-write: looking up doc in hub_repo"
                );

                // use wait_for_doc on first attempt (gives the doc a chance to
                // arrive via sync), plain find on retries
                let handle = if attempt == 0 {
                    hub_repo
                        .wait_for_doc(&doc_id_str, std::time::Duration::from_secs(5))
                        .await
                } else {
                    hub_repo.find(&doc_id_str).await
                };

                let handle = match handle {
                    Some(h) => {
                        tracing::info!(
                            doc_id = %doc_id_str,
                            attempt,
                            hub_repo_doc_id = %h.document_id(),
                            "peer-write: found doc handle"
                        );
                        h
                    }
                    None => {
                        tracing::info!(
                            doc_id = %doc_id_str,
                            attempt,
                            "peer-write: doc not available yet — will retry"
                        );
                        continue;
                    }
                };

                let nid = node_id.clone();
                let did = doc_id_str.clone();

                let wrote = tokio::task::spawn_blocking(move || {
                    write_self_to_canvas_doc(&handle, &nid, &did)
                })
                .await
                .unwrap_or(false);

                if wrote {
                    tracing::info!(
                        canvas_doc_id = %doc_id_str,
                        node_id = %node_id,
                        attempt,
                        "peer-write: SUCCESS — wrote hub peer into canvas doc peers map"
                    );
                    return;
                }

                tracing::info!(
                    doc_id = %doc_id_str,
                    attempt,
                    "peer-write: doc not ready yet (no content synced), will retry"
                );
            }

            tracing::warn!(
                doc_id = %doc_id_str,
                "peer-write: GAVE UP after 15 attempts — canvas doc never had content"
            );
        });
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
    ///   as a new invite — track the doc and start writing ourselves in
    ///
    /// hub_repo receives docs passively via sync — no explicit request needed.
    pub(crate) async fn handle_gossip_digest(
        &self,
        from_node_id: &str,
        canvas_updates: Vec<GossipDigestCanvasUpdate>,
        pending_invites: Vec<GossipDigestPendingInvite>,
        shared_canvas_ids: Vec<String>,
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

            // track it (hub_repo will receive the doc passively when peers sync)
            {
                let mut ids = self.canvas_doc_ids.lock().await;
                ids.insert(invite.canvas_doc_id.clone());
            }
            self.hub_repo.save_canvas_id(&invite.canvas_doc_id).await;

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

            // write ourselves into the canvas doc's peers map
            self.schedule_write_self_to_canvas(&invite.canvas_doc_id);

            // trigger a blob snatch scan after a delay — gives automerge sync
            // time to deliver the canvas doc + widget state docs before scanning
            let trigger = self.snatch_trigger.clone();
            tokio::spawn(async move {
                // wait for automerge sync to deliver docs (canvas + widget state docs)
                tokio::time::sleep(std::time::Duration::from_secs(10)).await;
                trigger.notify_one();
                tracing::info!("triggered blob snatcher scan after gossip digest invite");
            });
        }

        // process shared canvas IDs — discover canvases we should be on but aren't
        if !shared_canvas_ids.is_empty() {
            let our_ids: HashSet<String> = {
                let ids = self.canvas_doc_ids.lock().await;
                ids.clone()
            };

            for canvas_id in &shared_canvas_ids {
                if our_ids.contains(canvas_id) {
                    continue; // already tracking
                }

                // check if we're in this canvas's peers or pendingInvites
                // by looking at the doc (if we have it)
                let handle = match self.hub_repo.find(canvas_id).await {
                    Some(h) => h,
                    None => {
                        tracing::debug!(
                            canvas_doc_id = %canvas_id,
                            peer = %from_node_id,
                            "peer shared canvas we don't have — may need invite"
                        );
                        continue;
                    }
                };

                let node_id = self.node_id_str.clone();
                let canvas_id_owned = canvas_id.clone();
                let should_track = tokio::task::spawn_blocking(move || {
                    let mut result = false;
                    handle.with_document(|doc| {
                        use automerge::ReadDoc;
                        // check if we're in the peers map
                        if let Ok(Some((_, peers_obj))) = doc.get(automerge::ROOT, "peers") {
                            if doc
                                .get(&peers_obj, node_id.as_str())
                                .ok()
                                .flatten()
                                .is_some()
                            {
                                result = true;
                                return;
                            }
                        }
                        // check if we're in pendingInvites
                        if let Ok(Some((_, pending_obj))) =
                            doc.get(automerge::ROOT, "pendingInvites")
                        {
                            if doc
                                .get(&pending_obj, node_id.as_str())
                                .ok()
                                .flatten()
                                .is_some()
                            {
                                result = true;
                            }
                        }
                    });
                    result
                })
                .await
                .unwrap_or(false);

                if should_track {
                    tracing::info!(
                        canvas_doc_id = %canvas_id_owned,
                        peer = %from_node_id,
                        "discovered untracked canvas via gossip — starting to track"
                    );

                    {
                        let mut ids = self.canvas_doc_ids.lock().await;
                        ids.insert(canvas_id_owned.clone());
                    }
                    self.hub_repo.save_canvas_id(&canvas_id_owned).await;

                    // write ourselves into the canvas doc's peers map
                    self.schedule_write_self_to_canvas(&canvas_id_owned);

                    // trigger a blob snatch scan after a delay
                    let trigger = self.snatch_trigger.clone();
                    tokio::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
                        trigger.notify_one();
                        tracing::info!(
                            "triggered blob snatcher scan after gossip canvas discovery"
                        );
                    });
                }
            }
        }
    }

    /// send a BlobSeek to a peer with all missing blob hashes.
    ///
    /// called after gossip digest exchange. the peer responds with BlobOffer
    /// listing which blobs they have, populating the peer blob inventory.
    pub(crate) async fn send_blob_seek_to_peer(&self, peer_node_id: &str) {
        // collect missing blob blake3 hashes from the snatcher's perspective.
        // scan all docs for file widgets that reference blobs we don't have.
        let doc_ids = self.hub_repo.all_doc_ids().await;
        if doc_ids.is_empty() {
            return;
        }

        let mut missing_hashes: Vec<String> = Vec::new();

        for doc_id in &doc_ids {
            let handle = match self.hub_repo.find(doc_id).await {
                Some(h) => h,
                None => continue,
            };

            // read root-level blake3 (widget state docs have this at root)
            let blake3 = tokio::task::spawn_blocking(move || {
                let mut result = String::new();
                handle.with_document(|doc| {
                    use automerge::ReadDoc;
                    if let Ok(Some((v, _))) = doc.get(automerge::ROOT, "blake3") {
                        if let Some(s) = v.to_str() {
                            result = s.to_string();
                        }
                    }
                });
                result
            })
            .await
            .unwrap_or_default();

            if blake3.is_empty() {
                continue;
            }

            // check if we already have this blob
            match grimoire::media_blobz::get_media_blob_by_blake3(&blake3).await {
                Ok(_) => {} // already have it
                Err(_) => {
                    if !missing_hashes.contains(&blake3) {
                        missing_hashes.push(blake3);
                    }
                }
            }
        }

        if missing_hashes.is_empty() {
            tracing::debug!(peer = %peer_node_id, "no missing blobs to seek");
            return;
        }

        tracing::info!(
            peer = %peer_node_id,
            count = missing_hashes.len(),
            "sending blob seek"
        );

        let seek = FriendzMessage::BlobSeek {
            needed: missing_hashes,
        };
        if let Err(e) = self.friendz.send_message(peer_node_id, &seek).await {
            tracing::warn!(
                peer = %peer_node_id,
                error = %e,
                "failed to send blob seek"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// automerge doc write helpers
// ---------------------------------------------------------------------------

/// write the hub peer into a canvas document's `peers` map and remove from
/// `pendingInvites`. returns `true` if the write succeeded (or the peer was
/// already present), `false` if the doc isn't ready yet (no content synced).
///
/// runs inside `spawn_blocking` because doc access holds a lock.
fn write_self_to_canvas_doc(
    handle: &crate::hub_repo::DocHandle,
    node_id: &str,
    canvas_doc_id: &str,
) -> bool {
    use automerge::ReadDoc;

    handle.with_document_mut(|doc| {
        // dump all root-level keys for diagnostics
        let root_keys: Vec<String> = doc.keys(automerge::ROOT).collect();
        tracing::info!(
            canvas_doc_id = %canvas_doc_id,
            root_keys = ?root_keys,
            root_key_count = root_keys.len(),
            "write_self_to_canvas_doc: inspecting doc state"
        );

        // check if the doc has any content — if it's completely empty the
        // document hasn't synced from a peer yet
        let has_version = doc.get(automerge::ROOT, "version").ok().flatten().is_some();
        let has_widgets = doc.get(automerge::ROOT, "widgets").ok().flatten().is_some();
        let has_title = doc.get(automerge::ROOT, "title").ok().flatten().is_some();
        let has_peers = doc.get(automerge::ROOT, "peers").ok().flatten().is_some();

        tracing::info!(
            canvas_doc_id = %canvas_doc_id,
            has_version,
            has_widgets,
            has_title,
            has_peers,
            "write_self_to_canvas_doc: content check"
        );

        if !has_version && !has_widgets && !has_title {
            tracing::info!(
                canvas_doc_id = %canvas_doc_id,
                "write_self_to_canvas_doc: doc has no content — not synced yet"
            );
            return false; // doc not synced yet
        }

        // check if already in peers
        let already_in_peers = if let Ok(Some((_, peers_obj))) = doc.get(automerge::ROOT, "peers") {
            let peer_keys: Vec<String> = doc.keys(&peers_obj).collect();
            let found = doc.get(&peers_obj, node_id).ok().flatten().is_some();
            tracing::info!(
                canvas_doc_id = %canvas_doc_id,
                peer_keys = ?peer_keys,
                our_node_id = %node_id,
                found_self = found,
                "write_self_to_canvas_doc: existing peers in doc"
            );
            found
        } else {
            tracing::info!(
                canvas_doc_id = %canvas_doc_id,
                "write_self_to_canvas_doc: no peers map in doc yet"
            );
            false
        };

        if already_in_peers {
            // stamp lastSeenAt so the hub doesn't appear stale in gossip
            let now = time::OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string());

            let nid2 = node_id.to_string();
            match doc.transact::<_, _, automerge::AutomergeError>(|tx| {
                use automerge::transaction::Transactable;
                if let Some((_, peers_obj)) = tx.get(automerge::ROOT, "peers")? {
                    if let Some((_, peer_obj)) = tx.get(&peers_obj, nid2.as_str())? {
                        tx.put(&peer_obj, "lastSeenAt", now.as_str())?;
                    }
                }
                Ok(())
            }) {
                Ok(_) => {
                    tracing::debug!(
                        canvas_doc_id = %canvas_doc_id,
                        "write_self_to_canvas_doc: stamped lastSeenAt"
                    );
                }
                Err(e) => {
                    tracing::warn!(
                        canvas_doc_id = %canvas_doc_id,
                        error = ?e,
                        "write_self_to_canvas_doc: failed to stamp lastSeenAt"
                    );
                }
            }
            return true;
        }

        // check pendingInvites state before writing
        if let Ok(Some((_, pending_obj))) = doc.get(automerge::ROOT, "pendingInvites") {
            let pending_keys: Vec<String> = doc.keys(&pending_obj).collect();
            let has_our_invite = doc.get(&pending_obj, node_id).ok().flatten().is_some();
            tracing::info!(
                canvas_doc_id = %canvas_doc_id,
                pending_keys = ?pending_keys,
                has_our_invite,
                "write_self_to_canvas_doc: pendingInvites state"
            );
        } else {
            tracing::info!(
                canvas_doc_id = %canvas_doc_id,
                "write_self_to_canvas_doc: no pendingInvites map in doc"
            );
        }

        // generate ISO timestamp matching JS `new Date().toISOString()`
        let joined_at = time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string());

        tracing::info!(
            canvas_doc_id = %canvas_doc_id,
            node_id = %node_id,
            joined_at = %joined_at,
            "write_self_to_canvas_doc: writing peer entry via transact"
        );

        let nid = node_id.to_string();

        match doc.transact::<_, _, automerge::AutomergeError>(|tx| {
            use automerge::transaction::Transactable;

            // ensure peers map exists
            let peers_obj = match tx.get(automerge::ROOT, "peers")? {
                Some((_, obj_id)) => {
                    tracing::debug!(
                        canvas_doc_id = %canvas_doc_id,
                        "transact: using existing peers map"
                    );
                    obj_id
                }
                None => {
                    tracing::info!(
                        canvas_doc_id = %canvas_doc_id,
                        "transact: creating new peers map"
                    );
                    tx.put_object(automerge::ROOT, "peers", automerge::ObjType::Map)?
                }
            };

            // create our peer entry: { nodeId, joinedAt, lastSeenAt }
            let peer_obj = tx.put_object(&peers_obj, nid.as_str(), automerge::ObjType::Map)?;
            tx.put(&peer_obj, "nodeId", nid.as_str())?;
            tx.put(&peer_obj, "joinedAt", joined_at.as_str())?;
            tx.put(&peer_obj, "lastSeenAt", joined_at.as_str())?;

            tracing::info!(
                canvas_doc_id = %canvas_doc_id,
                node_id = %nid,
                "transact: wrote peer entry {{ nodeId, joinedAt, lastSeenAt }}"
            );

            // remove from pendingInvites if present
            if let Some((_, pending_obj)) = tx.get(automerge::ROOT, "pendingInvites")? {
                if tx.get(&pending_obj, nid.as_str())?.is_some() {
                    tx.delete(&pending_obj, nid.as_str())?;
                    tracing::info!(
                        canvas_doc_id = %canvas_doc_id,
                        "transact: removed hub peer from pendingInvites"
                    );
                }
            }

            Ok(())
        }) {
            Ok(_) => {
                tracing::info!(
                    canvas_doc_id = %canvas_doc_id,
                    "write_self_to_canvas_doc: transact committed successfully"
                );
                true
            }
            Err(e) => {
                tracing::warn!(
                    canvas_doc_id = %canvas_doc_id,
                    error = ?e,
                    "write_self_to_canvas_doc: transact FAILED"
                );
                false
            }
        }
    })
}

// ---------------------------------------------------------------------------
// automerge doc reading helpers
// ---------------------------------------------------------------------------

/// read a canvas document's automerge state to extract gossip-relevant data
/// for a specific peer.
///
/// returns (optional canvas update, optional pending invite, peer_is_participant, is_deleted)
/// for gossip digest. runs inside spawn_blocking because doc access holds a lock.
fn read_canvas_for_gossip(
    handle: &crate::hub_repo::DocHandle,
    peer_node_id: &str,
) -> (
    Option<GossipDigestCanvasUpdate>,
    Option<GossipDigestPendingInvite>,
    bool, // peer_is_participant: true if peer is in peers or pendingInvites
    bool, // is_deleted: true if canvas has been tombstoned
) {
    use automerge::ReadDoc;

    let canvas_doc_id = handle.document_id().to_string();

    // helper: read a string field from an automerge object
    fn read_str(doc: &automerge::Automerge, obj: &automerge::ObjId, key: &str) -> String {
        use automerge::ReadDoc;
        match doc.get(obj, key) {
            Ok(Some((automerge::Value::Object(automerge::ObjType::Text), text_id))) => {
                doc.text(&text_id).unwrap_or_default()
            }
            Ok(Some((v, _))) => v.to_str().map(|s| s.to_string()).unwrap_or_default(),
            _ => String::new(),
        }
    }

    handle.with_document(|doc| {
        let mut update: Option<GossipDigestCanvasUpdate> = None;
        let mut invite: Option<GossipDigestPendingInvite> = None;
        let mut peer_is_participant = false;

        // check for tombstone
        let is_deleted = match doc.get(automerge::ROOT, "deleted") {
            Ok(Some((automerge::Value::Scalar(s), _))) => {
                s.as_ref() == &automerge::ScalarValue::Boolean(true)
            }
            _ => false,
        };

        if is_deleted {
            let delete_mode = read_str(doc, &automerge::ROOT, "deleteMode");
            tracing::info!(
                canvas_doc_id = %canvas_doc_id,
                delete_mode = %delete_mode,
                "detected tombstone on canvas doc"
            );
            return (None, None, false, true);
        }

        // read lastModified
        let last_modified: String = read_str(doc, &automerge::ROOT, "lastModified");

        // read lastModifiedBy
        let last_modified_by: String = read_str(doc, &automerge::ROOT, "lastModifiedBy");

        // check if peer is on this canvas and has stale state
        if let Ok(Some((_, peers_obj))) = doc.get(automerge::ROOT, "peers") {
            if let Ok(Some((_, peer_entry_obj))) = doc.get(peers_obj, peer_node_id) {
                peer_is_participant = true;
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
                peer_is_participant = true;
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

                    tracing::info!(
                        canvas_doc_id = %canvas_doc_id,
                        canvas_title = ?invite.as_ref().map(|i| &i.canvas_title),
                        invited_by = ?invite.as_ref().map(|i| &i.invited_by),
                        invited_by_username = ?invite.as_ref().map(|i| &i.invited_by_username),
                        "gossip: constructed pending invite for digest"
                    );
                }
            }
        }

        (update, invite, peer_is_participant, false)
    })
}
