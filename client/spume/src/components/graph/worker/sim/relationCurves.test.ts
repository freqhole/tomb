// relationCurves.test
//
// pins the per-kind link-distance + link-strength curves used by
// the worker's forceLink. these are sensitive — small changes
// rebalance every link in every graph — so the test exercises the
// well-known fallback table, the user-tunable override path, and
// the curve monotonicity that the sim assumes.

import { describe, expect, it } from "vitest";
import {
  relationDistanceMultiplier,
  relationStrengthMultiplier,
  relationStrengthValue,
} from "./relationCurves";

describe("relationStrengthValue — fallback table", () => {
  it("returns 0.5 for missing / unknown kinds", () => {
    expect(relationStrengthValue(undefined, undefined)).toBe(0.5);
    expect(relationStrengthValue("", undefined)).toBe(0.5);
    expect(relationStrengthValue("anything", undefined)).toBe(0.5);
    expect(relationStrengthValue("anything", {})).toBe(0.5);
  });
  it("returns baked-in defaults for well-known kinds", () => {
    expect(relationStrengthValue("artist_album", undefined)).toBe(1);
    expect(relationStrengthValue("same_artist", undefined)).toBe(1);
    expect(relationStrengthValue("favorite", undefined)).toBe(0.82);
    expect(relationStrengthValue("related_artist", undefined)).toBe(0.78);
    expect(relationStrengthValue("tag", undefined)).toBe(0.22);
  });
});

describe("relationStrengthValue — override table", () => {
  it("honors a user-supplied strength", () => {
    expect(relationStrengthValue("tag", { tag: 0.9 })).toBe(0.9);
    expect(relationStrengthValue("favorite", { favorite: 0.1 })).toBe(0.1);
  });
  it("clamps overrides to [0, 1]", () => {
    expect(relationStrengthValue("tag", { tag: 5 })).toBe(1);
    expect(relationStrengthValue("tag", { tag: -1 })).toBe(0);
  });
  it("falls back when override is NaN", () => {
    expect(relationStrengthValue("tag", { tag: NaN })).toBe(0.22);
  });
});

describe("curve monotonicity", () => {
  // the sim relies on: stronger relations → shorter distance and
  // stiffer spring. assert that across a sweep of strengths.
  it("relationDistanceMultiplier is monotonically decreasing in strength", () => {
    let prev = Number.POSITIVE_INFINITY;
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      const v = relationDistanceMultiplier("x", { x: s });
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });
  it("relationStrengthMultiplier is monotonically increasing in strength", () => {
    let prev = Number.NEGATIVE_INFINITY;
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      const v = relationStrengthMultiplier("x", { x: s });
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
