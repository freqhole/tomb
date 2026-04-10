// trash can widget — a specialized narthex container where soft-deleted
// canvases auto-collect. users can drag cards in to delete, drag out to
// restore, and "empty trash" to purge all.
//
// follows the bin widget pattern (../bin/) but simplified to grid-only
// layout with deletion/restoration semantics on drop/drag-out.

import type { DocumentId, Repo } from "@automerge/automerge-repo";
import { Container, Graphics, Text } from "pixi.js";
import { z } from "zod";
import { CanvasStore } from "../../src/canvas/canvas-store";
import type { WidgetRegistry } from "../../src/widgets/widget-registry";
import type {
  CompactInfo,
  HeaderAction,
  WidgetController,
  WidgetFactory,
  WidgetMountContext,
} from "../../src/widgets/widget-types";
import { BIN_PADDING, TEXT_MUTED } from "../bin/bin-constants";
import { createBinDragHandler } from "../bin/bin-drag";
import {
  autoFitCols,
  computeRows,
  firstEmptySlot,
  hitTestSlot,
  resolveScale,
  type SlotPosition,
  type SlotSizeOptions,
} from "../bin/bin-layout";
import { BinRenderer } from "../bin/bin-renderer";

// -----------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------

const FONT_FAMILY = "'Atkinson Hyperlegible Next', sans-serif";
const TEXT_RESOLUTION = typeof window !== "undefined" ? Math.max(window.devicePixelRatio, 2) : 2;

/** widget type identifier — used for finding the trash widget in the narthex */
export const TRASH_WIDGET_TYPE = "trash";

// colors
const TRASH_EMPTY_BG = 0x1a1a1a;
const TRASH_EMPTY_TEXT = 0x666666;
const TRASH_DROP_HIGHLIGHT = 0x993333;

// -----------------------------------------------------------------------
// schema
// -----------------------------------------------------------------------

const trashItemSchema = z.object({
  widgetId: z.string(),
  slot: z.object({ col: z.number(), row: z.number() }),
});

export const trashSchema = z.object({
  /** child widgets currently in the trash */
  items: z.array(trashItemSchema).default([]),
  /** number of columns — auto-computed from container width */
  cols: z.number().default(3),
  /** number of rows — auto-computed from items.length / cols */
  rows: z.number().default(1),
  /** slot size preset */
  slotScale: z.enum(["s", "m", "l", "xl"]).default("m"),
});

export type TrashState = z.infer<typeof trashSchema>;

// -----------------------------------------------------------------------
// module-level registry reference (same pattern as bin widget)
// -----------------------------------------------------------------------

let _trashWidgetRegistry: WidgetRegistry | null = null;

// -----------------------------------------------------------------------
// widget factory
// -----------------------------------------------------------------------

