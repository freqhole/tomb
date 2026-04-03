import type { Container } from "pixi.js";

/**
 * manages viewport pan and zoom for the canvas world container.
 *
 * the world container holds the stage background and all widget frames.
 * the viewport translates and scales it to implement camera movement.
 *
 * controls:
 * - scroll wheel: pan
 * - ctrl/meta + scroll wheel: zoom towards mouse cursor
 * - middle mouse drag: pan
 * - two-finger pinch (touch): zoom + pan
 *
 * the toolbar and other HUD elements live on app.stage directly
 * and are unaffected by viewport transforms.
 */
export class Viewport {
  readonly world: Container;
  private readonly canvasEl: HTMLCanvasElement;

  private _zoom = 1;

  // middle-mouse pan state
  private panning = false;
  private panStart = { x: 0, y: 0 };
  private worldStartPos = { x: 0, y: 0 };

  // touch pinch state
  private lastPinchDist: number | null = null;
  private lastPinchCenter: { x: number; y: number } | null = null;

  // zoom change listeners
  private zoomListeners: Array<(zoom: number) => void> = [];

  static readonly MIN_ZOOM = 0.25;
  static readonly MAX_ZOOM = 2.0;

  constructor(world: Container, canvasEl: HTMLCanvasElement) {
    this.world = world;
    this.canvasEl = canvasEl;

    this.setupWheelListener();
    this.setupMiddleMousePan();
    this.setupTouchPinch();
  }

  /** current zoom level (1 = 100%) */
  get zoom(): number {
    return this._zoom;
  }

  /** current camera x position in world coordinates */
  get cameraX(): number {
    return -this.world.x / this._zoom;
  }

  /** current camera y position in world coordinates */
  get cameraY(): number {
    return -this.world.y / this._zoom;
  }

  /** whether a middle-mouse pan is currently active */
  get isPanning(): boolean {
    return this.panning;
  }

  /**
   * programmatically pan so the camera looks at (x, y) in world coordinates.
   * the top-left of the viewport will correspond to this world position.
   */
  panTo(x: number, y: number): void {
    this.world.x = -x * this._zoom;
    this.world.y = -y * this._zoom;
  }

  /**
   * programmatically pan by a delta in world coordinates.
   */
  panBy(dx: number, dy: number): void {
    this.world.x -= dx * this._zoom;
    this.world.y -= dy * this._zoom;
  }

  /**
   * programmatically set zoom level (clamped to min/max range).
   * zooms relative to the current camera center — the world point
   * that the camera is looking at stays fixed.
   */
  zoomTo(level: number): void {
    const oldZoom = this._zoom;
    this._zoom = clamp(level, Viewport.MIN_ZOOM, Viewport.MAX_ZOOM);
    if (this._zoom === oldZoom) return;

    // scale the world offset proportionally so the camera center stays fixed
    this.world.x = (this.world.x * this._zoom) / oldZoom;
    this.world.y = (this.world.y * this._zoom) / oldZoom;
    this.world.scale.set(this._zoom);
    this.notifyZoomListeners();
  }

  /**
   * zoom towards a specific screen point (e.g. the mouse cursor).
   * the world coordinate under that screen point stays fixed.
   */
  zoomAtPoint(newZoom: number, screenX: number, screenY: number): void {
    const oldZoom = this._zoom;
    this._zoom = clamp(newZoom, Viewport.MIN_ZOOM, Viewport.MAX_ZOOM);
    if (this._zoom === oldZoom) return;

    // world point currently under (screenX, screenY)
    const worldX = (screenX - this.world.x) / oldZoom;
    const worldY = (screenY - this.world.y) / oldZoom;

    // adjust offset so (worldX, worldY) stays under (screenX, screenY) at new zoom
    this.world.x = screenX - worldX * this._zoom;
    this.world.y = screenY - worldY * this._zoom;
    this.world.scale.set(this._zoom);
    this.notifyZoomListeners();
  }

  /** reset camera to origin at 1x zoom */
  resetView(): void {
    this._zoom = 1;
    this.world.x = 0;
    this.world.y = 0;
    this.world.scale.set(1);
    this.notifyZoomListeners();
  }

