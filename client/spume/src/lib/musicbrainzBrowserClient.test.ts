// unit tests for musicbrainzBrowserClient
//
// covers:
//   - zod schema parsing (valid, missing optional fields, unknown fields)
//   - mapping helpers (artist credits, track count, label joins, cover art)
//   - encodeQueryTerm (lucene escaping)
//   - hasCoverArt / coverArtThumbUrl
//   - searchReleases / getRelease via fetch mock

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  RawArtistCreditSchema,
  RawTrackSchema,
  RawMediumSchema,
  RawReleaseSchema,
  RawSearchResponseSchema,
  RawCoverArtResponseSchema,
  mapReleaseToListItem,
  mapReleaseToDetail,
  mapCoverArtImages,
  hasCoverArt,
  coverArtThumbUrl,
  encodeQueryTerm,
  MusicBrainzBrowserClient,
  type RawRelease,
} from "./musicbrainzBrowserClient";

// -------------------------------------------------------------------------
// schema parsing
// -------------------------------------------------------------------------

describe("RawArtistCreditSchema", () => {
  it("parses a minimal credit", () => {
    const result = RawArtistCreditSchema.parse({ name: "slowdive" });
    expect(result.name).toBe("slowdive");
    expect(result.joinphrase).toBeUndefined();
  });

  it("passes through joinphrase and artist", () => {
    const result = RawArtistCreditSchema.parse({
      name: "slowdive",
      joinphrase: " & ",
      artist: { id: "abc", name: "Slowdive" },
    });
    expect(result.joinphrase).toBe(" & ");
    expect(result.artist?.id).toBe("abc");
  });

  it("accepts null joinphrase", () => {
    const result = RawArtistCreditSchema.parse({ name: "grouper", joinphrase: null });
    expect(result.joinphrase).toBeNull();
  });

  it("strips unknown fields", () => {
    const result = RawArtistCreditSchema.parse({ name: "x", unknown: true }) as Record<string, unknown>;
    expect(result["unknown"]).toBeUndefined();
  });
});

describe("RawTrackSchema", () => {
  it("parses a minimal track", () => {
    const result = RawTrackSchema.parse({ title: "loomer" });
    expect(result.title).toBe("loomer");
    expect(result.position).toBeUndefined();
    expect(result.length).toBeUndefined();
  });

  it("parses a full track with recording fallback", () => {
    const result = RawTrackSchema.parse({
      position: 2,
      title: "loomer",
      length: 240000,
      "artist-credit": [{ name: "my bloody valentine" }],
      recording: { length: 240001 },
    });
    expect(result.position).toBe(2);
    expect(result.length).toBe(240000);
  });
});

describe("RawSearchResponseSchema", () => {
  it("defaults releases, count, offset when absent", () => {
    const result = RawSearchResponseSchema.parse({});
    expect(result.releases).toEqual([]);
    expect(result.count).toBe(0);
    expect(result.offset).toBe(0);
  });
});

describe("RawCoverArtResponseSchema", () => {
  it("defaults images to empty array", () => {
    const result = RawCoverArtResponseSchema.parse({});
    expect(result.images).toEqual([]);
  });

  it("accepts numeric id on images", () => {
    const result = RawCoverArtResponseSchema.parse({
      images: [{ id: 12345, image: "https://example.com/img.jpg", types: [], front: true, back: false }],
    });
    expect(result.images[0]?.id).toBe(12345);
  });
});

describe("RawReleaseSchema", () => {
  it("rejects a release with no id", () => {
    expect(() => RawReleaseSchema.parse({ title: "loveless" })).toThrow();
  });

  it("parses a minimal valid release", () => {
    const result = RawReleaseSchema.parse({ id: "abc123", title: "loveless" });
    expect(result.id).toBe("abc123");
    expect(result.date).toBeUndefined();
    expect(result.media).toBeUndefined();
  });

  it("tolerates extra unknown top-level fields", () => {
    // zod strips unknown keys by default
    const result = RawReleaseSchema.parse({ id: "x", title: "y", _extra: "ignored" }) as Record<string, unknown>;
    expect(result["_extra"]).toBeUndefined();
  });
});

