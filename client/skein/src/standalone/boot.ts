import { Repo, type DocHandle, type DocumentId } from "@automerge/automerge-repo";
import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import { createTestRegistry } from "../../widgets/index";
import { createNarthexRegistry } from "../../widgets/narthex/index";
import type { SocialDoc } from "../../widgets/narthex/social/types";
import type { CanvasDocument } from "../canvas/canvas-doc";
import { CanvasStore } from "../canvas/canvas-store";
import type { ConnectionStateSource } from "../canvas/connection-status";
import { initCanvas, type SkeinCanvas } from "../canvas/init";
import { showShareDialog, type FriendInfo } from "../canvas/share-dialog";
import { handleFreqholeStream } from "../p2p/freqhole-handler";
import type { FriendzProtocol } from "../p2p/friends-protocol";
import {
  destroyBridge,
  sendCanvasInvite,
  sendFriendRequest,
  setOutboundRequestHook,
} from "../p2p/friendz-bridge";
import { GossipTracker } from "../p2p/gossip-tracker";
import {
  ensureIdentity,
  getMiddenNode,
  getStoredIdentity,
  onIdentityChange,
} from "../p2p/identity";
import { IrohNetworkAdapter, type MiddenStreamNode } from "../p2p/iroh-network-adapter";
import { decodeShareString, encodeShareString } from "../p2p/share-string";
import { resolveFriendDisplay, SqliteSocialDoc } from "../p2p/sqlite-social-doc";
import { isTauriMode, TauriStreamNode } from "../p2p/tauri-transport";
import { getMetaValue, setMetaValue } from "../storage/meta-db";
import { syncCanvasMetadataToCards, watchCanvasDocsForUpdates } from "./canvas-watchers";
import { initFriendzWiring } from "./friendz-wiring";
import {
  createNarthexWithSeed,
  ensureSingletonWidgets,
  MESSAGEZ_WIDGET_ID,
  SOCIAL_WIDGET_ID,
} from "./narthex-seed";

// indexeddb key for the well-known narthex document id
const NARTHEX_DOC_KEY = "skein-narthex-doc-id";

// ---------------------------------------------------------------------------
// router — manages navigation between the narthex and individual canvases
// ---------------------------------------------------------------------------

class SkeinRouter {
  private readonly mountElement: HTMLElement;
  private readonly repo: Repo;
  private readonly irohAdapter: IrohNetworkAdapter;
  private currentCanvas: SkeinCanvas | null = null;
  private narthexDocId: string | null = null;
  private navigating = false;
  /** stashed by joinCanvasFromNarthex so navigateToCanvas can write it into the doc */
  private pendingPeerNodeId: string | null = null;

  private friendzProtocol: FriendzProtocol | null = null;
  private friendzDocUnsubs: Array<() => void> = [];
  private socialDoc: SocialDoc | null = null;
  private messagezDocHandle: DocHandle<any> | null = null;
  private gossipTracker: GossipTracker = new GossipTracker();
  private transportPresenceUnsubs: Array<() => void> = [];
  private canvasWatcherUnsubs: Array<() => void> = [];

  /** adapter connection state source for the ConnectionStatus widget */
  private readonly connectionStateSource: ConnectionStateSource;

  constructor(mountElement: HTMLElement) {
    this.mountElement = mountElement;

    // shared automerge repo — one repo for all canvases and the narthex.
    // cross-tab sync via BroadcastChannel, cross-device sync via iroh QUIC.
    const storage = new IndexedDBStorageAdapter();
    // in tauri mode, P2P goes through the rust backend's iroh endpoint.
    // in standalone browser mode, P2P goes through midden WASM.
    const getMidden = isTauriMode()
      ? async () => (await TauriStreamNode.create()) as MiddenStreamNode
      : async () => (await getMiddenNode()) as unknown as MiddenStreamNode;
    this.irohAdapter = new IrohNetworkAdapter(getMidden);
    const network = [new BroadcastChannelNetworkAdapter(), this.irohAdapter];
    this.repo = new Repo({ storage, network });

    // wrap the adapter's connection state API for the ConnectionStatus widget
    this.connectionStateSource = {
      getConnectionSummary: () => this.irohAdapter.getConnectionSummary(),
      onStateChange: (handler: () => void) => this.irohAdapter.onConnectionStateChange(handler),
      retryFailed: () => this.irohAdapter.retryFailedPeers(),
    };
  }

