import { Container, DOMContainer, Graphics } from "pixi.js";
import { PixieTheme, snapToGrid } from "./PixieTheme";

const LABEL_PAD = 6;
const MIN_LABEL_W = 48;
const MIN_LABEL_H = 24;
const DEFAULT_W = 120;
const DEFAULT_H = 32;
const DEFAULT_FONT_SIZE = 14;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 72;

// inject CSS once — uses !important to beat pixi DOMPipe's inline pointer-events override
const STYLE_ID = "pixi-floating-label-css";
if (!document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .pixi-label-no-events { pointer-events: none !important; }
    .pixi-label-events { pointer-events: auto !important; }
  `;
  document.head.appendChild(style);
}

// a floating text label backed by an HTML textarea via pixi DOMContainer.
// the textarea lives in the pixi scene graph so it scrolls/transforms with the world.
// locked (non-draggable) by default — only movable via the toolbar's edit mode.
export class FloatingLabel extends Container {
  private bg: Graphics;
  private textarea: HTMLTextAreaElement;
  private domContainer: DOMContainer;
  private _locked: boolean;
  private _labelWidth: number;
  private _labelHeight: number;
  private _fontSize: number = DEFAULT_FONT_SIZE;

  constructor(x: number, y: number, text: string, locked = true) {
    super();

    this.x = x;
    this.y = y;
    this._locked = locked;
    this._labelWidth = DEFAULT_W;
    this._labelHeight = DEFAULT_H;

    // background drawn behind the textarea
    this.bg = new Graphics();
    this.addChild(this.bg);

    // html textarea element
    this.textarea = document.createElement("textarea");
    this.textarea.value = text;
    this.textarea.spellcheck = true;
    this.applyTextareaStyles();

    // pixi DOMContainer embeds the textarea into the scene graph
    this.domContainer = new DOMContainer({
      element: this.textarea,
    });
    this.addChild(this.domContainer);

    this.redrawBg();
    this.setReadOnly(!false); // start read-only
    this.eventMode = "static";
  }

  get locked() {
    return this._locked;
  }

  set locked(v: boolean) {
    this._locked = v;
  }

  get labelWidth(): number {
    return this._labelWidth;
  }

  get labelHeight(): number {
    return this._labelHeight;
  }

  // reliable hit bounds in world-space (DOMContainer doesn't contribute to pixi getBounds)
  getHitBounds(): { x: number; y: number; width: number; height: number } {
    return { x: this.x, y: this.y, width: this._labelWidth, height: this._labelHeight };
  }

  setLabelSize(w: number, h: number) {
    this._labelWidth = Math.max(MIN_LABEL_W, snapToGrid(w));
    this._labelHeight = Math.max(MIN_LABEL_H, snapToGrid(h));
    // scale font size proportionally based on height relative to default
    const scale = this._labelHeight / DEFAULT_H;
    this._fontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(DEFAULT_FONT_SIZE * scale)));
    this.applyTextareaStyles();
    this.redrawBg();
  }

  setText(text: string) {
    this.textarea.value = text;
  }

  getText(): string {
    return this.textarea.value;
  }

  get isEditing(): boolean {
    return !this.textarea.readOnly;
  }

  // enable editing — focus the textarea
  promptEdit() {
    this.setReadOnly(false);
    this.textarea.focus();
    this.textarea.select();
  }

  // disable editing — blur and lock
  finishEdit() {
    this.textarea.blur();
    this.setReadOnly(true);
  }

  private setReadOnly(readOnly: boolean) {
    this.textarea.readOnly = readOnly;
    this.textarea.style.cursor = readOnly ? "default" : "text";
    // use CSS classes with !important to beat pixi DOMPipe's inline pointer-events override
    if (readOnly) {
      this.textarea.classList.add("pixi-label-no-events");
      this.textarea.classList.remove("pixi-label-events");
    } else {
      this.textarea.classList.remove("pixi-label-no-events");
      this.textarea.classList.add("pixi-label-events");
    }
    // subtle border change when editable
    this.textarea.style.borderColor = readOnly ? "transparent" : PixieTheme.css.accent500;
  }

  private applyTextareaStyles() {
    const w = this._labelWidth;
    const h = this._labelHeight;
    this.textarea.style.cssText = `
      width: ${w}px;
      height: ${h}px;
      font-family: ${PixieTheme.fontFamily};
      font-size: ${this._fontSize}px;
      color: #ffffff;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 3px;
      padding: ${LABEL_PAD}px;
      outline: none;
      resize: none;
      overflow: hidden;
      box-sizing: border-box;
      cursor: default;
    `;
  }

  private redrawBg() {
    this.bg.clear();
    this.bg
      .roundRect(0, 0, this._labelWidth, this._labelHeight, 3)
      .fill({ color: 0x333333, alpha: 0.7 });
  }
}

