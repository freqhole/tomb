import type { DocHandle, DocumentId, Repo } from "@automerge/automerge-repo";
import { Container, Graphics } from "pixi.js";
import type { SkeinTheme } from "../theme/skein-theme";
import type { KeyboardDriver } from "../widgets/keyboard-driver";
import { createWidgetDoc } from "../widgets/widget-doc";
import type { WidgetRegistry } from "../widgets/widget-registry";
import type { WidgetController, WidgetDoc, WidgetMountContext } from "../widgets/widget-types";
import type { CanvasDocument, WidgetEntry } from "./canvas-doc";
import type { CanvasStore } from "./canvas-store";
import { createCrashedPlaceholder } from "./crashed-placeholder";
import { FocusStack } from "./focus-stack";
import type { InputRouter } from "./input-router";
import type { BreadcrumbItem, Toolbar } from "./toolbar";
import type { Viewport } from "./viewport";
import { WidgetFrame } from "./widget-frame";

/** snapshot of positions at the start of a batch drag */
interface BatchDragState {
  /** the widget that initiated the drag */
  draggedId: string;
  /** starting positions of all other selected widgets (keyed by widget id) */
  startPositions: Map<string, { x: number; y: number }>;
}

/**
 * a live widget tracked by the widget manager.
 * contains everything needed to update or tear down a mounted widget.
 */
export interface LiveWidget {
  entry: WidgetEntry;
  ctrl: WidgetController;
  frame: WidgetFrame;
  crashed: boolean;
  /** the zod-validated doc facade, or null for stateless/crashed widgets */
  widgetDoc: WidgetDoc<any> | null;
}

/**
 * the widget manager is the core bridge between the canvas store (data),
 * the widget registry / factories (rendering), and the pixi stage.
 *
 * it subscribes to canvas document changes and mounts, unmounts,
 * repositions, and resizes widgets as the document evolves.
 *
 * it also coordinates with the input router to handle mode changes
 * and widget selection, and provides frame callbacks for drag/resize/close/collapse.
 */
export class WidgetManager {
  private readonly store: CanvasStore;
  private readonly registry: WidgetRegistry;
  private readonly repo: Repo;
  private readonly stage: Container;
  private readonly theme: SkeinTheme;
  private readonly inputRouter: InputRouter;
  private readonly keyboard: KeyboardDriver;
  private readonly canvasElement: HTMLCanvasElement;
  private readonly stageBg: Graphics;

  private readonly liveWidgets = new Map<string, LiveWidget>();
  private readonly mountingIds = new Set<string>();
  private unsubs: (() => void)[] = [];

  /** optional hook called before a widget is permanently removed.
   *  receives the widget entry and the repo so callers can clean up
   *  linked documents (e.g. deleting a canvas-card's linked canvas). */
  private beforeRemoveHook: ((entry: WidgetEntry, repo: Repo) => void | Promise<void>) | null =
    null;

  /** optional doc overrides — if a widget ID is in this map, its doc will be
   *  used instead of creating one from automerge. used to inject SqliteSocialDoc
   *  for the social widget in tauri mode. */
  private readonly docOverrides = new Map<string, WidgetDoc<any>>();

  /** batch drag state — non-null while a multi-widget drag is in progress */
  private batchDrag: BatchDragState | null = null;

  /** cached stage background bounds to avoid unnecessary redraws */
  private lastStageBounds = { x: 0, y: 0, w: 0, h: 0 };

  /** the widget ID of the drop target currently being hovered during a drag, or null */
  private activeDropTarget: string | null = null;

  /** focus stack for maximize / restore navigation */
  private readonly focusStack = new FocusStack();

  /** widget IDs that were un-nested from the currently maximized widget.
   *  these should remain visible alongside the maximized widget. */
  private readonly maximizedEscapees = new Set<string>();

  /** viewport reference for saving/restoring camera state during maximize */
  private viewport: Viewport | null = null;

  /** toolbar reference for pushing breadcrumb updates */
  private toolbar: Toolbar | null = null;

  /** callback to navigate home (narthex) — used as the first breadcrumb */
  private onNavigateHome: (() => void) | null = null;

