import { Container, Graphics } from "pixi.js";
import type { DropZoneChecker } from "./Card";
import { PixieTheme } from "./PixieTheme";

export interface GridOptions {
  x: number;
  y: number;
  cols: number;
  rows: number;
  cellSize: number;
  borderColor?: number;
}

// a grid of square slots — cards snap to cell centers and show as "front"
export class Grid extends Container implements DropZoneChecker {
  public containerType = "grid" as const;
  public gridCols: number;
  public gridRows: number;
  public cellSize: number;
  public borderColor: number;

  private slotLines: Graphics[] = [];
  private highlightFrame: Graphics;
  private occupied = new Map<string, import("./Card").Card>();

  constructor(opts: GridOptions) {
    super();

    this.gridCols = opts.cols;
    this.gridRows = opts.rows;
    this.cellSize = opts.cellSize;
    this.borderColor = opts.borderColor ?? PixieTheme.borderStrong;
    this.x = opts.x;
    this.y = opts.y;

    this.drawFrame();
    this.highlightFrame = this.drawHighlightFrame();
    this.drawSlots();
  }

  get totalWidth(): number {
    return this.gridCols * this.cellSize;
  }

  get totalHeight(): number {
    return this.gridRows * this.cellSize;
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
    for (let r = 0; r < this.gridRows; r++) {
      for (let c = 0; c < this.gridCols; c++) {
        const g = new Graphics();
        g.rect(c * this.cellSize, r * this.cellSize, this.cellSize, this.cellSize).stroke({
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

    const c = Math.floor((px - this.x) / this.cellSize);
    const r = Math.floor((py - this.y) / this.cellSize);
    const key = `${c},${r}`;

    if (this.occupied.has(key)) return null;

    return {
      x: this.x + c * this.cellSize + this.cellSize / 2,
      y: this.y + r * this.cellSize + this.cellSize / 2,
    };
  }

  // find the first empty slot (for batch placement)
  getFirstEmptySlot(): { x: number; y: number } | null {
    for (let r = 0; r < this.gridRows; r++) {
      for (let c = 0; c < this.gridCols; c++) {
        const key = `${c},${r}`;
        if (!this.occupied.has(key)) {
          return {
            x: this.x + c * this.cellSize + this.cellSize / 2,
            y: this.y + r * this.cellSize + this.cellSize / 2,
          };
        }
      }
    }
    return null;
  }

  occupySlot(sx: number, sy: number, card: import("./Card").Card) {
    const c = Math.round((sx - this.x - this.cellSize / 2) / this.cellSize);
    const r = Math.round((sy - this.y - this.cellSize / 2) / this.cellSize);
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
