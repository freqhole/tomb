import type { DocumentId, Repo } from "@automerge/automerge-repo";
import { Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { CanvasStore } from "../../src/canvas/canvas-store";
import type { WidgetRegistry } from "../../src/widgets/widget-registry";
import type { CompactInfo } from "../../src/widgets/widget-types";
import {
  CRATE_FONT_SIZE,
  CRATE_THUMB_SIZE,
  DEFAULT_ACCENT_COLOR,
  GRID_CELL_SIZE,
  GRID_LABEL_FONT_SIZE,
  GRID_LABEL_MAX_CHARS,
  SHELF_FONT_SIZE,
  SHELF_SLOT_H,
  SHELF_SLOT_W,
  SLOT_BORDER_COLOR,
  SLOT_EMPTY_BG,
  TEXT_COLOR,
} from "./bin-constants";
import type { BinMode, SlotPosition } from "./bin-layout";
import { slotRect } from "./bin-layout";

const FONT_FAMILY = "'Atkinson Hyperlegible Next', sans-serif";
const TEXT_RESOLUTION = typeof window !== "undefined" ? Math.max(window.devicePixelRatio, 2) : 2;

// -----------------------------------------------------------------------
// types
// -----------------------------------------------------------------------

/** all the state needed to render one compact card */
interface CardRenderState {
  widgetId: string;
  info: CompactInfo;
  slot: SlotPosition;
}

/** a rendered compact card in the container */
interface RenderedCard {
  widgetId: string;
  slot: SlotPosition;
  container: Container;
  /** pixi sprite for the thumbnail (if any) — held so we can destroy the texture */
  thumbSprite: Sprite | null;
  /** the loaded texture key (for asset cache cleanup) */
  textureKey: string | null;
}

/** callback fired when a compact card pointer event happens */
export interface CardInteractionCallbacks {
  onCardPointerDown?: (widgetId: string, e: PointerEvent) => void;
  onCardPointerUp?: (widgetId: string, e: PointerEvent) => void;
  onCardTap?: (widgetId: string, e: PointerEvent) => void;
}

// -----------------------------------------------------------------------
// BinRenderer
// -----------------------------------------------------------------------

/**
 * renders compact cards for the children of a bin widget.
 *
 * the renderer owns a pixi Container that holds all the cards. it reads
 * child widget docs from the automerge repo and uses the widget registry
 * to call `getCompactInfo()` on each child's factory.
 *
 * the renderer does NOT own the child docs — it subscribes for changes
 * and re-renders individual cards when their state changes.
 */
export class BinRenderer {
  /** the pixi container that holds all rendered cards */
  readonly container: Container;

  private readonly repo: Repo;
  private readonly registry: WidgetRegistry;
  private readonly store: CanvasStore;
  private readonly callbacks: CardInteractionCallbacks;

  /** currently rendered cards, keyed by widgetId */
  private cards = new Map<string, RenderedCard>();

  /** unsubscribe functions for child doc change listeners */
  private docUnsubs = new Map<string, () => void>();

  /** graphics overlay for drop-target slot highlighting */
  private slotHighlight: Graphics;
  private highlightedSlot: SlotPosition | null = null;

  /** current layout state — set via render() */
  private mode: BinMode = "grid";
  private contentWidth = 200;

  private destroyed = false;

  constructor(
    repo: Repo,
    registry: WidgetRegistry,
    store: CanvasStore,
    callbacks: CardInteractionCallbacks = {}
  ) {
    this.repo = repo;
    this.registry = registry;
    this.store = store;
    this.callbacks = callbacks;

    this.container = new Container();
    this.container.label = "bin-renderer";

    // slot highlight overlay — drawn on top of cards
    this.slotHighlight = new Graphics();
    this.slotHighlight.visible = false;
    this.container.addChild(this.slotHighlight);
  }

  // -----------------------------------------------------------------------
  // public API
  // -----------------------------------------------------------------------

  /**
   * full render pass: rebuild all compact cards from the given items.
   * call this when the bin's items array changes (items added/removed/reordered)
   * or when the layout mode/dimensions change.
   */
  render(
    items: Array<{ widgetId: string; slot: SlotPosition }>,
    mode: BinMode,
    _cols: number,
    _rows: number,
    contentWidth: number
  ): void {
    if (this.destroyed) return;

    this.mode = mode;
    this.contentWidth = contentWidth;

    // determine which cards to add, update, or remove
    const newIds = new Set(items.map((i) => i.widgetId));
    const oldIds = new Set(this.cards.keys());

    // remove cards that are no longer in the items list
    for (const id of oldIds) {
      if (!newIds.has(id)) {
        this.removeCard(id);
      }
    }

    // add or update cards
    for (const item of items) {
      const info = this.readCompactInfo(item.widgetId);
      if (!info) {
        // widget entry not found or factory doesn't support compact info — skip
        // but still remove stale card if it existed
        if (this.cards.has(item.widgetId)) {
          this.removeCard(item.widgetId);
        }
        continue;
      }

      const existing = this.cards.get(item.widgetId);
      if (existing) {
        // update: re-render in place
        this.updateCard(existing, { widgetId: item.widgetId, info, slot: item.slot });
      } else {
        // new card
        this.addCard({ widgetId: item.widgetId, info, slot: item.slot });
        this.subscribeToChildDoc(item.widgetId);
      }
    }

    // bring highlight to front
    this.container.removeChild(this.slotHighlight);
    this.container.addChild(this.slotHighlight);
  }

  /**
   * show a drop-target highlight on the given slot. pass null to hide.
   */
  showSlotHighlight(slot: SlotPosition | null): void {
    if (!slot) {
      this.slotHighlight.visible = false;
      this.highlightedSlot = null;
      return;
    }

    if (
      this.highlightedSlot &&
      this.highlightedSlot.col === slot.col &&
      this.highlightedSlot.row === slot.row
    ) {
      return; // already highlighting this slot
    }

    const rect = slotRect(this.mode, slot, this.contentWidth);
    this.slotHighlight.clear();
    this.slotHighlight
      .roundRect(rect.x, rect.y, rect.width, rect.height, 3)
      .stroke({ width: 2, color: 0xff1a9e, alpha: 0.8 });
    this.slotHighlight.visible = true;
    this.highlightedSlot = slot;
  }

  /**
   * get the rendered card container for a specific widget, or null.
   * useful for drag-out: clone or detach this container.
   */
  getCardContainer(widgetId: string): Container | null {
    return this.cards.get(widgetId)?.container ?? null;
  }

  /**
   * clean up all cards, textures, and doc subscriptions.
   */
  destroy(): void {
    this.destroyed = true;

    // removeCard() also cleans up doc subscriptions, so no separate loop needed
    for (const id of [...this.cards.keys()]) {
      this.removeCard(id);
    }

    this.slotHighlight.destroy();
    this.container.destroy({ children: true });
  }

  // -----------------------------------------------------------------------
  // card lifecycle
  // -----------------------------------------------------------------------

  private addCard(state: CardRenderState): void {
    const card = this.buildCard(state);
    this.cards.set(state.widgetId, card);
    this.container.addChild(card.container);
  }

  private updateCard(existing: RenderedCard, state: CardRenderState): void {
    // tear down old visuals
    this.container.removeChild(existing.container);
    this.cleanupCardResources(existing);

    // rebuild
    const card = this.buildCard(state);
    this.cards.set(state.widgetId, card);
    this.container.addChild(card.container);
  }

  private removeCard(widgetId: string): void {
    const card = this.cards.get(widgetId);
    if (!card) return;

    this.container.removeChild(card.container);
    this.cleanupCardResources(card);
    this.cards.delete(widgetId);

    // unsubscribe from doc changes
    const unsub = this.docUnsubs.get(widgetId);
    if (unsub) {
      unsub();
      this.docUnsubs.delete(widgetId);
    }
  }

  private cleanupCardResources(card: RenderedCard): void {
    if (card.thumbSprite) {
      card.thumbSprite.destroy();
    }
    if (card.textureKey) {
      Assets.unload(card.textureKey).catch(() => {});
    }
    card.container.destroy({ children: true });
  }

  // -----------------------------------------------------------------------
  // card construction per mode
  // -----------------------------------------------------------------------

  private buildCard(state: CardRenderState): RenderedCard {
    switch (this.mode) {
      case "grid":
        return this.buildGridCard(state);
      case "shelf":
        return this.buildShelfCard(state);
      case "crate":
        return this.buildCrateCard(state);
      case "drawer":
        return this.buildCrateCard(state); // drawer reuses crate rendering for now
    }
  }

  /** grid mode: square thumbnail + label below */
  private buildGridCard(state: CardRenderState): RenderedCard {
    const { info, slot, widgetId } = state;
    const rect = slotRect(this.mode, slot, this.contentWidth);

    const card = new Container();
    card.label = `card-${widgetId}`;
    card.x = rect.x;
    card.y = rect.y;
    card.eventMode = "static";
    card.cursor = "pointer";

    // background
    const bg = new Graphics();
    bg.roundRect(0, 0, GRID_CELL_SIZE, GRID_CELL_SIZE, 3)
      .fill({ color: SLOT_EMPTY_BG })
      .roundRect(0, 0, GRID_CELL_SIZE, GRID_CELL_SIZE, 3)
      .stroke({ width: 1, color: SLOT_BORDER_COLOR });
    card.addChild(bg);

    // thumbnail or fallback
    let thumbSprite: Sprite | null = null;
    let textureKey: string | null = null;

    if (info.thumbnailUrl && info.thumbnailUrl.length > 0) {
      // load thumbnail asynchronously
      const key = `bin-thumb-${widgetId}`;
      textureKey = key;

      Assets.load<Texture>(info.thumbnailUrl)
        .then((tex: Texture) => {
          if (this.destroyed || !this.cards.has(widgetId)) return;

          const sprite = new Sprite(tex);
          sprite.anchor.set(0.5);

          // fit the sprite into the cell, center-cropped
          const scale = Math.max(GRID_CELL_SIZE / tex.width, GRID_CELL_SIZE / tex.height);
          sprite.scale.set(scale);
          sprite.x = GRID_CELL_SIZE / 2;
          sprite.y = GRID_CELL_SIZE / 2;

          // clip to cell bounds
          const mask = new Graphics();
          mask.roundRect(0, 0, GRID_CELL_SIZE, GRID_CELL_SIZE, 3).fill({ color: 0xffffff });
          card.addChild(mask);
          card.addChild(sprite);
          sprite.mask = mask;

          // update the rendered card reference
          const existing = this.cards.get(widgetId);
          if (existing) {
            existing.thumbSprite = sprite;
          }
        })
        .catch(() => {
          // thumbnail load failed — keep fallback
        });
    } else {
      // fallback: colored rect with first letter
      const accent = info.accentColor ?? DEFAULT_ACCENT_COLOR;
      const fallback = new Graphics();
      fallback.roundRect(4, 4, GRID_CELL_SIZE - 8, GRID_CELL_SIZE - 8, 3).fill({
        color: accent,
        alpha: 0.4,
      });
      card.addChild(fallback);

      const letter = info.label.charAt(0).toUpperCase() || "?";
      const letterText = new Text({
        text: letter,
        style: {
          fontFamily: FONT_FAMILY,
          fontSize: 28,
          fill: TEXT_COLOR,
          align: "center",
        },
        resolution: TEXT_RESOLUTION,
      });
      letterText.anchor.set(0.5);
      letterText.x = GRID_CELL_SIZE / 2;
      letterText.y = GRID_CELL_SIZE / 2;
      card.addChild(letterText);
    }

    // filename label below the cell
    const truncated = truncateLabel(info.label, GRID_LABEL_MAX_CHARS);
    const label = new Text({
      text: truncated,
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: GRID_LABEL_FONT_SIZE,
        fill: TEXT_COLOR,
        align: "center",
      },
      resolution: TEXT_RESOLUTION,
    });
    label.anchor.set(0.5, 0);
    label.x = GRID_CELL_SIZE / 2;
    label.y = GRID_CELL_SIZE + 2;
    card.addChild(label);

    // pointer interactions
    this.attachCardPointerHandlers(card, widgetId);

    return { widgetId, slot, container: card, thumbSprite, textureKey };
  }

  /** shelf mode: narrow vertical spine with rotated text */
  private buildShelfCard(state: CardRenderState): RenderedCard {
    const { info, slot, widgetId } = state;
    const rect = slotRect(this.mode, slot, this.contentWidth);
    const accent = info.accentColor ?? DEFAULT_ACCENT_COLOR;

    const card = new Container();
    card.label = `card-${widgetId}`;
    card.x = rect.x;
    card.y = rect.y;
    card.eventMode = "static";
    card.cursor = "pointer";

    // spine background
    const bg = new Graphics();
    bg.roundRect(0, 0, SHELF_SLOT_W, SHELF_SLOT_H, 2).fill({ color: accent, alpha: 0.6 });
    bg.roundRect(0, 0, SHELF_SLOT_W, SHELF_SLOT_H, 2).stroke({
      width: 1,
      color: SLOT_BORDER_COLOR,
    });
    card.addChild(bg);

    // rotated text (bottom-to-top)
    const label = new Text({
      text: truncateLabel(info.label, 14),
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: SHELF_FONT_SIZE,
        fill: TEXT_COLOR,
      },
      resolution: TEXT_RESOLUTION,
    });
    label.anchor.set(0, 0.5);
    label.rotation = -Math.PI / 2;
    label.x = SHELF_SLOT_W / 2 + label.height / 2;
    label.y = SHELF_SLOT_H - 4;
    card.addChild(label);

    this.attachCardPointerHandlers(card, widgetId);

    return { widgetId, slot, container: card, thumbSprite: null, textureKey: null };
  }

  /** crate mode: horizontal row with small thumbnail + text */
  private buildCrateCard(state: CardRenderState): RenderedCard {
    const { info, slot, widgetId } = state;
    const rect = slotRect(this.mode, slot, this.contentWidth);
    const accent = info.accentColor ?? DEFAULT_ACCENT_COLOR;

    const card = new Container();
    card.label = `card-${widgetId}`;
    card.x = rect.x;
    card.y = rect.y;
    card.eventMode = "static";
    card.cursor = "pointer";

    const slotW = this.mode === "drawer" ? this.contentWidth : rect.width;
    const slotH = rect.height;

    // background
    const bg = new Graphics();
    bg.roundRect(0, 0, slotW, slotH, 2).fill({ color: SLOT_EMPTY_BG });
    bg.roundRect(0, 0, slotW, slotH, 2).stroke({ width: 1, color: SLOT_BORDER_COLOR });
    card.addChild(bg);

    // small colored square (thumbnail placeholder)
    const thumbRect = new Graphics();
    const thumbPad = (slotH - CRATE_THUMB_SIZE) / 2;
    thumbRect
      .roundRect(thumbPad, thumbPad, CRATE_THUMB_SIZE, CRATE_THUMB_SIZE, 2)
      .fill({ color: accent, alpha: 0.6 });
    card.addChild(thumbRect);

    // if there's a real thumbnail, load it into the small square
    let thumbSprite: Sprite | null = null;
    let textureKey: string | null = null;

    if (info.thumbnailUrl && info.thumbnailUrl.length > 0) {
      const key = `bin-crate-thumb-${widgetId}`;
      textureKey = key;

      Assets.load<Texture>(info.thumbnailUrl!)
        .then((tex: Texture) => {
          if (this.destroyed || !this.cards.has(widgetId)) return;

          const sprite = new Sprite(tex);
          sprite.anchor.set(0.5);
          const scale = Math.max(CRATE_THUMB_SIZE / tex.width, CRATE_THUMB_SIZE / tex.height);
          sprite.scale.set(scale);
          sprite.x = thumbPad + CRATE_THUMB_SIZE / 2;
          sprite.y = thumbPad + CRATE_THUMB_SIZE / 2;

          // clip to thumb square
          const mask = new Graphics();
          mask
            .roundRect(thumbPad, thumbPad, CRATE_THUMB_SIZE, CRATE_THUMB_SIZE, 2)
            .fill({ color: 0xffffff });
          card.addChild(mask);
          card.addChild(sprite);
          sprite.mask = mask;

          const existing = this.cards.get(widgetId);
          if (existing) {
            existing.thumbSprite = sprite;
          }
        })
        .catch(() => {});
    }

    // filename text
    const textX = thumbPad + CRATE_THUMB_SIZE + 6;
    const maxLabelWidth = slotW - textX - 4;
    const maxChars = Math.max(6, Math.floor(maxLabelWidth / (CRATE_FONT_SIZE * 0.6)));
    const label = new Text({
      text: truncateLabel(info.label, maxChars),
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: CRATE_FONT_SIZE,
        fill: TEXT_COLOR,
      },
      resolution: TEXT_RESOLUTION,
    });
    label.x = textX;
    label.y = (slotH - label.height) / 2;
    card.addChild(label);

    this.attachCardPointerHandlers(card, widgetId);

    return { widgetId, slot, container: card, thumbSprite, textureKey };
  }

  // -----------------------------------------------------------------------
  // pointer interaction
  // -----------------------------------------------------------------------

  private attachCardPointerHandlers(card: Container, widgetId: string): void {
    card.on("pointerdown", (e: any) => {
      e.stopPropagation();
      this.callbacks.onCardPointerDown?.(widgetId, e);
    });

    card.on("pointerup", (e: any) => {
      this.callbacks.onCardPointerUp?.(widgetId, e);
    });

    card.on("pointertap", (e: any) => {
      e.stopPropagation();
      this.callbacks.onCardTap?.(widgetId, e);
    });
  }

  // -----------------------------------------------------------------------
  // child doc subscription
  // -----------------------------------------------------------------------

  /**
   * subscribe to a child widget's automerge doc for changes.
   * when the doc changes, re-render that card with fresh compact info.
   */
  private subscribeToChildDoc(widgetId: string): void {
    // avoid duplicate subscriptions
    if (this.docUnsubs.has(widgetId)) return;

    const entry = this.store.getWidget(widgetId);
    if (!entry?.docId) return;

    try {
      // use the repo's handle cache for synchronous access.
      // handles are cached after creation or first find().
      const handle = this.repo.handles[entry.docId as DocumentId];
      if (!handle) return;

      const listener = () => {
        if (this.destroyed) return;
        this.onChildDocChanged(widgetId);
      };

      handle.on("change", listener);
      this.docUnsubs.set(widgetId, () => {
        handle.off("change", listener);
      });
    } catch {
      // doc not found — that's okay, the card will use stale info
    }
  }

  private onChildDocChanged(widgetId: string): void {
    const card = this.cards.get(widgetId);
    if (!card) return;

    const info = this.readCompactInfo(widgetId);
    if (!info) return;

    this.updateCard(card, { widgetId, info, slot: card.slot });
  }

  // -----------------------------------------------------------------------
  // compact info resolution
  // -----------------------------------------------------------------------

  /**
   * read a child widget's automerge doc and resolve its compact info
   * via the factory's getCompactInfo().
   */
  private readCompactInfo(widgetId: string): CompactInfo | null {
    const entry = this.store.getWidget(widgetId);
    if (!entry) return null;

    const factory = this.registry.get(entry.type);
    if (!factory) return null;

    // if the factory doesn't implement getCompactInfo, use metadata fallback
    if (!factory.getCompactInfo) {
      return {
        label: factory.metadata.name,
      };
    }

    // read the widget's automerge doc
    if (!entry.docId) {
      return {
        label: factory.metadata.name,
      };
    }

    try {
      // use the repo's handle cache for synchronous access.
      // the handle should already be cached because the bin created
      // or found the child widget's doc before adding it to items.
      const handle = this.repo.handles[entry.docId as DocumentId];
      if (!handle) {
        return { label: factory.metadata.name };
      }

      const rawDoc = handle.doc();
      if (!rawDoc) {
        return { label: factory.metadata.name };
      }

      // parse through zod if the factory has a schema
      const state = factory.schema ? factory.schema.parse(rawDoc) : rawDoc;
      return factory.getCompactInfo(state);
    } catch {
      return { label: factory.metadata.name };
    }
  }
}

// -----------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------

function truncateLabel(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + "\u2026";
}
