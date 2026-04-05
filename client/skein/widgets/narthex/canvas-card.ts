import { Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { z } from "zod";
import { formatRelativeTime, formatShortDate } from "../../src/widgets/format";
import {
  isTransparent,
  safeColor,
  type WidgetController,
  type WidgetFactory,
  type WidgetMountContext,
} from "../../src/widgets/widget-types";

export const canvasCardSchema = z.object({
  canvasDocId: z.string().default(""),
  title: z.string().default("untitled canvas"),
  description: z.string().default(""),
  previewUrl: z.string().default(""),
  createdAt: z.string().default(""),
  modifiedAt: z.string().default(""),
  authorName: z.string().default(""),
  color: z.number().default(0xd946ef),
  isRemote: z.boolean().default(false),
  ownerNodeId: z.string().default(""),
  ownerUsername: z.string().default(""),
  role: z.enum(["owner", "editor", "viewer"]).default("owner"),
  accessRevoked: z.boolean().default(false),
  lastVisitedAt: z.string().default(""),
  hasUpdates: z.boolean().default(false),
  lastKnownModifiedAt: z.string().default(""),
});

export type CanvasCardState = z.infer<typeof canvasCardSchema>;

// layout constants
const CARD_RADIUS = 8;
const ACCENT_HEIGHT = 4;
const PADDING_X = 12;
const PADDING_Y = 8;
const PREVIEW_RATIO = 0.55;
const TITLE_FONT_SIZE = 14;
const DESC_FONT_SIZE = 11;
const DATE_FONT_SIZE = 10;
const AUTHOR_BADGE_SIZE = 12;
const AUTHOR_LETTER_SIZE = 9;
const FOOTER_HEIGHT = 24;
const GRID_STEP = 16;
const ROLE_PILL_FONT_SIZE = 8;
const ROLE_PILL_PAD_X = 6;
const ROLE_PILL_PAD_Y = 2;

// theme colors
const BG_COLOR = 0x141418;
const BORDER_COLOR = 0x2a2a3e;
const BORDER_HOVER_COLOR = 0x4a4a5e;
const PREVIEW_BG = 0x1e1e28;
const GRID_LINE_COLOR = 0x282838;
const TITLE_COLOR = 0xf0f0ff;
const DESC_COLOR = 0x888898;
const DATE_COLOR = 0x666678;
const ICON_COLOR = 0x444460;

// remote card theme colors
const REMOTE_BORDER_COLOR = 0x3a7ca5;
const REMOTE_BORDER_HOVER_COLOR = 0x5a9cc5;
const ROLE_EDITOR_COLOR = 0x22c55e;
const ROLE_VIEWER_COLOR = 0xf59e0b;
const REVOKED_OVERLAY_ALPHA = 0.7;
const REVOKED_TEXT_COLOR = 0xff6b6b;

/**
 * truncate a string so it fits within a rough character budget.
 * appends an ellipsis when truncated.
 */
function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars - 1).trimEnd() + "\u2026";
}

/**
 * estimate the number of characters that fit within a given pixel width
 * at a given font size (rough heuristic — monospace-ish).
 */
function estimateMaxChars(width: number, fontSize: number): number {
  const avgCharWidth = fontSize * 0.55;
  return Math.max(4, Math.floor(width / avgCharWidth));
}

/**
 * draw a dashed border along a rounded rectangle path.
 * straight edges use a dash pattern; corner arcs are drawn solid
 * (they're small enough that dashing looks noisy).
 */
function drawDashedRoundRect(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: number,
  lineWidth: number
): void {
  const dashLen = 6;
  const gapLen = 4;

  const dashLine = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;
    const nx = dx / len;
    const ny = dy / len;
    let pos = 0;
    while (pos < len) {
      const end = Math.min(pos + dashLen, len);
      g.moveTo(x1 + nx * pos, y1 + ny * pos);
      g.lineTo(x1 + nx * end, y1 + ny * end);
      pos = end + gapLen;
    }
  };

  // dashed straight edges
  dashLine(x + r, y, x + w - r, y); // top
  dashLine(x + w, y + r, x + w, y + h - r); // right
  dashLine(x + w - r, y + h, x + r, y + h); // bottom
  dashLine(x, y + h - r, x, y + r); // left

  // solid corner arcs
  g.moveTo(x + w - r, y);
  g.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  g.moveTo(x + w, y + h - r);
  g.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  g.moveTo(x + r, y + h);
  g.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  g.moveTo(x, y + r);
  g.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);

  g.stroke({ color, width: lineWidth });
}