  /** initial boot — resolve narthex doc id then navigate to the right place */
  async boot(): Promise<void> {
    // resolve or create the narthex document id
    this.narthexDocId = await getMetaValue(NARTHEX_DOC_KEY);

    if (!this.narthexDocId) {
      // first boot — create and seed the narthex canvas document
      const narthexStore = createNarthexWithSeed(this.repo);
      this.narthexDocId = narthexStore.handle.documentId;
      await setMetaValue(NARTHEX_DOC_KEY, this.narthexDocId);
      console.log("[skein] first boot — created narthex doc:", this.narthexDocId);
    } else {
      console.log("[skein] found existing narthex doc:", this.narthexDocId);
      await ensureSingletonWidgets(this.repo, this.narthexDocId as DocumentId);
    }

    // register freqhole/1 ALPN handler early so the browser can serve blobs
    // to peers regardless of friendz protocol initialization state.
    // (friendz-wiring.ts also registers this, but that happens later and
    // only when navigating to the narthex with a valid identity.)
    if (!isTauriMode()) {
      this.irohAdapter.registerAlpnHandler("freqhole/1", handleFreqholeStream);
    }

    // listen for hash changes (browser back/forward, programmatic navigation)
    window.addEventListener("hashchange", () => {
      this.onHashChange();
    });

    // listen for the custom create-canvas event dispatched from the canvas wizard
    window.addEventListener("skein:create-canvas", ((e: CustomEvent) => {
      this.createCanvasFromNarthex(e.detail);
    }) as EventListener);

    // listen for the join-canvas event dispatched from the join-canvas wizard
    window.addEventListener("skein:join-canvas", ((e: CustomEvent) => {
      this.joinCanvasFromNarthex(e.detail).catch((err) => {
        console.error("[skein] join failed:", err);
      });
    }) as EventListener);

    // listen for accept-canvas-invite event dispatched from the inbox widget
    window.addEventListener("skein:accept-canvas-invite", ((e: CustomEvent) => {
      this.acceptCanvasInvite(e.detail).catch((err) => {
        console.warn("[skein] failed to accept canvas invite:", err);
      });
    }) as EventListener);

    // listen for widget self-removal (e.g. wizard cancel button)
    window.addEventListener("skein:remove-widget", ((e: CustomEvent) => {
      const widgetId = e.detail?.widgetId;
      if (widgetId && this.currentCanvas) {
        console.log("[skein] removing widget:", widgetId);
        this.currentCanvas.store.removeWidget(widgetId);
      }
    }) as EventListener);

    // initial navigation based on current hash
    console.log("[skein] router booted, initial hash:", JSON.stringify(window.location.hash));
    await this.onHashChange();
  }

  /** determine the target from the hash and navigate */
  private async onHashChange(): Promise<void> {
    const hash = window.location.hash.slice(1);

    if (!hash || hash === this.narthexDocId) {
      // empty hash or explicit narthex hash → go to narthex
      await this.navigateToNarthex();
    } else if (hash.startsWith("share/")) {
      // share URL — decode and join
      const decoded = decodeShareString(hash);
      if (decoded) {
        console.log(
          "[skein] share URL detected, joining canvas from:",
          decoded.nodeId.slice(0, 16) + "..."
        );
        // navigate to narthex first, then trigger join
        await this.navigateToNarthex();
        await this.joinCanvasFromNarthex({ shareString: hash });
      } else {
        console.warn("[skein] invalid share URL:", hash.slice(0, 32) + "...");
        await this.navigateToNarthex();
      }
    } else {
      // non-empty hash → open that canvas
      await this.navigateToCanvas(hash);
    }
  }

  /** tear down the current canvas if any */
  private destroyCurrent(): void {
    for (const unsub of this.transportPresenceUnsubs) unsub();
    this.transportPresenceUnsubs = [];
    for (const unsub of this.canvasWatcherUnsubs) unsub();
    this.canvasWatcherUnsubs = [];
    if (this.currentCanvas) {
      this.currentCanvas.destroy();
      this.currentCanvas = null;
    }
  }

