import { Container, Graphics } from "pixi.js";
import type { DropZoneChecker } from "./Card";
import { PixieTheme } from "./PixieTheme";

export interface ShelfOptions {
  x: number;
  y: number;
  cols: number;
  rows: number;
  slotWidth?: number;
  slotHeight?: number;
  borderColor?: number;
}

export const SHELF_SLOT_W = 30;
export const SHELF_SLOT_H = 110;

// a shelf with narrow vertical spine-width slots.
// cards dropped in here switch to "spine" view (standing upright).
export class Shelf extends Container implements DropZoneChecker {
  public _isShelf = true;
  public containerType = "shelf" as const;
  public shelfCols: number;
  public shelfRows: number;
  public slotW: number;
  public slotH: number;
  public borderColor: number;

  private slotLines: Graphics[] = [];
  private occupied = new Map<string, import("./Card").Card>();
  private highlightFrame: Graphics;

  constructor(opts: ShelfOptions) {
    super();

    this.slotW = opts.slotWidth ?? SHELF_SLOT_W;
    this.slotH = opts.slotHeight ?? SHELF_SLOT_H;
    this.shelfCols = opts.cols;
    this.shelfRows = opts.rows;
    this.borderColor = opts.borderColor ?? PixieTheme.borderStrong;
    this.x = opts.x;
    this.y = opts.y;

    this.drawFrame();
    this.highlightFrame = this.drawHighlightFrame();
    this.drawSlots();
  }

  get totalWidth(): number {
    return this.shelfCols * this.slotW;
  }

  get totalHeight(): number {
    return this.shelfRows * this.slotH;
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
    for (let r = 0; r < this.shelfRows; r++) {
      for (let c = 0; c < this.shelfCols; c++) {
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
    for (let r = 0; r < this.shelfRows; r++) {
      for (let c = 0; c < this.shelfCols; c++) {
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
