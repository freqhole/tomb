import { describe, expect, it } from "vitest";
import { dropdownPosition } from "./dropdownPosition";

describe("dropdown viewport bounds", () => {
  for (const width of [160, 320, 390, 1024]) {
    for (const height of [160, 568, 844]) {
      for (const align of ["left", "right"] as const) {
        it(`fits ${width}x${height} aligned ${align}, including offscreen anchors`, () => {
          const viewport = { width, height, top: 30, left: 15 };
          for (const x of [-200, 20, width - 20, width + 200]) {
            for (const y of [-200, 40, height - 40, height + 200]) {
              const style = dropdownPosition(
                { left: x, right: x + 32, top: y, bottom: y + 32 },
                viewport,
                align
              );
              const maxWidth = parseFloat(String(style["max-width"]));
              const maxHeight = parseFloat(String(style["max-height"]));
              expect(maxWidth).toBeGreaterThanOrEqual(0);
              expect(maxHeight).toBeGreaterThanOrEqual(0);
              expect(maxWidth).toBeLessThanOrEqual(width - 16);
              expect(maxHeight).toBeLessThanOrEqual(height - 16);
              if (align === "left") {
                const left = parseFloat(String(style.left));
                expect(left).toBeGreaterThanOrEqual(viewport.left + 8);
                expect(left + maxWidth).toBeLessThanOrEqual(viewport.left + width - 8);
              } else {
                const edge = Number(/- ([\d.]+)px/.exec(String(style.right))![1]);
                expect(edge - maxWidth).toBeGreaterThanOrEqual(viewport.left + 8);
                expect(edge).toBeLessThanOrEqual(viewport.left + width - 8);
              }
              if (style.top !== undefined) {
                const top = parseFloat(String(style.top));
                expect(top).toBeGreaterThanOrEqual(viewport.top + 8);
                expect(top + maxHeight).toBeLessThanOrEqual(viewport.top + height - 8);
              } else {
                const edge = Number(/- ([\d.]+)px/.exec(String(style.bottom))![1]);
                expect(edge - maxHeight).toBeGreaterThanOrEqual(viewport.top + 8);
                expect(edge).toBeLessThanOrEqual(viewport.top + height - 8);
              }
            }
          }
        });
      }
    }
  }
});
