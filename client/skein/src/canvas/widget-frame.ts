import { Container, Graphics, Text, type FederatedPointerEvent } from "pixi.js";
import type { SkeinTheme } from "../theme/skein-theme";
import type { WidgetEntry } from "./canvas-doc";

/**
 * callbacks from the frame to the widget manager.
 * the frame handles interaction (drag, resize, click)
 * and notifies the manager via these callbacks to persist changes.
 */
export interface WidgetFrameCallbacks {
  onSelect: () => void;
  /** shift-click: toggle this widget in the multi-selection */
  onShiftSelect?: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onClose: () => void;
  onCollapse: (collapsed: boolean) => void;
  /** batch drag: emitted when a drag starts (so manager can snapshot positions) */
  onDragStart?: () => void;
  /** batch drag: emitted on every move with the delta from drag start (world coords) */
  onDragDelta?: (dx: number, dy: number) => void;
  /** batch drag: emitted when the drag finishes */
  onDragEnd?: () => void;
}

/**
 * resize handle position identifiers.
 * corners and edge midpoints, 8 total.
 */
type HandlePosition = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/**
 * the widget frame wraps each widget with canvas-managed chrome.
 *
 * in edit mode: full header with name + collapse + close buttons,
 * 8 resize handles (visible on hover/select), selection border,
 * draggable header, rounded corners.
 *
 * in view mode: header is hidden, no resize handles, no rounded corners,
 * no border. events pass through to the widget content.
 *
 * when collapsed: content container is hidden, frame shows only the header.
 */
export class WidgetFrame {
  readonly root: Container;
  readonly contentContainer: Container;

  private readonly theme: SkeinTheme;
  private readonly callbacks: WidgetFrameCallbacks;
  private readonly widgetName: string;

  // visual elements
  private readonly border: Graphics;
  private readonly header: Container;
  private readonly headerBg: Graphics;
  private readonly headerText: Text;
  private readonly collapseBtn: Container;
  private readonly closeBtn: Container;
  private readonly contentMask: Graphics;
  private readonly resizeHandles: Map<HandlePosition, Graphics> = new Map();

  // state
  private _editing = false;
  private _selected = false;
  private _multiSelected = false;
  private _collapsed = false;
  private _hovered = false;
  private _width: number;
  private _height: number;

  // drag state (shared between header drag and body drag)
  private dragging = false;
  private dragStartGlobal = { x: 0, y: 0 };
  private dragStartLocal = { x: 0, y: 0 };

  // invisible hit area covering the full frame for body-drag in multi-select
  private readonly bodyHitArea: Graphics;

  // resize state
  private resizing = false;
  private resizeHandle: HandlePosition | null = null;
  private resizeStartGlobal = { x: 0, y: 0 };
  private resizeStartSize = { w: 0, h: 0 };
  private resizeStartPos = { x: 0, y: 0 };

  constructor(
    entry: WidgetEntry,
    widgetName: string,
    theme: SkeinTheme,
    editing: boolean,
    callbacks: WidgetFrameCallbacks
  ) {
    this.theme = theme;
    this.callbacks = callbacks;
    this.widgetName = widgetName;
    this._width = entry.width;
    this._height = entry.height;
    this._editing = editing;
    this._collapsed = entry.collapsed;

    // root container positioned on the stage
    this.root = new Container();
    this.root.x = entry.x;
    this.root.y = entry.y;
    this.root.zIndex = entry.zIndex;
    this.root.eventMode = "static";

    // track hover state for resize handle and border visibility
    this.root.on("pointerenter", () => {
      this._hovered = true;
      this.updateHandleVisibility();
      this.drawBorder();
    });
    this.root.on("pointerleave", () => {
      this._hovered = false;
      this.updateHandleVisibility();
      this.drawBorder();
    });

    // border/selection overlay (drawn behind everything)
    this.border = new Graphics();
    this.root.addChild(this.border);

    // header bar
    this.header = new Container();
    this.header.y = 0;
    this.root.addChild(this.header);

    this.headerBg = new Graphics();
    this.header.addChild(this.headerBg);

    this.headerText = new Text({
      text: this.widgetName,
      resolution: theme.textResolution,
      style: {
        fontFamily: theme.fontFamily,
        fontSize: theme.fontSizeSmall,
        fill: theme.frameHeaderText,
      },
    });
    this.headerText.x = 8;
    this.headerText.anchor.set(0, 0.5);
    this.headerText.y = theme.frameHeaderHeight / 2;
    this.header.addChild(this.headerText);

    // collapse button
    this.collapseBtn = this.createHeaderButton(this._collapsed ? "+" : "-", theme);
    this.header.addChild(this.collapseBtn);

    // close button
    this.closeBtn = this.createHeaderButton("x", theme);
    this.header.addChild(this.closeBtn);

    // invisible hit area for body-drag when multi-selected.
    // sits behind the content container so it catches clicks on the
    // widget body area. only interactive when _multiSelected is true.
    this.bodyHitArea = new Graphics();
    this.bodyHitArea.eventMode = "none";
    this.root.addChild(this.bodyHitArea);

    // content container (below the header)
    this.contentContainer = new Container();
    this.contentContainer.y = theme.frameHeaderHeight;
    this.root.addChild(this.contentContainer);

    // rectangular mask for the content container — clips widget-drawn
    // rounded corners so they don't show against the canvas background
    // in view mode. in edit mode the frame chrome provides visual framing
    // so the mask uses a matching corner radius.
    this.contentMask = new Graphics();
    this.root.addChild(this.contentMask);
    this.contentContainer.mask = this.contentMask;

    // create resize handles
    this.createResizeHandles();

    // set up interaction events
    this.setupHeaderInteraction();
    this.setupBodyDragInteraction();
    this.setupButtonInteraction();

    // initial draw
    this.draw();
    this.applyMode();
  }

