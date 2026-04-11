// shared icon drawing functions for widget action buttons.
// all icons are drawn into a provided Graphics object at the specified size.
// designed to be readable at small sizes (12-20px) in compact card buttons.

import { Graphics } from "pixi.js";

/**
 * draw a snatch/download icon — downward arrow into a tray.
 * represents "grab this file from peers".
 */
export function drawSnatchIcon(
  g: Graphics,
  x: number,
  y: number,
  size: number,
  color = 0xffffff,
  alpha = 0.9
): void {
  const strokeW = Math.max(1.2, size * 0.12);
  const cx = x + size / 2;
  const top = y + size * 0.1;
  const mid = y + size * 0.55;
  const bottom = y + size * 0.7;
  const headW = size * 0.25;

  // arrow shaft (vertical line going down)
  g.moveTo(cx, top);
  g.lineTo(cx, mid);
  g.stroke({ width: strokeW, color, alpha });

  // arrowhead (V shape pointing down)
  g.moveTo(cx - headW, mid - headW);
  g.lineTo(cx, mid);
  g.lineTo(cx + headW, mid - headW);
  g.stroke({ width: strokeW, color, alpha });

  // tray/platform (horizontal line with short uprights at edges)
  const trayL = x + size * 0.2;
  const trayR = x + size * 0.8;
  // left upright
  g.moveTo(trayL, bottom - size * 0.15);
  g.lineTo(trayL, bottom);
  // bottom bar
  g.lineTo(trayR, bottom);
  // right upright
  g.lineTo(trayR, bottom - size * 0.15);
  g.stroke({ width: strokeW, color, alpha });
}

/**
 * draw a save/floppy disk icon.
 * represents "save to disk" (browser mode).
 */
export function drawSaveIcon(
  g: Graphics,
  x: number,
  y: number,
  size: number,
  color = 0xffffff,
  alpha = 0.9
): void {
  const strokeW = Math.max(1.2, size * 0.12);
  const pad = size * 0.15;
  const l = x + pad;
  const t = y + pad;
  const r = x + size - pad;
  const b = y + size - pad;
  const w = r - l;
  const h = b - t;

  // outer rectangle (the disk body) with chamfered top-right corner
  const chamfer = w * 0.2;
  g.moveTo(l, t);
  g.lineTo(r - chamfer, t);
  g.lineTo(r, t + chamfer);
  g.lineTo(r, b);
  g.lineTo(l, b);
  g.closePath();
  g.stroke({ width: strokeW, color, alpha });

  // label slot — small rectangle in the bottom center
  const slotW = w * 0.5;
  const slotH = h * 0.3;
  const slotX = l + (w - slotW) / 2;
  const slotY = b - slotH - h * 0.08;
  g.rect(slotX, slotY, slotW, slotH);
  g.stroke({ width: Math.max(1, strokeW * 0.8), color, alpha: alpha * 0.7 });

  // shutter notch — small rectangle at top center
  const notchW = w * 0.35;
  const notchH = h * 0.2;
  const notchX = l + (w - notchW) / 2;
  g.rect(notchX, t, notchW, notchH);
  g.stroke({ width: Math.max(1, strokeW * 0.8), color, alpha: alpha * 0.7 });
}

/**
 * draw a reveal/open icon — box with arrow pointing upper-right.
 * represents "reveal in Finder" (Tauri) or "open externally".
 */
export function drawRevealIcon(
  g: Graphics,
  x: number,
  y: number,
  size: number,
  color = 0xffffff,
  alpha = 0.9
): void {
  const strokeW = Math.max(1.2, size * 0.12);
  const pad = size * 0.15;
  const l = x + pad;
  const t = y + pad;
  const r = x + size - pad;
  const b = y + size - pad;

  // box — three sides (left, bottom, right), open at top
  g.moveTo(l, t + (b - t) * 0.3);
  g.lineTo(l, b);
  g.lineTo(r, b);
  g.lineTo(r, t + (b - t) * 0.3);
  g.stroke({ width: strokeW, color, alpha });

  // arrow shaft — from center going to upper-right
  const arrowStartX = l + (r - l) * 0.35;
  const arrowStartY = t + (b - t) * 0.65;
  const arrowEndX = r - (r - l) * 0.05;
  const arrowEndY = t + (b - t) * 0.05;
  g.moveTo(arrowStartX, arrowStartY);
  g.lineTo(arrowEndX, arrowEndY);
  g.stroke({ width: strokeW, color, alpha });

  // arrowhead
  const headLen = (r - l) * 0.2;
  g.moveTo(arrowEndX - headLen, arrowEndY);
  g.lineTo(arrowEndX, arrowEndY);
  g.lineTo(arrowEndX, arrowEndY + headLen);
  g.stroke({ width: strokeW, color, alpha });
}
