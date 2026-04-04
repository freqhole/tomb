import { Repo, type DocumentId } from "@automerge/automerge-repo";
import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import { createTestRegistry } from "../../widgets/index";
import { createNarthexRegistry } from "../../widgets/narthex/index";
import { CanvasStore } from "../canvas/canvas-store";
import { initCanvas, type SkeinCanvas } from "../canvas/init";

// well-known singleton widget IDs — must match the singletonId in each factory's metadata
const PROFILE_WIDGET_ID = "skein-profile";
const FRIENDS_WIDGET_ID = "skein-friends";

// indexeddb key for the well-known narthex document id
const NARTHEX_DOC_KEY = "skein-narthex-doc-id";
const NARTHEX_DB_NAME = "skein-meta";
const NARTHEX_STORE_NAME = "kv";

// ---------------------------------------------------------------------------
// simple key-value persistence for the narthex doc id (separate from
// automerge's indexeddb storage so we don't couple to its schema)
// ---------------------------------------------------------------------------

async function openMetaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NARTHEX_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(NARTHEX_STORE_NAME)) {
        db.createObjectStore(NARTHEX_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getMetaValue(key: string): Promise<string | null> {
  const db = await openMetaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NARTHEX_STORE_NAME, "readonly");
    const store = tx.objectStore(NARTHEX_STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve((req.result as string) ?? null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function setMetaValue(key: string, value: string): Promise<void> {
  const db = await openMetaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NARTHEX_STORE_NAME, "readwrite");
    const store = tx.objectStore(NARTHEX_STORE_NAME);
    store.put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

// ---------------------------------------------------------------------------
// router — manages navigation between the narthex and individual canvases
// ---------------------------------------------------------------------------

class SkeinRouter {
  private readonly mountElement: HTMLElement;
  private readonly repo: Repo;
  private currentCanvas: SkeinCanvas | null = null;
  private narthexDocId: string | null = null;
  private navigating = false;

  constructor(mountElement: HTMLElement) {
    this.mountElement = mountElement;

    // shared automerge repo — one repo for all canvases and the narthex.
    // this lets cross-tab broadcast channel sync work across all docs.
    const storage = new IndexedDBStorageAdapter();
    const network = [new BroadcastChannelNetworkAdapter()];
    this.repo = new Repo({ storage, network });
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
        width: 260,
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
          width: 260,
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
      console.log(
        "[skein] narthex ready — widgets:",
        canvas.store.widgetCount(),
        "| registry:",
        canvas.registry.types().join(", ")
      );
    } finally {
      this.navigating = false;
    }
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
        onNavigateHome: () => {
          console.log("[skein] home button clicked, navigating to narthex");
          window.location.hash = "";
        },
      });

      this.currentCanvas = canvas;
      (window as any).__skein = canvas;
      console.log(
        "[skein] canvas ready — doc:",
        docId,
        "| widgets:",
        canvas.store.widgetCount(),
        "| registry:",
        canvas.registry.types().join(", ")
      );
    } finally {
      this.navigating = false;
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
    console.log(
      "[skein] creating new canvas:",
      JSON.stringify(title),
      "author:",
      JSON.stringify(authorName),
      "doc:",
      newDocId
    );

    // if the wizard widget is still on the narthex, remove it
    if (detail?.wizardWidgetId) {
      this.currentCanvas.store.removeWidget(detail.wizardWidgetId);
    }

    // add a canvas-card widget to the narthex doc pointing to the new canvas.
    // props are merged into the widget's schema defaults when the per-widget
    // automerge doc is created (see widget-manager.ts mountWidget).
    const now = new Date().toISOString().slice(0, 10);
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
        createdAt: now,
        modifiedAt: now,
      },
      collapsed: false,
      docId: null,
    });

    // navigate to the new canvas
    window.location.hash = newDocId;
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