// -------------------------------------------------------------------------
// mapping helpers
// -------------------------------------------------------------------------

function makeRelease(overrides: Partial<RawRelease> = {}): RawRelease {
  return {
    id: "release-id",
    title: "loveless",
    "artist-credit": [{ name: "my bloody valentine", joinphrase: null }],
    ...overrides,
  };
}

describe("mapReleaseToListItem", () => {
  it("maps basic fields", () => {
    const item = mapReleaseToListItem(makeRelease({ date: "1991-11-04", country: "GB", status: "Official" }));
    expect(item.id).toBe("release-id");
    expect(item.title).toBe("loveless");
    expect(item.date).toBe("1991-11-04");
    expect(item.country).toBe("GB");
    expect(item.status).toBe("Official");
  });

  it("builds cover_art_url from id", () => {
    const item = mapReleaseToListItem(makeRelease());
    expect(item.cover_art_url).toBe("https://coverartarchive.org/release/release-id/front-250");
  });

  it("sums track count across media", () => {
    const item = mapReleaseToListItem(
      makeRelease({
        media: [
          { "track-count": 9 },
          { "track-count": 4 },
        ],
      })
    );
    expect(item.track_count).toBe(13);
  });

  it("joins multiple labels with / separator", () => {
    const item = mapReleaseToListItem(
      makeRelease({
        "label-info": [
          { label: { name: "Creation Records" } },
          { label: { name: "Sire" } },
        ],
      })
    );
    expect(item.label).toBe("Creation Records / Sire");
  });

  it("deduplicates labels", () => {
    const item = mapReleaseToListItem(
      makeRelease({
        "label-info": [
          { label: { name: "Creation Records" } },
          { label: { name: "Creation Records" } },
        ],
      })
    );
    expect(item.label).toBe("Creation Records");
  });

  it("returns null label when label-info is empty", () => {
    const item = mapReleaseToListItem(makeRelease({ "label-info": [] }));
    expect(item.label).toBeNull();
  });

  it("reads primary_type and secondary_types from release-group", () => {
    const item = mapReleaseToListItem(
      makeRelease({
        "release-group": { "primary-type": "Album", "secondary-types": ["Live"] },
      })
    );
    expect(item.primary_type).toBe("Album");
    expect(item.secondary_types).toEqual(["Live"]);
  });

  it("sets has_cover_art from cover-art-archive.front", () => {
    const withArt = mapReleaseToListItem(makeRelease({ "cover-art-archive": { front: true } }));
    const withoutArt = mapReleaseToListItem(makeRelease({ "cover-art-archive": { front: false } }));
    expect(withArt.has_cover_art).toBe(true);
    expect(withoutArt.has_cover_art).toBe(false);
  });

  it("joins formats across media", () => {
    const item = mapReleaseToListItem(
      makeRelease({
        media: [
          { format: "CD", "track-count": 9 },
          { format: "CD", "track-count": 2 },
          { format: "Vinyl", "track-count": 1 },
        ],
      })
    );
    expect(item.format).toBe("CD + Vinyl");
  });
});

describe("mapReleaseToDetail", () => {
  it("maps media with tracks", () => {
    const detail = mapReleaseToDetail(
      makeRelease({
        media: [
          {
            position: 1,
            format: "CD",
            "track-count": 2,
            tracks: [
              { title: "only shallow", position: 1, length: 274000 },
              { title: "loomer", position: 2, length: 240000 },
            ],
          },
        ],
      })
    );
    expect(detail.media).toHaveLength(1);
    expect(detail.media[0]?.tracks).toHaveLength(2);
    expect(detail.media[0]?.tracks[0]?.title).toBe("only shallow");
    expect(detail.media[0]?.tracks[0]?.length_ms).toBe(274000);
  });

  it("prefers release-group genres over release genres when rg has more", () => {
    const detail = mapReleaseToDetail(
      makeRelease({
        genres: [{ name: "shoegaze", count: 1 }],
        "release-group": {
          genres: [
            { name: "shoegaze", count: 10 },
            { name: "dream pop", count: 5 },
          ],
        },
      })
    );
    expect(detail.genres).toEqual(["shoegaze", "dream pop"]);
  });

  it("sorts genres by count descending", () => {
    const detail = mapReleaseToDetail(
      makeRelease({
        genres: [
          { name: "ambient", count: 2 },
          { name: "shoegaze", count: 8 },
          { name: "noise", count: 5 },
        ],
      })
    );
    expect(detail.genres[0]).toBe("shoegaze");
    expect(detail.genres[1]).toBe("noise");
  });

  it("starts with empty cover_art_images", () => {
    const detail = mapReleaseToDetail(makeRelease());
    expect(detail.cover_art_images).toEqual([]);
  });
});

