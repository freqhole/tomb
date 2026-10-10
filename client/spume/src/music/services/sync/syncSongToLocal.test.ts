// @vitest-environment jsdom
//
// regression tests for session B's id/sha256 decoupling (docs/
// sha256-removal-plan.md): a browser-mode synced song's local IDB `id`
// used to be hard-set to its `sha256` value. now it's a generated uuid,
// with content-based dedup (findExistingSongByContentHash, blake3-
// preferring) done explicitly before creating a new row - this is the
// first real test coverage for syncSongToLocal.ts at all.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncableSong } from "./syncSongToLocal";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import type { Song } from "../storage/types";

const isCharnelMode = vi.fn(() => false);
vi.mock("../../../app/services/charnel", () => ({ isCharnelMode: () => isCharnelMode() }));
vi.mock("../../../app/services/charnel/mode", () => ({ isCharnelMode: () => isCharnelMode() }));

const getRemoteById = vi.fn();
const getTauriManagedRemote = vi.fn();
vi.mock("../../../app/services/remotes/remoteManager", () => ({
  getRemoteById: (...a: unknown[]) => getRemoteById(...a),
  getTauriManagedRemote: (...a: unknown[]) => getTauriManagedRemote(...a),
}));
vi.mock("../../../app/services/remotes/remoteHealth", () => ({
  isOnlineNow: vi.fn(() => true),
}));
vi.mock("../../../app/services/remotes/peerAddr", () => ({
  extractNodeIdStrict: vi.fn(() => null),
}));
vi.mock("../../../app/services/storage/schemas/remote", () => ({
  isP2PRemote: vi.fn(() => false),
}));

const blobMetadata = vi.fn(async (...args: unknown[]) => {
  void args;
  return { success: true, data: { mime: "audio/mpeg", size: 100 } };
});
const getClientForRemote = vi.fn(async (...args: unknown[]) => {
  void args;
  return { music: { blobMetadata } };
});
const getTransportForRemote = vi.fn(async (...args: unknown[]) => {
  void args;
  return { getBlobUrl: vi.fn(async () => "blob://song.mp3") };
});
vi.mock("../../../app/api/client", () => ({
  getClientForRemote: (...a: unknown[]) => getClientForRemote(...a),
  getTransportForRemote: (...a: unknown[]) => getTransportForRemote(...a),
}));

const findExistingSongByContentHash = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined as Song | undefined;
});
vi.mock("../storage/db/songs", () => ({
  findExistingSongByContentHash: (...a: unknown[]) => findExistingSongByContentHash(...a),
}));

const getOrCreateAlbum = vi.fn(async (...args: unknown[]) => {
  void args;
  return { album_id: "album-1", images: [] };
});
const getOrCreateArtist = vi.fn(async (...args: unknown[]) => {
  void args;
  return { artist_id: "artist-1", images: [] };
});
const initMusicDB = vi.fn(async (...args: unknown[]) => {
  void args;
  return { put: vi.fn(), get: vi.fn() };
});
vi.mock("../storage/db", () => ({
  getOrCreateAlbum: (...a: unknown[]) => getOrCreateAlbum(...a),
  getOrCreateArtist: (...a: unknown[]) => getOrCreateArtist(...a),
  initMusicDB: (...a: unknown[]) => initMusicDB(...a),
}));
vi.mock("../storage/db/albums", () => ({ updateAlbum: vi.fn() }));
vi.mock("../storage/db/artists", () => ({ updateArtist: vi.fn() }));
vi.mock("../storage/db/genres", () => ({ getOrCreateGenre: vi.fn() }));
vi.mock("../storage/db/tags", () => ({ createTag: vi.fn(async () => ({ tag_id: "tag-1" })) }));
vi.mock("../storage/db/albumTags", () => ({
  addAlbumTag: vi.fn(),
  getAlbumTags: vi.fn(async () => []),
}));
vi.mock("../storage/db/taxons", () => ({
  upsertTaxon: vi.fn(),
  linkAlbumTaxon: vi.fn(),
}));
vi.mock("../storage/blobs", () => ({ storeBlob: vi.fn(async () => "blob-1") }));

