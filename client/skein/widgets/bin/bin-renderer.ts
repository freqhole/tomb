import type { DocumentId, Repo } from "@automerge/automerge-repo";
import { Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";
import type { CanvasStore } from "../../src/canvas/canvas-store";
import type { WidgetRegistry } from "../../src/widgets/widget-registry";
import type { CompactInfo } from "../../src/widgets/widget-types";
import {
  CRATE_FONT_SIZE,
  DEFAULT_ACCENT_COLOR,
  DRAWER_FONT_SIZE,
  GRID_CELL_SIZE,
  GRID_LABEL_FONT_SIZE,
  GRID_LABEL_MAX_CHARS,
  SHELF_ENDCAP_H,
  SHELF_FONT_SIZE,
  SHELF_SLOT_H,
  SHELF_SLOT_W,
  SLOT_BORDER_COLOR,
  SLOT_EMPTY_BG,
  TEXT_COLOR,
} from "./bin-constants";
import type { BinMode, SlotPosition } from "./bin-layout";
import { contentDimensions, slotRect } from "./bin-layout";

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

  /** grid slot outlines — visible on hover to show drop targets */
  private gridOutlines: Graphics;

  /** current layout state — set via render() */
  private mode: BinMode = "grid";
  private contentWidth = 200;

  /** shelf text direction — top = text reads top-to-bottom, bottom = bottom-to-top */
  shelfTextOrigin: "top" | "bottom" = "top";

  /** current scroll offset — used by drop target to convert world coords to content coords in drawer mode */
  getScrollOffset(): number {
    return this.mode === "drawer" ? this.scrollY : 0;
  }

  private destroyed = false;

  /** drawer mode: current scroll offset (px) */
  private scrollY = 0;
  /** drawer mode: total content height (px) */
  private totalContentHeight = 0;
  /** drawer mode: visible area height (px) */
  private visibleHeight = 0;
  /** drawer mode: scroll container that clips content */
  private scrollMask: Graphics | null = null;
  /** drawer mode: inner container that moves with scroll */
  private scrollInner: Container | null = null;

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

    // grid slot outlines — behind cards, visible on hover
    this.gridOutlines = new Graphics();
    this.gridOutlines.visible = false;
    this.gridOutlines.label = "grid-outlines";
    this.container.addChild(this.gridOutlines);

    // slot highlight overlay — drawn on top of cards
    this.slotHighlight = new Graphics();
    this.slotHighlight.visible = false;
    this.container.addChild(this.slotHighlight);

    // wheel handler for drawer mode scroll — on the root container so it
    // catches events from cards inside scrollInner. an explicit hitArea is
    // set in setupDrawerScroll() so events fire even in gaps between cards.
    this.container.eventMode = "static";
    this.container.on("wheel", (e: WheelEvent) => {
      if (this.mode !== "drawer") return;
      const canScroll = this.totalContentHeight > this.visibleHeight;
      if (!canScroll) return;

      e.stopPropagation();
      if ((e as any).nativeEvent) (e as any).nativeEvent._skeinWidgetScroll = true;

      const SCROLL_SPEED = 30;
      this.scrollY += e.deltaY > 0 ? SCROLL_SPEED : -SCROLL_SPEED;
      this.clampScroll();
      this.positionScrollInner();
    });
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
    contentWidth: number,
    visibleHeight?: number
  ): void {
    if (this.destroyed) return;

    this.mode = mode;
    this.contentWidth = contentWidth;
    this.visibleHeight = visibleHeight ?? 200;

    // drawer mode: items stack sequentially regardless of stored slot positions.
    // when switching from grid (cols>1) to drawer, items may share the same row,
    // causing overlap. remap to sequential single-column rows.
    const mappedItems =
      mode === "drawer"
        ? items.map((item, idx) => ({ ...item, slot: { col: 0, row: idx } }))
        : items;

    // set up or tear down drawer scroll infrastructure
    if (mode === "drawer") {
      this.setupDrawerScroll(contentWidth);
    } else {
      this.teardownDrawerScroll();
    }

    // ensure grid outlines are in the correct parent (scrollInner for drawer, container for others)
    if (this.gridOutlines.parent !== this.cardParent) {
      this.gridOutlines.parent?.removeChild(this.gridOutlines);
      this.cardParent.addChild(this.gridOutlines);
    }

    // determine which cards to add, update, or remove
    const newIds = new Set(mappedItems.map((i) => i.widgetId));
    const oldIds = new Set(this.cards.keys());

    // remove cards that are no longer in the items list
    for (const id of oldIds) {
      if (!newIds.has(id)) {
        this.removeCard(id);
      }
    }

    // add or update cards
    for (const item of mappedItems) {
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
        // ensure the child's automerge handle is loaded (may be cold after page reload)
        const childEntry = this.store.getWidget(item.widgetId);
        if (childEntry?.docId) {
          this.ensureHandle(item.widgetId, childEntry.docId);
        }
      }
    }

    // compute total content height for scroll
    const contentDims = contentDimensions(mode, Math.max(1, _cols), _rows, contentWidth);
    this.totalContentHeight = contentDims.height;

    // clamp scroll in case content shrank
    if (mode === "drawer") {
      this.clampScroll();
      this.positionScrollInner();
    }

    // redraw grid outlines for the new layout
    this.drawGridOutlines(Math.max(1, _cols), _rows);

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

  /** show or hide the slot grid outlines */
  setGridVisible(visible: boolean): void {
    this.gridOutlines.visible = visible;
  }

  /** redraw the slot grid outlines for the current layout */
  private drawGridOutlines(cols: number, rows: number): void {
    this.gridOutlines.clear();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const rect = slotRect(this.mode, { col: c, row: r }, this.contentWidth);
        this.gridOutlines
          .roundRect(rect.x, rect.y, rect.width, rect.height, 3)
          .stroke({ width: 1, color: 0x333333, alpha: 0.5 });
      }
    }
  }

  /** the container that cards are added to (scrollInner in drawer mode, main container otherwise) */
  private get cardParent(): Container {
    return this.scrollInner ?? this.container;
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
    this.teardownDrawerScroll();

    // removeCard() also cleans up doc subscriptions, so no separate loop needed
    for (const id of [...this.cards.keys()]) {
      this.removeCard(id);
    }

    this.gridOutlines.destroy();
    this.slotHighlight.destroy();
    this.container.destroy({ children: true });
  }

  // -----------------------------------------------------------------------
  // card lifecycle
  // -----------------------------------------------------------------------

  private addCard(state: CardRenderState): void {
    const card = this.buildCard(state);
    this.cards.set(state.widgetId, card);
    this.cardParent.addChild(card.container);
  }

  private updateCard(existing: RenderedCard, state: CardRenderState): void {
    // tear down old visuals
    this.cardParent.removeChild(existing.container);
    this.cleanupCardResources(existing);

    // rebuild
    const card = this.buildCard(state);
    this.cards.set(state.widgetId, card);
    this.cardParent.addChild(card.container);
  }

  private removeCard(widgetId: string): void {
    const card = this.cards.get(widgetId);
    if (!card) return;

    this.cardParent.removeChild(card.container);
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
      // skip data: URLs — they're small thumbnails that may be shared with the
      // file widget (which loads the same data URL from the asset cache). unloading
      // here would destroy the shared texture source and cause addressModeU crashes.
      if (!card.textureKey.startsWith("data:")) {
        const keyToUnload = card.textureKey;
        // defer unload to next frame so the renderer doesn't access a destroyed texture
        requestAnimationFrame(() => {
          try {
            Assets.unload(keyToUnload);
          } catch {
            /* ignored */
          }
        });
      }
    }
    card.container.destroy({ children: true });
  }

  /**
   * safely load a texture from a URL (typically a data URL).
   * validates the texture has a usable GPU source before returning.
   * returns null if loading fails or the texture is invalid.
   */
  private async loadCardTexture(url: string): Promise<Texture | null> {
    try {
      const tex = await Assets.load<Texture>(url);
      // guard against invalid GPU sources that cause addressModeU / alphaMode crashes
      if (!tex || !tex.source?.style) {
        // only unload non-data: URLs — data: thumbnails are shared across consumers
        if (!url.startsWith("data:")) {
          try {
            Assets.unload(url);
          } catch {
            /* ignored */
          }
        }
        return null;
      }
      return tex;
    } catch {
      return null;
    }
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
        return this.buildDrawerCard(state);
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
      textureKey = info.thumbnailUrl;

      this.loadCardTexture(info.thumbnailUrl).then((tex) => {
        if (!tex || this.destroyed || !this.cards.has(widgetId)) return;

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
    // use full cell width for label — compute max chars dynamically
    const maxGridChars = Math.max(
      GRID_LABEL_MAX_CHARS,
      Math.floor(GRID_CELL_SIZE / (GRID_LABEL_FONT_SIZE * 0.55))
    );
    const truncated = truncateLabel(info.label, maxGridChars);
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

  /** shelf mode: narrow vertical spine with endcap thumbnail + rotated text */
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

    // endcap thumbnail at top of spine
    let thumbSprite: Sprite | null = null;
    let textureKey: string | null = null;
    const endcapH = SHELF_ENDCAP_H;

    if (info.thumbnailUrl && info.thumbnailUrl.length > 0) {
      textureKey = info.thumbnailUrl;

      // placeholder background for the endcap area
      const thumbBg = new Graphics();
      thumbBg.rect(0, 0, SHELF_SLOT_W, endcapH).fill({ color: accent, alpha: 0.3 });
      card.addChild(thumbBg);

      this.loadCardTexture(info.thumbnailUrl).then((tex) => {
        if (!tex || this.destroyed || !this.cards.has(widgetId)) return;

        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5);
        // fill-crop into endcap area (flush, no margin)
        const scale = Math.max(SHELF_SLOT_W / tex.width, endcapH / tex.height);
        sprite.scale.set(scale);
        sprite.x = SHELF_SLOT_W / 2;
        sprite.y = endcapH / 2;

        const mask = new Graphics();
        mask.rect(0, 0, SHELF_SLOT_W, endcapH).fill({ color: 0xffffff });
        card.addChild(mask);
        card.addChild(sprite);
        sprite.mask = mask;

        const existing = this.cards.get(widgetId);
        if (existing) existing.thumbSprite = sprite;
      });
    } else {
      // fallback: accent letter in the endcap area
      const letter = info.label.charAt(0).toUpperCase() || "?";
      const letterText = new Text({
        text: letter,
        style: {
          fontFamily: FONT_FAMILY,
          fontSize: 14,
          fill: TEXT_COLOR,
          align: "center",
        },
        resolution: TEXT_RESOLUTION,
      });
      letterText.anchor.set(0.5);
      letterText.x = SHELF_SLOT_W / 2;
      letterText.y = endcapH / 2;
      card.addChild(letterText);
    }

    // rotated text — direction based on shelfTextOrigin
    const textAreaH = SHELF_SLOT_H - endcapH - 4;
    const maxChars = Math.max(4, Math.floor(textAreaH / (SHELF_FONT_SIZE * 0.7)));
    const label = new Text({
      text: truncateLabel(info.label, maxChars),
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: SHELF_FONT_SIZE,
        fill: TEXT_COLOR,
      },
      resolution: TEXT_RESOLUTION,
    });
    label.anchor.set(0, 0.5);

    if (this.shelfTextOrigin === "top") {
      // text reads top-to-bottom (clockwise rotation)
      label.rotation = Math.PI / 2;
      label.x = SHELF_SLOT_W / 2 - label.height / 2;
      label.y = endcapH + 2;
    } else {
      // text reads bottom-to-top (counter-clockwise rotation — original behavior)
      label.rotation = -Math.PI / 2;
      label.x = SHELF_SLOT_W / 2 + label.height / 2;
      label.y = SHELF_SLOT_H - 2;
    }
    card.addChild(label);

    this.attachCardPointerHandlers(card, widgetId);

    return { widgetId, slot, container: card, thumbSprite, textureKey };
  }

  /** crate mode: horizontal row with flush-left endcap thumbnail + text */
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

    // crate rows use full content width
    const slotW = this.contentWidth;
    const slotH = rect.height;

    // background
    const bg = new Graphics();
    bg.roundRect(0, 0, slotW, slotH, 2).fill({ color: SLOT_EMPTY_BG });
    bg.roundRect(0, 0, slotW, slotH, 2).stroke({ width: 1, color: SLOT_BORDER_COLOR });
    card.addChild(bg);

    // endcap thumbnail — flush left, square matching row height
    const endcapW = slotH;
    let thumbSprite: Sprite | null = null;
    let textureKey: string | null = null;

    // endcap placeholder
    const thumbBg = new Graphics();
    thumbBg.rect(0, 0, endcapW, slotH).fill({ color: accent, alpha: 0.6 });
    card.addChild(thumbBg);

    if (info.thumbnailUrl && info.thumbnailUrl.length > 0) {
      textureKey = info.thumbnailUrl;

      this.loadCardTexture(info.thumbnailUrl).then((tex) => {
        if (!tex || this.destroyed || !this.cards.has(widgetId)) return;

        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5);
        // fill-crop into endcap area
        const scale = Math.max(endcapW / tex.width, slotH / tex.height);
        sprite.scale.set(scale);
        sprite.x = endcapW / 2;
        sprite.y = slotH / 2;

        const mask = new Graphics();
        mask.rect(0, 0, endcapW, slotH).fill({ color: 0xffffff });
        card.addChild(mask);
        card.addChild(sprite);
        sprite.mask = mask;

        const existing = this.cards.get(widgetId);
        if (existing) existing.thumbSprite = sprite;
      });
    } else {
      // fallback: letter in endcap
      const letter = info.label.charAt(0).toUpperCase() || "?";
      const letterText = new Text({
        text: letter,
        style: {
          fontFamily: FONT_FAMILY,
          fontSize: 14,
          fill: TEXT_COLOR,
        },
        resolution: TEXT_RESOLUTION,
      });
      letterText.anchor.set(0.5);
      letterText.x = endcapW / 2;
      letterText.y = slotH / 2;
      card.addChild(letterText);
    }

    // filename text — to the right of the endcap, full remaining width
    const textX = endcapW + 6;
    const maxLabelWidth = slotW - textX - 4;
    const maxChars = Math.max(6, Math.floor(maxLabelWidth / (CRATE_FONT_SIZE * 0.55)));
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

  /** drawer mode: full-width horizontal rows with flush-left endcap + text */
  private buildDrawerCard(state: CardRenderState): RenderedCard {
    const { info, slot, widgetId } = state;
    const rect = slotRect("drawer", slot, this.contentWidth);
    const accent = info.accentColor ?? DEFAULT_ACCENT_COLOR;

    const card: RenderedCard = {
      widgetId,
      slot,
      container: new Container(),
      thumbSprite: null,
      textureKey: null,
    };

    card.container.label = `card-${widgetId}`;
    card.container.x = rect.x;
    card.container.y = rect.y;
    card.container.eventMode = "static";
    card.container.cursor = "pointer";

    const slotW = rect.width;
    const slotH = rect.height;

    // background
    const bg = new Graphics();
    bg.roundRect(0, 0, slotW, slotH, 3).fill({ color: accent, alpha: 0.15 });
    bg.roundRect(0, 0, slotW, slotH, 3).stroke({ width: 1, color: SLOT_BORDER_COLOR });
    card.container.addChild(bg);

    // endcap thumbnail — flush left, square matching row height
    const endcapW = slotH;

    // endcap placeholder
    const thumbBg = new Graphics();
    thumbBg.rect(0, 0, endcapW, slotH).fill({ color: accent, alpha: 0.3 });
    card.container.addChild(thumbBg);

    if (info.thumbnailUrl && info.thumbnailUrl.length > 0) {
      card.textureKey = info.thumbnailUrl;

      this.loadCardTexture(info.thumbnailUrl).then((tex) => {
        if (!tex || this.destroyed || !this.cards.has(widgetId)) return;

        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5);
        // fill-crop into endcap area
        const scale = Math.max(endcapW / tex.width, slotH / tex.height);
        sprite.scale.set(scale);
        sprite.x = endcapW / 2;
        sprite.y = slotH / 2;

        const mask = new Graphics();
        mask.rect(0, 0, endcapW, slotH).fill({ color: 0xffffff });
        card.container.addChild(mask);
        sprite.mask = mask;
        card.container.addChild(sprite);
        card.thumbSprite = sprite;
      });
    } else {
      // fallback: letter in endcap
      const letter = info.label.charAt(0).toUpperCase() || "?";
      const letterText = new Text({
        text: letter,
        style: {
          fontFamily: FONT_FAMILY,
          fontSize: 16,
          fill: TEXT_COLOR,
        },
        resolution: TEXT_RESOLUTION,
      });
      letterText.anchor.set(0.5);
      letterText.x = endcapW / 2;
      letterText.y = slotH / 2;
      card.container.addChild(letterText);
    }

    // text label — to the right of the endcap, full remaining width
    const textX = endcapW + 8;
    const maxLabelWidth = slotW - textX - 8;
    const maxChars = Math.max(8, Math.floor(maxLabelWidth / (DRAWER_FONT_SIZE * 0.55)));
    const label = new Text({
      text: truncateLabel(info.label, maxChars),
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: DRAWER_FONT_SIZE,
        fill: TEXT_COLOR,
      },
      resolution: TEXT_RESOLUTION,
    });
    label.x = textX;
    label.y = (slotH - label.height) / 2;
    card.container.addChild(label);

    this.attachCardPointerHandlers(card.container, widgetId);

    return card;
  }

  // -----------------------------------------------------------------------
  // drawer scroll infrastructure
  // -----------------------------------------------------------------------

  private setupDrawerScroll(contentWidth: number): void {
    if (!this.scrollInner) {
      this.scrollInner = new Container();
      this.scrollInner.label = "drawer-scroll-inner";
      this.scrollInner.eventMode = "static";
      this.container.addChild(this.scrollInner);

      // mask to clip content to the visible area
      this.scrollMask = new Graphics();
      this.container.addChild(this.scrollMask);
      this.scrollInner.mask = this.scrollMask;
    }

    // update mask dimensions
    this.scrollMask!.clear();
    this.scrollMask!.rect(0, 0, contentWidth, this.visibleHeight).fill({ color: 0xffffff });

    // explicit hit area so wheel events fire anywhere in the visible region
    // (without this, Pixi only fires events on child bounds which miss gaps between cards)
    this.container.hitArea = new Rectangle(0, 0, contentWidth, this.visibleHeight);
  }

  private teardownDrawerScroll(): void {
    if (this.scrollInner) {
      // move any existing cards from scrollInner back to the main container
      while (this.scrollInner.children.length > 0) {
        const child = this.scrollInner.children[0];
        this.scrollInner.removeChild(child);
        this.container.addChild(child);
      }

      this.scrollInner.mask = null;
      this.container.removeChild(this.scrollInner);
      this.scrollInner.destroy({ children: false }); // don't destroy moved children
      this.scrollInner = null;

      if (this.scrollMask) {
        this.container.removeChild(this.scrollMask);
        this.scrollMask.destroy();
        this.scrollMask = null;
      }

      this.scrollY = 0;
    }

    // clear the explicit hit area so non-drawer modes use child-based hit testing
    this.container.hitArea = null;
  }

  private clampScroll(): void {
    const maxScroll = Math.max(0, this.totalContentHeight - this.visibleHeight);
    this.scrollY = Math.max(0, Math.min(this.scrollY, maxScroll));
  }

  private positionScrollInner(): void {
    if (this.scrollInner) {
      this.scrollInner.y = -this.scrollY;
    }
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
   * ensure a child widget's automerge handle is in the repo cache.
   * after a page reload, handles for parented widgets are not pre-loaded
   * because the widget manager skips mounting them. this method kicks off
   * repo.find() and re-renders the card once the handle is ready.
   */
  private ensureHandle(widgetId: string, docId: string): void {
    // already cached — nothing to do
    if (this.repo.handles[docId as DocumentId]) return;

    // repo.find() returns Promise<DocHandle>. once found, wait for the doc
    // to be ready, then re-render the card with real compact info.
    this.repo
      .find<any>(docId as DocumentId)
      .then((handle) => handle.whenReady())
      .then(() => {
        if (this.destroyed) return;
        // re-render the card with fresh compact info now that the handle is available
        this.onChildDocChanged(widgetId);
        // set up change subscription if we haven't already
        this.subscribeToChildDoc(widgetId);
      })
      .catch(() => {
        // handle not available — card will use fallback label
      });
  }

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
