import { Application, Container, Rectangle } from "pixi.js";

// manages a scrollable world larger than the visible screen.
// all scene content should be added to viewport.world instead of app.stage directly.
// two-finger touch pans the camera. mouse wheel scrolls vertically.
// the world expands rightward/downward as content is dragged near edges.

export interface ViewportOptions {
  worldWidth: number;
  worldHeight: number;
}

export class Viewport {
  public world: Container;

  private app: Application;
  private _worldW: number;
  private _worldH: number;

  // camera position (top-left corner of the visible area in world coords)
  private camX = 0;
  private camY = 0;

  // two-finger pan state
  private activeTouches = new Map<number, { x: number; y: number }>();
  private isPanning = false;
  private panStart = { camX: 0, camY: 0 };
  private panMidStart = { x: 0, y: 0 };

  constructor(app: Application, opts: ViewportOptions) {
    this.app = app;
    this._worldW = opts.worldWidth;
    this._worldH = opts.worldHeight;

    this.world = new Container();
    this.world.eventMode = "static";
    this.world.interactiveChildren = true;
    app.stage.addChild(this.world);

    this.updateHitArea();

    // bind native touch events on the canvas for reliable multi-touch
    const canvas = app.canvas as HTMLCanvasElement;
    canvas.addEventListener("touchstart", this.onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", this.onTouchMove, { passive: false });
    canvas.addEventListener("touchend", this.onTouchEnd);
    canvas.addEventListener("touchcancel", this.onTouchEnd);

    // mouse wheel for vertical scroll
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  get worldWidth() { return this._worldW; }
  get worldHeight() { return this._worldH; }

  get scrollX() { return this.camX; }
  get scrollY() { return this.camY; }

  // expand the world if content needs more space
  expandWorld(minW: number, minH: number) {
    if (minW > this._worldW) this._worldW = minW;
    if (minH > this._worldH) this._worldH = minH;
    this.updateHitArea();
  }

  // scroll to a specific position
  scrollTo(x: number, y: number) {
    this.camX = this.clampX(x);
    this.camY = this.clampY(y);
    this.applyCamera();
  }

  // check if a two-finger pan is in progress (other interactions should be suppressed)
  get panning() { return this.isPanning; }

  // how many touches are active
  get touchCount() { return this.activeTouches.size; }

  destroy() {
    const canvas = this.app.canvas as HTMLCanvasElement;
    canvas.removeEventListener("touchstart", this.onTouchStart);
    canvas.removeEventListener("touchmove", this.onTouchMove);
    canvas.removeEventListener("touchend", this.onTouchEnd);
    canvas.removeEventListener("touchcancel", this.onTouchEnd);
    canvas.removeEventListener("wheel", this.onWheel);
  }

  // -- internal --

  private clampX(x: number) {
    const maxX = Math.max(0, this._worldW - this.app.screen.width);
    return Math.max(0, Math.min(x, maxX));
  }

  private clampY(y: number) {
    const maxY = Math.max(0, this._worldH - this.app.screen.height);
    return Math.max(0, Math.min(y, maxY));
  }

  private applyCamera() {
    this.world.x = -this.camX;
    this.world.y = -this.camY;
  }

  private updateHitArea() {
    // the world's hit area must cover the full world so pointer events work
    this.world.hitArea = new Rectangle(0, 0, this._worldW, this._worldH);
  }

  // convert a screen-space position to world coordinates
  screenToWorld(screenX: number, screenY: number) {
    return { x: screenX + this.camX, y: screenY + this.camY };
  }

  // -- touch handling --

  // get DPR-adjusted coordinates from a native touch
  private touchToScreen(t: Touch): { x: number; y: number } {
    const canvas = this.app.canvas as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    return {
      x: t.clientX - rect.left,
      y: t.clientY - rect.top,
    };
  }

  private onTouchStart = (e: TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      this.activeTouches.set(t.identifier, this.touchToScreen(t));
    }

    // start pan when 2+ fingers are down
    if (this.activeTouches.size >= 2 && !this.isPanning) {
      this.isPanning = true;
      this.panStart = { camX: this.camX, camY: this.camY };
      this.panMidStart = this.getTouchMidpoint();
      e.preventDefault();
    }
  };

  private onTouchMove = (e: TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      this.activeTouches.set(t.identifier, this.touchToScreen(t));
    }

    if (this.isPanning && this.activeTouches.size >= 2) {
      e.preventDefault();
      const mid = this.getTouchMidpoint();
      const dx = mid.x - this.panMidStart.x;
      const dy = mid.y - this.panMidStart.y;
      this.camX = this.clampX(this.panStart.camX - dx);
      this.camY = this.clampY(this.panStart.camY - dy);
      this.applyCamera();
    }
  };

  private onTouchEnd = (e: TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      this.activeTouches.delete(e.changedTouches[i].identifier);
    }

    if (this.activeTouches.size < 2) {
      this.isPanning = false;
    }
  };

  private getTouchMidpoint(): { x: number; y: number } {
    let sx = 0, sy = 0;
    for (const p of this.activeTouches.values()) {
      sx += p.x; sy += p.y;
    }
    const n = this.activeTouches.size || 1;
    return { x: sx / n, y: sy / n };
  }

  // -- mouse wheel --

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // shift+wheel = horizontal scroll, otherwise vertical
    if (e.shiftKey) {
      this.camX = this.clampX(this.camX + e.deltaY);
    } else {
      this.camX = this.clampX(this.camX + e.deltaX);
      this.camY = this.clampY(this.camY + e.deltaY);
    }
    this.applyCamera();
  };
}
