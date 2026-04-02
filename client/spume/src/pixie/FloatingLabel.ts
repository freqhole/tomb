import { Container, Graphics, Text } from "pixi.js";

// a floating text label that can be placed anywhere on the canvas.
// locked (non-draggable) by default — only movable via the toolbar's move mode.
// editable via toolbar's edit mode (prompts for new text).
export class FloatingLabel extends Container {
  private bg: Graphics;
  private textObj: Text;
  private _locked: boolean;

  constructor(x: number, y: number, text: string, locked = true) {
    super();

    this.x = x;
    this.y = y;
    this._locked = locked;

    this.textObj = new Text({
      text,
      style: { fill: "#ffffff", fontSize: 14 },
    });

    this.bg = new Graphics();
    this.redrawBg();

    this.addChild(this.bg, this.textObj);
    this.eventMode = "static";
  }

  get locked() {
    return this._locked;
  }

  set locked(v: boolean) {
    this._locked = v;
  }

  setText(text: string) {
    this.textObj.text = text;
    this.redrawBg();
  }

  getText(): string {
    return this.textObj.text;
  }

  promptEdit() {
    const current = this.textObj.text;
    const result = globalThis.prompt?.("edit label text:", current);
    if (result !== null && result !== undefined) {
      this.setText(result);
    }
  }

  private redrawBg() {
    this.bg.clear();
    const pad = 6;
    this.bg
      .roundRect(-pad, -pad, this.textObj.width + pad * 2, this.textObj.height + pad * 2, 3)
      .fill({ color: 0x333333, alpha: 0.7 });
  }
}
