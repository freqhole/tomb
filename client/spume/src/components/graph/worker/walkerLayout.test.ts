import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WalkNode } from "../types";
import * as ws from "./walkerState";
import { getVisible } from "./walkerLayout";

// walkerState reads the worker global `self` at import time; hoisted so
// it runs before the imports above.
vi.hoisted(() => {
  (globalThis as { self?: unknown }).self ??= globalThis;
});

beforeEach(() => {
  ws.nodeMap.clear();
  ws.childrenOf.clear();
  ws.parentsOf.clear();
  ws.state.hidden.clear();
  ws.state.pinned.clear();
  ws.state.eagerExpansions.clear();
  ws.clusterLeaderOf.clear();
  ws.clusterMembers.clear();
});

function taxonomy(values: number, artistsPerValue: number, albumsPerArtist = 0) {
  addNode("root", "root", null, 1);
  addNode("remote", "remote", "root", 1);
  addNode("kind", "relation", "remote", values);
  for (let v = 0; v < values; v++) {
    const value = `value${v}`;
    addNode(value, "value", "kind", artistsPerValue);
    for (let a = 0; a < artistsPerValue; a++) {
      const artist = `${value}:artist${a}`;
      addNode(artist, "artist", value, albumsPerArtist);
      for (let i = 0; i < albumsPerArtist; i++) addNode(`${artist}:album${i}`, "album", artist);
    }
  }
  ws.state.breadcrumb = ["root", "remote", "kind"];
}

describe("getVisible taxon auto-expansion budget", () => {
  it("shows a large kind's values without automatically opening their artists", () => {
    taxonomy(13, 1);
    const visible = getVisible();
    expect(visible.has("value12")).toBe(true);
    expect(visible.has("value0:artist0")).toBe(false);
    ws.state.breadcrumb.push("value0");
    expect(getVisible().has("value0:artist0")).toBe(true);
  });

  it("limits the combined bloom, not each value independently", () => {
    taxonomy(2, 7);
    expect(getVisible().has("value0:artist0")).toBe(false);
    expect(getVisible().has("value1:artist0")).toBe(false);
  });

  it("counts artists' albums in the same budget", () => {
    taxonomy(2, 1, 6);
    expect(getVisible().has("value0:artist0")).toBe(false);
    expect(getVisible().has("value0:artist0:album0")).toBe(false);
  });

  it("still opens small taxonomies up to the existing twelve-node limit", () => {
    taxonomy(2, 1, 5);
    expect(getVisible().has("value0:artist0")).toBe(true);
    expect(getVisible().has("value1:artist0:album4")).toBe(true);
  });

  it("applies the same limit to a value with many nested values", () => {
    taxonomy(13, 1);
    ws.nodeMap.get("kind")!.role = "value";
    expect(getVisible().has("value12")).toBe(true);
    expect(getVisible().has("value0:artist0")).toBe(false);
  });

  it("preserves explicit expand-all requests", () => {
    taxonomy(13, 1, 2);
    ws.state.eagerExpansions.add("kind");
    expect(getVisible().has("value12:artist0:album1")).toBe(true);
  });
});

function addNode(id: string, role: string, parentId: string | null, childCount = 0) {
  ws.nodeMap.set(id, { id, role, label: id, parentId, childCount } as WalkNode);
  if (parentId) {
    ws.childrenOf.set(parentId, [...(ws.childrenOf.get(parentId) ?? []), id]);
    ws.parentsOf.set(id, [...(ws.parentsOf.get(id) ?? []), parentId]);
  }
}

/** taxon value pivot with one series child holding `videoCount` videos
 *  split across a single season. */
function seriesUnderTaxon(videoCount: number) {
  addNode("root", "root", null, 1);
  addNode("remote", "remote", "root", 1);
  addNode("theme", "relation", "remote", 1);
  addNode("theme:space", "value", "theme", 1);
  addNode("series", "video_series", "theme:space", videoCount);
  addNode("season", "video_season", "series", videoCount);
  for (let i = 0; i < videoCount; i++) addNode(`video${i}`, "video", "season");
  ws.state.breadcrumb = ["root", "remote", "theme", "theme:space"];
}

describe("getVisible video auto-expansion under a taxon pivot", () => {
  it("expands a series when series + videos fit the budget", () => {
    seriesUnderTaxon(9); // 1 series + 9 videos = 10
    const visible = getVisible();
    expect(visible.has("series")).toBe(true);
    expect(visible.has("season")).toBe(true);
    expect(visible.has("video0")).toBe(true);
  });

  it("keeps a series collapsed when series + videos exceed the budget", () => {
    seriesUnderTaxon(10); // 1 series + 10 videos = 11
    const visible = getVisible();
    expect(visible.has("series")).toBe(true);
    expect(visible.has("season")).toBe(false);
    expect(visible.has("video0")).toBe(false);
  });

  it("still blooms a series' own seasons/videos when the series is the pivot", () => {
    seriesUnderTaxon(10);
    ws.state.breadcrumb = ["root", "remote", "theme", "theme:space", "series"];
    const visible = getVisible();
    expect(visible.has("season")).toBe(true);
    expect(visible.has("video0")).toBe(true);
  });
});

/** mirrors maybeLoadVideosForPivot: value -> video and value -> series
 *  edges wired directly on top of the series -> season -> video tree. */
function videosWiredToValue(videoCount: number, standalone = 0) {
  seriesUnderTaxon(videoCount);
  for (let i = 0; i < videoCount; i++) {
    ws.childrenOf.get("theme:space")!.push(`video${i}`);
    ws.parentsOf.get(`video${i}`)!.push("theme:space");
  }
  for (let i = 0; i < standalone; i++) addNode(`solo${i}`, "video", "theme:space");
}

describe("getVisible with videos wired directly to a taxon value", () => {
  it("shows the episodes when series + videos fit the budget", () => {
    videosWiredToValue(5);
    const visible = getVisible();
    expect(visible.has("series")).toBe(true);
    expect(visible.has("video0")).toBe(true);
    expect(visible.has("video4")).toBe(true);
  });

  it("collapses episodes into their series over the budget", () => {
    videosWiredToValue(20, 2);
    const visible = getVisible();
    expect(visible.has("series")).toBe(true);
    expect(visible.has("season")).toBe(false);
    for (let i = 0; i < 20; i++) expect(visible.has(`video${i}`)).toBe(false);
    // standalone videos have no series to collapse into
    expect(visible.has("solo0")).toBe(true);
    expect(visible.has("solo1")).toBe(true);
  });
});