export const trashWidget: WidgetFactory<typeof trashSchema> = {
  type: TRASH_WIDGET_TYPE,

  metadata: {
    name: "trash",
    description: "trash can for deleted canvases — drag cards in to delete, drag out to restore",
    version: "0.1.0",
    category: "system",
    defaultWidth: 320,
    defaultHeight: 240,
    unique: true, // only one trash widget per canvas — hidden from flyout when present
    preserveChildren: true, // closing the trash un-parents cards back to the narthex
  },

  schema: trashSchema,

  editableProps: [
    {
      key: "slotScale",
      label: "density",
      type: "select",
      options: ["s", "m", "l", "xl"],
      default: "m",
    },
  ],

  getCompactInfo: (state: TrashState): CompactInfo => {
    const count = state.items.length;
    const label = count === 0 ? "trash (empty)" : `trash (${count})`;
    return { label };
  },

  create(ctx: WidgetMountContext<typeof trashSchema>): WidgetController {
    const container = new Container();
    const store = ctx.canvasStore;
    const repo = store?.repo;
    const registry = _trashWidgetRegistry;

    // ---------------------------------------------------------------
    // bail out if dependencies are missing
    // ---------------------------------------------------------------

    if (!store || !repo || !registry) {
      const label = new Text({
        text: "trash (unavailable)",
        style: {
          fontFamily: FONT_FAMILY,
          fontSize: 12,
          fill: TEXT_MUTED,
        },
        resolution: TEXT_RESOLUTION,
      });
      label.x = BIN_PADDING;
      label.y = BIN_PADDING;
      container.addChild(label);
      return {
        container,
        destroy: () => container.destroy({ children: true }),
      };
    }

    // ---------------------------------------------------------------
    // mutable state
    // ---------------------------------------------------------------

    let currentWidth = ctx.width;
    let currentHeight = ctx.height;
    let destroyed = false;

    // ---------------------------------------------------------------
    // empty state
    // ---------------------------------------------------------------

    const emptyBg = new Graphics();
    emptyBg.eventMode = "none";
    container.addChild(emptyBg);

    const emptyLabel = new Text({
      text: "drop canvas cards here to delete",
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: 11,
        fill: TRASH_EMPTY_TEXT,
        wordWrap: true,
        wordWrapWidth: 200,
        align: "center",
      },
      resolution: TEXT_RESOLUTION,
    });
    emptyLabel.anchor.set(0.5, 0.5);
    container.addChild(emptyLabel);

    // ---------------------------------------------------------------
    // drop highlight overlay (shown when hovering a dragged card)
    // ---------------------------------------------------------------

    const dropOverlay = new Graphics();
    dropOverlay.eventMode = "none";
    dropOverlay.visible = false;
    dropOverlay.alpha = 0.15;
    container.addChild(dropOverlay);

    function showDropOverlay(show: boolean): void {
      dropOverlay.clear();
      if (show) {
        dropOverlay.roundRect(0, 0, currentWidth, currentHeight, 6);
        dropOverlay.fill({ color: TRASH_DROP_HIGHLIGHT });
        dropOverlay.visible = true;
      } else {
        dropOverlay.visible = false;
      }
    }

    // ---------------------------------------------------------------
    // resolve scale options for layout math
    // ---------------------------------------------------------------

    function scaleOpts(): SlotSizeOptions {
      return { scale: resolveScale(ctx.doc.current.slotScale) };
    }

    // ---------------------------------------------------------------
    // drag handler — enables dragging items OUT of the trash (restore)
    // ---------------------------------------------------------------

    const dragCallbacks = createBinDragHandler({
      binContainer: container,
      binContentContainer: container, // updated after renderer is created
      binWidgetId: ctx.widgetId,
      store,
      repo,
      registry,
      onDragOut: (widgetId: string) => {
        // remove from items array
        ctx.doc.change((draft: any) => {
          const idx = draft.items.findIndex((i: any) => i.widgetId === widgetId);
          if (idx !== -1) {
            draft.items.splice(idx, 1);
            draft.rows = computeRows(draft.items.length, Math.max(1, draft.cols));
          }
        });

        // restore the linked canvas (clear tombstone fields)
        restoreCanvasForWidget(repo, store, widgetId);

        layout();
        ctx.setHeaderActions?.(buildHeaderActions());
      },
    });

    // ---------------------------------------------------------------
    // renderer
    // ---------------------------------------------------------------

    const renderer = new BinRenderer(repo, registry, store, dragCallbacks);
    container.addChild(renderer.container);

    // patch the drag context to use the renderer's container for coordinates
    (dragCallbacks as any)._binContentContainer = renderer.container;

    // ---------------------------------------------------------------
    // layout
    // ---------------------------------------------------------------

    function layout(): void {
      if (destroyed) return;
      const state = ctx.doc.current;

      // prune stale items whose widgets no longer exist in the narthex.
      // this handles the case where "empty trash" purges canvases and the
      // beforeRemoveHook cascade removes widgets from the narthex doc
      // asynchronously — the trash's items array may still reference them.
      const staleIds: string[] = [];
      for (const item of state.items) {
        if (!store!.getWidget(item.widgetId)) {
          staleIds.push(item.widgetId);
        }
      }
      if (staleIds.length > 0) {
        const staleSet = new Set(staleIds);
        ctx.doc.change((draft: any) => {
          draft.items = draft.items.filter((i: any) => !staleSet.has(i.widgetId));
          draft.rows = computeRows(draft.items.length, Math.max(1, draft.cols));
        });
        // re-read after mutation
        return layout();
      }

      const items = state.items;

      // draw empty background
      emptyBg.clear();
      emptyBg.roundRect(2, 2, currentWidth - 4, currentHeight - 4, 4);
      emptyBg.fill({ color: TRASH_EMPTY_BG, alpha: 0.3 });

      if (items.length === 0) {
        emptyLabel.visible = true;
        emptyLabel.x = currentWidth / 2;
        emptyLabel.y = currentHeight / 2;
        emptyLabel.style.wordWrapWidth = Math.max(100, currentWidth - 40);
        renderer.container.visible = false;
        return;
      }

      emptyLabel.visible = false;
      renderer.container.visible = true;

      // auto-fit columns to available width
      const availableWidth = currentWidth - BIN_PADDING * 2;
      const opts = scaleOpts();
      const fitCols = autoFitCols("grid", availableWidth, opts);
      const cols = Math.max(1, fitCols);
      const rows = computeRows(items.length, cols);

      // auto-update cols/rows if they diverged
      if (state.cols !== cols || state.rows !== rows) {
        ctx.doc.change((draft: any) => {
          draft.cols = cols;
          draft.rows = rows;
        });
      }

      // position renderer content
      renderer.container.x = BIN_PADDING;
      renderer.container.y = BIN_PADDING;

      renderer.render(
        items as Array<{ widgetId: string; slot: SlotPosition }>,
        "grid",
        cols,
        rows,
        availableWidth,
        currentHeight - BIN_PADDING * 2,
        opts.scale
      );
    }

    // ---------------------------------------------------------------
    // header actions
    // ---------------------------------------------------------------

    function buildHeaderActions(): HeaderAction[] {
      const count = ctx.doc.current.items.length;
      const actions: HeaderAction[] = [
        {
          id: "trash-count",
          label: count === 0 ? "empty" : `${count}`,
          isInfo: true,
        },
      ];

      if (count > 0) {
        actions.push({
          id: "empty-trash",
          label: "empty trash",
          onClick: handleEmptyTrash,
        });
      }

      return actions;
    }

    // ---------------------------------------------------------------
    // empty trash action
    // ---------------------------------------------------------------

    async function handleEmptyTrash(): Promise<void> {
      const items = ctx.doc.current.items;
      if (items.length === 0) return;

      const count = items.length;
      const confirmed = window.confirm(
        `permanently delete ${count} canvas${count !== 1 ? "es" : ""}? this can't be undone.`
      );
      if (!confirmed) return;

      // purge each canvas — the purge watchers will auto-remove the cards
      // from the narthex via the beforeRemoveHook cascade
      for (const item of items) {
        await purgeCanvasForWidget(repo!, store!, item.widgetId);
      }

      // the purge cascade removes the widgets from the narthex doc,
      // which triggers reconciliation. the trash's items array will be
      // stale (referencing removed widget IDs). clean it up.
      ctx.doc.change((draft: any) => {
        draft.items = [];
        draft.rows = 1;
      });

      layout();
      ctx.setHeaderActions?.(buildHeaderActions());
    }

    // ---------------------------------------------------------------
    // subscribe to doc changes
    // ---------------------------------------------------------------

    const unsub = ctx.doc.on("change", () => {
      if (!destroyed) {
        layout();
        ctx.setHeaderActions?.(buildHeaderActions());
      }
    });

    // initial render
    layout();

    // ---------------------------------------------------------------
    // drop target — accepts canvas-card widgets dragged onto the trash
    // ---------------------------------------------------------------

    const dropTarget = {
      hitTest(worldX: number, worldY: number): boolean {
        const entry = store!.getWidget(ctx.widgetId);
        if (!entry) return false;
        const localX = worldX - entry.x;
        const localY = worldY - entry.y;
        return localX >= 0 && localX <= currentWidth && localY >= 0 && localY <= currentHeight;
      },

      onHover(worldX: number, worldY: number, _draggedWidgetId: string): void {
        const entry = store!.getWidget(ctx.widgetId);
        if (!entry) return;

        showDropOverlay(true);

        // show slot highlight inside the renderer
        const localX = worldX - entry.x - BIN_PADDING;
        const localY = worldY - entry.y - BIN_PADDING;
        const state = ctx.doc.current;
        const opts = scaleOpts();
        const cols = Math.max(1, state.cols);
        const rows = Math.max(1, state.rows);
        const availableWidth = currentWidth - BIN_PADDING * 2;
        const slot = hitTestSlot("grid", localX, localY, cols, rows, availableWidth, opts);
        renderer.showSlotHighlight(slot);
      },

      onLeave(): void {
        showDropOverlay(false);
        renderer.showSlotHighlight(null);
      },

      onDrop(draggedWidgetId: string, _worldX: number, _worldY: number): boolean {
        showDropOverlay(false);
        renderer.showSlotHighlight(null);

        // only accept canvas-card widgets
        const draggedEntry = store!.getWidget(draggedWidgetId);
        if (!draggedEntry || draggedEntry.type !== "canvas-card") {
          console.log("[trash] rejected drop — not a canvas-card:", draggedEntry?.type);
          return false;
        }

        // check if already in the trash
        const state = ctx.doc.current;
        if (state.items.some((i: any) => i.widgetId === draggedWidgetId)) {
          return true;
        }

        // soft-delete the linked canvas
        softDeleteCanvasForWidget(repo!, store!, draggedWidgetId);

        // parent the widget to the trash
        store!.setParentId(draggedWidgetId, ctx.widgetId);

        // find next empty slot and add to items
        const cols = Math.max(1, state.cols);
        const occupied = state.items.map((i: any) => ({
          col: i.slot.col,
          row: i.slot.row,
        }));
        const maxRows = computeRows(state.items.length + 1, cols);
        const slot = firstEmptySlot(occupied, cols, maxRows) ?? {
          col: 0,
          row: maxRows,
        };

        ctx.doc.change((draft: any) => {
          draft.items.push({ widgetId: draggedWidgetId, slot });
          draft.rows = computeRows(draft.items.length, Math.max(1, draft.cols));
        });

        layout();
        ctx.setHeaderActions?.(buildHeaderActions());

        return true;
      },
    };

    // ---------------------------------------------------------------
    // controller
    // ---------------------------------------------------------------

    return {
      container,
      headerActions: buildHeaderActions(),

      resize(width: number, height: number): void {
        currentWidth = width;
        currentHeight = height;
        layout();
      },

      destroy(): void {
        destroyed = true;
        unsub();
        renderer.destroy();
        container.destroy({ children: true });
      },

      dropTarget,
    };
  },
};

