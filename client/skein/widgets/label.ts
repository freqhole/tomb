import { Container, Graphics, Text } from "pixi.js";
import { z } from "zod";
import { FONT_OPTIONS } from "../src/fonts/font-loader";
import { createDomOverlay, type DomOverlayHandle } from "../src/widgets/dom-overlay";
import { colorToCss } from "../src/widgets/format";
import {
  isTransparent,
  safeColor,
  type CompactInfo,
  type WidgetController,
  type WidgetFactory,
  type WidgetMountContext,
} from "../src/widgets/widget-types";

// ---------------------------------------------------------------------------
// random high-contrast color generation for new labels
// ---------------------------------------------------------------------------

/** curated palette of high-contrast background + text pairs.
 *  each entry guarantees legibility — WCAG AA contrast ratio or better. */
const HIGH_CONTRAST_PAIRS: Array<{ bg: number; text: number }> = [
  // dark backgrounds with light text
  { bg: 0x1e293b, text: 0xf8fafc }, // slate-800 / slate-50
  { bg: 0x1e1b4b, text: 0xe0e7ff }, // indigo-950 / indigo-100
  { bg: 0x312e81, text: 0xc7d2fe }, // indigo-800 / indigo-200
  { bg: 0x3b0764, text: 0xf5d0fe }, // purple-950 / purple-200
  { bg: 0x581c87, text: 0xf3e8ff }, // purple-800 / purple-50
  { bg: 0x831843, text: 0xfce7f3 }, // pink-800 / pink-100
  { bg: 0x7f1d1d, text: 0xfee2e2 }, // red-800 / red-100
  { bg: 0x713f12, text: 0xfef9c3 }, // yellow-800 / yellow-100
  { bg: 0x14532d, text: 0xdcfce7 }, // green-900 / green-100
  { bg: 0x134e4a, text: 0xccfbf1 }, // teal-900 / teal-100
  { bg: 0x0c4a6e, text: 0xe0f2fe }, // sky-800 / sky-100
  { bg: 0x172554, text: 0xdbeafe }, // blue-950 / blue-100
  // light backgrounds with dark text
  { bg: 0xf8fafc, text: 0x1e293b }, // slate-50 / slate-800
  { bg: 0xfef3c7, text: 0x78350f }, // amber-100 / amber-900
  { bg: 0xdcfce7, text: 0x14532d }, // green-100 / green-900
  { bg: 0xdbeafe, text: 0x1e3a8a }, // blue-100 / blue-800
  { bg: 0xfce7f3, text: 0x831843 }, // pink-100 / pink-800
  { bg: 0xe0e7ff, text: 0x312e81 }, // indigo-100 / indigo-800
  { bg: 0xf3e8ff, text: 0x581c87 }, // purple-50 / purple-800
  { bg: 0xfee2e2, text: 0x991b1b }, // red-100 / red-800
  { bg: 0xffedd5, text: 0x9a3412 }, // orange-100 / orange-800
  { bg: 0xccfbf1, text: 0x134e4a }, // teal-100 / teal-900
  { bg: 0xe0f2fe, text: 0x0c4a6e }, // sky-100 / sky-800
  { bg: 0xfefce8, text: 0x713f12 }, // yellow-50 / yellow-800
];

/** border colors that work well across both dark and light backgrounds */
const BORDER_COLORS = [
  0xcbd5e1, 0xa5b4fc, 0xc084fc, 0xf472b6, 0xfb923c, 0xfbbf24, 0x4ade80, 0x2dd4bf, 0x38bdf8,
  0x818cf8, 0x94a3b8, 0x6366f1, 0x8b5cf6, 0xec4899, 0xf97316, 0x22c55e, 0x14b8a6, 0x3b82f6,
  0xef4444, 0xeab308,
];

const BORDER_WIDTHS = [1, 8, 16, 24, 32];

function randomLabelColors(): { bg: number; text: number; border: number; borderWidth: number } {
  const pair = HIGH_CONTRAST_PAIRS[Math.floor(Math.random() * HIGH_CONTRAST_PAIRS.length)];
  const border = BORDER_COLORS[Math.floor(Math.random() * BORDER_COLORS.length)];
  const borderWidth = BORDER_WIDTHS[Math.floor(Math.random() * BORDER_WIDTHS.length)];
  return { bg: pair.bg, text: pair.text, border, borderWidth };
}

/** generate a coherent set of random label defaults.
 *  called once and the results cached for the duration of this parse. */
