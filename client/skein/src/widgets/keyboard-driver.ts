/**
 * keyboard driver — a hidden <textarea> that proxies text input, IME
 * composition, and clipboard events into pixi-rendered widgets.
 *
 * this is the same pattern used by figma, excalidraw, game engines,
 * and @pixi/ui's Input component. the textarea is invisible and has
 * no styling — all visual rendering happens in pixi. the textarea
 * exists solely as a bridge to the browser's text input system.
 *
 * widgets call acquire() when they want text input and release()
 * when they're done. only one widget can hold the keyboard at a time.
 */

/**
 * interface that widgets implement to receive keyboard events.
 * passed to acquire() when a widget wants text input.
 */
export interface KeyboardHandler {
  /** fired on every input event with the current textarea value */
  onInput(value: string): void;
  /** fired on keydown — use for escape, enter, arrow keys, etc. */
  onKeyDown(event: KeyboardEvent): void;
  /** fired when IME composition starts (optional) */
  onCompositionStart?(): void;
  /** fired when IME composition ends with the final value (optional) */
  onCompositionEnd?(value: string): void;
  /** fired when the textarea loses focus (optional) */
  onBlur?(): void;
}

export class KeyboardDriver {
  private readonly textarea: HTMLTextAreaElement;
  private activeHandler: KeyboardHandler | null = null;
  private composing = false;

  constructor(canvasElement: HTMLCanvasElement) {
    this.textarea = document.createElement("textarea");

    // visually hidden but still focusable — must be in the DOM
    // and near the canvas for mobile keyboard targeting
    const s = this.textarea.style;
    s.position = "absolute";
    s.opacity = "0";
    s.pointerEvents = "none";
    s.width = "1px";
    s.height = "1px";
    s.padding = "0";
    s.border = "none";
    s.outline = "none";
    s.resize = "none";
    s.overflow = "hidden";
    // keep it near the canvas so mobile keyboards anchor correctly
    s.left = "0";
    s.top = "0";
    s.zIndex = "-1";

    // prevent textarea from interfering with canvas tab order
    this.textarea.tabIndex = -1;
    this.textarea.autocomplete = "off";
    this.textarea.setAttribute("autocorrect", "off");
    this.textarea.setAttribute("autocapitalize", "off");
    this.textarea.setAttribute("spellcheck", "false");
    this.textarea.setAttribute("aria-hidden", "true");

    // append to the canvas parent so it's positioned relative to it
    const parent = canvasElement.parentElement;
    if (parent) {
      // make sure the parent is positioned so our absolute textarea works
      const parentPosition = getComputedStyle(parent).position;
      if (parentPosition === "static") {
        parent.style.position = "relative";
      }
      parent.appendChild(this.textarea);
    } else {
      // fallback: append to body
      document.body.appendChild(this.textarea);
    }

    // wire up events
    this.textarea.addEventListener("input", this.handleInput);
    this.textarea.addEventListener("keydown", this.handleKeyDown);
    this.textarea.addEventListener("compositionstart", this.handleCompositionStart);
    this.textarea.addEventListener("compositionend", this.handleCompositionEnd);
    this.textarea.addEventListener("blur", this.handleBlur);
  }

  /**
   * whether a widget currently holds the keyboard.
   */
  get isAcquired(): boolean {
    return this.activeHandler !== null;
  }

  /**
   * whether an IME composition session is in progress.
   * widgets should avoid committing partial text during composition.
   */
  get isComposing(): boolean {
    return this.composing;
  }

  /**
   * a widget calls this to claim text input. the hidden textarea is
   * focused and all input events are routed to the handler.
   *
   * only one widget can hold the keyboard at a time — calling acquire()
   * while another widget holds it will silently replace the handler
   * (the previous widget should have called release() first).
   */
  acquire(handler: KeyboardHandler, initialValue?: string): void {
    this.activeHandler = handler;
    this.textarea.value = initialValue ?? "";
    this.composing = false;
    this.textarea.focus();
  }

  /**
   * the widget releases text input. the textarea is blurred and cleared.
   * safe to call even if no handler is active.
   */
  release(): void {
    this.activeHandler = null;
    this.composing = false;
    this.textarea.value = "";
    this.textarea.blur();
  }

  /**
   * get the current textarea value. useful for widgets that need to
   * read the value outside of event handlers (e.g., on a timer).
   */
  get value(): string {
    return this.textarea.value;
  }

  /**
   * set the textarea value programmatically. useful when the widget
   * state changes from a remote peer and the textarea needs to stay
   * in sync (only while acquired).
   */
  setValue(value: string): void {
    this.textarea.value = value;
  }

  /**
   * remove the hidden textarea from the DOM and clean up all listeners.
   */
  destroy(): void {
    this.activeHandler = null;
    this.composing = false;

    this.textarea.removeEventListener("input", this.handleInput);
    this.textarea.removeEventListener("keydown", this.handleKeyDown);
    this.textarea.removeEventListener("compositionstart", this.handleCompositionStart);
    this.textarea.removeEventListener("compositionend", this.handleCompositionEnd);
    this.textarea.removeEventListener("blur", this.handleBlur);

    this.textarea.remove();
  }

  // ---------------------------------------------------------------------------
  // event handlers (arrow functions to preserve `this` binding)
  // ---------------------------------------------------------------------------

  private handleInput = (): void => {
    // during IME composition, wait for compositionend before notifying
    if (this.composing) return;
    this.activeHandler?.onInput(this.textarea.value);
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    this.activeHandler?.onKeyDown(e);
  };

  private handleCompositionStart = (): void => {
    this.composing = true;
    this.activeHandler?.onCompositionStart?.();
  };

  private handleCompositionEnd = (): void => {
    this.composing = false;
    this.activeHandler?.onCompositionEnd?.(this.textarea.value);
    // some browsers fire input before compositionend, some after.
    // send a final onInput to ensure the widget has the committed value.
    this.activeHandler?.onInput(this.textarea.value);
  };

  private handleBlur = (): void => {
    this.activeHandler?.onBlur?.();
  };
}
