import type { DocHandle, DocumentId, Repo } from "@automerge/automerge-repo";
import type { CanvasDocument } from "../canvas/canvas-doc";
import type { CanvasStore } from "../canvas/canvas-store";
import { FriendzProtocol, type CanvasActivityEntry } from "../p2p/friends-protocol";
import { initBridge, setOutboundRequestHook } from "../p2p/friendz-bridge";
import { GossipTracker } from "../p2p/gossip-tracker";
import { getMiddenNode, getStoredIdentity } from "../p2p/identity";
import {
  FRIENDZ_ALPN,
  type IrohNetworkAdapter,
  type MiddenStreamNode,
} from "../p2p/iroh-network-adapter";

export interface FriendzWiringDeps {
  repo: Repo;
  irohAdapter: IrohNetworkAdapter;
  store: CanvasStore;
  narthexDocId: string;
  gossipTracker: GossipTracker;
  socialWidgetId: string;
  inboxWidgetId: string;
  messagezWidgetId: string;
}

export interface FriendzWiringResult {
  protocol: FriendzProtocol;
  socialDocHandle: DocHandle<any>;
  inboxDocHandle: DocHandle<any> | null;
  unsubs: Array<() => void>;
}

/**
 * initialize the friends protocol and wire all event callbacks.
 * returns null if identity or social doc is not ready yet.
 */
