// adaptAlbum.test
//
// covers: taxon kind mapping (genre/mood/style/label/era), legacy
// genres[] fallback, 5-year era bucket fallback, image preference,
// remote-prefixed node id.

import { describe, expect, it } from "vitest";
import { adaptAlbum, albumNodeId, yearBucketEra } from "./adaptAlbum";
import type { AlbumSummary } from "../../../music/data/types";

function baseSummary(overrides: Partial<AlbumSummary> = {}): AlbumSummary {
  return {
    album_id: "alb-1",
    title: "test album",
    artist_id: "art-1",
    artist_name: "test artist",
    album_type: "album",
    song_count: 10,
    total_duration: 2400,
    ...overrides,
  };
}

describe("yearBucketEra", () => {
  it("buckets in 5-year increments", () => {
    expect(yearBucketEra(1993)).toBe("1990-1994");
    expect(yearBucketEra(2001)).toBe("2000-2004");
    expect(yearBucketEra(2025)).toBe("2025-2029");
  });
  it("returns null for nullish or non-finite", () => {
    expect(yearBucketEra(null)).toBeNull();
    expect(yearBucketEra(undefined)).toBeNull();
    expect(yearBucketEra(Number.NaN)).toBeNull();
  });
});

describe("albumNodeId", () => {
  it("namespaces by remote id", () => {
    expect(albumNodeId("local", "alb-1")).toBe("local::alb-1");
    expect(albumNodeId("remote-x", "alb-1")).toBe("remote-x::alb-1");
  });
});

describe("adaptAlbum", () => {
  it("maps taxons by kind_slug", () => {
    const node = adaptAlbum(
      baseSummary({
        taxons: [
          { id: "g1", kind_slug: "genre", label: "electronic" },
          { id: "g2", kind_slug: "genre", label: "ambient" },
          { id: "m1", kind_slug: "mood", label: "dreamy" },
          { id: "s1", kind_slug: "style", label: "idm" },
          { id: "l1", kind_slug: "label", label: "warp" },
          { id: "e1", kind_slug: "era", label: "early-90s" },
        ],
      }),
      { remoteId: "local" },
    );
    expect(node.genres).toEqual(["electronic", "ambient"]);
    expect(node.moods).toEqual(["dreamy"]);
    expect(node.styles).toEqual(["idm"]);
    expect(node.label).toBe("warp");
    expect(node.era).toBe("early-90s");
  });

  it("falls back to legacy genres[] when no genre taxons exist", () => {
    const node = adaptAlbum(
      baseSummary({
        genres: [
          { id: "g1", name: "rock" },
          { id: "g2", name: "post-punk" },
        ],
      }),
      { remoteId: "local" },
    );
    expect(node.genres).toEqual(["rock", "post-punk"]);
  });

  it("falls back to 5-year era bucket when no era taxon", () => {
    const node = adaptAlbum(baseSummary({ year: 1993 }), { remoteId: "local" });
    expect(node.era).toBe("1990-1994");
  });

  it("uses null era when no taxon and no year", () => {
    const node = adaptAlbum(baseSummary({}), { remoteId: "local" });
    expect(node.era).toBeNull();
  });

  it("prefers is_primary image, falls back to remote_blob_id route", () => {
    const node = adaptAlbum(
      baseSummary({
        images: [
          {
            remote_blob_id: "blob-a",
            is_primary: false,
            blob_type: "thumbnail",
          },
          {
            remote_url: "https://cdn/x.jpg",
            is_primary: true,
            blob_type: "thumbnail",
          },
        ],
      }),
      { remoteId: "local" },
    );
    expect(node.imageUrl).toBe("https://cdn/x.jpg");

    const node2 = adaptAlbum(
      baseSummary({
        images: [
          { remote_blob_id: "blob-a", is_primary: true, blob_type: "thumbnail" },
        ],
      }),
      { remoteId: "local" },
    );
    expect(node2.imageUrl).toBe("/api/v1/blobs/blob-a");
  });

  it("namespaces the node id by remote so multi-remote collisions are avoided", () => {
    const a = adaptAlbum(baseSummary({ album_id: "shared" }), { remoteId: "local" });
    const b = adaptAlbum(baseSummary({ album_id: "shared" }), { remoteId: "remote-x" });
    expect(a.id).not.toBe(b.id);
    expect(a.sourceRemoteId).toBe("local");
    expect(b.sourceRemoteId).toBe("remote-x");
  });

  it("captures unknown kind_slugs into customTaxons and keeps well-known fields empty", () => {
    const node = adaptAlbum(
      baseSummary({
        taxons: [{ id: "v1", kind_slug: "vibe", label: "dreamy" }],
      }),
      { remoteId: "local" },
    );
    expect(node.customTaxons).toEqual({ vibe: ["dreamy"] });
    expect(node.genres).toEqual([]);
    expect(node.moods).toEqual([]);
  });

  it("defaults customTaxons to {} when no taxons are present", () => {
    const node = adaptAlbum(baseSummary({}), { remoteId: "local" });
    expect(node.customTaxons).toEqual({});
  });
});
