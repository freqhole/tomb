/**
 * shared DOM overlay utility for text input over PixiJS containers.
 *
 * creates a real DOM <input> or <textarea> element positioned over a PixiJS
 * container using position: fixed. this gives us native browser text input
 * (IME, clipboard, selection, undo) while the PixiJS scene renders underneath.
 *
 * used by skein-input (single-line), label, markdown, and notepad widgets.
 */

import type { Container } from "pixi.js";

export interface DomOverlayOptions {
  /** PixiJS Container whose global position anchors the overlay */
  container: Container;
  /** the <canvas> DOM element for getBoundingClientRect */
  canvasElement: HTMLCanvasElement;
  /** overlay width in PixiJS local coordinates */
  width: number;
  /** overlay height in PixiJS local coordinates */
  height: number;
  /** create a <textarea> instead of <input> (default false) */
  multiline?: boolean;
  /** initial value */
  value?: string;
  /** placeholder text */
  placeholder?: string;
  /**
   * whether Enter commits editing.
   * defaults to true for single-line (<input>), false for multiline (<textarea>).
   */
  enterCommits?: boolean;
  /** select all text on focus (default false) */
  selectAll?: boolean;
  /** max character length */
  maxLength?: number;
  /** called on every input event with the current value */
  onInput?: (value: string) => void;
  /** called when editing is committed (blur, or Enter when enterCommits is true) */
  onCommit?: (value: string) => void;
  /**
   * called when Escape is pressed.
   * if not provided, Escape triggers onCommit instead (no revert).
   */
  onRevert?: () => void;
  /** CSS style properties applied after the base styles */
  css?: Record<string, string>;
}

export interface DomOverlayHandle {
  /** the DOM element (<input> or <textarea>) */
  element: HTMLInputElement | HTMLTextAreaElement;
  /** remove the element from DOM and clean up listeners. safe to call multiple times. */
  remove(): void;
  /** get the current value */
  getValue(): string;
  /** true after remove() has been called or the overlay tore itself down */
  readonly removed: boolean;
}

/**
 * create a DOM text input overlay positioned over a PixiJS container.
 * the overlay is appended to document.body with position: fixed and a
 * high z-index so it floats above the canvas.
 *
 * the overlay auto-removes on:
 * - blur → calls onCommit
 * - Enter (when enterCommits is true) → calls onCommit
 * - Escape → calls onRevert (or onCommit if onRevert is not provided)
 *
 * callbacks fire after the element is removed from the DOM, so it's
 * safe to update PixiJS state in the callback without the overlay
 * interfering with focus.
 */
export function createDomOverlay(options: DomOverlayOptions): DomOverlayHandle {
  const {
    container,
    canvasElement,
    width,
    height,
    multiline = false,
    value = "",
    placeholder = "",
    enterCommits,
    selectAll = false,
    maxLength,
    onInput,
    onCommit,
    onRevert,
    css = {},
  } = options;

  // resolve enterCommits default: true for single-line, false for multiline
  const shouldEnterCommit = enterCommits ?? !multiline;

  // convert PixiJS local coords to screen coords via toGlobal + canvas rect
  const globalPos = container.toGlobal({ x: 0, y: 0 });
  const globalEnd = container.toGlobal({ x: width, y: height });
  const canvasRect = canvasElement.getBoundingClientRect();

  const screenX = canvasRect.left + globalPos.x;
  const screenY = canvasRect.top + globalPos.y;
  const screenW = globalEnd.x - globalPos.x;
  const screenH = globalEnd.y - globalPos.y;

  // create element
  const el = document.createElement(multiline ? "textarea" : "input") as
    | HTMLInputElement
    | HTMLTextAreaElement;

  if (!multiline) {
    (el as HTMLInputElement).type = "text";
  }

  el.value = value;
  if (placeholder) el.placeholder = placeholder;
  if (maxLength != null) el.maxLength = maxLength;

  // suppress autocomplete / spellcheck for code-like inputs
  el.autocomplete = "off";
  el.setAttribute("autocorrect", "off");
  el.setAttribute("autocapitalize", "off");
  el.setAttribute("spellcheck", "false");

  // base styles — transparent overlay that blends with the PixiJS rendering
  const s = el.style;
  s.position = "fixed";
  s.left = `${screenX}px`;
  s.top = `${screenY}px`;
  s.width = `${screenW}px`;
  s.height = `${screenH}px`;
  s.background = "transparent";
  s.border = "none";
  s.outline = "none";
  s.resize = "none";
  s.zIndex = "10000";
  s.boxSizing = "border-box";

  // apply caller CSS overrides
  for (const [key, val] of Object.entries(css)) {
    (s as any)[key] = val;
  }

  // ---------------------------------------------------------------------------
  // teardown + event handling
  // ---------------------------------------------------------------------------

  let _removed = false;

  /**
   * remove element from DOM and detach all listeners.
   * returns true the first time (actual teardown), false on subsequent calls.
   */
  const teardown = (): boolean => {
    if (_removed) return false;
    _removed = true;
    el.removeEventListener("input", handleInput);
    el.removeEventListener("keydown", handleKeyDown);
    el.removeEventListener("blur", handleBlur);
    el.remove();
    return true;
  };

  const handleInput = () => {
    onInput?.(el.value);
  };

  const handleKeyDown = (e: Event) => {
    if (!(e instanceof KeyboardEvent)) return;
    // stop propagation so canvas keyboard shortcuts don't fire while typing
    e.stopPropagation();

    if (e.key === "Escape") {
      e.preventDefault();
      const val = el.value;
      if (teardown()) {
        if (onRevert) {
          onRevert();
        } else {
          onCommit?.(val);
        }
      }
      return;
    }

    if (e.key === "Enter" && shouldEnterCommit && !e.shiftKey) {
      e.preventDefault();
      const val = el.value;
      if (teardown()) {
        onCommit?.(val);
      }
      return;
    }
  };

  const handleBlur = () => {
    const val = el.value;
    if (teardown()) {
      onCommit?.(val);
    }
  };

  el.addEventListener("input", handleInput);
  el.addEventListener("keydown", handleKeyDown);
  el.addEventListener("blur", handleBlur);

  // mount and focus
  document.body.appendChild(el);
  el.focus();
  if (selectAll) el.select();

  // ---------------------------------------------------------------------------
  // public handle
  // ---------------------------------------------------------------------------

  return {
    element: el,

    remove(): void {
      teardown();
    },

    getValue(): string {
      return el.value;
    },

    get removed(): boolean {
      return _removed;
    },
  };
}