export async function initFriendzWiring(
  deps: FriendzWiringDeps
): Promise<FriendzWiringResult | null> {
  const {
    repo,
    irohAdapter,
    store,
    narthexDocId,
    gossipTracker,
    socialWidgetId,
    inboxWidgetId,
    messagezWidgetId,
  } = deps;

  const identity = await getStoredIdentity();
  if (!identity) return null;

  // look up the social widget's automerge doc
  const socialEntry = store.getWidget(socialWidgetId);
  if (!socialEntry?.docId) {
    console.log("[skein] social widget doc not ready yet — deferring protocol init");
    return null;
  }

  const socialHandle = await repo.find<any>(socialEntry.docId as DocumentId);
  await socialHandle.whenReady();

  // look up the inbox widget's automerge doc
  const inboxEntry = store.getWidget(inboxWidgetId);
  let inboxHandle: DocHandle<any> | null = null;
  if (inboxEntry?.docId) {
    inboxHandle = await repo.find<any>(inboxEntry.docId as DocumentId);
    await inboxHandle.whenReady();
  }

  // look up the messagez widget's automerge doc
  const messagezEntry = store.getWidget(messagezWidgetId);
  let messagezHandle: DocHandle<any> | null = null;
  if (messagezEntry?.docId) {
    messagezHandle = await repo.find<any>(messagezEntry.docId as DocumentId);
    await messagezHandle.whenReady();
  }

  // read initial privacy settings from social doc
  const socialDoc = socialHandle.doc() as Record<string, unknown> | undefined;
  const profileVisibility = (socialDoc?.profileVisibility as string) ?? "friends";
  const friendRequestsFrom = (socialDoc?.friendRequestsFrom as string) ?? "everyone";

  // read initial canvas invite privacy setting from messagez doc
  const messagezDoc = messagezHandle?.doc() as Record<string, unknown> | undefined;
  const canvasInvitesFrom = (messagezDoc?.canvasInvitesFrom as string) ?? "everyone";

  const protocol = new FriendzProtocol({
    getMidden: async () => (await getMiddenNode()) as unknown as MiddenStreamNode,
    localNodeId: identity.node_id,
    localUsername: ((socialHandle.doc() as any)?.profile?.username as string) ?? "",
    getLocalProfile: () => {
      const doc = socialHandle.doc() as Record<string, any> | undefined;
      const profile = doc?.profile ?? {};
      return {
        username: (profile.username as string) ?? "",
        bio: (profile.bio as string) ?? "",
        avatarDataUrl: (profile.avatarDataUrl as string) ?? "",
      };
    },
    isFriend: (nodeId: string) => {
      const doc = socialHandle.doc() as
        | { friends?: Array<{ nodeIds?: Array<{ nodeId: string }> }> }
        | undefined;
      return doc?.friends?.some((f) => f.nodeIds?.some((n) => n.nodeId === nodeId)) ?? false;
    },
    profileVisibility: profileVisibility as "friends" | "everyone" | "nobody",
    friendRequestsFrom: friendRequestsFrom as "everyone" | "nobody",
    canvasInvitesFrom: canvasInvitesFrom as "everyone" | "friends" | "nobody",
    getCanvasActivity: () => {
      // collect activity from narthex canvas cards.
      // reads live state from per-widget docs and canvas docs instead of
      // stale entry.props snapshots. runs synchronously during heartbeat.
      if (!narthexDocId) return [];
      try {
        const narthexHandle = repo.find<CanvasDocument>(narthexDocId as DocumentId);
        const narthexDoc = (narthexHandle as any).doc?.() as CanvasDocument | undefined;
        if (!narthexDoc?.widgets) return [];

        const entries: CanvasActivityEntry[] = [];
        for (const w of Object.values(narthexDoc.widgets)) {
          if (w.type !== "canvas-card") continue;
          const props = w.props as any;
          if (!props?.canvasDocId) continue;

          // try to read the actual canvas doc's lastModified (authoritative)
          let lastMod = "";
          try {
            const canvasHandle = repo.find<CanvasDocument>(props.canvasDocId as DocumentId);
            const canvasDoc = (canvasHandle as any).doc?.() as CanvasDocument | undefined;
            if (canvasDoc?.lastModified) {
              lastMod = canvasDoc.lastModified;
            }
          } catch {
            /* not available yet */
          }

          // fallback: read from per-widget doc
          if (!lastMod && w.docId) {
            try {
              const cardHandle = repo.find<any>(w.docId as DocumentId);
              const cardDoc = (cardHandle as any).doc?.() as Record<string, unknown> | undefined;
              lastMod =
                (cardDoc?.lastKnownModifiedAt as string) || (cardDoc?.modifiedAt as string) || "";
            } catch {
              /* not available yet */
            }
          }

          if (!lastMod) continue; // skip cards with no known activity

          entries.push({
            canvasDocId: props.canvasDocId,
            lastModifiedAt: lastMod,
            widgetCount: 0,
          });
          if (entries.length >= 20) break;
        }
        return entries;
      } catch {
        return [];
      }
    },
  });

  // register ALPN handler for incoming friendz streams
  irohAdapter.registerAlpnHandler(FRIENDZ_ALPN, (stream) => {
    protocol.handleStream(stream);
  });

  // collect unsub callbacks so the caller can tear everything down
  const unsubs: Array<() => void> = [];

  // --- wire event callbacks ---

  // incoming friend request -> write to social doc
  protocol.onFriendRequest = (msg, fromNodeId) => {
    socialHandle.change((draft: any) => {
      if (!draft.pendingRequests) draft.pendingRequests = [];
      // don't add duplicate pending requests from the same node
      const exists = draft.pendingRequests.some(
        (r: any) => r.fromNodeId === fromNodeId && r.status === "pending"
      );
      if (!exists) {
        draft.pendingRequests.push({
          fromNodeId,
          fromUsername: msg.fromUsername,
          receivedAt: new Date().toISOString(),
          status: "pending",
        });
      }
    });
    console.log("[skein] received friend request from:", fromNodeId.slice(0, 16) + "...");

    // send an immediate heartbeat so the requester sees us as online
    protocol.sendHeartbeatTo(fromNodeId).catch(() => {});
  };

  // friend accept -> remote peer accepted our outgoing request, add them as friend
  protocol.onFriendAccept = (msg, fromNodeId) => {
    socialHandle.change((draft: any) => {
      if (!draft.friends) draft.friends = [];
      // check if we already have this friend
      const existingFriend = draft.friends.find((f: any) =>
        f.nodeIds?.some((n: any) => n.nodeId === fromNodeId)
      );
      if (!existingFriend) {
        draft.friends.push({
          id: crypto.randomUUID(),
          alias: "",
          username: msg.fromUsername,
          group: "",
          nodeIds: [
            {
              nodeId: fromNodeId,
              addedAt: new Date().toISOString(),
              lastSeenAt: "",
              username: msg.fromUsername,
              bio: "",
              avatarDataUrl: "",
            },
          ],
          createdAt: new Date().toISOString(),
        });
      }
    });
    // also update outbound request status if we had one pending
    socialHandle.change((draft: any) => {
      if (!draft.outboundRequests) return;
      for (const req of draft.outboundRequests) {
        if (req.toNodeId === fromNodeId && req.status === "pending") {
          req.status = "accepted";
          if (msg.fromUsername) req.toUsername = msg.fromUsername;
          break;
        }
      }
    });
    console.log("[skein] friend request accepted by:", fromNodeId.slice(0, 16) + "...");

    // send ack back so the accepter can confirm the handshake
    protocol.sendFriendAcceptAck(fromNodeId).catch(() => {});

    // immediately fetch profile from the new friend and send a heartbeat
    // so they see us online — without this, both sides have to wait for
    // the next heartbeat cycle (~30s) before profiles and presence appear.
    protocol.requestProfile(fromNodeId).catch(() => {});
    protocol.sendHeartbeatTo(fromNodeId).catch(() => {});
  };

  // friend reject -> update request status (informational)
  protocol.onFriendReject = (_msg, fromNodeId) => {
    socialHandle.change((draft: any) => {
      if (!draft.outboundRequests) return;
      for (const req of draft.outboundRequests) {
        if (req.toNodeId === fromNodeId && req.status === "pending") {
          req.status = "rejected";
          break;
        }
      }
    });
    console.log("[skein] friend request rejected by:", fromNodeId.slice(0, 16) + "...");
  };

  // profile response -> update the friend's nodeId entry with profile data
  protocol.onProfileResponse = (profile, fromNodeId) => {
    socialHandle.change((draft: any) => {
      if (!draft.friends) return;
      for (const friend of draft.friends) {
        if (!friend.nodeIds) continue;
        for (const nodeEntry of friend.nodeIds) {
          if (nodeEntry.nodeId === fromNodeId) {
            nodeEntry.username = profile.username;
            nodeEntry.bio = profile.bio;
            nodeEntry.avatarDataUrl = profile.avatarDataUrl;
            // also update the friend-level username from the most recent profile
            friend.username = profile.username;
            return;
          }
        }
      }
    });
  };

  // heartbeat -> update lastSeenAt on the friend's nodeId entry
  protocol.onHeartbeat = (heartbeat, fromNodeId) => {
    socialHandle.change((draft: any) => {
      if (!draft.friends) return;
      for (const friend of draft.friends) {
        if (!friend.nodeIds) continue;
        for (const nodeEntry of friend.nodeIds) {
          if (nodeEntry.nodeId === fromNodeId) {
            nodeEntry.lastSeenAt = new Date().toISOString();
            if (heartbeat.username) {
              nodeEntry.username = heartbeat.username;
            }
            return;
          }
        }
      }
    });
    // if we don't have profile data for this peer, request it
    const currentDoc = socialHandle.doc() as
      | { friends?: Array<{ nodeIds?: Array<{ nodeId: string; avatarDataUrl?: string }> }> }
      | undefined;
    if (currentDoc?.friends) {
      for (const friend of currentDoc.friends) {
        if (friend.nodeIds) {
          for (const n of friend.nodeIds) {
            if (n.nodeId === fromNodeId && !n.avatarDataUrl) {
              protocol.requestProfile(fromNodeId).catch(() => {});
              return;
            }
          }
        }
      }
    }
  };

  // --- canvas invite callbacks (require inbox doc) ---
  if (inboxHandle) {
    const localNodeId = identity.node_id;

    // incoming canvas invite
    protocol.onCanvasInvite = (msg, fromNodeId) => {
      // dedup by canvasDocId — a canvas can only appear once in inbox
      const currentInbox = inboxHandle!.doc() as
        | { invites?: Array<{ canvasDocId: string }> }
        | undefined;
      const alreadyHave = currentInbox?.invites?.some((i) => i.canvasDocId === msg.canvasDocId);

      if (alreadyHave) {
        // still ACK so the relayer knows we got it
        protocol
          .sendCanvasInviteAck(fromNodeId, {
            inviteId: msg.inviteId,
            canvasDocId: msg.canvasDocId,
            ackerNodeId: localNodeId,
          })
          .catch(() => {});
        return;
      }

      inboxHandle!.change((draft: any) => {
        if (!draft.invites) draft.invites = [];
        draft.invites.push({
          id: msg.inviteId,
          canvasDocId: msg.canvasDocId,
          canvasTitle: msg.canvasTitle,
          canvasDescription: msg.canvasDescription ?? "",
          canvasColor: msg.canvasColor ?? 0,
          canvasPreviewUrl: msg.canvasPreviewUrl ?? "",
          fromNodeId: msg.originNodeId,
          fromUsername: msg.originUsername,
          relayedBy: fromNodeId !== msg.originNodeId ? fromNodeId : "",
          receivedAt: new Date().toISOString(),
          status: "pending",
        });
      });

      // ACK immediately
      protocol
        .sendCanvasInviteAck(fromNodeId, {
          inviteId: msg.inviteId,
          canvasDocId: msg.canvasDocId,
          ackerNodeId: localNodeId,
        })
        .catch(() => {});

      // pick up gossip responsibility for remaining targets
      gossipTracker.track(
        msg.inviteId,
        msg.canvasDocId,
        msg.canvasTitle,
        msg.canvasDescription ?? "",
        msg.canvasColor ?? 0,
        msg.canvasPreviewUrl ?? "",
        msg.originNodeId,
        msg.originUsername,
        msg.role,
        msg.targets,
        [...msg.acked, localNodeId] // include ourselves as acked
      );

      console.log("[skein] received canvas invite for:", msg.canvasDocId.slice(0, 16) + "...");
    };

    // canvas invite ACK — update outbox delivery status + gossip tracker
    protocol.onCanvasInviteAck = (msg, _fromNodeId) => {
      inboxHandle!.change((draft: any) => {
        if (!draft.shares) return;
        const share = draft.shares.find(
          (s: any) => s.canvasDocId === msg.canvasDocId && s.toNodeId === msg.ackerNodeId
        );
        if (share) share.delivered = true;
      });
      gossipTracker.markAcked(msg.canvasDocId, msg.ackerNodeId);
    };

    // canvas invite accepted
    protocol.onCanvasInviteAccept = (msg, _fromNodeId) => {
      inboxHandle!.change((draft: any) => {
        if (!draft.shares) return;
        const share = draft.shares.find(
          (s: any) => s.canvasDocId === msg.canvasDocId && s.toNodeId === msg.accepterNodeId
        );
        if (share) share.accepted = true;
      });
      console.log("[skein] canvas invite accepted by:", msg.accepterNodeId.slice(0, 16) + "...");
    };

    // canvas invite declined
    protocol.onCanvasInviteDecline = (msg, _fromNodeId) => {
      inboxHandle!.change((draft: any) => {
        if (!draft.shares) return;
        const share = draft.shares.find(
          (s: any) => s.canvasDocId === msg.canvasDocId && s.toNodeId === msg.declinerNodeId
        );
        if (share) share.declined = true;
      });
      console.log("[skein] canvas invite declined by:", msg.declinerNodeId.slice(0, 16) + "...");
    };

    // friend-accept-ack — upgrade pending-ack to fully accepted
    protocol.onFriendAcceptAck = (_msg, fromNodeId) => {
      socialHandle.change((draft: any) => {
        if (!draft.pendingRequests) return;
        for (const req of draft.pendingRequests) {
          if (req.fromNodeId === fromNodeId && req.status === "accepted-pending-ack") {
            req.status = "accepted";
            break;
          }
        }
      });
      console.log("[skein] friend-accept-ack from:", fromNodeId.slice(0, 16) + "...");

      // now that the handshake is complete, fetch their profile and
      // announce presence so both sides have profile data immediately
      protocol.requestProfile(fromNodeId).catch(() => {});
      protocol.sendHeartbeatTo(fromNodeId).catch(() => {});
    };

    // ACL change notification — update local canvas card
    protocol.onAclChange = (msg, _fromNodeId) => {
      const widgets = store.doc().widgets;
      for (const [widgetId, w] of Object.entries(widgets)) {
        if (w.type === "canvas-card" && (w.props as any)?.canvasDocId === msg.canvasDocId) {
          store.handle.change((draft: any) => {
            const card = draft.widgets[widgetId];
            if (!card) return;
            if (msg.newRole === "removed") {
              card.props.accessRevoked = true;
              card.props.role = "viewer";
            } else {
              card.props.role = msg.newRole;
            }
          });
          break;
        }
      }
      console.log(
        "[skein] ACL change for canvas:",
        msg.canvasDocId.slice(0, 16) + "...",
        "new role:",
        msg.newRole
      );
    };
  }

  // canvas activity from heartbeats — mark cards with new updates.
  // reads lastVisitedAt from the per-widget doc (live state) instead of
  // stale entry.props snapshots.
  protocol.onCanvasActivity = (activityEntries, _fromNodeId) => {
    if (!narthexDocId) return;
    try {
      const narthexHandle = repo.find<CanvasDocument>(narthexDocId as DocumentId);
      const narthexDoc = (narthexHandle as any).doc?.() as CanvasDocument | undefined;
      if (!narthexDoc?.widgets) return;

      for (const activity of activityEntries) {
        if (!activity.lastModifiedAt) continue;

        for (const w of Object.values(narthexDoc.widgets)) {
          if (w.type !== "canvas-card") continue;
          const props = w.props as any;
          if (props?.canvasDocId !== activity.canvasDocId) continue;
          if (!w.docId) continue;

          try {
            const cardHandle = repo.find<any>(w.docId as DocumentId);
            const cardDoc = (cardHandle as any).doc?.() as Record<string, unknown> | undefined;
            if (!cardDoc) break;

            // read lastVisitedAt from the per-widget doc (the live state)
            const lastVisited = (cardDoc.lastVisitedAt as string) || "";
            const currentKnown = (cardDoc.lastKnownModifiedAt as string) || "";

            // guard: if lastVisitedAt was never set (pre-migration card), skip.
            // without this, any lastModifiedAt > "" is always true, causing stuck pills.
            if (!lastVisited) break;

            // only update if this activity is newer than what we already know
            if (activity.lastModifiedAt > lastVisited && activity.lastModifiedAt > currentKnown) {
              (cardHandle as any).change?.((draft: any) => {
                draft.hasUpdates = true;
                draft.lastKnownModifiedAt = activity.lastModifiedAt;
              });
            }
          } catch {
            /* best-effort */
          }
          break;
        }
      }
    } catch {
      // best-effort
    }
  };

  // watch social doc for privacy setting and username changes
  const onSocialChange = () => {
    const doc = socialHandle.doc() as Record<string, unknown> | undefined;
    if (!doc) return;
    const pv = (doc.profileVisibility as string) ?? "friends";
    const frf = (doc.friendRequestsFrom as string) ?? "everyone";
    protocol.setProfileVisibility(pv as "friends" | "everyone" | "nobody");
    protocol.setFriendRequestsFrom(frf as "everyone" | "nobody");
    // update username from nested profile
    const profile = doc.profile as Record<string, unknown> | undefined;
    if (profile?.username && typeof profile.username === "string") {
      protocol.setLocalUsername(profile.username);
    }
  };
  socialHandle.on("change", onSocialChange);
  unsubs.push(() => socialHandle.off("change", onSocialChange));

  // watch messagez doc for canvas invite privacy changes
  if (messagezHandle) {
    const onMessagezChange = () => {
      const doc = messagezHandle!.doc() as Record<string, unknown> | undefined;
      if (!doc) return;
      const cif = (doc.canvasInvitesFrom as string) ?? "everyone";
      protocol.setCanvasInvitesFrom(cif as "everyone" | "friends" | "nobody");
    };
    messagezHandle.on("change", onMessagezChange);
    unsubs.push(() => messagezHandle!.off("change", onMessagezChange));
  }

  // start heartbeat — getter reads the current friends list from the doc
  protocol.startHeartbeat(() => {
    const doc = socialHandle.doc() as
      | { friends?: Array<{ nodeIds?: Array<{ nodeId: string }> }> }
      | undefined;
    if (!doc?.friends) return [];
    const nodeIds: string[] = [];
    for (const friend of doc.friends) {
      if (friend.nodeIds) {
        for (const n of friend.nodeIds) {
          if (n.nodeId) nodeIds.push(n.nodeId);
        }
      }
    }
    return nodeIds;
  });

  // presence-driven gossip delivery — when a peer comes online, check
  // if we have undelivered invites or gossip relay tasks for them
  if (inboxHandle) {
    const localNodeId = identity.node_id;

    protocol.onOnlineChange(() => {
      // check gossip tracker for entries that have un-ACK'd targets now online
      for (const entry of gossipTracker.allEntries()) {
        for (const targetNodeId of entry.targets) {
          if (entry.acked.has(targetNodeId)) continue;
          if (targetNodeId === localNodeId) continue;
          if (!protocol.isOnline(targetNodeId)) continue;

          // relay the invite
          protocol
            .sendCanvasInvite(targetNodeId, {
              inviteId: entry.inviteId,
              canvasDocId: entry.canvasDocId,
              canvasTitle: entry.canvasTitle,
              canvasDescription: entry.canvasDescription,
              canvasColor: entry.canvasColor,
              canvasPreviewUrl: entry.canvasPreviewUrl,
              originNodeId: entry.originNodeId,
              originUsername: entry.originUsername,
              role: entry.role,
              targets: [...entry.targets],
              acked: [...entry.acked],
            })
            .catch((err) => {
              console.warn(
                "[skein] gossip relay failed for:",
                targetNodeId.slice(0, 16) + "...",
                err
              );
            });
        }
      }
    });
  }

  // initialize the bridge so widgets can use the protocol
  initBridge(protocol);

  // track outbound friend requests in the social doc
  setOutboundRequestHook((toNodeId: string) => {
    socialHandle.change((draft: any) => {
      if (!draft.outboundRequests) draft.outboundRequests = [];
      // don't duplicate pending requests to the same node
      const exists = draft.outboundRequests.some(
        (r: any) => r.toNodeId === toNodeId && r.status === "pending"
      );
      if (!exists) {
        draft.outboundRequests.push({
          toNodeId,
          toUsername: "", // we don't know their username yet
          sentAt: new Date().toISOString(),
          status: "pending",
        });
      }
    });
  });

  // request profiles from all friend node IDs (fire-and-forget)
  // this populates avatar, bio, and username data from friends who are online
  const socialDocForProfiles = socialHandle.doc() as
    | { friends?: Array<{ nodeIds?: Array<{ nodeId: string; avatarDataUrl?: string }> }> }
    | undefined;
  if (socialDocForProfiles?.friends) {
    for (const friend of socialDocForProfiles.friends) {
      if (friend.nodeIds) {
        for (const n of friend.nodeIds) {
          if (n.nodeId) {
            protocol.requestProfile(n.nodeId).catch(() => {
              // silently ignore — peer may be offline
            });
          }
        }
      }
    }
  }

  // bridge transport reconnection to friendz protocol —
  // when the iroh adapter reconnects to a peer, send an immediate
  // heartbeat so the remote peer updates lastSeen and presence-driven
  // delivery kicks in without waiting for the next 30s heartbeat cycle
  const unsubReconnect = irohAdapter.onPeerConnect((nodeId) => {
    protocol.sendHeartbeatTo(nodeId).catch((err) => {
      console.warn("[skein] post-reconnect heartbeat failed:", nodeId.slice(0, 16) + "...", err);
    });
  });
  unsubs.push(unsubReconnect);

  console.log("[skein] friendz protocol initialized");

  return {
    protocol,
    socialDocHandle: socialHandle,
    inboxDocHandle: inboxHandle,
    unsubs,
  };
}
