// seedGrouping.test
//
// locks in the pure seed-bucket key derivation + hub lane offsets
// extracted from GraphCanvas.rebuild() in phase 12. these helpers
// drive where brand-new nodes land at first render — regressing
// them would silently re-introduce the "all hexagons collapse onto
// one spot" bug that the hashed-angle ring slots were designed to
// prevent.

import { describe, expect, it } from "vitest";
import {
  familyOf,
  hashAngle,
  hubLaneOffset,
  seedGroupKey,
  strHash,
} from "./seedGrouping";
import { HUB_PREFIX } from "../hubNodes";
import type { AlbumNodeData, ArtistNodeData } from "../types";

function album(overrides: Partial<AlbumNodeData> = {}): AlbumNodeData {
  return {
    id: "alb-1",
    kind: "album",
    title: "t",
    artistId: "art-1",
    artistName: "n",
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
    ...overrides,
  } as AlbumNodeData;
}

function artist(overrides: Partial<ArtistNodeData> = {}): ArtistNodeData {
  return {
    id: "artist::a",
    kind: "artist",
    artistId: "a",
    name: "a",
    abbreviation: "A",
    imageUrl: null,
    image: null,
    albumCount: 1,
    genres: [],
    tags: [],
    moods: [],
    styles: [],
    label: null,
    era: null,
    ...overrides,
  } as ArtistNodeData;
}

describe("strHash / hashAngle", () => {
  it("is deterministic across calls", () => {
    expect(strHash("hello")).toBe(strHash("hello"));
    expect(hashAngle("hello")).toBe(hashAngle("hello"));
  });
  it("hashAngle stays in [0, 2π)", () => {
    for (const s of ["a", "b", "remote::x", "value::tag"]) {
      const a = hashAngle(s);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(Math.PI * 2);
    }
  });
});

describe("seedGroupKey — albums", () => {
  it("prefers artistId", () => {
    expect(seedGroupKey(album({ artistId: "x", artistName: "y" }))).toBe(
      "artist:x",
    );
  });
  it("falls back through artistName → label → era → genre → ungrouped", () => {
    expect(
      seedGroupKey(
        album({ artistId: "", artistName: "Foo Bar" }),
      ),
    ).toBe("artist_name:foo bar");
    expect(
      seedGroupKey(
        album({ artistId: "", artistName: "", label: "Indie" }),
      ),
    ).toBe("label:indie");
    expect(
      seedGroupKey(album({ artistId: "", artistName: "", era: "1990s" })),
    ).toBe("era:1990s");
    expect(
      seedGroupKey(
        album({ artistId: "", artistName: "", genres: ["Rock"] }),
      ),
    ).toBe("genre:rock");
    expect(seedGroupKey(album({ artistId: "", artistName: "" }))).toBe(
      "album:ungrouped",
    );
  });
});

describe("seedGroupKey — synthetic hubs", () => {
  it("buckets remote hubs by remote id", () => {
    const n = artist({ artistId: `${HUB_PREFIX.remote}remoteA` });
    expect(seedGroupKey(n)).toBe(`hub:remote:${HUB_PREFIX.remote}remoteA`);
  });
  it("buckets relation hubs by parent remote id", () => {
    const n = artist({
      artistId: `${HUB_PREFIX.relation}remoteA::tag`,
    });
    expect(seedGroupKey(n)).toBe("hub:relation:remoteA");
  });
  it("buckets value hubs by kind, not remote", () => {
    const n = artist({
      artistId: `${HUB_PREFIX.relationValue}tag::indie`,
    });
    expect(seedGroupKey(n)).toBe("hub:relation_value:tag");
  });
});

describe("seedGroupKey — non-hub artists", () => {
  it("prefers artistId, falls back to label/era/genre/ungrouped", () => {
    expect(seedGroupKey(artist({ artistId: "x" }))).toBe("artist:x");
    expect(seedGroupKey(artist({ artistId: "", label: "L" }))).toBe(
      "label:l",
    );
    expect(seedGroupKey(artist({ artistId: "", era: "E" }))).toBe("era:e");
    expect(seedGroupKey(artist({ artistId: "", genres: ["G"] }))).toBe(
      "genre:g",
    );
    expect(seedGroupKey(artist({ artistId: "" }))).toBe("artist:ungrouped");
  });
});

describe("hubLaneOffset", () => {
  it("returns null for non-hub keys", () => {
    expect(hubLaneOffset("artist:x")).toBeNull();
    expect(hubLaneOffset("label:rock")).toBeNull();
    expect(hubLaneOffset("album:ungrouped")).toBeNull();
  });
  it("places remote + relation buckets on the same angle (radius 0.95)", () => {
    const r = hubLaneOffset("hub:remote:remoteA")!;
    const rel = hubLaneOffset("hub:relation:remoteA")!;
    expect(r).not.toBeNull();
    expect(rel).not.toBeNull();
    expect(r.ox).toBeCloseTo(rel.ox);
    expect(r.oy).toBeCloseTo(rel.oy);
    expect(Math.hypot(r.ox, r.oy)).toBeCloseTo(0.95);
  });
  it("places value hubs further out (radius 1.2) on a kind-hashed angle", () => {
    const v = hubLaneOffset("hub:relation_value:tag")!;
    expect(v).not.toBeNull();
    expect(Math.hypot(v.ox, v.oy)).toBeCloseTo(1.2);
  });
  it("different remotes get different angles", () => {
    const a = hubLaneOffset("hub:remote:alpha")!;
    const b = hubLaneOffset("hub:remote:beta")!;
    // extraordinarily unlikely to collide for distinct fnv-1a hashes
    expect(a.ox !== b.ox || a.oy !== b.oy).toBe(true);
  });
});

describe("familyOf", () => {
  it("returns the prefix before the first colon", () => {
    expect(familyOf("artist:x")).toBe("artist");
    expect(familyOf("hub:remote:alpha")).toBe("hub");
    expect(familyOf("hub:relation_value:tag")).toBe("hub");
  });
  it("returns the whole key when no colon present", () => {
    expect(familyOf("ungrouped")).toBe("ungrouped");
  });
});
