import { Repo, type DocHandle, type DocumentId } from "@automerge/automerge-repo";
import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import { createTestRegistry } from "../../widgets/index";
import { createNarthexRegistry } from "../../widgets/narthex/index";
import { CanvasStore } from "../canvas/canvas-store";
import type { ConnectionStateSource } from "../canvas/connection-status";
import { initCanvas, type SkeinCanvas } from "../canvas/init";
import { showShareDialog } from "../canvas/share-dialog";
import { FriendzProtocol } from "../p2p/friends-protocol";
import { destroyBridge, initBridge } from "../p2p/friendz-bridge";
import { ensureIdentity, getMiddenNode, getStoredIdentity } from "../p2p/identity";
import {
  FRIENDZ_ALPN,
  IrohNetworkAdapter,
  type MiddenStreamNode,
} from "../p2p/iroh-network-adapter";
import { decodeShareString, encodeShareString } from "../p2p/share-string";
import { getMetaValue, setMetaValue } from "../storage/meta-db";

// well-known singleton widget IDs — must match the singletonId in each factory's metadata
const PROFILE_WIDGET_ID = "skein-profile";
const FRIENDS_WIDGET_ID = "skein-friends";

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

  /** adapter connection state source for the ConnectionStatus widget */
  private readonly connectionStateSource: ConnectionStateSource;

  constructor(mountElement: HTMLElement) {
    this.mountElement = mountElement;

    // shared automerge repo — one repo for all canvases and the narthex.
    // cross-tab sync via BroadcastChannel, cross-device sync via iroh QUIC.
    const storage = new IndexedDBStorageAdapter();
    this.irohAdapter = new IrohNetworkAdapter(
      async () => (await getMiddenNode()) as unknown as MiddenStreamNode
    );
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
      // first boot — create the narthex canvas document
      const narthexStore = CanvasStore.create(this.repo);
      this.narthexDocId = narthexStore.handle.documentId;
      await setMetaValue(NARTHEX_DOC_KEY, this.narthexDocId);
      console.log("[skein] first boot — created narthex doc:", this.narthexDocId);

      // seed with a big pink cursive "narthex" title label in the center
      narthexStore.addWidget({
        id: crypto.randomUUID(),
        type: "label",
        x: 80,
        y: 30,
        width: 600,
        height: 160,
        zIndex: 0,
        props: {
          text: "narthex",
          textColor: 0xd946ef,
          bgColor: -1,
          borderColor: -1,
          fontFamily: "cursive",
        },
        collapsed: false,
        docId: null,
      });

      // seed with a profile widget in the top-right area
      narthexStore.addWidget({
        id: PROFILE_WIDGET_ID,
        type: "profile",
        x: 700,
        y: 30,
        width: 280,
        height: 360,
        zIndex: 1,
        props: {},
        collapsed: false,
        docId: null,
      });

      // seed with a friends widget below the profile
      narthexStore.addWidget({
        id: FRIENDS_WIDGET_ID,
        type: "friends",
        x: 700,
        y: 410,
        width: 280,
        height: 400,
        zIndex: 2,
        props: {},
        collapsed: false,
        docId: null,
      });
    } else {
      console.log("[skein] found existing narthex doc:", this.narthexDocId);

      // ensure singleton widgets exist — they may have been lost due to a
      // bug or schema migration. re-seed with fresh docs if missing.
      const existingStore = await CanvasStore.open(this.repo, this.narthexDocId as DocumentId);
      const widgets = existingStore.doc().widgets;

      if (!widgets[PROFILE_WIDGET_ID]) {
        console.log("[skein] re-seeding missing profile widget");
        existingStore.addWidget({
          id: PROFILE_WIDGET_ID,
          type: "profile",
          x: 700,
          y: 30,
          width: 280,
          height: 360,
          zIndex: Object.keys(widgets).length + 1,
          props: {},
          collapsed: false,
          docId: null,
        });
      }

      if (!widgets[FRIENDS_WIDGET_ID]) {
        console.log("[skein] re-seeding missing friends widget");
        existingStore.addWidget({
          id: FRIENDS_WIDGET_ID,
          type: "friends",
          x: 700,
          y: 410,
          width: 280,
          height: 400,
          zIndex: Object.keys(widgets).length + 2,
          props: {},
          collapsed: false,
          docId: null,
        });
      }
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

      const canvas = await initCanvas({
        mountElement: this.mountElement,
        canvasDocId: this.narthexDocId,
        registry: createNarthexRegistry(),
        repo: this.repo,
        isNarthex: true,
      });

      this.currentCanvas = canvas;
      (window as any).__skein = canvas;

      // initialize the friends protocol (reads friends/profile docs)
      this.initFriendzProtocol().catch((err) => {
        console.warn("[skein] failed to initialize friendz protocol:", err);
      });

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

      // sync fresh metadata from canvas documents into their narthex cards.
      // runs asynchronously after the narthex is mounted so it doesn't block render.
      this.syncCanvasMetadataToCards(canvas.store).catch((err) => {
        console.warn("[skein] metadata sync failed:", err);
      });
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

    const identity = await getStoredIdentity();
    if (!identity) return;

    const store = this.currentCanvas?.store;
    if (!store) return;

    // look up the friends widget's automerge doc
    const friendsEntry = store.getWidget(FRIENDS_WIDGET_ID);
    if (!friendsEntry?.docId) {
      console.log("[skein] friends widget doc not ready yet — deferring protocol init");
      return;
    }

    const friendsHandle = await this.repo.find<any>(friendsEntry.docId as DocumentId);
    await friendsHandle.whenReady();

    // look up the profile widget's automerge doc
    const profileEntry = store.getWidget(PROFILE_WIDGET_ID);
    let profileHandle: DocHandle<any> | null = null;
    if (profileEntry?.docId) {
      profileHandle = await this.repo.find<any>(profileEntry.docId as DocumentId);
      await profileHandle.whenReady();
    }

    // read initial privacy settings from friends doc
    const friendsDoc = friendsHandle.doc() as Record<string, unknown> | undefined;
    const profileVisibility = (friendsDoc?.profileVisibility as string) ?? "friends";
    const friendRequestsFrom = (friendsDoc?.friendRequestsFrom as string) ?? "everyone";

    this.friendzProtocol = new FriendzProtocol({
      getMidden: async () => (await getMiddenNode()) as unknown as MiddenStreamNode,
      localNodeId: identity.node_id,
      localUsername:
        ((profileHandle?.doc() as Record<string, unknown> | undefined)?.username as string) ?? "",
      getLocalProfile: () => {
        const doc = profileHandle?.doc() as Record<string, unknown> | undefined;
        return {
          username: (doc?.username as string) ?? "",
          bio: (doc?.bio as string) ?? "",
          avatarDataUrl: (doc?.avatarDataUrl as string) ?? "",
        };
      },
      isFriend: (nodeId: string) => {
        const doc = friendsHandle.doc() as
          | { friends?: Array<{ nodeIds?: Array<{ nodeId: string }> }> }
          | undefined;
        return doc?.friends?.some((f) => f.nodeIds?.some((n) => n.nodeId === nodeId)) ?? false;
      },
      profileVisibility: profileVisibility as "friends" | "everyone" | "nobody",
      friendRequestsFrom: friendRequestsFrom as "everyone" | "nobody",
    });

    // register ALPN handler for incoming friendz streams
    this.irohAdapter.registerAlpnHandler(FRIENDZ_ALPN, (stream) => {
      this.friendzProtocol!.handleStream(stream);
    });

    // --- wire event callbacks ---

    // incoming friend request → write to friends doc
    this.friendzProtocol.onFriendRequest = (msg, fromNodeId) => {
      friendsHandle.change((draft: any) => {
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
    };

    // friend accept → remote peer accepted our outgoing request, add them as friend
    this.friendzProtocol.onFriendAccept = (msg, fromNodeId) => {
      friendsHandle.change((draft: any) => {
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
      console.log("[skein] friend request accepted by:", fromNodeId.slice(0, 16) + "...");
    };

    // friend reject → update request status (informational)
    this.friendzProtocol.onFriendReject = (_msg, fromNodeId) => {
      console.log("[skein] friend request rejected by:", fromNodeId.slice(0, 16) + "...");
    };

    // profile response → update the friend's nodeId entry with profile data
    this.friendzProtocol.onProfileResponse = (profile, fromNodeId) => {
      friendsHandle.change((draft: any) => {
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

    // heartbeat → update lastSeenAt on the friend's nodeId entry
    this.friendzProtocol.onHeartbeat = (heartbeat, fromNodeId) => {
      friendsHandle.change((draft: any) => {
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
    };

    // watch friends doc for privacy setting changes
    const onFriendsChange = () => {
      const doc = friendsHandle.doc() as Record<string, unknown> | undefined;
      if (!doc || !this.friendzProtocol) return;
      const pv = (doc.profileVisibility as string) ?? "friends";
      const frf = (doc.friendRequestsFrom as string) ?? "everyone";
      this.friendzProtocol.setProfileVisibility(pv as "friends" | "everyone" | "nobody");
      this.friendzProtocol.setFriendRequestsFrom(frf as "everyone" | "nobody");
    };
    friendsHandle.on("change", onFriendsChange);
    this.friendzDocUnsubs.push(() => friendsHandle.off("change", onFriendsChange));

    // watch profile doc for username changes
    if (profileHandle) {
      const onProfileChange = () => {
        const doc = profileHandle!.doc() as Record<string, unknown> | undefined;
        if (doc?.username && typeof doc.username === "string") {
          this.friendzProtocol?.setLocalUsername(doc.username);
        }
      };
      profileHandle.on("change", onProfileChange);
      this.friendzDocUnsubs.push(() => profileHandle!.off("change", onProfileChange));
    }

    // start heartbeat — getter reads the current friends list from the doc
    this.friendzProtocol.startHeartbeat(() => {
      const doc = friendsHandle.doc() as
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

    // initialize the bridge so widgets can use the protocol
    initBridge(this.friendzProtocol);

    console.log("[skein] friendz protocol initialized");
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

          showShareDialog({
            app: this.currentCanvas.app,
            theme: this.currentCanvas.theme,
            shareString: shareStr,
            shareUrl,
            peers: peerList,
            onRemovePeer: (nodeId: string) => {
              // remove from canvas doc
              this.currentCanvas?.store.removePeer(nodeId);
              // tell the adapter to stop reconnecting to this peer
              this.irohAdapter.forgetPeer(nodeId);
              console.log("[skein] revoked access for peer:", nodeId.slice(0, 16) + "...");
            },
          });
        },
      });

      this.currentCanvas = canvas;
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
   * sync canvas metadata back to narthex canvas-card widgets.
   * called when navigating back to the narthex — iterates all canvas-card
   * widgets, opens their linked canvas documents, and copies fresh metadata
   * (title, description, lastModified) into the card's per-widget doc.
   */
  private async syncCanvasMetadataToCards(narthexStore: CanvasStore): Promise<void> {
    const widgets = narthexStore.allWidgets();

    for (const entry of widgets) {
      if (entry.type !== "canvas-card" || !entry.docId) continue;

      try {
        // read the card's per-widget doc to get the canvasDocId
        const cardHandle = await this.repo.find(entry.docId as DocumentId);
        await cardHandle.whenReady();
        const cardDoc = cardHandle.doc() as Record<string, unknown> | undefined;
        if (!cardDoc?.canvasDocId || typeof cardDoc.canvasDocId !== "string") continue;

        // open the linked canvas document and read its metadata
        const canvasStore = await CanvasStore.open(this.repo, cardDoc.canvasDocId as DocumentId);
        const meta = canvasStore.metadata();

        // sync metadata from the canvas doc into the card's widget doc.
        // only update fields that have changed to avoid unnecessary automerge patches.
        const updates: Record<string, string> = {};
        if (meta.title && meta.title !== (cardDoc.title ?? "")) {
          updates.title = meta.title;
        }
        if (meta.description !== undefined && meta.description !== (cardDoc.description ?? "")) {
          updates.description = meta.description;
        }
        if (meta.lastModified && meta.lastModified !== (cardDoc.modifiedAt ?? "")) {
          updates.modifiedAt = meta.lastModified;
        }

        if (Object.keys(updates).length > 0) {
          cardHandle.change((d: any) => {
            for (const [key, value] of Object.entries(updates)) {
              d[key] = value;
            }
          });
          console.log("[skein] synced metadata to canvas-card:", entry.id, updates);
        }
      } catch (err) {
        // if a canvas doc isn't reachable, skip silently
        console.warn("[skein] failed to sync metadata for card:", entry.id, err);
      }
    }
  }

  /**
   * join a remote canvas via share string.
   * connects to the peer, creates a canvas-card in the narthex, and navigates.
   */
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
            createdAt: shortDate,
            modifiedAt: new Date().toISOString(),
          },
          collapsed: false,
          docId: null,
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
    authorName?: string;
    color?: number;
    wizardWidgetId?: string;
  }): Promise<void> {
    if (!this.currentCanvas || !this.narthexDocId) return;

    // read the profile username for the canvas author
    let authorName = "";
    try {
      const profileEntry = this.currentCanvas?.store.getWidget(PROFILE_WIDGET_ID);
      if (profileEntry?.docId) {
        const profileHandle = await this.repo.find(profileEntry.docId as DocumentId);
        await profileHandle.whenReady();
        const profileDoc = profileHandle.doc() as Record<string, unknown> | undefined;
        if (profileDoc?.username && typeof profileDoc.username === "string") {
          authorName = profileDoc.username;
        }
      }
    } catch {
      // if profile reading fails, fall back to empty author
      console.warn("[skein] failed to read profile for canvas author");
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
        authorName: authorName || detail?.authorName || "",
        color: detail?.color ?? 0xd946ef,
        createdAt: shortDate,
        modifiedAt: now,
      },
      collapsed: false,
      docId: null,
    });

    // navigate to the new canvas
    window.location.hash = newDocId;
  }

  /** tear down the router — destroys canvas, friendz protocol, and bridge. */
  destroy(): void {
    this.destroyCurrent();
    for (const unsub of this.friendzDocUnsubs) {
      unsub();
    }
    this.friendzDocUnsubs = [];
    if (this.friendzProtocol) {
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