  constructor(
    store: CanvasStore,
    registry: WidgetRegistry,
    repo: Repo,
    stage: Container,
    theme: SkeinTheme,
    inputRouter: InputRouter,
    keyboard: KeyboardDriver,
    canvasElement: HTMLCanvasElement,
    stageBg: Graphics
  ) {
    this.store = store;
    this.registry = registry;
    this.repo = repo;
    this.stage = stage;
    this.theme = theme;
    this.inputRouter = inputRouter;
    this.keyboard = keyboard;
    this.canvasElement = canvasElement;
    this.stageBg = stageBg;
  }

  /** register a hook that fires before a widget is permanently removed.
   *  the hook receives the widget entry (with docId, type, props) and the
   *  repo instance so it can open and delete linked documents. */
  setBeforeRemoveHook(hook: (entry: WidgetEntry, repo: Repo) => void | Promise<void>): void {
    this.beforeRemoveHook = hook;
  }

  /** register a doc override for a specific widget ID. must be called before
   *  start() so the override is available when widgets are first mounted. */
  setDocOverride(widgetId: string, doc: WidgetDoc<any>): void {
    this.docOverrides.set(widgetId, doc);
  }

  /** set the viewport reference so maximize/restore can save and restore camera state */
  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
  }

  /** set the toolbar reference so breadcrumbs can be updated on maximize/restore */
  setToolbar(toolbar: Toolbar): void {
    this.toolbar = toolbar;
  }

  /** set the navigate-home callback (shown as the "narthex" breadcrumb) */
  setNavigateHome(handler: (() => void) | null): void {
    this.onNavigateHome = handler;
  }

  /**
   * start the widget manager. reads all current widgets from the store
   * and mounts them, then subscribes to future changes, mode changes,
   * and selection changes.
   */
  start(): void {
    // enable z-index sorting on the stage so widget zIndex values work
    this.stage.sortableChildren = true;

    // mount everything currently in the document
    this.reconcile(this.store.doc());

    // subscribe to future document changes
    const unsubStore = this.store.onChange((doc) => {
      this.reconcile(doc);
    });
    this.unsubs.push(unsubStore);

    // subscribe to single-selection changes (backward compat for property tray etc.)
    const unsubSelection = this.inputRouter.onSelectionChange((_selectedId) => {
      // frame highlighting is driven by multi-selection below;
      // this listener kept for any future single-selection-only consumers.
    });
    this.unsubs.push(unsubSelection);

    // subscribe to multi-selection changes — update frame selection and multi-select state
    const unsubMultiSelection = this.inputRouter.onMultiSelectionChange((ids) => {
      const isMulti = ids.size > 1;
      for (const [id, live] of this.liveWidgets) {
        live.frame.setSelected(ids.has(id));
        live.frame.setMultiSelected(isMulti && ids.has(id));
      }
    });
    this.unsubs.push(unsubMultiSelection);

    // wire up the delete handler on the input router
    this.inputRouter.setDeleteHandler((id) => {
      this.store.removeWidget(id);
    });

    // wire up z-order handlers on the input router
    // ] = bring to front, [ = send to back
    this.inputRouter.setBringForwardHandler((id) => {
      this.store.bringToFront(id);
      this.updateLayerInfo();
    });
    this.inputRouter.setSendBackwardHandler((id) => {
      this.store.sendToBack(id);
      this.updateLayerInfo();
    });

    this.updateBreadcrumbs();
  }

  // --- focus stack (maximize / restore) ---

  /** maximize a widget to fill the viewport. pushes onto the focus stack. */
  maximize(widgetId: string): void {
    const live = this.liveWidgets.get(widgetId);
    if (!live || this.focusStack.hasWidget(widgetId)) return;

    this.maximizedEscapees.clear();

    // save current viewport state so we can restore later
    const savedViewport = this.viewport
      ? { x: this.viewport.cameraX, y: this.viewport.cameraY, zoom: this.viewport.zoom }
      : { x: 0, y: 0, zoom: 1 };

    this.focusStack.push({
      widgetId,
      savedViewport,
      savedSize: { width: live.entry.width, height: live.entry.height },
    });

    // hide all other widget frames (including any previously maximized widget)
    for (const [id, other] of this.liveWidgets) {
      if (id !== widgetId) {
        other.frame.root.visible = false;
      }
    }

    // reset viewport to origin at 1x zoom
    if (this.viewport) {
      this.viewport.resetView();
    }

    // enter maximized mode on the frame (hides chrome, disables drag)
    live.frame.setMaximized(true);

    // position frame at origin and resize to fill viewport
    const { width, height } = this.getViewportSize();
    live.frame.setPosition(0, 0);
    live.frame.updateSize(width, height);
    if (live.ctrl.resize) {
      try {
        live.ctrl.resize(width, height);
      } catch (err) {
        console.warn(`widget ${widgetId} threw during maximize resize:`, err);
      }
    }

    // notify the widget so it can adapt its rendering
    if (live.ctrl.setMaximized) {
      try {
        live.ctrl.setMaximized(true);
      } catch (err) {
        console.warn(`widget ${widgetId} threw during setMaximized(true):`, err);
      }
    }

    // update breadcrumbs to reflect maximized state
    this.updateBreadcrumbs();
  }

  /** restore the most recently maximized widget. pops the focus stack. */
  restore(): void {
    const entry = this.focusStack.pop();
    if (!entry) return;

    const live = this.liveWidgets.get(entry.widgetId);

    if (live) {
      // notify the widget it's leaving maximized mode
      if (live.ctrl.setMaximized) {
        try {
          live.ctrl.setMaximized(false);
        } catch (err) {
          console.warn(`widget ${entry.widgetId} threw during setMaximized(false):`, err);
        }
      }

      // restore frame chrome and original size
      live.frame.setMaximized(false);
      live.frame.setPosition(live.entry.x, live.entry.y);
      live.frame.updateSize(entry.savedSize.width, entry.savedSize.height);
      if (live.ctrl.resize) {
        try {
          live.ctrl.resize(entry.savedSize.width, entry.savedSize.height);
        } catch (err) {
          console.warn(`widget ${entry.widgetId} threw during restore resize:`, err);
        }
      }
    }

    if (this.focusStack.isEmpty) {
      // stack fully empty — show all widgets, restore original viewport
      for (const other of this.liveWidgets.values()) {
        other.frame.root.visible = true;
      }
      if (this.viewport) {
        this.viewport.zoomTo(entry.savedViewport.zoom);
        this.viewport.panTo(entry.savedViewport.x, entry.savedViewport.y);
      }
    } else {
      // still a maximized widget underneath — show only that one
      const parent = this.focusStack.peek()!;
      const parentLive = this.liveWidgets.get(parent.widgetId);
      if (parentLive) {
        parentLive.frame.root.visible = true;
      }
      // hide the widget we just restored (it goes back behind the parent)
      if (live) {
        live.frame.root.visible = false;
      }
    }

    this.maximizedEscapees.clear();
    this.updateBreadcrumbs();
  }

  /** whether any widget is currently maximized */
  get isMaximized(): boolean {
    return !this.focusStack.isEmpty;
  }

  /** current viewport size in CSS pixels */
  private getViewportSize(): { width: number; height: number } {
    return {
      width: this.canvasElement.clientWidth,
      height: this.canvasElement.clientHeight,
    };
  }

  /** restore all maximized widgets back to the canvas level */
  private restoreAll(): void {
    while (!this.focusStack.isEmpty) {
      this.restore();
    }
  }

  /** restore maximized widgets until the focus stack has `targetDepth` entries.
   *  e.g., targetDepth=1 means keep only the bottom entry (the first maximized widget). */
  private restoreTo(targetDepth: number): void {
    while (this.focusStack.depth > targetDepth) {
      this.restore();
    }
  }

  /** recompute and push breadcrumbs to the toolbar based on the current focus stack */
  private updateBreadcrumbs(): void {
    if (!this.toolbar) return;

    const crumbs: BreadcrumbItem[] = [];

    // "narthex" crumb — always first when navigateHome is available
    if (this.onNavigateHome) {
      const handler = this.onNavigateHome;
      crumbs.push({ label: "narthex", onClick: () => handler() });
    }

    // canvas title crumb
    const canvasTitle = this.store.metadata().title || "untitled canvas";

    if (this.focusStack.isEmpty) {
      // not maximized — canvas name is the current (non-clickable) context
      crumbs.push({ label: canvasTitle });
    } else {
      // maximized — canvas name is clickable to restore all
      crumbs.push({ label: canvasTitle, onClick: () => this.restoreAll() });

      // add a crumb for each focus stack entry (bottom to top)
      const entries = this.focusStack.entries;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const live = this.liveWidgets.get(entry.widgetId);
        const factory = this.registry.get(live?.entry.type ?? "");
        const label = live?.entry.title || factory?.metadata.name || "widget";
        const isLast = i === entries.length - 1;

        if (isLast) {
          // current maximized widget — non-clickable
          crumbs.push({ label });
        } else {
          // intermediate — clicking restores to this level
          const targetDepth = i + 1;
          crumbs.push({ label, onClick: () => this.restoreTo(targetDepth) });
        }
      }
    }

    this.toolbar.setBreadcrumbs(crumbs);
  }

  /**
   * mount a single widget onto the stage.
   *
   * handles two scenarios:
   * - new widget (no docId): creates a fresh automerge doc and stores the
   *   docId back into the canvas document so other peers can find it.
   * - synced widget (has docId): uses repo.find() to locate the existing
   *   per-widget document and waits for it to be ready before mounting.
   */
  private async mountWidget(entry: WidgetEntry): Promise<void> {
    // guard against re-entrant mounts. setDocId() inside this method
    // triggers a synchronous reconcile() callback which sees the widget
    // as "new" (not yet in liveWidgets) and calls mountWidget() again.
    // the Set is checked here and in reconcile() to prevent duplicates.
    if (this.mountingIds.has(entry.id)) return;
    this.mountingIds.add(entry.id);

    const factory = this.registry.get(entry.type);

    // if the factory is not found, mount a crashed placeholder
    if (!factory) {
      this.mountingIds.delete(entry.id);
      this.mountCrashed(entry, `unknown widget type: "${entry.type}"`);
      return;
    }

    // build the per-widget document facade
    let doc: WidgetDoc<any>;

    // check for doc override (e.g., SqliteSocialDoc in tauri mode)
    if (this.docOverrides.has(entry.id)) {
      doc = this.docOverrides.get(entry.id)!;
    } else if (factory.schema) {
      let widgetDocHandle: DocHandle<any>;

      if (entry.docId) {
        // this widget already has a per-widget document (synced from another
        // peer, or restored from persistence). find it in the repo and wait
        // for it to be available.
        try {
          widgetDocHandle = await this.repo.find<any>(entry.docId as DocumentId);
          await widgetDocHandle.whenReady();
        } catch (err) {
          console.warn(`failed to find widget doc ${entry.docId} for widget ${entry.id}:`, err);
          this.mountingIds.delete(entry.id);
          this.mountCrashed(
            entry,
            `widget doc not available: ${err instanceof Error ? err.message : String(err)}`
          );
          return;
        }
      } else {
        // new widget with no existing document — create one and persist the
        // docId back into the canvas document so other peers can sync it.
        // merge entry.props into schema defaults so callers can seed initial
        // state (e.g., canvasDocId for narthex canvas-card widgets).
        const defaults = factory.schema.parse(entry.props ?? {});
        widgetDocHandle = this.repo.create(defaults);
        this.store.setDocId(entry.id, widgetDocHandle.documentId);
      }

      doc = createWidgetDoc(factory.schema, widgetDocHandle);
    } else {
      // stateless widget: no-op document facade
      doc = {
        get current() {
          return {};
        },
        change() {},
        on() {
          return () => {};
        },
      };
    }

    // resolve the widget name from factory metadata
    const widgetName = factory.metadata.name;

    // build callbacks that close over this entry's id
    const callbacks = this.createFrameCallbacks(entry.id, entry.type);

    // create the pixi frame
    const frame = new WidgetFrame(entry, widgetName, this.theme, callbacks);

    // if this widget is the currently selected one, mark it
    if (this.inputRouter.selectedWidgetId === entry.id) {
      frame.setSelected(true);
    }

    // build the mount context
    const ctx: WidgetMountContext = {
      doc,
      width: entry.width,
      height: entry.height,
      keyboard: this.keyboard,
      canvasElement: this.canvasElement,
      canvasStore: this.store,
      widgetId: entry.id,
      setHeaderActions: (actions) => {
        frame.setCustomActions(actions);
      },
    };

    let ctrl: WidgetController;
    try {
      ctrl = factory.create(ctx);
    } catch (err) {
      console.warn(
        `widget factory "${entry.type}" threw during create for widget ${entry.id}:`,
        err
      );
      // tear down the frame we already created
      frame.destroy();
      this.mountingIds.delete(entry.id);
      this.mountCrashed(
        entry,
        `factory threw: ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }

    // apply initial header actions if the widget declared any
    if (ctrl.headerActions) {
      frame.setCustomActions(ctrl.headerActions);
    }

    // add the widget's container into the frame's content area
    frame.contentContainer.addChild(ctrl.container);

    // add the frame root to the stage
    this.stage.addChild(frame.root);

    // track it
    this.liveWidgets.set(entry.id, {
      entry: { ...entry },
      ctrl,
      frame,
      crashed: false,
      widgetDoc: factory.schema ? doc : null,
    });
    this.mountingIds.delete(entry.id);
  }

  /**
   * mount a crashed placeholder for a widget that failed to load.
   */
  private mountCrashed(entry: WidgetEntry, reason: string): void {
    const callbacks = this.createFrameCallbacks(entry.id, entry.type);
    const frame = new WidgetFrame(entry, "crashed", this.theme, callbacks);
    const ctrl = createCrashedPlaceholder(entry.width, entry.height, reason, this.theme);

    frame.contentContainer.addChild(ctrl.container);
    this.stage.addChild(frame.root);

    this.liveWidgets.set(entry.id, {
      entry: { ...entry },
      ctrl,
      frame,
      crashed: true,
      widgetDoc: null,
    });
  }

  /**
   * close a widget: deselect, cascade-delete descendants, remove from store.
   * used by the property tray delete button and internal close logic.
   */
  closeWidget(widgetId: string): void {
    if (this.inputRouter.selectedWidgetIds.has(widgetId)) {
      this.inputRouter.selectWidget(null);
    }
    const collectDescendants = (id: string): string[] => {
      const children = this.store.getChildren(id);
      return children.flatMap((c) => [c.id, ...collectDescendants(c.id)]);
    };
    for (const descendantId of collectDescendants(widgetId)) {
      this.store.removeWidget(descendantId);
    }
    this.store.removeWidget(widgetId);
  }

  /**
   * create the callback object for a widget frame.
   * each callback closes over the widget id and delegates to the store or input router.
   */
  private createFrameCallbacks(widgetId: string, widgetType?: string) {
    return {
      onSelect: () => {
        this.inputRouter.selectWidget(widgetId);
      },
      onShiftSelect: () => {
        this.inputRouter.toggleWidgetInSelection(widgetId);
      },
      onMove: (x: number, y: number) => {
        this.store.moveWidget(widgetId, x, y);
        this.updateStageBounds();
      },
      onResize: (width: number, height: number) => {
        this.store.resizeWidget(widgetId, width, height);
        // also call ctrl.resize() on the live widget
        const live = this.liveWidgets.get(widgetId);
        if (live && live.ctrl.resize) {
          try {
            live.ctrl.resize(width, height);
          } catch (err) {
            console.warn(`widget ${widgetId} threw during resize callback:`, err);
          }
        }
        this.updateStageBounds();
      },
      onClose: () => {
        this.closeWidget(widgetId);
      },
      onCollapse: (collapsed: boolean) => {
        this.store.setCollapsed(widgetId, collapsed);
        const live = this.liveWidgets.get(widgetId);
        if (live) {
          live.frame.setCollapsed(collapsed);
        }
      },
      onMaximize: (() => {
        const factory = widgetType ? this.registry.get(widgetType) : null;
        if (factory?.metadata.maximizable === false) return undefined;
        return () => {
          this.maximize(widgetId);
        };
      })(),

      // batch drag support — only activates when multiple widgets are selected
      onDragStart: () => {
        this.activeDropTarget = null;
        this.handleBatchDragStart(widgetId);
      },
      onDragDelta: (dx: number, dy: number) => {
        this.handleBatchDragDelta(widgetId, dx, dy);
        this.checkDropTargetHover(widgetId);
      },
      onDragEnd: () => {
        this.tryDropOnTarget(widgetId);
        this.handleBatchDragEnd(widgetId);
      },

      // z-order controls (from the layers flyout)
      onBringToFront: () => {
        this.store.bringToFront(widgetId);
        this.updateLayerInfo();
      },
      onBringForward: () => {
        this.store.bringForward(widgetId);
        this.updateLayerInfo();
      },
      onSendBackward: () => {
        this.store.sendBackward(widgetId);
        this.updateLayerInfo();
      },
      onSendToBack: () => {
        this.store.sendToBack(widgetId);
        this.updateLayerInfo();
      },
    };
  }

  // --- batch drag support ---

  /**
   * when a drag starts on a selected widget and multiple widgets are selected,
   * snapshot the starting positions of all other selected widgets so we can
   * move them in sync during the drag.
   */
  private handleBatchDragStart(draggedId: string): void {
    const selectedIds = this.inputRouter.selectedWidgetIds;
    if (selectedIds.size <= 1) {
      this.batchDrag = null;
      return;
    }

    const startPositions = new Map<string, { x: number; y: number }>();
    for (const id of selectedIds) {
      if (id === draggedId) continue;
      const live = this.liveWidgets.get(id);
      if (live) {
        startPositions.set(id, { x: live.frame.root.x, y: live.frame.root.y });
      }
    }

    this.batchDrag = { draggedId, startPositions };
  }

  /**
   * move all other selected widgets by the same delta as the dragged widget.
   * the dragged widget's frame moves itself — we only handle the others.
   */
  private handleBatchDragDelta(_draggedId: string, dx: number, dy: number): void {
    if (!this.batchDrag) return;

    for (const [id, startPos] of this.batchDrag.startPositions) {
      const live = this.liveWidgets.get(id);
      if (live) {
        live.frame.setPosition(startPos.x + dx, startPos.y + dy);
      }
    }
  }

  /**
   * commit final positions of all batch-dragged widgets to the store.
   */
  private handleBatchDragEnd(_draggedId: string): void {
    if (!this.batchDrag) return;

    for (const [id] of this.batchDrag.startPositions) {
      const live = this.liveWidgets.get(id);
      if (live) {
        this.store.moveWidget(id, live.frame.root.x, live.frame.root.y);
      }
    }

    this.batchDrag = null;
    this.updateStageBounds();
  }

  /**
   * during a frame drag, check if the dragged widget is hovering over
   * any live widget that implements a drop target. if so, forward hover
   * events for visual feedback (e.g. bin slot highlighting).
   */
  private checkDropTargetHover(draggedId: string): void {
    const draggedLive = this.liveWidgets.get(draggedId);
    if (!draggedLive) return;

    // use the center of the dragged widget's frame as the test point
    const wx = draggedLive.frame.root.x + draggedLive.entry.width / 2;
    const wy = draggedLive.frame.root.y + draggedLive.entry.height / 2;

    let foundTarget: string | null = null;

    for (const [targetId, live] of this.liveWidgets) {
      if (targetId === draggedId) continue;
      if (!live.ctrl.dropTarget) continue;

      if (live.ctrl.dropTarget.hitTest(wx, wy)) {
        live.ctrl.dropTarget.onHover(wx, wy, draggedId);
        foundTarget = targetId;
        break;
      }
    }

    // if we left the previous target, notify it
    if (this.activeDropTarget && this.activeDropTarget !== foundTarget) {
      const prev = this.liveWidgets.get(this.activeDropTarget);
      prev?.ctrl.dropTarget?.onLeave();
    }

    this.activeDropTarget = foundTarget;
  }

  /**
   * at the end of a frame drag, check if the widget should be dropped
   * onto an active drop target. returns true if the drop was consumed.
   */
  private tryDropOnTarget(draggedId: string): boolean {
    if (!this.activeDropTarget) return false;

    const targetLive = this.liveWidgets.get(this.activeDropTarget);
    const draggedLive = this.liveWidgets.get(draggedId);

    if (!targetLive?.ctrl.dropTarget || !draggedLive) {
      this.activeDropTarget = null;
      return false;
    }

    const wx = draggedLive.frame.root.x + draggedLive.entry.width / 2;
    const wy = draggedLive.frame.root.y + draggedLive.entry.height / 2;

    const consumed = targetLive.ctrl.dropTarget.onDrop(draggedId, wx, wy);

    // if the primary drop was consumed and there are other selected widgets
    // in the batch drag, drop those too (multi-drop into bin)
    if (consumed && this.batchDrag) {
      for (const [otherId] of this.batchDrag.startPositions) {
        const otherLive = this.liveWidgets.get(otherId);
        if (!otherLive) continue;
        const ox = otherLive.frame.root.x + otherLive.entry.width / 2;
        const oy = otherLive.frame.root.y + otherLive.entry.height / 2;
        // re-check drop target is still valid (previous drop might have destroyed it)
        if (!targetLive.ctrl.dropTarget) break;
        targetLive.ctrl.dropTarget.onDrop(otherId, ox, oy);
      }
      // clear batch drag state since all widgets were consumed
      this.batchDrag = null;
    }

    targetLive.ctrl.dropTarget?.onLeave();
    this.activeDropTarget = null;

    return consumed;
  }

  /**
   * unmount a single widget from the stage and clean up.
   *
   * when `permanent` is true (the default), the per-widget automerge doc is
   * also deleted from the repo / IndexedDB. this is the right behaviour when
   * a widget is removed from the canvas document (reconcile path).
   *
   * when `permanent` is false, the doc is left intact — used during navigation
   * teardown so that docs are still available when the canvas is re-opened.
   */
  private unmountWidget(id: string, permanent = true): void {
    const live = this.liveWidgets.get(id);
    if (!live) return;

    try {
      live.ctrl.destroy();
    } catch (err) {
      console.warn(`widget ${id} threw during destroy:`, err);
    }

    live.frame.destroy();

    // only delete the per-widget automerge doc when the widget was permanently
    // removed from the canvas. during navigation teardown we keep the doc so
    // it can be found again when the canvas is re-mounted.
    if (permanent) {
      // fire the before-remove hook so callers can clean up linked docs
      if (this.beforeRemoveHook) {
        try {
          const result = this.beforeRemoveHook(live.entry, this.repo);
          // if the hook returns a promise, let it run but don't block teardown
          if (result && typeof (result as Promise<void>).catch === "function") {
            (result as Promise<void>).catch((err) => {
              console.warn(`beforeRemoveHook failed for widget ${id}:`, err);
            });
          }
        } catch (err) {
          console.warn(`beforeRemoveHook threw for widget ${id}:`, err);
        }
      }

      if (live.entry.docId) {
        this.repo.delete(live.entry.docId as DocumentId);
      }
    }

    this.liveWidgets.delete(id);
  }

  /**
   * reconcile the live widget map against the current canvas document.
   * mounts new widgets, unmounts removed ones, and updates position/size
   * for widgets that changed.
   */
  private reconcile(doc: CanvasDocument): void {
    const docWidgetIds = new Set(Object.keys(doc.widgets));
    const liveWidgetIds = new Set(this.liveWidgets.keys());

    // find widgets that were removed from the document
    for (const id of liveWidgetIds) {
      if (!docWidgetIds.has(id)) {
        // if the removed widget was maximized, restore before unmounting
        if (this.focusStack.peek()?.widgetId === id) {
          this.restore();
        }
        this.unmountWidget(id);
      }
    }

    // find new widgets and update existing ones
    for (const [id, entry] of Object.entries(doc.widgets)) {
      // skip widgets nested inside a parent (the parent bin renders them)
      if (entry.parentId) {
        // if this widget was maximized and just got nested, restore first
        if (this.focusStack.peek()?.widgetId === id && liveWidgetIds.has(id)) {
          this.restore();
        }
        // if this widget was previously mounted and just gained a parentId,
        // unmount it — the parent widget takes over rendering.
        // use permanent=false so the automerge doc is preserved.
        if (liveWidgetIds.has(id)) {
          this.unmountWidget(id, false);
        }
        continue;
      }

      if (!liveWidgetIds.has(id) && !this.mountingIds.has(id)) {
        // new widget (or previously parented widget that lost its parentId) — mount it
        this.mountWidget(entry);
        // if we're in maximized mode, this widget likely just escaped from a bin —
        // keep it visible alongside the maximized widget
        if (!this.focusStack.isEmpty) {
          this.maximizedEscapees.add(id);
        }
      } else {
        // existing widget — check for position/size/zIndex/collapsed changes
        const live = this.liveWidgets.get(id);
        if (!live) continue; // still mounting asynchronously
        const prev = live.entry;

        // if this widget is currently maximized, snapshot the entry but skip
        // visual updates — maximize controls the frame position and size
        if (this.focusStack.peek()?.widgetId === id) {
          live.entry = { ...entry };
          continue;
        }

        // update position if changed
        if (prev.x !== entry.x || prev.y !== entry.y) {
          live.frame.setPosition(entry.x, entry.y);
        }

        // update z-index if changed
        if (prev.zIndex !== entry.zIndex) {
          live.frame.setZIndex(entry.zIndex);
        }

        // update size if changed
        if (prev.width !== entry.width || prev.height !== entry.height) {
          live.frame.updateSize(entry.width, entry.height);
          if (live.ctrl.resize) {
            try {
              live.ctrl.resize(entry.width, entry.height);
            } catch (err) {
              console.warn(`widget ${id} threw during resize:`, err);
            }
          }
        }

        // update collapsed state if changed
        if (prev.collapsed !== entry.collapsed) {
          live.frame.setCollapsed(entry.collapsed);
        }

        // update title if changed
        if (prev.title !== entry.title) {
          live.frame.setTitle(entry.title ?? "");
        }

        // snapshot the latest entry
        live.entry = { ...entry };
      }
    }

    this.updateStageBounds();
    this.updateLayerInfo();

    // enforce focus stack visibility — newly mounted or reconciled widgets
    // must stay hidden when another widget is maximized
    if (!this.focusStack.isEmpty) {
      const maximizedId = this.focusStack.peek()!.widgetId;
      for (const [id, live] of this.liveWidgets) {
        if (id === maximizedId || this.maximizedEscapees.has(id)) {
          live.frame.root.visible = true;
        } else {
          live.frame.root.visible = false;
        }
      }
    }

    this.updateBreadcrumbs();
  }

  /** update layer position info on all live widget frames */
  private updateLayerInfo(): void {
    for (const [id, live] of this.liveWidgets) {
      const info = this.store.getLayerInfo(id);
      live.frame.setLayerInfo(info.position, info.total);
    }
  }

  /** set lasso-active state on all live widget frames.
   *  when active, all widget content becomes inert with a dark overlay
   *  so the lasso pointer events aren't captured by widget content. */
  setLassoActive(active: boolean): void {
    for (const live of this.liveWidgets.values()) {
      live.frame.setLassoActive(active);
    }
  }

  /** return the map of all currently mounted widgets. */
  getLiveWidgets(): Map<string, LiveWidget> {
    return this.liveWidgets;
  }

  /**
   * expand the stage background to encompass all widgets with padding,
   * ensuring it always covers at least the base area (-2000,-2000 to 2000,2000)
   * so the lasso tool's hit area spans the full viewport.
   */
  private updateStageBounds(): void {
    if (this.liveWidgets.size === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const live of this.liveWidgets.values()) {
      const e = live.entry;
      minX = Math.min(minX, e.x);
      minY = Math.min(minY, e.y);
      maxX = Math.max(maxX, e.x + e.width);
      maxY = Math.max(maxY, e.y + e.height);
    }

    const pad = 2000;
    let bgX = minX - pad;
    let bgY = minY - pad;
    let bgW = maxX - minX + pad * 2;
    let bgH = maxY - minY + pad * 2;

    // ensure minimum bounds cover the base area
    const baseMin = -2000;
    const baseMax = 2000;
    bgX = Math.min(bgX, baseMin);
    bgY = Math.min(bgY, baseMin);
    const bgRight = Math.max(bgX + bgW, baseMax);
    const bgBottom = Math.max(bgY + bgH, baseMax);
    bgW = bgRight - bgX;
    bgH = bgBottom - bgY;

    // only redraw if the bounds actually changed (avoid thrashing the graphics object)
    const last = this.lastStageBounds;
    if (last.x === bgX && last.y === bgY && last.w === bgW && last.h === bgH) return;
    this.lastStageBounds = { x: bgX, y: bgY, w: bgW, h: bgH };

    this.stageBg.clear();
    this.stageBg.rect(bgX, bgY, bgW, bgH);
    this.stageBg.fill({ color: this.theme.stageBg });
  }

  /**
   * unmount all widgets and unsubscribe from all listeners.
   * called during navigation teardown — per-widget docs are intentionally
   * kept alive so they're still available when the canvas is re-opened.
   */
  destroyAll(): void {
    // clean up focus stack
    this.focusStack.clear();
    this.maximizedEscapees.clear();

    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];

    for (const id of [...this.liveWidgets.keys()]) {
      this.unmountWidget(id, false);
    }
  }
}
