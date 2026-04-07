// shared types for the bin widget modules.
// extracted from bin-renderer.ts to avoid circular imports between
// bin-renderer, bin-card-builders, bin-drag, and index.

import type { Container, Sprite, Texture } from "pixi.js";
import type { CompactInfo } from "../../src/widgets/widget-types";
import type { BinMode, SlotPosition } from "./bin-layout";

// -----------------------------------------------------------------------
// card data
// -----------------------------------------------------------------------

/** all the state needed to render one compact card */
export interface CardRenderState {
  widgetId: string;
  info: CompactInfo;
  slot: SlotPosition;
}

/** a rendered compact card in the container */
export interface RenderedCard {
  widgetId: string;
  slot: SlotPosition;
  container: Container;
  /** pixi sprite for the thumbnail (if any) — held so we can destroy the texture */
  thumbSprite: Sprite | null;
  /** the loaded texture key (for asset cache cleanup) */
  textureKey: string | null;
}

// -----------------------------------------------------------------------
// interaction callbacks
// -----------------------------------------------------------------------

/** callback fired when a compact card pointer event happens */
export interface CardInteractionCallbacks {
  onCardPointerDown?: (widgetId: string, e: PointerEvent) => void;
  onCardPointerUp?: (widgetId: string, e: PointerEvent) => void;
  onCardTap?: (widgetId: string, e: PointerEvent) => void;
}

// -----------------------------------------------------------------------
// card builder context
// -----------------------------------------------------------------------

/**
 * context passed to card builder functions.
 *
 * the builder functions are pure-ish: they create a pixi container for one
 * compact card and return a RenderedCard. async texture loading is handled
 * via callbacks so the builders don't need a reference to the full renderer.
 */
export interface CardBuildContext {
  /** current layout mode */
  mode: BinMode;
  /** available content width (px) */
  contentWidth: number;
  /** slot scale multiplier (0.6 | 1.0 | 1.5 | 2.0) */
  scale: number;
  /** shelf text direction */
  shelfTextOrigin: "top" | "bottom";
  /** visible area height — used by shelf mode to match spine height to container */
  visibleHeight: number;

  // -- async callbacks (the builder kicks off texture loads, these update state) --

  /** load a texture from a URL, returning null if it fails or is invalid */
  loadCardTexture: (url: string) => Promise<Texture | null>;
  /** check if the renderer is still alive and the card still exists */
  isAlive: (widgetId: string) => boolean;
  /** update the thumb sprite reference on a rendered card (for async loads) */
  updateThumbSprite: (widgetId: string, sprite: Sprite) => void;
  /** attach pointer handlers (tap, drag) to a card container */
  attachPointerHandlers: (card: Container, widgetId: string) => void;
}
