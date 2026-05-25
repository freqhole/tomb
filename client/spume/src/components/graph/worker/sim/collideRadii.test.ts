// collideRadii.test
//
// pins the tiered density curve + per-role collide radii. these
// thresholds are felt in every large-library layout, so it's worth
// flagging accidental edits.

import { describe, expect, it } from "vitest";
import {
  collideRadiiForCount,
  densityMultiplierForCount,
} from "./collideRadii";

describe("densityMultiplierForCount", () => {
  it("is 1 below the 700-node threshold", () => {
    expect(densityMultiplierForCount(0)).toBe(1);
    expect(densityMultiplierForCount(1)).toBe(1);
    expect(densityMultiplierForCount(699)).toBe(1);
  });
  it("matches the published tiers at each step", () => {
    expect(densityMultiplierForCount(700)).toBe(1.24);
    expect(densityMultiplierForCount(1200)).toBe(1.45);
    expect(densityMultiplierForCount(2000)).toBe(1.7);
    expect(densityMultiplierForCount(3000)).toBe(1.95);
    expect(densityMultiplierForCount(4000)).toBe(2.2);
    expect(densityMultiplierForCount(50000)).toBe(2.2);
  });
  it("is monotonically non-decreasing across the input range", () => {
    let prev = 0;
    for (let n = 0; n <= 5000; n += 50) {
      const v = densityMultiplierForCount(n);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("collideRadiiForCount", () => {
  it("uses bare per-role multipliers at low density", () => {
    const r = collideRadiiForCount(100, 10);
    expect(r.album).toBeCloseTo(10 * 0.96);
    expect(r.artist).toBeCloseTo(10 * 0.74);
  });
  it("scales both roles up at high density", () => {
    const lo = collideRadiiForCount(100, 10);
    const hi = collideRadiiForCount(4000, 10);
    expect(hi.album).toBeGreaterThan(lo.album);
    expect(hi.artist).toBeGreaterThan(lo.artist);
  });
  it("keeps albums larger than artists at all densities", () => {
    for (const n of [0, 700, 1200, 2000, 3000, 4000]) {
      const r = collideRadiiForCount(n, 12);
      expect(r.album).toBeGreaterThan(r.artist);
    }
  });
});