  /** navigate to the narthex */
  private async navigateToNarthex(): Promise<void> {
    if (this.navigating) return;
    this.navigating = true;

    try {
      this.destroyCurrent();

      // clear hash for the narthex (clean URL)
      if (window.location.hash) {
        history.replaceState(null, "", window.location.pathname);
      }

      console.log("[skein] navigating to narthex, doc:", this.narthexDocId);

      // in tauri mode, create the sqlite-backed social doc early so it can
      // be shared between the social widget and the friendz protocol.
      if (isTauriMode() && !this.socialDoc) {
        try {
          this.socialDoc = await SqliteSocialDoc.create();
        } catch (err) {
          console.warn("[skein] failed to create SqliteSocialDoc:", err);
        }
      }

      const canvas = await initCanvas({
        mountElement: this.mountElement,
        canvasDocId: this.narthexDocId,
        registry: createNarthexRegistry(),
        repo: this.repo,
        isNarthex: true,
        docOverrides: this.socialDoc
          ? new Map([[SOCIAL_WIDGET_ID, this.socialDoc as any]])
          : undefined,
      });

      this.currentCanvas = canvas;
      (window as any).__skein = canvas;

      // when a canvas-card is deleted from the narthex, clean up the linked
      // canvas document and all its per-widget docs from IndexedDB.
      canvas.widgetManager.setBeforeRemoveHook(async (entry, repo) => {
        if (entry.type !== "canvas-card" || !entry.docId) return;
        try {
          const cardHandle = await repo.find(entry.docId as DocumentId);
          await cardHandle.whenReady();
          const cardDoc = cardHandle.doc() as Record<string, unknown> | undefined;
          const canvasDocId = cardDoc?.canvasDocId;
          if (!canvasDocId || typeof canvasDocId !== "string") return;

          // open the linked canvas and delete all its widget docs
          const canvasHandle = await repo.find<CanvasDocument>(canvasDocId as DocumentId);
          await canvasHandle.whenReady();
          const canvasDoc = canvasHandle.doc();
          if (canvasDoc?.widgets) {
            for (const w of Object.values(canvasDoc.widgets)) {
              if (w.docId) {
                try {
                  repo.delete(w.docId as DocumentId);
                } catch {
                  // best-effort
                }
              }
            }
          }

          // delete the canvas document itself
          repo.delete(canvasDocId as DocumentId);
          console.log(
            "[skein] cleaned up canvas and widget docs for:",
            canvasDocId.slice(0, 16) + "..."
          );
        } catch (err) {
          console.warn("[skein] failed to clean up linked canvas docs:", err);
        }
      });

      // initialize the friends protocol (reads social widget doc).
      // if no identity exists yet (first boot), the init will silently
      // no-op. we listen for identity creation and retry in that case.
      this.initFriendzProtocol().catch((err) => {
        console.warn("[skein] failed to initialize friendz protocol:", err);
      });

      // retry protocol init when the user generates an identity for the
      // first time — without this, all P2P features stay dead until reload.
      const unsubIdentity = onIdentityChange((identity) => {
        if (identity && !this.friendzProtocol) {
          console.log("[skein] identity created — retrying protocol init");
          this.initFriendzProtocol().catch((err) => {
            console.warn("[skein] deferred protocol init failed:", err);
          });
        }
      });
      this.friendzDocUnsubs.push(unsubIdentity);

      // narthex share helper isn't applicable but clear any stale one
      (window as any).__skein.share = () => {
        console.log("[skein] share is only available when viewing a canvas (not the narthex)");
      };

      console.log(
        "[skein] narthex ready — widgets:",
        canvas.store.widgetCount(),
        "| registry:",
        canvas.registry.types().join(", ")
      );

      // sync fresh metadata first, then start real-time watchers.
      // sequential order prevents the watcher from re-setting hasUpdates
      // that sync just cleared (bug: race condition when concurrent).
      // runs asynchronously after the narthex is mounted so it doesn't block render.
      (async () => {
        try {
          await syncCanvasMetadataToCards(this.repo, canvas.store);
        } catch (err) {
          console.warn("[skein] metadata sync failed:", err);
        }
        try {
          const unsubs = await watchCanvasDocsForUpdates(this.repo, canvas.store);
          this.canvasWatcherUnsubs.push(...unsubs);
        } catch (err) {
          console.warn("[skein] canvas watcher setup failed:", err);
        }
      })();
    } finally {
      this.navigating = false;
    }
  }

  /**
   * initialize the friends protocol after the narthex is loaded.
   * reads the friends and profile widget docs to wire up callbacks.
   * safe to call multiple times — no-ops if already initialized.
   */
  private async initFriendzProtocol(): Promise<void> {
    if (this.friendzProtocol) return;

    const store = this.currentCanvas?.store;
    if (!store || !this.narthexDocId) return;

    // in tauri mode, reuse the sqlite-backed social doc created during narthex init.
    // in browser mode, friendz-wiring will create its own from the automerge handle.
    const socialDoc: SocialDoc | undefined = isTauriMode()
      ? (this.socialDoc ?? undefined)
      : undefined;

    const result = await initFriendzWiring({
      repo: this.repo,
      irohAdapter: this.irohAdapter,
      store,
      narthexDocId: this.narthexDocId,
      gossipTracker: this.gossipTracker,
      socialWidgetId: SOCIAL_WIDGET_ID,
      messagezWidgetId: MESSAGEZ_WIDGET_ID,
      socialDoc,
    });

    if (!result) return;

    this.friendzProtocol = result.protocol;
    this.socialDoc = result.socialDoc;
    this.messagezDocHandle = result.messagezDocHandle;
    this.friendzDocUnsubs.push(...result.unsubs);
  }

