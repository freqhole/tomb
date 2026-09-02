// @vitest-environment jsdom
// tests for tier-2 purge on queue departure.
//
// the eviction blocks this replaces covered only 5 of 13 queue-mutation
// sites, skipped video entirely (`if (item.kind !== "song") continue;`), and
// evicted P2P blobs under the song's content hash even though the P2P cache
// is keyed by `media_blob_id`.

import { beforeEach, describe, expect, it, vi } from "vitest";

const evictCachedBlob = vi.fn(async () => {});
const evictP2PBlob = vi.fn(async () => {});
const cancelP2PDownload = vi.fn(() => {});
const cancelPendingAutoDownloads = vi.fn(() => {});

vi.mock("../cache/blobCache", () => ({
  evictCachedBlob: (...args: unknown[]) => evictCachedBlob(...(args as [])),
}));
vi.mock("../storage/blobResolver", () => ({
  evictP2PBlob: (...args: unknown[]) => evictP2PBlob(...(args as [])),
  cancelP2PDownload: (...args: unknown[]) => cancelP2PDownload(...(args as [])),
}));
vi.mock("../autoDownload/manager", () => ({
  cancelPendingAutoDownloads: (...args: unknown[]) => cancelPendingAutoDownloads(...(args as [])),
}));

import type { MediaItem } from "../../../app/services/storage/mediaItem";
import { purgeDepartedMedia } from "./purgeDepartedMedia";

function remoteSong(over: Record<string, unknown> = {}): MediaItem {
  return {
    kind: "song",
    song: {
      sha256: "hash-1",
      media_blob_id: "blob-1",
      remote_server_id: "remote-1",
      source_type: "remote",
      ...over,
    },
  } as unknown as MediaItem;
}

function remoteVideo(over: Record<string, unknown> = {}): MediaItem {
  return {
    kind: "video",
    video: {
      id: "vid-1",
      media_blob_id: "vblob-1",
      remote_server_id: "remote-1",
      source_type: "remote",
      ...over,
    },
  } as unknown as MediaItem;
}

function evictedKeys(): string[] {
  return evictCachedBlob.mock.calls.map((c) => (c as unknown as [string, string])[1]);
}

beforeEach(() => {
  evictCachedBlob.mockClear();
  evictP2PBlob.mockClear();
  cancelP2PDownload.mockClear();
  cancelPendingAutoDownloads.mockClear();
});

describe("purgeDepartedMedia", () => {
  it("cancels pending auto-download work before cache cleanup", async () => {
    const item = remoteSong();
    await purgeDepartedMedia([item]);
    expect(cancelPendingAutoDownloads).toHaveBeenCalledWith([item]);
  });

  it("evicts a departed remote song under its media_blob_id", async () => {
    await purgeDepartedMedia([remoteSong()]);
    expect(evictedKeys()).toContain("blob-1");
  });

  // the P2P cache is keyed by media_blob_id and the HTTP cache by content
  // hash; which one holds the bytes depends on the transport, so both go.
  it("also evicts under the content hash for the http-cached case", async () => {
    await purgeDepartedMedia([remoteSong()]);
    expect(evictedKeys()).toContain("hash-1");
  });

  it("cancels any in-flight P2P download for the departed item", async () => {
    await purgeDepartedMedia([remoteSong()]);
    expect(cancelP2PDownload).toHaveBeenCalledWith("blob-1", "remote-1");
  });

  it("evicts the P2P blob store as well as the api cache", async () => {
    await purgeDepartedMedia([remoteSong()]);
    expect(evictP2PBlob).toHaveBeenCalledWith("blob-1", "remote-1");
  });

  it("evicts departed videos", async () => {
    await purgeDepartedMedia([remoteVideo()]);
    expect(evictedKeys()).toEqual(["vblob-1"]);
  });

  it("handles a mixed batch of songs and videos", async () => {
    await purgeDepartedMedia([remoteSong(), remoteVideo()]);
    expect(evictedKeys()).toEqual(expect.arrayContaining(["blob-1", "hash-1", "vblob-1"]));
  });

  describe("items with nothing to purge", () => {
    it("ignores local songs", async () => {
      await purgeDepartedMedia([remoteSong({ source_type: "local" })]);
      expect(evictCachedBlob).not.toHaveBeenCalled();
    });

    // a synced song's bytes live in the library, which must survive queue exit
    it("ignores synced songs", async () => {
      await purgeDepartedMedia([remoteSong({ source_type: "synced" })]);
      expect(evictCachedBlob).not.toHaveBeenCalled();
    });

    it("ignores songs with no remote", async () => {
      await purgeDepartedMedia([remoteSong({ remote_server_id: null })]);
      expect(evictCachedBlob).not.toHaveBeenCalled();
    });

    it("ignores locally-imported videos", async () => {
      await purgeDepartedMedia([remoteVideo({ source_type: "local" })]);
      expect(evictCachedBlob).not.toHaveBeenCalled();
    });

    it("ignores videos with no media_blob_id", async () => {
      await purgeDepartedMedia([remoteVideo({ media_blob_id: null })]);
      expect(evictCachedBlob).not.toHaveBeenCalled();
    });

    it("does nothing for an empty batch", async () => {
      await purgeDepartedMedia([]);
      expect(evictCachedBlob).not.toHaveBeenCalled();
    });
  });

  it("still purges a song that has no media_blob_id, using the hash", async () => {
    await purgeDepartedMedia([remoteSong({ media_blob_id: null })]);
    expect(evictedKeys()).toEqual(["hash-1"]);
  });
});

