import type { DocumentId, NetworkAdapter, StorageAdapter } from "@automerge/automerge-repo";
import { Repo } from "@automerge/automerge-repo";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import { Application, Container, Graphics } from "pixi.js";
import type { SkeinTheme } from "../theme/skein-theme";
import { defaultTheme } from "../theme/skein-theme";
import { KeyboardDriver } from "../widgets/keyboard-driver";
import type { WidgetRegistry } from "../widgets/widget-registry";
import { CanvasStore } from "./canvas-store";
import { ConnectionStatus } from "./connection-status";
import { InputRouter } from "./input-router";
import { PresenceManager } from "./presence-manager";
import { PresenceRenderer } from "./presence-renderer";
import { Toolbar } from "./toolbar";
import { Viewport } from "./viewport";
import { WidgetManager } from "./widget-manager";

export interface InitCanvasOptions {
  /** DOM element to mount the PixiJS canvas into */
  mountElement: HTMLElement;
  /** existing canvas document ID to open, or null to create new */
  canvasDocId: string | null;
  /** widget factory registry */
  registry: WidgetRegistry;
  /** optional network adapter (BroadcastChannel for tests, iroh for prod) */
  networkAdapter?: NetworkAdapter;
  /** optional storage adapter (defaults to IndexedDB) */
  storageAdapter?: StorageAdapter;
  /** optional theme overrides */
  theme?: Partial<SkeinTheme>;
}

export interface SkeinCanvas {
  /** the canvas store for reading/mutating the canvas document */
  store: CanvasStore;
  /** the widget registry */
  registry: WidgetRegistry;
  /** the widget manager that bridges store data to pixi rendering */
  widgetManager: WidgetManager;
  /** the input router for mode switching and selection */
  inputRouter: InputRouter;
  /** the toolbar (pixi-rendered, top-center of stage) */
  toolbar: Toolbar;
  /** the keyboard driver for text input / IME (hidden textarea proxy) */
  keyboard: KeyboardDriver;
  /** the viewport for pan/zoom control */
  viewport: Viewport;
  /** the world container that holds all widgets (affected by pan/zoom) */
  world: Container;
  /** the presence manager for multiplayer cursor/lock/selection state */
  presenceManager: PresenceManager;
  /** the presence renderer for remote peer cursors */
  presenceRenderer: PresenceRenderer;
  /** the connection status indicator (peer count pill) */
  connectionStatus: ConnectionStatus;
  /** the PixiJS application instance */
  app: Application;
  /** the resolved theme */
  theme: SkeinTheme;
  /** the automerge repo */
  repo: Repo;
  /** this peer's unique id (from the automerge repo) */
  peerId: string;
  /** tear down the canvas (cleanup pixi, widgets, toolbar, viewport, presence, input router) */
  destroy: () => void;
}

/**
 * initialize a skein canvas. this is the single entry point --
 * one linear async function, no polling, no globals, no timeouts.
 *
 * call this once. it returns a SkeinCanvas handle with everything
 * you need to interact with the canvas. call handle.destroy() to clean up.
 */
