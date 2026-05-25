// hitGeometry.test
//
// covers the pure shape-aware hit-test geometry helpers extracted
// from GraphCanvas.tsx (phase 12). these helpers don't know about
// solid, the dom, or the worker — they're math over the sim node
// list, and that's exactly what we want to lock in here so future
// canvas decomposition can't silently change hit semantics.

import { describe, expect, it } from "vitest";
import {
  currentMaxHubCount,
  effectiveHitRadius,
  effectiveNodeSize,
  refineHit,
  type SimNode,
} from "./hitGeometry";
import { HUB_PREFIX } from "../hubNodes";
import type { ArtistNodeData } from "../types";

function album(id: string, overrides: Partial<SimNode> = {}): SimNode {
  return {
    id,
    kind: "album",
    title: id,
    artistId: "a",
    artistName: "a",
    year: null,
    imageUrl: null,
    image: null,
    genres: [],
    tags: [],
    moods: [],
    styles: [],
    label: null,
    era: null,
    trackCount: 0,
    totalDurationSec: 0,
    x: 0,
    y: 0,
    ...overrides,
  } as unknown as SimNode;
}

function artist(id: string, overrides: Partial<ArtistNodeData & SimNode> = {}): SimNode {
  return {
    id: `artist::${id}`,
    kind: "artist",
    artistId: id,
    name: id,
    abbreviation: id.slice(0, 3).toUpperCase(),
    imageUrl: null,
    image: null,
    albumCount: 1,
    genres: [],
    tags: [],
    moods: [],
    styles: [],
    label: null,
    era: null,
    x: 0,
    y: 0,
    ...overrides,
  } as unknown as SimNode;
}

function remoteHub(remoteId: string, albumCount: number, x = 0, y = 0): SimNode {
  return artist(remoteId, {
    id: `${HUB_PREFIX.remote}${remoteId}`,
    artistId: `${HUB_PREFIX.remote}${remoteId}`,
    albumCount,
    x,
    y,
  });
}

function relationHub(remoteId: string, kind: string, albumCount: number): SimNode {
  return artist(`${remoteId}::${kind}`, {
    id: `${HUB_PREFIX.relation}${remoteId}::${kind}`,
    artistId: `${HUB_PREFIX.relation}${remoteId}::${kind}`,
    albumCount,
  });
}

describe("currentMaxHubCount", () => {
  it("returns 0 with no hubs", () => {
    expect(currentMaxHubCount([])).toBe(0);
    expect(currentMaxHubCount([album("a"), artist("x")])).toBe(0);
  });
  it("returns the largest albumCount across hub nodes", () => {
    const nodes = [
      album("a"),
      remoteHub("r1", 3),
      remoteHub("r2", 17),
      relationHub("r1", "tag", 9),
      // non-hub artists are ignored even when they carry counts
      artist("x", { albumCount: 99 }),
    ];
    expect(currentMaxHubCount(nodes)).toBe(17);
  });
});

describe("effectiveNodeSize", () => {
  it("returns the base size for non-hub nodes", () => {
    expect(effectiveNodeSize(album("a"), 56, 10)).toBe(56);
    expect(effectiveNodeSize(artist("x", { albumCount: 5 }), 56, 10)).toBe(56);
  });
  it("scales hubs by hubSizeMul(count, max)", () => {
    const max = 100;
    const small = effectiveNodeSize(remoteHub("r", 1), 56, max);
    const big = effectiveNodeSize(remoteHub("r", 100), 56, max);
    // sqrt curve floors at 0.7 * base for the smallest hub and
    // caps at 1.6 * base for the largest in the peer group.
    expect(small).toBeLessThan(56);
    expect(big).toBeGreaterThan(56);
    expect(big).toBeGreaterThan(small);
    expect(big).toBeLessThanOrEqual(56 * 1.6 + 1e-9);
    expect(small).toBeGreaterThanOrEqual(56 * 0.7 - 1e-9);
  });
});

describe("effectiveHitRadius", () => {
  it("uses per-role inradius factor (album=0.55, artist=0.5)", () => {
    // at k=1, the screen-pixel floor is 12 — make sure base size is
    // big enough that the role factor wins.
    const base = 100;
    const max = 10;
    const albumR = effectiveHitRadius(album("a"), 1, base, max);
    const artistR = effectiveHitRadius(artist("x"), 1, base, max);
    expect(albumR).toBeCloseTo(base * 0.55);
    expect(artistR).toBeCloseTo(base * 0.5);
  });
  it("uses remoteHub factor 0.42 for remote hubs (scaled by hub size)", () => {
    const base = 100;
    const max = 100;
    // count == max → ratio=1 → hubSizeMul = HUB_SIZE_MAX_MUL = 1.6
    const r = effectiveHitRadius(remoteHub("r", 100), 1, base, max);
    expect(r).toBeCloseTo(base * 1.6 * 0.42);
  });
  it("floors at 12 screen pixels for tiny zoom-out", () => {
    const base = 1;
    const k = 0.1;
    const r = effectiveHitRadius(album("a"), k, base, 0);
    expect(r).toBe(12 / k);
  });
});

describe("refineHit", () => {
  const base = 100;
  it("returns null for null input", () => {
    expect(refineHit(null, 0, 0, 1, base, 0)).toBeNull();
  });
  it("accepts a click at the node center", () => {
    const n = album("a", { x: 50, y: 50 });
    expect(refineHit(n, 50, 50, 1, base, 0)).toBe(n);
  });
  it("accepts a click inside the inradius", () => {
    const n = album("a", { x: 0, y: 0 });
    // album inradius factor is 0.55 → 55 world units at base=100
    expect(refineHit(n, 40, 0, 1, base, 0)).toBe(n);
  });
  it("rejects a click outside the inradius", () => {
    const n = artist("x", { x: 0, y: 0 });
    // artist inradius factor is 0.5 → 50 world units at base=100
    expect(refineHit(n, 80, 0, 1, base, 0)).toBeNull();
  });
});
