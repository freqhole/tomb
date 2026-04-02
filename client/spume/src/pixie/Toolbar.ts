import {
  Application,
  Container,
  FederatedPointerEvent,
  Graphics,
  Text,
} from "pixi.js";
import type { ToolMode, AddAction } from "./ToolMode";
import { Grid } from "./Grid";
import { Shelf, SHELF_SLOT_W, SHELF_SLOT_H } from "./Shelf";
import { Bin, BIN_SLOT_W, BIN_SLOT_H } from "./Bin";
import { FloatingLabel } from "./FloatingLabel";
import type { Card, DropZoneChecker } from "./Card";
import { PixieTheme } from "./PixieTheme";

export interface ToolbarCallbacks {
  onContainerAdded: (container: Container & DropZoneChecker) => void;
  onContainerRemoved: (container: Container & DropZoneChecker) => void;
  onLabelAdded: (label: FloatingLabel) => void;
  onLabelRemoved: (label: FloatingLabel) => void;
}

const BTN_SIZE = 32;
const BTN_GAP = 6;
const TOOLBAR_PAD = 8;
const FLYOUT_W = 80;
const FLYOUT_H = 28;
const FLYOUT_GAP = 4;

// simple icon drawing helpers (pixi Graphics)
function drawCursorIcon(g: Graphics, size: number) {
  const s = size * 0.6;
  const ox = (size - s) / 2;
  const oy = (size - s) / 2;
  g.moveTo(ox, oy).lineTo(ox, oy + s).lineTo(ox + s * 0.4, oy + s * 0.7)
    .lineTo(ox + s * 0.65, oy + s).lineTo(ox + s * 0.8, oy + s * 0.9)
    .lineTo(ox + s * 0.55, oy + s * 0.6).lineTo(ox + s, oy + s * 0.6)
    .closePath().fill(PixieTheme.textPrimary);
}

function drawPencilIcon(g: Graphics, size: number) {
  const m = size * 0.15;
  g.moveTo(size - m, m).lineTo(size - m - 4, m + 4)
    .lineTo(m + 2, size - m - 2).lineTo(m, size - m)
    .lineTo(m + 2, size - m - 2).lineTo(size - m - 4, m + 4)
    .closePath().fill(PixieTheme.textPrimary);
  // shaft line
  g.moveTo(m + 2, size - m - 2).lineTo(size - m - 4, m + 4)
    .stroke({ width: 2, color: PixieTheme.textPrimary });
}

function drawPlusIcon(g: Graphics, size: number) {
  const cx = size / 2;
  const cy = size / 2;
  const arm = size * 0.28;
  const thick = 2;
  g.rect(cx - thick, cy - arm, thick * 2, arm * 2).fill(PixieTheme.textPrimary);
  g.rect(cx - arm, cy - thick, arm * 2, thick * 2).fill(PixieTheme.textPrimary);
}

type ContainerLike = Container & DropZoneChecker & {
  containerType?: string;
  setHighlight?: (on: boolean) => void;
  getGlobalBounds?: () => { x: number; y: number; width: number; height: number };
  getOccupiedCards?: () => Card[];
};

// pixi-native toolbar: 3 icon buttons (navigate, edit, +add).
// +add opens a flyout for grid/shelf/bin/label creation.
// edit mode: hover highlights containers, click selects, drag moves with cards,
// delete/edit actions on selected. navigate mode: cards are interactive.
export class Toolbar extends Container {
  private app: Application;
  private currentMode: ToolMode = "navigate";
  private callbacks: ToolbarCallbacks;

  // tracked scene objects
  private containers: ContainerLike[] = [];
  private labels: FloatingLabel[] = [];
  private cards: Card[] = [];

  // toolbar ui
  private navBtn!: Container;
  private editBtn!: Container;
  private addBtn!: Container;
  private flyout: Container | null = null;

