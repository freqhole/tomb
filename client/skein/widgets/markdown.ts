import { Container, Graphics, HTMLText, Text, type TextStyleFontWeight } from "pixi.js";
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
      "# hello\n\nthis is a **markdown** widget.\n\n- item one\n- item two\n\n---\n\n*italic text* and `code text` and regular text."
    ),
  bgColor: z.number().default(0x0f0f1a),
  textColor: z.number().default(0xd4d4e0),
  headingColor: z.number().default(0xf0f0ff),
  accentColor: z.number().default(0xd946ef),
  codeColor: z.number().default(0xe0e0e8),
  codeBgColor: z.number().default(0x2a2a3a),
  fontFamily: z.string().default("system-ui, sans-serif"),
  fontSize: z.number().default(13),
  borderWidth: z.number().default(1),
});

export type MarkdownState = z.infer<typeof markdownSchema>;

// ---------------------------------------------------------------------------
// markdown inline syntax → pixi tag conversion
//
// converts markdown inline markers to XML-style tags that pixi's
// HTMLText tagStyles + cssOverrides can render with distinct styles:
//   **bold**   → <b>bold</b>
//   *italic*   → <i>italic</i>
//   `code`     → <code>code</code>
//
// order matters — bold (**) must be matched before italic (*) to avoid
// partial matches. literal angle brackets in the source are replaced
// with placeholders before tag conversion, then resolved to the correct
// escape form (HTML entities for HTMLText, zero-width spaces for Text).
// ---------------------------------------------------------------------------

// unique placeholders that won't appear in user text
const PH_AMP = "\x00AMP\x00";
const PH_LT = "\x00LT\x00";
const PH_GT = "\x00GT\x00";

function markdownToTagged(line: string): string {
  // replace literal &, <, > with placeholders so they don't interfere
  // with the tag syntax we're about to introduce
  let out = line.replace(/&/g, PH_AMP).replace(/</g, PH_LT).replace(/>/g, PH_GT);

  // bold: **text** → <b>text</b>  (must come before italic)
  out = out.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // italic: *text* → <i>text</i>
  out = out.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");

  // inline code: `text` → <code>text</code>
  out = out.replace(/`(.+?)`/g, "<code>$1</code>");

  return out;
}

/** resolve placeholders for HTMLText (uses HTML entities) */
function resolveForHtml(tagged: string): string {
  return tagged
    .replace(/\x00AMP\x00/g, "&amp;")
    .replace(/\x00LT\x00/g, "&lt;")
    .replace(/\x00GT\x00/g, "&gt;");
}

/** resolve placeholders for regular Text (uses zero-width spaces to break tag parsing) */
function resolveForText(tagged: string): string {
  return tagged
    .replace(/\x00AMP\x00/g, "&")
    .replace(/\x00LT\x00/g, "\u200B<\u200B")
    .replace(/\x00GT\x00/g, "\u200B>\u200B");
}

// convert a numeric color (0xRRGGBB) to a CSS hex string (#rrggbb)
function colorToHex(color: number): string {
  if (color < 0) return "transparent";
  return "#" + (color & 0xffffff).toString(16).padStart(6, "0");
}

// ---------------------------------------------------------------------------
// widget factory
// ---------------------------------------------------------------------------

export const markdownWidget: WidgetFactory<typeof markdownSchema> = {
  type: "markdown",
  metadata: {
    name: "markdown",
    description: "a markdown text renderer with inline editing",
    version: "0.3.0",
    category: "text",
  },
  schema: markdownSchema,
  editableProps: [
    { key: "bgColor", label: "background", type: "color" as const, default: 0x0f0f1a },
    { key: "textColor", label: "text color", type: "color" as const, default: 0xd4d4e0 },
    { key: "headingColor", label: "heading color", type: "color" as const, default: 0xf0f0ff },
    { key: "accentColor", label: "accent color", type: "color" as const, default: 0xd946ef },
    { key: "codeColor", label: "code color", type: "color" as const, default: 0xe0e0e8 },
    { key: "codeBgColor", label: "code bg", type: "color" as const, default: 0x2a2a3a },
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

    // rendered elements for the parsed markdown output.
    // lines with inline code use HTMLText; plain lines use Text.
    let renderedElements: (Text | HTMLText | Graphics)[] = [];

    // build CSS overrides for HTMLText code styling
    function buildCodeCssOverrides(state: MarkdownState): string[] {
      const codeBg = colorToHex(state.codeBgColor);
      const codeColor = colorToHex(state.codeColor);
      return [
        `code { background-color: ${codeBg}; color: ${codeColor}; font-family: "Courier New", monospace; border-radius: 3px; padding: 1px 5px; font-size: ${Math.round(state.fontSize * 0.9)}px; }`,
      ];
    }

    // check if a line's tagged output contains a <code> tag
    function hasCodeTag(tagged: string): boolean {
      return tagged.includes("<code>");
    }

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
      const cssOverrides = buildCodeCssOverrides(state);

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

        let taggedText: string;
        let fontSize: number;
        let fontWeight: TextStyleFontWeight = "normal";
        let fill: number;

        if (line.startsWith("### ")) {
          taggedText = markdownToTagged(line.slice(4));
          fontSize = state.fontSize * 1.1;
          fontWeight = "bold";
          fill = state.headingColor;
        } else if (line.startsWith("## ")) {
          taggedText = markdownToTagged(line.slice(3));
          fontSize = state.fontSize * 1.3;
          fontWeight = "bold";
          fill = state.headingColor;
        } else if (line.startsWith("# ")) {
          taggedText = markdownToTagged(line.slice(2));
          fontSize = state.fontSize * 1.6;
          fontWeight = "bold";
          fill = state.headingColor;
        } else if (line.startsWith("- ")) {
          taggedText = "\u2022 " + markdownToTagged(line.slice(2));
          fontSize = state.fontSize;
          fill = state.textColor;
        } else {
          taggedText = markdownToTagged(line);
          fontSize = state.fontSize;
          fill = state.textColor;
        }

        // use HTMLText for lines that contain <code> tags so we get CSS
        // background + border-radius. use regular Text for everything
        // else (faster rendering, no SVG overhead).
        const useHtml = hasCodeTag(taggedText);

        // resolve placeholders to the correct escape form for the chosen renderer
        const resolvedText = useHtml ? resolveForHtml(taggedText) : resolveForText(taggedText);

        const textObj = useHtml
          ? new HTMLText({
              text: resolvedText,
              resolution: 2,
              style: {
                fontFamily: state.fontFamily,
                fontSize,
                fontWeight,
                fill: safeColor(fill),
                wordWrap: true,
                wordWrapWidth: cw,
                tagStyles: {
                  b: { fontWeight: "bold" },
                  i: { fontStyle: "italic" },
                  code: {
                    // font/color handled by cssOverrides for background support,
                    // but tagStyles ensures fill inherits properly
                    fill: safeColor(state.codeColor),
                    fontFamily: "Courier New, monospace",
                  },
                },
                cssOverrides,
              },
            })
          : new Text({
              text: resolvedText,
              resolution: 2,
              style: {
                fontFamily: state.fontFamily,
                fontSize,
                fontWeight,
                fill: safeColor(fill),
                wordWrap: true,
                wordWrapWidth: cw,
                tagStyles: {
                  b: { fontWeight: "bold" as TextStyleFontWeight },
                  i: { fontStyle: "italic" as const },
                  code: {
                    fontFamily: "Courier New, monospace",
                    fill: safeColor(state.codeColor),
                  },
                },
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