export const canvasCardWidget: WidgetFactory<typeof canvasCardSchema> = {
  type: "canvas-card",
  metadata: {
    name: "canvas card",
    description: "a card linking to another canvas \u2014 used in the narthex",
    version: "0.1.0",
    category: "narthex",
    hidden: true,
  },
  schema: canvasCardSchema,
  editableProps: [
    { key: "title", label: "title", type: "string" as const, default: "untitled canvas" },
    { key: "description", label: "description", type: "string" as const, default: "" },
    { key: "color", label: "color tag", type: "color" as const, default: 0xd946ef },
    {
      key: "previewUrl",
      label: "preview",
      type: "image" as const,
      default: "",
      imageMaxWidth: 320,
      imageMaxHeight: 200,
    },
  ],

  create(ctx: WidgetMountContext<typeof canvasCardSchema>): WidgetController {
    const container = new Container();
    container.eventMode = "static";
    container.cursor = "pointer";
    container.sortableChildren = true;

    let currentWidth = ctx.width;
    let currentHeight = ctx.height;
    let hovered = false;

    // --- graphics layers ---

    const cardBg = new Graphics();
    container.addChild(cardBg);

    const accentStripe = new Graphics();
    container.addChild(accentStripe);

    const previewBg = new Graphics();
    container.addChild(previewBg);

    const previewGrid = new Graphics();
    container.addChild(previewGrid);

    const previewIcon = new Graphics();
    previewIcon.visible = false;
    container.addChild(previewIcon);

    let previewSprite: Sprite | null = null;
    let lastRequestedPreviewUrl = "";
    let loadedPreviewAssetKey = "";
    const previewMask = new Graphics();
    container.addChild(previewMask);

    const hintText = new Text({
      text: "click to open",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 9,
        fill: ICON_COLOR,
      },
      resolution: 3,
    });
    hintText.anchor.set(0.5, 0);
    hintText.eventMode = "none";
    hintText.visible = false;
    container.addChild(hintText);

    // --- text elements ---

    const titleText = new Text({
      text: "",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: TITLE_FONT_SIZE,
        fontWeight: "bold",
        fill: TITLE_COLOR,
        wordWrap: false,
      },
      resolution: 3,
    });
    titleText.eventMode = "none";
    container.addChild(titleText);

    // --- remote: role pill ---

    const rolePill = new Graphics();
    rolePill.eventMode = "none";
    rolePill.visible = false;
    container.addChild(rolePill);

    const rolePillText = new Text({
      text: "",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: ROLE_PILL_FONT_SIZE,
        fontWeight: "bold",
        fill: 0xffffff,
      },
      resolution: 3,
    });
    rolePillText.eventMode = "none";
    rolePillText.visible = false;
    container.addChild(rolePillText);

    // --- description ---

    const descText = new Text({
      text: "",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: DESC_FONT_SIZE,
        fill: DESC_COLOR,
        wordWrap: true,
        wordWrapWidth: 200,
        lineHeight: DESC_FONT_SIZE * 1.35,
      },
      resolution: 3,
    });
    descText.eventMode = "none";
    container.addChild(descText);

    const dateText = new Text({
      text: "",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: DATE_FONT_SIZE,
        fill: DATE_COLOR,
        wordWrap: false,
      },
      resolution: 3,
    });
    dateText.eventMode = "none";
    container.addChild(dateText);

    // author badge — circle + letter
    const authorBadge = new Graphics();
    authorBadge.eventMode = "none";
    container.addChild(authorBadge);

    const authorLetter = new Text({
      text: "",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: AUTHOR_LETTER_SIZE,
        fontWeight: "bold",
        fill: 0xffffff,
        align: "center",
      },
      resolution: 3,
    });
    authorLetter.anchor.set(0.5);
    authorLetter.eventMode = "none";
    container.addChild(authorLetter);

    // --- remote: corner badge ---

    const remoteBadge = new Text({
      text: "\u2197",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 11,
        fill: REMOTE_BORDER_COLOR,
      },
      resolution: 3,
    });
    remoteBadge.anchor.set(1, 0);
    remoteBadge.eventMode = "none";
    remoteBadge.visible = false;
    container.addChild(remoteBadge);

    // --- remote: access revoked overlay (must render on top of everything) ---

    const revokedOverlay = new Graphics();
    revokedOverlay.eventMode = "none";
    revokedOverlay.visible = false;
    revokedOverlay.zIndex = 100;
    container.addChild(revokedOverlay);

    const revokedText = new Text({
      text: "access revoked",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        fontWeight: "bold",
        fill: REVOKED_TEXT_COLOR,
      },
      resolution: 3,
    });
    revokedText.anchor.set(0.5);
    revokedText.eventMode = "none";
    revokedText.visible = false;
    revokedText.zIndex = 101;
    container.addChild(revokedText);

    // --- update pill (shows when a shared canvas has new activity) ---

    const updatePill = new Graphics();
    updatePill.eventMode = "none";
    updatePill.visible = false;
    updatePill.zIndex = 50;
    container.addChild(updatePill);

    const updatePillText = new Text({
      text: "updated",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 8,
        fontWeight: "bold",
        fill: 0xffffff,
      },
      resolution: 3,
    });
    updatePillText.eventMode = "none";
    updatePillText.visible = false;
    updatePillText.zIndex = 50;
    container.addChild(updatePillText);

    // --- drawing helpers ---

    const drawCardBg = (w: number, h: number, remote: boolean) => {
      cardBg.clear();
      cardBg.roundRect(0, 0, w, h, CARD_RADIUS);
      cardBg.fill({ color: BG_COLOR });

      if (remote) {
        const borderColor = hovered ? REMOTE_BORDER_HOVER_COLOR : REMOTE_BORDER_COLOR;
        drawDashedRoundRect(cardBg, 0, 0, w, h, CARD_RADIUS, borderColor, 1);
      } else {
        const borderColor = hovered ? BORDER_HOVER_COLOR : BORDER_COLOR;
        cardBg.roundRect(0, 0, w, h, CARD_RADIUS);
        cardBg.stroke({ color: borderColor, width: 1 });
      }
    };

    const drawAccent = (w: number, color: number, remote: boolean) => {
      const col = isTransparent(color) ? 0x444460 : safeColor(color);
      accentStripe.clear();

      if (remote) {
        // striped accent — faint tinted base with alternating color stripes
        accentStripe.roundRect(1, 1, w - 2, ACCENT_HEIGHT + CARD_RADIUS, CARD_RADIUS);
        accentStripe.fill({ color: col, alpha: 0.15 });
        accentStripe.rect(1, ACCENT_HEIGHT, w - 2, CARD_RADIUS);
        accentStripe.fill({ color: BG_COLOR });
        // draw alternating stripes over the accent area
        const stripeW = 6;
        const gapW = 4;
        let x = 1;
        while (x < w - 1) {
          const sw = Math.min(stripeW, w - 1 - x);
          accentStripe.rect(x, 1, sw, ACCENT_HEIGHT);
          accentStripe.fill({ color: col });
          x += stripeW + gapW;
        }
      } else {
        // solid accent bar clipped to the top rounded corners
        // use a rounded rect for the top, then cover the bottom rounding with a flat rect
        accentStripe.roundRect(1, 1, w - 2, ACCENT_HEIGHT + CARD_RADIUS, CARD_RADIUS);
        accentStripe.fill({ color: col });
        // mask out the bottom part so it's flat
        accentStripe.rect(1, ACCENT_HEIGHT, w - 2, CARD_RADIUS);
        accentStripe.fill({ color: BG_COLOR });
        // redraw just the accent portion
        accentStripe.rect(1, 1, w - 2, ACCENT_HEIGHT);
        accentStripe.fill({ color: col });
      }
    };

    const drawPreview = (w: number, h: number, state: CanvasCardState) => {
      const previewH = Math.floor(h * PREVIEW_RATIO);
      const top = ACCENT_HEIGHT;
      const hasPreview = !!state.previewUrl;

      // background fill — use a dimmed version of the card color when no preview image
      previewBg.clear();
      previewBg.rect(1, top, w - 2, previewH);
      if (hasPreview) {
        previewBg.fill({ color: PREVIEW_BG });
      } else {
        previewBg.fill({ color: PREVIEW_BG });
        // overlay the card color at low opacity for a tinted background
        previewBg.rect(1, top, w - 2, previewH);
        previewBg.fill({ color: safeColor(state.color), alpha: 0.15 });
      }

      if (!hasPreview) {
        // faint grid pattern
        previewGrid.clear();
        for (let x = GRID_STEP; x < w - 2; x += GRID_STEP) {
          previewGrid.moveTo(x, top);
          previewGrid.lineTo(x, top + previewH);
        }
        for (let y = top + GRID_STEP; y < top + previewH; y += GRID_STEP) {
          previewGrid.moveTo(1, y);
          previewGrid.lineTo(w - 1, y);
        }
        previewGrid.stroke({ color: GRID_LINE_COLOR, width: 0.5, alpha: 0.5 });
        previewGrid.visible = true;
        // icon and hint are controlled by hover
      } else {
        previewGrid.visible = false;
        // icon and hint are controlled by hover
      }

      // icon — always drawn (visibility controlled by hover)
      const iconSize = Math.min(28, previewH * 0.35);
      const iconX = w / 2 - iconSize / 2;
      const iconY = top + previewH / 2 - iconSize / 2;
      previewIcon.clear();
      previewIcon.roundRect(iconX, iconY, iconSize, iconSize, 3);
      previewIcon.stroke({ color: ICON_COLOR, width: 1.5 });
      previewIcon.moveTo(iconX + iconSize / 2, iconY + 3);
      previewIcon.lineTo(iconX + iconSize / 2, iconY + iconSize - 3);
      previewIcon.stroke({ color: ICON_COLOR, width: 1 });
      previewIcon.moveTo(iconX + 3, iconY + iconSize / 2);
      previewIcon.lineTo(iconX + iconSize - 3, iconY + iconSize / 2);
      previewIcon.stroke({ color: ICON_COLOR, width: 1 });
      // visibility is toggled by pointerover/pointerout on the container
    };

    const updatePreviewSprite = async (dataUrl: string, w: number, h: number) => {
      lastRequestedPreviewUrl = dataUrl;

      // clean up existing sprite
      if (previewSprite) {
        container.removeChild(previewSprite);
        previewSprite.destroy();
        previewSprite = null;
      }
      if (loadedPreviewAssetKey) {
        Assets.unload(loadedPreviewAssetKey);
        loadedPreviewAssetKey = "";
      }

      if (!dataUrl) return;

      try {
        const texture = await Assets.load<Texture>(dataUrl);
        // race check — another load may have started while we were loading
        if (lastRequestedPreviewUrl !== dataUrl) return;

        const previewH = Math.floor(h * PREVIEW_RATIO);
        const top = ACCENT_HEIGHT;

        previewSprite = new Sprite(texture);
        loadedPreviewAssetKey = dataUrl;
        previewSprite.eventMode = "none";

        // cover/fill the preview area — scale up to fill, center-crop overflow
        const maxW = w - 2;
        const maxH = previewH;
        const scale = Math.max(maxW / texture.width, maxH / texture.height);
        previewSprite.width = texture.width * scale;
        previewSprite.height = texture.height * scale;
        previewSprite.x = 1 + (maxW - previewSprite.width) / 2;
        previewSprite.y = top + (maxH - previewSprite.height) / 2;

        // clip to preview area
        previewMask.clear();
        previewMask.rect(1, top, w - 2, previewH);
        previewMask.fill({ color: 0xffffff });
        previewSprite.mask = previewMask;

        container.addChild(previewSprite);
      } catch {
        // silently ignore load failures
      }
    };

    const drawAuthorBadge = (w: number, h: number, state: CanvasCardState) => {
      // for remote cards, show owner info instead of local author
      const displayName = state.isRemote
        ? state.ownerUsername.trim() || state.ownerNodeId.slice(0, 8)
        : state.authorName.trim();

      const hasName = displayName.length > 0;
      authorBadge.clear();

      if (!hasName) {
        authorBadge.visible = false;
        authorLetter.visible = false;
        return;
      }

      authorBadge.visible = true;
      authorLetter.visible = true;

      const badgeX = w - PADDING_X - AUTHOR_BADGE_SIZE / 2;
      const badgeY = h - FOOTER_HEIGHT / 2 - PADDING_Y / 2;
      const col = isTransparent(state.color) ? 0x666678 : safeColor(state.color);

      authorBadge.circle(badgeX, badgeY, AUTHOR_BADGE_SIZE / 2);
      authorBadge.fill({ color: state.isRemote ? REMOTE_BORDER_COLOR : col });

      authorLetter.text = displayName.charAt(0).toUpperCase();
      authorLetter.x = badgeX;
      authorLetter.y = badgeY;
    };

    const drawRemoteBadge = (w: number, remote: boolean) => {
      if (remote) {
        remoteBadge.x = w - PADDING_X + 2;
        remoteBadge.y = ACCENT_HEIGHT + 4;
        remoteBadge.visible = true;
      } else {
        remoteBadge.visible = false;
      }
    };

    const drawRolePill = (state: CanvasCardState, pillX: number, pillY: number): number => {
      if (!state.isRemote || state.role === "owner") {
        rolePill.visible = false;
        rolePillText.visible = false;
        return 0;
      }

      const pillColor = state.role === "editor" ? ROLE_EDITOR_COLOR : ROLE_VIEWER_COLOR;
      rolePillText.text = state.role;
      rolePillText.style.fill = pillColor;

      // measure text to size the pill
      const tw = rolePillText.width;
      const th = rolePillText.height;
      const pw = tw + ROLE_PILL_PAD_X * 2;
      const ph = th + ROLE_PILL_PAD_Y * 2;

      rolePill.clear();
      rolePill.roundRect(pillX, pillY, pw, ph, ph / 2);
      rolePill.fill({ color: pillColor, alpha: 0.15 });
      rolePill.roundRect(pillX, pillY, pw, ph, ph / 2);
      rolePill.stroke({ color: pillColor, width: 0.5, alpha: 0.5 });

      rolePillText.x = pillX + ROLE_PILL_PAD_X;
      rolePillText.y = pillY + ROLE_PILL_PAD_Y;

      rolePill.visible = true;
      rolePillText.visible = true;

      return ph + 4; // total height offset for content below the pill
    };

    const drawRevokedOverlay = (w: number, h: number, revoked: boolean) => {
      revokedOverlay.clear();
      if (revoked) {
        revokedOverlay.roundRect(0, 0, w, h, CARD_RADIUS);
        revokedOverlay.fill({ color: 0x000000, alpha: REVOKED_OVERLAY_ALPHA });
        revokedOverlay.visible = true;
        revokedText.x = w / 2;
        revokedText.y = h / 2;
        revokedText.visible = true;
      } else {
        revokedOverlay.visible = false;
        revokedText.visible = false;
      }
    };

    const drawUpdatePill = (w: number, state: CanvasCardState) => {
      updatePill.clear();
      if (state.hasUpdates) {
        const col = isTransparent(state.color) ? 0x444460 : safeColor(state.color);

        // measure text to size the pill
        updatePillText.text = "updated";
        const tw = updatePillText.width;
        const th = updatePillText.height;
        const dotR = 3;
        const dotGap = 4;
        const padX = 6;
        const padY = 3;
        const pillW = padX + dotR * 2 + dotGap + tw + padX;
        const pillH = th + padY * 2;
        const pillX = w - PADDING_X - pillW;
        const pillY = ACCENT_HEIGHT + 5;
        const pillR = pillH / 2;

        // pill background — dark base with accent tint for readability
        updatePill.roundRect(pillX, pillY, pillW, pillH, pillR);
        updatePill.fill({ color: 0x000000, alpha: 0.7 });
        updatePill.roundRect(pillX, pillY, pillW, pillH, pillR);
        updatePill.fill({ color: col, alpha: 0.15 });
        updatePill.roundRect(pillX, pillY, pillW, pillH, pillR);
        updatePill.stroke({ color: col, width: 0.5, alpha: 0.6 });

        // dot inside the pill
        const dotCx = pillX + padX + dotR;
        const dotCy = pillY + pillH / 2;
        updatePill.circle(dotCx, dotCy, dotR);
        updatePill.fill({ color: col });

        // position text after the dot
        updatePillText.style.fill = col;
        updatePillText.x = dotCx + dotR + dotGap;
        updatePillText.y = pillY + padY;
        updatePillText.visible = true;

        updatePill.visible = true;
      } else {
        updatePill.visible = false;
        updatePillText.visible = false;
      }
    };

    // --- full layout ---

    const layout = (w: number, h: number) => {
      const state = ctx.doc.current;
      const contentWidth = w - PADDING_X * 2;
      const previewH = Math.floor(h * PREVIEW_RATIO);
      const textTop = ACCENT_HEIGHT + previewH + PADDING_Y;

      drawCardBg(w, h, state.isRemote);
      drawAccent(w, state.color, state.isRemote);
      drawPreview(w, h, state);
      // only reload the sprite when the URL changes
      if (state.previewUrl !== lastRequestedPreviewUrl) {
        updatePreviewSprite(state.previewUrl, w, h);
      }

      // hint text below preview icon
      const previewH2 = Math.floor(h * PREVIEW_RATIO);
      const previewCenterY = ACCENT_HEIGHT + previewH2 / 2;
      hintText.x = w / 2;
      hintText.y = previewCenterY + 18;

      // title
      const titleMaxChars = estimateMaxChars(contentWidth, TITLE_FONT_SIZE);
      titleText.text = truncate(state.title || "untitled canvas", titleMaxChars);
      titleText.x = PADDING_X;
      titleText.y = textTop;

      // role pill (remote cards only, below title)
      const pillY = textTop + TITLE_FONT_SIZE + 2;
      const pillOffset = drawRolePill(state, PADDING_X, pillY);

      // description — allow two lines, then truncate
      const descMaxWidth = contentWidth;
      descText.style.wordWrapWidth = descMaxWidth;
      const descTopY = textTop + TITLE_FONT_SIZE + 4 + pillOffset;
      const descAvailH = h - descTopY - FOOTER_HEIGHT - PADDING_Y;
      const maxDescLines = Math.max(1, Math.floor(descAvailH / (DESC_FONT_SIZE * 1.35)));
      const descMaxCharsPerLine = estimateMaxChars(descMaxWidth, DESC_FONT_SIZE);
      const descMaxChars = descMaxCharsPerLine * Math.min(maxDescLines, 2);

      if (state.description) {
        descText.text = truncate(state.description, descMaxChars);
        descText.visible = true;
      } else {
        descText.text = "";
        descText.visible = false;
      }
      descText.x = PADDING_X;
      descText.y = descTopY;

      // footer: timestamps
      const footerY = h - FOOTER_HEIGHT;
      const hasModified = !!state.modifiedAt;
      const hasCreated = !!state.createdAt;

      if (hasModified && state.modifiedAt !== state.createdAt) {
        dateText.text = "edited " + formatRelativeTime(state.modifiedAt);
        dateText.style.fontStyle = "italic";
        dateText.visible = true;
      } else if (hasCreated) {
        dateText.text = formatShortDate(state.createdAt);
        dateText.style.fontStyle = "normal";
        dateText.visible = true;
      } else {
        dateText.text = "";
        dateText.visible = false;
      }
      dateText.x = PADDING_X;
      dateText.y = footerY + (FOOTER_HEIGHT - DATE_FONT_SIZE) / 2;

      // footer: author badge on the right (shows owner info for remote cards)
      drawAuthorBadge(w, h, state);

      // remote card extras
      drawRemoteBadge(w, state.isRemote);
      drawRevokedOverlay(w, h, state.isRemote && state.accessRevoked);

      // update pill indicator for new activity on shared canvases
      drawUpdatePill(w, state);

      // cursor style — revoked cards shouldn't look clickable
      container.cursor = state.isRemote && state.accessRevoked ? "not-allowed" : "pointer";
    };

    // --- initial draw ---
    layout(currentWidth, currentHeight);

    // --- hover effects ---

    container.on("pointerover", () => {
      hovered = true;
      drawCardBg(currentWidth, currentHeight, ctx.doc.current.isRemote);
      hintText.visible = true;
      previewIcon.visible = true;
    });

    container.on("pointerout", () => {
      hovered = false;
      drawCardBg(currentWidth, currentHeight, ctx.doc.current.isRemote);
      hintText.visible = false;
      previewIcon.visible = false;
    });

    // --- click navigation ---

    container.on("pointertap", () => {
      const state = ctx.doc.current;
      if (state.accessRevoked) return;
      if (state.canvasDocId) {
        window.location.hash = state.canvasDocId;
      }
    });

    // --- subscribe to doc changes ---

    const unsub = ctx.doc.on("change", () => {
      layout(currentWidth, currentHeight);
    });

    return {
      container,
      destroy() {
        unsub();
        if (previewSprite) {
          container.removeChild(previewSprite);
          previewSprite.mask = null;
          previewSprite.destroy();
          previewSprite = null;
        }
        if (loadedPreviewAssetKey) {
          Assets.unload(loadedPreviewAssetKey);
          loadedPreviewAssetKey = "";
        }
        container.destroy({ children: true });
      },
      resize(width: number, height: number) {
        currentWidth = width;
        currentHeight = height;
        layout(width, height);
      },
    };
  },
};