let _cachedRandom: ReturnType<typeof randomLabelColors> | null = null;
let _cacheTime = 0;

function getCachedRandom(): ReturnType<typeof randomLabelColors> {
  const now = Date.now();
  // cache for 50ms — within a single schema.parse() call all fields see the same random
  if (!_cachedRandom || now - _cacheTime > 50) {
    _cachedRandom = randomLabelColors();
    _cacheTime = now;
  }
  return _cachedRandom;
}

export const labelSchema = z.object({
  text: z.string().default("label"),
  bgColor: z.number().default(() => getCachedRandom().bg),
  textColor: z.number().default(() => getCachedRandom().text),
  borderColor: z.number().default(() => getCachedRandom().border),
  borderWidth: z.number().default(() => getCachedRandom().borderWidth),
  fontFamily: z.string().default("system-ui, sans-serif"),
  autofit: z.boolean().default(true),
  fontSize: z.number().default(32),
});

export type LabelState = z.infer<typeof labelSchema>;

// colors (editing-only visual states, not configurable)
const BORDER_EDITING_COLOR = 0xd946ef;

/** compute the best font size to fill the available space.
 *  iteratively tries sizes to find the largest that fits. */
function computeAutoFitSize(text: string, fontFamily: string, w: number, h: number): number {
  const padX = 16;
  const padY = 16;
  const availW = Math.max(w - padX, 1);
  const availH = Math.max(h - padY, 1);

  // start from height-based estimate and adjust
  let fontSize = Math.min(availH * 0.8, 200);

  // create a measurement text
  const measure = new Text({
    text: text || "label",
    style: {
      fontFamily,
      fontSize,
      wordWrap: true,
      wordWrapWidth: availW,
      align: "center",
    },
  });

  // shrink until it fits, minimum 8px
  let iterations = 0;
  while (fontSize > 8 && iterations < 30) {
    measure.style.fontSize = fontSize;
    measure.style.wordWrapWidth = availW;

    // access width/height to trigger measurement
    const tw = measure.width;
    const th = measure.height;

    if (tw <= availW && th <= availH) {
      break; // fits!
    }

    // shrink proportionally based on the bigger overflow
    const scaleW = availW / Math.max(tw, 1);
    const scaleH = availH / Math.max(th, 1);
    const scale = Math.min(scaleW, scaleH);
    fontSize = Math.max(8, Math.floor(fontSize * scale * 0.95)); // 0.95 for safety margin
    iterations++;
  }

  measure.destroy();
  return Math.max(fontSize, 8);
}

