import type { DocHandle, DocumentId, Repo } from "@automerge/automerge-repo";
import type { CanvasDocument } from "../canvas/canvas-doc";
import type { CanvasStore } from "../canvas/canvas-store";
import {
  FriendzProtocol,
  type CanvasActivityEntry,
  type GossipDigestMessage,
} from "../p2p/friends-protocol";
import { initBridge, setOutboundRequestHook } from "../p2p/friendz-bridge";
import { getMiddenNode, getStoredIdentity } from "../p2p/identity";
import {
  FRIENDZ_ALPN,
  type IrohNetworkAdapter,
  type MiddenStreamNode,
} from "../p2p/iroh-network-adapter";

import type { SocialState } from "../../widgets/narthex/social/schema";
import type { SocialDoc } from "../../widgets/narthex/social/types";
import { handleFreqholeStream } from "../p2p/freqhole-handler";
import { isTauriMode, TauriStreamNode } from "../p2p/tauri-transport";

export interface FriendzWiringDeps {
  repo: Repo;
  irohAdapter: IrohNetworkAdapter;
  store: CanvasStore;
  narthexDocId: string;
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
  const { repo, irohAdapter, store, narthexDocId, socialWidgetId, messagezWidgetId } = deps;

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
      return friends.some((f: any) => f.nodeIds?.some((n: any) => n.nodeId === nodeId));
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