  /** navigate to a specific canvas by document id */
  private async navigateToCanvas(docId: string): Promise<void> {
    if (this.navigating) return;
    this.navigating = true;

    try {
      this.destroyCurrent();

      // ensure the hash is set (for reload persistence)
      if (window.location.hash.slice(1) !== docId) {
        history.replaceState(null, "", `#${docId}`);
      }

      console.log("[skein] navigating to canvas:", docId);

      const canvas = await initCanvas({
        mountElement: this.mountElement,
        canvasDocId: docId,
        registry: createTestRegistry(),
        repo: this.repo,
        connectionStateSource: this.connectionStateSource,
        onNavigateHome: () => {
          console.log("[skein] home button clicked, navigating to narthex");
          window.location.hash = "";
        },
        onShare: async () => {
          if (!this.currentCanvas) return;
          const identity = await getStoredIdentity();
          if (!identity) {
            console.log("[skein] no identity — generate one first (profile widget)");
            return;
          }
          const shareStr = encodeShareString(identity.node_id, docId);
          const shareUrl = window.location.origin + window.location.pathname + "#share/" + shareStr;

          // build peer list from canvas doc (exclude self)
          const peersRecord = this.currentCanvas.store.peers();
          const peerList = Object.values(peersRecord)
            .filter((p) => p.nodeId !== identity.node_id)
            .map((p) => ({ nodeId: p.nodeId, joinedAt: p.joinedAt }));

          // build friends list for invite picker — exclude already shared
          const peerNodeIds = new Set(peerList.map((p) => p.nodeId));
          const friendsForInvite: FriendInfo[] = [];

          if (this.socialDoc) {
            const friendsState = this.socialDoc.current;

            // get already-invited node IDs from messagez outbox
            const alreadyInvited = new Set<string>();
            if (this.messagezDocHandle) {
              const inboxDoc = this.messagezDocHandle.doc() as
                | { shares?: Array<{ canvasDocId: string; toNodeId: string }> }
                | undefined;
              if (inboxDoc?.shares) {
                for (const share of inboxDoc.shares) {
                  if (share.canvasDocId === docId) {
                    alreadyInvited.add(share.toNodeId);
                  }
                }
              }
            }

            if (friendsState?.friends) {
              for (const friend of friendsState.friends) {
                if (!friend.nodeIds) continue;
                for (const n of friend.nodeIds) {
                  if (!n.nodeId) continue;
                  if (peerNodeIds.has(n.nodeId)) continue;
                  if (alreadyInvited.has(n.nodeId)) continue;

                  friendsForInvite.push({
                    friendId: friend.id,
                    username: friend.alias || n.username || friend.username || "",
                    nodeId: n.nodeId,
                    avatarDataUrl: n.avatarDataUrl,
                    isOnline: this.friendzProtocol?.isOnline(n.nodeId) ?? false,
                  });
                }
              }
            }
          }

          // build a nodeId -> display name map from friends for the peer list
          const peerDisplayNames = new Map<string, string>();
          if (this.socialDoc) {
            const state = this.socialDoc.current;
            if (state?.friends) {
              for (const friend of state.friends) {
                const name = friend.alias || friend.username || "";
                if (!name) continue;
                for (const n of friend.nodeIds) {
                  if (n.nodeId) peerDisplayNames.set(n.nodeId, name);
                }
              }
            }
          }
          showShareDialog({
            app: this.currentCanvas.app,
            theme: this.currentCanvas.theme,
            shareString: shareStr,
            shareUrl,
            peers: peerList,
            peerDisplayNames,
            onRemovePeer: (nodeId: string) => {
              // remove from canvas doc
              this.currentCanvas?.store.removePeer(nodeId);
              // tell the adapter to stop reconnecting to this peer
              this.irohAdapter.forgetPeer(nodeId);
              console.log("[skein] revoked access for peer:", nodeId.slice(0, 16) + "...");
            },
            onAddFriend: async (nodeId: string) => {
              try {
                await sendFriendRequest(nodeId);
                console.log("[skein] friend request sent to:", nodeId.slice(0, 16) + "...");
              } catch (err) {
                console.warn("[skein] failed to send friend request:", err);
              }
            },
            friends: friendsForInvite,
            onInviteFriend: async (friend: FriendInfo) => {
              if (!this.friendzProtocol || !this.currentCanvas) return;
              const localIdentity = await getStoredIdentity();
              if (!localIdentity) return;

              const canvasTitle = this.currentCanvas.store.metadata().title;
              const canvasDescription = this.currentCanvas.store.metadata().description;

              // look up color and previewUrl from the narthex canvas card
              let canvasColor = 0;
              let canvasPreviewUrl = "";
              if (this.narthexDocId) {
                try {
                  const narthexHandle = await this.repo.find<CanvasDocument>(
                    this.narthexDocId as DocumentId
                  );
                  await narthexHandle.whenReady();
                  const narthexDoc = narthexHandle.doc();
                  if (narthexDoc?.widgets) {
                    for (const entry of Object.values(narthexDoc.widgets)) {
                      if (
                        entry.type === "canvas-card" &&
                        (entry.props as any)?.canvasDocId === docId &&
                        entry.docId
                      ) {
                        const cardHandle = await this.repo.find<any>(entry.docId as DocumentId);
                        await cardHandle.whenReady();
                        const cardDoc = cardHandle.doc() as Record<string, unknown> | undefined;
                        canvasColor = (cardDoc?.color as number) ?? 0;
                        canvasPreviewUrl = (cardDoc?.previewUrl as string) ?? "";
                        break;
                      }
                    }
                  }
                } catch {
                  // canvas card lookup is best-effort
                }
              }

              const inviteId = crypto.randomUUID();
              const allTargets = [friend.nodeId];

              // send the invite via protocol
              await sendCanvasInvite(friend.nodeId, {
                inviteId,
                canvasDocId: docId,
                canvasTitle,
                canvasDescription,
                canvasColor,
                canvasPreviewUrl,
                originNodeId: localIdentity.node_id,
                originUsername: this.friendzProtocol?.getLocalUsername() ?? "",
                role: "editor",
                targets: allTargets,
                acked: [],
              });

              // write outbox entry to messagez doc
              if (this.messagezDocHandle) {
                this.messagezDocHandle.change((draft: any) => {
                  if (!draft.shares) draft.shares = [];
                  draft.shares.push({
                    id: inviteId,
                    canvasDocId: docId,
                    canvasTitle,
                    canvasDescription,
                    canvasColor,
                    canvasPreviewUrl,
                    toNodeId: friend.nodeId,
                    toUsername: friend.username,
                    sentAt: new Date().toISOString(),
                    delivered: false,
                    accepted: false,
                    declined: false,
                  });
                });
              }

              // track in gossip tracker for relay
              this.gossipTracker.track(
                inviteId,
                docId,
                canvasTitle,
                canvasDescription,
                canvasColor,
                canvasPreviewUrl,
                localIdentity.node_id,
                "",
                "editor",
                allTargets,
                []
              );

              console.log("[skein] canvas invite sent to:", friend.nodeId.slice(0, 16) + "...");
            },
          });
        },
      });

      this.currentCanvas = canvas;

      // update lastVisitedAt on the canvas card
      if (this.narthexDocId) {
        try {
          const narthexHandle = await this.repo.find<CanvasDocument>(
            this.narthexDocId as DocumentId
          );
          await narthexHandle.whenReady();
          const narthexDoc = narthexHandle.doc();
          if (narthexDoc?.widgets) {
            for (const entry of Object.values(narthexDoc.widgets)) {
              if (
                entry.type === "canvas-card" &&
                (entry.props as any)?.canvasDocId === docId &&
                entry.docId
              ) {
                const cardHandle = await this.repo.find<any>(entry.docId as DocumentId);
                await cardHandle.whenReady();
                cardHandle.change((draft: any) => {
                  draft.lastVisitedAt = new Date().toISOString();
                  draft.hasUpdates = false;
                });
                break;
              }
            }
          }
        } catch {
          // best-effort — don't block navigation
        }
      }

      // wire transport disconnect → immediate presence offline
      const unsubDisconnect = this.irohAdapter.onPeerDisconnect((nodeId) => {
        this.currentCanvas?.presenceManager.markPeerOffline(nodeId);
      });
      this.transportPresenceUnsubs.push(unsubDisconnect);

      // immediately broadcast presence when a peer reconnects
      const unsubConnect = this.irohAdapter.onPeerConnect(() => {
        this.currentCanvas?.presenceManager.broadcastOnline();
      });
      this.transportPresenceUnsubs.push(unsubConnect);

      // set up name resolver for cursor labels
      if (canvas.presenceRenderer) {
        canvas.presenceRenderer.setNameResolver((peerId: string) => {
          const state = this.socialDoc?.current;
          if (!state?.friends) return null;
          const friend = state.friends.find((f) => f.nodeIds?.some((n) => n.nodeId === peerId));
          if (!friend) return null;
          const display = resolveFriendDisplay(friend);
          return display.name || null;
        });
      }
      (window as any).__skein = canvas;

      // expose a share helper for quick testing via browser console
      (window as any).__skein.share = async () => {
        const identity = await getStoredIdentity();
        if (!identity) {
          console.log("[skein] no identity — generate one first (profile widget)");
          return;
        }
        const shareStr = encodeShareString(identity.node_id, docId);
        try {
          await navigator.clipboard.writeText(shareStr);
          console.log("[skein] share string copied to clipboard:", shareStr);
        } catch {
          console.log("[skein] share string (copy manually):", shareStr);
        }
        console.log(
          "[skein] share URL:",
          window.location.origin + window.location.pathname + "#share/" + shareStr
        );
      };

      console.log(
        "[skein] canvas ready — doc:",
        docId,
        "| widgets:",
        canvas.store.widgetCount(),
        "| registry:",
        canvas.registry.types().join(", ")
      );

      // write self (and any pending join peer) into the canvas doc so
      // connections can be re-established after page reload.
      // then reconnect to all known peers in the doc.
      this.registerAndReconnectPeers(canvas).catch((err) => {
        console.warn("[skein] peer registration/reconnection failed:", err);
      });
    } finally {
      this.navigating = false;
    }
  }