export async function initCanvas(options: InitCanvasOptions): Promise<SkeinCanvas> {
  const {
    mountElement,
    canvasDocId,
    registry,
    networkAdapter,
    storageAdapter,
    theme: themeOverrides,
  } = options;

  // step 1: resolve theme by merging overrides onto defaults
  const theme: SkeinTheme = { ...defaultTheme, ...themeOverrides };

  // step 2: create automerge repo
  const storage = storageAdapter ?? new IndexedDBStorageAdapter();
  const network = networkAdapter ? [networkAdapter] : [];
  const repo = new Repo({ storage, network });

  // step 3: load or create canvas document
  let store: CanvasStore;
  if (canvasDocId) {
    store = await CanvasStore.open(repo, canvasDocId as DocumentId);
  } else {
    store = CanvasStore.create(repo);
  }

  // step 4: create and initialize pixi application
  const app = new Application();
  await app.init({
    resizeTo: mountElement,
    background: theme.stageBg,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  // step 5: mount canvas into DOM
  mountElement.appendChild(app.canvas);

  // step 5b: create keyboard driver (the one hidden HTML element — a <textarea>
  // used as a proxy for text input, IME composition, and clipboard)
  const keyboard = new KeyboardDriver(app.canvas as HTMLCanvasElement);

  // step 6: create world container — sits between app.stage and widgets.
  // the viewport translates/scales this container for pan and zoom.
  // the toolbar and other HUD elements live directly on app.stage
  // so they stay fixed regardless of viewport transforms.
  const world = new Container();
  world.sortableChildren = true;
  app.stage.addChild(world);

  // step 7: draw stage background inside the world container so it
  // pans and zooms with everything else
  const stageBg = new Graphics();
  stageBg.rect(0, 0, app.screen.width, app.screen.height);
  stageBg.fill({ color: theme.stageBg });
  stageBg.zIndex = -1;
  world.addChild(stageBg);

  // step 8: create input router (mode switching, selection, keyboard shortcuts)
  const inputRouter = new InputRouter();

  // step 9: create and start the widget manager.
  // widget frames are added to the world container so they participate in pan/zoom.
  const widgetManager = new WidgetManager(
    store,
    registry,
    repo,
    world,
    theme,
    inputRouter,
    keyboard
  );
  widgetManager.start();

  // step 10: create the toolbar (pixi-rendered, top-center of stage).
  // added directly to app.stage by the Toolbar constructor so it stays fixed.
  const toolbar = new Toolbar(app, inputRouter, store, registry, theme);

  // step 11: create viewport for pan/zoom control over the world container
  const viewport = new Viewport(world, app.canvas as HTMLCanvasElement);

  // step 12: create the presence manager for multiplayer awareness.
  // uses the repo's peer id so ephemeral message sender ids match.
  const peerId = repo.peerId as string;
  const presenceManager = new PresenceManager(store, peerId);

  // step 13: create the presence renderer for remote peer cursors.
  // lives in the world container so cursors pan/zoom with widgets.
  const presenceRenderer = new PresenceRenderer(world, presenceManager, theme);

  // step 13b: create the connection status indicator.
  // lives on app.stage (fixed position, top-right) so it doesn't pan/zoom.
  const connectionStatus = new ConnectionStatus(presenceManager, theme);
  app.stage.addChild(connectionStatus.root);
  connectionStatus.layout(app.screen.width);

  // step 14: track local cursor movement and broadcast via presence manager.
  // we listen on the canvas element for pointermove and convert screen
  // coordinates to world coordinates so remote peers see the correct position.
  const canvasEl = app.canvas as HTMLCanvasElement;
  const onPointerMove = (e: PointerEvent) => {
    const rect = canvasEl.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // convert screen coordinates to world coordinates (accounting for pan/zoom)
    const worldX = (screenX - world.x) / (world.scale.x || 1);
    const worldY = (screenY - world.y) / (world.scale.y || 1);

    presenceManager.broadcastCursor(worldX, worldY);
  };
  canvasEl.addEventListener("pointermove", onPointerMove);

  // step 15: announce that we're online
  presenceManager.broadcastOnline();

  // capture the canvas element before destroy nulls out pixi internals
  const canvasElement = app.canvas;

  // step 16: return the handle
  return {
    store,
    registry,
    widgetManager,
    inputRouter,
    toolbar,
    keyboard,
    viewport,
    world,
    presenceManager,
    presenceRenderer,
    connectionStatus,
    app,
    theme,
    repo,
    peerId,
    destroy() {
      // best-effort offline broadcast before teardown
      presenceManager.broadcastOffline();

      canvasEl.removeEventListener("pointermove", onPointerMove);
      connectionStatus.destroy();
      presenceRenderer.destroy();
      presenceManager.destroy();
      toolbar.destroy();
      keyboard.destroy();
      viewport.destroy();
      inputRouter.destroy();
      widgetManager.destroyAll();
      app.destroy(true, { children: true });
      // pixi v8 nulls internals on destroy, so we use the captured ref
      if (canvasElement.parentNode) {
        canvasElement.parentNode.removeChild(canvasElement);
      }
    },
  };
}