describe("mapCoverArtImages", () => {
  it("maps image fields and stringifies numeric id", () => {
    const images = mapCoverArtImages({
      images: [
        {
          id: 42,
          image: "https://archive.org/img.jpg",
          thumbnails: { "250": "https://archive.org/img-250.jpg" },
          types: ["Front"],
          front: true,
          back: false,
          comment: null,
        },
      ],
    });
    expect(images).toHaveLength(1);
    expect(images[0]?.id).toBe("42");
    expect(images[0]?.thumbnails?.thumb_250).toBe("https://archive.org/img-250.jpg");
    expect(images[0]?.front).toBe(true);
  });

  it("handles missing thumbnails", () => {
    const images = mapCoverArtImages({
      images: [
        {
          id: "abc",
          image: "https://example.com/img.jpg",
          types: [],
          front: false,
          back: true,
        },
      ],
    });
    expect(images[0]?.thumbnails?.small).toBeNull();
    expect(images[0]?.thumbnails?.thumb_1200).toBeNull();
  });
});

// -------------------------------------------------------------------------
// pure helpers
// -------------------------------------------------------------------------

describe("hasCoverArt", () => {
  it("returns true when front is true", () => {
    expect(hasCoverArt({ front: true })).toBe(true);
  });
  it("returns true when artwork is true", () => {
    expect(hasCoverArt({ artwork: true })).toBe(true);
  });
  it("returns false when both are false/absent", () => {
    expect(hasCoverArt({ front: false, artwork: false })).toBe(false);
    expect(hasCoverArt(null)).toBe(false);
    expect(hasCoverArt(undefined)).toBe(false);
  });
});

describe("coverArtThumbUrl", () => {
  it("builds the expected caa url", () => {
    expect(coverArtThumbUrl("abc-123")).toBe(
      "https://coverartarchive.org/release/abc-123/front-250"
    );
  });
});

describe("encodeQueryTerm", () => {
  it("returns single words unchanged", () => {
    expect(encodeQueryTerm("loveless")).toBe("loveless");
  });
  it("wraps multi-word terms in quotes", () => {
    expect(encodeQueryTerm("my bloody valentine")).toBe('"my bloody valentine"');
  });
  it("escapes embedded double quotes", () => {
    expect(encodeQueryTerm('say "hello"')).toBe('"say \\"hello\\""');
  });
});

// -------------------------------------------------------------------------
// MusicBrainzBrowserClient - fetch mocking
// -------------------------------------------------------------------------

const LOVELESS_SEARCH_RESPONSE = {
  releases: [
    {
      id: "cbbcc910-93fb-3fd5-8e04-f9501b71f301",
      title: "Loveless",
      date: "1991-11-04",
      country: "GB",
      status: "Official",
      score: 100,
      "artist-credit": [{ name: "My Bloody Valentine", joinphrase: null }],
      media: [{ "track-count": 9, format: "CD" }],
      "release-group": { "primary-type": "Album" },
      "label-info": [{ label: { name: "Creation Records" } }],
      "cover-art-archive": { front: true, artwork: true },
    },
  ],
  count: 1,
  offset: 0,
};

