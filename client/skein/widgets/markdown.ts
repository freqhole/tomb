import {
  Container,
  Graphics,
  Text,
  type TextStyleFontStyle,
  type TextStyleFontWeight,
} from "pixi.js";
import { z } from "zod";
import type { KeyboardHandler } from "../src/widgets/keyboard-driver";
import {
  isTransparent,
  safeColor,
  type WidgetController,
  type WidgetFactory,
  type WidgetMountContext,
} from "../src/widgets/widget-types";

const PADDING = 12;
const BG_EDITING_COLOR = 0x1a1a2e;
const BORDER_EDITING_COLOR = 0xd946ef;

export const markdownSchema = z.object({
  text: z
    .string()
    .default(
      "# hello\n\nthis is a **markdown** widget.\n\n- item one\n- item two\n\n---\n\n*italic text* and regular text."
    ),
  bgColor: z.number().default(0x0f0f1a),
  textColor: z.number().default(0xd4d4e0),
  headingColor: z.number().default(0xf0f0ff),
  accentColor: z.number().default(0xd946ef),
  fontFamily: z.string().default("system-ui, sans-serif"),
  fontSize: z.number().default(13),
});

export type MarkdownState = z.infer<typeof markdownSchema>;

// strip inline bold/italic markers for display purposes.
// mixed inline styles within a single PixiJS Text object aren't supported,
// so we just remove the markers and render as plain text for now.
function stripInlineMarkers(line: string): string {
  return line.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");
}

