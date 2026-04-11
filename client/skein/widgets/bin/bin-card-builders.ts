// card builder functions for the bin widget.
// extracted from BinRenderer to keep modules under ~300 lines.

import { Container, Graphics, Sprite, Text } from "pixi.js";
import {
  CRATE_FONT_SIZE,
  DEFAULT_ACCENT_COLOR,
  DRAWER_FONT_SIZE,
  GRID_LABEL_FONT_SIZE,
  GRID_LABEL_MAX_CHARS,
  SHELF_FONT_SIZE,
  SLOT_BORDER_COLOR,
  SLOT_EMPTY_BG,
  TEXT_COLOR,
} from "./bin-constants";
import type { SlotSizeOptions } from "./bin-layout";
import { slotRect } from "./bin-layout";
import {
  createMediaOverlay,
  createPreviewOverlay,
  isMediaDomain,
  isPhotoDomain,
} from "./bin-media";
import type { CardBuildContext, CardRenderState, RenderedCard } from "./bin-types";

const FONT_FAMILY = "'Atkinson Hyperlegible Next', sans-serif";
const TEXT_RESOLUTION = typeof window !== "undefined" ? Math.max(window.devicePixelRatio, 2) : 2;

/** dispatch to the correct builder based on mode */
export function buildCard(state: CardRenderState, ctx: CardBuildContext): RenderedCard {
  switch (ctx.mode) {
    case "grid":
      return buildGridCard(state, ctx);
    case "shelf":
      return buildShelfCard(state, ctx);
    case "crate":
      return buildCrateCard(state, ctx);
    case "drawer":
      return buildDrawerCard(state, ctx);
  }
}

function truncateLabel(label: string, maxChars: number): string {
  if (label.length <= maxChars) return label;
  return label.slice(0, maxChars - 1) + "\u2026";
}

// -----------------------------------------------------------------------
// grid mode
// -----------------------------------------------------------------------