describe("purgeDepartedMedia image refcounting", () => {
  function songWithArt(sha: string, artBlobId: string): MediaItem {
    return remoteSong({
      sha256: sha,
      media_blob_id: `blob-${sha}`,
      album_images: [{ remote_blob_id: artBlobId, remote_server_id: "remote-1" }],
    });
  }

  it("purges art belonging only to departed items", async () => {
    await purgeDepartedMedia([songWithArt("a", "art-1")], []);
    expect(evictedKeys()).toContain("art-1");
  });

  // album art is shared across every track on the album - yanking it because
  // one track left would blank the artwork for the tracks still queued
  it("keeps art still referenced by a surviving queue item", async () => {
    await purgeDepartedMedia([songWithArt("a", "art-1")], [songWithArt("b", "art-1")]);
    expect(evictedKeys()).not.toContain("art-1");
  });

  it("purges art once when several departed items share it", async () => {
    await purgeDepartedMedia([songWithArt("a", "art-1"), songWithArt("b", "art-1")], []);
    expect(evictedKeys().filter((k) => k === "art-1")).toHaveLength(1);
  });

  it("purges waveform and thumbnail images too", async () => {
    const song = remoteSong({
      images: [
        { remote_blob_id: "wave-1", remote_server_id: "remote-1", blob_type: "waveform" },
        { remote_blob_id: "thumb-1", remote_server_id: "remote-1", blob_type: "thumbnail" },
      ],
    });
    await purgeDepartedMedia([song], []);
    expect(evictedKeys()).toEqual(expect.arrayContaining(["wave-1", "thumb-1"]));
  });

  it("purges a departed video's poster", async () => {
    await purgeDepartedMedia([remoteVideo({ poster_blob_id: "poster-1" })], []);
    expect(evictedKeys()).toContain("poster-1");
  });

  it("keeps a video poster still referenced by a surviving video", async () => {
    const a = remoteVideo({ id: "v1", poster_blob_id: "poster-1" });
    const b = remoteVideo({ id: "v2", poster_blob_id: "poster-1" });
    await purgeDepartedMedia([a], [b]);
    expect(evictedKeys()).not.toContain("poster-1");
  });

  it("ignores images with no remote to evict from", async () => {
    const song = remoteSong({ album_images: [{ remote_blob_id: "art-1" }] });
    await purgeDepartedMedia([song], []);
    expect(evictedKeys()).not.toContain("art-1");
  });
});
