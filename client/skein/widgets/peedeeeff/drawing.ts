import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { NAV_BTN_RADIUS } from "./types";

// ---------------------------------------------------------------------------
// pill button constants
// ---------------------------------------------------------------------------

export const BUTTON_H = 22;
export const BUTTON_PAD_H = 10;
export const BUTTON_PAD_V = 3;
export const BUTTON_RADIUS = 4;
export const BUTTON_FONT_SIZE = 11;

// ---------------------------------------------------------------------------
// pill button
// ---------------------------------------------------------------------------

export interface PillButton {
  container: Container;
  setLabel(text: string): void;
  setColor(fill: number): void;
  setVisible(v: boolean): void;
  getWidth(): number;
}

export function createPillButton(text: string, fill: number, onClick: () => void): PillButton {
  const c = new Container();
  c.eventMode = "static";
  c.cursor = "pointer";

  const bg = new Graphics();
  c.addChild(bg);

  const label = new Text({
    text,
    style: {
      fontFamily: "system-ui, sans-serif",
      fontSize: BUTTON_FONT_SIZE,
      fill: 0xddddee,
      align: "center",
    },
    resolution: 2,
  });
  c.addChild(label);

  let currentFill = fill;

  const redraw = () => {
    if (c.destroyed) return;
    const w = label.width + BUTTON_PAD_H * 2;
    bg.clear();
    bg.roundRect(0, 0, w, BUTTON_H, BUTTON_RADIUS);
    bg.fill({ color: currentFill });
    label.x = BUTTON_PAD_H;
    label.y = BUTTON_PAD_V + 1;
  };

  redraw();
  c.on("pointertap", (e) => {
    e.stopPropagation();
    onClick();
  });

  return {
    container: c,
    setLabel(t: string) {
      label.text = t;
      redraw();
    },
    setColor(f: number) {
      currentFill = f;
      redraw();
    },
    setVisible(v: boolean) {
      c.visible = v;
    },
    getWidth() {
      return label.width + BUTTON_PAD_H * 2;
    },
  };
}

// ---------------------------------------------------------------------------
// nav button drawing
// ---------------------------------------------------------------------------

export function drawChevron(g: Graphics, direction: "left" | "right", w: number, h: number) {
  g.clear();
  g.roundRect(0, 0, w, h, NAV_BTN_RADIUS);
  g.fill({ color: 0x000000, alpha: 0.45 });

  const cx = w / 2;
  const cy = h / 2;
  const arm = 8;
  g.moveTo(direction === "left" ? cx + arm * 0.4 : cx - arm * 0.4, cy - arm);
  g.lineTo(direction === "left" ? cx - arm * 0.4 : cx + arm * 0.4, cy);
  g.lineTo(direction === "left" ? cx + arm * 0.4 : cx - arm * 0.4, cy + arm);
  g.stroke({ color: 0xffffff, width: 2.5, cap: "round", join: "round" });
}

export function drawGoToStartButton(g: Graphics, size: number) {
  g.clear();
  g.roundRect(0, 0, size, size, 4);
  g.fill({ color: 0x000000, alpha: 0.45 });

  const cx = size / 2;
  const cy = size / 2;
  const arm = 5;
  g.moveTo(cx - arm + 1, cy - arm);
  g.lineTo(cx - arm + 1, cy + arm);
  g.stroke({ color: 0xffffff, width: 2, cap: "round" });
  g.moveTo(cx + 2, cy - arm);
  g.lineTo(cx - arm + 4, cy);
  g.lineTo(cx + 2, cy + arm);
  g.stroke({ color: 0xffffff, width: 2, cap: "round", join: "round" });
}

// ---------------------------------------------------------------------------
// sprite fitting
// ---------------------------------------------------------------------------

export function fitSpriteToRegion(
  sprite: Sprite,
  texture: Texture,
  regionX: number,
  regionY: number,
  regionW: number,
  regionH: number
) {
  const imgW = texture.width;
  const imgH = texture.height;
  if (imgW === 0 || imgH === 0) return;

  const scale = Math.min(regionW / imgW, regionH / imgH);
  sprite.width = imgW * scale;
  sprite.height = imgH * scale;
  sprite.x = regionX + (regionW - sprite.width) / 2;
  sprite.y = regionY + (regionH - sprite.height) / 2;
}
