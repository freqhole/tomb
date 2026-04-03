import { Container, Graphics, Text } from "pixi.js";
import { z } from "zod";
import type { KeyboardHandler } from "../src/widgets/keyboard-driver";
import type {
    WidgetController,
    WidgetFactory,
    WidgetMountContext,
} from "../src/widgets/widget-types";

const PADDING = 10;
const FONT_SIZE = 13;
const BG_COLOR = 0xfefefe;
const BG_EDITING_COLOR = 0xfff9e6;
const BORDER_COLOR = 0xcbd5e1;
const BORDER_EDITING_COLOR = 0x93c5fd;
const TEXT_COLOR = 0x1e293b;
const PLACEHOLDER_COLOR = 0x94a3b8;
const FONT_FAMILY = "system-ui, sans-serif";

export const notepadSchema = z.object({
  text: z.string().default(""),
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

  create(ctx: WidgetMountContext<typeof notepadSchema>): WidgetController {
    const container = new Container();
    let editing = false;
    let currentWidth = ctx.width;
    let currentHeight = ctx.height;

    // background
    const bg = new Graphics();
    const drawBg = (w: number, h: number, isEditing: boolean) => {
      bg.clear();
      bg.roundRect(0, 0, w, h, 6);
      bg.fill({ color: isEditing ? BG_EDITING_COLOR : BG_COLOR });
      bg.stroke({ color: isEditing ? BORDER_EDITING_COLOR : BORDER_COLOR, width: 1 });
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
        fontFamily: FONT_FAMILY,
        fontSize: FONT_SIZE,
        fill: TEXT_COLOR,
        wordWrap: true,
        wordWrapWidth: contentWidth(),
      },
    });
    content.addChild(textDisplay);

    // placeholder text
    const placeholder = new Text({
      text: "click to type...",
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: FONT_SIZE,
        fontStyle: "italic",
        fill: PLACEHOLDER_COLOR,
      },
    });
    content.addChild(placeholder);

    // cursor indicator (thin line shown during editing)
    const cursor = new Graphics();
    cursor.visible = false;
    content.addChild(cursor);

    let cursorBlinkInterval: ReturnType<typeof setInterval> | null = null;

    const updatePlaceholderVisibility = () => {
      const hasText = textDisplay.text.length > 0;
      placeholder.visible = !hasText && !editing;
    };

    const updateCursorPosition = () => {
      cursor.clear();
      if (!editing) {
        cursor.visible = false;
        return;
      }
      // draw a thin blinking line at the end of text
      const textBounds = textDisplay.getBounds();
      const localRight = textDisplay.text.length > 0
        ? Math.min(textBounds.width, contentWidth())
        : 0;
      const localBottom = textDisplay.text.length > 0
        ? textBounds.height
        : FONT_SIZE;
      cursor.rect(localRight + 1, localBottom - FONT_SIZE, 1.5, FONT_SIZE);
      cursor.fill({ color: TEXT_COLOR });
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

    const updateWordWrap = () => {
      textDisplay.style.wordWrapWidth = contentWidth();
    };

    updatePlaceholderVisibility();

    // keyboard handler for text editing
    const keyboardHandler: KeyboardHandler = {
      onInput(value: string) {
        textDisplay.text = value;
        ctx.doc.change((draft) => {
          draft.text = value;
        });
        updatePlaceholderVisibility();
        updateCursorPosition();
      },

      onKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") {
          stopEditing();
        }
        // enter is not intercepted — textarea naturally inserts newlines
      },

      onBlur() {
        stopEditing();
      },
    };

    const startEditing = () => {
      if (editing) return;
      editing = true;
      drawBg(currentWidth, currentHeight, true);
      ctx.keyboard.acquire(keyboardHandler, ctx.doc.current.text);
      updatePlaceholderVisibility();
      startCursorBlink();
    };

    const stopEditing = () => {
      if (!editing) return;
      editing = false;
      // commit final value from the keyboard driver before releasing
      const finalValue = ctx.keyboard.value;
      if (finalValue !== ctx.doc.current.text) {
        ctx.doc.change((draft) => {
          draft.text = finalValue;
        });
        textDisplay.text = finalValue;
      }
      ctx.keyboard.release();
      drawBg(currentWidth, currentHeight, false);
      stopCursorBlink();
      updatePlaceholderVisibility();
    };

    // click to start editing (pointer events are active in view mode)
    bg.eventMode = "static";
    bg.cursor = "text";
    bg.on("pointertap", () => {
      startEditing();
    });

    // subscribe to remote doc changes
    const unsub = ctx.doc.on("change", (state) => {
      if (!editing) {
        // not editing — just update the display
        textDisplay.text = state.text;
      } else {
        // editing — update display but don't overwrite the textarea,
        // the local user's typing takes priority
        textDisplay.text = state.text;
      }
      updatePlaceholderVisibility();
    });

    return {
      container,

      destroy() {
        stopCursorBlink();
        if (editing) {
          ctx.keyboard.release();
        }
        unsub();
        container.destroy({ children: true });
      },

      resize(width: number, height: number) {
        currentWidth = width;
        currentHeight = height;
        drawBg(width, height, editing);
        drawClipMask(width, height);
        updateWordWrap();
        updateCursorPosition();
      },
    };
  },
};
