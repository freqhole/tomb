import type { DocumentId, Repo } from "@automerge/automerge-repo";
import { Container, Graphics, Text, type FederatedPointerEvent } from "pixi.js";
import type { CanvasStore } from "../../src/canvas/canvas-store";
import type { WidgetRegistry } from "../../src/widgets/widget-registry";
import type { CardInteractionCallbacks } from "./bin-types";

const FONT_FAMILY = "'Atkinson Hyperlegible Next', sans-serif";
const TEXT_RESOLUTION = typeof window !== "undefined" ? Math.max(window.devicePixelRatio, 2) : 2;

// drag threshold in pixels — prevents accidental drags on tap
const DRAG_THRESHOLD = 5;

// ghost appearance
const GHOST_WIDTH = 120;
const GHOST_HEIGHT = 28;
const GHOST_RADIUS = 4;
const GHOST_BG = 0x2a2a2a;
const GHOST_TEXT_COLOR = 0xe0e0e0;
const GHOST_ALPHA = 0.85;
const GHOST_FONT_SIZE = 10;

// -----------------------------------------------------------------------
// context
// -----------------------------------------------------------------------

export interface BinDragContext {
  /** the bin widget's root container (used to lazily find the pixi stage) */
  binContainer: Container;
  /** the bin's content container (for coordinate reference) */
  binContentContainer: Container;
  /** the bin widget's own ID */
  binWidgetId: string;
  /** canvas store for setParentId, moveWidget, getWidget */
  store: CanvasStore;
  /** automerge repo for reading child widget docs */
  repo: Repo;
  /** widget registry for calling getCompactInfo on child factories */
  registry: WidgetRegistry;
  /** callback when a child is successfully dragged out of the bin */
  onDragOut: (widgetId: string) => void;
  /** callback to try an internal rearrangement when the drop is within the bin.
   * returns true if the rearrangement was performed (drop was within the bin). */
  onInternalMove?: (widgetId: string, worldX: number, worldY: number) => boolean;
  /** called during drag to show slot highlight for potential internal rearrangement */
  onDragMove?: (widgetId: string, worldX: number, worldY: number) => void;
  /** called when drag ends or is cancelled to clean up any highlights */
  onDragEnd?: () => void;
}

// -----------------------------------------------------------------------
// factory
// -----------------------------------------------------------------------

/**
 * create a set of CardInteractionCallbacks that implement drag-out behavior
 * for compact cards in the bin widget.
 *
 * when the user pointer-downs on a card and moves past a small threshold,
 * a semi-transparent ghost label is created and follows the pointer. on
 * release the child widget is un-nested (parentId cleared) and positioned
 * at the drop point in world coordinates so the widget manager can mount
 * it as a standalone frame.
 */
