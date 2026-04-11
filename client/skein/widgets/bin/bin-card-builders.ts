// card builder functions for the bin widget.
// extracted from BinRenderer to keep modules under ~300 lines.

import { Container, Graphics, Sprite, Text } from "pixi.js";
import { isTauriMode } from "../../src/p2p/tauri-transport";
import { drawRevealIcon, drawSaveIcon, drawSnatchIcon } from "../../src/widgets/icons";
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
// action button helpers
// -----------------------------------------------------------------------

const ACTION_BTN_SIZE = 24;
const ACTION_BTN_PAD = 3;
const ACTION_BTN_BG = 0x2a2a2a;
const ACTION_BTN_HOVER_BG = 0x444444;

/**
 * create an icon button (snatch, save, or reveal) for a compact card.
 * the button fires a callback on pointerup and has hover highlighting
 * plus a tooltip label that appears above the button on hover.
 * all pointer events are stopped so they don't cascade to the card
 * (which would trigger audio/video playback or drag).
 */
function createActionButton(
  iconDraw: (g: Graphics, x: number, y: number, size: number, color: number, alpha: number) => void,
  size: number,
  tooltipText: string,
  onClick: () => void
): Container {
  const btn = new Container();
  btn.eventMode = "static";
  btn.cursor = "pointer";

  const bg = new Graphics();
  bg.roundRect(0, 0, size, size, 3).fill({ color: ACTION_BTN_BG, alpha: 0.8 });
  btn.addChild(bg);

  const iconPad = Math.max(2, Math.floor(size * 0.12));
  const icon = new Graphics();
  iconDraw(icon, iconPad, iconPad, size - iconPad * 2, 0xffffff, 0.85);
  btn.addChild(icon);

  // tooltip — small text label above the button, shown on hover
  const tipBg = new Graphics();
  tipBg.visible = false;
  tipBg.eventMode = "none";
  btn.addChild(tipBg);

  const tooltip = new Text({
    text: tooltipText,
    style: {
      fontFamily: FONT_FAMILY,
      fontSize: 9,
      fill: 0xffffff,
    },
    resolution: TEXT_RESOLUTION,
  });
  tooltip.anchor.set(0.5, 1);
  tooltip.x = size / 2;
  tooltip.y = -4;
  tooltip.visible = false;
  tooltip.eventMode = "none";
  btn.addChild(tooltip);

  btn.on("pointerenter", () => {
    bg.clear();
    bg.roundRect(0, 0, size, size, 3).fill({ color: ACTION_BTN_HOVER_BG, alpha: 0.95 });
    tooltip.visible = true;
    tipBg.visible = true;
    tipBg.clear();
    const tw = tooltip.width;
    const th = tooltip.height;
    tipBg
      .roundRect(size / 2 - tw / 2 - 4, -4 - th - 2, tw + 8, th + 4, 3)
      .fill({ color: 0x000000, alpha: 0.9 });
  });
  btn.on("pointerleave", () => {
    bg.clear();
    bg.roundRect(0, 0, size, size, 3).fill({ color: ACTION_BTN_BG, alpha: 0.8 });
    tooltip.visible = false;
    tipBg.visible = false;
  });

  // stop ALL pointer events from reaching the card — prevents triggering
  // audio/video playback, drag-and-drop, or card tap handlers
  btn.on("pointerdown", (e: any) => e.stopPropagation());
  btn.on("pointerup", (e: any) => {
    e.stopPropagation();
    onClick();
  });
  btn.on("pointertap", (e: any) => e.stopPropagation());

  return btn;
}

/** info needed to create file action buttons */
interface ActionButtonInfo {
  blobId?: string | null;
  filename?: string | null;
  mime?: string | null;
  blake3?: string | null;
  size?: number | null;
  domain?: string | null;
  snatchedBy?: string[] | null;
}

/**
 * build the set of action buttons for a file card.
 * returns a container with the buttons laid out horizontally.
 * returns null if no buttons are applicable (non-file card, no blobId).
 */