  /**
   * join a remote canvas via share string.
   * connects to the peer, creates a canvas-card in the narthex, and navigates.
   */
  /**
   * handle an accepted canvas invite from the inbox widget.
   * connects to the inviter's peer node, creates a remote canvas-card
   * on the narthex if one doesn't already exist, and navigates to the canvas.
   */
  private async acceptCanvasInvite(detail: {
    canvasDocId: string;
    fromNodeId: string;
    canvasTitle: string;
    canvasDescription: string;
    canvasColor: number;
    canvasPreviewUrl: string;
    fromUsername: string;
  }): Promise<void> {
    console.log(
      "[skein] accepting canvas invite:",
      detail.canvasDocId,
      "from peer:",
      detail.fromNodeId.slice(0, 16) + "..."
    );

    // ensure we have an identity (generates one if needed, starts midden)
    await ensureIdentity();

    // connect to the inviter's peer via the iroh adapter
    try {
      await this.irohAdapter.addPeer(detail.fromNodeId);
    } catch (err) {
      console.error("[skein] failed to connect to invite peer:", err);
      // continue anyway — the peer might become reachable later
    }

    // check if a canvas-card already exists for this docId on the narthex
    if (this.currentCanvas) {
      const existing = this.currentCanvas.store.allWidgets();
      const alreadyExists = existing.some((w) => {
        if (w.type !== "canvas-card") return false;
        return (w.props as Record<string, unknown>)?.canvasDocId === detail.canvasDocId;
      });

      if (!alreadyExists) {
        // add a remote canvas-card widget to the narthex
        const existingCount = this.currentCanvas.store.widgetCount();
        const shortDate = new Date().toISOString().slice(0, 10);

        this.currentCanvas.store.addWidget({
          id: crypto.randomUUID(),
          type: "canvas-card",
          x: 60 + (existingCount % 4) * 300,
          y: 60 + Math.floor(existingCount / 4) * 220,
          width: 280,
          height: 200,
          zIndex: existingCount + 1,
          props: {
            canvasDocId: detail.canvasDocId,
            title: detail.canvasTitle || "shared canvas",
            description: detail.canvasDescription || "",
            authorName: "",
            color: detail.canvasColor || 0x06b6d4,
            previewUrl: detail.canvasPreviewUrl || "",
            createdAt: shortDate,
            modifiedAt: new Date().toISOString(),
            // remote card fields
            isRemote: true,
            ownerNodeId: detail.fromNodeId,
            ownerUsername: detail.fromUsername || "",
            role: "editor", // invited users default to editor
            accessRevoked: false,
            lastVisitedAt: "",
          },
          collapsed: false,
          docId: null,
          parentId: null,
        });
      }
    }

    // stash the remote peer's nodeId so navigateToCanvas can write it
    // into the canvas doc reliably (no RAF race).
    this.pendingPeerNodeId = detail.fromNodeId;

    // navigate to the canvas — automerge-repo will sync it from the peer.
    window.location.hash = detail.canvasDocId;
  }

