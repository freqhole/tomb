// @vitest-environment jsdom
//
// integration-style tests for mediaRefResolve.ts's resolve pipeline. an
// earlier version never queried the source peer at all (grimoire's
// query_songs/query_videos had no way to look a song/video up by content
// hash), so every remote-controller queue push synced a thin, placeholder-
// only object ("unknown album", no images). grimoire now supports
// `media_blob_blake3` (songs) / `media_blob_ids` (videos, via
// `blob_metadata_by_blake3` first) query filters (see
// docs/cenotaph-player-queue-unification-plan.md task 15), so the primary
// path is now a real fetch-then-sync using the exact same
// `adaptSongFromAPI`/`client.video.queryVideos` shape every other remote-
// browsing path already uses - the thin wire-only object is now only a
// fallback for when the source peer is unreachable or has nothing for
// that hash. these tests assert the real end-to-end behavior (what gets
// called, with what data, and what comes back) rather than "does this
// function exist" - mock only the actual network/db boundary (transport
// client, remote manager, sync functions, local db lookups), exercise the
// real resolve logic on top of that.

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
  // clearAllMocks() only clears call history, not a `mockResolvedValue`/
  // `mockImplementation` set by an earlier test (vitest's documented
  // behavior) - getClientForRemote is reconfigured per-test throughout
  // this file (charnel tests set it, others rely on it being
  // "unconfigured" so it throws), so it needs a real reset here or a
  // config left over from one test silently leaks into a later, unrelated
  // one that never expected a client to be returned at all.
  getClientForRemote.mockReset();
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
  it("falls back to a thin sync input built from the wire MediaRef when the source peer has no full metadata", async () => {
    // getClientForRemote has no mocked implementation here, so the full-
    // fetch attempt throws internally and is caught - assert the fallback
    // still builds a usable sync input from the wire MediaRef alone.
    getSongByBlake3.mockResolvedValueOnce(null).mockResolvedValueOnce({ sha256: "b3-song-1" });
    await resolveMediaRefToSong(songRef());

    expect(getClientForRemote).toHaveBeenCalled();
    expect(syncSongToLocal).toHaveBeenCalledTimes(1);
    const [syncInput] = syncSongToLocal.mock.calls[0] as [Record<string, unknown>];
    expect(syncInput.title).toBe("a song");
    expect(syncInput.artist_name).toBe("an artist");
    expect(syncInput.duration_seconds).toBe(180);
    expect(syncInput.blake3).toBe("b3-song-1");
    expect(syncInput.remote_server_id).toBe("remote-1");
  });

  it("uses the full song from the source peer (real artist/album/images) instead of the thin wire-only object, when available", async () => {
    const fullSongApiItem = {
      song: { id: "song-1", title: "a song", media_blob_id: "blob-1" },
      artist: { id: "artist-1", name: "real artist", images: [{ blob_id: "artist-img" }] },
      album: { id: "album-1", title: "real album", images: [{ blob_id: "album-img" }] },
      media_blob: { sha256: "sha-1", blake3: "b3-song-1" },
    };
    const querySongs = vi.fn(async (args: Record<string, unknown>) => ({
      success: true,
      data: { items: [fullSongApiItem] },
      __args: args,
    }));
    getClientForRemote.mockResolvedValue({ music: { querySongs } });

    await resolveMediaRefToSong(songRef());

    expect(querySongs).toHaveBeenCalledTimes(1);
    const [queryArgs] = querySongs.mock.calls[0] as [Record<string, unknown>];
    expect(queryArgs.filters).toEqual({ media_blob_blake3: ["b3-song-1"] });
    expect(adaptSongFromAPI).toHaveBeenCalledWith(fullSongApiItem, "", "remote-1");
    const [syncInput] = syncSongToLocal.mock.calls[0] as [Record<string, unknown>];
    // adaptSongFromAPI is mocked to spread the raw api item through, so the
    // sync input carries the FULL nested shape, not the thin placeholder
    // fields resolveMediaRefToSong would otherwise have synthesized.
    expect(syncInput).toMatchObject({ __adapted: true, song: fullSongApiItem.song });
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

    it("skips the source peer entirely (no fetch, no sync) when the local grimoire already has this blake3", async () => {
      const querySongs = vi.fn(async (_args: Record<string, unknown>) => ({
        success: true,
        data: { items: [{ id: "already-local-1" }] },
      }));
      getClientForRemote.mockResolvedValue({ music: { querySongs } });

      const result = await resolveMediaRefToSong(songRef());

      expect(querySongs).toHaveBeenCalledTimes(1);
      const [args] = querySongs.mock.calls[0] as [Record<string, unknown>];
      expect(args.filters).toEqual({ media_blob_blake3: ["b3-song-1"] });
      expect(syncSongToLocal).not.toHaveBeenCalled();
      expect(createRemote).not.toHaveBeenCalled();
      expect(result).toMatchObject({ id: "already-local-1", __adapted: true });
    });

    it("reads the just-synced row back via the real `song_ids` query filter, not blake3", async () => {
      const querySongs = vi.fn(async (args: Record<string, unknown>) => {
        // two blake3-filtered calls happen before the sync: the charnel
        // local-already-synced short-circuit, then the source-peer
        // full-metadata fetch (this test's mock can't tell them apart
        // since both point at the same mocked client) - neither finds a
        // row, so it falls back to the thin sync input and proceeds to
        // sync, then reads the just-synced row back by song_ids.
        if ((args.filters as Record<string, unknown>)?.media_blob_blake3) {
          return { success: true, data: { items: [] } };
        }
        return { success: true, data: { items: [{ id: "row-1" }] } };
      });
      getClientForRemote.mockResolvedValue({ music: { querySongs } });

      const result = await resolveMediaRefToSong(songRef());

      expect(querySongs).toHaveBeenCalledTimes(3);
      const [readBackArgs] = querySongs.mock.calls[2] as [Record<string, unknown>];
      expect(readBackArgs.filters).toEqual({ song_ids: ["row-1"] });
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
  it("falls back to a thin sync input built from the wire MediaRef when the source peer has no full metadata", async () => {
    await resolveMediaRefToVideo(videoRef());

    expect(getClientForRemote).toHaveBeenCalled();
    expect(syncVideoToLocal).toHaveBeenCalledTimes(1);
    const [queuedVideo] = syncVideoToLocal.mock.calls[0] as [Record<string, unknown>];
    expect(queuedVideo.title).toBe("a video");
    expect(queuedVideo.duration_seconds).toBe(60);
    expect(queuedVideo.blake3).toBe("b3-video-1");
    expect(queuedVideo.source_type).toBe("remote");
  });

  it("uses the full video from the source peer (real series_id/images) instead of the thin wire-only object, when available", async () => {
    const blobMetadataByBlake3 = vi.fn(async () => ({ success: true, data: { id: "blob-1" } }));
    const queryVideos = vi.fn(async (args: Record<string, unknown>) => ({
      success: true,
      data: { items: [{ id: "vid-1", title: "a video", series_id: "series-1" }] },
      __args: args,
    }));
    getClientForRemote.mockResolvedValue({
      music: { blobMetadataByBlake3 },
      video: { queryVideos },
    });

    await resolveMediaRefToVideo(videoRef());

    expect(blobMetadataByBlake3).toHaveBeenCalledWith({ blake3: "b3-video-1" });
    const [queryArgs] = queryVideos.mock.calls[0] as [{ params: { filters: unknown } }];
    expect(queryArgs.params.filters).toEqual({ media_blob_ids: ["blob-1"] });
    const [queuedVideo] = syncVideoToLocal.mock.calls[0] as [Record<string, unknown>];
    // the real fetched video (series_id: "series-1"), not the thin
    // placeholder ({content_type: "movie", no series_id at all) -
    // blake3 is re-attached since grimoire's wire Video has no such field.
    expect(queuedVideo).toMatchObject({ id: "vid-1", series_id: "series-1", blake3: "b3-video-1" });
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

    it("skips the source peer entirely (no fetch, no sync) when the local grimoire already has this blake3", async () => {
      const blobMetadataByBlake3 = vi.fn(async () => ({ success: true, data: { id: "blob-1" } }));
      const queryVideos = vi.fn(async () => ({
        success: true,
        data: { items: [{ id: "already-local-1", title: "a video" }] },
      }));
      getClientForRemote.mockResolvedValue({
        music: { blobMetadataByBlake3 },
        video: { queryVideos },
      });

      const result = await resolveMediaRefToVideo(videoRef());

      expect(blobMetadataByBlake3).toHaveBeenCalledTimes(1);
      expect(queryVideos).toHaveBeenCalledTimes(1);
      expect(syncVideoToLocal).not.toHaveBeenCalled();
      expect(createRemote).not.toHaveBeenCalled();
      expect(result).toMatchObject({ id: "already-local-1", blake3: "b3-video-1" });
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

    it("attaches the original wire blake3_hash onto the resolved video - grimoire's own Video read-back has no blake3 field at all", async () => {
      // real shape of grimoire's client.video.getVideo() response - it has
      // no `blake3` field whatsoever (unlike Song, which does carry one on
      // the wire - see QueuedVideo.blake3's own doc comment). without this
      // fix the resolved video's blake3 is silently undefined, which broke
      // both controller-side queue drain and this player's own
      // already-queued dedup (`currentQueueHashes()` in
      // charnelPlaybackAdapter.ts) for every video queued in charnel mode.
      const client = {
        video: {
          getVideo: vi.fn(async () => ({ success: true, data: { id: "row-1", title: "a video" } })),
        },
      };
      getClientForRemote.mockResolvedValue(client);

      const result = await resolveMediaRefToVideo(videoRef());

      expect(result?.blake3).toBe("b3-video-1");
    });
  });
});
