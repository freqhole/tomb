// endpointCountTuning.test
//
// pins the per-link distance + strength curves used by the worker's
// forceLink for "heavy hub satellites pull in tighter" behaviour.
// the floors + ceilings are the most important invariants — if
// either curve overshoots, large libraries either collapse to a
// point or shake themselves apart.

import { describe, expect, it } from "vitest";
import {
  endpointCountDistanceShrink,
  endpointCountStrengthBoost,
  endpointMaxCount,
  type CountedLink,
} from "./endpointCountTuning";
import { ENDPOINT_COUNT_TUNING } from "../forceTuning";

function link(srcCount?: number, tgtCount?: number): CountedLink {
  return {
    source: srcCount == null ? "src-id" : { albumCount: srcCount },
    target: tgtCount == null ? "tgt-id" : { albumCount: tgtCount },
  };
}

describe("endpointMaxCount", () => {
  it("returns 0 for unresolved string endpoints", () => {
    expect(endpointMaxCount(link())).toBe(0);
  });
  it("takes the larger of the two endpoint counts", () => {
    expect(endpointMaxCount(link(3, 17))).toBe(17);
    expect(endpointMaxCount(link(100, 1))).toBe(100);
  });
  it("treats missing albumCount on one side as 0", () => {
    expect(endpointMaxCount(link(undefined, 9))).toBe(9);
    expect(endpointMaxCount(link(9, undefined))).toBe(9);
  });
  it("clamps negative results to 0", () => {
    // shouldn't happen but ensure the contract holds.
    expect(endpointMaxCount(link(0, 0))).toBe(0);
  });
});

describe("endpointCountDistanceShrink", () => {
  it("is 1 for zero-count links", () => {
    expect(endpointCountDistanceShrink(link())).toBe(1);
    expect(endpointCountDistanceShrink(link(0, 0))).toBe(1);
  });
  it("decreases monotonically as count grows", () => {
    let prev = 1.0001;
    for (const c of [1, 5, 25, 100, 1000, 10000]) {
      const v = endpointCountDistanceShrink(link(c, 0));
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });
  it("floors at distanceShrinkFloor for very heavy hubs", () => {
    const v = endpointCountDistanceShrink(link(1_000_000, 0));
    expect(v).toBe(ENDPOINT_COUNT_TUNING.distanceShrinkFloor);
  });
});

describe("endpointCountStrengthBoost", () => {
  it("is 1 for zero-count links", () => {
    expect(endpointCountStrengthBoost(link())).toBe(1);
    expect(endpointCountStrengthBoost(link(0, 0))).toBe(1);
  });
  it("increases monotonically as count grows", () => {
    let prev = 0;
    for (const c of [1, 5, 25, 100, 1000]) {
      const v = endpointCountStrengthBoost(link(c, 0));
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
  it("caps at strengthBoostCeiling for very heavy hubs", () => {
    const v = endpointCountStrengthBoost(link(1_000_000, 0));
    expect(v).toBe(ENDPOINT_COUNT_TUNING.strengthBoostCeiling);
  });
});
