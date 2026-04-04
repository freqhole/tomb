import { Container, Graphics, Text } from "pixi.js";
import { z } from "zod";
import { colorToCss } from "../src/widgets/format";
import {
  isTransparent,
  safeColor,
  type WidgetController,
  type WidgetFactory,
  type WidgetMountContext,
} from "../src/widgets/widget-types";

export const labelSchema = z.object({
  text: z.string().default("label"),
  bgColor: z.number().default(0xf8fafc),
  textColor: z.number().default(0x1e293b),
  borderColor: z.number().default(0xcbd5e1),
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
    {
      key: "fontFamily",
      label: "font",
      type: "select" as const,
      options: ["system-ui, sans-serif", "Georgia, serif", "Courier New, monospace", "cursive"],
      default: "system-ui, sans-serif",
    },
  ],

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
      const strokeWidth = isEditing ? 3 : 1;
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

    // textarea overlay for inline editing
    let activeTextarea: HTMLTextAreaElement | null = null;

    const exitEditing = () => {
      if (!editing || !activeTextarea) return;
      editing = false;
      const value = activeTextarea.value;
      if (value !== ctx.doc.current.text) {
        ctx.doc.change((draft) => {
          draft.text = value;
        });
      }
      activeTextarea.remove();
      activeTextarea = null;
      textDisplay.text = ctx.doc.current.text;
      textDisplay.visible = true;
      drawBg(currentWidth, currentHeight, false);
    };

    const startEditing = () => {
      if (editing) return;
      editing = true;
      drawBg(currentWidth, currentHeight, true);
      textDisplay.visible = false;

      // calculate screen position of the widget
      const globalPos = container.toGlobal({ x: 0, y: 0 });
      const globalEnd = container.toGlobal({ x: currentWidth, y: currentHeight });
      const canvasRect = ctx.canvasElement.getBoundingClientRect();

      const screenX = canvasRect.left + globalPos.x;
      const screenY = canvasRect.top + globalPos.y;
      const screenW = globalEnd.x - globalPos.x;
      const screenH = globalEnd.y - globalPos.y;

      const state = ctx.doc.current;
      const fontSize = computeFontSize(currentHeight);

      const ta = document.createElement("textarea");
      ta.value = state.text;
      const s = ta.style;
      s.position = "fixed";
      s.left = `${screenX}px`;
      s.top = `${screenY}px`;
      s.width = `${screenW}px`;
      s.height = `${screenH}px`;
      s.fontFamily = state.fontFamily;
      s.fontSize = `${fontSize}px`;
      s.color = colorToCss(state.textColor);
      s.background = "transparent";
      s.border = "none";
      s.outline = "none";
      s.resize = "none";
      s.padding = "8px";
      s.textAlign = "center";
      s.overflow = "hidden";
      s.zIndex = "10000";
      s.boxSizing = "border-box";
      s.lineHeight = "1.3";
      // match word wrap behavior
      s.wordWrap = "break-word";
      s.whiteSpace = "pre-wrap";

      document.body.appendChild(ta);
      activeTextarea = ta;
      ta.focus();
      ta.select();

      ta.addEventListener("blur", () => {
        exitEditing();
      });

      ta.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          // revert — don't commit
          editing = false;
          ta.remove();
          activeTextarea = null;
          textDisplay.text = ctx.doc.current.text;
          textDisplay.visible = true;
          drawBg(currentWidth, currentHeight, false);
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          exitEditing();
        }
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
        if (activeTextarea) {
          activeTextarea.remove();
          activeTextarea = null;
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
