import type { DocHandle, DocumentId, Repo } from "@automerge/automerge-repo";
import { Container } from "pixi.js";
import type { SkeinTheme } from "../theme/skein-theme";
import type { KeyboardDriver } from "../widgets/keyboard-driver";
import { createWidgetDoc } from "../widgets/widget-doc";
import type { WidgetRegistry } from "../widgets/widget-registry";
import type { WidgetController, WidgetDoc, WidgetMountContext } from "../widgets/widget-types";
import type { CanvasDocument, WidgetEntry } from "./canvas-doc";
import type { CanvasStore } from "./canvas-store";
import { createCrashedPlaceholder } from "./crashed-placeholder";
import type { InputRouter } from "./input-router";
import { WidgetFrame } from "./widget-frame";

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

  private readonly liveWidgets = new Map<string, LiveWidget>();
  private unsubs: (() => void)[] = [];

  constructor(
    store: CanvasStore,
    registry: WidgetRegistry,
    repo: Repo,
    stage: Container,
    theme: SkeinTheme,
    inputRouter: InputRouter,
    keyboard: KeyboardDriver
  ) {
    this.store = store;
    this.registry = registry;
    this.repo = repo;
    this.stage = stage;
    this.theme = theme;
    this.inputRouter = inputRouter;
    this.keyboard = keyboard;
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

    // subscribe to mode changes — update all frames
    const unsubMode = this.inputRouter.onModeChange((mode) => {
      const editing = mode === "edit";
      for (const live of this.liveWidgets.values()) {
        live.frame.setEditMode(editing);
      }
    });
    this.unsubs.push(unsubMode);

    // subscribe to selection changes — update frame selection state
    const unsubSelection = this.inputRouter.onSelectionChange((selectedId) => {
      for (const [id, live] of this.liveWidgets) {
        live.frame.setSelected(id === selectedId);
      }
    });
    this.unsubs.push(unsubSelection);

    // wire up the delete handler on the input router
    this.inputRouter.setDeleteHandler((id) => {
      this.store.removeWidget(id);
    });
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
    const factory = this.registry.get(entry.type);

    // if the factory is not found, mount a crashed placeholder
    if (!factory) {
      this.mountCrashed(entry, `unknown widget type: "${entry.type}"`);
      return;
    }

    // build the per-widget document facade
    let doc: WidgetDoc<any>;

    if (factory.schema) {
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
          this.mountCrashed(
            entry,
            `widget doc not available: ${err instanceof Error ? err.message : String(err)}`
          );
          return;
        }
      } else {
        // new widget with no existing document — create one and persist the
        // docId back into the canvas document so other peers can sync it.
        const defaults = factory.schema.parse({});
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
    const editing = this.inputRouter.isEditMode;

    // build callbacks that close over this entry's id
    const callbacks = this.createFrameCallbacks(entry.id);

    // create the pixi frame
    const frame = new WidgetFrame(entry, widgetName, this.theme, editing, callbacks);

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
      this.mountCrashed(
        entry,
        `factory threw: ${err instanceof Error ? err.message : String(err)}`
      );
      return;
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
  }

  /**
   * mount a crashed placeholder for a widget that failed to load.
   */
  private mountCrashed(entry: WidgetEntry, reason: string): void {
    const editing = this.inputRouter.isEditMode;
    const callbacks = this.createFrameCallbacks(entry.id);
    const frame = new WidgetFrame(entry, "crashed", this.theme, editing, callbacks);
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
   * create the callback object for a widget frame.
   * each callback closes over the widget id and delegates to the store or input router.
   */
  private createFrameCallbacks(widgetId: string) {
    return {
      onSelect: () => {
        this.inputRouter.selectWidget(widgetId);
      },
      onMove: (x: number, y: number) => {
        this.store.moveWidget(widgetId, x, y);
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
      },
      onClose: () => {
        // deselect if this widget is selected
        if (this.inputRouter.selectedWidgetId === widgetId) {
          this.inputRouter.selectWidget(null);
        }
        this.store.removeWidget(widgetId);
      },
      onCollapse: (collapsed: boolean) => {
        this.store.setCollapsed(widgetId, collapsed);
        const live = this.liveWidgets.get(widgetId);
        if (live) {
          live.frame.setCollapsed(collapsed);
        }
      },
    };
  }

  /**
   * unmount a single widget from the stage and clean up.
   */
  private unmountWidget(id: string): void {
    const live = this.liveWidgets.get(id);
    if (!live) return;

    try {
      live.ctrl.destroy();
    } catch (err) {
      console.warn(`widget ${id} threw during destroy:`, err);
    }

    live.frame.destroy();
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
        this.unmountWidget(id);
      }
    }

    // find new widgets and update existing ones
    for (const [id, entry] of Object.entries(doc.widgets)) {
      if (!liveWidgetIds.has(id)) {
        // new widget — mount it
        this.mountWidget(entry);
      } else {
        // existing widget — check for position/size/zIndex/collapsed changes
        const live = this.liveWidgets.get(id)!;
        const prev = live.entry;

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

        // snapshot the latest entry
        live.entry = { ...entry };
      }
    }
  }

  /** return the map of all currently mounted widgets. */
  getLiveWidgets(): Map<string, LiveWidget> {
    return this.liveWidgets;
  }

  /** unmount all widgets and unsubscribe from all listeners. */
  destroyAll(): void {
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];

    for (const id of [...this.liveWidgets.keys()]) {
      this.unmountWidget(id);
    }
  }
}
