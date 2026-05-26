import { describe, expect, it } from "vitest";
import {
  distributeWedges,
  MIN_WEDGE_RAD,
  nodeRadiusFor,
  placeChildrenInWedge,
  WEDGE_GAP_FRAC,
} from "./wedge";
import type { LayoutNode, Wedge } from "./types";

const FULL_CIRCLE: Wedge = { center: 0, halfWidth: Math.PI };

describe("distributeWedges", () => {
  it("returns empty for no children", () => {
    expect(distributeWedges(FULL_CIRCLE, [])).toEqual([]);
  });

  it("evenly slices the full circle for equal-weight kids", () => {
    const kids = [
      { id: "a", subtreeCount: 5 },
      { id: "b", subtreeCount: 5 },
      { id: "c", subtreeCount: 5 },
      { id: "d", subtreeCount: 5 },
    ];
    const w = distributeWedges(FULL_CIRCLE, kids);
    expect(w).toHaveLength(4);
    for (const slice of w) {
      expect(slice.halfWidth).toBeCloseTo(Math.PI / 4, 6);
    }
    // sum of widths equals 2π for the pivot case (no inter-wedge gap).
    const total = w.reduce((s, x) => s + 2 * x.halfWidth, 0);
    expect(total).toBeCloseTo(2 * Math.PI, 6);
  });

  it("gives heavier subtrees a larger wedge", () => {
    const kids = [
      { id: "small", subtreeCount: 1 },
      { id: "big", subtreeCount: 100 },
    ];
    const [a, b] = distributeWedges(FULL_CIRCLE, kids);
    expect(b.halfWidth).toBeGreaterThan(a.halfWidth);
  });

  it("applies MIN_WEDGE_RAD floor at the full circle", () => {
    // dominant hub would normally crush the other 5 to slivers.
    const kids = [
      { id: "huge", subtreeCount: 10000 },
      { id: "tiny1", subtreeCount: 0 },
      { id: "tiny2", subtreeCount: 0 },
      { id: "tiny3", subtreeCount: 0 },
      { id: "tiny4", subtreeCount: 0 },
      { id: "tiny5", subtreeCount: 0 },
    ];
    const w = distributeWedges(FULL_CIRCLE, kids);
    for (let i = 1; i < w.length; i++) {
      expect(2 * w[i].halfWidth).toBeGreaterThanOrEqual(MIN_WEDGE_RAD - 1e-9);
    }
  });

  it("respects parent's wedge bounds for narrow petals", () => {
    const parent: Wedge = { center: Math.PI / 2, halfWidth: Math.PI / 6 };
    const kids = [
      { id: "a", subtreeCount: 1 },
      { id: "b", subtreeCount: 1 },
    ];
    const w = distributeWedges(parent, kids);
    // every child's wedge must sit inside [center-halfWidth, center+halfWidth].
    for (const slice of w) {
      const lo = slice.center - slice.halfWidth;
      const hi = slice.center + slice.halfWidth;
      expect(lo).toBeGreaterThanOrEqual(parent.center - parent.halfWidth - 1e-6);
      expect(hi).toBeLessThanOrEqual(parent.center + parent.halfWidth + 1e-6);
    }
  });

  it("reserves inter-wedge gaps for non-full-circle parents", () => {
    const parent: Wedge = { center: 0, halfWidth: 1 };
    const kids = [
      { id: "a", subtreeCount: 1 },
      { id: "b", subtreeCount: 1 },
      { id: "c", subtreeCount: 1 },
    ];
    const w = distributeWedges(parent, kids);
    const totalChildWidth = w.reduce((s, x) => s + 2 * x.halfWidth, 0);
    expect(totalChildWidth).toBeLessThan(2 * parent.halfWidth);
    // gaps should account for roughly WEDGE_GAP_FRAC * 2*halfWidth.
    const expectedGapTotal =
      WEDGE_GAP_FRAC * 2 * parent.halfWidth * ((kids.length - 1) / kids.length);
    expect(2 * parent.halfWidth - totalChildWidth).toBeCloseTo(expectedGapTotal, 5);
  });
});