  private async joinCanvasFromNarthex(detail: {
    shareString: string;
    wizardWidgetId?: string;
  }): Promise<void> {
    const decoded = decodeShareString(detail.shareString);
    if (!decoded) {
      console.warn("[skein] invalid share string");
      return;
    }

    console.log(
      "[skein] joining canvas:",
      decoded.docId,
      "from peer:",
      decoded.nodeId.slice(0, 16) + "..."
    );

    // ensure we have an identity (generates one if needed, starts midden)
    await ensureIdentity();

    // connect to the peer via the iroh adapter
    try {
      await this.irohAdapter.addPeer(decoded.nodeId);
    } catch (err) {
      console.error("[skein] failed to connect to peer:", err);
      // continue anyway — the peer might become reachable later
    }

    // remove the join wizard widget if it was used
    if (detail.wizardWidgetId && this.currentCanvas) {
      this.currentCanvas.store.removeWidget(detail.wizardWidgetId);
    }

    // check if a canvas-card already exists for this docId
    if (this.currentCanvas) {
      const existing = this.currentCanvas.store.allWidgets();
      const alreadyExists = existing.some((w) => {
        if (w.type !== "canvas-card") return false;
        // check if the card's props have this docId
        return (w.props as Record<string, unknown>)?.canvasDocId === decoded.docId;
      });

      if (!alreadyExists) {
        // add a canvas-card widget to the narthex
        const existingCount = this.currentCanvas.store.widgetCount();
        const shortDate = new Date().toISOString().slice(0, 10);

        this.currentCanvas.store.addWidget({
          id: crypto.randomUUID(),
          type: "canvas-card",
          x: 60 + (existingCount % 4) * 300,
          y: 60 + Math.floor(existingCount / 4) * 220,
          width: 280,
          height: 200,
          zIndex: existingCount + 1,
          props: {
            canvasDocId: decoded.docId,
            title: "syncing...",
            description: "connecting to peer",
            authorName: "",
            color: 0x06b6d4, // cyan accent for remote canvases
            previewUrl: "",
            createdAt: shortDate,
            modifiedAt: new Date().toISOString(),
            // remote card fields — joining via share string
            isRemote: true,
            ownerNodeId: decoded.nodeId,
            ownerUsername: "",
            role: "viewer", // share-string joiners default to viewer
            accessRevoked: false,
            lastVisitedAt: "",
          },
          collapsed: false,
          docId: null,
          parentId: null,
        });
      }
    }

    // stash the remote peer's nodeId so navigateToCanvas can write it
    // into the canvas doc reliably (no RAF race).
    this.pendingPeerNodeId = decoded.nodeId;

    // navigate to the canvas — automerge-repo will sync it from the peer.
    // navigateToCanvas will pick up pendingPeerNodeId and write both
    // self + remote into the canvas doc's peers field.
    window.location.hash = decoded.docId;
  }

