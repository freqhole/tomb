import { Container, Graphics, Text } from "pixi.js";
import { z } from "zod";
import { colorToCss } from "../src/widgets/format";
import { createDomOverlay, type DomOverlayHandle } from "../src/widgets/dom-overlay";
import {
  isTransparent,
  safeColor,
  type CompactInfo,
  type WidgetController,
  type WidgetFactory,
  type WidgetMountContext,
} from "../src/widgets/widget-types";

export const labelSchema = z.object({
  text: z.string().default("label"),
  bgColor: z.number().default(0xf8fafc),
  textColor: z.number().default(0x1e293b),
  borderColor: z.number().default(0xcbd5e1),
  borderWidth: z.number().default(1),
  fontFamily: z.string().default("system-ui, sans-serif"),
});

export type LabelState = z.infer<typeof labelSchema>;

// colors (editing-only visual states, not configurable)
const BORDER_EDITING_COLOR = 0xd946ef;

function computeFontSize(height: number): number {
  return Math.max(12, Math.min(height * 0.5, 120));
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
      options: ["system-ui, sans-serif", "Georgia, serif", "Courier New, monospace", "cursive"],
      default: "system-ui, sans-serif",
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
    const textDisplay = new Text({
      text: ctx.doc.current.text,
      resolution: 2,
      style: {
        fontFamily: ctx.doc.current.fontFamily,
        fontSize: computeFontSize(currentHeight),
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
      const fontSize = computeFontSize(h);
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
      const fontSize = computeFontSize(currentHeight);

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