  // edit mode state
  private selectedContainer: ContainerLike | null = null;
  private hoveredContainer: ContainerLike | null = null;
  private editDragging = false;
  private editDragOffset = { x: 0, y: 0 };
  private editDragStartPositions: Map<Card, { x: number; y: number }> | null = null;
  private editDragContainerStart: { x: number; y: number } | null = null;

  // selected label
  private selectedLabel: FloatingLabel | null = null;
  private labelDragging = false;
  private labelDragOffset = { x: 0, y: 0 };

  // action buttons shown on selection
  private actionBar: Container | null = null;

  // draw preview for container creation
  private drawAction: AddAction | null = null;
  private drawStart: { x: number; y: number } | null = null;
  private drawPreview: Graphics | null = null;

  // lasso state (navigate mode multi-select)
  private lassoActive = false;
  private lassoPoints: { x: number; y: number }[] = [];
  private lassoGraphics: Graphics | null = null;

  constructor(app: Application, callbacks: ToolbarCallbacks) {
    super();
    this.app = app;
    this.callbacks = callbacks;

    this.buildButtons();
    this.positionToolbar();
    this.highlightActiveMode();

    app.stage.on("pointerdown", this.onStageDown, this);
    app.stage.on("pointermove", this.onStageMove, this);
    app.stage.on("pointerup", this.onStageUp, this);
  }

  registerContainer(c: ContainerLike) {
    this.containers.push(c);
  }

  registerLabel(l: FloatingLabel) {
    this.labels.push(l);
  }

  registerCard(card: Card) {
    this.cards.push(card);
  }

  getMode(): ToolMode {
    return this.currentMode;
  }

  isEditMode(): boolean {
    return this.currentMode === "edit";
  }

  getSelectedCards(): Card[] {
    return this.cards.filter((c) => c.selected);
  }

  // -- button construction --

  private buildButtons() {
    const modes: { id: string; drawIcon: (g: Graphics, s: number) => void }[] = [
      { id: "navigate", drawIcon: drawCursorIcon },
      { id: "edit", drawIcon: drawPencilIcon },
      { id: "add", drawIcon: drawPlusIcon },
    ];

    const buttons: Container[] = [];
    for (let i = 0; i < modes.length; i++) {
      const { id, drawIcon } = modes[i];
      const btn = new Container();

      const bg = new Graphics();
      bg.roundRect(0, 0, BTN_SIZE, BTN_SIZE, 4).fill(PixieTheme.bgTertiary)
        .stroke({ width: 1, color: PixieTheme.borderDefault });
      btn.addChild(bg);

      const icon = new Graphics();
      drawIcon(icon, BTN_SIZE);
      btn.addChild(icon);

      btn.y = i * (BTN_SIZE + BTN_GAP);
      btn.eventMode = "static";
      btn.cursor = "pointer";
      btn.on("pointerdown", (e: FederatedPointerEvent) => {
        e.stopPropagation();
        if (id === "add") {
          this.toggleFlyout();
        } else {
          this.setMode(id as ToolMode);
        }
      });

      this.addChild(btn);
      buttons.push(btn);

      if (id === "navigate") this.navBtn = btn;
      if (id === "edit") this.editBtn = btn;
      if (id === "add") this.addBtn = btn;
    }
  }

  private positionToolbar() {
    const totalH = 3 * (BTN_SIZE + BTN_GAP) - BTN_GAP + TOOLBAR_PAD * 2;
    this.x = this.app.screen.width - BTN_SIZE - TOOLBAR_PAD - 10;
    this.y = TOOLBAR_PAD;

    const panel = new Graphics();
    panel.roundRect(-TOOLBAR_PAD, -TOOLBAR_PAD, BTN_SIZE + TOOLBAR_PAD * 2, totalH, 6)
      .fill({ color: PixieTheme.bgElevated, alpha: 0.9 });
    this.addChildAt(panel, 0);
  }

