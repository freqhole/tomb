import type { Repo } from "@automerge/automerge-repo";
import { Container, Graphics, Text } from "pixi.js";
import { z } from "zod";
import type { WidgetRegistry } from "../../src/widgets/widget-registry";
import type {
  CompactInfo,
  WidgetController,
  WidgetFactory,
  WidgetMountContext,
} from "../../src/widgets/widget-types";
import {
  ACTION_BTN_BG,
  ACTION_BTN_HOVER,
  BIN_HEADER_FONT_SIZE,
  BIN_HEADER_HEIGHT,
  BIN_PADDING,
  HEADER_BG,
  TEXT_COLOR,
  TEXT_MUTED,
} from "./bin-constants";
import { createBinDragHandler } from "./bin-drag";
import { computeRows, firstEmptySlot, hitTestSlot, type BinMode } from "./bin-layout";
import { BinRenderer, type CardInteractionCallbacks } from "./bin-renderer";

// -----------------------------------------------------------------------
// schema
// -----------------------------------------------------------------------

const slotSchema = z.object({
  col: z.number(),
  row: z.number(),
});

const binItemSchema = z.object({
  widgetId: z.string(),
  slot: slotSchema,
});

export const binSchema = z.object({
  /** layout mode */
  mode: z.enum(["grid", "shelf", "crate", "drawer"]).default("grid"),
  /** display title for the bin header */
  title: z.string().default(""),
  /** number of columns */
  cols: z.number().default(3),
  /** number of rows — auto-computed from items.length / cols */
  rows: z.number().default(1),
  /** ordered list of child widgets and their slot positions */
  items: z.array(binItemSchema).default([]),
});

export type BinState = z.infer<typeof binSchema>;

const FONT_FAMILY = "'Atkinson Hyperlegible Next', sans-serif";
const TEXT_RESOLUTION = typeof window !== "undefined" ? Math.max(window.devicePixelRatio, 2) : 2;

// -----------------------------------------------------------------------
// widget factory
// -----------------------------------------------------------------------

