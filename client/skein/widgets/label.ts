import { Container, Graphics, Text } from "pixi.js";
import { z } from "zod";
import type { KeyboardHandler } from "../src/widgets/keyboard-driver";
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
const BG_EDITING_COLOR = 0xfefce8;
const BORDER_EDITING_COLOR = 0xfbbf24;

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
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    // background
    const bg = new Graphics();
    const drawBg = (w: number, h: number, isEditing: boolean) => {
      const state = ctx.doc.current;
      bg.clear();
      bg.roundRect(0, 0, w, h, 8);
      const fillColor = isEditing ? BG_EDITING_COLOR : state.bgColor;
      const strokeColor = isEditing ? BORDER_EDITING_COLOR : state.borderColor;
      const strokeWidth = isEditing ? 2 : 1;
      bg.fill(fillColor === -1 ? { color: 0, alpha: 0 } : { color: fillColor });
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

    // commit current text to the doc (debounced during editing)
    const commitText = (value: string) => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      ctx.doc.change((draft) => {
        draft.text = value;
      });
    };

    const debouncedCommit = (value: string) => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => commitText(value), 150);
    };

    // exit edit mode, flush pending changes
    const exitEditing = () => {
      if (!editing) return;
      editing = false;
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      // commit the final value from the keyboard driver before releasing
      const finalValue = ctx.keyboard.value;
      if (finalValue !== ctx.doc.current.text) {
        commitText(finalValue);
      }
      ctx.keyboard.release();
      textDisplay.text = ctx.doc.current.text;
      drawBg(currentWidth, currentHeight, false);
    };

    // keyboard handler for the hidden textarea
    const handler: KeyboardHandler = {
      onInput(value: string) {
        textDisplay.text = value;
        debouncedCommit(value);
      },
      onKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") {
          // discard in-flight debounce — revert to last committed value
          if (debounceTimer !== null) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
          }
          textDisplay.text = ctx.doc.current.text;
          editing = false;
          ctx.keyboard.release();
          drawBg(currentWidth, currentHeight, false);
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          exitEditing();
        }
      },
      onBlur() {
        exitEditing();
      },
    };

    // double-click to enter edit mode
    let lastTapTime = 0;
    container.eventMode = "static";
    container.cursor = "default";
    container.on("pointertap", () => {
      const now = Date.now();
      if (now - lastTapTime < 400) {
        // double-click detected
        if (!editing) {
          editing = true;
          drawBg(currentWidth, currentHeight, true);
          ctx.keyboard.acquire(handler, ctx.doc.current.text);
        }
        lastTapTime = 0;
      } else {
        lastTapTime = now;
      }
    });

    // subscribe to remote changes
    const unsub = ctx.doc.on("change", (state) => {
      if (!editing) {
        textDisplay.text = state.text;
      } else {
        // if we're editing and a remote change arrives, sync the textarea
        // only if the remote value differs from what's in the textarea
        if (state.text !== ctx.keyboard.value) {
          ctx.keyboard.setValue(state.text);
          textDisplay.text = state.text;
        }
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
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        if (editing) ctx.keyboard.release();
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
