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
import { LassoTool } from "./lasso-tool";
import { PresenceManager } from "./presence-manager";
import { PresenceRenderer } from "./presence-renderer";
import { PropertyTray } from "./property-tray";
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
  /** optional pre-existing automerge repo — when provided, storage/network options are ignored */
  repo?: Repo;
  /** if true, this canvas is the narthex (home screen) — affects toolbar behavior */
  isNarthex?: boolean;
  /** callback to navigate back to the narthex — toolbar shows a home button when set */
  onNavigateHome?: () => void;
  /** callback to share the current canvas — toolbar shows a share button when set */
  onShare?: () => void;
  /** optional transport-level connection state source for the status indicator */
  connectionStateSource?: import("./connection-status").ConnectionStateSource | null;
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
  /** the toolbar (pixi-rendered, top-right of stage) */
  toolbar: Toolbar;
  /** the keyboard driver for text input / IME (hidden textarea proxy) */
  keyboard: KeyboardDriver;
  /** the viewport for pan/zoom control */
  viewport: Viewport;
  /** the world container that holds all widgets (affected by pan/zoom) */
  world: Container;
  /** the presence manager for multiplayer cursor/lock/selection state */
  presenceManager: PresenceManager;
  /** the presence renderer for remote peer cursors (null on narthex) */
  presenceRenderer: PresenceRenderer | null;
  /** the connection status indicator (peer count pill, null on narthex) */
  connectionStatus: ConnectionStatus | null;
  /** the property editing tray (appears next to selected widget in edit mode) */
  propertyTray: PropertyTray;
  /** the lasso tool for multi-select, click-deselect, and double-click-to-add */
  lassoTool: LassoTool;
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

  // step 2: use the provided repo or create a new one
  let repo: Repo;
  if (options.repo) {
    repo = options.repo;
  } else {
    const storage = storageAdapter ?? new IndexedDBStorageAdapter();
    const network = networkAdapter ? [networkAdapter] : [];
    repo = new Repo({ storage, network });
  }

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
  stageBg.rect(-2000, -2000, 4000, 4000);
  stageBg.fill({ color: theme.stageBg });
  stageBg.zIndex = -1;
  world.addChild(stageBg);

  // step 7b: draw a subtle grid over the stage background.
  // covers a fixed region (-1000,-1000) to (1000,1000) — enough for
  // typical canvas use. the grid lives in the world container so it
  // pans and zooms with everything else.
  const stageGrid = new Graphics();
  const gridSize = theme.gridSize;
  const gridMin = -1000;
  const gridMax = 1000;
  stageGrid.setStrokeStyle({ width: 1, color: theme.stageGrid, alpha: 0.3 });
  for (let gx = gridMin; gx <= gridMax; gx += gridSize) {
    stageGrid.moveTo(gx, gridMin);
    stageGrid.lineTo(gx, gridMax);
  }
  for (let gy = gridMin; gy <= gridMax; gy += gridSize) {
    stageGrid.moveTo(gridMin, gy);
    stageGrid.lineTo(gridMax, gy);
  }
  stageGrid.stroke();
  stageGrid.zIndex = -1;
  world.addChild(stageGrid);

  // step 8: create input router (mode switching, selection, keyboard shortcuts)
  const inputRouter = new InputRouter();

  // make the stage background interactive so the lasso tool can attach to it.
  // the stageBg is the lowest zIndex element in the world container, so
  // pointer events only reach it when they don't hit any widget frame or
  // other interactive element (they all stopPropagation on pointerdown).
  stageBg.eventMode = "static";

  // step 9: create and start the widget manager.
  // widget frames are added to the world container so they participate in pan/zoom.
  const widgetManager = new WidgetManager(
    store,
    registry,
    repo,
    world,
    theme,
    inputRouter,
    keyboard,
    app.canvas as HTMLCanvasElement,
    stageBg
  );
  widgetManager.start();

  // step 10: create the toolbar (pixi-rendered, top-right of stage).
  // added directly to app.stage by the Toolbar constructor so it stays fixed.
  const toolbar = new Toolbar(app, inputRouter, store, registry, theme, {
    isNarthex: options.isNarthex,
    onNavigateHome: options.onNavigateHome,
    onShare: options.onShare,
  });

  // step 10b: create the lasso tool for multi-select, click-deselect, and
  // double-click-to-add. it attaches pointer handlers to the stage background
  // and manages freeform lasso selection drawing in the world container.
  const lassoTool = new LassoTool({
    target: stageBg,
    world,
    inputRouter,
    widgetManager,
    theme,
    onDoubleClick: (screenX, screenY, worldX, worldY) => {
      toolbar.openFlyoutAtPosition(screenX, screenY, worldX, worldY);
    },
    onLassoStart: () => {
      widgetManager.setLassoActive(true);
    },
    onLassoEnd: () => {
      widgetManager.setLassoActive(false);
    },
  });

  // step 11: create viewport for pan/zoom control over the world container
  const viewport = new Viewport(world, app.canvas as HTMLCanvasElement);

  // step 12: create the presence manager for multiplayer awareness.
  // uses the repo's peer id so ephemeral message sender ids match.
  const peerId = repo.peerId as string;
  const presenceManager = new PresenceManager(store, peerId);

  // step 13: create the presence renderer for remote peer cursors.
  // lives in the world container so cursors pan/zoom with widgets.
  // skipped on the narthex — no remote cursors needed on the home screen.
  let presenceRenderer: PresenceRenderer | null = null;
  let connectionStatus: ConnectionStatus | null = null;

  if (!options.isNarthex) {
    presenceRenderer = new PresenceRenderer(world, presenceManager, theme);

    // step 13b: create the connection status indicator.
    // lives on app.stage (fixed position, bottom-left) so it doesn't pan/zoom.
    // layout() reads visual viewport internally for correct sizing on mobile safari.
    connectionStatus = new ConnectionStatus(presenceManager, theme, options.connectionStateSource);
    app.stage.addChild(connectionStatus.root);
    connectionStatus.layout();
  }

  // step 13c: create the property tray for editing widget props.
  // lives in the world container so it pans/zooms with widgets.
  // subscribes to selection/mode/store changes internally.
  const propertyTray = new PropertyTray(
    world,
    theme,
    app.canvas as HTMLCanvasElement,
    inputRouter,
    widgetManager,
    store,
    registry
  );

  // step 14: track local cursor movement and broadcast via presence manager.
  // skipped on the narthex — no cursor broadcasting needed on the home screen.
  const canvasEl = app.canvas as HTMLCanvasElement;
  let onPointerMove: ((e: PointerEvent) => void) | null = null;

  if (!options.isNarthex) {
    // we listen on the canvas element for pointermove and convert screen
    // coordinates to world coordinates so remote peers see the correct position.
    onPointerMove = (e: PointerEvent) => {
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
  }

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
    propertyTray,
    lassoTool,
    app,
    theme,
    repo,
    peerId,
    destroy() {
      // best-effort offline broadcast before teardown
      presenceManager.broadcastOffline();

      if (onPointerMove) {
        canvasEl.removeEventListener("pointermove", onPointerMove);
      }
      connectionStatus?.destroy();
      presenceRenderer?.destroy();
      presenceManager.destroy();
      lassoTool.destroy();
      propertyTray.destroy();
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