const LOVELESS_RELEASE_RESPONSE = {
  id: "cbbcc910-93fb-3fd5-8e04-f9501b71f301",
  title: "Loveless",
  date: "1991-11-04",
  country: "GB",
  status: "Official",
  "artist-credit": [{ name: "My Bloody Valentine" }],
  "release-group": { "primary-type": "Album", "secondary-types": [] },
  media: [
    {
      position: 1,
      format: "CD",
      "track-count": 2,
      tracks: [
        { position: 1, title: "Only Shallow", length: 274000 },
        { position: 2, title: "Loomer", length: 240000 },
      ],
    },
  ],
};

function makeFetch(responses: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const key = Object.keys(responses).find((k) => (url as string).includes(k));
    if (!key) throw new Error(`unexpected fetch: ${url}`);
    return {
      ok: true,
      status: 200,
      json: async () => responses[key],
    };
  });
}

describe("MusicBrainzBrowserClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("searchReleases parses and maps results", async () => {
    vi.stubGlobal("fetch", makeFetch({ "/release?query=": LOVELESS_SEARCH_RESPONSE }));
    const client = new MusicBrainzBrowserClient({ minGapMs: 0 });
    const result = await client.searchReleases({ release: "loveless", artist: "my bloody valentine" });

    expect(result.count).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.title).toBe("Loveless");
    expect(result.results[0]?.label).toBe("Creation Records");
    expect(result.results[0]?.has_cover_art).toBe(true);
    expect(result.results[0]?.primary_type).toBe("Album");
  });

  it("searchReleases throws when no query terms provided", async () => {
    const client = new MusicBrainzBrowserClient({ minGapMs: 0 });
    await expect(client.searchReleases({})).rejects.toThrow("at least one of release or artist is required");
  });

  it("getRelease parses release details with tracks", async () => {
    const mbid = "cbbcc910-93fb-3fd5-8e04-f9501b71f301";
    vi.stubGlobal(
      "fetch",
      makeFetch({
        [`/release/${mbid}`]: LOVELESS_RELEASE_RESPONSE,
        "coverartarchive.org": { images: [] },
      })
    );
    const client = new MusicBrainzBrowserClient({ minGapMs: 0 });
    const detail = await client.getRelease(mbid);

    expect(detail).not.toBeNull();
    expect(detail!.id).toBe(mbid);
    expect(detail!.media[0]?.tracks).toHaveLength(2);
    expect(detail!.media[0]?.tracks[0]?.length_ms).toBe(274000);
    expect(detail!.primary_type).toBe("Album");
  });

  it("getRelease returns null on fetch failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    const client = new MusicBrainzBrowserClient({ minGapMs: 0 });
    const detail = await client.getRelease("nonexistent-id");
    expect(detail).toBeNull();
  });

  it("getRelease still returns detail when cover art 404s", async () => {
    const mbid = "cbbcc910-93fb-3fd5-8e04-f9501b71f301";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if ((url as string).includes("coverartarchive")) {
          return { ok: false, status: 404, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => LOVELESS_RELEASE_RESPONSE };
      })
    );
    const client = new MusicBrainzBrowserClient({ minGapMs: 0 });
    const detail = await client.getRelease(mbid);
    expect(detail).not.toBeNull();
    expect(detail!.cover_art_images).toEqual([]);
  });

  it("getRelease parses cover art images when present", async () => {
    const mbid = "cbbcc910-93fb-3fd5-8e04-f9501b71f301";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if ((url as string).includes("coverartarchive")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              images: [
                {
                  id: 99,
                  image: "https://archive.org/front.jpg",
                  thumbnails: { "250": "https://archive.org/front-250.jpg" },
                  types: ["Front"],
                  front: true,
                  back: false,
                },
              ],
            }),
          };
        }
        return { ok: true, status: 200, json: async () => LOVELESS_RELEASE_RESPONSE };
      })
    );
    const client = new MusicBrainzBrowserClient({ minGapMs: 0 });
    const detail = await client.getRelease(mbid);
    expect(detail!.cover_art_images).toHaveLength(1);
    expect(detail!.cover_art_images[0]?.id).toBe("99");
    expect(detail!.cover_art_images[0]?.thumbnails?.thumb_250).toBe(
      "https://archive.org/front-250.jpg"
    );
  });
});