  private setMode(mode: ToolMode) {
    this.currentMode = mode;
    this.highlightActiveMode();
    this.closeFlyout();
    this.cancelDrawPreview();
    this.drawAction = null;
    this.clearSelection();
    this.clearLasso();
  }

  private highlightActiveMode() {
    const highlight = (btn: Container, active: boolean) => {
      const bg = btn.children[0] as Graphics;
      bg.clear();
      bg.roundRect(0, 0, BTN_SIZE, BTN_SIZE, 4)
        .fill(active ? PixieTheme.accent600 : PixieTheme.bgTertiary)
        .stroke({ width: 1, color: active ? PixieTheme.accent500 : PixieTheme.borderDefault });
    };
    highlight(this.navBtn, this.currentMode === "navigate");
    highlight(this.editBtn, this.currentMode === "edit");
  }

  // -- flyout menu --

  private toggleFlyout() {
    if (this.flyout) {
      this.closeFlyout();
    } else {
      this.openFlyout();
    }
  }

  private openFlyout() {
    this.closeFlyout();

    const actions: { action: AddAction; label: string }[] = [
      { action: "grid", label: "Grid" },
      { action: "shelf", label: "Shelf" },
      { action: "bin", label: "Bin" },
      { action: "label", label: "Label" },
    ];

    this.flyout = new Container();
    // position to the left of the add button
    this.flyout.x = -FLYOUT_W - TOOLBAR_PAD;
    this.flyout.y = this.addBtn.y;

    const bg = new Graphics();
    const fh = actions.length * (FLYOUT_H + FLYOUT_GAP) - FLYOUT_GAP + TOOLBAR_PAD * 2;
    bg.roundRect(-TOOLBAR_PAD, -TOOLBAR_PAD, FLYOUT_W + TOOLBAR_PAD * 2, fh, 6)
      .fill({ color: PixieTheme.bgElevated, alpha: 0.95 });
    this.flyout.addChild(bg);

    for (let i = 0; i < actions.length; i++) {
      const { action, label } = actions[i];
      const btn = new Container();

      const btnBg = new Graphics();
      btnBg.roundRect(0, 0, FLYOUT_W, FLYOUT_H, 4).fill(PixieTheme.bgTertiary)
        .stroke({ width: 1, color: PixieTheme.borderDefault });
      btn.addChild(btnBg);

      const text = new Text({ text: label, resolution: PixieTheme.textResolution, style: { fill: PixieTheme.css.textPrimary, fontSize: 11, fontFamily: PixieTheme.fontFamily } });
      text.anchor.set(0.5);
      text.x = FLYOUT_W / 2;
      text.y = FLYOUT_H / 2;
      btn.addChild(text);

      btn.y = i * (FLYOUT_H + FLYOUT_GAP);
      btn.eventMode = "static";
      btn.cursor = "pointer";
      btn.on("pointerdown", (e: FederatedPointerEvent) => {
        e.stopPropagation();
        this.startAddAction(action);
      });

      this.flyout.addChild(btn);
    }

    this.addChild(this.flyout);
  }

  private closeFlyout() {
    if (this.flyout) {
      this.flyout.destroy();
      this.flyout = null;
    }
  }

  private startAddAction(action: AddAction) {
    this.closeFlyout();
    if (action === "label") {
      // label mode: next click places a label
      this.drawAction = "label";
      return;
    }
    // for containers: enter draw mode
    this.drawAction = action;
  }

  // -- collision detection --

  private overlapsExisting(x: number, y: number, w: number, h: number): boolean {
    for (const c of this.containers) {
      const b = c.getGlobalBounds?.() ?? c.getBounds();
      if (x < b.x + b.width && x + w > b.x && y < b.y + b.height && y + h > b.y) {
        return true;
      }
    }
    return false;
  }

  private overlapsExistingExcluding(
    x: number, y: number, w: number, h: number, exclude: ContainerLike
  ): boolean {
    for (const c of this.containers) {
      if (c === exclude) continue;
      const b = c.getGlobalBounds?.() ?? c.getBounds();
      if (x < b.x + b.width && x + w > b.x && y < b.y + b.height && y + h > b.y) {
        return true;
      }
    }
    return false;
  }