export const markdownWidget: WidgetFactory<typeof markdownSchema> = {
  type: "markdown",
  metadata: {
    name: "markdown",
    description: "a markdown text renderer with inline editing",
    version: "0.1.0",
    category: "text",
  },
  schema: markdownSchema,
  editableProps: [
    { key: "bgColor", label: "background", type: "color" as const, default: 0x0f0f1a },
    { key: "textColor", label: "text color", type: "color" as const, default: 0xd4d4e0 },
    { key: "headingColor", label: "heading color", type: "color" as const, default: 0xf0f0ff },
    { key: "accentColor", label: "accent color", type: "color" as const, default: 0xd946ef },
    { key: "fontSize", label: "font size", type: "number" as const, default: 13 },
    {
      key: "fontFamily",
      label: "font",
      type: "select" as const,
      options: ["system-ui, sans-serif", "Georgia, serif", "Courier New, monospace", "cursive"],
      default: "system-ui, sans-serif",
    },
  ],

  create(ctx: WidgetMountContext<typeof markdownSchema>): WidgetController {
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
      bg.roundRect(0, 0, w, h, 6);
      const fillColor = isEditing ? BG_EDITING_COLOR : state.bgColor;
      bg.fill(fillColor === -1 ? { color: 0, alpha: 0 } : { color: fillColor });
      bg.stroke({
        color: isEditing ? BORDER_EDITING_COLOR : 0x2a2a3a,
        width: isEditing ? 2 : 1,
      });
    };
    drawBg(currentWidth, currentHeight, false);
    container.addChild(bg);

    // content container — holds rendered elements and gets clipped
    const content = new Container();
    content.x = PADDING;
    content.y = PADDING;
    container.addChild(content);

    // clip mask to prevent overflow
    const clipMask = new Graphics();
    const drawClipMask = (w: number, h: number) => {
      clipMask.clear();
      clipMask.rect(PADDING, PADDING, w - PADDING * 2, h - PADDING * 2);
      clipMask.fill({ color: 0xffffff });
    };
    drawClipMask(currentWidth, currentHeight);
    container.addChild(clipMask);
    content.mask = clipMask;

    const contentWidth = () => Math.max(currentWidth - PADDING * 2, 1);

    // rendered elements for the parsed markdown output
    let renderedElements: (Text | Graphics)[] = [];

    // raw text display shown during editing (like notepad)
    const rawText = new Text({
      text: ctx.doc.current.text,
      style: {
        fontFamily: ctx.doc.current.fontFamily,
        fontSize: ctx.doc.current.fontSize,
        fill: safeColor(ctx.doc.current.textColor),
        wordWrap: true,
        wordWrapWidth: contentWidth(),
      },
    });
    rawText.visible = false;
    rawText.alpha = isTransparent(ctx.doc.current.textColor) ? 0 : 1;
    content.addChild(rawText);

    // cursor indicator (thin line shown during editing)
    const cursor = new Graphics();
    cursor.visible = false;
    content.addChild(cursor);

    let cursorBlinkInterval: ReturnType<typeof setInterval> | null = null;

    // parse and render markdown source into PixiJS display objects
    function renderMarkdown(source: string, state: MarkdownState) {
      // clear existing rendered elements
      for (const el of renderedElements) {
        content.removeChild(el);
        el.destroy();
      }
      renderedElements = [];

      const lines = source.split("\n");
      let y = 0;
      const cw = contentWidth();

      for (const line of lines) {
        // blank line — paragraph spacing
        if (line.trim() === "") {
          y += state.fontSize * 0.6;
          continue;
        }

        // horizontal rule
        if (line.trim() === "---") {
          const rule = new Graphics();
          rule.rect(0, y + state.fontSize * 0.3, cw, 1);
          rule.fill(
            isTransparent(state.accentColor) ? { color: 0, alpha: 0 } : { color: state.accentColor }
          );
          content.addChild(rule);
          renderedElements.push(rule);
          y += state.fontSize * 0.8;
          continue;
        }

        let text: string;
        let fontSize: number;
        let fontWeight: TextStyleFontWeight = "normal";
        let fontStyle: TextStyleFontStyle = "normal";
        let fill: number;
        let prefix = "";

        if (line.startsWith("### ")) {
          text = line.slice(4);
          fontSize = state.fontSize * 1.1;
          fontWeight = "bold";
          fill = state.headingColor;
        } else if (line.startsWith("## ")) {
          text = line.slice(3);
          fontSize = state.fontSize * 1.3;
          fontWeight = "bold";
          fill = state.headingColor;
        } else if (line.startsWith("# ")) {
          text = line.slice(2);
          fontSize = state.fontSize * 1.6;
          fontWeight = "bold";
          fill = state.headingColor;
        } else if (line.startsWith("- ")) {
          prefix = "\u2022 ";
          text = stripInlineMarkers(line.slice(2));
          fontSize = state.fontSize;
          fill = state.textColor;
        } else {
          text = stripInlineMarkers(line);
          fontSize = state.fontSize;
          fill = state.textColor;
        }

        const textObj = new Text({
          text: prefix + text,
          style: {
            fontFamily: state.fontFamily,
            fontSize,
            fontWeight,
            fontStyle,
            fill: safeColor(fill),
            wordWrap: true,
            wordWrapWidth: cw,
          },
        });
        textObj.alpha = isTransparent(fill) ? 0 : 1;
        textObj.y = y;
        content.addChild(textObj);
        renderedElements.push(textObj);
        y += textObj.height + state.fontSize * 0.25;
      }
    }

    // initial render
    renderMarkdown(ctx.doc.current.text, ctx.doc.current);

    const updateCursorPosition = () => {
      cursor.clear();
      if (!editing) {
        cursor.visible = false;
        return;
      }
      const textBounds = rawText.getBounds();
      const localRight = rawText.text.length > 0 ? Math.min(textBounds.width, contentWidth()) : 0;
      const localBottom = rawText.text.length > 0 ? textBounds.height : ctx.doc.current.fontSize;
      cursor.rect(
        localRight + 1,
        localBottom - ctx.doc.current.fontSize,
        1.5,
        ctx.doc.current.fontSize
      );
      cursor.fill(
        isTransparent(ctx.doc.current.textColor)
          ? { color: 0, alpha: 0 }
          : { color: ctx.doc.current.textColor }
      );
      cursor.visible = true;
    };

    const startCursorBlink = () => {
      updateCursorPosition();
      if (cursorBlinkInterval) clearInterval(cursorBlinkInterval);
      cursorBlinkInterval = setInterval(() => {
        if (cursor.visible) {
          cursor.visible = !cursor.visible;
        } else {
          updateCursorPosition();
        }
      }, 530);
    };

    const stopCursorBlink = () => {
      if (cursorBlinkInterval) {
        clearInterval(cursorBlinkInterval);
        cursorBlinkInterval = null;
      }
      cursor.visible = false;
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

    // switch from rendered markdown to raw editing mode
    const showEditingView = () => {
      for (const el of renderedElements) {
        el.visible = false;
      }
      rawText.visible = true;
    };

    // switch from raw editing mode back to rendered markdown
    const showRenderedView = () => {
      rawText.visible = false;
      const state = ctx.doc.current;
      renderMarkdown(state.text, state);
    };

    // exit edit mode, flush pending changes, re-render markdown
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
      stopCursorBlink();
      drawBg(currentWidth, currentHeight, false);
      showRenderedView();
    };

    // keyboard handler for the hidden textarea
    const handler: KeyboardHandler = {
      onInput(value: string) {
        rawText.text = value;
        debouncedCommit(value);
        updateCursorPosition();
      },
      onKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") {
          // discard in-flight debounce — revert to last committed value
          if (debounceTimer !== null) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
          }
          rawText.text = ctx.doc.current.text;
          editing = false;
          ctx.keyboard.release();
          stopCursorBlink();
          drawBg(currentWidth, currentHeight, false);
          showRenderedView();
          return;
        }
        // enter without shift exits editing and commits
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          exitEditing();
        }
      },
      onBlur() {
        exitEditing();
      },
    };

    // double-click to enter edit mode (same pattern as label widget)
    let lastTapTime = 0;
    bg.eventMode = "static";
    bg.cursor = "default";
    bg.on("pointertap", () => {
      const now = Date.now();
      if (now - lastTapTime < 400) {
        // double-click detected
        if (!editing) {
          editing = true;
          drawBg(currentWidth, currentHeight, true);
          rawText.text = ctx.doc.current.text;
          showEditingView();
          ctx.keyboard.acquire(handler, ctx.doc.current.text);
          startCursorBlink();
        }
        lastTapTime = 0;
      } else {
        lastTapTime = now;
      }
    });

    // subscribe to remote doc changes
    const unsub = ctx.doc.on("change", (state) => {
      if (!editing) {
        renderMarkdown(state.text, state);
      } else {
        // if a remote change arrives while editing, sync the textarea
        if (state.text !== ctx.keyboard.value) {
          ctx.keyboard.setValue(state.text);
          rawText.text = state.text;
        }
      }
      // apply style changes to raw text display (always)
      rawText.style.fill = safeColor(state.textColor);
      rawText.alpha = isTransparent(state.textColor) ? 0 : 1;
      rawText.style.fontFamily = state.fontFamily;
      rawText.style.fontSize = state.fontSize;
      rawText.style.wordWrapWidth = contentWidth();
      drawBg(currentWidth, currentHeight, editing);
    });

    return {
      container,

      destroy() {
        stopCursorBlink();
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        if (editing) ctx.keyboard.release();
        unsub();
        container.destroy({ children: true });
      },

      resize(width: number, height: number) {
        currentWidth = width;
        currentHeight = height;
        drawBg(width, height, editing);
        drawClipMask(width, height);
        rawText.style.wordWrapWidth = contentWidth();
        if (!editing) {
          renderMarkdown(ctx.doc.current.text, ctx.doc.current);
        }
        updateCursorPosition();
      },
    };
  },
};