// -----------------------------------------------------------------------
// async helpers — canvas deletion/restoration via card doc → canvas doc
// -----------------------------------------------------------------------

/**
 * read a canvas-card widget's doc to find the linked canvasDocId,
 * then open that canvas and soft-delete it.
 */
export async function softDeleteCanvasForWidget(
  repo: Repo,
  narthexStore: CanvasStore,
  cardWidgetId: string
): Promise<void> {
  try {
    const widget = narthexStore.getWidget(cardWidgetId);
    if (!widget?.docId) return;

    const cardHandle = await repo.find(widget.docId as DocumentId);
    await cardHandle.whenReady();
    const cardDoc = cardHandle.doc() as Record<string, unknown> | undefined;
    if (!cardDoc?.canvasDocId || typeof cardDoc.canvasDocId !== "string") return;

    const canvasStore = await CanvasStore.open(repo, cardDoc.canvasDocId as DocumentId);
    canvasStore.setLocalNodeId(narthexStore.localNodeId);

    // only delete if not already deleted
    if (!canvasStore.isDeleted) {
      canvasStore.deleteCanvas("soft");
      console.log(
        "[trash] soft-deleted canvas:",
        (cardDoc.canvasDocId as string).slice(0, 16) + "..."
      );
    }
  } catch (err) {
    console.warn("[trash] failed to soft-delete canvas for widget:", cardWidgetId, err);
  }
}

