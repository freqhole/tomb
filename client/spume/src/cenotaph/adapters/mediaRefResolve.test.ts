// @vitest-environment jsdom
//
// integration-style tests for mediaRefResolve.ts's resolve pipeline - the
// exact seam that broke "queue anything from a remote controller" this
// session: an earlier version queried the source peer via
// `client.music.querySongs({ filters: { blake3 } })` for full metadata
// before syncing, but grimoire's query_songs/query_videos have NO `blake3`
// filter at all (that patch was proposed and rejected - see
// docs/cenotaph-player-queue-unification-plan.md task 1/3), so that query
// silently returned arbitrary/no results and every remote-controller queue
// push failed to resolve. these tests assert the real end-to-end behavior
// (what gets called, with what data, and what comes back) rather than
// "does this function exist" - mock only the actual network/db boundary
// (transport client, remote manager, sync functions, local db lookups),
// exercise the real resolve logic on top of that.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaRef } from "../index";

const isCharnelAvailable = vi.fn(() => false);
const getClientForRemote = vi.fn();
const createRemote = vi.fn();
const getRemoteByPeerAddr = vi.fn();
const getTauriManagedRemote = vi.fn();
const getSongByBlake3 = vi.fn();
const getVideoByBlake3 = vi.fn();
const syncSongToLocal = vi.fn();
const syncVideoToLocal = vi.fn();
const adaptSongFromAPI = vi.fn();

vi.mock("../../app/api/client", () => ({
  isCharnelAvailable: () => isCharnelAvailable(),
  getClientForRemote: (...a: unknown[]) => getClientForRemote(...(a as [])),
}));
vi.mock("../../app/services/remotes/remoteManager", () => ({
  createRemote: (...a: unknown[]) => createRemote(...(a as [])),
  getRemoteByPeerAddr: (...a: unknown[]) => getRemoteByPeerAddr(...(a as [])),
  getTauriManagedRemote: (...a: unknown[]) => getTauriManagedRemote(...(a as [])),
}));
vi.mock("../../music/services/storage/db/songs", () => ({
  getSongByBlake3: (...a: unknown[]) => getSongByBlake3(...(a as [])),
}));
vi.mock("../../video/services/storage/db/videos", () => ({
  getVideoByBlake3: (...a: unknown[]) => getVideoByBlake3(...(a as [])),
}));
vi.mock("../../music/services/sync/syncSongToLocal", () => ({
  syncSongToLocal: (...a: unknown[]) => syncSongToLocal(...(a as [])),
}));
vi.mock("../../video/services/sync/syncVideoToLocal", () => ({
  syncVideoToLocal: (...a: unknown[]) => syncVideoToLocal(...(a as [])),
}));
vi.mock("../../music/data/remote/adapters", () => ({
  adaptSongFromAPI: (...a: unknown[]) => adaptSongFromAPI(...(a as [])),
}));
vi.mock("../../queryClient", () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));
vi.mock("../../music/queries/queryKeys", () => ({
  queryKeys: { songs: { all: () => ["songs"] }, albums: { all: () => ["albums"] } },
}));
vi.mock("../../video/queries/queryKeys", () => ({
  videoQueryKeys: { videos: { all: () => ["videos"] } },
}));

import { resolveMediaRefToSong, resolveMediaRefToVideo } from "./mediaRefResolve";

function songRef(over: Partial<MediaRef> = {}): MediaRef {
  return {
    source_peer_addr: "peer-a",
    blake3_hash: "b3-song-1",
    kind: "audio",
    title: "a song",
    artist: "an artist",
    duration_ms: 180_000,
    mime_type: "audio/mpeg",
    ...over,
  };
}

function videoRef(over: Partial<MediaRef> = {}): MediaRef {
  return {
    source_peer_addr: "peer-a",
    blake3_hash: "b3-video-1",
    kind: "video",
    title: "a video",
    duration_ms: 60_000,
    ...over,
  };
}

const remote = { remote_id: "remote-1", base_url: "", peer_addr: "peer-a" };

beforeEach(() => {
  vi.clearAllMocks();
  isCharnelAvailable.mockReturnValue(false);
  getRemoteByPeerAddr.mockResolvedValue(null);
  createRemote.mockResolvedValue(remote);
  getSongByBlake3.mockResolvedValue(null);
  getVideoByBlake3.mockResolvedValue(null);
  syncSongToLocal.mockResolvedValue({ success: true, localSongId: "row-1" });
  syncVideoToLocal.mockResolvedValue({ success: true, videoId: "row-1" });
  adaptSongFromAPI.mockImplementation((apiItem: Record<string, unknown>) => ({
    ...apiItem,
    __adapted: true,
  }));
});