function buildActionButtons(
  info: ActionButtonInfo,
  btnSize: number,
  getPeers: (() => Record<string, { nodeId: string }> | undefined) | null
): Container | null {
  if (!info.blobId) return null;

  const row = new Container();
  row.label = "action-buttons";
  let x = 0;

  // snatch button — always available when there's a blobId
  const snatchBtn = createActionButton(drawSnatchIcon, btnSize, "snatch", () => {
    import("../../src/widgets/file-utils").then(({ snatchBlob }) => {
      const peers = getPeers?.() ?? {};
      snatchBlob(
        {
          blobId: String(info.blobId ?? ""),
          filename: String(info.filename ?? "file"),
          mime: String(info.mime ?? ""),
          size: info.size ?? 0,
          blake3: String(info.blake3 ?? ""),
          domain: String(info.domain ?? ""),
        },
        peers as any
      ).catch((err) => console.warn("[bin-actions] snatch failed:", err));
    });
  });
  snatchBtn.x = x;
  row.addChild(snatchBtn);
  x += btnSize + ACTION_BTN_PAD;

  if (isTauriMode()) {
    // reveal in finder (Tauri only)
    const revealBtn = createActionButton(drawRevealIcon, btnSize, "reveal", () => {
      import("../../src/widgets/file-utils").then(({ revealBlobInFinder }) => {
        revealBlobInFinder(String(info.blobId ?? "")).catch((err) =>
          console.warn("[bin-actions] reveal failed:", err)
        );
      });
    });
    revealBtn.x = x;
    row.addChild(revealBtn);
    x += btnSize + ACTION_BTN_PAD;
  } else {
    // save to disk (browser mode)
    const saveBtn = createActionButton(drawSaveIcon, btnSize, "save", () => {
      import("../../src/widgets/file-utils").then(({ saveBlobToDisk }) => {
        saveBlobToDisk(String(info.blobId ?? ""), String(info.filename ?? "file")).catch((err) =>
          console.warn("[bin-actions] save failed:", err)
        );
      });
    });
    saveBtn.x = x;
    row.addChild(saveBtn);
    x += btnSize + ACTION_BTN_PAD;
  }

  // hidden by default — shown on card hover
  row.visible = false;
  row.zIndex = 11;

  return row;
}

// -----------------------------------------------------------------------
// shelf autofit helper
// -----------------------------------------------------------------------

/**
 * find the largest font size that fits the text within the available length.
 * the text is single-line (no word wrap), so we only check width.
 * never goes below minSize and never above maxSize.
 */
function computeShelfFontSize(
  text: string,
  availableLength: number,
  minSize: number,
  maxSize: number
): { fontSize: number; fits: boolean } {
  if (availableLength <= 0) return { fontSize: minSize, fits: false };

  // start at max and shrink down
  let fontSize = maxSize;

  const measure = new Text({
    text,
    style: {
      fontFamily: FONT_FAMILY,
      fontSize,
    },
    resolution: TEXT_RESOLUTION,
  });

  let fits = false;
  let iterations = 0;
  while (iterations < 15) {
    measure.style.fontSize = fontSize;
    const tw = measure.width;

    if (tw <= availableLength) {
      fits = true;
      break;
    }

    if (fontSize <= minSize) break;

    // shrink proportionally
    const scale = availableLength / Math.max(tw, 1);
    fontSize = Math.max(minSize, Math.floor(fontSize * scale * 0.95));
    iterations++;
  }

  measure.destroy();
  return { fontSize: Math.max(fontSize, minSize), fits };
}