  // compute snapped slot dimensions for the current draw action
  private getSnapDimensions(rawW: number, rawH: number) {
    let slotW = 0, slotH = 0, cols = 0, rows = 0;
    if (this.drawAction === "grid") {
      slotW = 110; slotH = 110;
      cols = Math.max(1, Math.round(rawW / slotW));
      rows = Math.max(1, Math.round(rawH / slotH));
    } else if (this.drawAction === "shelf") {
      slotW = SHELF_SLOT_W; slotH = SHELF_SLOT_H;
      cols = Math.max(1, Math.round(rawW / slotW));
      rows = Math.max(1, Math.round(rawH / slotH));
    } else if (this.drawAction === "bin") {
      slotW = BIN_SLOT_W; slotH = BIN_SLOT_H;
      cols = Math.max(1, Math.round(rawW / slotW));
      rows = Math.max(1, Math.round(rawH / slotH));
    }
    return { w: cols * slotW || rawW, h: rows * slotH || rawH, slotW, slotH, cols, rows };
  }

  // -- stage interaction --

  private onStageDown(e: FederatedPointerEvent) {
    const pos = e.getLocalPosition(this.app.stage);
    if (this.containsPoint(pos)) return;

    // draw action from flyout (container creation)
    if (this.drawAction && this.drawAction !== "label") {
      this.drawStart = { x: pos.x, y: pos.y };
      this.drawPreview = new Graphics();
      this.app.stage.addChild(this.drawPreview);
      return;
    }

    if (this.drawAction === "label") {
      this.placeLabel(pos.x, pos.y);
      this.drawAction = null;
      return;
    }

    if (this.currentMode === "edit") {
      this.handleEditDown(pos.x, pos.y, e);
      return;
    }

    if (this.currentMode === "navigate") {
      // start lasso if clicking empty space
      this.startLasso(pos.x, pos.y);
      return;
    }
  }

