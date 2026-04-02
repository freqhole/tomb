import { Container, Graphics } from "pixi.js";
import type { DropZoneChecker } from "./Card";
import { PixieTheme } from "./PixieTheme";

export interface BinOptions {
  x: number;
  y: number;
  cols: number;
  rows: number;
  slotWidth?: number;
  slotHeight?: number;
  borderColor?: number;
}

export const BIN_SLOT_W = 110;
export const BIN_SLOT_H = 30;

// a bin (record crate) with horizontal stacking slots.
// cards dropped in here switch to "spine-horizontal" view,
// like flipping through a crate of records laid flat.
export class Bin extends Container implements DropZoneChecker {
  public _isBin = true;
  public containerType = "bin" as const;
  public binCols: number;
  public binRows: number;
  public slotW: number;
  public slotH: number;
  public borderColor: number;

  private slotLines: Graphics[] = [];
  private occupied = new Map<string, import("./Card").Card>();
  private highlightFrame: Graphics;

  constructor(opts: BinOptions) {
    super();

    this.slotW = opts.slotWidth ?? BIN_SLOT_W;
    this.slotH = opts.slotHeight ?? BIN_SLOT_H;
    this.binCols = opts.cols;
    this.binRows = opts.rows;
    this.borderColor = opts.borderColor ?? PixieTheme.borderStrong;
    this.x = opts.x;
    this.y = opts.y;

    this.drawFrame();
    this.highlightFrame = this.drawHighlightFrame();
    this.drawSlots();
  }

  get totalWidth(): number {
    return this.binCols * this.slotW;
  }

  get totalHeight(): number {
    return this.binRows * this.slotH;
  }

  getOccupiedCards(): import("./Card").Card[] {
    return [...this.occupied.values()];
  }

  setHighlight(on: boolean) {
    this.highlightFrame.visible = on;
  }

  private drawFrame() {
    const g = new Graphics();
    g.rect(0, 0, this.totalWidth, this.totalHeight).stroke({ width: 2, color: this.borderColor });
    this.addChild(g);
  }

  private drawHighlightFrame(): Graphics {
    const g = new Graphics();
    g.rect(-2, -2, this.totalWidth + 4, this.totalHeight + 4)
      .stroke({ width: 2, color: PixieTheme.accent500 });
    g.visible = false;
    this.addChild(g);
    return g;
  }

  private drawSlots() {
    for (let r = 0; r < this.binRows; r++) {
      for (let c = 0; c < this.binCols; c++) {
        const g = new Graphics();
        g.rect(c * this.slotW, r * this.slotH, this.slotW, this.slotH).stroke({
          width: 1,
          color: PixieTheme.borderDefault,
        });
        g.visible = false;
        this.addChild(g);
        this.slotLines.push(g);
      }
    }
  }

  private containsGlobal(px: number, py: number): boolean {
    return (
      px > this.x &&
      px < this.x + this.totalWidth &&
      py > this.y &&
      py < this.y + this.totalHeight
    );
  }

  updateHover(px: number, py: number) {
    const inside = this.containsGlobal(px, py);
    for (const l of this.slotLines) l.visible = inside;
  }

  clearHover() {
    for (const l of this.slotLines) l.visible = false;
  }

  getSlot(px: number, py: number): { x: number; y: number } | null {
    if (!this.containsGlobal(px, py)) return null;

    const c = Math.floor((px - this.x) / this.slotW);
    const r = Math.floor((py - this.y) / this.slotH);
    const key = `${c},${r}`;

    if (this.occupied.has(key)) return null;

    return {
      x: this.x + c * this.slotW + this.slotW / 2,
      y: this.y + r * this.slotH + this.slotH / 2,
    };
  }

  getFirstEmptySlot(): { x: number; y: number } | null {
    for (let r = 0; r < this.binRows; r++) {
      for (let c = 0; c < this.binCols; c++) {
        const key = `${c},${r}`;
        if (!this.occupied.has(key)) {
          return {
            x: this.x + c * this.slotW + this.slotW / 2,
            y: this.y + r * this.slotH + this.slotH / 2,
          };
        }
      }
    }
    return null;
  }

  occupySlot(sx: number, sy: number, card: import("./Card").Card) {
    const c = Math.round((sx - this.x - this.slotW / 2) / this.slotW);
    const r = Math.round((sy - this.y - this.slotH / 2) / this.slotH);
    this.occupied.set(`${c},${r}`, card);
  }

  releaseCard(card: import("./Card").Card) {
    for (const [key, occupant] of this.occupied) {
      if (occupant === card) {
        this.occupied.delete(key);
        return;
      }
    }
  }

  getGlobalBounds(): { x: number; y: number; width: number; height: number } {
    return { x: this.x, y: this.y, width: this.totalWidth, height: this.totalHeight };
  }
}