describe("nodeRadiusFor", () => {
  const album: LayoutNode = { id: "alb", kind: "album" };
  const artist: LayoutNode = { id: "art", kind: "artist" };
  const tinyHub: LayoutNode = { id: "h1", kind: "hub", albumCount: 1 };
  const fatHub: LayoutNode = { id: "h2", kind: "hub", albumCount: 100 };

  it("returns base radius for albums and artists", () => {
    expect(nodeRadiusFor(album, 56, 100)).toBeCloseTo(56 * 0.55, 6);
    expect(nodeRadiusFor(artist, 56, 100)).toBeCloseTo(56 * 0.55, 6);
  });

  it("scales hub radius by sqrt-of-count over peer max", () => {
    const r1 = nodeRadiusFor(tinyHub, 56, 100);
    const r2 = nodeRadiusFor(fatHub, 56, 100);
    expect(r2).toBeGreaterThan(r1);
    // fat hub at max count → mul = 1.6.
    expect(r2).toBeCloseTo(56 * 0.55 * 1.6, 6);
  });

  it("floors empty hubs at the min multiplier", () => {
    const empty: LayoutNode = { id: "h0", kind: "hub", albumCount: 0 };
    expect(nodeRadiusFor(empty, 56, 100)).toBeCloseTo(56 * 0.55 * 0.7, 6);
  });
});

describe("placeChildrenInWedge", () => {
  const parentPos = { x: 0, y: 0 };

  it("places all kids when they fit", () => {
    const kids = Array.from({ length: 4 }, (_, i) => ({
      id: `k${i}`,
      subtreeCount: 1,
      radius: 30,
    }));
    const result = placeChildrenInWedge(parentPos, FULL_CIRCLE, 200, kids);
    expect(result.surplus).toEqual([]);
    expect(result.placed).toHaveLength(4);
    // every placed kid sits at distance ringRadius from the parent.
    for (const p of result.placed) {
      const d = Math.hypot(p.x - parentPos.x, p.y - parentPos.y);
      expect(d).toBeCloseTo(200, 5);
    }
  });

  it("collapses surplus into a stub when capacity exceeded", () => {
    // narrow wedge + many large kids → can't fit them all.
    const wedge: Wedge = { center: 0, halfWidth: 0.3 };
    const kids = Array.from({ length: 20 }, (_, i) => ({
      id: `k${i}`,
      subtreeCount: 1,
      radius: 30,
    }));
    const result = placeChildrenInWedge(parentPos, wedge, 150, kids);
    expect(result.surplus.length).toBeGreaterThan(0);
    // last placed slot is the synthetic stub sentinel.
    const last = result.placed[result.placed.length - 1];
    expect(last.id).toBe("__stub__");
    // total placed = visible + 1 stub; visible + surplus = original count.
    const visibleCount = result.placed.length - 1;
    expect(visibleCount + result.surplus.length).toBe(20);
  });

  it("returns no placed children for empty input", () => {
    const result = placeChildrenInWedge(parentPos, FULL_CIRCLE, 200, []);
    expect(result.placed).toEqual([]);
    expect(result.surplus).toEqual([]);
  });

  it("places kids inside the parent wedge bounds", () => {
    const wedge: Wedge = { center: Math.PI / 2, halfWidth: Math.PI / 4 };
    const kids = Array.from({ length: 3 }, (_, i) => ({
      id: `k${i}`,
      subtreeCount: 1,
      radius: 25,
    }));
    const result = placeChildrenInWedge(parentPos, wedge, 200, kids);
    for (const p of result.placed) {
      const angle = Math.atan2(p.y, p.x);
      expect(angle).toBeGreaterThanOrEqual(wedge.center - wedge.halfWidth - 1e-6);
      expect(angle).toBeLessThanOrEqual(wedge.center + wedge.halfWidth + 1e-6);
    }
  });
});