  private onStageMove(e: FederatedPointerEvent) {
    const pos = e.getLocalPosition(this.app.stage);

    // draw preview with snapped slot grid
    if (this.drawStart && this.drawPreview) {
      const rawX = Math.min(this.drawStart.x, pos.x);
      const rawY = Math.min(this.drawStart.y, pos.y);
      const rawW = Math.abs(pos.x - this.drawStart.x);
      const rawH = Math.abs(pos.y - this.drawStart.y);

      // compute snapped dimensions based on slot sizes
      const snap = this.getSnapDimensions(rawW, rawH);
      const sx = rawX;
      const sy = rawY;
      const sw = snap.w;
      const sh = snap.h;
      const collides = this.overlapsExisting(sx, sy, sw, sh);

      this.drawPreview.clear();
      // draw slot grid lines
      if (snap.slotW > 0 && snap.slotH > 0) {
        for (let c = 0; c <= snap.cols; c++) {
          this.drawPreview.moveTo(sx + c * snap.slotW, sy)
            .lineTo(sx + c * snap.slotW, sy + sh)
            .stroke({ width: 1, color: PixieTheme.borderDefault, alpha: 0.5 });
        }
        for (let r = 0; r <= snap.rows; r++) {
          this.drawPreview.moveTo(sx, sy + r * snap.slotH)
            .lineTo(sx + sw, sy + r * snap.slotH)
            .stroke({ width: 1, color: PixieTheme.borderDefault, alpha: 0.5 });
        }
      }
      // outer border
      this.drawPreview.rect(sx, sy, sw, sh).stroke({
        width: 2,
        color: collides ? PixieTheme.error : PixieTheme.accent500,
        alpha: 0.8,
      });
    }

    // edit mode: hover highlight
    if (this.currentMode === "edit" && !this.editDragging) {
      this.handleEditHover(pos.x, pos.y);
    }

    // edit mode: drag container
    if (this.editDragging && this.selectedContainer) {
      let dx = pos.x - this.editDragOffset.x;
      let dy = pos.y - this.editDragOffset.y;

      // constrain to canvas bounds (can't go above or left, expands right)
      dx = Math.max(0, dx);
      dy = Math.max(0, dy);
      const cb = this.selectedContainer.getGlobalBounds?.() ?? this.selectedContainer.getBounds();
      const cw = cb.width;
      const ch = cb.height;
      const screenH = this.app.screen.height;
      dy = Math.min(screenH - ch, dy);

      // expand canvas rightward if needed
      const screenW = this.app.screen.width;
      if (dx + cw > screenW) {
        const needed = dx + cw + 50;
        this.app.renderer.resize(needed, screenH);
        this.app.stage.hitArea = this.app.screen;
      }

      this.selectedContainer.x = dx;
      this.selectedContainer.y = dy;
      // move cards with container
      if (this.editDragStartPositions && this.editDragContainerStart) {
        const cdx = dx - this.editDragContainerStart.x;
        const cdy = dy - this.editDragContainerStart.y;
        for (const [card, start] of this.editDragStartPositions) {
          card.x = start.x + cdx;
          card.y = start.y + cdy;
        }
      }
    }

    // edit mode: drag label
    if (this.labelDragging && this.selectedLabel) {
      let lx = pos.x - this.labelDragOffset.x;
      let ly = pos.y - this.labelDragOffset.y;
      lx = Math.max(0, lx);
      ly = Math.max(0, ly);
      const lb = this.selectedLabel.getBounds();
      ly = Math.min(this.app.screen.height - lb.height, ly);
      if (lx + lb.width > this.app.screen.width) {
        const needed = lx + lb.width + 50;
        this.app.renderer.resize(needed, this.app.screen.height);
        this.app.stage.hitArea = this.app.screen;
      }
      this.selectedLabel.x = lx;
      this.selectedLabel.y = ly;
    }

    // lasso
    if (this.lassoActive && this.lassoGraphics) {
      this.lassoPoints.push({ x: pos.x, y: pos.y });
      this.redrawLasso();
      this.updateLassoSelection();
    }
  }

  private onStageUp(e: FederatedPointerEvent) {
    const pos = e.getLocalPosition(this.app.stage);

    // finish draw
    if (this.drawStart && this.drawPreview) {
      const x = Math.min(this.drawStart.x, pos.x);
      const y = Math.min(this.drawStart.y, pos.y);
      const w = Math.abs(pos.x - this.drawStart.x);
      const h = Math.abs(pos.y - this.drawStart.y);
      this.cancelDrawPreview();
      if (w > 30 && h > 30) {
        this.createContainer(x, y, w, h);
      }
      this.drawAction = null;
    }

    // end edit drag — check collision and snap back if overlapping
    if (this.editDragging && this.selectedContainer) {
      const b = this.selectedContainer.getGlobalBounds?.() ?? this.selectedContainer.getBounds();
      const collides = this.overlapsExistingExcluding(
        b.x, b.y, b.width, b.height, this.selectedContainer
      );
      if (collides && this.editDragContainerStart) {
        // snap back to original position
        const cx = this.editDragContainerStart.x;
        const cy = this.editDragContainerStart.y;
        this.selectedContainer.x = cx;
        this.selectedContainer.y = cy;
        if (this.editDragStartPositions) {
          for (const [card, start] of this.editDragStartPositions) {
            card.x = start.x;
            card.y = start.y;
          }
        }
      }
      this.editDragging = false;
      this.editDragStartPositions = null;
      this.editDragContainerStart = null;
      // refresh action bar position
      if (this.selectedContainer) this.showActionBar(this.selectedContainer);
    } else if (this.editDragging) {
      this.editDragging = false;
      this.editDragStartPositions = null;
      this.editDragContainerStart = null;
    }

    // end label drag
    if (this.labelDragging) {
      this.labelDragging = false;
      if (this.selectedLabel) this.showLabelActionBar(this.selectedLabel);
    }

    // end lasso
    if (this.lassoActive) {
      this.endLasso();
    }
  }