  /**
   * write self (and any pending join peer) into the canvas doc, then
   * reconnect to all known peers. this covers:
   * - first open after creating a canvas (writes self)
   * - first open after joining via share string (writes self + remote)
   * - page reload (writes self if missing, reconnects to all known peers)
   */
  private async registerAndReconnectPeers(canvas: SkeinCanvas): Promise<void> {
    const identity = await getStoredIdentity();
    if (!identity) return;

    // always write self — idempotent, ensures we're in the peer list
    canvas.store.addPeer(identity.node_id);

    // wire transport-level connectivity into the canvas store so widgets
    // can check which peers are online for smarter snatch peer selection
    canvas.store.setPeerOnlineChecker((nodeId) => this.irohAdapter.isConnected(nodeId));

    // write the remote peer from a pending join (stashed by joinCanvasFromNarthex)
    if (this.pendingPeerNodeId) {
      canvas.store.addPeer(this.pendingPeerNodeId);
      this.pendingPeerNodeId = null;
    }

    // reconnect to every peer that isn't us
    const peers = canvas.store.peers();
    const peerNodeIds = Object.keys(peers).filter((id) => id !== identity.node_id);

    if (peerNodeIds.length === 0) return;

    console.log("[skein] reconnecting to", peerNodeIds.length, "known peer(s)");

    for (const nodeId of peerNodeIds) {
      this.irohAdapter.addPeer(nodeId).catch((err) => {
        console.warn("[skein] failed to reconnect to peer:", nodeId.slice(0, 16) + "...", err);
      });
    }
  }

