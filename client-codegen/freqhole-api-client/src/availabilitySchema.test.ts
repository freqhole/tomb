import { describe, expect, it } from "vitest";
import {
  AlbumQueryResultSchema,
  ArtistQueryResultSchema,
  PlaylistQueryResultSchema,
  AlbumSearchResultSchema,
  ArtistSearchResultSchema,
  PlaylistSearchResultSchema,
  SongQueryResultSchema,
  SongSearchResultSchema,
  SuggestionSchema,
  VideoSchema,
  VideoSearchResultSchema,
  VideoSeriesSearchResultSchema,
  VideoSeriesSchema,
  LibraryAvailabilityRevisionSchema,
} from "./codegen/schema";
import { routes } from "./codegen/routes";

describe("source availability annotations", () => {
  it("exposes a bodyless authenticated revision route with a validated opaque token", () => {
    expect(routes.music.library_availability_revision).toMatchObject({
      method: "GET",
      path: "/api/library/availability-revision",
      req: null,
      auth: { type: "authenticated" },
    });
    expect(LibraryAvailabilityRevisionSchema.parse({ revision: "a".repeat(64) }))
      .toEqual({ revision: "a".repeat(64) });
    expect(LibraryAvailabilityRevisionSchema.safeParse({}).success).toBe(false);
    expect(LibraryAvailabilityRevisionSchema.safeParse({ revision: false }).success).toBe(false);
  });
  for (const [name, schema] of [
    ["song", SongQueryResultSchema.pick({ is_offline: true })],
    ["video", VideoSchema.pick({ is_offline: true })],
    ["song search", SongSearchResultSchema.pick({ is_offline: true })],
    ["video search", VideoSearchResultSchema.pick({ is_offline: true })],
    ["album search", AlbumSearchResultSchema.pick({ is_offline: true })],
    ["artist search", ArtistSearchResultSchema.pick({ is_offline: true })],
    ["playlist search", PlaylistSearchResultSchema.pick({ is_offline: true })],
    ["series search", VideoSeriesSearchResultSchema.pick({ is_offline: true })],
    ["album query", AlbumQueryResultSchema.pick({ is_offline: true })],
    ["artist query", ArtistQueryResultSchema.pick({ is_offline: true })],
    ["playlist query", PlaylistQueryResultSchema.pick({ is_offline: true })],
    ["series", VideoSeriesSchema.pick({ is_offline: true })],
    ["suggestion", SuggestionSchema.pick({ is_offline: true })],
  ] as const) {
    it(`${name} accepts older peers without treating them as confirmed offline`, () => {
      expect(schema.parse({})).toEqual({ is_offline: false });
    });

    it(`${name} retains explicit source state and rejects invalid annotations`, () => {
      expect(schema.parse({ is_offline: true })).toEqual({ is_offline: true });
      expect(schema.parse({ is_offline: false })).toEqual({ is_offline: false });
      expect(schema.safeParse({ is_offline: "false" }).success).toBe(false);
      expect(schema.safeParse({ is_offline: null }).success).toBe(false);
    });
  }
});