/** grid mode: square thumbnail + label below */
function buildGridCard(state: CardRenderState, ctx: CardBuildContext): RenderedCard {
  const { info, slot, widgetId } = state;
  const rect = slotRect(ctx.mode, slot, ctx.contentWidth, { scale: ctx.scale });

  const cellSize = rect.width;

  const card = new Container();
  card.label = `card-${widgetId}`;
  card.x = rect.x;
  card.y = rect.y;
  card.eventMode = "static";
  card.cursor = "pointer";

  // background
  const bg = new Graphics();
  bg.roundRect(0, 0, cellSize, cellSize, 3)
    .fill({ color: SLOT_EMPTY_BG })
    .roundRect(0, 0, cellSize, cellSize, 3)
    .stroke({ width: 1, color: SLOT_BORDER_COLOR });
  card.addChild(bg);

  // thumbnail or fallback
  let thumbSprite: Sprite | null = null;
  let textureKey: string | null = null;

  if (info.thumbnailUrl && info.thumbnailUrl.length > 0) {
    textureKey = info.thumbnailUrl;

    ctx.loadCardTexture(info.thumbnailUrl).then((tex) => {
      if (!tex || !ctx.isAlive(widgetId)) return;

      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);

      // fit the sprite into the cell, center-cropped
      const scale = Math.max(cellSize / tex.width, cellSize / tex.height);
      sprite.scale.set(scale);
      sprite.x = cellSize / 2;
      sprite.y = cellSize / 2;

      // clip to cell bounds
      const mask = new Graphics();
      mask.roundRect(0, 0, cellSize, cellSize, 3).fill({ color: 0xffffff });
      card.addChild(mask);
      card.addChild(sprite);
      sprite.mask = mask;

      // update the rendered card reference
      ctx.updateThumbSprite(widgetId, sprite);
    });
  } else {
    // fallback: colored rect with first letter
    const accent = info.accentColor ?? DEFAULT_ACCENT_COLOR;
    const fallback = new Graphics();
    fallback.roundRect(4, 4, cellSize - 8, cellSize - 8, 3).fill({
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
    letterText.x = cellSize / 2;
    letterText.y = cellSize / 2;
    card.addChild(letterText);
  }

  // media overlay — play/pause icon for audio/video, expand icon for photos
  let mediaOverlay: Container | null = null;
  if (isMediaDomain(info.domain)) {
    const parts = createMediaOverlay(cellSize, cellSize);
    mediaOverlay = parts.overlay;
    card.addChild(mediaOverlay);
  } else if (isPhotoDomain(info.domain)) {
    const parts = createPreviewOverlay(cellSize, cellSize);
    mediaOverlay = parts.overlay;
    card.addChild(mediaOverlay);
  }

  // filename label below the cell
  // use full cell width for label — compute max chars dynamically
  const maxGridChars = Math.max(
    GRID_LABEL_MAX_CHARS,
    Math.floor(cellSize / (GRID_LABEL_FONT_SIZE * 0.55))
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
  label.x = cellSize / 2;
  label.y = cellSize + 2;
  card.addChild(label);

  // pointer interactions
  ctx.attachPointerHandlers(card, widgetId);

  return {
    widgetId,
    slot,
    container: card,
    thumbSprite,
    textureKey,
    mediaOverlay,
    mediaDomain: info.domain ?? null,
    mediaBlobId: info.blobId ?? null,
    mediaMime: info.mime ?? null,
    mediaLabel: info.label ?? null,
    thumbnailUrl: info.thumbnailUrl ?? null,
  };
}

// -----------------------------------------------------------------------
// shelf mode
// -----------------------------------------------------------------------

/** shelf mode: narrow vertical spine with endcap thumbnail + rotated text */
function buildShelfCard(state: CardRenderState, ctx: CardBuildContext): RenderedCard {
  const { info, slot, widgetId } = state;
  const layoutOpts: SlotSizeOptions = { scale: ctx.scale };
  const rect = slotRect(ctx.mode, slot, ctx.contentWidth, layoutOpts);
  const accent = info.accentColor ?? DEFAULT_ACCENT_COLOR;

  const spineW = rect.width;
  const spineH = rect.height;

  const card = new Container();
  card.label = `card-${widgetId}`;
  card.x = rect.x;
  card.y = rect.y;
  card.eventMode = "static";
  card.cursor = "pointer";

  // spine background
  const bg = new Graphics();
  bg.roundRect(0, 0, spineW, spineH, 2).fill({ color: accent, alpha: 0.6 });
  bg.roundRect(0, 0, spineW, spineH, 2).stroke({
    width: 1,
    color: SLOT_BORDER_COLOR,
  });
  card.addChild(bg);

  // endcap thumbnail at top of spine
  let thumbSprite: Sprite | null = null;
  let textureKey: string | null = null;
  const endcapH = spineW; // square, proportional to spine width

  if (info.thumbnailUrl && info.thumbnailUrl.length > 0) {
    textureKey = info.thumbnailUrl;

    // placeholder background for the endcap area
    const thumbBg = new Graphics();
    thumbBg.rect(0, 0, spineW, endcapH).fill({ color: accent, alpha: 0.3 });
    card.addChild(thumbBg);

    ctx.loadCardTexture(info.thumbnailUrl).then((tex) => {
      if (!tex || !ctx.isAlive(widgetId)) return;

      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      // fill-crop into endcap area (flush, no margin)
      const scale = Math.max(spineW / tex.width, endcapH / tex.height);
      sprite.scale.set(scale);
      sprite.x = spineW / 2;
      sprite.y = endcapH / 2;

      const mask = new Graphics();
      mask.rect(0, 0, spineW, endcapH).fill({ color: 0xffffff });
      card.addChild(mask);
      card.addChild(sprite);
      sprite.mask = mask;

      ctx.updateThumbSprite(widgetId, sprite);
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
    letterText.x = spineW / 2;
    letterText.y = endcapH / 2;
    card.addChild(letterText);
  }

  // rotated text — direction based on shelfTextOrigin
  const textAreaH = spineH - endcapH - 4;
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

  if (ctx.shelfTextOrigin === "top") {
    // text reads top-to-bottom (clockwise rotation)
    label.rotation = Math.PI / 2;
    label.x = spineW / 2 - label.height / 2;
    label.y = endcapH + 2;
  } else {
    // text reads bottom-to-top (counter-clockwise rotation — original behavior)
    label.rotation = -Math.PI / 2;
    label.x = spineW / 2 + label.height / 2;
    label.y = spineH - 2;
  }
  card.addChild(label);

  // media overlay — play/pause icon for audio/video, expand icon for photos
  let mediaOverlay: Container | null = null;
  if (isMediaDomain(info.domain)) {
    const parts = createMediaOverlay(spineW, endcapH);
    mediaOverlay = parts.overlay;
    card.addChild(mediaOverlay);
  } else if (isPhotoDomain(info.domain)) {
    const parts = createPreviewOverlay(spineW, endcapH);
    mediaOverlay = parts.overlay;
    card.addChild(mediaOverlay);
  }

  ctx.attachPointerHandlers(card, widgetId);

  return {
    widgetId,
    slot,
    container: card,
    thumbSprite,
    textureKey,
    mediaOverlay,
    mediaDomain: info.domain ?? null,
    mediaBlobId: info.blobId ?? null,
    mediaMime: info.mime ?? null,
    mediaLabel: info.label ?? null,
    thumbnailUrl: info.thumbnailUrl ?? null,
  };
}

// -----------------------------------------------------------------------
// crate mode
// -----------------------------------------------------------------------

/** crate mode: horizontal row with flush-left endcap thumbnail + text */
function buildCrateCard(state: CardRenderState, ctx: CardBuildContext): RenderedCard {
  const { info, slot, widgetId } = state;
  const rect = slotRect(ctx.mode, slot, ctx.contentWidth, { scale: ctx.scale });
  const accent = info.accentColor ?? DEFAULT_ACCENT_COLOR;

  const card = new Container();
  card.label = `card-${widgetId}`;
  card.x = rect.x;
  card.y = rect.y;
  card.eventMode = "static";
  card.cursor = "pointer";

  const slotW = rect.width;
  const slotH = rect.height;

  // background
  const bg = new Graphics();
  bg.roundRect(0, 0, slotW, slotH, 2).fill({ color: SLOT_EMPTY_BG });
  bg.roundRect(0, 0, slotW, slotH, 2).stroke({ width: 1, color: SLOT_BORDER_COLOR });
  card.addChild(bg);

  // endcap thumbnail — flush left, square matching row height
  const endcapW = slotH; // square, proportional to row height
  let thumbSprite: Sprite | null = null;
  let textureKey: string | null = null;

  // endcap placeholder
  const thumbBg = new Graphics();
  thumbBg.rect(0, 0, endcapW, slotH).fill({ color: accent, alpha: 0.6 });
  card.addChild(thumbBg);

  if (info.thumbnailUrl && info.thumbnailUrl.length > 0) {
    textureKey = info.thumbnailUrl;

    ctx.loadCardTexture(info.thumbnailUrl).then((tex) => {
      if (!tex || !ctx.isAlive(widgetId)) return;

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

      ctx.updateThumbSprite(widgetId, sprite);
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

  // media overlay — play/pause icon for audio/video, expand icon for photos
  let mediaOverlay: Container | null = null;
  if (isMediaDomain(info.domain)) {
    const parts = createMediaOverlay(endcapW, slotH);
    mediaOverlay = parts.overlay;
    card.addChild(mediaOverlay);
  } else if (isPhotoDomain(info.domain)) {
    const parts = createPreviewOverlay(endcapW, slotH);
    mediaOverlay = parts.overlay;
    card.addChild(mediaOverlay);
  }

  ctx.attachPointerHandlers(card, widgetId);

  return {
    widgetId,
    slot,
    container: card,
    thumbSprite,
    textureKey,
    mediaOverlay,
    mediaDomain: info.domain ?? null,
    mediaBlobId: info.blobId ?? null,
    mediaMime: info.mime ?? null,
    mediaLabel: info.label ?? null,
    thumbnailUrl: info.thumbnailUrl ?? null,
  };
}

// -----------------------------------------------------------------------
// drawer mode
// -----------------------------------------------------------------------

/** drawer mode: full-width horizontal rows with flush-left endcap + text */
function buildDrawerCard(state: CardRenderState, ctx: CardBuildContext): RenderedCard {
  const { info, slot, widgetId } = state;
  const rect = slotRect(ctx.mode, slot, ctx.contentWidth, { scale: ctx.scale });
  const accent = info.accentColor ?? DEFAULT_ACCENT_COLOR;

  const container = new Container();
  container.label = `card-${widgetId}`;
  container.x = rect.x;
  container.y = rect.y;
  container.eventMode = "static";
  container.cursor = "pointer";

  const slotW = rect.width;
  const slotH = rect.height;

  // background
  const bg = new Graphics();
  bg.roundRect(0, 0, slotW, slotH, 3).fill({ color: accent, alpha: 0.15 });
  bg.roundRect(0, 0, slotW, slotH, 3).stroke({ width: 1, color: SLOT_BORDER_COLOR });
  container.addChild(bg);

  // endcap thumbnail — flush left, square matching row height
  const endcapW = slotH; // square, proportional to row height
  let thumbSprite: Sprite | null = null;
  let textureKey: string | null = null;

  // endcap placeholder
  const thumbBg = new Graphics();
  thumbBg.rect(0, 0, endcapW, slotH).fill({ color: accent, alpha: 0.3 });
  container.addChild(thumbBg);

  if (info.thumbnailUrl && info.thumbnailUrl.length > 0) {
    textureKey = info.thumbnailUrl;

    ctx.loadCardTexture(info.thumbnailUrl).then((tex) => {
      if (!tex || !ctx.isAlive(widgetId)) return;

      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      // fill-crop into endcap area
      const scale = Math.max(endcapW / tex.width, slotH / tex.height);
      sprite.scale.set(scale);
      sprite.x = endcapW / 2;
      sprite.y = slotH / 2;

      const mask = new Graphics();
      mask.rect(0, 0, endcapW, slotH).fill({ color: 0xffffff });
      container.addChild(mask);
      sprite.mask = mask;
      container.addChild(sprite);

      ctx.updateThumbSprite(widgetId, sprite);
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
    container.addChild(letterText);
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
  container.addChild(label);

  // media overlay — play/pause icon for audio/video, expand icon for photos
  let mediaOverlay: Container | null = null;
  if (isMediaDomain(info.domain)) {
    const parts = createMediaOverlay(endcapW, slotH);
    mediaOverlay = parts.overlay;
    container.addChild(mediaOverlay);
  } else if (isPhotoDomain(info.domain)) {
    const parts = createPreviewOverlay(endcapW, slotH);
    mediaOverlay = parts.overlay;
    container.addChild(mediaOverlay);
  }

  ctx.attachPointerHandlers(container, widgetId);

  return {
    widgetId,
    slot,
    container,
    thumbSprite,
    textureKey,
    mediaOverlay,
    mediaDomain: info.domain ?? null,
    mediaBlobId: info.blobId ?? null,
    mediaMime: info.mime ?? null,
    mediaLabel: info.label ?? null,
    thumbnailUrl: info.thumbnailUrl ?? null,
  };
}