  /** switch between edit and view mode */
  setEditMode(editing: boolean): void {
    if (this._editing === editing) return;
    this._editing = editing;
    if (!editing) {
      this._selected = false;
    }
    this.applyMode();
    // full redraw — header needs to be redrawn so its hit area exists
    // when switching from view to edit mode (it was cleared in view mode)
    this.draw();
  }

  /** set whether this frame is selected (single or multi) */
  setSelected(selected: boolean): void {
    if (this._selected === selected) return;
    this._selected = selected;
    this.updateHandleVisibility();
    this.drawBorder();
  }

  /**
   * set whether this frame is part of a multi-widget selection.
   * when multi-selected, the entire frame body becomes draggable
   * (not just the header), and resize handles are hidden.
   */
  setMultiSelected(multi: boolean): void {
    if (this._multiSelected === multi) return;
    this._multiSelected = multi;
    this.updateHandleVisibility();
    this.updateBodyHitArea();
  }

  /** update position on the stage */
  setPosition(x: number, y: number): void {
    this.root.x = x;
    this.root.y = y;
  }

  /** update z-index */
  setZIndex(zIndex: number): void {
    this.root.zIndex = zIndex;
  }

  /** set collapsed state */
  setCollapsed(collapsed: boolean): void {
    this._collapsed = collapsed;
    this.contentContainer.visible = !collapsed;
    this.updateCollapseButton();
    this.applyMode();
    this.draw();
  }