/**
 * read a canvas-card widget's doc to find the linked canvasDocId,
 * then open that canvas and clear its tombstone fields (restore).
 */
async function restoreCanvasForWidget(
  repo: Repo,
  narthexStore: CanvasStore,
  cardWidgetId: string
): Promise<void> {
  try {
    const widget = narthexStore.getWidget(cardWidgetId);
    if (!widget?.docId) return;

    const cardHandle = await repo.find(widget.docId as DocumentId);
    await cardHandle.whenReady();
    const cardDoc = cardHandle.doc() as Record<string, unknown> | undefined;
    if (!cardDoc?.canvasDocId || typeof cardDoc.canvasDocId !== "string") return;

    const canvasStore = await CanvasStore.open(repo, cardDoc.canvasDocId as DocumentId);
    canvasStore.setLocalNodeId(narthexStore.localNodeId);

    if (canvasStore.isDeleted) {
      canvasStore.restoreCanvas();
      console.log("[trash] restored canvas:", (cardDoc.canvasDocId as string).slice(0, 16) + "...");
    }
  } catch (err) {
    console.warn("[trash] failed to restore canvas for widget:", cardWidgetId, err);
  }
}

/**
 * read a canvas-card widget's doc to find the linked canvasDocId,
 * then open that canvas and set deleteMode to "purge".
 */