export const labelWidget: WidgetFactory<typeof labelSchema> = {
  type: "label",
  metadata: {
    name: "label",
    description: "a resizable text label with inline editing",
    version: "0.1.0",
    category: "basics",
  },
  schema: labelSchema,
  editableProps: [
    { key: "bgColor", label: "background", type: "color" as const, default: 0xf8fafc },
    { key: "textColor", label: "text color", type: "color" as const, default: 0x1e293b },
    { key: "borderColor", label: "border", type: "color" as const, default: 0xcbd5e1 },
    { key: "borderWidth", label: "border width", type: "number" as const, default: 1 },
    {
      key: "fontFamily",
      label: "font",
      type: "select" as const,
      options: FONT_OPTIONS,
      default: "system-ui, sans-serif",
    },
    {
      key: "autofit",
      label: "auto-fit text",
      type: "boolean" as const,
      default: true,
    },
    {
      key: "fontSize",
      label: "font size",
      type: "number" as const,
      default: 32,
      visibleWhen: { key: "autofit", value: false },
    },
  ],

  getCompactInfo: (state: LabelState): CompactInfo => ({
    label: state.text || "label",
  }),

  create(ctx: WidgetMountContext<typeof labelSchema>): WidgetController {
    const container = new Container();
    let editing = false;
    let currentWidth = ctx.width;
    let currentHeight = ctx.height;

    // background
    const bg = new Graphics();
    const drawBg = (w: number, h: number, isEditing: boolean) => {
      const state = ctx.doc.current;
      bg.clear();
      bg.roundRect(0, 0, w, h, 8);
      bg.fill(state.bgColor === -1 ? { color: 0, alpha: 0 } : { color: state.bgColor });
      const strokeColor = isEditing ? BORDER_EDITING_COLOR : state.borderColor;
      const strokeWidth = isEditing ? 3 : state.borderWidth;
      bg.stroke(
        strokeColor === -1
          ? { color: 0, alpha: 0, width: strokeWidth }
          : { color: strokeColor, width: strokeWidth }
      );
    };
    drawBg(currentWidth, currentHeight, false);
    container.addChild(bg);

    // text display
    const initialState = ctx.doc.current;
    const initialFontSize = initialState.autofit
      ? computeAutoFitSize(initialState.text, initialState.fontFamily, currentWidth, currentHeight)
      : initialState.fontSize;

    const textDisplay = new Text({
      text: ctx.doc.current.text,
      resolution: 2,
      style: {
        fontFamily: ctx.doc.current.fontFamily,
        fontSize: initialFontSize,
        fill: safeColor(ctx.doc.current.textColor),
        wordWrap: true,
        wordWrapWidth: currentWidth - 16,
        align: "center",
      },
    });
    textDisplay.anchor.set(0.5);
    textDisplay.x = currentWidth / 2;
    textDisplay.y = currentHeight / 2;
    container.addChild(textDisplay);
    textDisplay.alpha = isTransparent(ctx.doc.current.textColor) ? 0 : 1;

    // reposition text and clamp word wrap after resize or font change
    const relayout = (w: number, h: number) => {
      const state = ctx.doc.current;
      const fontSize = state.autofit
        ? computeAutoFitSize(state.text, state.fontFamily, w, h)
        : state.fontSize;
      textDisplay.style.fontSize = fontSize;
      textDisplay.style.wordWrapWidth = w - 16;
      textDisplay.x = w / 2;
      textDisplay.y = h / 2;
    };

    // DOM overlay for inline editing
    let activeOverlay: DomOverlayHandle | null = null;

    const startEditing = () => {
      if (editing) return;
      editing = true;
      drawBg(currentWidth, currentHeight, true);
      textDisplay.visible = false;

      const state = ctx.doc.current;
      const fontSize = state.autofit
        ? computeAutoFitSize(state.text, state.fontFamily, currentWidth, currentHeight)
        : state.fontSize;

      activeOverlay = createDomOverlay({
        container,
        canvasElement: ctx.canvasElement,
        width: currentWidth,
        height: currentHeight,
        multiline: true, // label uses textarea for centering/wrapping
        value: state.text,
        enterCommits: true, // Enter commits for label (single-line semantics)
        selectAll: true,
        onCommit: (value: string) => {
          editing = false;
          activeOverlay = null;
          if (value !== ctx.doc.current.text) {
            ctx.doc.change((draft) => {
              draft.text = value;
            });
          }
          textDisplay.text = ctx.doc.current.text;
          textDisplay.visible = true;
          drawBg(currentWidth, currentHeight, false);
        },
        onRevert: () => {
          editing = false;
          activeOverlay = null;
          textDisplay.text = ctx.doc.current.text;
          textDisplay.visible = true;
          drawBg(currentWidth, currentHeight, false);
        },
        css: {
          fontFamily: state.fontFamily,
          fontSize: `${fontSize}px`,
          color: colorToCss(state.textColor),
          padding: "8px",
          textAlign: "center",
          overflow: "hidden",
          lineHeight: "1.3",
          wordWrap: "break-word",
          whiteSpace: "pre-wrap",
        },
      });
    };

    // double-click to enter edit mode
    let lastTapTime = 0;
    container.eventMode = "static";
    container.cursor = "default";
    container.on("pointertap", () => {
      if (editing) return; // don't re-trigger while textarea is active
      const now = Date.now();
      if (now - lastTapTime < 400) {
        startEditing();
        lastTapTime = 0;
      } else {
        lastTapTime = now;
      }
    });

    // subscribe to remote changes
    const unsub = ctx.doc.on("change", (state) => {
      if (!editing) {
        textDisplay.text = state.text;
      }
      // apply style changes (always, whether editing text or not)
      textDisplay.style.fill = safeColor(state.textColor);
      textDisplay.alpha = isTransparent(state.textColor) ? 0 : 1;
      textDisplay.style.fontFamily = state.fontFamily;
      drawBg(currentWidth, currentHeight, editing);
      // relayout handles autofit vs manual fontSize
      relayout(currentWidth, currentHeight);
    });

    return {
      container,
      destroy() {
        if (activeOverlay) {
          activeOverlay.remove();
          activeOverlay = null;
        }
        unsub();
        container.destroy({ children: true });
      },
      resize(width: number, height: number) {
        currentWidth = width;
        currentHeight = height;
        drawBg(width, height, editing);
        relayout(width, height);
      },
    };
  },
};
