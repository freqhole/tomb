import type { DocumentId, Repo } from "@automerge/automerge-repo";
import { Assets, Container, Graphics, Rectangle, Texture } from "pixi.js";
import type { CanvasStore } from "../../src/canvas/canvas-store";
import type { WidgetRegistry } from "../../src/widgets/widget-registry";
import type { CompactInfo } from "../../src/widgets/widget-types";
import { buildCard } from "./bin-card-builders";
import type { BinMode, SlotPosition, SlotSizeOptions } from "./bin-layout";
import { contentDimensions, slotRect } from "./bin-layout";
import type { BinMediaController } from "./bin-media";
import type {
  CardBuildContext,
  CardInteractionCallbacks,
  CardRenderState,
  RenderedCard,
} from "./bin-types";

// re-export for backwards compat (bin-drag.ts used to import from here)
export type { CardInteractionCallbacks } from "./bin-types";

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

  /** optional media controller for audio/video playback on cards */
  private mediaController: BinMediaController | null = null;

  /** callback to get connected canvas peers (for action button snatch targeting) */
  private _getPeers: (() => Record<string, { nodeId: string }> | undefined) | null = null;

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

  /** current scale multiplier — set via render() */
  private scale = 1.0;

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
    visibleHeight?: number,
    scale?: number
  ): void {
    if (this.destroyed) return;

    this.mode = mode;
    this.contentWidth = contentWidth;
    this.visibleHeight = visibleHeight ?? 200;
    this.scale = scale ?? 1.0;

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
    const opts: SlotSizeOptions = { scale: this.scale };
    // in drawer mode, items are remapped to sequential rows — use actual item count
    const effectiveRows = mode === "drawer" ? mappedItems.length : _rows;
    const contentDims = contentDimensions(
      mode,
      Math.max(1, _cols),
      effectiveRows,
      contentWidth,
      opts
    );
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

    const opts: SlotSizeOptions = { scale: this.scale };
    const rect = slotRect(this.mode, slot, this.contentWidth, opts);
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

    const opts: SlotSizeOptions = { scale: this.scale };

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const rect = slotRect(this.mode, { col: c, row: r }, this.contentWidth, opts);
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
   * get the full rendered card for a specific widget, or undefined.
   * used by the media controller to access overlay and metadata.
   */
  getCard(widgetId: string): RenderedCard | undefined {
    return this.cards.get(widgetId);
  }

  /**
   * set the media controller for audio/video playback on cards.
   * the controller is notified when cards are added, updated, or removed
   * so it can attach/detach hover and playback behavior.
   */
  setMediaController(controller: BinMediaController): void {
    this.mediaController = controller;
  }

  /** set the getPeers callback (called from bin index after creating the renderer) */
  setGetPeers(fn: () => Record<string, { nodeId: string }> | undefined): void {
    this._getPeers = fn;
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
    const card = this.buildCardFromState(state);
    this.cards.set(state.widgetId, card);
    this.cardParent.addChild(card.container);
    this.mediaController?.attachToCard(card);
  }

  private updateCard(existing: RenderedCard, state: CardRenderState): void {
    // tear down old visuals
    this.cardParent.removeChild(existing.container);
    this.cleanupCardResources(existing);

    // rebuild
    const card = this.buildCardFromState(state);
    this.cards.set(state.widgetId, card);
    this.cardParent.addChild(card.container);
    this.mediaController?.attachToCard(card);
  }

  private removeCard(widgetId: string): void {
    const card = this.cards.get(widgetId);
    if (!card) return;

    this.mediaController?.detachFromCard(widgetId);
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
  // card construction — delegates to bin-card-builders
  // -----------------------------------------------------------------------

  private buildCardFromState(state: CardRenderState): RenderedCard {
    const ctx: CardBuildContext = {
      mode: this.mode,
      contentWidth: this.contentWidth,
      scale: this.scale,
      shelfTextOrigin: this.shelfTextOrigin,
      visibleHeight: this.visibleHeight,
      loadCardTexture: (url) => this.loadCardTexture(url),
      isAlive: (wid) => !this.destroyed && this.cards.has(wid),
      updateThumbSprite: (wid, sprite) => {
        const card = this.cards.get(wid);
        if (card) card.thumbSprite = sprite;
      },
      attachPointerHandlers: (card, wid) => this.attachCardPointerHandlers(card, wid),
      getPeers: this._getPeers ?? undefined,
    };
    return buildCard(state, ctx);
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

      // wheel handler on scrollInner — catches events that target cards or their
      // children (action buttons, overlays) before they need to bubble to the
      // container level. mirrors the handler on this.container.
      this.scrollInner.on("wheel", (e: WheelEvent) => {
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
