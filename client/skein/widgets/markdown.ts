import {
  Container,
  Graphics,
  Text,
  type TextStyleFontStyle,
  type TextStyleFontWeight,
} from "pixi.js";
import { z } from "zod";
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

const PADDING = 12;
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
  borderWidth: z.number().default(1),
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
    { key: "borderWidth", label: "border width", type: "number" as const, default: 1 },
    {
      key: "fontFamily",
      label: "font",
      type: "select" as const,
      options: ["system-ui, sans-serif", "Georgia, serif", "Courier New, monospace", "cursive"],
      default: "system-ui, sans-serif",
    },
  ],

  getCompactInfo: (state: MarkdownState): CompactInfo => ({
    label:
      state.text
        .split("\n")
        .find((l) => l.trim() !== "")
        ?.replace(/^#+\s*/, "")
        .trim() || "markdown",
  }),

  create(ctx: WidgetMountContext<typeof markdownSchema>): WidgetController {
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
      bg.stroke({
        color: isEditing ? BORDER_EDITING_COLOR : 0x2a2a3a,
        width: isEditing ? 3 : state.borderWidth,
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
        const fontStyle: TextStyleFontStyle = "normal";
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
          resolution: 2,
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

    // DOM overlay for inline editing
    let activeOverlay: DomOverlayHandle | null = null;

    const startEditing = () => {
      if (editing) return;
      editing = true;
      drawBg(currentWidth, currentHeight, true);

      // hide rendered markdown elements while editing
      for (const el of renderedElements) {
        el.visible = false;
      }

      const state = ctx.doc.current;

      activeOverlay = createDomOverlay({
        container,
        canvasElement: ctx.canvasElement,
        width: currentWidth,
        height: currentHeight,
        multiline: true,
        value: state.text,
        enterCommits: false, // Enter inserts newlines in markdown
        onCommit: (value: string) => {
          editing = false;
          activeOverlay = null;
          if (value !== ctx.doc.current.text) {
            ctx.doc.change((draft) => {
              draft.text = value;
            });
          }
          renderMarkdown(ctx.doc.current.text, ctx.doc.current);
          drawBg(currentWidth, currentHeight, false);
        },
        onRevert: () => {
          editing = false;
          activeOverlay = null;
          renderMarkdown(ctx.doc.current.text, ctx.doc.current);
          drawBg(currentWidth, currentHeight, false);
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
    bg.cursor = "default";
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
        renderMarkdown(state.text, state);
      }
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
        if (editing && activeOverlay) {
          activeOverlay.element.blur();
        }
        currentWidth = width;
        currentHeight = height;
        drawBg(width, height, false);
        drawClipMask(width, height);
        renderMarkdown(ctx.doc.current.text, ctx.doc.current);
      },
    };
  },
};
