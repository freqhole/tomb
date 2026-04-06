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

import { handleFreqholeStream } from "../p2p/freqhole-handler";
import { isTauriMode, TauriStreamNode } from "../p2p/tauri-transport";
import type { SocialDoc } from "../../widgets/narthex/social/types";
import type { SocialState } from "../../widgets/narthex/social/schema";

export interface FriendzWiringDeps {
  repo: Repo;
  irohAdapter: IrohNetworkAdapter;
  store: CanvasStore;
  narthexDocId: string;
  gossipTracker: GossipTracker;
  socialWidgetId: string;
  messagezWidgetId: string;
  socialDoc?: SocialDoc;
}

export interface FriendzWiringResult {
  protocol: FriendzProtocol;
  socialDoc: SocialDoc;
  messagezDocHandle: DocHandle<any> | null;
  unsubs: Array<() => void>;
}

/** wrap an automerge DocHandle as a SocialDoc (for browser/standalone mode) */
function docHandleAsSocialDoc(handle: DocHandle<any>): SocialDoc {
  return {
    get current(): SocialState {
      return (handle.doc() ?? {}) as SocialState;
    },
    change(fn: (draft: SocialState) => void) {
      handle.change(fn as any);
    },
    on(_event: "change", handler: (state: SocialState) => void): () => void {
      const cb = () => handler((handle.doc() ?? {}) as SocialState);
      handle.on("change", cb);
      return () => handle.off("change", cb);
    },
  };
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
    gossipTracker: _gossipTracker,
    socialWidgetId,
    messagezWidgetId,
  } = deps;

  // in tauri mode, identity comes from the running iroh endpoint
  // in standalone mode, identity is stored in IndexedDB
  let localNodeId: string;

  if (isTauriMode()) {
    const node = await TauriStreamNode.create();
    localNodeId = node.node_id();
  } else {
    const identity = await getStoredIdentity();
    if (!identity) return null;
    localNodeId = identity.node_id;
  }

  let sDoc: SocialDoc;

  if (deps.socialDoc) {
    sDoc = deps.socialDoc;
  } else {
    const socialEntry = store.getWidget(socialWidgetId);
    if (!socialEntry) return null;

    const socialHandle = await repo.find<any>(socialEntry.docId as DocumentId);
    sDoc = docHandleAsSocialDoc(socialHandle);
  }

  const messagezEntry = store.getWidget(messagezWidgetId);
  let messagezHandle: DocHandle<any> | null = null;

  if (messagezEntry) {
    messagezHandle = await repo.find<any>(messagezEntry.docId as DocumentId);
  }

  const profileVisibility = sDoc.current.profileVisibility ?? "friends";
  const friendRequestsFrom = sDoc.current.friendRequestsFrom ?? "everyone";

  const messagezDoc = messagezHandle?.doc();
  const canvasInvitesFrom = messagezDoc?.canvasInvitesFrom ?? "everyone";

  const getMidden = isTauriMode()
    ? async () => (await TauriStreamNode.create()) as MiddenStreamNode
    : async () => (await getMiddenNode()) as unknown as MiddenStreamNode;

  const protocol = new FriendzProtocol({
    getMidden,
    localNodeId,
    localUsername: sDoc.current.profile?.username ?? "anonymous",
    getLocalProfile: () => {
      const p = sDoc.current.profile;
      return {
        username: p?.username ?? "anonymous",
        bio: p?.bio ?? "",
        avatarDataUrl: p?.avatarDataUrl ?? "",
      };
    },
    isFriend: (nodeId: string) => {
      const friends = sDoc.current.friends ?? [];
      return friends.some(
        (f: any) => f.nodeIds?.some((n: any) => n.nodeId === nodeId)
      );
    },
    profileVisibility,
    friendRequestsFrom,
    canvasInvitesFrom,
    getCanvasActivity: () => {
      try {
        const narthexHandle = repo.handles[narthexDocId as DocumentId];
        const narthexDoc = narthexHandle?.doc();
        if (!narthexDoc) return [];

        const entries: CanvasActivityEntry[] = [];
        const props = narthexDoc.cards ?? {};

        for (const [_cardId, card] of Object.entries(props) as any[]) {
          let lastMod: string | null = null;

          try {
            const canvasHandle = repo.handles[card.docId as DocumentId];
            const canvasDoc = canvasHandle?.doc() as CanvasDocument | undefined;

            if (canvasDoc) {
              let widgetCount = 0;
              for (const [_wid, widget] of Object.entries(canvasDoc.widgets ?? {}) as any[]) {
                widgetCount++;
                if (!lastMod || (widget.lastModifiedAt && widget.lastModifiedAt > lastMod)) {
                  lastMod = widget.lastModifiedAt ?? null;
                }
              }

              // also check card-level metadata
              try {
                const cardHandle = repo.handles[card.docId as DocumentId];
                const cardDoc = cardHandle?.doc();
                if (cardDoc?.lastVisitedAt && (!lastMod || cardDoc.lastVisitedAt > lastMod)) {
                  lastMod = cardDoc.lastVisitedAt;
                }
              } catch {
                // ignore
              }

              entries.push({
                canvasDocId: card.docId,
                lastModifiedAt: lastMod ?? "",
                widgetCount,
              });
            }
          } catch {
            // canvas doc not yet synced — skip
          }
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

  // register ALPN handler for incoming freqhole/1 streams (blob serving, proxy requests)
  irohAdapter.registerAlpnHandler("freqhole/1", handleFreqholeStream);

  // collect unsub callbacks so the caller can tear everything down
  const unsubs: Array<() => void> = [];

  // --- wire event callbacks ---

  // incoming friend request -> write to social doc
  protocol.onFriendRequest = (msg, fromNodeId) => {
    sDoc.change((draft: any) => {
      if (!draft.pendingRequests) draft.pendingRequests = [];
      // don't add duplicate pending requests from the same node
      const exists = draft.pendingRequests.some(
        (r: any) => r.fromNodeId === fromNodeId
      );
      if (!exists) {
        draft.pendingRequests.push({
          fromNodeId,
          fromUsername: msg.fromUsername ?? "unknown",
          receivedAt: new Date().toISOString(),
          status: "pending",
        });
      }
    });
  };

  // incoming friend accept -> add to friends list
  protocol.onFriendAccept = (msg, fromNodeId) => {
    sDoc.change((draft: any) => {
      if (!draft.friends) draft.friends = [];

      // find existing friend entry by node ID
      const existingFriend = draft.friends.find(
        (f: any) => f.nodeIds?.some((n: any) => n.nodeId === fromNodeId)
      );

      if (!existingFriend) {
        draft.friends.push({
          id: crypto.randomUUID(),
          alias: msg.fromUsername ?? "unknown",
          username: msg.fromUsername ?? "unknown",
          group: "default",
          nodeIds: [
            {
              nodeId: fromNodeId,
              addedAt: new Date().toISOString(),
              lastSeenAt: new Date().toISOString(),
              username: msg.fromUsername ?? "",
              bio: "",
              avatarDataUrl: "",
            },
          ],
          createdAt: new Date().toISOString(),
        });
      }

      // update pending request status
      if (draft.pendingRequests) {
        for (const req of draft.pendingRequests) {
          if (req.fromNodeId === fromNodeId && req.status === "pending") {
            req.status = "accepted";
          }
        }
      }

      // update sent request status
      if (draft.sentRequests) {
        for (const req of draft.sentRequests) {
          if (req.toNodeId === fromNodeId && req.status === "pending") {
            req.status = "accepted";
          }
        }
      }
    });
  };

  // incoming friend reject -> update pending request status
  protocol.onFriendReject = (_msg, fromNodeId) => {
    sDoc.change((draft: any) => {
      if (draft.sentRequests) {
        for (const req of draft.sentRequests) {
          if (req.toNodeId === fromNodeId && req.status === "pending") {
            req.status = "rejected";
          }
        }
      }
    });
  };

  // incoming profile response -> update friend's profile data
  protocol.onProfileResponse = (msg, fromNodeId) => {
    sDoc.change((draft: any) => {
      if (!draft.friends) return;
      for (const friend of draft.friends) {
        if (!friend.nodeIds) continue;
        for (const n of friend.nodeIds) {
          if (n.nodeId === fromNodeId) {
            if (msg.username) n.username = msg.username;
            if (msg.bio !== undefined) n.bio = msg.bio;
            if (msg.avatarDataUrl !== undefined) n.avatarDataUrl = msg.avatarDataUrl;
            n.lastSeenAt = new Date().toISOString();
          }
        }
      }
    });
  };

  // incoming heartbeat -> update last seen
  protocol.onHeartbeat = (_msg, fromNodeId) => {
    sDoc.change((draft: any) => {
      if (!draft.friends) return;
      for (const friend of draft.friends) {
        if (!friend.nodeIds) continue;
        for (const n of friend.nodeIds) {
          if (n.nodeId === fromNodeId) {
            n.lastSeenAt = new Date().toISOString();
          }
        }
      }
    });
  };

  // canvas invite handling
  protocol.onCanvasInvite = (msg, fromNodeId) => {
    if (!messagezHandle) return;

    messagezHandle.change((draft: any) => {
      if (!draft.canvasInvites) draft.canvasInvites = [];

      // check for existing ack for same invite
      const currentInbox = (draft.canvasInvites ?? []) as any[];
      const alreadyHave = currentInbox.some(
        (inv: any) =>
          inv.canvasDocId === msg.canvasDocId &&
          inv.fromNodeId === fromNodeId
      );

      if (alreadyHave) return;

      draft.canvasInvites.push({
        id: crypto.randomUUID(),
        canvasDocId: msg.canvasDocId,
        canvasTitle: msg.canvasTitle ?? "",
        canvasDescription: msg.canvasDescription ?? "",
        canvasColor: msg.canvasColor ?? "#666",
        canvasPreviewUrl: msg.canvasPreviewUrl ?? "",
        fromNodeId,
        fromUsername: msg.originUsername ?? "unknown",
        relayedBy: (msg as any).relayedBy ?? [],
        receivedAt: new Date().toISOString(),
        status: "pending",
      });
    });
  };

  protocol.onCanvasInviteAck = (msg, fromNodeId) => {
    if (!messagezHandle) return;

    messagezHandle.change((draft: any) => {
      if (!draft.sentInviteAcks) draft.sentInviteAcks = [];
      draft.sentInviteAcks.push({
        inviteId: msg.inviteId,
        canvasDocId: msg.canvasDocId,
        ackerNodeId: fromNodeId,
      });
    });
  };

  // wire outbound requests through the bridge
  initBridge(protocol);

  // hook outbound request side-effects: track sent friend requests in social doc
  setOutboundRequestHook((targetNodeId: string) => {
    sDoc.change((draft: any) => {
      if (!draft.sentRequests) draft.sentRequests = [];
      const exists = draft.sentRequests.some(
        (r: any) => r.toNodeId === targetNodeId
      );
      if (!exists) {
        draft.sentRequests.push({
          toNodeId: targetNodeId,
          toUsername: "unknown",
          sentAt: new Date().toISOString(),
          status: "pending",
        });
      }
    });
  });

  // register gossip tracker watchers
  const widgets = store.handle.doc()?.widgets ?? {};
  for (const [_id, widget] of Object.entries(widgets) as any[]) {
    if (!widget?.docId) continue;
    const card = widget;
    if (card.type !== "canvas-card" || !card.props?.docId) continue;

    // TODO: gossip tracker canvas watching not yet implemented
    const _canvasDocId = card.props.docId as string;
    void _canvasDocId;
  }

  // watch for new canvas cards being added
  store.handle.on("change", () => {
    const doc = store.handle.doc();
    if (!doc) return;

    for (const [_id, widget] of Object.entries(doc.widgets ?? {}) as any[]) {
      if (!widget?.docId) continue;
      const card = widget;
      if (card.type !== "canvas-card" || !card.props?.docId) continue;

      // TODO: gossip tracker canvas watching not yet implemented
      const _canvasDocId = card.props.docId as string;
      void _canvasDocId;
    }
  });

  // narthex doc metadata sync
  {
    const narthexHandle = await repo.find<any>(narthexDocId as DocumentId);
    const narthexDoc = narthexHandle.doc();

    if (narthexDoc) {
      // sync card props from canvas docs into narthex card metadata
      for (const [_cardId, card] of Object.entries(narthexDoc.cards ?? {}) as any[]) {
        if (!card?.docId) continue;

        try {
          const cardHandle = await repo.find<any>(card.docId as DocumentId);
          const cardDoc = cardHandle.doc();

          if (cardDoc) {
            const lastVisited = cardDoc.lastVisitedAt as string | undefined;
            const currentKnown = card.lastVisitedAt;
            if (lastVisited && (!currentKnown || lastVisited > currentKnown)) {
              narthexHandle.change((draft: any) => {
                if (draft.cards?.[_cardId]) {
                  draft.cards[_cardId].lastVisitedAt = lastVisited;
                }
              });
            }
          }
        } catch {
          // canvas not synced yet
        }
      }
    }
  }

  // watch for social doc changes (to update protocol settings)
  const onSocialChange = (state: SocialState) => {
    const pv = state.profileVisibility ?? "friends";
    const frf = state.friendRequestsFrom ?? "everyone";
    protocol.setProfileVisibility(pv);
    protocol.setFriendRequestsFrom(frf);
  };
  const unsubSocial = sDoc.on("change", onSocialChange);
  unsubs.push(unsubSocial);

  // watch for messagez doc changes
  if (messagezHandle) {
    const onMessagezChange = () => {
      const doc = messagezHandle!.doc();
      if (!doc) return;
      const cif = doc.canvasInvitesFrom ?? "everyone";
      protocol.setCanvasInvitesFrom(cif);
    };
    messagezHandle.on("change", onMessagezChange);
    unsubs.push(() => messagezHandle!.off("change", onMessagezChange));
  }

  // auto-connect to friends' node IDs
  const friends = sDoc.current.friends ?? [];
  for (const friend of friends as any[]) {
    const nodeIds = friend.nodeIds ?? [];
    for (const n of nodeIds) {
      if (n.nodeId && n.nodeId !== localNodeId) {
        irohAdapter.addPeer(n.nodeId).catch(() => {
          // silent — peer may be offline
        });
      }
    }
  }

  // start heartbeat (which sends presence + profile to connected peers)
  protocol.startHeartbeat(() => {
    const fs = sDoc.current.friends ?? [];
    const ids: string[] = [];
    for (const f of fs as any[]) {
      for (const n of f.nodeIds ?? []) {
        if (n.nodeId && n.nodeId !== localNodeId) ids.push(n.nodeId);
      }
    }
    return ids;
  });

  // TODO: relay pending canvas invites when a peer connects
  // (needs onPeerConnected callback on FriendzProtocol or an equivalent mechanism)

  // sent friend request tracking is handled by setOutboundRequestHook above

  // request profiles from connected friends on social doc change
  const friendsForProfiles = sDoc.current.friends ?? [];
  for (const friend of friendsForProfiles as any[]) {
    const nodeIds = friend.nodeIds ?? [];
    for (const n of nodeIds) {
      if (n.nodeId && n.nodeId !== localNodeId) {
        protocol.requestProfile(n.nodeId).catch(() => {
          // silent
        });
      }
    }
  }

  // periodically retry failed peer connections
  const unsubReconnect = irohAdapter.onConnectionStateChange(() => {
    // just trigger a re-render — the connection status widget reads live state
  });
  unsubs.push(unsubReconnect);

  // add protocol destroy to unsubs
  unsubs.push(() => protocol.destroy());

  return {
    protocol,
    socialDoc: sDoc,
    messagezDocHandle: messagezHandle,
    unsubs,
  };
}