export function createBinDragHandler(ctx: BinDragContext): CardInteractionCallbacks {
  let worldRef: Container | null = null;

  /** get the world container that widget frames live in.
   *  the bin container hierarchy is: binContainer → contentContainer → frame.root → world.
   *  we walk up 3 levels from the bin container. */
  function getWorld(): Container {
    if (!worldRef) {
      let current: Container = ctx.binContainer;
      for (let i = 0; i < 3 && current.parent; i++) {
        current = current.parent;
      }
      worldRef = current;
    }
    return worldRef;
  }

  // -- drag state ----------------------------------------------------------

  let dragCandidate: {
    widgetId: string;
    startX: number;
    startY: number;
  } | null = null;

  let dragging = false;
  let ghost: Container | null = null;
  let lastGlobalX = 0;
  let lastGlobalY = 0;

  // references to pixi listeners so we can remove them on cleanup
  let activeCardTarget: Container | null = null;
  let moveHandler: ((e: FederatedPointerEvent) => void) | null = null;
  let upHandler: (() => void) | null = null;

  // -- helpers -------------------------------------------------------------

  /** read a human-friendly label for a child widget via its factory's getCompactInfo */
  function readLabel(widgetId: string): string {
    const entry = ctx.store.getWidget(widgetId);
    if (!entry) return "widget";

    const factory = ctx.registry.get(entry.type);
    if (!factory?.getCompactInfo || !entry.docId) {
      return factory?.metadata.name ?? entry.type;
    }

    try {
      const handle = ctx.repo.handles[entry.docId as DocumentId];
      if (!handle) return factory.metadata.name;

      const rawDoc = handle.doc();
      if (!rawDoc) return factory.metadata.name;

      const state = factory.schema ? factory.schema.parse(rawDoc) : rawDoc;
      return factory.getCompactInfo(state).label;
    } catch {
      return factory?.metadata.name ?? entry.type;
    }
  }

  /** create the small floating ghost container added to the stage during drag */
  function createGhostContainer(label: string): Container {
    const c = new Container();
    c.alpha = GHOST_ALPHA;
    c.label = "bin-drag-ghost";

    const bg = new Graphics();
    bg.roundRect(0, 0, GHOST_WIDTH, GHOST_HEIGHT, GHOST_RADIUS).fill({
      color: GHOST_BG,
    });
    c.addChild(bg);

    const text = new Text({
      text: label,
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: GHOST_FONT_SIZE,
        fill: GHOST_TEXT_COLOR,
      },
      resolution: TEXT_RESOLUTION,
    });
    text.x = 6;
    text.y = Math.round((GHOST_HEIGHT - GHOST_FONT_SIZE) / 2);
    c.addChild(text);

    return c;
  }

  /** tear down all listeners and destroy the ghost if present */
  function cleanup(): void {
    ctx.onDragEnd?.();
    if (activeCardTarget && moveHandler) {
      activeCardTarget.off("globalpointermove", moveHandler);
    }
    if (activeCardTarget && upHandler) {
      activeCardTarget.off("pointerup", upHandler);
      activeCardTarget.off("pointerupoutside", upHandler);
    }

    if (ghost) {
      ghost.parent?.removeChild(ghost);
      ghost.destroy({ children: true });
      ghost = null;
    }

    dragCandidate = null;
    dragging = false;
    activeCardTarget = null;
    moveHandler = null;
    upHandler = null;
  }

  // -- callbacks -----------------------------------------------------------

  return {
    onCardPointerDown(widgetId: string, e: PointerEvent): void {
      // clean up any in-progress drag (shouldn't normally happen)
      if (dragCandidate || dragging) {
        cleanup();
      }

      // the bin-renderer passes a pixi FederatedPointerEvent typed as PointerEvent
      const pe = e as unknown as FederatedPointerEvent;

      dragCandidate = {
        widgetId,
        startX: pe.global.x,
        startY: pe.global.y,
      };
      lastGlobalX = pe.global.x;
      lastGlobalY = pe.global.y;

      // the currentTarget is the card container that received the pointerdown.
      // we attach globalpointermove / pointerup / pointerupoutside on it so
      // pixi delivers events for the entire drag lifecycle. globalpointermove
      // fires on any interactive object regardless of pointer position.
      activeCardTarget = pe.currentTarget as Container;

      moveHandler = (moveEvent: FederatedPointerEvent) => {
        if (!dragCandidate) return;

        lastGlobalX = moveEvent.global.x;
        lastGlobalY = moveEvent.global.y;

        const dx = moveEvent.global.x - dragCandidate.startX;
        const dy = moveEvent.global.y - dragCandidate.startY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (!dragging && dist > DRAG_THRESHOLD) {
          // crossed the threshold — promote to a real drag
          dragging = true;
          const label = readLabel(dragCandidate.widgetId);
          ghost = createGhostContainer(label);

          const world = getWorld();
          world.addChild(ghost);
        }

        if (dragging && ghost) {
          // position the ghost in world-local coordinates so it
          // tracks the pointer regardless of pan / zoom
          const world = getWorld();
          const local = world.toLocal(moveEvent.global);
          ghost.x = local.x;
          ghost.y = local.y;

          // show slot highlight for potential internal rearrangement
          if (dragCandidate) {
            ctx.onDragMove?.(dragCandidate.widgetId, local.x, local.y);
          }
        }
      };

      upHandler = () => {
        if (dragging && dragCandidate) {
          const world = getWorld();
          const worldPos = world.toLocal({ x: lastGlobalX, y: lastGlobalY });

          // try internal rearrangement first — if the drop is within the bin,
          // just move the item to a different slot without un-nesting
          const handled = ctx.onInternalMove?.(dragCandidate.widgetId, worldPos.x, worldPos.y);

          if (!handled) {
            // drop was outside the bin — un-nest and move to world
            ctx.store.unparentAndMove(dragCandidate.widgetId, worldPos.x, worldPos.y);
            ctx.onDragOut(dragCandidate.widgetId);
          }
        }

        // clean up highlight from internal drag
        ctx.onDragEnd?.();
        cleanup();
      };

      activeCardTarget.on("globalpointermove", moveHandler);
      activeCardTarget.on("pointerup", upHandler);
      activeCardTarget.on("pointerupoutside", upHandler);
    },
  };
}
