import { Container, Graphics, Rectangle, Text, type FederatedPointerEvent } from "pixi.js";
import type { SkeinTheme } from "../theme/skein-theme";
import type { HeaderAction } from "../widgets/widget-types";
import type { WidgetEntry } from "./canvas-doc";

/** snap a value to the nearest grid line */
function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

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
  onMaximize?: () => void;
  onRestore?: () => void;
  /** z-order: bring this widget to the front of all others */
  onBringToFront?: () => void;
  /** z-order: move this widget one layer forward */
  onBringForward?: () => void;
  /** z-order: move this widget one layer backward */
  onSendBackward?: () => void;
  /** z-order: send this widget to the back of all others */
  onSendToBack?: () => void;
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
 * chrome visibility is driven by hover and selection state:
 * - when hovered, selected, multi-selected, or collapsed the header,
 *   border, and buttons are shown.
 * - when none of those conditions hold, chrome is hidden and events
 *   pass through to the widget content.
 * - resize handles appear only when single-selected (not collapsed).
 * - content is made inert (non-interactive) when selected or
 *   multi-selected so the canvas can handle drag/resize.
 *
 * when collapsed: content container is hidden, frame shows only the header.
 */
export class WidgetFrame {
  private static readonly HOVER_GRACE_MS = 450;

  readonly root: Container;
  readonly contentContainer: Container;

  private readonly theme: SkeinTheme;
  private readonly callbacks: WidgetFrameCallbacks;
  private readonly widgetName: string;

  // title support — entry.title overrides widgetName in the header
  private _title = "";

  // visual elements
  private readonly border: Graphics;
  private readonly header: Container;
  private readonly headerBg: Graphics;
  private readonly headerText: Text;
  private readonly hamburgerBtn: Container;
  private hamburgerFlyout: Container | null = null;
  private _layerPosition = 0;
  private _layerTotal = 0;
  private readonly collapseBtn: Container;
  private readonly maximizeBtn: Container;
  private readonly contentMask: Graphics;
  private readonly editOverlay: Graphics;
  private readonly resizeHandles: Map<HandlePosition, Graphics> = new Map();

  // custom header actions injected by widgets
  private customActions: HeaderAction[] = [];
  private customActionContainers: Container[] = [];
  private overflowActions: HeaderAction[] = [];