        for (const [_cardId, card] of Object.entries(narthexDoc.widgets ?? {}) as any[]) {
          if (card.type !== "canvas-card") continue;
          const canvasDocId = (card.props as any)?.canvasDocId;
          if (!canvasDocId) continue;

          let lastMod: string | null = null;

          try {
            const canvasHandle = repo.handles[canvasDocId as DocumentId];
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
                canvasDocId,
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
      const exists = draft.pendingRequests.some((r: any) => r.fromNodeId === fromNodeId);
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
      const existingFriend = draft.friends.find((f: any) =>
        f.nodeIds?.some((n: any) => n.nodeId === fromNodeId)
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
    console.log(
      "[friendz-wiring] received canvas invite from:",
      fromNodeId.slice(0, 16) + "...",
      "canvas:",
      msg.canvasDocId.slice(0, 16) + "...",
      "origin:",
      msg.originNodeId.slice(0, 16) + "...",
      "title:",
      msg.canvasTitle,
      "messagezHandle?",
      !!messagezHandle
    );

    if (!messagezHandle) {
      console.warn("[friendz-wiring] no messagez handle — cannot write invite to inbox");
      return;
    }

    messagezHandle.change((draft: any) => {
      if (!draft.invites) draft.invites = [];

      // check for existing invite for same canvas from same origin
      const currentInbox = (draft.invites ?? []) as any[];
      const alreadyHave = currentInbox.some(
        (inv: any) => inv.canvasDocId === msg.canvasDocId && inv.fromNodeId === msg.originNodeId
      );

      if (alreadyHave) {
        console.log("[friendz-wiring] duplicate invite — already in inbox, skipping");
        return;
      }

      const inviteRecord = {
        id: crypto.randomUUID(),
        canvasDocId: msg.canvasDocId,
        canvasTitle: msg.canvasTitle ?? "",
        canvasDescription: msg.canvasDescription ?? "",
        canvasColor: typeof msg.canvasColor === "number" ? msg.canvasColor : 0,
        canvasPreviewUrl: msg.canvasPreviewUrl ?? "",
        fromNodeId: msg.originNodeId,
        fromUsername: msg.originUsername ?? "unknown",
        relayedBy: fromNodeId !== msg.originNodeId ? fromNodeId : "",
        receivedAt: new Date().toISOString(),
        status: "pending" as const,
      };

      draft.invites.push(inviteRecord);
      console.log(
        "[friendz-wiring] wrote invite to inbox — total invites:",
        draft.invites.length,
        "record:",
        JSON.stringify(inviteRecord)
      );
    });

    // send ACK back to the sender
    protocol
      .sendCanvasInviteAck(fromNodeId, {
        inviteId: msg.inviteId,
        canvasDocId: msg.canvasDocId,
        ackerNodeId: localNodeId,
      })
      .catch((err) => {
        console.warn("[friendz-wiring] failed to send invite ACK:", err);
      });
  };

  protocol.onCanvasInviteAck = (msg, fromNodeId) => {
    console.log(
      "[friendz-wiring] received invite ACK from:",
      fromNodeId.slice(0, 16) + "...",
      "canvas:",
      msg.canvasDocId.slice(0, 16) + "..."
    );
    if (!messagezHandle) return;

    messagezHandle.change((draft: any) => {
      if (!draft.sentInviteAcks) draft.sentInviteAcks = [];
      draft.sentInviteAcks.push({
        inviteId: msg.inviteId,
        canvasDocId: msg.canvasDocId,
        ackerNodeId: fromNodeId,
      });
    });

    // update outbox: mark matching share as delivered
    messagezHandle.change((draft: any) => {
      if (!draft.shares) return;
      for (const share of draft.shares) {
        if (
          share.canvasDocId === msg.canvasDocId &&
          share.toNodeId === (msg.ackerNodeId || fromNodeId)
        ) {
          share.delivered = true;
        }
      }
    });
  };

  protocol.onCanvasInviteAccept = (msg, fromNodeId) => {
    console.log(
      "[friendz-wiring] received invite ACCEPT from:",
      fromNodeId.slice(0, 16) + "...",
      "canvas:",
      msg.canvasDocId.slice(0, 16) + "..."
    );
    if (!messagezHandle) return;

    messagezHandle.change((draft: any) => {
      if (!draft.shares) return;
      for (const share of draft.shares) {
        if (
          share.canvasDocId === msg.canvasDocId &&
          share.toNodeId === (msg.accepterNodeId || fromNodeId)
        ) {
          share.accepted = true;
          share.delivered = true; // accepting implies delivery
        }
      }
    });

    // clean up pendingInvites on the canvas doc — this peer has accepted
    try {
      const accepterId = msg.accepterNodeId || fromNodeId;
      const canvasHandle = repo.handles[msg.canvasDocId as any];
      if (canvasHandle) {
        canvasHandle.change((draft: any) => {
          if (draft.pendingInvites?.[accepterId]) {
            delete draft.pendingInvites[accepterId];
          }
        });
      }
    } catch {
      // best effort
    }
  };

  protocol.onCanvasInviteDecline = (msg, fromNodeId) => {
    console.log(
      "[friendz-wiring] received invite DECLINE from:",
      fromNodeId.slice(0, 16) + "...",
      "canvas:",
      msg.canvasDocId.slice(0, 16) + "..."
    );
    if (!messagezHandle) return;

    messagezHandle.change((draft: any) => {
      if (!draft.shares) return;
      for (const share of draft.shares) {
        if (
          share.canvasDocId === msg.canvasDocId &&
          share.toNodeId === (msg.declinerNodeId || fromNodeId)
        ) {
          share.declined = true;
          share.delivered = true; // declining implies delivery
        }
      }
    });

    // clean up pendingInvites on the canvas doc — this peer declined
    try {
      const declinerId = msg.declinerNodeId || fromNodeId;
      const canvasHandle = repo.handles[msg.canvasDocId as any];
      if (canvasHandle) {
        canvasHandle.change((draft: any) => {
          if (draft.pendingInvites?.[declinerId]) {
            delete draft.pendingInvites[declinerId];
          }
        });
      }
    } catch {
      // best effort
    }
  };

  // wire outbound requests through the bridge
  initBridge(protocol);

  // hook outbound request side-effects: track sent friend requests in social doc
  setOutboundRequestHook((targetNodeId: string) => {
    sDoc.change((draft: any) => {
      if (!draft.sentRequests) draft.sentRequests = [];
      const exists = draft.sentRequests.some((r: any) => r.toNodeId === targetNodeId);
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

  // --- canvas update federation (phase 2): send side ---
  // track which canvas docs we're already watching (by per-widget docId)
  const watchedCanvasWidgets = new Set<string>();
  // canvases with changes since last heartbeat flush
  const dirtyCanvases = new Map<
    string,
    { canvasDocId: string; lastModified: string; widgetCount: number }
  >();

  /** attach a change listener to the canvas doc behind a canvas-card widget. */
  function watchCanvasForFederation(widgetDocId: string): void {
    if (watchedCanvasWidgets.has(widgetDocId)) return;
    watchedCanvasWidgets.add(widgetDocId);

    // resolve canvas doc id from the per-widget doc (async, fire-and-forget)
    (async () => {
      try {
        const cardHandle = await repo.find<any>(widgetDocId as DocumentId);
        await cardHandle.whenReady();
        const cardDoc = cardHandle.doc() as Record<string, unknown> | undefined;
        const canvasDocId = cardDoc?.canvasDocId as string | undefined;
        if (!canvasDocId) return;

        let canvasHandle: DocHandle<any>;
        try {
          canvasHandle = await repo.find<CanvasDocument>(canvasDocId as DocumentId);
        } catch {
          return; // canvas not available
        }

        const onChange = () => {
          const canvasDoc = canvasHandle.doc() as CanvasDocument | undefined;
          if (!canvasDoc) return;

          // only gossip our own edits — prevents amplification of remote syncs
          if (canvasDoc.lastModifiedBy && canvasDoc.lastModifiedBy !== localNodeId) return;

          // count widgets and find latest modification timestamp
          let widgetCount = 0;
          let lastMod = canvasDoc.lastModified ?? "";
          for (const [, w] of Object.entries(canvasDoc.widgets ?? {}) as any[]) {
            widgetCount++;
            if (w.lastModifiedAt && w.lastModifiedAt > lastMod) {
              lastMod = w.lastModifiedAt;
            }
          }

          dirtyCanvases.set(canvasDocId, {
            canvasDocId,
            lastModified: lastMod,
            widgetCount,
          });
        };

        canvasHandle.on("change", onChange);
        unsubs.push(() => canvasHandle.off("change", onChange));
      } catch (err) {
        console.warn("[friendz-wiring] failed to watch canvas for federation:", err);
      }
    })();
  }

  // attach watchers to existing canvas-card widgets
  const widgets = store.handle.doc()?.widgets ?? {};
  for (const [_id, widget] of Object.entries(widgets) as any[]) {
    if (!widget?.docId) continue;
    if (widget.type !== "canvas-card") continue;
    watchCanvasForFederation(widget.docId);
  }

  // watch for new canvas cards being added
  store.handle.on("change", () => {
    const doc = store.handle.doc();
    if (!doc) return;

    for (const [_id, widget] of Object.entries(doc.widgets ?? {}) as any[]) {
      if (!widget?.docId) continue;
      if (widget.type !== "canvas-card") continue;
      watchCanvasForFederation(widget.docId);
    }
  });

  // narthex doc metadata sync
  {
    const narthexHandle = await repo.find<any>(narthexDocId as DocumentId);
    const narthexDoc = narthexHandle.doc();

    if (narthexDoc) {
      // sync card props from canvas docs into narthex card metadata
      for (const [_cardId, card] of Object.entries(narthexDoc.widgets ?? {}) as any[]) {
        if (!card?.docId) continue;

        try {
          const cardHandle = await repo.find<any>(card.docId as DocumentId);
          const cardDoc = cardHandle.doc();

          if (cardDoc) {
            const lastVisited = cardDoc.lastVisitedAt as string | undefined;
            const currentKnown = card.lastVisitedAt;
            if (lastVisited && (!currentKnown || lastVisited > currentKnown)) {
              narthexHandle.change((draft: any) => {
                if (draft.widgets?.[_cardId]) {
                  draft.widgets[_cardId].lastVisitedAt = lastVisited;
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

  protocol.onAfterHeartbeatTick = (friendNodeIds: string[]) => {
    // flush dirty canvas updates to peers who share each canvas
    if (dirtyCanvases.size > 0) {
      const localUsername = sDoc.current.profile?.username ?? "anonymous";
      const onlineFriends = new Set(friendNodeIds.filter((id) => protocol.isOnline(id)));

      for (const [, info] of dirtyCanvases) {
        // look up who shares this canvas from the CanvasDocument.peers field
        try {
          const canvasHandle = repo.handles[info.canvasDocId as any];
          const canvasDoc = canvasHandle?.doc() as CanvasDocument | undefined;
          const peers = canvasDoc?.peers ?? {};

          for (const peerNodeId of Object.keys(peers)) {
            if (peerNodeId === localNodeId) continue;
            if (!onlineFriends.has(peerNodeId)) continue;

            protocol
              .sendCanvasUpdate(peerNodeId, {
                canvasDocId: info.canvasDocId,
                lastModifiedAt: info.lastModified,
                widgetCount: info.widgetCount,
                modifiedByNodeId: localNodeId,
                modifiedByUsername: localUsername,
              })
              .catch((err) => {
                console.warn(
                  "[friendz-wiring] canvas update send failed for:",
                  peerNodeId.slice(0, 16) + "...",
                  err
                );
              });
          }
        } catch (err) {
          console.warn(
            "[friendz-wiring] failed to flush canvas update:",
            info.canvasDocId.slice(0, 16) + "...",
            err
          );
        }
      }

      dirtyCanvases.clear();
    }
  };

  /** compute and send a gossip digest to a peer that just came online.
   *  scans local canvas docs for shared canvases with updates and pending invites. */
  async function computeAndSendGossipDigest(peerNodeId: string): Promise<void> {
    const canvasUpdates: GossipDigestMessage["canvasUpdates"] = [];
    const pendingInvites: GossipDigestMessage["pendingInvites"] = [];

    const narthexHandle = repo.handles[narthexDocId as any];
    const narthexDoc = narthexHandle?.doc();
    if (!narthexDoc?.widgets) return;

    for (const [_cardId, card] of Object.entries(narthexDoc.widgets) as any[]) {
      if (card.type !== "canvas-card") continue;
      const canvasDocId = (card.props as any)?.canvasDocId;
      if (!canvasDocId) continue;

      try {
        const canvasHandle = repo.handles[canvasDocId as any];
        const canvasDoc = canvasHandle?.doc() as CanvasDocument | undefined;
        if (!canvasDoc) continue;

        // check for canvas updates: peer is on this canvas and has stale state
        const peerEntry = canvasDoc.peers?.[peerNodeId];
        if (peerEntry) {
          const peerLastSeen = peerEntry.lastSeenAt ?? "";
          if (canvasDoc.lastModified && canvasDoc.lastModified > peerLastSeen) {
            canvasUpdates.push({
              canvasDocId,
              lastModifiedAt: canvasDoc.lastModified,
              lastModifiedBy: canvasDoc.lastModifiedBy ?? "",
            });
          }
        }

        // check for pending invites targeting this peer
        const pendingInvite = canvasDoc.pendingInvites?.[peerNodeId];
        if (pendingInvite && !canvasDoc.peers?.[peerNodeId]) {
          pendingInvites.push({
            canvasDocId,
            canvasTitle: canvasDoc.title ?? "",
            canvasDescription: canvasDoc.description ?? "",
            canvasColor: canvasDoc.color ?? 0,
            canvasPreviewUrl: canvasDoc.previewUrl ?? "",
            invitedBy: pendingInvite.invitedBy,
            invitedByUsername: pendingInvite.invitedByUsername ?? "",
            role: pendingInvite.role,
            invitedAt: pendingInvite.invitedAt,
          });
        }
      } catch {
        // canvas doc not synced yet — skip
      }
    }

    if (canvasUpdates.length === 0 && pendingInvites.length === 0) return;

    console.log(
      "[friendz-wiring] sending gossip digest to:",
      peerNodeId.slice(0, 16) + "...",
      "updates:",
      canvasUpdates.length,
      "invites:",
      pendingInvites.length
    );

    await protocol.sendGossipDigest(peerNodeId, { canvasUpdates, pendingInvites });
  }

  // send a gossip digest when a friend peer transitions to online.
  // this fires on BOTH sides of the heartbeat handshake, making the exchange
  // bidirectional — each peer tells the other about canvas updates and pending invites.
  protocol.onPeerBecameOnline = (peerNodeId: string) => {
    const friends = sDoc.current.friends ?? [];
    const isFriend = friends.some((f: any) => f.nodeIds?.some((n: any) => n.nodeId === peerNodeId));
    if (!isFriend) return;

    computeAndSendGossipDigest(peerNodeId).catch((err) => {
      console.warn(
        "[friendz-wiring] gossip digest failed for:",
        peerNodeId.slice(0, 16) + "...",
        err
      );
    });
  };

  // handle incoming canvas update notifications
  protocol.onCanvasUpdate = (msg, _fromNodeId) => {
    // filter out our own updates (we already see them locally)
    if (msg.modifiedByNodeId === localNodeId) return;

    // check if we're currently viewing this canvas — if so, suppress
    const currentHash = window.location.hash.replace(/^#/, "");
    if (currentHash === msg.canvasDocId) return;

    // find the canvas card in the narthex and mark hasUpdates
    try {
      const narthexHandle = repo.handles[narthexDocId as any];
      const narthexDoc = narthexHandle?.doc();
      if (!narthexDoc?.widgets) return;

      for (const [_cardId, card] of Object.entries(narthexDoc.widgets) as any[]) {
        if (card?.props?.canvasDocId === msg.canvasDocId && card.docId) {
          // update the per-widget doc (where the canvas-card reads hasUpdates from)
          const cardHandle = repo.handles[card.docId as any];
          if (cardHandle) {
            cardHandle.change((draft: any) => {
              draft.hasUpdates = true;
              draft.lastKnownModifiedAt = msg.lastModifiedAt;
              draft.lastModifiedBy = msg.modifiedByNodeId;
            });
          }
          break;
        }
      }
    } catch (err) {
      console.warn("[friendz-wiring] failed to mark canvas update:", err);
    }
  };

  // handle incoming gossip digests from peers that just came online
  protocol.onGossipDigest = (msg, fromNodeId) => {
    // process canvas update notifications
    for (const update of msg.canvasUpdates) {
      // skip our own edits
      if (update.lastModifiedBy === localNodeId) continue;

      // skip if currently viewing this canvas
      const currentHash = window.location.hash.replace(/^#/, "");
      if (currentHash === update.canvasDocId) continue;

      // find the narthex card and mark hasUpdates
      try {
        const narthexHandle = repo.handles[narthexDocId as any];
        const narthexDoc = narthexHandle?.doc();
        if (!narthexDoc?.widgets) continue;

        for (const [_cardId, card] of Object.entries(narthexDoc.widgets) as any[]) {
          if (card?.props?.canvasDocId === update.canvasDocId && card.docId) {
            const cardHandle = repo.handles[card.docId as any];
            if (cardHandle) {
              cardHandle.change((draft: any) => {
                draft.hasUpdates = true;
                draft.lastKnownModifiedAt = update.lastModifiedAt;
                draft.lastModifiedBy = update.lastModifiedBy;
              });
            }
            break;
          }
        }
      } catch {
        // best effort
      }
    }

    // process pending invite notifications
    for (const invite of msg.pendingInvites) {
      if (!messagezHandle) continue;

      // write to inbox (same logic as onCanvasInvite but from digest data)
      messagezHandle.change((draft: any) => {
        if (!draft.invites) draft.invites = [];

        const currentInbox = (draft.invites ?? []) as any[];
        const alreadyHave = currentInbox.some(
          (inv: any) =>
            inv.canvasDocId === invite.canvasDocId && inv.fromNodeId === invite.invitedBy
        );
        if (alreadyHave) return;

        draft.invites.push({
          id: crypto.randomUUID(),
          canvasDocId: invite.canvasDocId,
          canvasTitle: invite.canvasTitle ?? "",
          canvasDescription: invite.canvasDescription ?? "",
          canvasColor: typeof invite.canvasColor === "number" ? invite.canvasColor : 0,
          canvasPreviewUrl: invite.canvasPreviewUrl ?? "",
          fromNodeId: invite.invitedBy,
          fromUsername: invite.invitedByUsername ?? "unknown",
          relayedBy: fromNodeId,
          receivedAt: new Date().toISOString(),
          status: "pending" as const,
        });

        console.log(
          "[friendz-wiring] gossip digest: wrote invite to inbox for canvas:",
          invite.canvasDocId.slice(0, 16) + "..."
        );
      });
    }
  };

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
