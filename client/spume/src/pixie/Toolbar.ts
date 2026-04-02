import {
  Application,
  Container,
  FederatedPointerEvent,
  Graphics,
  Text,
} from "pixi.js";
import type { ToolMode, AddAction } from "./ToolMode";
import { Grid, GRID_CELL_SIZE } from "./Grid";
import { Shelf, SHELF_SLOT_W, SHELF_SLOT_H } from "./Shelf";
import { Bin, BIN_SLOT_W, BIN_SLOT_H } from "./Bin";
import { FloatingLabel } from "./FloatingLabel";
import type { Card, DropZoneChecker } from "./Card";
import { PixieTheme, snapToGrid } from "./PixieTheme";
import type { Viewport } from "./Viewport";

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
  occupySlot?: (sx: number, sy: number, card: Card) => void;
  totalWidth?: number;
  totalHeight?: number;
};

// pixi-native toolbar: 3 icon buttons (navigate, edit, +add).
// +add opens a flyout for grid/shelf/bin/label creation.
// edit mode: hover highlights containers, click selects, drag moves with cards,
// delete/edit actions on selected. navigate mode: cards are interactive.
export class Toolbar extends Container {
  private app: Application;
  private currentMode: ToolMode = "navigate";
  private callbacks: ToolbarCallbacks;
  private viewport: Viewport | null = null;

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
  private selectedContainers: Set<ContainerLike> = new Set();
  private hoveredContainer: ContainerLike | null = null;
  private editDragging = false;
  private editDragOffset = { x: 0, y: 0 };
  private editDragStartPositions: Map<Card, { x: number; y: number }> | null = null;
  private editDragContainerStart: { x: number; y: number } | null = null;
  private editDragMultiStarts: Map<ContainerLike, { x: number; y: number }> | null = null;

  // resize handle state
  private resizeHandles: Graphics[] = [];
  private resizeHandleDragging = false;
  private resizeHandleIndex = -1;
  private resizeStartCols = 0;
  private resizeStartRows = 0;
  private resizeStartPos = { x: 0, y: 0 };
  private resizeTarget: ContainerLike | null = null;

  // selected label
  private selectedLabel: FloatingLabel | null = null;
  private labelDragging = false;
  private labelDragOffset = { x: 0, y: 0 };
  private labelResizeHandles: Graphics[] = [];
  private labelResizing = false;
  private labelResizeIndex = -1;
  private labelResizeStart = { x: 0, y: 0, w: 0, h: 0, lx: 0, ly: 0 };
  private lastLabelPointerDown = 0;

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

