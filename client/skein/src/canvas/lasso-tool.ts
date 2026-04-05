import type { FederatedPointerEvent } from "pixi.js";
import { Container, Graphics } from "pixi.js";
import type { SkeinTheme } from "../theme/skein-theme";
import type { InputRouter } from "./input-router";
import type { WidgetManager } from "./widget-manager";

interface LassoToolOptions {
  /** the target Graphics to attach pointer events to (stage background) */
  target: Graphics;
  /** the world container to add lasso graphics to */
  world: Container;
  /** the input router for selection */
  inputRouter: InputRouter;
  /** the widget manager for getting live widget positions */
  widgetManager: WidgetManager;
  /** the theme for visual styling */
  theme: SkeinTheme;
  /** callback when user double-clicks empty canvas in edit mode */
  onDoubleClick: (screenX: number, screenY: number, worldX: number, worldY: number) => void;
  /** called when a lasso drag begins — used to make widgets inert */
  onLassoStart?: () => void;
  /** called when a lasso drag ends — used to restore widget interactivity */
  onLassoEnd?: () => void;
}

interface Point {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// --- geometry helpers ---

/**
 * ray-casting point-in-polygon test.
 * returns true if the point (px, py) is inside the polygon defined by `points`.
 */
function pointInPolygon(px: number, py: number, points: Point[]): boolean {
  const n = points.length;
  if (n < 3) return false;

  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;

    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * test whether two line segments (p1-p2) and (p3-p4) intersect.
 * uses the cross-product orientation method.
 */
function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  // collinear cases
  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;

  return false;
}

/** cross product of vectors (b-a) x (c-a) */
function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** check if point c lies on segment a-b (assuming collinear) */
function onSegment(a: Point, b: Point, c: Point): boolean {
  return (
    Math.min(a.x, b.x) <= c.x &&
    c.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= c.y &&
    c.y <= Math.max(a.y, b.y)
  );
}

/**
 * check if any segment of the polyline intersects the edges of the given rect.
 */
function polylineIntersectsRect(points: Point[], rect: Rect): boolean {
  if (points.length < 2) return false;

  const { x, y, w, h } = rect;
  // four edges of the rectangle
  const rectEdges: [Point, Point][] = [
    [
      { x, y },
      { x: x + w, y },
    ],
    [
      { x: x + w, y },
      { x: x + w, y: y + h },
    ],
    [
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    [
      { x, y: y + h },
      { x, y },
    ],
  ];

  for (let i = 0; i < points.length - 1; i++) {
    const segA = points[i];
    const segB = points[i + 1];
    for (const [edgeA, edgeB] of rectEdges) {
      if (segmentsIntersect(segA, segB, edgeA, edgeB)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * lasso selection tool for the skein canvas.
 *
 * handles click-to-deselect, double-click-to-open-flyout, and
 * click-and-drag to draw a freeform lasso selection around widgets.
 */
export class LassoTool {
  private readonly target: Graphics;
  private readonly world: Container;
  private readonly inputRouter: InputRouter;
  private readonly widgetManager: WidgetManager;
  private readonly theme: SkeinTheme;
  private readonly onDoubleClick: (
    screenX: number,
    screenY: number,
    worldX: number,
    worldY: number
  ) => void;
  private readonly onLassoStart: (() => void) | null;
  private readonly onLassoEnd: (() => void) | null;

  // lasso drawing state
  private lassoActive = false;
  private lassoGraphics: Graphics | null = null;
  private lassoPoints: Point[] = [];
  private activePointerId: number | null = null;

  // click/double-click detection state
  private pointerDownTime = 0;
  private pointerDownPos: Point = { x: 0, y: 0 };
  private pointerDownWorldPos: Point = { x: 0, y: 0 };
  private lastClickTime = 0;
  private lastClickPos: Point = { x: 0, y: 0 };
  private dragStarted = false;

  // bound event handlers for cleanup
  private readonly handlePointerDown: (e: FederatedPointerEvent) => void;
  private readonly handlePointerMove: (e: FederatedPointerEvent) => void;
  private readonly handlePointerUp: (e: FederatedPointerEvent) => void;
  private readonly handlePointerUpOutside: (e: FederatedPointerEvent) => void;

  private static readonly CLICK_DISTANCE_THRESHOLD = 5;
  private static readonly CLICK_TIME_THRESHOLD = 300;
  private static readonly DOUBLE_CLICK_TIME_THRESHOLD = 400;
  private static readonly DOUBLE_CLICK_DISTANCE_THRESHOLD = 10;

  constructor(options: LassoToolOptions) {
    this.target = options.target;
    this.world = options.world;
    this.inputRouter = options.inputRouter;
    this.widgetManager = options.widgetManager;
    this.theme = options.theme;
    this.onDoubleClick = options.onDoubleClick;
    this.onLassoStart = options.onLassoStart ?? null;
    this.onLassoEnd = options.onLassoEnd ?? null;

    // bind event handlers
    this.handlePointerDown = this.onPointerDown.bind(this);
    this.handlePointerMove = this.onPointerMove.bind(this);
    this.handlePointerUp = this.onPointerUp.bind(this);
    this.handlePointerUpOutside = this.onPointerUp.bind(this);

    // attach events to target
    this.target.on("pointerdown", this.handlePointerDown);
    this.target.on("pointermove", this.handlePointerMove);
    this.target.on("pointerup", this.handlePointerUp);
    this.target.on("pointerupoutside", this.handlePointerUpOutside);
  }

  // --- pointer event handlers ---

  private onPointerDown(e: FederatedPointerEvent): void {
    // avoid multi-touch conflicts
    if (this.activePointerId !== null) return;
    this.activePointerId = e.pointerId;

    const worldPos = e.getLocalPosition(this.world);

    this.pointerDownTime = performance.now();
    this.pointerDownPos = { x: e.global.x, y: e.global.y };
    this.pointerDownWorldPos = { x: worldPos.x, y: worldPos.y };
    this.dragStarted = false;
  }

  private onPointerMove(e: FederatedPointerEvent): void {
    if (this.activePointerId !== e.pointerId) return;

    const dx = e.global.x - this.pointerDownPos.x;
    const dy = e.global.y - this.pointerDownPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (!this.dragStarted) {
      // check if movement exceeds drag threshold
      if (dist >= LassoTool.CLICK_DISTANCE_THRESHOLD) {
        this.dragStarted = true;
        this.startLasso();
      } else {
        return;
      }
    }

    // add point to lasso and redraw
    if (this.lassoActive) {
      const worldPos = e.getLocalPosition(this.world);
      this.lassoPoints.push({ x: worldPos.x, y: worldPos.y });
      this.drawLasso();
      this.updateLassoSelection();
    }
  }

  private onPointerUp(e: FederatedPointerEvent): void {
    if (this.activePointerId !== e.pointerId) return;
    this.activePointerId = null;

    if (this.lassoActive) {
      // finish lasso — final selection update then clean up
      this.updateLassoSelection();
      this.endLasso();
      return;
    }

    // not a drag — check for click / double-click
    const elapsed = performance.now() - this.pointerDownTime;
    const dx = e.global.x - this.pointerDownPos.x;
    const dy = e.global.y - this.pointerDownPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const isClick =
      dist < LassoTool.CLICK_DISTANCE_THRESHOLD && elapsed < LassoTool.CLICK_TIME_THRESHOLD;

    if (!isClick) {
      // movement was too large or too slow but didn't trigger drag threshold
      // (shouldn't normally happen, but be safe)
      this.endLasso();
      return;
    }

    const now = performance.now();
    const worldPos = e.getLocalPosition(this.world);

    // check for double-click
    const timeSinceLastClick = now - this.lastClickTime;
    const dxClick = e.global.x - this.lastClickPos.x;
    const dyClick = e.global.y - this.lastClickPos.y;
    const clickDist = Math.sqrt(dxClick * dxClick + dyClick * dyClick);

    if (
      timeSinceLastClick < LassoTool.DOUBLE_CLICK_TIME_THRESHOLD &&
      clickDist < LassoTool.DOUBLE_CLICK_DISTANCE_THRESHOLD
    ) {
      // double-click detected
      this.lastClickTime = 0; // reset to prevent triple-click triggering again
      this.onDoubleClick(e.global.x, e.global.y, worldPos.x, worldPos.y);
      return;
    }

    // single click — deselect all widgets
    this.inputRouter.selectWidget(null);

    // record this click for future double-click detection
    this.lastClickTime = now;
    this.lastClickPos = { x: e.global.x, y: e.global.y };
  }

  // --- lasso lifecycle ---

  /** begin a new lasso from the initial pointer-down position */
  private startLasso(): void {
    this.onLassoStart?.();
    this.lassoActive = true;
    this.lassoPoints = [{ x: this.pointerDownWorldPos.x, y: this.pointerDownWorldPos.y }];

    // create the graphics object for the lasso line
    this.lassoGraphics = new Graphics();
    this.lassoGraphics.zIndex = 99998;
    this.world.addChild(this.lassoGraphics);
  }

  /** redraw the lasso polyline from the current points */
  private drawLasso(): void {
    if (!this.lassoGraphics || this.lassoPoints.length < 2) return;

    this.lassoGraphics.clear();
    this.lassoGraphics.moveTo(this.lassoPoints[0].x, this.lassoPoints[0].y);

    for (let i = 1; i < this.lassoPoints.length; i++) {
      this.lassoGraphics.lineTo(this.lassoPoints[i].x, this.lassoPoints[i].y);
    }

    this.lassoGraphics.stroke({
      color: this.theme.selectionStroke,
      width: 2,
      alpha: 0.7,
    });
  }

  /**
   * end the lasso and destroy the graphics object.
   * idempotent — safe to call multiple times or when no lasso is active.
   */
  private endLasso(): void {
    // only fire callback if a lasso was actually running
    const wasActive = this.lassoActive;

    this.lassoActive = false;
    this.lassoPoints = [];
    this.activePointerId = null;
    this.dragStarted = false;

    if (this.lassoGraphics) {
      this.lassoGraphics.clear();
      if (this.lassoGraphics.parent) {
        this.lassoGraphics.parent.removeChild(this.lassoGraphics);
      }
      this.lassoGraphics.destroy();
      this.lassoGraphics = null;
    }

    if (wasActive) {
      this.onLassoEnd?.();
    }
  }

  // --- selection logic ---

  /**
   * check all live widgets against the current lasso shape and
   * update the input router's multi-selection accordingly.
   */
  private updateLassoSelection(): void {
    if (this.lassoPoints.length < 2) return;

    const liveWidgets = this.widgetManager.getLiveWidgets();
    const matchingIds: string[] = [];

    for (const [id, live] of liveWidgets) {
      const entry = live.entry;
      const rect: Rect = {
        x: entry.x,
        y: entry.y,
        w: entry.width,
        h: entry.height,
      };

      if (this.widgetMatchesLasso(rect)) {
        matchingIds.push(id);
      }
    }

    this.inputRouter.selectWidgets(matchingIds);
  }

  /**
   * determine if a widget rect matches the current lasso.
   * a widget matches if:
   * - any lasso segment intersects the widget bounding rect, OR
   * - the widget's center point is inside the closed lasso polygon
   */
  private widgetMatchesLasso(rect: Rect): boolean {
    // check line intersection first (cheaper early-out for large widgets)
    if (polylineIntersectsRect(this.lassoPoints, rect)) {
      return true;
    }

    // check containment: widget center inside closed lasso polygon
    const centerX = rect.x + rect.w / 2;
    const centerY = rect.y + rect.h / 2;

    if (pointInPolygon(centerX, centerY, this.lassoPoints)) {
      return true;
    }

    return false;
  }

  // --- public API ---

  /** remove all event listeners and clean up any active lasso */
  destroy(): void {
    // always end any active lasso first
    this.endLasso();

    // remove pointer event listeners from target
    this.target.off("pointerdown", this.handlePointerDown);
    this.target.off("pointermove", this.handlePointerMove);
    this.target.off("pointerup", this.handlePointerUp);
    this.target.off("pointerupoutside", this.handlePointerUpOutside);
  }
}