  // state
  private _destroyed = false;
  private _selected = false;
  private _multiSelected = false;
  private _collapsed = false;
  private _hovered = false;
  private _maximized = false;
  private _lassoActive = false;
  private _hoverGraceTimer: ReturnType<typeof setTimeout> | null = null;
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
    callbacks: WidgetFrameCallbacks
  ) {
    this.theme = theme;
    this.callbacks = callbacks;
    this.widgetName = widgetName;
    this._title = entry.title ?? "";
    this._width = entry.width;
    this._height = entry.height;
    this._collapsed = entry.collapsed;

    // root container positioned on the stage
    this.root = new Container();
    this.root.x = entry.x;
    this.root.y = entry.y;
    this.root.zIndex = entry.zIndex;
    this.root.eventMode = "static";
    this.root.sortableChildren = true;

    // track hover state for chrome visibility
    this.root.on("pointerenter", () => {
      if (this._hoverGraceTimer !== null) {
        clearTimeout(this._hoverGraceTimer);
        this._hoverGraceTimer = null;
      }
      this._hovered = true;
      this.updateVisualState();
      this.draw();
    });

    this.root.on("pointerleave", () => {
      // if selected or collapsed, chrome stays — no grace timer needed
      if (this._selected || this._multiSelected || this._collapsed) {
        return;
      }
      // start grace timer so user can move from content to header
      this._hoverGraceTimer = setTimeout(() => {
        this._hoverGraceTimer = null;
        this._hovered = false;
        this.updateVisualState();
        this.draw();
      }, WidgetFrame.HOVER_GRACE_MS);
    });

    // border/selection overlay (drawn behind everything)
    this.border = new Graphics();
    this.root.addChild(this.border);

    // header bar — positioned above the content area so it doesn't
    // cover widget content. sits at negative y so the content stays
    // at y=0 (no position shift).
    this.header = new Container();
    this.header.y = -theme.frameHeaderHeight;
    this.root.addChild(this.header);

    this.headerBg = new Graphics();
    this.header.addChild(this.headerBg);

    this.headerText = new Text({
      text: this._title || this.widgetName,
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
    this.headerText.eventMode = "none";
    this.header.addChild(this.headerText);

    // collapse button
    this.collapseBtn = this.createHeaderButton(this._collapsed ? "+" : "-", theme);
    this.header.addChild(this.collapseBtn);

    // maximize button
    this.maximizeBtn = this.createHeaderButton("\u2922", theme);
    this.header.addChild(this.maximizeBtn);

    // hamburger button — opens a flyout with z-order controls and overflow actions
    this.hamburgerBtn = this.createHeaderButton("\u2261", theme);
    this.header.addChild(this.hamburgerBtn);

    // invisible hit area for body-drag when multi-selected.
    // sits behind the content container so it catches clicks on the
    // widget body area. only interactive when _multiSelected is true.
    this.bodyHitArea = new Graphics();
    this.bodyHitArea.eventMode = "none";
    this.root.addChild(this.bodyHitArea);

    // content container (below the header)
    this.contentContainer = new Container();
    this.contentContainer.y = 0;
    this.root.addChild(this.contentContainer);

    // rectangular mask for the content container — clips widget-drawn
    // rounded corners so they don't show against the canvas background.
    // when chrome is visible the mask uses a matching corner radius.
    this.contentMask = new Graphics();
    this.root.addChild(this.contentMask);
    this.contentContainer.mask = this.contentMask;

    // dark semi-transparent overlay drawn on top of widget content when
    // selected/multi-selected so it's visually obvious that content is
    // non-interactive.
    this.editOverlay = new Graphics();
    this.editOverlay.eventMode = "none";
    this.editOverlay.visible = false;
    this.root.addChild(this.editOverlay);

    // create resize handles
    this.createResizeHandles();

    // set up interaction events
    this.setupHeaderInteraction();
    this.setupBodyDragInteraction();
    this.setupButtonInteraction();

    // initial draw
    this.draw();
    this.updateVisualState();
  }

  /** update the display title shown in the header */
  setTitle(title: string): void {
    this._title = title;
    this.headerText.text = this._title || this.widgetName;
  }

  /** set custom header actions injected by the widget */
  setCustomActions(actions: HeaderAction[]): void {
    // destroy existing action containers
    for (const c of this.customActionContainers) {
      this.header.removeChild(c);
      c.destroy({ children: true });
    }
    this.customActionContainers = [];
    this.overflowActions = [];

    // store new actions
    this.customActions = actions;

    // create containers for each action
    for (const action of actions) {
      const container = this.createActionButton(action);
      this.customActionContainers.push(container);
      this.header.addChild(container);
    }

    // reposition everything
    this.draw();
  }

  /** set whether this frame is selected (single or multi) */
  setSelected(selected: boolean): void {
    if (this._selected === selected) return;
    this._selected = selected;
    this.updateVisualState();
    this.draw();
  }

  /**
   * set whether this frame is part of a multi-widget selection.
   * when multi-selected, the entire frame body becomes draggable
   * (not just the header), and resize handles are hidden.
   */
  setMultiSelected(multi: boolean): void {
    if (this._multiSelected === multi) return;
    this._multiSelected = multi;
    this.updateVisualState();
    this.draw();
  }

  /** temporarily make this frame inert during lasso selection */
  setLassoActive(active: boolean): void {
    if (this._lassoActive === active) return;
    this._lassoActive = active;
    this.updateVisualState();
    this.draw();
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
    this.updateVisualState();
    this.draw();
  }

  /** enter or leave maximized state. when maximized, chrome (header, border,
   *  resize handles) is hidden and drag is disabled. the widget manager
   *  controls sizing and positioning externally. */
  setMaximized(maximized: boolean): void {
    this._maximized = maximized;
    this.draw();
    this.updateVisualState();
  }

  /** whether this frame is currently in maximized mode */
  get maximized(): boolean {
    return this._maximized;
  }

  /** update the frame dimensions (e.g., after store resizeWidget) */
  updateSize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    this.draw();
  }

  /** clean up all pixi objects */
  destroy(): void {
    this._destroyed = true;
    if (this._hoverGraceTimer !== null) {
      clearTimeout(this._hoverGraceTimer);
      this._hoverGraceTimer = null;
    }
    this.hideHamburgerFlyout();
    this.root.destroy({ children: true });
  }

  // --- drawing ---

  private draw(): void {
    this.drawHeader();
    this.drawBorder();
    this.drawContentMask();
    this.drawEditOverlay();
    this.positionResizeHandles();
    this.positionButtons();
    this.updateBodyHitArea();
  }

  private drawHeader(): void {
    if (this._maximized) {
      if (!this._hovered) {
        this.headerBg.clear();
        return;
      }
      // opaque header — it sits above the content, not overlaying it
      const w = this._width;
      const h = this.theme.frameHeaderHeight;
      this.headerBg.clear();
      this.headerBg.rect(0, 0, w, h);
      this.headerBg.fill({ color: this.theme.frameHeaderBg });
      return;
    }
    const w = this._width;
    const h = this.theme.frameHeaderHeight;
    const showChrome = this._collapsed || this._hovered || this._selected || this._multiSelected;
    const r = showChrome ? this.theme.frameCornerRadius : 0;

    this.headerBg.clear();
    if (!showChrome) {
      // no header drawn when chrome is hidden
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
    // no border in maximized mode
    if (this._maximized) {
      this.border.clear();
      return;
    }
    const w = this._width;
    const hdr = this.theme.frameHeaderHeight;
    const showChrome = this._collapsed || this._hovered || this._selected || this._multiSelected;
    const r = showChrome ? this.theme.frameCornerRadius : 0;

    this.border.clear();

    if (!showChrome) {
      // no border when chrome is hidden — widgets render edge-to-edge
      return;
    }

    const totalH = this._collapsed ? hdr : hdr + this._height;

    const borderColor = this._selected
      ? this.theme.frameBorderSelected
      : this.theme.frameBorderHover;

    this.border.roundRect(0, -hdr, w, totalH, r);
    this.border.stroke({ color: borderColor, width: this._selected ? 2 : 1 });
  }

  /** redraw the dark overlay shown on top of content when selected/multi-selected. */
  private drawEditOverlay(): void {
    // no edit overlay in maximized mode
    if (this._maximized) {
      this.editOverlay.visible = false;
      return;
    }
    this.editOverlay.clear();
    const isInert = this._lassoActive || this._multiSelected;
    if (!isInert || this._collapsed) {
      this.editOverlay.visible = false;
      return;
    }
    const r = this.theme.frameCornerRadius;
    this.editOverlay.roundRect(0, 0, this._width, this._height, r);
    this.editOverlay.fill({ color: 0x000000, alpha: 0.8 });
    this.editOverlay.visible = true;
  }

  /** redraw the content mask to match current dimensions and state. */
  private drawContentMask(): void {
    const y = 0;
    const showChrome = this._collapsed || this._hovered || this._selected || this._multiSelected;
    const r = showChrome ? this.theme.frameCornerRadius : 0;
    this.contentMask.clear();
    if (r > 0) {
      // when chrome is visible, use rounded bottom corners matching the frame
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
      // no chrome — sharp rectangle clips any widget-drawn rounded corners
      this.contentMask.rect(0, y, this._width, this._height);
      this.contentMask.fill({ color: 0xffffff });
    }
  }

  /**
   * responsive header layout:
   * [title text          ] [custom actions...] [collapse] [maximize] [hamburger]
   *
   * system buttons are positioned from the right edge.
   * custom actions fill the space between the title and system buttons.
   * actions that don't fit overflow into the hamburger flyout.
   */
  private positionButtons(): void {
    const w = this._width;
    const btnSize = this.theme.frameHeaderHeight - 8;
    const btnSlot = btnSize + 4; // width of one system button slot

    // position system buttons from right to left, skipping hidden ones
    const systemButtons = [this.hamburgerBtn, this.maximizeBtn, this.collapseBtn];
    let btnX = w;
    let visibleSystemCount = 0;
    for (const btn of systemButtons) {
      if (!btn.visible) continue;
      btnX -= btnSlot;
      btn.x = btnX;
      btn.y = 4;
      visibleSystemCount++;
    }
    const systemButtonsWidth = visibleSystemCount * btnSlot;
    const titleMinWidth = 60;
    const availableForActions = w - titleMinWidth - systemButtonsWidth;

    // walk custom actions left-to-right, measuring which fit
    let usedWidth = 0;
    let firstOverflowIndex = this.customActions.length; // assume all fit

    for (let i = 0; i < this.customActions.length; i++) {
      const actionWidth = this.measureActionWidth(this.customActions[i]);

      if (usedWidth + actionWidth > availableForActions) {
        firstOverflowIndex = i;
        break;
      }
      usedWidth += actionWidth;
    }

    // set overflow actions
    this.overflowActions = this.customActions.slice(firstOverflowIndex);

    // position fitting action containers from right-to-left, left of collapse button
    const actionsRightEdge = w - systemButtonsWidth;
    let actionX = actionsRightEdge;

    // position in reverse so rightmost fitting action is nearest to system buttons
    for (let i = firstOverflowIndex - 1; i >= 0; i--) {
      const container = this.customActionContainers[i];
      const actionWidth = this.measureActionWidth(this.customActions[i]);
      actionX -= actionWidth;
      container.x = actionX;
      container.y = 4;
      container.visible = true;
    }

    // hide overflow action containers
    for (let i = firstOverflowIndex; i < this.customActionContainers.length; i++) {
      this.customActionContainers[i].visible = false;
    }

    // clip title text so it doesn't overlap actions
    const titleMaxWidth = Math.max(20, actionX - 8 - 8); // 8px left padding + 8px gap
    this.headerText.style.wordWrap = false;
    // use a simple width clamp — pixi Text doesn't have native maxWidth,
    // but we can use the content mask on the header or set the text scale
    if (this.headerText.width > titleMaxWidth) {
      this.headerText.scale.x = titleMaxWidth / this.headerText.width;
    } else {
      this.headerText.scale.x = 1;
    }
  }

  /** measure the display width of a custom action button */
  private measureActionWidth(action: HeaderAction): number {
    // measure text width by creating a temporary text, or estimate from label length.
    // for consistency, use fontSize * charCount * 0.6 + padding as a rough estimate,
    // then we refine with actual container width if available.
    const charWidth = this.theme.fontSizeSmall * 0.6;
    const textWidth = action.label.length * charWidth;
    const padding = 24; // 12px each side
    return textWidth + padding;
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
        if (!this._selected) return;
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
    const top = -hdr;

    const positions: Record<HandlePosition, { x: number; y: number }> = {
      nw: { x: -s / 2, y: top - s / 2 },
      n: { x: w / 2 - s / 2, y: top - s / 2 },
      ne: { x: w - s / 2, y: top - s / 2 },
      e: { x: w - s / 2, y: top + totalH / 2 - s / 2 },
      se: { x: w - s / 2, y: top + totalH - s / 2 },
      s: { x: w / 2 - s / 2, y: top + totalH - s / 2 },
      sw: { x: -s / 2, y: top + totalH - s / 2 },
      w: { x: -s / 2, y: top + totalH / 2 - s / 2 },
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

    // snap size and position to grid
    const g = this.theme.gridSize;
    this._width = snapToGrid(this._width, g);
    this._height = snapToGrid(this._height, g);
    this.root.x = snapToGrid(this.root.x, g);
    this.root.y = snapToGrid(this.root.y, g);
    this.draw();

    this.callbacks.onResize(this._width, this._height);
    // also commit position if it changed (nw, n, ne, w, sw handles move origin)
    this.callbacks.onMove(this.root.x, this.root.y);
  }

  // --- header interaction (drag to move, click to select) ---

  private setupHeaderInteraction(): void {
    this.headerBg.eventMode = "static";
    this.headerBg.cursor = "grab";

    this.headerBg.on("pointerdown", (e: FederatedPointerEvent) => {
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
      if (this._destroyed || !this.dragging) return;
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
      if (!this._multiSelected) return;
      e.stopPropagation();
      this.startDrag(e);
    });

    this.bodyHitArea.on("globalpointermove", (e: FederatedPointerEvent) => {
      if (this._destroyed || !this.dragging) return;
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

    if (!this._multiSelected || this._collapsed) {
      this.bodyHitArea.eventMode = "none";
      this.bodyHitArea.cursor = "default";
      return;
    }

    const hdr = this.theme.frameHeaderHeight;
    const totalH = this._collapsed ? hdr : hdr + this._height;
    // draw an invisible rect covering the full frame area (including header above)
    this.bodyHitArea.rect(0, -hdr, this._width, totalH);
    this.bodyHitArea.fill({ color: 0x000000, alpha: 0 });
    this.bodyHitArea.eventMode = "static";
    this.bodyHitArea.cursor = "grab";
  }

  // --- shared drag helpers (used by both header drag and body drag) ---

  private startDrag(e: FederatedPointerEvent): void {
    if (this._destroyed) return;
    this.dragging = true;
    this.dragStartGlobal = { x: e.global.x, y: e.global.y };
    this.dragStartLocal = { x: this.root.x, y: this.root.y };
    this.headerBg.cursor = "grabbing";
    this.bodyHitArea.cursor = "grabbing";

    // notify manager so it can snapshot positions for batch drag
    this.callbacks.onDragStart?.();
  }

  private updateDrag(e: FederatedPointerEvent): void {
    if (this._destroyed) return;
    const zoom = this.root.parent?.scale.x ?? 1;
    const dx = (e.global.x - this.dragStartGlobal.x) / zoom;
    const dy = (e.global.y - this.dragStartGlobal.y) / zoom;
    this.root.x = this.dragStartLocal.x + dx;
    this.root.y = this.dragStartLocal.y + dy;

    // emit delta for batch drag of other selected widgets
    this.callbacks.onDragDelta?.(dx, dy);
  }

  private finishDrag(): void {
    if (this._destroyed) return;
    this.dragging = false;
    this.headerBg.cursor = "grab";
    this.bodyHitArea.cursor = this._multiSelected ? "grab" : "default";

    // snap final position to grid
    const g = this.theme.gridSize;
    this.root.x = snapToGrid(this.root.x, g);
    this.root.y = snapToGrid(this.root.y, g);

    this.callbacks.onDragEnd?.();
    // re-check: onDragEnd may trigger a drop that unmounts this widget and
    // destroys this frame (e.g. widget dropped into a bin). bail out so we
    // don't access the destroyed root container.
    if (this._destroyed) return;
    this.callbacks.onMove(this.root.x, this.root.y);
  }

  // --- button interaction ---

  private setupButtonInteraction(): void {
    // hamburger button — toggle flyout
    const hamburgerBg = this.hamburgerBtn.getChildAt(0) as Graphics;
    hamburgerBg.eventMode = "static";
    hamburgerBg.cursor = "pointer";
    hamburgerBg.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      if (this.hamburgerFlyout) {
        this.hideHamburgerFlyout();
      } else {
        this.showHamburgerFlyout();
      }
    });

    // collapse button
    const collapseBg = this.collapseBtn.getChildAt(0) as Graphics;
    collapseBg.eventMode = "static";
    collapseBg.cursor = "pointer";
    collapseBg.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.callbacks.onCollapse(!this._collapsed);
    });

    // maximize button
    const maximizeBg = this.maximizeBtn.getChildAt(0) as Graphics;
    maximizeBg.eventMode = "static";
    maximizeBg.cursor = "pointer";
    maximizeBg.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      if (this._maximized) {
        this.callbacks.onRestore?.();
      } else {
        this.callbacks.onMaximize?.();
      }
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
    text.eventMode = "none"; // transparent to pointer events so clicks reach the button bg
    container.addChild(text);

    return container;
  }

  /** create a custom action button or info badge for the header */
  private createActionButton(action: HeaderAction): Container {
    const btnHeight = this.theme.frameHeaderHeight - 8;
    const container = new Container();

    const label = new Text({
      text: action.label,
      resolution: this.theme.textResolution,
      style: {
        fontFamily: this.theme.fontFamily,
        fontSize: this.theme.fontSizeSmall,
        fill: action.isInfo ? 0x666666 : this.theme.frameHeaderText,
      },
    });
    label.anchor.set(0.5);
    label.eventMode = "none";

    if (action.isInfo) {
      // info badge: just text, no background, not clickable
      const textWidth = label.width;
      const totalWidth = textWidth + 24; // 12px padding each side
      label.x = totalWidth / 2;
      label.y = btnHeight / 2;
      container.addChild(label);
    } else {
      // clickable action button with rounded-rect background
      const textWidth = label.width;
      const totalWidth = textWidth + 24; // 12px padding each side

      const bg = new Graphics();
      bg.roundRect(0, 0, totalWidth, btnHeight, 3);
      bg.fill({ color: this.theme.frameBorder });
      bg.eventMode = "static";
      bg.cursor = "pointer";
      bg.on("pointertap", (e: FederatedPointerEvent) => {
        e.stopPropagation();
        action.onClick?.();
      });
      container.addChild(bg);

      label.x = totalWidth / 2;
      label.y = btnHeight / 2;
      container.addChild(label);
    }

    return container;
  }

  // --- hamburger flyout ---

  /** update the layer position info (called by widget manager on reconcile) */
  setLayerInfo(position: number, total: number): void {
    this._layerPosition = position;
    this._layerTotal = total;
  }

  /**
   * show the hamburger flyout menu below the hamburger button.
   * contains overflow actions (if any) at the top, then z-order controls,
   * then a layer status row.
   */
  private showHamburgerFlyout(): void {
    if (this.hamburgerFlyout) return;

    const panelWidth = 180;
    const rowHeight = 24;

    // z-order items
    const zOrderItems = [
      { label: "bring to front", shortcut: "]", action: () => this.callbacks.onBringToFront?.() },
      { label: "bring forward", shortcut: "", action: () => this.callbacks.onBringForward?.() },
      { label: "send backward", shortcut: "", action: () => this.callbacks.onSendBackward?.() },
      { label: "send to back", shortcut: "[", action: () => this.callbacks.onSendToBack?.() },
    ];

    const hasOverflow = this.overflowActions.length > 0;

    const flyout = new Container();
    flyout.zIndex = 1000;

    // large invisible blocker to dismiss on outside click
    const blocker = new Graphics();
    blocker.rect(-5000, -5000, 10000, 10000);
    blocker.fill({ color: 0x000000, alpha: 0.01 });
    blocker.eventMode = "static";
    blocker.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.hideHamburgerFlyout();
    });
    flyout.addChild(blocker);

    // panel container positioned below the hamburger button
    const panel = new Container();
    panel.x = this.hamburgerBtn.x;
    panel.y = this.theme.frameHeaderHeight + 2;
    flyout.addChild(panel);

    // calculate panel height
    const overflowRowCount = hasOverflow ? this.overflowActions.length : 0;
    const overflowSectionHeight = hasOverflow ? overflowRowCount * rowHeight + 1 : 0; // +1 for separator
    const zOrderSectionHeight = zOrderItems.length * rowHeight;
    const statusSeparatorHeight = 1;
    const statusRowHeight = rowHeight;
    const panelHeight =
      overflowSectionHeight + zOrderSectionHeight + statusSeparatorHeight + statusRowHeight;

    // background
    const bg = new Graphics();
    bg.roundRect(0, 0, panelWidth, panelHeight, 4);
    bg.fill({ color: this.theme.toolbarBg });
    bg.stroke({ color: this.theme.toolbarBorder, width: 1 });
    bg.eventMode = "static";
    panel.addChild(bg);

    let currentY = 0;

    // overflow actions section (if any)
    if (hasOverflow) {
      for (let i = 0; i < this.overflowActions.length; i++) {
        const action = this.overflowActions[i];
        const rowY = currentY + i * rowHeight;

        if (action.isInfo) {
          // non-clickable info row with muted text
          const infoLabel = new Text({
            text: action.label,
            resolution: this.theme.textResolution,
            style: {
              fontFamily: this.theme.fontFamily,
              fontSize: this.theme.fontSizeSmall,
              fill: 0x666666,
            },
          });
          infoLabel.x = 8;
          infoLabel.y = rowY + rowHeight / 2;
          infoLabel.anchor.set(0, 0.5);
          infoLabel.eventMode = "none";
          panel.addChild(infoLabel);
        } else {
          // clickable row
          const rowHit = new Graphics();
          rowHit.rect(1, rowY + 1, panelWidth - 2, rowHeight - 1);
          rowHit.fill({ color: 0x000000, alpha: 0.01 });
          rowHit.eventMode = "static";
          rowHit.cursor = "pointer";
          panel.addChild(rowHit);

          rowHit.on("pointerenter", () => {
            rowHit.clear();
            rowHit.rect(1, rowY + 1, panelWidth - 2, rowHeight - 1);
            rowHit.fill({ color: this.theme.frameBorderHover });
          });
          rowHit.on("pointerleave", () => {
            rowHit.clear();
            rowHit.rect(1, rowY + 1, panelWidth - 2, rowHeight - 1);
            rowHit.fill({ color: 0x000000, alpha: 0.01 });
          });
          rowHit.on("pointertap", (e: FederatedPointerEvent) => {
            e.stopPropagation();
            action.onClick?.();
            this.hideHamburgerFlyout();
          });

          const actionLabel = new Text({
            text: action.label,
            resolution: this.theme.textResolution,
            style: {
              fontFamily: this.theme.fontFamily,
              fontSize: this.theme.fontSizeSmall,
              fill: this.theme.frameHeaderText,
            },
          });
          actionLabel.x = 8;
          actionLabel.y = rowY + rowHeight / 2;
          actionLabel.anchor.set(0, 0.5);
          actionLabel.eventMode = "none";
          panel.addChild(actionLabel);
        }
      }

      currentY += overflowRowCount * rowHeight;

      // separator between overflow actions and z-order controls
      const overflowSep = new Graphics();
      overflowSep.rect(4, currentY, panelWidth - 8, 1);
      overflowSep.fill({ color: this.theme.toolbarBorder });
      panel.addChild(overflowSep);
      currentY += 1;
    }

    // z-order action rows
    for (let i = 0; i < zOrderItems.length; i++) {
      const item = zOrderItems[i];
      const rowY = currentY + i * rowHeight;

      // hit area for the row
      const rowHit = new Graphics();
      rowHit.rect(1, rowY + 1, panelWidth - 2, rowHeight - 1);
      rowHit.fill({ color: 0x000000, alpha: 0.01 });
      rowHit.eventMode = "static";
      rowHit.cursor = "pointer";
      panel.addChild(rowHit);

      // hover effect
      rowHit.on("pointerenter", () => {
        rowHit.clear();
        rowHit.rect(1, rowY + 1, panelWidth - 2, rowHeight - 1);
        rowHit.fill({ color: this.theme.frameBorderHover });
      });
      rowHit.on("pointerleave", () => {
        rowHit.clear();
        rowHit.rect(1, rowY + 1, panelWidth - 2, rowHeight - 1);
        rowHit.fill({ color: 0x000000, alpha: 0.01 });
      });

      // click handler
      rowHit.on("pointertap", (e: FederatedPointerEvent) => {
        e.stopPropagation();
        item.action();
        this.hideHamburgerFlyout();
      });

      // label
      const label = new Text({
        text: item.label,
        resolution: this.theme.textResolution,
        style: {
          fontFamily: this.theme.fontFamily,
          fontSize: this.theme.fontSizeSmall,
          fill: this.theme.frameHeaderText,
        },
      });
      label.x = 8;
      label.y = rowY + rowHeight / 2;
      label.anchor.set(0, 0.5);
      label.eventMode = "none";
      panel.addChild(label);

      // shortcut hint (if present)
      if (item.shortcut) {
        const hint = new Text({
          text: item.shortcut,
          resolution: this.theme.textResolution,
          style: {
            fontFamily: this.theme.fontFamily,
            fontSize: this.theme.fontSizeSmall,
            fill: 0x666666,
          },
        });
        hint.x = panelWidth - 8;
        hint.y = rowY + rowHeight / 2;
        hint.anchor.set(1, 0.5);
        hint.eventMode = "none";
        panel.addChild(hint);
      }
    }

    currentY += zOrderItems.length * rowHeight;

    // separator line before status
    const sep = new Graphics();
    sep.rect(4, currentY, panelWidth - 8, 1);
    sep.fill({ color: this.theme.toolbarBorder });
    panel.addChild(sep);
    currentY += 1;

    // status row: "layer N / M"
    const statusText = new Text({
      text: `layer ${this._layerPosition + 1} / ${this._layerTotal}`,
      resolution: this.theme.textResolution,
      style: {
        fontFamily: this.theme.fontFamily,
        fontSize: this.theme.fontSizeSmall,
        fill: 0x666666,
      },
    });
    statusText.x = 8;
    statusText.y = currentY + statusRowHeight / 2;
    statusText.anchor.set(0, 0.5);
    statusText.eventMode = "none";
    panel.addChild(statusText);

    this.hamburgerFlyout = flyout;
    this.root.addChild(flyout);
  }

  /** hide and destroy the hamburger flyout */
  private hideHamburgerFlyout(): void {
    if (!this.hamburgerFlyout) return;
    this.root.removeChild(this.hamburgerFlyout);
    this.hamburgerFlyout.destroy({ children: true });
    this.hamburgerFlyout = null;
  }

  // --- visual state management ---

  private updateHandleVisibility(): void {
    // resize handles visible only when single-selected and not collapsed
    const show = !this._collapsed && this._selected && !this._multiSelected;
    for (const handle of this.resizeHandles.values()) {
      handle.visible = show;
    }
  }

  private updateVisualState(): void {
    if (this._maximized) {
      const showHeader = this._hovered;

      // explicit hitArea so hover events fire even when widget content
      // has no interactive pixi elements (e.g., image widget, label)
      this.root.hitArea = new Rectangle(
        0,
        -this.theme.frameHeaderHeight,
        this._width,
        this._height + this.theme.frameHeaderHeight
      );

      this.header.visible = showHeader;
      if (showHeader) {
        // header sits above the content, at its normal position
        this.header.y = -this.theme.frameHeaderHeight;
        this.header.alpha = 1;
        this.positionButtons();
        // update maximize/restore icon
        const maximizeLabel = this.maximizeBtn.getChildAt(1) as Text;
        maximizeLabel.text = "\u2921"; // ⤡ restore icon
      }

      // system buttons follow header visibility
      this.hamburgerBtn.visible = showHeader;
      this.collapseBtn.visible = false; // collapse doesn't make sense when maximized
      this.maximizeBtn.visible = showHeader && !!this.callbacks.onMaximize;

      // custom actions follow header
      for (const c of this.customActionContainers) {
        if (!showHeader) {
          c.visible = false;
        }
      }

      if (!showHeader) {
        this.hideHamburgerFlyout();
      }

      // resize handles always hidden when maximized
      for (const handle of this.resizeHandles.values()) {
        handle.visible = false;
      }

      // content fills the viewport from y=0
      this.contentContainer.y = 0;
      this.contentContainer.eventMode = "auto";
      this.contentContainer.interactiveChildren = true;
      this.bodyHitArea.eventMode = "none";
      // header interactivity only when visible
      this.headerBg.eventMode = showHeader ? "static" : "none";
      this.headerBg.cursor = showHeader ? "default" : "auto";

      return;
    }

    // collapsed widgets always show chrome (no content to hover over)
    const showChrome = this._collapsed || this._hovered || this._selected || this._multiSelected;

    // restore header position and opacity (may have been changed during maximize hover)
    this.header.y = -this.theme.frameHeaderHeight;
    this.header.alpha = 1;

    // clear explicit hitArea — let pixi auto-detect from children
    this.root.hitArea = null;

    // restore maximize icon
    const maximizeLabel = this.maximizeBtn.getChildAt(1) as Text;
    maximizeLabel.text = "\u2922"; // ⤢ maximize icon

    const isInert = this._lassoActive || this._multiSelected;

    // resize handles: visible only when single-selected and not collapsed
    this.updateHandleVisibility();

    // header visibility
    this.header.visible = showChrome;

    // system buttons — always visible when chrome is shown
    this.hamburgerBtn.visible = showChrome;
    this.collapseBtn.visible = showChrome;
    this.maximizeBtn.visible = showChrome && !!this.callbacks.onMaximize;

    // custom action containers follow chrome visibility (positionButtons handles overflow)
    for (const c of this.customActionContainers) {
      // positionButtons() controls per-action visibility based on overflow,
      // but when chrome is hidden, hide them all
      if (!showChrome) {
        c.visible = false;
      }
    }

    // hide hamburger flyout when chrome disappears
    if (!showChrome) {
      this.hideHamburgerFlyout();
    }

    // header interactivity — always active (hidden header won't receive events anyway)
    this.headerBg.eventMode = "static";
    this.headerBg.cursor = "grab";

    // content container position stays at y=0
    this.contentContainer.y = 0;

    // content interactivity: inert when selected, interactive otherwise
    this.contentContainer.eventMode = isInert ? "none" : "auto";
    this.contentContainer.interactiveChildren = !isInert;

    // update body hit area for multi-select drag
    this.updateBodyHitArea();
  }
}