  constructor(app: Application, callbacks: ToolbarCallbacks, viewport?: Viewport) {
    super();
    this.app = app;
    this.callbacks = callbacks;
    this.viewport = viewport ?? null;

    this.buildButtons();
    this.positionToolbar();
    this.highlightActiveMode();

    // listen on the world container if we have a viewport, otherwise stage
    const eventTarget = this.viewport?.world ?? app.stage;
    eventTarget.on("pointerdown", this.onStageDown, this);
    eventTarget.on("pointermove", this.onStageMove, this);
    eventTarget.on("pointerup", this.onStageUp, this);
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

  // container to add content into (world if viewport exists, stage otherwise)
  private get contentParent(): Container {
    return (this.viewport?.world ?? this.app.stage) as Container;
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

  // resolve AABB collisions by pushing out along the axis with least penetration.
  // returns clamped position that doesn't overlap any other container.
  private resolveCollisions(
    x: number, y: number, w: number, h: number, exclude: ContainerLike
  ): { x: number; y: number } {
    for (const c of this.containers) {
      if (c === exclude) continue;
      const b = c.getGlobalBounds?.() ?? c.getBounds();
      const overlapX = Math.min(x + w, b.x + b.width) - Math.max(x, b.x);
      const overlapY = Math.min(y + h, b.y + b.height) - Math.max(y, b.y);
      if (overlapX > 0 && overlapY > 0) {
        if (overlapX < overlapY) {
          x = (x + w / 2 < b.x + b.width / 2) ? b.x - w : b.x + b.width;
        } else {
          y = (y + h / 2 < b.y + b.height / 2) ? b.y - h : b.y + b.height;
        }
      }
    }
    return { x, y };
  }

  // for draw previews: clamp the size of a rectangle being drawn so it doesn't
  // extend into existing containers. shrinks width/height to stop at edges.
  private resolveCollisionsDraw(
    x: number, y: number, w: number, h: number
  ): { x: number; y: number; w: number; h: number } {
    for (const c of this.containers) {
      const b = c.getGlobalBounds?.() ?? c.getBounds();
      const overlapX = Math.min(x + w, b.x + b.width) - Math.max(x, b.x);
      const overlapY = Math.min(y + h, b.y + b.height) - Math.max(y, b.y);
      if (overlapX > 0 && overlapY > 0) {
        // shrink whichever edge is closer to the container
        if (overlapX < overlapY) {
          if (x + w / 2 < b.x + b.width / 2) {
            w = b.x - x;
          } else {
            const oldX = x;
            x = b.x + b.width;
            w -= (x - oldX);
          }
        } else {
          if (y + h / 2 < b.y + b.height / 2) {
            h = b.y - y;
          } else {
            const oldY = y;
            y = b.y + b.height;
            h -= (y - oldY);
          }
        }
      }
    }
    return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
  }

  // compute snapped slot dimensions for the current draw action
  private getSnapDimensions(rawW: number, rawH: number) {
    let slotW = 0, slotH = 0, cols = 0, rows = 0;
    if (this.drawAction === "grid") {
      slotW = GRID_CELL_SIZE; slotH = GRID_CELL_SIZE;
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
    const pos = e.getLocalPosition(this.contentParent);
    if (this.containsPoint(pos)) return;

    // draw action from flyout (container creation)
    if (this.drawAction && this.drawAction !== "label") {
      this.drawStart = { x: pos.x, y: pos.y };
      this.drawPreview = new Graphics();
      this.contentParent.addChild(this.drawPreview);
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
      // don't lasso during two-finger pan
      if (this.viewport?.panning) return;
      // start lasso if clicking empty space
      this.startLasso(pos.x, pos.y);
      return;
    }
  }

  private onStageMove(e: FederatedPointerEvent) {
    const pos = e.getLocalPosition(this.contentParent);

    // draw preview with snapped slot grid
    if (this.drawStart && this.drawPreview) {
      const rawX = snapToGrid(Math.min(this.drawStart.x, pos.x));
      const rawY = snapToGrid(Math.min(this.drawStart.y, pos.y));
      const rawW = Math.abs(pos.x - this.drawStart.x);
      const rawH = Math.abs(pos.y - this.drawStart.y);

      // compute snapped dimensions based on slot sizes
      const snap = this.getSnapDimensions(rawW, rawH);
      // clamp draw preview to not overlap existing containers
      const resolved = this.resolveCollisionsDraw(rawX, rawY, snap.w, snap.h);
      const sx = resolved.x;
      const sy = resolved.y;
      const sw = resolved.w;
      const sh = resolved.h;
      // recalculate cols/rows from clamped size
      const drawCols = snap.slotW > 0 ? Math.max(1, Math.floor(sw / snap.slotW)) : 0;
      const drawRows = snap.slotH > 0 ? Math.max(1, Math.floor(sh / snap.slotH)) : 0;
      const finalW = drawCols * snap.slotW || sw;
      const finalH = drawRows * snap.slotH || sh;
      const collides = this.overlapsExisting(sx, sy, finalW, finalH);

      this.drawPreview.clear();
      // draw slot grid lines
      if (snap.slotW > 0 && snap.slotH > 0) {
        for (let c = 0; c <= drawCols; c++) {
          this.drawPreview.moveTo(sx + c * snap.slotW, sy)
            .lineTo(sx + c * snap.slotW, sy + finalH)
            .stroke({ width: 1, color: PixieTheme.borderDefault, alpha: 0.5 });
        }
        for (let r = 0; r <= drawRows; r++) {
          this.drawPreview.moveTo(sx, sy + r * snap.slotH)
            .lineTo(sx + finalW, sy + r * snap.slotH)
            .stroke({ width: 1, color: PixieTheme.borderDefault, alpha: 0.5 });
        }
      }
      // outer border
      this.drawPreview.rect(sx, sy, finalW, finalH).stroke({
        width: 2,
        color: collides ? PixieTheme.error : PixieTheme.accent500,
        alpha: 0.8,
      });
    }

    // edit mode: hover highlight
    if (this.currentMode === "edit" && !this.editDragging) {
      this.handleEditHover(pos.x, pos.y);
    }

    // resize handle drag
    if (this.resizeHandleDragging) {
      this.updateResize(pos.x, pos.y);
    }

    // label resize handle drag
    if (this.labelResizing) {
      this.updateLabelResize(pos.x, pos.y);
    }

    // edit mode: drag container(s)
    if (this.editDragging && this.selectedContainer) {
      let dx = snapToGrid(pos.x - this.editDragOffset.x);
      let dy = snapToGrid(pos.y - this.editDragOffset.y);

      // constrain to world bounds (can't go above or left, expands right)
      dx = Math.max(0, dx);
      dy = Math.max(0, dy);
      const cb = this.selectedContainer.getGlobalBounds?.() ?? this.selectedContainer.getBounds();
      const cw = cb.width;
      const ch = cb.height;
      const worldH = this.viewport ? this.viewport.worldHeight : this.app.screen.height;
      dy = Math.min(worldH - ch, dy);

      // expand world rightward if needed
      const worldW = this.viewport ? this.viewport.worldWidth : this.app.screen.width;
      if (dx + cw > worldW) {
        const needed = dx + cw + 50;
        if (this.viewport) {
          this.viewport.expandWorld(needed, this.viewport.worldHeight);
        } else {
          this.app.renderer.resize(needed, worldH);
          this.app.stage.hitArea = this.app.screen;
        }
      }

      // clamp to non-overlapping position (prevents intersection)
      const excludeSet = this.selectedContainers.size > 1 ? this.selectedContainers : null;
      if (!excludeSet) {
        const resolved = this.resolveCollisions(dx, dy, cw, ch, this.selectedContainer);
        dx = resolved.x;
        dy = resolved.y;
      }

      const anchorDx = dx - (this.editDragContainerStart?.x ?? 0);
      const anchorDy = dy - (this.editDragContainerStart?.y ?? 0);

      this.selectedContainer.x = dx;
      this.selectedContainer.y = dy;

      // move other selected containers (multi-select drag)
      if (this.editDragMultiStarts) {
        for (const [c, start] of this.editDragMultiStarts) {
          if (c === this.selectedContainer) continue;
          c.x = start.x + anchorDx;
          c.y = start.y + anchorDy;
        }
      }

      // move cards with container(s)
      if (this.editDragStartPositions) {
        for (const [card, start] of this.editDragStartPositions) {
          card.x = start.x + anchorDx;
          card.y = start.y + anchorDy;
        }
      }

      // keep handles and action bar in sync with container
      this.repositionResizeHandles(this.selectedContainer);
      this.updateActionBarPosition(this.selectedContainer);
    }

    // drag label (works in both navigate and edit mode)
    if (this.labelDragging && this.selectedLabel) {
      let lx = pos.x - this.labelDragOffset.x;
      let ly = pos.y - this.labelDragOffset.y;
      lx = Math.max(0, lx);
      ly = Math.max(0, ly);
      const lb = this.selectedLabel.getHitBounds();
      const worldH = this.viewport ? this.viewport.worldHeight : this.app.screen.height;
      ly = Math.min(worldH - lb.height, ly);
      const worldW = this.viewport ? this.viewport.worldWidth : this.app.screen.width;
      if (lx + lb.width > worldW) {
        const needed = lx + lb.width + 50;
        if (this.viewport) {
          this.viewport.expandWorld(needed, this.viewport.worldHeight);
        } else {
          this.app.renderer.resize(needed, this.app.screen.height);
          this.app.stage.hitArea = this.app.screen;
        }
      }
      this.selectedLabel.x = lx;
      this.selectedLabel.y = ly;
      this.repositionLabelResizeHandles(this.selectedLabel);
    }

    // lasso
    if (this.lassoActive && this.lassoGraphics) {
      // cancel lasso if a second finger touches
      if (this.viewport?.panning) {
        this.endLasso();
      } else {
        this.lassoPoints.push({ x: pos.x, y: pos.y });
        this.redrawLasso();
        this.updateLassoSelection();
      }
    }
  }

  private onStageUp(e: FederatedPointerEvent) {
    const pos = e.getLocalPosition(this.contentParent);

    // finish draw
    if (this.drawStart && this.drawPreview) {
      const x = snapToGrid(Math.min(this.drawStart.x, pos.x));
      const y = snapToGrid(Math.min(this.drawStart.y, pos.y));
      const w = Math.abs(pos.x - this.drawStart.x);
      const h = Math.abs(pos.y - this.drawStart.y);
      this.cancelDrawPreview();
      let created = false;
      if (w > 32 && h > 32) {
        created = this.createContainer(x, y, w, h);
      }
      // keep draw action alive so user can try again without re-selecting
      if (created) {
        this.drawAction = null;
      }
    }

    // end resize handle drag
    if (this.resizeHandleDragging) {
      this.finishResize();
    }

    // end edit drag (collision already prevented during move)
    if (this.editDragging && this.selectedContainer) {
      this.editDragging = false;
      this.editDragStartPositions = null;
      this.editDragContainerStart = null;
      this.editDragMultiStarts = null;
      // refresh action bar + handles at final position
      if (this.selectedContainer && this.selectedContainers.size <= 1) {
        this.showActionBar(this.selectedContainer);
        this.showResizeHandles(this.selectedContainer);
      }
    } else if (this.editDragging) {
      this.editDragging = false;
      this.editDragStartPositions = null;
      this.editDragContainerStart = null;
      this.editDragMultiStarts = null;
    }

    // end label drag
    if (this.labelDragging) {
      this.labelDragging = false;
      if (this.selectedLabel) this.showLabelActionBar(this.selectedLabel);
    }

    // end label resize
    if (this.labelResizing) {
      this.labelResizing = false;
      this.labelResizeIndex = -1;
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

  // hit-test labels and handle click/double-click/drag. returns true if a label was hit.
  private handleLabelDown(px: number, py: number): boolean {
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const label = this.labels[i];
      const b = label.getHitBounds();
      if (px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height) {
        // double-click detection (300ms)
        const now = Date.now();
        if (now - this.lastLabelPointerDown < 300 && this.selectedLabel === label) {
          this.lastLabelPointerDown = 0;
          // finish any previous edit on another label
          for (const l of this.labels) { if (l !== label && l.isEditing) l.finishEdit(); }
          label.promptEdit();
          return true;
        }
        this.lastLabelPointerDown = now;

        // finish editing if clicking a different label
        if (this.selectedLabel && this.selectedLabel !== label && this.selectedLabel.isEditing) {
          this.selectedLabel.finishEdit();
        }

        this.selectLabel(label);
        this.labelDragging = true;
        this.labelDragOffset = { x: px - label.x, y: py - label.y };
        return true;
      }
    }
    // clicked away from labels — finish any active edit
    for (const l of this.labels) { if (l.isEditing) l.finishEdit(); }
    return false;
  }

  private handleEditDown(px: number, py: number, _e: FederatedPointerEvent) {
    // check labels first — select + start drag
    if (this.handleLabelDown(px, py)) return;

    // check containers
    for (let i = this.containers.length - 1; i >= 0; i--) {
      const c = this.containers[i];
      const b = c.getGlobalBounds?.() ?? c.getBounds();
      if (px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height) {
        // if this container is part of multi-selection, start multi-drag
        if (this.selectedContainers.has(c) && this.selectedContainers.size > 1) {
          this.startMultiContainerDrag(c, px, py);
          return;
        }
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

    // clicked empty space in edit mode — start lasso for multi-container select
    this.clearSelection();
    if (this.viewport?.panning) return;
    this.startLasso(px, py);
  }

  private selectContainer(c: ContainerLike) {
    this.clearSelection();
    this.selectedContainer = c;
    c.setHighlight?.(true);
    this.showActionBar(c);
    this.showResizeHandles(c);
  }

  private selectLabel(label: FloatingLabel) {
    this.clearSelection();
    this.selectedLabel = label;
    this.showLabelActionBar(label);
  }

  private startMultiContainerDrag(anchor: ContainerLike, px: number, py: number) {
    this.editDragging = true;
    this.selectedContainer = anchor;
    this.editDragOffset = { x: px - anchor.x, y: py - anchor.y };
    this.editDragContainerStart = { x: anchor.x, y: anchor.y };
    // capture all selected container start positions
    this.editDragMultiStarts = new Map();
    for (const c of this.selectedContainers) {
      this.editDragMultiStarts.set(c, { x: c.x, y: c.y });
    }
    // capture cards from all selected containers
    this.editDragStartPositions = new Map();
    for (const c of this.selectedContainers) {
      const cards = c.getOccupiedCards?.() ?? [];
      for (const card of cards) {
        this.editDragStartPositions.set(card, { x: card.x, y: card.y });
      }
    }
    this.removeActionBar();
    this.removeResizeHandles();
  }

  private clearSelection() {
    if (this.selectedContainer) {
      this.selectedContainer.setHighlight?.(false);
      this.selectedContainer = null;
    }
    for (const c of this.selectedContainers) {
      c.setHighlight?.(false);
    }
    this.selectedContainers.clear();
    if (this.selectedLabel) {
      this.selectedLabel = null;
    }
    if (this.hoveredContainer) {
      this.hoveredContainer.setHighlight?.(false);
      this.hoveredContainer = null;
    }
    this.removeActionBar();
    this.removeResizeHandles();
    this.removeLabelResizeHandles();
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

    this.app.stage.addChild(this.actionBar);
  }

  private updateActionBarPosition(c: ContainerLike) {
    if (!this.actionBar) return;
    const b = c.getGlobalBounds?.() ?? c.getBounds();
    this.actionBar.x = b.x + b.width + 6;
    this.actionBar.y = b.y;
  }

  private showLabelActionBar(label: FloatingLabel) {
    this.removeActionBar();
    this.actionBar = new Container();

    const b = label.getHitBounds();
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
    this.showLabelResizeHandles(label);
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

  // -- resize handles (8 drag handles: corners + edge midpoints) --

  private getContainerSlotSize(c: ContainerLike): { slotW: number; slotH: number; cols: number; rows: number } {
    if (c instanceof Grid) return { slotW: c.cellSize, slotH: c.cellSize, cols: c.gridCols, rows: c.gridRows };
    if (c instanceof Shelf) return { slotW: c.slotW, slotH: c.slotH, cols: c.shelfCols, rows: c.shelfRows };
    if (c instanceof Bin) return { slotW: c.slotW, slotH: c.slotH, cols: c.binCols, rows: c.binRows };
    return { slotW: 0, slotH: 0, cols: 0, rows: 0 };
  }

  private showResizeHandles(c: ContainerLike) {
    this.removeResizeHandles();
    const b = c.getGlobalBounds?.() ?? c.getBounds();
    const HANDLE_SIZE = 10;
    // 8 positions: TL, TC, TR, ML, MR, BL, BC, BR
    const positions = [
      { x: b.x, y: b.y },                                    // 0: top-left
      { x: b.x + b.width / 2, y: b.y },                      // 1: top-center
      { x: b.x + b.width, y: b.y },                           // 2: top-right
      { x: b.x, y: b.y + b.height / 2 },                     // 3: mid-left
      { x: b.x + b.width, y: b.y + b.height / 2 },           // 4: mid-right
      { x: b.x, y: b.y + b.height },                          // 5: bottom-left
      { x: b.x + b.width / 2, y: b.y + b.height },           // 6: bottom-center
      { x: b.x + b.width, y: b.y + b.height },               // 7: bottom-right
    ];

    const cursors = ["nwse-resize", "ns-resize", "nesw-resize", "ew-resize", "ew-resize", "nesw-resize", "ns-resize", "nwse-resize"];

    for (let i = 0; i < positions.length; i++) {
      const handle = new Graphics();
      handle.rect(-HANDLE_SIZE / 2, -HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE)
        .fill(PixieTheme.accent500)
        .stroke({ width: 1, color: PixieTheme.borderStrong });
      handle.x = positions[i].x;
      handle.y = positions[i].y;
      handle.eventMode = "static";
      handle.cursor = cursors[i];
      const idx = i;
      handle.on("pointerdown", (ev: FederatedPointerEvent) => {
        ev.stopPropagation();
        this.startResize(c, idx, ev);
      });
      this.contentParent.addChild(handle);
      this.resizeHandles.push(handle);
    }
  }

  private removeResizeHandles() {
    for (const h of this.resizeHandles) h.destroy();
    this.resizeHandles = [];
    this.resizeHandleDragging = false;
  }

  private repositionResizeHandles(c: ContainerLike) {
    if (this.resizeHandles.length !== 8) return;
    const b = c.getGlobalBounds?.() ?? c.getBounds();
    const positions = [
      { x: b.x, y: b.y },
      { x: b.x + b.width / 2, y: b.y },
      { x: b.x + b.width, y: b.y },
      { x: b.x, y: b.y + b.height / 2 },
      { x: b.x + b.width, y: b.y + b.height / 2 },
      { x: b.x, y: b.y + b.height },
      { x: b.x + b.width / 2, y: b.y + b.height },
      { x: b.x + b.width, y: b.y + b.height },
    ];
    for (let i = 0; i < 8; i++) {
      this.resizeHandles[i].x = positions[i].x;
      this.resizeHandles[i].y = positions[i].y;
    }
  }

  private startResize(c: ContainerLike, handleIdx: number, e: FederatedPointerEvent) {
    const pos = e.getLocalPosition(this.contentParent);
    const info = this.getContainerSlotSize(c);
    this.resizeHandleDragging = true;
    this.resizeHandleIndex = handleIdx;
    this.resizeStartCols = info.cols;
    this.resizeStartRows = info.rows;
    this.resizeStartPos = { x: pos.x, y: pos.y };
    this.resizeTarget = c;
  }

  private updateResize(px: number, py: number) {
    if (!this.resizeTarget) return;
    const c = this.resizeTarget;
    const info = this.getContainerSlotSize(c);
    const dx = px - this.resizeStartPos.x;
    const dy = py - this.resizeStartPos.y;

    let newCols = info.cols;
    let newRows = info.rows;

    // which edges does this handle affect?
    // handles: 0=TL 1=TC 2=TR 3=ML 4=MR 5=BL 6=BC 7=BR
    const idx = this.resizeHandleIndex;
    const affectsRight = idx === 2 || idx === 4 || idx === 7;
    const affectsBottom = idx === 5 || idx === 6 || idx === 7;
    const affectsLeft = idx === 0 || idx === 3 || idx === 5;
    const affectsTop = idx === 0 || idx === 1 || idx === 2;

    if (affectsRight) {
      newCols = Math.max(1, this.resizeStartCols + Math.round(dx / info.slotW));
    } else if (affectsLeft) {
      newCols = Math.max(1, this.resizeStartCols - Math.round(dx / info.slotW));
    }

    if (affectsBottom) {
      newRows = Math.max(1, this.resizeStartRows + Math.round(dy / info.slotH));
    } else if (affectsTop) {
      newRows = Math.max(1, this.resizeStartRows - Math.round(dy / info.slotH));
    }

    if (newCols === info.cols && newRows === info.rows) return;

    // compute new position (left/top handles shift the container origin)
    let newX = c.x;
    let newY = c.y;
    if (affectsLeft) {
      newX = c.x + (info.cols - newCols) * info.slotW;
    }
    if (affectsTop) {
      newY = c.y + (info.rows - newRows) * info.slotH;
    }

    // check collision at new bounds
    const newW = newCols * info.slotW;
    const newH = newRows * info.slotH;
    if (this.overlapsExistingExcluding(newX, newY, newW, newH, c)) return;

    // rebuild
    this.doResize(c, newCols, newRows, newX, newY);
  }

  private doResize(c: ContainerLike, cols: number, rows: number, newX: number, newY: number) {
    const createNew = (): ContainerLike => {
      if (c instanceof Grid) return new Grid({ x: newX, y: newY, cols, rows, cellSize: c.cellSize });
      if (c instanceof Shelf) return new Shelf({ x: newX, y: newY, cols, rows });
      if (c instanceof Bin) return new Bin({ x: newX, y: newY, cols, rows });
      throw new Error("unknown container type");
    };

    const idx = this.containers.indexOf(c);
    if (idx < 0) return;
    const parent = c.parent;
    if (!parent) return;

    // preserve occupied cards before destroying old container
    const occupiedCards = c.getOccupiedCards?.() ?? [];
    const positionDelta = { x: newX - c.x, y: newY - c.y };

    this.callbacks.onContainerRemoved(c as Container & DropZoneChecker);
    c.destroy();

    const newC = createNew();
    (newC as any).eventMode = "static";
    parent.addChildAt(newC, 0);
    this.containers[idx] = newC;
    this.callbacks.onContainerAdded(newC as Container & DropZoneChecker);

    // transfer cards: adjust positions by delta and re-register in new container
    const tw = (newC as any).totalWidth ?? 0;
    const th = (newC as any).totalHeight ?? 0;
    for (const card of occupiedCards) {
      card.x += positionDelta.x;
      card.y += positionDelta.y;
      // only re-register if card is still within new container bounds
      const rx = card.x - newX;
      const ry = card.y - newY;
      if (rx >= 0 && rx <= tw && ry >= 0 && ry <= th) {
        newC.occupySlot?.(card.x, card.y, card);
      }
    }

    // update resize target only (keep startCols/Rows from drag start for smooth multi-step resize)
    this.resizeTarget = newC;

    // update selection + handles
    this.selectedContainer = newC;
    newC.setHighlight?.(true);
    // during active resize drag, just reposition handles (don't destroy/recreate, that kills the drag)
    if (this.resizeHandleDragging) {
      this.repositionResizeHandles(newC);
    } else {
      this.showResizeHandles(newC);
    }
  }

  private finishResize() {
    this.resizeHandleDragging = false;
    this.resizeHandleIndex = -1;
    this.resizeTarget = null;
    if (this.selectedContainer) {
      this.showActionBar(this.selectedContainer);
      this.showResizeHandles(this.selectedContainer);
    }
  }

  // -- container creation with snap + collision --

  private createContainer(x: number, y: number, w: number, h: number): boolean {
    let container: ContainerLike | null = null;

    if (this.drawAction === "grid") {
      const cellSize = GRID_CELL_SIZE;
      const cols = Math.max(1, Math.round(w / cellSize));
      const rows = Math.max(1, Math.round(h / cellSize));
      const sw = cols * cellSize;
      const sh = rows * cellSize;
      if (this.overlapsExisting(x, y, sw, sh)) return false;
      container = new Grid({ x, y, cols, rows, cellSize });
    } else if (this.drawAction === "shelf") {
      const cols = Math.max(1, Math.round(w / SHELF_SLOT_W));
      const rows = Math.max(1, Math.round(h / SHELF_SLOT_H));
      const sw = cols * SHELF_SLOT_W;
      const sh = rows * SHELF_SLOT_H;
      if (this.overlapsExisting(x, y, sw, sh)) return false;
      container = new Shelf({ x, y, cols, rows });
    } else if (this.drawAction === "bin") {
      const cols = Math.max(1, Math.round(w / BIN_SLOT_W));
      const rows = Math.max(1, Math.round(h / BIN_SLOT_H));
      const sw = cols * BIN_SLOT_W;
      const sh = rows * BIN_SLOT_H;
      if (this.overlapsExisting(x, y, sw, sh)) return false;
      container = new Bin({ x, y, cols, rows });
    }

    if (container) {
      (container as any).eventMode = "static";
      this.contentParent.addChildAt(container, 0);
      this.containers.push(container);
      this.callbacks.onContainerAdded(container as Container & DropZoneChecker);
      return true;
    }
    return false;
  }

  private placeLabel(px: number, py: number) {
    const label = new FloatingLabel(px, py, "label", true);
    this.contentParent.addChild(label);
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
    if (this.currentMode === "navigate") {
      // don't lasso if clicking on a card
      for (const card of this.cards) {
        const hw = card.width / 2;
        const hh = card.height / 2;
        if (px >= card.x - hw && px <= card.x + hw && py >= card.y - hh && py <= card.y + hh) {
          return;
        }
      }
      // clear previous card selections
      for (const card of this.cards) {
        card.setSelected(false);
      }
    }

    this.lassoActive = true;
    this.lassoPoints = [{ x: px, y: py }];
    this.lassoGraphics = new Graphics();
    this.contentParent.addChild(this.lassoGraphics);
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

    // compute bounding box of lasso trail (world coords)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of this.lassoPoints) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    if (this.currentMode === "edit") {
      // select containers whose bounds overlap the lasso bbox
      this.selectedContainers.clear();
      for (const c of this.containers) {
        const b = c.getGlobalBounds?.() ?? c.getBounds();
        const overlaps =
          b.x + b.width >= minX && b.x <= maxX &&
          b.y + b.height >= minY && b.y <= maxY;
        c.setHighlight?.(overlaps);
        if (overlaps) this.selectedContainers.add(c);
      }
    } else {
      // navigate mode: select cards
      for (const card of this.cards) {
        const hw = card.width / 2;
        const hh = card.height / 2;
        const overlaps =
          card.x + hw >= minX && card.x - hw <= maxX &&
          card.y + hh >= minY && card.y - hh <= maxY;
        card.setSelected(overlaps);
      }
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

  // -- label resize handles (4 corners) --

  private showLabelResizeHandles(label: FloatingLabel) {
    this.removeLabelResizeHandles();
    const b = label.getHitBounds();
    const HANDLE_SIZE = 8;
    const positions = [
      { x: b.x, y: b.y },                  // 0: top-left
      { x: b.x + b.width, y: b.y },        // 1: top-right
      { x: b.x, y: b.y + b.height },       // 2: bottom-left
      { x: b.x + b.width, y: b.y + b.height }, // 3: bottom-right
    ];
    const cursors = ["nwse-resize", "nesw-resize", "nesw-resize", "nwse-resize"];

    for (let i = 0; i < positions.length; i++) {
      const handle = new Graphics();
      handle.rect(-HANDLE_SIZE / 2, -HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE)
        .fill(PixieTheme.accent500)
        .stroke({ width: 1, color: PixieTheme.borderStrong });
      handle.x = positions[i].x;
      handle.y = positions[i].y;
      handle.eventMode = "static";
      handle.cursor = cursors[i];
      const idx = i;
      handle.on("pointerdown", (ev: FederatedPointerEvent) => {
        ev.stopPropagation();
        this.startLabelResize(label, idx, ev);
      });
      this.contentParent.addChild(handle);
      this.labelResizeHandles.push(handle);
    }
  }

  private removeLabelResizeHandles() {
    for (const h of this.labelResizeHandles) h.destroy();
    this.labelResizeHandles = [];
    this.labelResizing = false;
  }

  private startLabelResize(label: FloatingLabel, handleIdx: number, e: FederatedPointerEvent) {
    const pos = e.getLocalPosition(this.contentParent);
    this.labelResizing = true;
    this.labelResizeIndex = handleIdx;
    this.labelResizeStart = {
      x: pos.x, y: pos.y,
      w: label.labelWidth, h: label.labelHeight,
      lx: label.x, ly: label.y,
    };
  }

  private updateLabelResize(px: number, py: number) {
    if (!this.selectedLabel) return;
    const s = this.labelResizeStart;
    const dx = px - s.x;
    const dy = py - s.y;
    const idx = this.labelResizeIndex;

    let newW = s.w;
    let newH = s.h;
    let newX = s.lx;
    let newY = s.ly;

    // 0=TL, 1=TR, 2=BL, 3=BR
    if (idx === 0) { newW = s.w - dx; newH = s.h - dy; newX = s.lx + dx; newY = s.ly + dy; }
    if (idx === 1) { newW = s.w + dx; newH = s.h - dy; newY = s.ly + dy; }
    if (idx === 2) { newW = s.w - dx; newH = s.h + dy; newX = s.lx + dx; }
    if (idx === 3) { newW = s.w + dx; newH = s.h + dy; }

    newW = Math.max(48, snapToGrid(newW));
    newH = Math.max(24, snapToGrid(newH));
    newX = snapToGrid(newX);
    newY = snapToGrid(newY);

    this.selectedLabel.x = newX;
    this.selectedLabel.y = newY;
    this.selectedLabel.setLabelSize(newW, newH);
    this.repositionLabelResizeHandles(this.selectedLabel);
  }

  private repositionLabelResizeHandles(label: FloatingLabel) {
    if (this.labelResizeHandles.length !== 4) return;
    const b = label.getHitBounds();
    const positions = [
      { x: b.x, y: b.y },
      { x: b.x + b.width, y: b.y },
      { x: b.x, y: b.y + b.height },
      { x: b.x + b.width, y: b.y + b.height },
    ];
    for (let i = 0; i < 4; i++) {
      this.labelResizeHandles[i].x = positions[i].x;
      this.labelResizeHandles[i].y = positions[i].y;
    }
  }

  private containsPoint(pos: { x: number; y: number }): boolean {
    // pos is in world coords; toolbar bounds are in screen/global coords
    // convert world pos to screen by subtracting camera offset
    const sx = pos.x - (this.viewport?.scrollX ?? 0);
    const sy = pos.y - (this.viewport?.scrollY ?? 0);
    const bounds = this.getBounds();
    return (
      sx >= bounds.x && sx <= bounds.x + bounds.width &&
      sy >= bounds.y && sy <= bounds.y + bounds.height
    );
  }

  destroy() {
    const eventTarget = this.viewport?.world ?? this.app.stage;
    eventTarget.off("pointerdown", this.onStageDown, this);
    eventTarget.off("pointermove", this.onStageMove, this);
    eventTarget.off("pointerup", this.onStageUp, this);
    this.removeActionBar();
    this.removeResizeHandles();
    this.removeLabelResizeHandles();
    this.closeFlyout();
    super.destroy();
  }
}