  // -- edit mode helpers --

  private handleEditHover(px: number, py: number) {
    let found: ContainerLike | null = null;
    for (let i = this.containers.length - 1; i >= 0; i--) {
      const c = this.containers[i];
      const b = c.getGlobalBounds?.() ?? c.getBounds();
      if (px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height) {
        found = c;
        break;
      }
    }

    if (found !== this.hoveredContainer) {
      if (this.hoveredContainer && this.hoveredContainer !== this.selectedContainer) {
        this.hoveredContainer.setHighlight?.(false);
      }
      this.hoveredContainer = found;
      if (found && found !== this.selectedContainer) {
        found.setHighlight?.(true);
      }
    }
  }

  private handleEditDown(px: number, py: number, _e: FederatedPointerEvent) {
    // check labels first — select + start drag
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const label = this.labels[i];
      const b = label.getBounds();
      if (px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height) {
        this.selectLabel(label);
        this.labelDragging = true;
        this.labelDragOffset = { x: px - label.x, y: py - label.y };
        return;
      }
    }

    // check containers
    for (let i = this.containers.length - 1; i >= 0; i--) {
      const c = this.containers[i];
      const b = c.getGlobalBounds?.() ?? c.getBounds();
      if (px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height) {
        this.selectContainer(c);
        // start drag
        this.editDragging = true;
        this.editDragOffset = { x: px - c.x, y: py - c.y };
        this.editDragContainerStart = { x: c.x, y: c.y };
        // capture card positions
        const occupiedCards = c.getOccupiedCards?.() ?? [];
        this.editDragStartPositions = new Map();
        for (const card of occupiedCards) {
          this.editDragStartPositions.set(card, { x: card.x, y: card.y });
        }
        return;
      }
    }

