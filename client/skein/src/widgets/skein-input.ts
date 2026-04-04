/**
 * skein-input — a themed text input wrapper around @pixi/ui's Input component.
 *
 * provides a dark-themed input field with a blinking cursor, placeholder text,
 * click-to-focus, and a visible focus ring. this replaces the manual
 * KeyboardDriver + hidden textarea approach for simple single-line text fields.
 *
 * usage:
 *
 *   import { createSkeinInput } from "../widgets/skein-input";
 *
 *   const handle = createSkeinInput({
 *     width: 200,
 *     placeholder: "enter a name...",
 *     onChange: (value) => console.log("typing:", value),
 *     onEnter: (value) => console.log("committed:", value),
 *   });
 *
 *   parentContainer.addChild(handle.input);
 *
 *   // later, to clean up:
 *   handle.destroy();
 */

import { Input } from "@pixi/ui";
import { Graphics } from "pixi.js";

// ---------------------------------------------------------------------------
// theme constants — matches the dark theme used across skein widgets
// (canvas-wizard, friends-widget, profile-widget, etc.)
// ---------------------------------------------------------------------------

const FIELD_BG = 0x12121a;
const FIELD_BORDER = 0x333348;
const FIELD_BORDER_ACTIVE = 0x6366f1;
const TEXT_COLOR = 0xf0f0ff;
const MUTED_TEXT = 0x666678;
const FONT = "system-ui, sans-serif";
const FONT_SIZE = 12;
const CORNER_RADIUS = 4;
const PADDING = { top: 0, right: 8, bottom: 0, left: 8 };

// how often (ms) we poll the editing state to update the focus ring.
// 100ms is imperceptible but avoids patching internal methods.
const EDITING_POLL_MS = 100;

// ---------------------------------------------------------------------------
// public types
// ---------------------------------------------------------------------------

export interface SkeinInputOptions {
  /** width of the input field in pixels */
  width: number;
  /** height of the input field (default: 28) */
  height?: number;
  /** placeholder text shown when the field is empty */
  placeholder?: string;
  /** initial value */
  value?: string;
  /** maximum character length */
  maxLength?: number;
  /** text alignment (default: "left") */
  align?: "left" | "center" | "right";
  /** called on every keystroke with the current value */
  onChange?: (value: string) => void;
  /** called when input is committed (Enter / Escape / blur) */
  onEnter?: (value: string) => void;
}

export interface SkeinInputHandle {
  /** the @pixi/ui Input container — add this to your display list */
  input: Input;
  /** get the current text value */
  get value(): string;
  /** set the current text value programmatically */
  set value(v: string);
  /** programmatically focus the input */
  focus(): void;
  /** programmatically blur the input */
  blur(): void;
  /** update the input width (e.g. on resize) */
  setWidth(w: number): void;
  /** tear down the input and stop the editing-state poll */
  destroy(): void;
}

// ---------------------------------------------------------------------------
// factory
// ---------------------------------------------------------------------------

/**
 * create a themed text input backed by @pixi/ui's Input class.
 *
 * returns a handle with the pixi container, value accessors, and
 * focus/blur/resize/destroy helpers. add `handle.input` to your
 * display list and call `handle.destroy()` when done.
 */
export function createSkeinInput(options: SkeinInputOptions): SkeinInputHandle {
  const height = options.height ?? 28;
  let currentWidth = options.width;

  // -- background graphic --------------------------------------------------

  const bg = new Graphics();

  const drawBg = (active: boolean): void => {
    const borderColor = active ? FIELD_BORDER_ACTIVE : FIELD_BORDER;
    bg.clear();
    bg.roundRect(0, 0, currentWidth, height, CORNER_RADIUS);
    bg.fill({ color: FIELD_BG });
    bg.stroke({ color: borderColor, width: 1 });
  };

  // draw the initial (unfocused) state
  drawBg(false);

  // -- create the @pixi/ui Input ------------------------------------------

  const input = new Input({
    bg,
    textStyle: {
      fontFamily: FONT,
      fontSize: FONT_SIZE,
      fill: TEXT_COLOR,
    },
    placeholder: options.placeholder ?? "",
    value: options.value ?? "",
    maxLength: options.maxLength,
    align: options.align ?? "left",
    padding: PADDING,
    addMask: true,
  });

  // the placeholder text style is set separately — @pixi/ui applies the
  // main textStyle to the placeholder too, so we override just the fill
  // to get the muted color.
  if ((input as any).placeholder && (input as any).placeholder.style) {
    (input as any).placeholder.style.fill = MUTED_TEXT;
  }

  // -- wire up user callbacks ---------------------------------------------

  if (options.onChange) {
    input.onChange.connect(options.onChange);
  }
  if (options.onEnter) {
    input.onEnter.connect(options.onEnter);
  }

  // -- editing state poll for focus ring -----------------------------------
  // @pixi/ui Input doesn't emit focus/blur events, so we poll the
  // internal `editing` flag at a low frequency to toggle the border color.

  let wasEditing = false;

  const checkEditing = (): void => {
    const isEditing = (input as any).editing === true;
    if (isEditing !== wasEditing) {
      wasEditing = isEditing;
      drawBg(isEditing);
    }
  };

  const pollInterval = setInterval(checkEditing, EDITING_POLL_MS);

  // -- build the handle ----------------------------------------------------

  const handle: SkeinInputHandle = {
    input,

    get value(): string {
      return input.value;
    },

    set value(v: string) {
      input.value = v;
    },

    focus(): void {
      // @pixi/ui Input begins editing on pointer activation.
      // we replicate that by toggling the internal activation flag
      // and calling the handler, which focuses the hidden DOM input.
      try {
        if (typeof (input as any)._activateInput === "function") {
          (input as any)._activateInput();
        } else if (typeof (input as any).handleActivation === "function") {
          (input as any).activation = true;
          (input as any).handleActivation();
        }
      } catch {
        // if the internal API changed, fail silently — the user can
        // still click to focus
      }
      // make sure the border reflects the new state
      checkEditing();
    },

    blur(): void {
      try {
        if (typeof (input as any).stopEditing === "function") {
          (input as any).stopEditing();
        }
      } catch {
        // same graceful fallback
      }
      checkEditing();
    },

    setWidth(w: number): void {
      currentWidth = w;
      drawBg(wasEditing);
      input.width = w;
    },

    destroy(): void {
      clearInterval(pollInterval);
      input.destroy({ children: true });
    },
  };

  return handle;
}
