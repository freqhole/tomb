import { describe, expect, it } from "vitest";
import { createAnimator, DURATION_MS_DEFAULT, EASING_DEFAULT } from "./animate";

function snap(ids: string[], pts: Record<string, [number, number]>) {
  return {
    order: ids,
    positions: new Map(ids.map((id) => [id, { x: pts[id][0], y: pts[id][1] }])),
  };
}

describe("createAnimator", () => {
  it("lerps positions for nodes in both snapshots", () => {
    const a = createAnimator();
    a.start(
      snap(["x"], { x: [0, 0] }),
      snap(["x"], { x: [100, 200] }),
      100,
    );
    const start = a.tick(0);
    expect(start.buf[0]).toBeCloseTo(0, 5);
    expect(start.buf[1]).toBeCloseTo(0, 5);

    // halfway in raw time → eased curve > 0.5 (ease-out-cubic).
    const mid = a.tick(50);
    expect(mid.buf[0]).toBeGreaterThan(50);
    expect(mid.buf[1]).toBeGreaterThan(100);
    expect(mid.done).toBe(false);

    const end = a.tick(100);
    expect(end.buf[0]).toBeCloseTo(100, 5);
    expect(end.buf[1]).toBeCloseTo(200, 5);
    expect(end.done).toBe(true);
    expect(a.isAnimating()).toBe(false);
  });

  it("fades in new nodes (alpha 0 → 1) at the destination", () => {
    const a = createAnimator();
    a.start(
      snap([], {}),
      snap(["new"], { new: [10, 20] }),
      100,
    );
    const start = a.tick(0);
    expect(start.alphas[0]).toBe(0);
    expect(start.buf[0]).toBe(10);
    expect(start.buf[1]).toBe(20);

    const end = a.tick(100);
    expect(end.alphas[0]).toBe(1);
  });

  it("ease-out-cubic applies (t=0.5 → eased ≈ 0.875)", () => {
    expect(EASING_DEFAULT(0)).toBe(0);
    expect(EASING_DEFAULT(1)).toBe(1);
    expect(EASING_DEFAULT(0.5)).toBeCloseTo(1 - Math.pow(0.5, 3), 6);
  });

  it("uses the default duration when none is given", () => {
    const a = createAnimator();
    a.start(snap(["x"], { x: [0, 0] }), snap(["x"], { x: [1, 1] }));
    a.tick(0);
    const half = a.tick(DURATION_MS_DEFAULT / 2);
    expect(half.done).toBe(false);
    const end = a.tick(DURATION_MS_DEFAULT);
    expect(end.done).toBe(true);
  });

  it("currentOrder mirrors the to-snapshot order", () => {
    const a = createAnimator();
    a.start(snap([], {}), snap(["a", "b", "c"], { a: [0, 0], b: [1, 1], c: [2, 2] }), 50);
    expect(a.currentOrder()).toEqual(["a", "b", "c"]);
  });

  it("clamps elapsed beyond duration to the final frame", () => {
    const a = createAnimator();
    a.start(snap(["x"], { x: [0, 0] }), snap(["x"], { x: [10, 10] }), 100);
    a.tick(0);
    const beyond = a.tick(1000);
    expect(beyond.buf[0]).toBeCloseTo(10, 5);
    expect(beyond.done).toBe(true);
  });
});