  /** update the frame dimensions (e.g., after store resizeWidget) */
  updateSize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    this.draw();
  }

  /** clean up all pixi objects */
  destroy(): void {
    this.root.destroy({ children: true });
  }

  // --- drawing ---

  private draw(): void {
    this.drawHeader();
    this.drawBorder();
    this.drawContentMask();
    this.positionResizeHandles();
    this.positionButtons();
    this.updateBodyHitArea();
  }

  private drawHeader(): void {
    const w = this._width;
    const h = this.theme.frameHeaderHeight;
    const r = this._editing ? this.theme.frameCornerRadius : 0;

    this.headerBg.clear();
    if (!this._editing) {
      // no header drawn in view mode
      return;
    }
    // rounded top corners, flat bottom
    this.headerBg.moveTo(r, 0);
    this.headerBg.lineTo(w - r, 0);
    this.headerBg.arcTo(w, 0, w, r, r);
    this.headerBg.lineTo(w, h);
    this.headerBg.lineTo(0, h);
    this.headerBg.lineTo(0, r);
    this.headerBg.arcTo(0, 0, r, 0, r);
    this.headerBg.closePath();
    this.headerBg.fill({ color: this.theme.frameHeaderBg });
  }

  private drawBorder(): void {
    const w = this._width;
    const hdr = this.theme.frameHeaderHeight;
    const r = this._editing ? this.theme.frameCornerRadius : 0;

    this.border.clear();

    if (!this._editing) {
      // no border in view mode — widgets render edge-to-edge
      return;
    }

    const totalH = this._collapsed ? hdr : hdr + this._height;

    const borderColor = this._selected
      ? this.theme.frameBorderSelected
      : this._hovered && this._editing
        ? this.theme.frameBorderHover
        : this.theme.frameBorder;

    this.border.roundRect(0, 0, w, totalH, r);
    this.border.stroke({ color: borderColor, width: this._selected ? 2 : 1 });
  }

  /** redraw the content mask to match current dimensions and mode. */
  private drawContentMask(): void {
    const y = this._editing ? this.theme.frameHeaderHeight : 0;
    const r = this._editing ? this.theme.frameCornerRadius : 0;
    this.contentMask.clear();
    if (r > 0) {
      // in edit mode, use rounded bottom corners matching the frame
      this.contentMask.moveTo(0, y);
      this.contentMask.lineTo(this._width, y);
      this.contentMask.lineTo(this._width, y + this._height - r);
      this.contentMask.arcTo(this._width, y + this._height, this._width - r, y + this._height, r);
      this.contentMask.lineTo(r, y + this._height);
      this.contentMask.arcTo(0, y + this._height, 0, y + this._height - r, r);
      this.contentMask.lineTo(0, y);
      this.contentMask.closePath();
      this.contentMask.fill({ color: 0xffffff });
    } else {
      // in view mode, sharp rectangle — clips any widget-drawn rounded corners
      this.contentMask.rect(0, y, this._width, this._height);
      this.contentMask.fill({ color: 0xffffff });
    }
  }

  private positionButtons(): void {
    const w = this._width;
    const btnSize = this.theme.frameHeaderHeight - 8;
    this.closeBtn.x = w - btnSize - 4;
    this.closeBtn.y = 4;
    this.collapseBtn.x = w - (btnSize + 4) * 2;
    this.collapseBtn.y = 4;
  }

  private updateCollapseButton(): void {
    const text = this.collapseBtn.getChildAt(1) as Text;
    text.text = this._collapsed ? "+" : "-";
  }

  // --- resize handles ---

  private createResizeHandles(): void {
    const positions: HandlePosition[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
    for (const pos of positions) {
      const handle = new Graphics();
      handle.eventMode = "static";
      handle.cursor = this.cursorForHandle(pos);
      this.resizeHandles.set(pos, handle);
      this.root.addChild(handle);

      // interaction
      handle.on("pointerdown", (e: FederatedPointerEvent) => {
        if (!this._editing) return;
        e.stopPropagation();
        this.resizing = true;
        this.resizeHandle = pos;
        this.resizeStartGlobal = { x: e.global.x, y: e.global.y };
        this.resizeStartSize = { w: this._width, h: this._height };
        this.resizeStartPos = { x: this.root.x, y: this.root.y };
      });

      handle.on("globalpointermove", (e: FederatedPointerEvent) => {
        if (!this.resizing || this.resizeHandle !== pos) return;
        this.onResizeMove(e);
      });

      handle.on("pointerup", () => {
        if (!this.resizing || this.resizeHandle !== pos) return;
        this.finishResize();
      });

      handle.on("pointerupoutside", () => {
        if (!this.resizing || this.resizeHandle !== pos) return;
        this.finishResize();
      });
    }
  }

  private positionResizeHandles(): void {
    const s = this.theme.resizeHandleSize;
    const w = this._width;
    const hdr = this.theme.frameHeaderHeight;
    const totalH = this._collapsed ? hdr : hdr + this._height;

    const positions: Record<HandlePosition, { x: number; y: number }> = {
      nw: { x: -s / 2, y: -s / 2 },
      n: { x: w / 2 - s / 2, y: -s / 2 },
      ne: { x: w - s / 2, y: -s / 2 },
      e: { x: w - s / 2, y: totalH / 2 - s / 2 },
      se: { x: w - s / 2, y: totalH - s / 2 },
      s: { x: w / 2 - s / 2, y: totalH - s / 2 },
      sw: { x: -s / 2, y: totalH - s / 2 },
      w: { x: -s / 2, y: totalH / 2 - s / 2 },
    };

    for (const [pos, handle] of this.resizeHandles) {
      const p = positions[pos];
      handle.clear();
      handle.roundRect(0, 0, s, s, 2);
      handle.fill({ color: this.theme.frameResizeHandle });
      handle.x = p.x;
      handle.y = p.y;
    }
  }

  private cursorForHandle(pos: HandlePosition): string {
    const cursors: Record<HandlePosition, string> = {
      nw: "nwse-resize",
      n: "ns-resize",
      ne: "nesw-resize",
      e: "ew-resize",
      se: "nwse-resize",
      s: "ns-resize",
      sw: "nesw-resize",
      w: "ew-resize",
    };
    return cursors[pos];
  }

  private onResizeMove(e: FederatedPointerEvent): void {
    const zoom = this.root.parent?.scale.x ?? 1;
    const dx = (e.global.x - this.resizeStartGlobal.x) / zoom;
    const dy = (e.global.y - this.resizeStartGlobal.y) / zoom;
    const handle = this.resizeHandle!;
    const minW = 60;
    const minH = 40;

    let newW = this.resizeStartSize.w;
    let newH = this.resizeStartSize.h;
    let newX = this.resizeStartPos.x;
    let newY = this.resizeStartPos.y;

    // east edge
    if (handle.includes("e")) {
      newW = Math.max(minW, this.resizeStartSize.w + dx);
    }
    // west edge
    if (handle.includes("w")) {
      const candidateW = this.resizeStartSize.w - dx;
      if (candidateW >= minW) {
        newW = candidateW;
        newX = this.resizeStartPos.x + dx;
      }
    }
    // south edge
    if (handle.includes("s")) {
      newH = Math.max(minH, this.resizeStartSize.h + dy);
    }
    // north edge
    if (handle.includes("n")) {
      const candidateH = this.resizeStartSize.h - dy;
      if (candidateH >= minH) {
        newH = candidateH;
        newY = this.resizeStartPos.y + dy;
      }
    }

    this._width = newW;
    this._height = newH;
    this.root.x = newX;
    this.root.y = newY;
    this.draw();
  }

  private finishResize(): void {
    this.resizing = false;
    this.resizeHandle = null;
    this.callbacks.onResize(this._width, this._height);
    // also commit position if it changed (nw, n, ne, w, sw handles move origin)
    this.callbacks.onMove(this.root.x, this.root.y);
  }

  // --- header interaction (drag to move, click to select) ---

  private setupHeaderInteraction(): void {
    this.headerBg.eventMode = "static";
    this.headerBg.cursor = "grab";

    this.headerBg.on("pointerdown", (e: FederatedPointerEvent) => {
      if (!this._editing) return;
      e.stopPropagation();

      // shift-click toggles multi-selection; regular click does single-select
      if (e.shiftKey && this.callbacks.onShiftSelect) {
        this.callbacks.onShiftSelect();
      } else {
        this.callbacks.onSelect();
      }

      this.startDrag(e);
    });

    this.headerBg.on("globalpointermove", (e: FederatedPointerEvent) => {
      if (!this.dragging) return;
      this.updateDrag(e);
    });

    this.headerBg.on("pointerup", () => {
      if (!this.dragging) return;
      this.finishDrag();
    });

    this.headerBg.on("pointerupoutside", () => {
      if (!this.dragging) return;
      this.finishDrag();
    });
  }

  /**
   * set up an invisible body-level hit area for dragging multi-selected
   * widgets from anywhere on the widget, not just the header. the hit
   * area is only interactive when _multiSelected is true.
   */
  private setupBodyDragInteraction(): void {
    this.bodyHitArea.on("pointerdown", (e: FederatedPointerEvent) => {
      if (!this._editing || !this._multiSelected) return;
      e.stopPropagation();
      this.startDrag(e);
    });

    this.bodyHitArea.on("globalpointermove", (e: FederatedPointerEvent) => {
      if (!this.dragging) return;
      this.updateDrag(e);
    });

    this.bodyHitArea.on("pointerup", () => {
      if (!this.dragging) return;
      this.finishDrag();
    });

    this.bodyHitArea.on("pointerupoutside", () => {
      if (!this.dragging) return;
      this.finishDrag();
    });
  }

  /** redraw the body hit area to match current frame dimensions */
  private updateBodyHitArea(): void {
    this.bodyHitArea.clear();

    if (!this._multiSelected || !this._editing || this._collapsed) {
      this.bodyHitArea.eventMode = "none";
      this.bodyHitArea.cursor = "default";
      return;
    }

    const hdr = this.theme.frameHeaderHeight;
    const totalH = hdr + this._height;
    // draw an invisible rect covering the full frame area
    this.bodyHitArea.rect(0, 0, this._width, totalH);
    this.bodyHitArea.fill({ color: 0x000000, alpha: 0 });
    this.bodyHitArea.eventMode = "static";
    this.bodyHitArea.cursor = "grab";
  }

  // --- shared drag helpers (used by both header drag and body drag) ---

  private startDrag(e: FederatedPointerEvent): void {
    this.dragging = true;
    this.dragStartGlobal = { x: e.global.x, y: e.global.y };
    this.dragStartLocal = { x: this.root.x, y: this.root.y };
    this.headerBg.cursor = "grabbing";
    this.bodyHitArea.cursor = "grabbing";

    // notify manager so it can snapshot positions for batch drag
    this.callbacks.onDragStart?.();
  }

  private updateDrag(e: FederatedPointerEvent): void {
    const zoom = this.root.parent?.scale.x ?? 1;
    const dx = (e.global.x - this.dragStartGlobal.x) / zoom;
    const dy = (e.global.y - this.dragStartGlobal.y) / zoom;
    this.root.x = this.dragStartLocal.x + dx;
    this.root.y = this.dragStartLocal.y + dy;

    // emit delta for batch drag of other selected widgets
    this.callbacks.onDragDelta?.(dx, dy);
  }

  private finishDrag(): void {
    this.dragging = false;
    this.headerBg.cursor = "grab";
    this.bodyHitArea.cursor = this._multiSelected ? "grab" : "default";
    this.callbacks.onDragEnd?.();
    this.callbacks.onMove(this.root.x, this.root.y);
  }

  // --- button interaction ---

  private setupButtonInteraction(): void {
    // collapse button
    const collapseBg = this.collapseBtn.getChildAt(0) as Graphics;
    collapseBg.eventMode = "static";
    collapseBg.cursor = "pointer";
    collapseBg.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.callbacks.onCollapse(!this._collapsed);
    });

    // close button
    const closeBg = this.closeBtn.getChildAt(0) as Graphics;
    closeBg.eventMode = "static";
    closeBg.cursor = "pointer";
    closeBg.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.callbacks.onClose();
    });
  }

  private createHeaderButton(label: string, theme: SkeinTheme): Container {
    const btnSize = theme.frameHeaderHeight - 8;
    const container = new Container();

    const bg = new Graphics();
    bg.roundRect(0, 0, btnSize, btnSize, 3);
    bg.fill({ color: theme.frameBorder });
    container.addChild(bg);

    const text = new Text({
      text: label,
      resolution: theme.textResolution,
      style: {
        fontFamily: theme.fontFamily,
        fontSize: theme.fontSizeSmall,
        fill: theme.frameHeaderText,
      },
    });
    text.anchor.set(0.5);
    text.x = btnSize / 2;
    text.y = btnSize / 2;
    container.addChild(text);

    return container;
  }

  // --- mode management ---

  private updateHandleVisibility(): void {
    // resize handles visible only when selected (not just hovered) and
    // not during multi-select (multi-select is for moving, not resizing)
    const show = this._editing && !this._collapsed && this._selected && !this._multiSelected;
    for (const handle of this.resizeHandles.values()) {
      handle.visible = show;
    }
  }

  private applyMode(): void {
    // resize handles: visible only in edit mode, selected, and not multi-selected
    this.updateHandleVisibility();

    // header: entirely hidden in view mode, fully visible in edit mode
    this.header.visible = this._editing;

    // header buttons: visible only in edit mode
    this.collapseBtn.visible = this._editing;
    this.closeBtn.visible = this._editing;

    // header interactivity
    this.headerBg.eventMode = this._editing ? "static" : "none";
    this.headerBg.cursor = this._editing ? "grab" : "default";

    // content container position: sits below header in edit mode,
    // flush to top in view mode (no header taking up space)
    this.contentContainer.y = this._editing ? this.theme.frameHeaderHeight : 0;

    // content container interactivity
    // in edit mode: widgets are inert (canvas intercepts events)
    // in view mode: widgets receive events
    this.contentContainer.eventMode = this._editing ? "none" : "auto";
    this.contentContainer.interactiveChildren = !this._editing;

    // update body hit area for multi-select drag
    this.updateBodyHitArea();
  }
}