  /**
   * create a new canvas and add a canvas-card widget to the narthex.
   * accepts optional detail from the canvas wizard with pre-filled metadata.
   * then navigate to the newly created canvas.
   */
  private async createCanvasFromNarthex(detail?: {
    title?: string;
    description?: string;
    color?: number;
    previewUrl?: string;
    wizardWidgetId?: string;
  }): Promise<void> {
    if (!this.currentCanvas || !this.narthexDocId) return;

    // read the profile username for the canvas author
    let authorName = "";
    if (this.socialDoc) {
      authorName = this.socialDoc.current.profile?.username ?? "";
    } else {
      // protocol not initialized yet — try reading automerge doc directly
      try {
        const socialEntry = this.currentCanvas?.store.getWidget(SOCIAL_WIDGET_ID);
        if (socialEntry?.docId) {
          const socialHandle = await this.repo.find(socialEntry.docId as DocumentId);
          await socialHandle.whenReady();
          const socialDoc = socialHandle.doc() as Record<string, any> | undefined;
          if (socialDoc?.profile?.username && typeof socialDoc.profile.username === "string") {
            authorName = socialDoc.profile.username;
          }
        }
      } catch {
        console.warn("[skein] failed to read profile for canvas author");
      }
    }

    // create a new empty canvas document in the shared repo
    const newStore = CanvasStore.create(this.repo);
    const newDocId = newStore.handle.documentId;

    const title = detail?.title || "untitled canvas";
    const now = new Date().toISOString();
    console.log(
      "[skein] creating new canvas:",
      JSON.stringify(title),
      "author:",
      JSON.stringify(authorName),
      "doc:",
      newDocId
    );

    // seed the canvas document with metadata so it's available to
    // other peers and for navigate-back sync
    newStore.setTitle(title);
    if (detail?.description) {
      newStore.setDescription(detail.description);
    }
    newStore.setCreatedAt(now);

    // set color on the canvas document (source of truth for metadata)
    if (detail?.color) {
      newStore.setColor(detail.color);
    }

    // seed a canvas-info widget so every new canvas has one by default.
    // uses the singleton pattern — placed in the top-left corner.
    newStore.addWidget({
      id: "canvas-info",
      type: "canvas-info",
      x: 20,
      y: 20,
      width: 280,
      height: 340,
      zIndex: 0,
      props: {},
      collapsed: false,
      docId: null,
      parentId: null,
    });

    // if the wizard widget is still on the narthex, remove it
    if (detail?.wizardWidgetId) {
      this.currentCanvas.store.removeWidget(detail.wizardWidgetId);
    }

    // add a canvas-card widget to the narthex doc pointing to the new canvas.
    // props are merged into the widget's schema defaults when the per-widget
    // automerge doc is created (see widget-manager.ts mountWidget).
    const shortDate = now.slice(0, 10);
    const cardId = crypto.randomUUID();
    const existingCount = this.currentCanvas.store.widgetCount();

    this.currentCanvas.store.addWidget({
      id: cardId,
      type: "canvas-card",
      x: 60 + (existingCount % 4) * 300,
      y: 60 + Math.floor(existingCount / 4) * 220,
      width: 280,
      height: 200,
      zIndex: existingCount + 1,
      props: {
        canvasDocId: newDocId,
        title,
        description: detail?.description || "",
        previewUrl: detail?.previewUrl || "",
        authorName,
        color: detail?.color ?? 0xd946ef,
        createdAt: shortDate,
        modifiedAt: now,
      },
      collapsed: false,
      docId: null,
      parentId: null,
    });

    // navigate to the new canvas
    window.location.hash = newDocId;
  }

  /** tear down the router — destroys canvas, friendz protocol, and bridge. */
  destroy(): void {
    this.destroyCurrent();
    for (const unsub of this.canvasWatcherUnsubs) unsub();
    this.canvasWatcherUnsubs = [];
    if (
      this.socialDoc &&
      "destroy" in this.socialDoc &&
      typeof (this.socialDoc as any).destroy === "function"
    ) {
      (this.socialDoc as any).destroy();
    }
    this.socialDoc = null;
    this.messagezDocHandle = null;
    this.gossipTracker.clear();
    for (const unsub of this.friendzDocUnsubs) {
      unsub();
    }
    this.friendzDocUnsubs = [];
    if (this.friendzProtocol) {
      setOutboundRequestHook(null);
      destroyBridge();
      this.friendzProtocol.destroy();
      this.friendzProtocol = null;
    }
  }
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  const mountElement = document.getElementById("canvas-root");
  if (!mountElement) {
    throw new Error("mount element #canvas-root not found");
  }

  const router = new SkeinRouter(mountElement);
  (window as any).__skeinRouter = router;
  await router.boot();
}

boot().catch((err) => {
  console.error("skein boot failed:", err);
  const root = document.getElementById("canvas-root");
  if (root) {
    root.className = "boot-error";
    root.textContent = `failed to start: ${err instanceof Error ? err.message : String(err)}`;
  }
});