describe("resolveMediaRefToSong", () => {
  it("never queries the source peer for metadata - builds the sync input directly from the wire MediaRef", async () => {
    // the actual regression: grimoire's query_songs has no `blake3` filter,
    // so any querySongs({ filters: { blake3 } }) call against a remote is
    // guaranteed to be wrong (or empty). assert it's never attempted at all.
    getSongByBlake3.mockResolvedValueOnce(null).mockResolvedValueOnce({ sha256: "b3-song-1" });
    await resolveMediaRefToSong(songRef());

    expect(getClientForRemote).not.toHaveBeenCalled();
    expect(syncSongToLocal).toHaveBeenCalledTimes(1);
    const [syncInput] = syncSongToLocal.mock.calls[0] as [Record<string, unknown>];
    expect(syncInput.title).toBe("a song");
    expect(syncInput.artist_name).toBe("an artist");
    expect(syncInput.duration_seconds).toBe(180);
    expect(syncInput.blake3).toBe("b3-song-1");
    expect(syncInput.remote_server_id).toBe("remote-1");
  });

  it("browser mode: returns the local song directly on a local-library hit, without syncing", async () => {
    const local = { sha256: "b3-song-1", title: "already local" };
    getSongByBlake3.mockResolvedValueOnce(local);

    const result = await resolveMediaRefToSong(songRef());

    expect(result).toBe(local);
    expect(syncSongToLocal).not.toHaveBeenCalled();
    expect(createRemote).not.toHaveBeenCalled();
  });

  it("persists a real remote for a never-before-seen peer instead of an ephemeral stand-in", async () => {
    await resolveMediaRefToSong(songRef({ source_peer_addr: "brand-new-peer" }));

    expect(createRemote).toHaveBeenCalledWith({
      peer_addr: "brand-new-peer",
      allowMissingServerInfo: true,
    });
  });

  it("reuses an already-persisted remote instead of creating a duplicate", async () => {
    getRemoteByPeerAddr.mockResolvedValue(remote);
    await resolveMediaRefToSong(songRef());
    expect(createRemote).not.toHaveBeenCalled();
  });

  it("returns null (and doesn't throw) when sync fails", async () => {
    syncSongToLocal.mockResolvedValue({ success: false, error: "boom" });
    const result = await resolveMediaRefToSong(songRef());
    expect(result).toBeNull();
  });

  describe("charnel mode", () => {
    beforeEach(() => {
      isCharnelAvailable.mockReturnValue(true);
      getTauriManagedRemote.mockResolvedValue({ remote_id: "local-remote", base_url: "" });
    });

    it("skips the browser IDB short-circuit and always re-syncs (idempotent server-side)", async () => {
      await resolveMediaRefToSong(songRef());
      // no browser-only local check for charnel - getSongByBlake3 is only
      // used for the (unreachable here) browser final read-back branch.
      expect(getSongByBlake3).not.toHaveBeenCalled();
      expect(syncSongToLocal).toHaveBeenCalledTimes(1);
    });

    it("reads the just-synced row back via the real `song_ids` query filter, not blake3", async () => {
      const client = {
        music: {
          querySongs: vi.fn(async (_args: Record<string, unknown>) => ({
            success: true,
            data: { items: [{ id: "row-1" }] },
          })),
        },
      };
      getClientForRemote.mockResolvedValue(client);

      const result = await resolveMediaRefToSong(songRef());

      expect(client.music.querySongs).toHaveBeenCalledTimes(1);
      const [queryArgs] = client.music.querySongs.mock.calls[0] as [Record<string, unknown>];
      expect(queryArgs.filters).toEqual({ song_ids: ["row-1"] });
      expect(result).toMatchObject({ id: "row-1", __adapted: true });
    });

    it("returns null if the sync succeeded but the read-back can't find the row", async () => {
      const client = {
        music: { querySongs: vi.fn(async () => ({ success: true, data: { items: [] } })) },
      };
      getClientForRemote.mockResolvedValue(client);

      const result = await resolveMediaRefToSong(songRef());
      expect(result).toBeNull();
    });
  });
});

describe("resolveMediaRefToVideo", () => {
  it("never queries the source peer for metadata - builds the sync input directly from the wire MediaRef", async () => {
    await resolveMediaRefToVideo(videoRef());

    expect(getClientForRemote).not.toHaveBeenCalled();
    expect(syncVideoToLocal).toHaveBeenCalledTimes(1);
    const [queuedVideo] = syncVideoToLocal.mock.calls[0] as [Record<string, unknown>];
    expect(queuedVideo.title).toBe("a video");
    expect(queuedVideo.duration_seconds).toBe(60);
    expect(queuedVideo.blake3).toBe("b3-video-1");
    expect(queuedVideo.source_type).toBe("remote");
  });

  it("browser mode: returns the local video directly on a local-library hit, without syncing", async () => {
    const local = { id: "vid-1", blake3: "b3-video-1" };
    getVideoByBlake3.mockResolvedValueOnce(local);

    const result = await resolveMediaRefToVideo(videoRef());

    expect(result).toBe(local);
    expect(syncVideoToLocal).not.toHaveBeenCalled();
  });

  it("returns null (and doesn't throw) when sync fails", async () => {
    syncVideoToLocal.mockResolvedValue({ success: false, error: "boom" });
    const result = await resolveMediaRefToVideo(videoRef());
    expect(result).toBeNull();
  });

  describe("charnel mode", () => {
    beforeEach(() => {
      isCharnelAvailable.mockReturnValue(true);
      getTauriManagedRemote.mockResolvedValue({ remote_id: "local-remote", base_url: "" });
    });

    it("reads the just-synced row back via the single-video getVideo({id}) fetch, not a query filter", async () => {
      const client = {
        video: {
          getVideo: vi.fn(async () => ({ success: true, data: { id: "row-1", title: "a video" } })),
        },
      };
      getClientForRemote.mockResolvedValue(client);

      const result = await resolveMediaRefToVideo(videoRef());

      expect(client.video.getVideo).toHaveBeenCalledWith({ id: "row-1" });
      expect(result).toMatchObject({ id: "row-1", source_type: "remote" });
    });
  });
});