async function purgeCanvasForWidget(
  repo: Repo,
  narthexStore: CanvasStore,
  cardWidgetId: string
): Promise<void> {
  try {
    const widget = narthexStore.getWidget(cardWidgetId);
    if (!widget?.docId) return;

    const cardHandle = await repo.find(widget.docId as DocumentId);
    await cardHandle.whenReady();
    const cardDoc = cardHandle.doc() as Record<string, unknown> | undefined;
    if (!cardDoc?.canvasDocId || typeof cardDoc.canvasDocId !== "string") return;

    const canvasStore = await CanvasStore.open(repo, cardDoc.canvasDocId as DocumentId);
    canvasStore.setLocalNodeId(narthexStore.localNodeId);
    canvasStore.deleteCanvas("purge");

    console.log("[trash] purged canvas:", (cardDoc.canvasDocId as string).slice(0, 16) + "...");
  } catch (err) {
    console.warn("[trash] failed to purge canvas for widget:", cardWidgetId, err);
  }
}

// -----------------------------------------------------------------------
// public helpers for auto-collection from canvas watchers
// -----------------------------------------------------------------------

/**
 * find the trash widget in the narthex. returns the widget entry or null.
 */
export function findTrashWidget(
  narthexStore: CanvasStore
): { id: string; docId: string | undefined } | null {
  const widgets = narthexStore.allWidgets();
  const trash = widgets.find((w) => w.type === TRASH_WIDGET_TYPE);
  return trash ? { id: trash.id, docId: trash.docId ?? undefined } : null;
}

/**
 * move a canvas-card widget into the trash can. performs the two-document
 * operation: (1) set parentId on the widget entry, (2) add to the trash
 * widget's items array.
 *
 * no-op if the card is already parented to the trash or if no trash widget exists.
 */
export async function moveCardToTrash(
  repo: Repo,
  narthexStore: CanvasStore,
  cardWidgetId: string
): Promise<boolean> {
  const trash = findTrashWidget(narthexStore);
  if (!trash || !trash.docId) return false;

  // check if already parented to the trash
  const widget = narthexStore.getWidget(cardWidgetId);
  if (!widget) return false;
  if (widget.parentId === trash.id) return false;

  // 1. set parentId on the widget to nest it inside the trash
  narthexStore.setParentId(cardWidgetId, trash.id);

  // 2. add to the trash's items array
  try {
    const trashHandle = await repo.find(trash.docId as DocumentId);
    await trashHandle.whenReady();

    trashHandle.change((draft: any) => {
      if (!draft.items) draft.items = [];

      // dedup — don't add if already present
      if (draft.items.some((i: any) => i.widgetId === cardWidgetId)) return;

      const occupied = draft.items.map((i: any) => ({
        col: i.slot?.col ?? 0,
        row: i.slot?.row ?? 0,
      }));
      const cols = Math.max(1, draft.cols ?? 3);
      const maxRows = computeRows(draft.items.length + 1, cols);
      const slot = firstEmptySlot(occupied, cols, maxRows) ?? {
        col: 0,
        row: maxRows,
      };

      draft.items.push({ widgetId: cardWidgetId, slot });
      draft.rows = computeRows(draft.items.length, cols);
    });

    console.log("[trash] auto-collected card into trash:", cardWidgetId);
    return true;
  } catch (err) {
    console.warn("[trash] failed to add card to trash items:", cardWidgetId, err);
    return false;
  }
}

/**
 * soft-delete a canvas card and move it to the trash widget.
 * combines softDeleteCanvasForWidget + moveCardToTrash in one call.
 * if no trash widget exists, still soft-deletes the canvas — the card
 * will show the deleted overlay in place and auto-collect when a trash
 * widget is added later.
 *
 * this is used by the canvas-card's onBeforeClose hook to redirect
 * the property tray "delete widget" action through the trash flow.
 */
export async function trashCanvasCard(
  repo: Repo,
  narthexStore: CanvasStore,
  cardWidgetId: string
): Promise<void> {
  await softDeleteCanvasForWidget(repo, narthexStore, cardWidgetId);
  await moveCardToTrash(repo, narthexStore, cardWidgetId);
}

// -----------------------------------------------------------------------
// registration (must be called with the narthex registry)
// -----------------------------------------------------------------------

export function registerTrashWidget(registry: WidgetRegistry): void {
  _trashWidgetRegistry = registry;
  registry.register(trashWidget);
}
