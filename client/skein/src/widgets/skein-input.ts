/**
 * skein-input — a themed text input backed by the shared KeyboardDriver.
 *
 * renders a dark-themed input field with a blinking cursor, placeholder text,
 * click-to-focus, and a visible focus ring. uses the project's existing
 * hidden-textarea KeyboardDriver for text input, giving us native browser
 * text selection, Ctrl/Cmd+A, clipboard, and IME support for free.
 */

import { Container, Graphics, Text } from "pixi.js";
import type { KeyboardDriver, KeyboardHandler } from "./keyboard-driver";

const FIELD_BG = 0x12121a;
const FIELD_BORDER = 0x333348;
const FIELD_BORDER_ACTIVE = 0x6366f1;
const TEXT_COLOR = 0xf0f0ff;
const MUTED_TEXT = 0x666678;
const FONT = "system-ui, sans-serif";
const FONT_SIZE = 12;
const CORNER_RADIUS = 4;
const PAD_H = 8;
const CURSOR_BLINK_MS = 530;
const TEXT_RESOLUTION = 2;

export interface SkeinInputOptions {
  keyboard: KeyboardDriver;
  width: number;
  height?: number;
  placeholder?: string;
  value?: string;
  maxLength?: number;
  align?: "left" | "center" | "right";
  onChange?: (value: string) => void;
  onEnter?: (value: string) => void;
  fontSize?: number;
  fontFamily?: string;
  textColor?: number;
  bgColor?: number;
  borderColor?: number;
  borderActiveColor?: number;
  placeholderColor?: number;
  cornerRadius?: number;
}

export interface SkeinInputHandle {
  /** the PixiJS container — add this to your display list */
  input: Container;
  /** true while the field is actively being edited */
  get isEditing(): boolean;
  get value(): string;
  set value(v: string);
  focus(): void;
  blur(): void;
  setWidth(w: number): void;
  destroy(): void;
}

export function createSkeinInput(options: SkeinInputOptions): SkeinInputHandle {
  const keyboard = options.keyboard;
  const height = options.height ?? 28;
  let currentWidth = options.width;
  let currentValue = options.value ?? "";
  let editing = false;

  const styleFontSize = options.fontSize ?? FONT_SIZE;
  const styleFontFamily = options.fontFamily ?? FONT;
  const styleTextColor = options.textColor ?? TEXT_COLOR;
  const styleBgColor = options.bgColor ?? FIELD_BG;
  const styleBorderColor = options.borderColor ?? FIELD_BORDER;
  const styleBorderActive = options.borderActiveColor ?? FIELD_BORDER_ACTIVE;
  const stylePlaceholderColor = options.placeholderColor ?? MUTED_TEXT;
  const styleCornerRadius = options.cornerRadius ?? CORNER_RADIUS;

  // root container
  const root = new Container();
  root.eventMode = "static";
  root.cursor = "text";

  // background
  const bg = new Graphics();
  root.addChild(bg);

  const drawBg = (active: boolean) => {
    const border = active ? styleBorderActive : styleBorderColor;
    bg.clear();
    bg.roundRect(0, 0, currentWidth, height, styleCornerRadius);
    bg.fill({ color: styleBgColor });
    bg.stroke({ color: border, width: 1 });
  };
  drawBg(false);

  // text mask — clips text to the field area
  const textMask = new Graphics();
  const drawTextMask = () => {
    textMask.clear();
    textMask.rect(PAD_H - 1, 0, currentWidth - PAD_H * 2 + 2, height);
    textMask.fill({ color: 0xffffff });
  };
  root.addChild(textMask);
  drawTextMask();

  // display text
  const displayText = new Text({
    text: currentValue,
    style: {
      fontFamily: styleFontFamily,
      fontSize: styleFontSize,
      fill: styleTextColor,
    },
    resolution: TEXT_RESOLUTION,
  });
  displayText.eventMode = "none";
  displayText.x = PAD_H;
  displayText.y = Math.round((height - styleFontSize) / 2);
  displayText.mask = textMask;
  root.addChild(displayText);

  // placeholder text
  const placeholderText = new Text({
    text: options.placeholder ?? "",
    style: {
      fontFamily: styleFontFamily,
      fontSize: styleFontSize,
      fill: stylePlaceholderColor,
    },
    resolution: TEXT_RESOLUTION,
  });
  placeholderText.eventMode = "none";
  placeholderText.x = PAD_H;
  placeholderText.y = Math.round((height - styleFontSize) / 2);
  placeholderText.mask = textMask;
  root.addChild(placeholderText);

  // cursor (thin vertical line)
  const cursor = new Graphics();
  cursor.visible = false;
  cursor.eventMode = "none";
  root.addChild(cursor);

  let cursorInterval: ReturnType<typeof setInterval> | null = null;

  const syncDisplay = () => {
    displayText.text = currentValue;
    placeholderText.visible = currentValue.length === 0 && !editing;

    // position cursor after text
    if (editing) {
      const textRight = PAD_H + displayText.width;
      cursor.clear();
      cursor.rect(textRight + 1, Math.round((height - styleFontSize) / 2), 1.5, styleFontSize);
      cursor.fill({ color: styleTextColor });
    }
  };

  const startCursorBlink = () => {
    cursor.visible = true;
    syncDisplay();
    if (cursorInterval) clearInterval(cursorInterval);
    cursorInterval = setInterval(() => {
      cursor.visible = !cursor.visible;
    }, CURSOR_BLINK_MS);
  };

  const stopCursorBlink = () => {
    if (cursorInterval) {
      clearInterval(cursorInterval);
      cursorInterval = null;
    }
    cursor.visible = false;
  };

  const stopEditing = () => {
    if (!editing) return;
    editing = false;
    keyboard.release();
    stopCursorBlink();
    drawBg(false);
    syncDisplay();
    options.onEnter?.(currentValue);
  };

  const startEditing = () => {
    if (editing) return;
    editing = true;
    drawBg(true);
    placeholderText.visible = false;

    const handler: KeyboardHandler = {
      onInput(value: string) {
        if (options.maxLength && value.length > options.maxLength) {
          value = value.substring(0, options.maxLength);
          keyboard.setValue(value);
        }
        currentValue = value;
        syncDisplay();
        options.onChange?.(currentValue);
      },
      onKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") {
          stopEditing();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          stopEditing();
          return;
        }
      },
      onBlur() {
        stopEditing();
      },
    };

    keyboard.acquire(handler, currentValue);
    startCursorBlink();
  };

  // click to focus
  root.on("pointertap", (e: any) => {
    e.stopPropagation();
    if (!editing) {
      startEditing();
    }
  });

  // initial display sync
  syncDisplay();

  const handle: SkeinInputHandle = {
    input: root,

    get isEditing(): boolean {
      return editing;
    },

    get value(): string {
      return currentValue;
    },

    set value(v: string) {
      currentValue = v;
      if (editing) {
        keyboard.setValue(v);
      }
      syncDisplay();
    },

    focus(): void {
      if (!editing) startEditing();
    },

    blur(): void {
      stopEditing();
    },

    setWidth(w: number): void {
      currentWidth = w;
      drawBg(editing);
      drawTextMask();
      syncDisplay();
    },

    destroy(): void {
      if (editing) {
        editing = false;
        keyboard.release();
      }
      stopCursorBlink();
      root.destroy({ children: true });
    },
  };

  return handle;
}