/** helper to populate the common extra fields on RenderedCard from CompactInfo */
function extraCardFields(info: {
  label?: string;
  thumbnailUrl?: string;
  blobId?: string;
  mime?: string;
  filename?: string;
  blake3?: string;
  size?: number;
  snatchedBy?: string[];
}) {
  return {
    mediaLabel: info.label ?? null,
    thumbnailUrl: info.thumbnailUrl ?? null,
    filename: info.filename ?? null,
    blake3: info.blake3 ?? null,
    fileSize: info.size ?? null,
    snatchedBy: info.snatchedBy ?? null,
  };
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
  card.sortableChildren = true;

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

  // action buttons (snatch, save/reveal) — below thumbnail, hidden until hover
  if (info.blobId) {
    const btnSize = Math.max(18, Math.min(ACTION_BTN_SIZE, Math.floor(cellSize * 0.25)));
    const actions = buildActionButtons(info, btnSize, ctx.getPeers ?? null);
    if (actions) {
      actions.x = Math.round((cellSize - actions.width) / 2);
      actions.y = cellSize - btnSize - 2;
      card.addChild(actions);
      card.on("pointerenter", () => {
        actions.visible = true;
      });
      card.on("pointerleave", () => {
        actions.visible = false;
      });
    }
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
    ...extraCardFields(info),
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
  card.sortableChildren = true;

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
  // autofit: try to use the largest font that fits, but never below SHELF_FONT_SIZE
  const textAreaH = spineH - endcapH - 2;
  const maxFontSize = Math.floor(spineW * 0.8);
  const { fontSize: shelfFontSize, fits: textFits } = computeShelfFontSize(
    info.label,
    textAreaH,
    SHELF_FONT_SIZE,
    maxFontSize
  );

  // if autofit says the full text fits, use it; otherwise truncate at min size
  let displayText: string;
  if (textFits) {
    displayText = info.label;
  } else {
    const maxChars = Math.max(4, Math.floor(textAreaH / (shelfFontSize * 0.7)));
    displayText = truncateLabel(info.label, maxChars);
  }

  const label = new Text({
    text: displayText,
    style: {
      fontFamily: FONT_FAMILY,
      fontSize: shelfFontSize,
      fill: TEXT_COLOR,
    },
    resolution: TEXT_RESOLUTION,
  });

  // center anchor eliminates font-size-dependent positioning drift
  label.anchor.set(0.5, 0.5);
  label.rotation = ctx.shelfTextOrigin === "top" ? Math.PI / 2 : -Math.PI / 2;
  label.x = spineW / 2;
  label.y = endcapH + 1 + textAreaH / 2;
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
    ...extraCardFields(info),
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
  card.sortableChildren = true;

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

  // action buttons — at right end of row, hidden until hover
  let actionBtnsW = 0;
  if (info.blobId) {
    const btnSize = Math.max(16, Math.min(22, slotH - 4));
    const actions = buildActionButtons(info, btnSize, ctx.getPeers ?? null);
    if (actions) {
      actionBtnsW = actions.width + 6;
      actions.x = slotW - actions.width - 4;
      actions.y = Math.round((slotH - btnSize) / 2);
      card.addChild(actions);
      card.on("pointerenter", () => {
        actions.visible = true;
      });
      card.on("pointerleave", () => {
        actions.visible = false;
      });
    }
  }

  // filename text — to the right of the endcap
  const textX = endcapW + 6;
  const maxLabelWidth = slotW - textX - 4 - actionBtnsW;
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
    ...extraCardFields(info),
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
  container.sortableChildren = true;

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

  // action buttons — at right end of row, hidden until hover
  let drawerActionBtnsW = 0;
  if (info.blobId) {
    const btnSize = Math.max(18, Math.min(ACTION_BTN_SIZE, slotH - 6));
    const actions = buildActionButtons(info, btnSize, ctx.getPeers ?? null);
    if (actions) {
      drawerActionBtnsW = actions.width + 8;
      actions.x = slotW - actions.width - 6;
      actions.y = Math.round((slotH - btnSize) / 2);
      container.addChild(actions);
      container.on("pointerenter", () => {
        actions.visible = true;
      });
      container.on("pointerleave", () => {
        actions.visible = false;
      });
    }
  }

  // text label — to the right of the endcap
  const textX = endcapW + 8;
  const maxLabelWidth = slotW - textX - 8 - drawerActionBtnsW;
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
    ...extraCardFields(info),
  };
}