  /** subscribe to zoom changes. returns an unsubscribe function. */
  onZoomChange(listener: (zoom: number) => void): () => void {
    this.zoomListeners.push(listener);
    return () => {
      this.zoomListeners = this.zoomListeners.filter((l) => l !== listener);
    };
  }

  /** clean up all event listeners */
  destroy(): void {
    this.canvasEl.removeEventListener("wheel", this.onWheel);
    this.canvasEl.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.canvasEl.removeEventListener("touchstart", this.onTouchStart);
    this.canvasEl.removeEventListener("touchmove", this.onTouchMove);
    this.canvasEl.removeEventListener("touchend", this.onTouchEnd);
    this.zoomListeners = [];
  }

  // --- wheel handler (pan + ctrl-zoom) ---

  private setupWheelListener(): void {
    this.canvasEl.addEventListener("wheel", this.onWheel, { passive: false });
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
      // ctrl/meta + scroll = zoom towards mouse cursor
      const zoomDelta = -e.deltaY * 0.005;
      const newZoom = this._zoom * (1 + zoomDelta);

      const rect = this.canvasEl.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      this.zoomAtPoint(newZoom, screenX, screenY);
    } else {
      // regular scroll = pan (in screen pixels)
      this.world.x -= e.deltaX;
      this.world.y -= e.deltaY;
    }
  };

  // --- middle mouse drag pan ---

  private setupMiddleMousePan(): void {
    this.canvasEl.addEventListener("pointerdown", this.onPointerDown);
    // listen on window so we track the mouse even outside the canvas
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 1) return; // middle mouse only
    e.preventDefault();
    this.panning = true;
    this.panStart = { x: e.clientX, y: e.clientY };
    this.worldStartPos = { x: this.world.x, y: this.world.y };
    this.canvasEl.style.cursor = "grabbing";
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.panning) return;
    const dx = e.clientX - this.panStart.x;
    const dy = e.clientY - this.panStart.y;
    this.world.x = this.worldStartPos.x + dx;
    this.world.y = this.worldStartPos.y + dy;
  };

  private onPointerUp = (): void => {
    if (!this.panning) return;
    this.panning = false;
    this.canvasEl.style.cursor = "";
  };

  // --- touch pinch zoom ---

  private setupTouchPinch(): void {
    this.canvasEl.addEventListener("touchstart", this.onTouchStart, { passive: false });
    this.canvasEl.addEventListener("touchmove", this.onTouchMove, { passive: false });
    this.canvasEl.addEventListener("touchend", this.onTouchEnd);
  }

  private onTouchStart = (e: TouchEvent): void => {
    if (e.touches.length === 2) {
      e.preventDefault();
      this.lastPinchDist = touchDistance(e.touches);
      this.lastPinchCenter = touchCenter(e.touches);
    }
  };

  private onTouchMove = (e: TouchEvent): void => {
    if (e.touches.length !== 2 || this.lastPinchDist === null || this.lastPinchCenter === null) {
      return;
    }
    e.preventDefault();

    const dist = touchDistance(e.touches);
    const center = touchCenter(e.touches);

    // zoom based on pinch scale
    const scale = dist / this.lastPinchDist;
    const rect = this.canvasEl.getBoundingClientRect();
    const screenX = center.x - rect.left;
    const screenY = center.y - rect.top;
    this.zoomAtPoint(this._zoom * scale, screenX, screenY);

    // also handle two-finger pan (movement of the pinch center)
    this.world.x += center.x - this.lastPinchCenter.x;
    this.world.y += center.y - this.lastPinchCenter.y;

    this.lastPinchDist = dist;
    this.lastPinchCenter = center;
  };

  private onTouchEnd = (e: TouchEvent): void => {
    if (e.touches.length < 2) {
      this.lastPinchDist = null;
      this.lastPinchCenter = null;
    }
  };

  // --- internal helpers ---

  private notifyZoomListeners(): void {
    for (const listener of this.zoomListeners) {
      listener(this._zoom);
    }
  }
}

// --- pure utility functions ---

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function touchDistance(touches: TouchList): number {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function touchCenter(touches: TouchList): { x: number; y: number } {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  };
}
