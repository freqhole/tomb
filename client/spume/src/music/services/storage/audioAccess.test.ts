// @vitest-environment jsdom
// tests for getAudioURL's storage-tier decisions.
//
// this is the regression that kicked off the media pipeline work: playing a
// queue item re-fetched audio that was already on disk, because a queue item
// is a snapshot and still says source_type "remote" after being synced.
//
// the assertions that matter are about *what gets fetched*, so the transport
// resolver is mocked and call counts are asserted directly.

import { beforeEach, describe, expect, it, vi } from "vitest";

const isSongSyncedLocally = vi.fn(() => false);
const resolveLocalAudioUrl = vi.fn(async (): Promise<string | null> => null);
const syncSongToLocal = vi.fn(async () => ({ success: true }) as Record<string, unknown>);
const canSyncSong = vi.fn(() => true);
const getSyncQueueToLocal = vi.fn(() => true);
const resolveBlobUrl = vi.fn(async () => "blob:from-remote");
const usesBlobResolver = vi.fn(async () => true);
const readAudioFromOPFS = vi.fn();
const getCachedBlob = vi.fn(async () => null);

vi.mock("../download", () => ({
  isSongSyncedLocally: (...a: unknown[]) => isSongSyncedLocally(...(a as [])),
  addToLoadingSet: vi.fn(),
  updateLoadingProgress: vi.fn(),
  removeFromLoadingSet: vi.fn(),
}));
vi.mock("./localAudio", () => ({
  resolveLocalAudioUrl: (...a: unknown[]) => resolveLocalAudioUrl(...(a as [])),
}));
vi.mock("../sync/syncSongToLocal", () => ({
  syncSongToLocal: (...a: unknown[]) => syncSongToLocal(...(a as [])),
  canSyncSong: (...a: unknown[]) => canSyncSong(...(a as [])),
}));
vi.mock("../../../app/services/storage/db", () => ({
  getSyncQueueToLocal: () => getSyncQueueToLocal(),
}));
vi.mock("./blobResolver", () => ({
  resolveBlobUrl: (...a: unknown[]) => resolveBlobUrl(...(a as [])),
  usesBlobResolver: (...a: unknown[]) => usesBlobResolver(...(a as [])),
  isP2PRemote: vi.fn(async () => true),
  revokeBlobUrl: vi.fn(),
}));
vi.mock("../cache/blobCache", () => ({
  getCachedBlob: (...a: unknown[]) => getCachedBlob(...(a as [])),
  preCacheBlob: vi.fn(),
}));
vi.mock("../opfs/helpers", () => ({
  readAudioFromOPFS: (...a: unknown[]) => readAudioFromOPFS(...(a as [])),
}));

import { getAudioURL } from "./audioAccess";
import type { Song } from "./types";

function remoteSong(over: Partial<Song> = {}): Song {
  return {
    sha256: "hash-1",
    media_blob_id: "blob-1",
    remote_server_id: "remote-1",
    source_type: "remote",
    title: "a song",
    blake3: "b3",
    ...over,
  } as unknown as Song;
}

beforeEach(() => {
  vi.clearAllMocks();
  isSongSyncedLocally.mockReturnValue(false);
  resolveLocalAudioUrl.mockResolvedValue(null);
  syncSongToLocal.mockResolvedValue({ success: true });
  canSyncSong.mockReturnValue(true);
  getSyncQueueToLocal.mockReturnValue(true);
  resolveBlobUrl.mockResolvedValue("blob:from-remote");
  usesBlobResolver.mockResolvedValue(true);
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:obj",
    revokeObjectURL: () => {},
  });
});

describe("an item already in the local library", () => {
  beforeEach(() => {
    isSongSyncedLocally.mockReturnValue(true);
    resolveLocalAudioUrl.mockResolvedValue("blob:local-copy");
  });

  it("plays the library copy", async () => {
    expect(await getAudioURL(remoteSong())).toBe("blob:local-copy");
  });

  // the actual reported bug: this used to re-download on every play
  it("makes no transport call", async () => {
    await getAudioURL(remoteSong());
    expect(resolveBlobUrl).not.toHaveBeenCalled();
  });

  it("does not re-sync it", async () => {
    await getAudioURL(remoteSong());
    expect(syncSongToLocal).not.toHaveBeenCalled();
  });
});

describe("sync-to-local on, item not yet local", () => {
  it("syncs the song and plays from the library", async () => {
    resolveLocalAudioUrl.mockResolvedValue("blob:just-synced");
    expect(await getAudioURL(remoteSong())).toBe("blob:just-synced");
    expect(syncSongToLocal).toHaveBeenCalled();
  });

  it("never resolves through the caching transport path", async () => {
    resolveLocalAudioUrl.mockResolvedValue("blob:just-synced");
    await getAudioURL(remoteSong());
    expect(resolveBlobUrl).not.toHaveBeenCalled();
  });

  it("falls back to streaming when the sync fails", async () => {
    syncSongToLocal.mockResolvedValue({ success: false, error: "peer unreachable" });
    expect(await getAudioURL(remoteSong())).toBe("blob:from-remote");
    expect(resolveBlobUrl).toHaveBeenCalled();
  });

  // a sync that reports success but leaves nothing readable must not
  // silently produce a broken player
  it("falls back to streaming when the sync leaves no local copy", async () => {
    resolveLocalAudioUrl.mockResolvedValue(null);
    expect(await getAudioURL(remoteSong())).toBe("blob:from-remote");
  });
});

describe("sync-to-local off", () => {
  beforeEach(() => getSyncQueueToLocal.mockReturnValue(false));

  it("streams via the transport instead of syncing", async () => {
    expect(await getAudioURL(remoteSong())).toBe("blob:from-remote");
    expect(syncSongToLocal).not.toHaveBeenCalled();
  });

  it("still prefers a library copy when one exists", async () => {
    isSongSyncedLocally.mockReturnValue(true);
    resolveLocalAudioUrl.mockResolvedValue("blob:local-copy");
    expect(await getAudioURL(remoteSong())).toBe("blob:local-copy");
    expect(resolveBlobUrl).not.toHaveBeenCalled();
  });
});

describe("songs that cannot be synced", () => {
  it("streams a song the sync path would reject", async () => {
    canSyncSong.mockReturnValue(false);
    expect(await getAudioURL(remoteSong())).toBe("blob:from-remote");
    expect(syncSongToLocal).not.toHaveBeenCalled();
  });
});