export const binWidget: WidgetFactory<typeof binSchema> = {
  type: "bin",

  metadata: {
    name: "bin",
    description: "container that groups widgets in compact layouts",
    version: "0.1.0",
    category: "layout",
    defaultWidth: 320,
    defaultHeight: 240,
  },

  schema: binSchema,

  editableProps: [
    {
      key: "mode",
      label: "layout",
      type: "select",
      options: ["grid", "shelf", "crate", "drawer"],
      default: "grid",
    },
    {
      key: "title",
      label: "title",
      type: "string",
      default: "",
    },
    {
      key: "cols",
      label: "columns",
      type: "number",
      default: 3,
    },
  ],

  getCompactInfo: (state: BinState): CompactInfo => {
    const count = state.items.length;
    const label = state.title || `bin (${count} item${count !== 1 ? "s" : ""})`;
    return { label };
  },

  create(ctx: WidgetMountContext<typeof binSchema>): WidgetController {
    const container = new Container();
    container.label = "bin-widget";

    let currentWidth = ctx.width;
    let currentHeight = ctx.height;
    let destroyed = false;

    // -- resolve dependencies ------------------------------------------------
    // the bin needs access to the automerge repo and widget registry to read
    // child widget docs and call getCompactInfo(). these come from the
    // canvas store (which exposes the repo) and the widget registry (which
    // the mount context doesn't directly provide — but the canvas store's
    // repo is available).

    const store = ctx.canvasStore ?? null;
    const repo: Repo | null = store?.repo ?? null;

    // we need the widget registry to call getCompactInfo on child factories.
    // the registry isn't on the mount context, so we reconstruct a lightweight
    // lookup using the store. this is a known gap — for now we store a
    // reference that gets populated when the renderer is constructed.
    // TODO: consider adding registry to WidgetMountContext in a future refactor.
    let registry: WidgetRegistry | null = null;
    let renderer: BinRenderer | null = null;

    // -- header --------------------------------------------------------------

    const headerContainer = new Container();
    headerContainer.label = "bin-header";
    container.addChild(headerContainer);

    const headerBg = new Graphics();
    headerContainer.addChild(headerBg);

    const titleText = new Text({
      text: "",
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: BIN_HEADER_FONT_SIZE,
        fill: TEXT_COLOR,
      },
      resolution: TEXT_RESOLUTION,
    });
    titleText.x = 6;
    titleText.y = (BIN_HEADER_HEIGHT - BIN_HEADER_FONT_SIZE) / 2;
    headerContainer.addChild(titleText);

    const countBadge = new Text({
      text: "",
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: BIN_HEADER_FONT_SIZE,
        fill: TEXT_MUTED,
      },
      resolution: TEXT_RESOLUTION,
    });
    headerContainer.addChild(countBadge);

    // "add files" button in the header
    const addBtnContainer = new Container();
    addBtnContainer.label = "add-btn";
    addBtnContainer.eventMode = "static";
    addBtnContainer.cursor = "pointer";
    headerContainer.addChild(addBtnContainer);

    const addBtnBg = new Graphics();
    addBtnContainer.addChild(addBtnBg);

    const addBtnText = new Text({
      text: "+ add",
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: BIN_HEADER_FONT_SIZE - 1,
        fill: TEXT_COLOR,
      },
      resolution: TEXT_RESOLUTION,
    });
    addBtnText.x = 6;
    addBtnText.y = 2;
    addBtnContainer.addChild(addBtnText);

    const addBtnW = addBtnText.width + 12;
    const addBtnH = BIN_HEADER_HEIGHT - 6;

    function drawAddBtn(hover = false) {
      addBtnBg.clear();
      addBtnBg.roundRect(0, 0, addBtnW, addBtnH, 3).fill({
        color: hover ? ACTION_BTN_HOVER : ACTION_BTN_BG,
      });
    }

    drawAddBtn();
    addBtnContainer.on("pointerover", () => drawAddBtn(true));
    addBtnContainer.on("pointerout", () => drawAddBtn(false));

    addBtnContainer.on("pointertap", (e: any) => {
      e.stopPropagation();
      handleAddFiles();
    });

    // "snatch all" button in the header
    const snatchBtnContainer = new Container();
    snatchBtnContainer.label = "snatch-btn";
    snatchBtnContainer.eventMode = "static";
    snatchBtnContainer.cursor = "pointer";
    headerContainer.addChild(snatchBtnContainer);

    const snatchBtnBg = new Graphics();
    snatchBtnContainer.addChild(snatchBtnBg);

    const snatchBtnText = new Text({
      text: "snatch all",
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: BIN_HEADER_FONT_SIZE - 1,
        fill: TEXT_COLOR,
      },
      resolution: TEXT_RESOLUTION,
    });
    snatchBtnText.x = 6;
    snatchBtnText.y = 2;
    snatchBtnContainer.addChild(snatchBtnText);

    const snatchBtnW = snatchBtnText.width + 12;
    const snatchBtnH = BIN_HEADER_HEIGHT - 6;
    let snatchInProgress = false;
    let snatchAbortController: AbortController | null = null;

    function drawSnatchBtn(hover = false, active = false) {
      snatchBtnBg.clear();
      snatchBtnBg.roundRect(0, 0, snatchBtnW, snatchBtnH, 3).fill({
        color: active ? 0x5a2727 : hover ? ACTION_BTN_HOVER : ACTION_BTN_BG,
      });
    }

    drawSnatchBtn();
    snatchBtnContainer.on("pointerover", () => drawSnatchBtn(true, snatchInProgress));
    snatchBtnContainer.on("pointerout", () => drawSnatchBtn(false, snatchInProgress));
    snatchBtnContainer.on("pointertap", (e: any) => {
      e.stopPropagation();
      if (snatchInProgress) {
        // cancel in-progress snatch
        snatchAbortController?.abort();
        return;
      }
      handleSnatchAll();
    });

    // -- empty state ---------------------------------------------------------

    const emptyContainer = new Container();
    emptyContainer.label = "bin-empty";
    container.addChild(emptyContainer);

    const emptyBorder = new Graphics();
    emptyContainer.addChild(emptyBorder);

    const emptyText = new Text({
      text: "drop widgets here\nor click + add",
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: 11,
        fill: TEXT_MUTED,
        align: "center",
      },
      resolution: TEXT_RESOLUTION,
    });
    emptyContainer.addChild(emptyText);

    // -- content area --------------------------------------------------------

    const contentContainer = new Container();
    contentContainer.label = "bin-content";
    contentContainer.x = BIN_PADDING;
    contentContainer.y = BIN_HEADER_HEIGHT + BIN_PADDING;
    container.addChild(contentContainer);

    // -- card interaction callbacks -------------------------------------------
    // (created below in the init section after registry is resolved)

    // -- layout and render ---------------------------------------------------

    function drawHeader(width: number) {
      headerBg.clear();
      headerBg.rect(0, 0, width, BIN_HEADER_HEIGHT).fill({ color: HEADER_BG });

      const state = ctx.doc.current;
      const title = state.title || "bin";
      const count = state.items.length;

      titleText.text = title;

      countBadge.text = `${count} item${count !== 1 ? "s" : ""}`;
      countBadge.x = width - countBadge.width - 6;
      countBadge.y = (BIN_HEADER_HEIGHT - BIN_HEADER_FONT_SIZE) / 2;

      // position add button to the left of the count badge
      addBtnContainer.x = countBadge.x - addBtnW - 8;
      addBtnContainer.y = 3;

      // position snatch button to the left of the add button
      snatchBtnContainer.x = addBtnContainer.x - snatchBtnW - 4;
      snatchBtnContainer.y = 3;
    }

    function drawEmpty(width: number, height: number) {
      const contentH = height - BIN_HEADER_HEIGHT;

      emptyBorder.clear();
      emptyBorder
        .roundRect(
          BIN_PADDING,
          BIN_HEADER_HEIGHT + BIN_PADDING,
          width - BIN_PADDING * 2,
          contentH - BIN_PADDING * 2,
          4
        )
        .stroke({ width: 1, color: 0x2a2a2a, alpha: 0.6 });

      emptyText.anchor.set(0.5);
      emptyText.x = width / 2;
      emptyText.y = BIN_HEADER_HEIGHT + contentH / 2;
    }

    function layout(width: number, height: number) {
      if (destroyed) return;

      const state = ctx.doc.current;
      const items = state.items;
      const mode = state.mode as BinMode;
      const cols = Math.max(1, state.cols);
      const rows = computeRows(items.length, cols);

      // auto-update rows in the doc if it diverged
      if (state.rows !== rows) {
        ctx.doc.change((draft) => {
          draft.rows = rows;
        });
      }

      drawHeader(width);

      const hasItems = items.length > 0;
      emptyContainer.visible = !hasItems;
      contentContainer.visible = hasItems;

      if (!hasItems) {
        drawEmpty(width, height);
        return;
      }

      const contentWidth = width - BIN_PADDING * 2;

      if (renderer) {
        renderer.render(items, mode, cols, rows, contentWidth);
      }
    }

    // -- add files flow ------------------------------------------------------

    async function handleAddFiles() {
      if (!store || !repo) return;

      // dynamically import file-utils to avoid circular deps at module level
      const { pickFiles, uploadFile } = await import("../../src/widgets/file-utils");

      const picked = await pickFiles();
      if (!picked || picked.length === 0) return;

      const state = ctx.doc.current;
      const cols = Math.max(1, state.cols);
      let currentItems = [...state.items];

      // pre-load file schema once for all children
      const { fileSchema } = await import("../file");

      for (const file of picked) {
        // find the next empty slot
        const occupiedSet = new Set(currentItems.map((i) => `${i.slot.col},${i.slot.row}`));
        const totalRows = computeRows(currentItems.length + 1, cols);
        let slot: { col: number; row: number } | null = null;
        for (let r = 0; r < totalRows; r++) {
          for (let c = 0; c < cols; c++) {
            if (!occupiedSet.has(`${c},${r}`)) {
              slot = { col: c, row: r };
              break;
            }
          }
          if (slot) break;
        }
        if (!slot) {
          // all slots full — expand rows
          slot = { col: 0, row: totalRows };
        }

        // create a child file widget entry in the canvas doc
        const childId = crypto.randomUUID();
        store.addWidget({
          id: childId,
          type: "file",
          x: 0,
          y: 0,
          width: 200,
          height: 160,
          zIndex: 0,
          props: {},
          collapsed: false,
          docId: null,
          parentId: ctx.widgetId,
        });

        // the widget manager skips widgets with parentId, so no automerge doc
        // was created during reconcile. create the per-widget doc ourselves.
        const defaults = fileSchema.parse({});
        const docHandle = repo.create(defaults);
        store.setDocId(childId, docHandle.documentId);

        // upload the file and write result into the child's automerge doc.
        // on failure, clean up the child widget so we don't leave empty cards.
        try {
          const result = await uploadFile(file, { waitForCompletion: true });

          // write directly into the handle we already hold (no re-find needed)
          docHandle.change((draft: any) => {
            draft.blobId = result.blobId;
            draft.domain = result.domain;
            draft.entityId = result.entityId;
            draft.filename = file.filename;
            draft.mime = result.mime;
            draft.size = result.size;
            draft.blake3 = result.blake3 ?? "";
            draft.thumbnailDataUrl = result.thumbnailDataUrl ?? "";
          });

          // add the item to the bin's items list only on success
          currentItems.push({ widgetId: childId, slot });
          ctx.doc.change((draft) => {
            draft.items.push({ widgetId: childId, slot });
            draft.rows = computeRows(draft.items.length, cols);
          });
        } catch (err) {
          console.warn(`bin: upload failed for ${file.filename}:`, err);
          // clean up the child widget entry — upload failed, no point keeping it
          store.removeWidget(childId);
        }
      }

      // re-layout after all files are added
      layout(currentWidth, currentHeight);
    }

    // -- snatch all flow -----------------------------------------------------

    async function handleSnatchAll() {
      if (!store || !repo || snatchInProgress) return;

      snatchInProgress = true;
      snatchAbortController = new AbortController();
      drawSnatchBtn(false, true);
      snatchBtnText.text = "cancel";

      try {
        const { snatchAllInBin } = await import("./bin-actions");
        const peers = store.peers();

        await snatchAllInBin(ctx.widgetId, store, repo, peers, {
          signal: snatchAbortController.signal,
          onProgress: (progress) => {
            if (progress.done) {
              snatchBtnText.text = "snatch all";
            } else {
              const done = progress.snatched + progress.failed + progress.alreadyLocal;
              snatchBtnText.text = `${done}/${progress.total}`;
            }
          },
        });
      } catch (err) {
        console.warn("bin: snatch all failed:", err);
      } finally {
        snatchInProgress = false;
        snatchAbortController = null;
        snatchBtnText.text = "snatch all";
        drawSnatchBtn();
      }
    }

    // -- init ----------------------------------------------------------------

    // try to get the registry from a well-known location.
    // the bin widget is registered in the same registry that creates it,
    // so we stash a module-level reference during registration.
    registry = _binWidgetRegistry;

    // create drag handler for dragging cards out of the bin.
    // falls back to empty callbacks when dependencies are missing.
    const cardCallbacks: CardInteractionCallbacks =
      store && repo && registry
        ? createBinDragHandler({
            binContainer: container,
            binContentContainer: contentContainer,
            binWidgetId: ctx.widgetId,
            store,
            repo,
            registry,
            onDragOut: (childWidgetId: string) => {
              ctx.doc.change((draft) => {
                const idx = draft.items.findIndex((i: any) => i.widgetId === childWidgetId);
                if (idx !== -1) {
                  draft.items.splice(idx, 1);
                  draft.rows = computeRows(draft.items.length, Math.max(1, draft.cols));
                }
              });
            },
          })
        : {};

    if (repo && registry && store) {
      renderer = new BinRenderer(repo, registry, store, cardCallbacks);
      contentContainer.addChild(renderer.container);
    }

    // initial layout
    layout(currentWidth, currentHeight);

    // subscribe to doc changes
    const unsub = ctx.doc.on("change", () => {
      layout(currentWidth, currentHeight);
    });

    // -- controller ----------------------------------------------------------

    return {
      container,

      resize(width: number, height: number) {
        currentWidth = width;
        currentHeight = height;
        layout(width, height);
      },

      destroy() {
        destroyed = true;
        unsub();
        renderer?.destroy();
        container.destroy({ children: true });
      },

      dropTarget: store
        ? {
            hitTest(worldX: number, worldY: number): boolean {
              // check if the point is within the bin widget's frame bounds.
              // the widget entry in the canvas store has the current x, y, width, height.
              const entry = store.getWidget(ctx.widgetId);
              if (!entry) return false;
              return (
                worldX >= entry.x &&
                worldX <= entry.x + entry.width &&
                worldY >= entry.y &&
                worldY <= entry.y + entry.height
              );
            },

            onHover(worldX: number, worldY: number, _draggedWidgetId: string): void {
              if (!renderer) return;
              const entry = store.getWidget(ctx.widgetId);
              if (!entry) return;

              const state = ctx.doc.current;
              const mode = state.mode as BinMode;
              const cols = Math.max(1, state.cols);
              const contentWidth = entry.width - BIN_PADDING * 2;

              // convert world coordinates to content-local coordinates.
              // the content area starts at (entry.x + BIN_PADDING, entry.y + BIN_HEADER_HEIGHT + BIN_PADDING).
              const localX = worldX - entry.x - BIN_PADDING;
              const localY = worldY - entry.y - BIN_HEADER_HEIGHT - BIN_PADDING;

              // allow one extra row for the potential new item
              const rows = computeRows(state.items.length + 1, cols);
              const slot = hitTestSlot(mode, localX, localY, cols, rows, contentWidth);

              if (slot) {
                // check if this slot is already occupied
                const occupiedSet = new Set(
                  state.items.map((i: any) => `${i.slot.col},${i.slot.row}`)
                );
                if (occupiedSet.has(`${slot.col},${slot.row}`)) {
                  // occupied — show highlight on the first empty slot instead
                  const empty = firstEmptySlot(
                    state.items.map((i: any) => i.slot),
                    cols,
                    rows
                  );
                  renderer.showSlotHighlight(empty);
                } else {
                  renderer.showSlotHighlight(slot);
                }
              } else {
                // pointer is in the bin area but not on a valid slot — find the first empty
                const empty = firstEmptySlot(
                  state.items.map((i: any) => i.slot),
                  cols,
                  rows
                );
                renderer.showSlotHighlight(empty);
              }
            },

            onLeave(): void {
              renderer?.showSlotHighlight(null);
            },

            onDrop(draggedWidgetId: string, worldX: number, worldY: number): boolean {
              if (!store) return false;

              const entry = store.getWidget(ctx.widgetId);
              if (!entry) return false;

              const state = ctx.doc.current;
              const mode = state.mode as BinMode;
              const cols = Math.max(1, state.cols);
              const contentWidth = entry.width - BIN_PADDING * 2;

              // convert to content-local coordinates
              const localX = worldX - entry.x - BIN_PADDING;
              const localY = worldY - entry.y - BIN_HEADER_HEIGHT - BIN_PADDING;

              // find a slot for the dropped widget
              const rows = computeRows(state.items.length + 1, cols);
              const occupied = state.items.map((i: any) => i.slot);
              let slot = hitTestSlot(mode, localX, localY, cols, rows, contentWidth);

              // if the hit slot is occupied, or no slot was hit, find the first empty
              if (slot) {
                const occupiedSet = new Set(occupied.map((s: any) => `${s.col},${s.row}`));
                if (occupiedSet.has(`${slot.col},${slot.row}`)) {
                  slot = firstEmptySlot(occupied, cols, rows);
                }
              } else {
                slot = firstEmptySlot(occupied, cols, rows);
              }

              // fallback: append to a new row
              if (!slot) {
                slot = { col: 0, row: rows };
              }

              // nest the widget: set parentId and add to the bin's items
              store.setParentId(draggedWidgetId, ctx.widgetId);

              ctx.doc.change((draft) => {
                draft.items.push({ widgetId: draggedWidgetId, slot });
                draft.rows = computeRows(draft.items.length, Math.max(1, draft.cols));
              });

              renderer?.showSlotHighlight(null);
              return true;
            },
          }
        : undefined,
    };
  },
};

// -----------------------------------------------------------------------
// registry bootstrapping
// -----------------------------------------------------------------------

// module-level reference set by registerBinWidget() so the bin's create()
// can access the widget registry (needed to call getCompactInfo on children).
let _binWidgetRegistry: WidgetRegistry | null = null;

/**
 * register the bin widget and stash the registry reference so the widget
 * can look up child factories at runtime.
 */
export function registerBinWidget(registry: WidgetRegistry): void {
  _binWidgetRegistry = registry;
  registry.register(binWidget);
}
