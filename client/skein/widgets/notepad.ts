import { Container, Graphics, Text } from "pixi.js";
import { z } from "zod";
import { createDomOverlay, type DomOverlayHandle } from "../src/widgets/dom-overlay";
import { colorToCss } from "../src/widgets/format";
import {
  isTransparent,
  safeColor,
  type WidgetController,
  type WidgetFactory,
  type WidgetMountContext,
} from "../src/widgets/widget-types";

const PADDING = 10;
const BORDER_EDITING_COLOR = 0xd946ef;
const PLACEHOLDER_COLOR = 0x94a3b8;

export const notepadSchema = z.object({
  text: z.string().default(""),
  bgColor: z.number().default(0xfefefe),
  textColor: z.number().default(0x1e293b),
  borderColor: z.number().default(0xcbd5e1),
  fontSize: z.number().default(13),
  fontFamily: z.string().default("system-ui, sans-serif"),
});

export type NotepadState = z.infer<typeof notepadSchema>;

export const notepadWidget: WidgetFactory<typeof notepadSchema> = {
  type: "notepad",
  metadata: {
    name: "notepad",
    description: "a multi-line text notepad with word wrap",
    version: "0.1.0",
    category: "text",
  },
  schema: notepadSchema,
  editableProps: [
    { key: "bgColor", label: "background", type: "color" as const, default: 0xfefefe },
    { key: "textColor", label: "text color", type: "color" as const, default: 0x1e293b },
    { key: "borderColor", label: "border", type: "color" as const, default: 0xcbd5e1 },
    { key: "fontSize", label: "font size", type: "number" as const, default: 13 },
    {
      key: "fontFamily",
      label: "font",
      type: "select" as const,
      options: ["system-ui, sans-serif", "Georgia, serif", "Courier New, monospace", "cursive"],
      default: "system-ui, sans-serif",
    },
  ],

  create(ctx: WidgetMountContext<typeof notepadSchema>): WidgetController {
    const container = new Container();
    let editing = false;
    let currentWidth = ctx.width;
    let currentHeight = ctx.height;

    // background
    const bg = new Graphics();
    const drawBg = (w: number, h: number, isEditing: boolean) => {
      const state = ctx.doc.current;
      bg.clear();
      bg.roundRect(0, 0, w, h, 6);
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

    // content container — holds text and gets clipped
    const content = new Container();
    content.x = PADDING;
    content.y = PADDING;
    container.addChild(content);

    // clip mask for content area
    const clipMask = new Graphics();
    const drawClipMask = (w: number, h: number) => {
      clipMask.clear();
      clipMask.rect(PADDING, PADDING, w - PADDING * 2, h - PADDING * 2);
      clipMask.fill({ color: 0xffffff });
    };
    drawClipMask(currentWidth, currentHeight);
    container.addChild(clipMask);
    content.mask = clipMask;

    // main text display
    const contentWidth = () => Math.max(currentWidth - PADDING * 2, 1);

    const textDisplay = new Text({
      text: ctx.doc.current.text,
      style: {
        fontFamily: ctx.doc.current.fontFamily,
        fontSize: ctx.doc.current.fontSize,
        fill: safeColor(ctx.doc.current.textColor),
        wordWrap: true,
        wordWrapWidth: contentWidth(),
      },
    });
    content.addChild(textDisplay);
    textDisplay.alpha = isTransparent(ctx.doc.current.textColor) ? 0 : 1;

    // placeholder text
    const placeholder = new Text({
      text: "double-click to type...",
      style: {
        fontFamily: ctx.doc.current.fontFamily,
        fontSize: ctx.doc.current.fontSize,
        fontStyle: "italic",
        fill: PLACEHOLDER_COLOR,
      },
    });
    content.addChild(placeholder);

    const updatePlaceholderVisibility = () => {
      const hasText = textDisplay.text.length > 0;
      placeholder.visible = !hasText && !editing;
    };

    const updateWordWrap = () => {
      textDisplay.style.wordWrapWidth = contentWidth();
    };

    updatePlaceholderVisibility();

    // DOM overlay for inline editing
    let activeOverlay: DomOverlayHandle | null = null;

    const startEditing = () => {
      if (editing) return;
      editing = true;
      drawBg(currentWidth, currentHeight, true);
      textDisplay.visible = false;
      placeholder.visible = false;

      const state = ctx.doc.current;

      activeOverlay = createDomOverlay({
        container,
        canvasElement: ctx.canvasElement,
        width: currentWidth,
        height: currentHeight,
        multiline: true,
        value: state.text,
        enterCommits: false, // Enter inserts newlines in notepad
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
          updatePlaceholderVisibility();
        },
        onRevert: () => {
          editing = false;
          activeOverlay = null;
          textDisplay.text = ctx.doc.current.text;
          textDisplay.visible = true;
          drawBg(currentWidth, currentHeight, false);
          updatePlaceholderVisibility();
        },
        css: {
          fontFamily: state.fontFamily,
          fontSize: `${state.fontSize}px`,
          color: colorToCss(state.textColor),
          padding: `${PADDING}px`,
          overflow: "auto",
          lineHeight: "1.4",
          whiteSpace: "pre-wrap",
          wordWrap: "break-word",
        },
      });
    };

    // double-click to enter edit mode
    let lastTapTime = 0;
    bg.eventMode = "static";
    bg.cursor = "text";
    bg.on("pointertap", () => {
      if (editing) return;
      const now = Date.now();
      if (now - lastTapTime < 400) {
        startEditing();
        lastTapTime = 0;
      } else {
        lastTapTime = now;
      }
    });

    // subscribe to remote doc changes
    const unsub = ctx.doc.on("change", (state) => {
      if (!editing) {
        textDisplay.text = state.text;
      }
      // apply style changes
      textDisplay.style.fill = safeColor(state.textColor);
      textDisplay.alpha = isTransparent(state.textColor) ? 0 : 1;
      textDisplay.style.fontFamily = state.fontFamily;
      textDisplay.style.fontSize = state.fontSize;
      placeholder.style.fontFamily = state.fontFamily;
      placeholder.style.fontSize = state.fontSize;
      drawBg(currentWidth, currentHeight, editing);
      updatePlaceholderVisibility();
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
        if (editing && activeOverlay) {
          activeOverlay.element.blur();
        }
        currentWidth = width;
        currentHeight = height;
        drawBg(width, height, false);
        drawClipMask(width, height);
        updateWordWrap();
      },
    };
  },
};
