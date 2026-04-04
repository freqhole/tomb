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

    // --- drawing helpers ---

    const drawCardBg = (w: number, h: number) => {
      const borderColor = hovered ? BORDER_HOVER_COLOR : BORDER_COLOR;
      cardBg.clear();
      cardBg.roundRect(0, 0, w, h, CARD_RADIUS);
      cardBg.fill({ color: BG_COLOR });
      cardBg.stroke({ color: borderColor, width: 1 });
    };

    const drawAccent = (w: number, color: number) => {
      const col = isTransparent(color) ? 0x444460 : safeColor(color);
      accentStripe.clear();
      // draw the accent bar clipped to the top rounded corners
      // use a rounded rect for the top, then cover the bottom rounding with a flat rect
      accentStripe.roundRect(1, 1, w - 2, ACCENT_HEIGHT + CARD_RADIUS, CARD_RADIUS);
      accentStripe.fill({ color: col });
      // mask out the bottom part so it's flat
      accentStripe.rect(1, ACCENT_HEIGHT, w - 2, CARD_RADIUS);
      accentStripe.fill({ color: BG_COLOR });
      // redraw just the accent portion
      accentStripe.rect(1, 1, w - 2, ACCENT_HEIGHT);
      accentStripe.fill({ color: col });
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
      const hasAuthor = state.authorName.trim().length > 0;
      authorBadge.clear();

      if (!hasAuthor) {
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
      authorBadge.fill({ color: col });

      authorLetter.text = state.authorName.trim().charAt(0).toUpperCase();
      authorLetter.x = badgeX;
      authorLetter.y = badgeY;
    };

    // --- full layout ---

    const layout = (w: number, h: number) => {
      const state = ctx.doc.current;
      const contentWidth = w - PADDING_X * 2;
      const previewH = Math.floor(h * PREVIEW_RATIO);
      const textTop = ACCENT_HEIGHT + previewH + PADDING_Y;

      drawCardBg(w, h);
      drawAccent(w, state.color);
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

      // description — allow two lines, then truncate
      const descMaxWidth = contentWidth;
      descText.style.wordWrapWidth = descMaxWidth;
      const descAvailH = h - textTop - TITLE_FONT_SIZE - PADDING_Y - FOOTER_HEIGHT - PADDING_Y;
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
      descText.y = textTop + TITLE_FONT_SIZE + 4;

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

      // footer: author badge on the right
      drawAuthorBadge(w, h, state);
    };

    // --- initial draw ---
    layout(currentWidth, currentHeight);

    // --- hover effects ---

    container.on("pointerover", () => {
      hovered = true;
      drawCardBg(currentWidth, currentHeight);
      hintText.visible = true;
      previewIcon.visible = true;
    });

    container.on("pointerout", () => {
      hovered = false;
      drawCardBg(currentWidth, currentHeight);
      hintText.visible = false;
      previewIcon.visible = false;
    });

    // --- click navigation ---

    container.on("pointertap", () => {
      const state = ctx.doc.current;
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