    // clicked empty space in edit mode — deselect
    this.clearSelection();
  }

  private selectContainer(c: ContainerLike) {
    this.clearSelection();
    this.selectedContainer = c;
    c.setHighlight?.(true);
    this.showActionBar(c);
  }

  private selectLabel(label: FloatingLabel) {
    this.clearSelection();
    this.selectedLabel = label;
    this.showLabelActionBar(label);
  }

  private clearSelection() {
    if (this.selectedContainer) {
      this.selectedContainer.setHighlight?.(false);
      this.selectedContainer = null;
    }
    if (this.selectedLabel) {
      this.selectedLabel = null;
    }
    if (this.hoveredContainer) {
      this.hoveredContainer.setHighlight?.(false);
      this.hoveredContainer = null;
    }
    this.removeActionBar();
  }

  // -- action bar (delete/edit buttons on selected container) --

  private showActionBar(c: ContainerLike) {
    this.removeActionBar();
    this.actionBar = new Container();

    const b = c.getGlobalBounds?.() ?? c.getBounds();
    this.actionBar.x = b.x + b.width + 6;
    this.actionBar.y = b.y;

    // delete button
    const delBtn = this.makeActionButton("Del", PixieTheme.error, () => {
      this.deleteContainer(c);
    });
    this.actionBar.addChild(delBtn);

    // edit button (prompt resize)
    const editBtn = this.makeActionButton("Edit", PixieTheme.accent500, () => {
      this.editContainer(c);
    });
    editBtn.y = FLYOUT_H + 4;
    this.actionBar.addChild(editBtn);

    this.app.stage.addChild(this.actionBar);
  }

  private showLabelActionBar(label: FloatingLabel) {
    this.removeActionBar();
    this.actionBar = new Container();

    const b = label.getBounds();
    this.actionBar.x = b.x + b.width + 6;
    this.actionBar.y = b.y;

    const delBtn = this.makeActionButton("Del", PixieTheme.error, () => {
      const idx = this.labels.indexOf(label);
      if (idx >= 0) this.labels.splice(idx, 1);
      this.callbacks.onLabelRemoved(label);
      label.destroy();
      this.clearSelection();
    });
    this.actionBar.addChild(delBtn);

    const editBtn = this.makeActionButton("Edit", PixieTheme.accent500, () => {
      label.promptEdit();
    });
    editBtn.y = FLYOUT_H + 4;
    this.actionBar.addChild(editBtn);

    this.app.stage.addChild(this.actionBar);
  }

  private makeActionButton(label: string, color: number, onClick: () => void): Container {
    const btn = new Container();
    const bg = new Graphics();
    bg.roundRect(0, 0, 50, FLYOUT_H, 4).fill(PixieTheme.bgTertiary)
      .stroke({ width: 1, color });
    btn.addChild(bg);

    const text = new Text({ text: label, resolution: PixieTheme.textResolution, style: { fill: PixieTheme.css.textPrimary, fontSize: 10, fontFamily: PixieTheme.fontFamily } });
    text.anchor.set(0.5);
    text.x = 25;
    text.y = FLYOUT_H / 2;
    btn.addChild(text);

    btn.eventMode = "static";
    btn.cursor = "pointer";
btn.on("pointerdown", (ev: FederatedPointerEvent) => {
        ev.stopPropagation();
      onClick();
    });

    return btn;
  }

  private removeActionBar() {
    if (this.actionBar) {
      this.actionBar.destroy();
      this.actionBar = null;
    }
  }

  private deleteContainer(c: ContainerLike) {
    const idx = this.containers.indexOf(c);
    if (idx >= 0) this.containers.splice(idx, 1);
    this.callbacks.onContainerRemoved(c as Container & DropZoneChecker);
    c.destroy();
    this.clearSelection();
  }

  private editContainer(c: ContainerLike) {
    if (c instanceof Grid) {
      const input = globalThis.prompt?.("cols x rows (e.g. 5x3):", `${c.gridCols}x${c.gridRows}`);
      if (!input) return;
      const parts = input.split("x").map(Number);
      if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
        this.rebuildContainer(c, () => new Grid({
          x: c.x, y: c.y, cols: parts[0], rows: parts[1], cellSize: c.cellSize,
        }));
      }
    } else if (c instanceof Shelf) {
      const input = globalThis.prompt?.("cols x rows:", `${c.shelfCols}x${c.shelfRows}`);
      if (!input) return;
      const parts = input.split("x").map(Number);
      if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
        this.rebuildContainer(c, () => new Shelf({
          x: c.x, y: c.y, cols: parts[0], rows: parts[1],
        }));
      }
    } else if (c instanceof Bin) {
      const input = globalThis.prompt?.("cols x rows:", `${c.binCols}x${c.binRows}`);
      if (!input) return;
      const parts = input.split("x").map(Number);
      if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
        this.rebuildContainer(c, () => new Bin({
          x: c.x, y: c.y, cols: parts[0], rows: parts[1],
        }));
      }
    }
  }

  private rebuildContainer(old: ContainerLike, create: () => ContainerLike) {
    const idx = this.containers.indexOf(old);
    if (idx < 0) return;
    const parent = old.parent;
    if (!parent) return;

    this.callbacks.onContainerRemoved(old as Container & DropZoneChecker);
    old.destroy();

    const newC = create();
    (newC as any).eventMode = "static";
    parent.addChildAt(newC, 0);
    this.containers[idx] = newC;
    this.callbacks.onContainerAdded(newC as Container & DropZoneChecker);
    this.clearSelection();
  }

  // -- container creation with snap + collision --

  private createContainer(x: number, y: number, w: number, h: number) {
    let container: ContainerLike | null = null;

    if (this.drawAction === "grid") {
      const cellSize = 110;
      const cols = Math.max(1, Math.round(w / cellSize));
      const rows = Math.max(1, Math.round(h / cellSize));
      const sw = cols * cellSize;
      const sh = rows * cellSize;
      if (this.overlapsExisting(x, y, sw, sh)) return;
      container = new Grid({ x, y, cols, rows, cellSize });
    } else if (this.drawAction === "shelf") {
      const cols = Math.max(1, Math.round(w / SHELF_SLOT_W));
      const rows = Math.max(1, Math.round(h / SHELF_SLOT_H));
      const sw = cols * SHELF_SLOT_W;
      const sh = rows * SHELF_SLOT_H;
      if (this.overlapsExisting(x, y, sw, sh)) return;
      container = new Shelf({ x, y, cols, rows });
    } else if (this.drawAction === "bin") {
      const cols = Math.max(1, Math.round(w / BIN_SLOT_W));
      const rows = Math.max(1, Math.round(h / BIN_SLOT_H));
      const sw = cols * BIN_SLOT_W;
      const sh = rows * BIN_SLOT_H;
      if (this.overlapsExisting(x, y, sw, sh)) return;
      container = new Bin({ x, y, cols, rows });
    }

    if (container) {
      (container as any).eventMode = "static";
      this.app.stage.addChildAt(container, 0);
      this.containers.push(container);
      this.callbacks.onContainerAdded(container as Container & DropZoneChecker);
    }
  }

  private placeLabel(px: number, py: number) {
    const label = new FloatingLabel(px, py, "label", true);
    this.app.stage.addChild(label);
    this.labels.push(label);
    this.callbacks.onLabelAdded(label);
  }

  private cancelDrawPreview() {
    if (this.drawPreview) {
      this.drawPreview.destroy();
      this.drawPreview = null;
    }
    this.drawStart = null;
  }

  // -- lasso (navigate mode multi-select) --

  private startLasso(px: number, py: number) {
    // don't lasso if clicking on a card
    for (const card of this.cards) {
      const b = card.getBounds();
      if (px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height) {
        return;
      }
    }

    // clear previous selections
    for (const card of this.cards) {
      card.setSelected(false);
    }

    this.lassoActive = true;
    this.lassoPoints = [{ x: px, y: py }];
    this.lassoGraphics = new Graphics();
    this.app.stage.addChild(this.lassoGraphics);
  }

  private redrawLasso() {
    if (!this.lassoGraphics || this.lassoPoints.length < 2) return;
    this.lassoGraphics.clear();
    const pts = this.lassoPoints;
    this.lassoGraphics.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      this.lassoGraphics.lineTo(pts[i].x, pts[i].y);
    }
    this.lassoGraphics.stroke({ width: 2, color: PixieTheme.accent500, alpha: 0.7 });
  }

  private updateLassoSelection() {
    if (this.lassoPoints.length < 2) return;

    // compute bounding box of lasso trail
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of this.lassoPoints) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    for (const card of this.cards) {
      const b = card.getBounds();
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const inside = cx >= minX && cx <= maxX && cy >= minY && cy <= maxY;
      card.setSelected(inside);
    }
  }

  private endLasso() {
    this.lassoActive = false;
    this.lassoPoints = [];
    if (this.lassoGraphics) {
      this.lassoGraphics.destroy();
      this.lassoGraphics = null;
    }
  }

  private clearLasso() {
    this.endLasso();
    for (const card of this.cards) {
      card.setSelected(false);
    }
  }

  private containsPoint(pos: { x: number; y: number }): boolean {
    const bounds = this.getBounds();
    return (
      pos.x >= bounds.x && pos.x <= bounds.x + bounds.width &&
      pos.y >= bounds.y && pos.y <= bounds.y + bounds.height
    );
  }

  destroy() {
    this.app.stage.off("pointerdown", this.onStageDown, this);
    this.app.stage.off("pointermove", this.onStageMove, this);
    this.app.stage.off("pointerup", this.onStageUp, this);
    this.removeActionBar();
    this.closeFlyout();
    super.destroy();
  }
}
