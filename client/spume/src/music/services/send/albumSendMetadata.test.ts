import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Transport } from "@freqhole/api-client";
import type { Remote } from "../../../app/services/storage/schemas/remote";

const mocks = vi.hoisted(() => ({
  getAlbum: vi.fn(),
  getAlbumsTags: vi.fn(),
  getAlbumById: vi.fn(),
  getAlbumTaxons: vi.fn(),
  getAlbumTags: vi.fn(),
  getGenreById: vi.fn(),
  inlineImagesForSync: vi.fn(),
}));

vi.mock("@freqhole/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@freqhole/api-client")>();
  return {
    ...actual,
    FreqholeClient: class {
      music = { getAlbum: mocks.getAlbum, getAlbumsTags: mocks.getAlbumsTags };
    },
  };
});
vi.mock("./localBrowserSource", () => ({
  isLocalBrowserSourceRemote: (source: Remote) => source.remote_id === "__local_browser_source__",
}));
vi.mock("../storage/db", () => ({
  getAlbumById: mocks.getAlbumById,
  getAlbumTaxons: mocks.getAlbumTaxons,
  getAlbumTags: mocks.getAlbumTags,
  getGenreById: mocks.getGenreById,
}));
vi.mock("../sync/syncImages", () => ({
  inlineImagesForSync: mocks.inlineImagesForSync,
  toInlinableImages: (images: unknown) => images,
}));

import { loadAlbumSendMetadata } from "./albumSendMetadata";
import { buildSyncAlbumRequest } from "./buildSyncRequests";

const source = { remote_id: "source" } as Remote;
const transport = {} as Transport;
const context = {
  albumId: "source-album",
  artistName: "artist",
  remoteName: "source",
  sourceNodeId: "node",
  sourceTransport: transport,
  imageCache: new Map(),
  expectedSongBlake3s: ["audio"],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.inlineImagesForSync.mockResolvedValue([]);
  mocks.getAlbumTaxons.mockResolvedValue([]);
  mocks.getAlbumTags.mockResolvedValue([]);
  mocks.getAlbumsTags.mockResolvedValue({ success: true, data: [] });
});

describe("album transfer metadata", () => {
  it("loads the full remote album and serializes all taxons, raw metadata, and named URLs", async () => {
    const taxons = [
      { id: "date", kind_slug: "release_date", label: "2024-06-15" },
      { id: "label-1", kind_slug: "label", label: "first label" },
      { id: "label-2", kind_slug: "label", label: "second label" },
      { id: "mood", kind_slug: "mood", label: "dreamy" },
      { id: "custom", kind_slug: "custom-kind", label: "custom value" },
    ];
    const metadata = JSON.stringify({
      version: 1,
      musicbrainz: { release_id: "release", release_group_id: "group" },
      future_field: { nested: [1, 2] },
    });
    mocks.getAlbum.mockResolvedValue({
      success: true,
      data: {
        title: "fresh title",
        album_type: "ep",
        release_date: "2024-06-15",
        label: "first label",
        genres: [{ id: "genre", name: "ambient" }],
        taxons,
        metadata,
        urls: [{ id: "source-url", name: "bandcamp", url: "https://example.com/album" }],
        images: [{ blob_id: "cover", is_primary: 1, blob_type: "original" }],
      },
    });
    mocks.getAlbumsTags.mockResolvedValue({
      success: true,
      data: [{ id: "tag", name: "reviewed", created_at: 1 }],
    });
    const fields = await loadAlbumSendMetadata(context.albumId, source, transport);
    const request = await buildSyncAlbumRequest({ ...context, ...fields });
    expect(mocks.getAlbum).toHaveBeenCalledWith({ id: "source-album" });
    expect(JSON.parse(JSON.stringify(request))).toMatchObject({
      title: "fresh title",
      album_type: "ep",
      release_date: "2024-06-15",
      label: "first label",
      genres: ["ambient"],
      taxons,
      metadata,
      entity_urls: [{ id: null, name: "bandcamp", url: "https://example.com/album" }],
      mb_release_id: "release",
      mb_release_group_id: "group",
      tags: ["reviewed"],
      expected_song_blake3s: ["audio"],
    });
    expect(mocks.inlineImagesForSync).toHaveBeenCalledWith(
      [{ remote_blob_id: "cover", is_primary: true, blob_type: "original" }],
      transport,
      context.imageCache,
      '[album "fresh title"]'
    );
  });

  it("reads browser-local taxon junctions, metadata, URLs, tags, and legacy genre", async () => {
    mocks.getAlbumById.mockResolvedValue({
      title: "local album",
      album_type: "album",
      release_date: "2023",
      label: "local label",
      genre_id: "legacy-genre",
      metadata: '{"future_field":42}',
      urls: [{ name: "site", url: "https://example.com/local" }],
    });
    mocks.getAlbumTaxons.mockResolvedValue([
      { taxon_id: "mood", kind_slug: "mood", label: "calm" },
      { taxon_id: "label", kind_slug: "label", label: "local label" },
    ]);
    mocks.getAlbumTags.mockResolvedValue([{ name: "imported" }]);
    mocks.getGenreById.mockResolvedValue({ name: "ambient" });
    const fields = await loadAlbumSendMetadata(
      "local",
      { remote_id: "__local_browser_source__" } as Remote,
      transport
    );
    expect(fields).toMatchObject({
      releaseDate: "2023",
      label: "local label",
      genres: ["ambient"],
      taxons: [
        { id: "mood", kind_slug: "mood", label: "calm" },
        { id: "label", kind_slug: "label", label: "local label" },
      ],
      metadata: '{"future_field":42}',
      entityUrls: [{ name: "site", url: "https://example.com/local" }],
      tags: ["imported"],
    });
    expect(mocks.getAlbum).not.toHaveBeenCalled();
  });

  it("does not silently send partial metadata when the authoritative album read fails", async () => {
    mocks.getAlbum.mockResolvedValue({ success: false, error: "not found" });
    await expect(loadAlbumSendMetadata("missing", source, transport)).rejects.toThrow(
      "failed to load source album metadata"
    );
  });

  it("keeps legacy builder defaults and allows explicit musicbrainz IDs", async () => {
    const request = await buildSyncAlbumRequest({
      ...context,
      title: "album",
      mbReleaseId: "release",
      mbReleaseGroupId: "group",
    });
    expect(request).toMatchObject({
      taxons: [],
      metadata: null,
      entity_urls: [],
      urls: [],
      genres: [],
      mb_release_id: "release",
      mb_release_group_id: "group",
    });
  });
});