const markSongSynced = vi.fn((...args: unknown[]) => void args);
const canStartDownload = vi.fn((...args: unknown[]) => {
  void args;
  return true;
});
const getInProgressDownload = vi.fn((...args: unknown[]) => {
  void args;
  return undefined;
});
const registerDownload = vi.fn((...args: unknown[]) => void args);
vi.mock("../download", () => ({
  markSongSynced: (...a: unknown[]) => markSongSynced(...a),
  canStartDownload: (...a: unknown[]) => canStartDownload(...a),
  getInProgressDownload: (...a: unknown[]) => getInProgressDownload(...a),
  registerDownload: (...a: unknown[]) => registerDownload(...a),
}));

vi.mock("../opfs/helpers", () => ({
  writeAudioToOPFS: vi.fn(async () => "opfs://song.mp3"),
  openAudioOPFSChunkSink: vi.fn(),
}));
vi.mock("./syncImages", () => ({
  inlineImagesForSync: vi.fn(),
  inlineRawUrlForSync: vi.fn(),
  toInlinableImages: vi.fn(() => []),
}));
vi.mock("../../queries/cacheUpdates", () => ({ invalidateMusicLibraryQueries: vi.fn() }));

import { syncSongToLocal } from "./syncSongToLocal";

const remote = { remote_id: "remote-1", name: "freqhole", base_url: "" } as unknown as Remote;

function song(overrides: Partial<SyncableSong> = {}): SyncableSong {
  return {
    sha256: "a".repeat(64),
    media_blob_id: "blob-1",
    title: "a song",
    artist_name: "an artist",
    album_title: "an album",
    track_number: 1,
    disc_number: 1,
    duration_seconds: 180,
    remote_server_id: "remote-1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  isCharnelMode.mockReturnValue(false);
  getRemoteById.mockResolvedValue(remote);
  canStartDownload.mockReturnValue(true);
  getInProgressDownload.mockReturnValue(undefined);
  findExistingSongByContentHash.mockResolvedValue(undefined);
  blobMetadata.mockResolvedValue({ success: true, data: { mime: "audio/mpeg", size: 100 } });
  // eslint-disable-next-line no-restricted-syntax -- test-only global stub
  (globalThis as { fetch?: unknown }).fetch = vi.fn(
    async () => ({ ok: true, blob: async () => new Blob(["x"]) }) as unknown as Response
  );
});

describe("syncSongToLocal (browser mode, id/sha256 decoupling - session B)", () => {
  it("creates a new local song with a generated id, NOT its sha256", async () => {
    const s = song();

    const result = await syncSongToLocal(s, undefined, remote);

    expect(result.success).toBe(true);
    expect(result.localSongId).toBeTruthy();
    expect(result.localSongId).not.toBe(s.sha256);
    // UUIDs are 36 chars with dashes - a 64-char hex sha256 would never match this shape.
    expect(result.localSongId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("dedups by content hash instead of creating a duplicate when a local song already exists", async () => {
    findExistingSongByContentHash.mockResolvedValueOnce({
      id: "existing-row-id",
    } as Song);
    const s = song();

    const result = await syncSongToLocal(s, undefined, remote);

    expect(result).toEqual({ success: true, localSongId: "existing-row-id", skipped: true });
    // no album/artist/OPFS work should have happened for a deduped song
    expect(getOrCreateAlbum).not.toHaveBeenCalled();
    expect(getOrCreateArtist).not.toHaveBeenCalled();
  });

  it("marks synced under the content-hash tracking key, not the generated local id", async () => {
    const s = song({ blake3: "b".repeat(64) });

    const result = await syncSongToLocal(s, undefined, remote);

    expect(result.success).toBe(true);
    // browser mode prefers sha256 (see syncTrackingKey's doc comment)
    expect(markSongSynced).toHaveBeenCalledWith(s.sha256);
    expect(markSongSynced).not.toHaveBeenCalledWith(result.localSongId);
  });
});
