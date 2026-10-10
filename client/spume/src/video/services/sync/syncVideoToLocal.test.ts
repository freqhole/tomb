// @vitest-environment jsdom
//
// regression test for a real bug found live: "queue a video from a remote
// controller" never resolved in charnel mode. root cause traced via temp
// debug logging (see docs/cenotaph-player-queue-unification-plan.md) to
// syncVideoViaCharnel (private, exercised here through the exported
// syncVideoToLocal) discarding an already-known-good `video.blake3` (set
// by cenotaph's mediaRefResolve.ts directly from the wire MediaRef's own
// hash) in favor of a fresh, best-effort blob-metadata fetch that silently
// returns `{}` on ANY failure (unreachable peer, timeout, etc.) -
// `syncVideoViaLocalGrimoire` then rejected with "video blob has no
// blake3 (cannot pull via iroh)" even though a perfectly good one was
// known the entire time.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedVideo } from "../../../app/services/storage/mediaItem";

const isCharnelMode = vi.fn(() => true);
vi.mock("../../../app/services/charnel", () => ({
  isCharnelMode: () => isCharnelMode(),
}));

const getRemoteById = vi.fn();
vi.mock("../../../app/services/remotes/remoteManager", () => ({
  getRemoteById: (...a: unknown[]) => getRemoteById(...a),
}));

const getClientForRemote = vi.fn(async (...args: unknown[]) => {
  void args;
  return {};
});
const getTransportForRemote = vi.fn(async (...args: unknown[]) => {
  void args;
  return {};
});
vi.mock("../../../app/api/client", () => ({
  getClientForRemote: (...a: unknown[]) => getClientForRemote(...a),
  getTransportForRemote: (...a: unknown[]) => getTransportForRemote(...a),
}));

const RENDITION_BLOB_ID = "rendition-blob-1";

const syncVideoViaLocalGrimoire = vi.fn(
  async (...args: unknown[]): Promise<{ success: boolean; videoId?: string; error?: string }> => {
    void args;
    return { success: true };
  }
);
vi.mock("./syncVideoViaLocalGrimoire", () => ({
  syncVideoViaLocalGrimoire: (...a: unknown[]) => syncVideoViaLocalGrimoire(...a),
}));

vi.mock("../../../music/services/download", () => ({
  addToLoadingSet: vi.fn(),
  updateLoadingProgress: vi.fn(),
  removeFromLoadingSet: vi.fn(),
  withLoadingProgress: async (
    _id: string,
    run: (onProgress: (p: number | null) => void) => Promise<unknown>
  ) => run(() => {}),
}));
vi.mock("../../../app/services/storage/db", () => ({
  getSyncQueueToLocal: vi.fn(() => true),
}));
const markVideoSynced = vi.fn((...args: unknown[]) => void args);
vi.mock("../syncState", () => ({ markVideoSynced: (...a: unknown[]) => markVideoSynced(...a) }));
vi.mock("../../queries/cacheUpdates", () => ({ invalidateVideoLibraryQueries: vi.fn() }));

const addLocalVideo = vi.fn(async (input: { id: string }) => ({ id: input.id }));
const getLocalVideoById = vi.fn(async (...args: unknown[]) => {
  void args;
  return null;
});
const getVideoByBlake3 = vi.fn(
  async (
    ...args: unknown[]
  ): Promise<{ id: string; series_id: string | null; season_id: string | null } | undefined> => {
    void args;
    return undefined;
  }
);
const updateLocalVideo = vi.fn((...args: unknown[]) => void args);
vi.mock("../storage/db/videos", () => ({
  addLocalVideo: (...a: [{ id: string }]) => addLocalVideo(...a),
  getLocalVideoById: (...a: unknown[]) => getLocalVideoById(...a),
  getVideoByBlake3: (...a: unknown[]) => getVideoByBlake3(...a),
  updateLocalVideo: (...a: unknown[]) => updateLocalVideo(...a),
}));
vi.mock("../storage/db/series", () => ({
  getOrCreateLocalVideoSeries: vi.fn(),
  updateLocalVideoSeries: vi.fn(),
}));
vi.mock("../storage/db/seasons", () => ({
  getOrCreateLocalVideoSeason: vi.fn(),
  updateLocalVideoSeason: vi.fn(),
}));
vi.mock("../../../music/services/sync/syncSongToLocal", () => ({
  downloadAndStoreImages: vi.fn(),
}));

const streamVideoToOPFSWithResume = vi.fn(async (...args: unknown[]) => {
  void args;
  return { opfsPath: "opfs://video.mp4", size: 100 };
});
const deleteVideoFromOPFS = vi.fn((...args: unknown[]) => void args);
vi.mock("../opfs/helpers", () => ({
  writeVideoPosterToOPFS: vi.fn(),
  writeVideoToOPFS: vi.fn(),
  streamVideoToOPFSWithResume: (...a: unknown[]) => streamVideoToOPFSWithResume(...a),
  deleteVideoFromOPFS: (...a: unknown[]) => deleteVideoFromOPFS(...a),
}));
vi.mock("../../../music/services/storage/blobResolver", () => ({
  usesBlobResolver: vi.fn(async () => false),
}));

import { syncVideoToLocal } from "./syncVideoToLocal";
import type { Remote } from "../../../app/services/storage/schemas/remote";

const remote = { remote_id: "remote-1", base_url: "", peer_addr: "peer-a" } as unknown as Remote;

function video(over: Partial<QueuedVideo> = {}): QueuedVideo {
  return {
    id: "b3-video-1",
    title: "a video",
    content_type: "movie",
    media_blob_id: "b3-video-1",
    source_type: "remote",
    remote_server_id: "remote-1",
    duration_seconds: 60,
    created_at: Date.now(),
    updated_at: Date.now(),
    opfs_path: null,
    poster_opfs_path: null,
    ...over,
  } as unknown as QueuedVideo;
}

beforeEach(() => {
  vi.clearAllMocks();
  isCharnelMode.mockReturnValue(true);
  getRemoteById.mockResolvedValue(remote);
  // blobMetadata fetch is best-effort and swallows failures into an empty
  // object - simulate the exact live case (unreachable/timed-out peer).
  getClientForRemote.mockResolvedValue({
    music: { blobMetadata: vi.fn(async () => ({ success: false })) },
  });
  syncVideoViaLocalGrimoire.mockResolvedValue({ success: true, videoId: "row-1" });
});

describe("syncVideoToLocal (charnel mode)", () => {
  it("still syncs using the video's own already-known blake3 when the metadata fetch returns none", async () => {
    const v = video({ blake3: "b3-video-1" } as Partial<QueuedVideo>);

    const result = await syncVideoToLocal(v, remote);

    expect(result.success).toBe(true);
    expect(syncVideoViaLocalGrimoire).toHaveBeenCalledTimes(1);
    const [, , , blake3Arg] = syncVideoViaLocalGrimoire.mock.calls[0] as [
      unknown,
      unknown,
      unknown,
      string | null,
    ];
    expect(blake3Arg).toBe("b3-video-1");
  });

  it("ignores the video's own blake3 when a rendition (different blob) is selected, using the rendition's own metadata blake3 instead", async () => {
    getClientForRemote.mockResolvedValue({
      music: {
        blobMetadata: vi.fn(async () => ({ success: true, data: { blake3: "rendition-blake3" } })),
      },
    });
    // the video's OWN blake3 is for the original blob - must not be reused
    // for a different (rendition) blobId, or the wrong bytes get pulled/
    // played while validated/labeled as the rendition.
    const v = video({
      blake3: "original-blake3",
      renditions: [
        {
          blob_id: RENDITION_BLOB_ID,
          label: "compatible",
          mime: null,
          blake3: null,
          width: null,
          height: null,
        },
      ],
    } as Partial<QueuedVideo>);

    const result = await syncVideoToLocal(v, remote);

    expect(result.success).toBe(true);
    const [, , blobIdArg, blake3Arg] = syncVideoViaLocalGrimoire.mock.calls[0] as [
      unknown,
      unknown,
      string,
      string | null,
    ];
    expect(blobIdArg).toBe(RENDITION_BLOB_ID);
    expect(blake3Arg).toBe("rendition-blake3");
  });

  it("falls back to the metadata fetch's blake3 when the video has no already-known one", async () => {
    getClientForRemote.mockResolvedValue({
      music: {
        blobMetadata: vi.fn(async () => ({ success: true, data: { blake3: "from-metadata" } })),
      },
    });
    const v = video(); // no blake3 field at all

    const result = await syncVideoToLocal(v, remote);

    expect(result.success).toBe(true);
    const [, , , blake3Arg] = syncVideoViaLocalGrimoire.mock.calls[0] as [
      unknown,
      unknown,
      unknown,
      string | null,
    ];
    expect(blake3Arg).toBe("from-metadata");
  });

  it("fails with no blake3 available from either source (the genuinely-unresolvable case)", async () => {
    const v = video(); // no blake3 field, and blobMetadata mock already returns none

    await syncVideoToLocal(v, remote);

    const [, , , blake3Arg] = syncVideoViaLocalGrimoire.mock.calls[0] as [
      unknown,
      unknown,
      unknown,
      string | null,
    ];
    expect(blake3Arg).toBeNull();
  });

  it("falls back to the original blob when the rendition sync fails", async () => {
    getClientForRemote.mockResolvedValue({
      music: {
        blobMetadata: vi.fn(async () => ({ success: true, data: { blake3: "rendition-blake3" } })),
      },
    });
    syncVideoViaLocalGrimoire
      .mockResolvedValueOnce({ success: false, error: "rendition unavailable" })
      .mockResolvedValueOnce({ success: true, videoId: "row-1" });
    const v = video({
      blake3: "original-blake3",
      renditions: [
        {
          blob_id: RENDITION_BLOB_ID,
          label: "compatible",
          mime: null,
          blake3: null,
          width: null,
          height: null,
        },
      ],
    } as Partial<QueuedVideo>);

    const result = await syncVideoToLocal(v, remote);

    expect(result.success).toBe(true);
    expect(syncVideoViaLocalGrimoire).toHaveBeenCalledTimes(2);
    const [, , firstBlobId] = syncVideoViaLocalGrimoire.mock.calls[0] as [unknown, unknown, string];
    const [, , secondBlobId, secondBlake3] = syncVideoViaLocalGrimoire.mock.calls[1] as [
      unknown,
      unknown,
      string,
      string | null,
    ];
    expect(firstBlobId).toBe(RENDITION_BLOB_ID);
    expect(secondBlobId).toBe(v.media_blob_id);
    expect(secondBlake3).toBe("original-blake3");
  });
});

// regression coverage for the dedup fix: two different remotes' copies of
// "the same" video (different `video.id`, same content) must collapse
// onto one local row, matching music's getSongByBlake3-based dedup role -
// see dedupByBlake3 in syncVideoToLocal.ts.
describe("syncVideoToLocal (browser mode, content-based dedup)", () => {
  const httpRemote = {
    remote_id: "remote-1",
    base_url: "https://example.test",
    peer_addr: null,
  } as unknown as Remote;

  beforeEach(() => {
    isCharnelMode.mockReturnValue(false);
    getRemoteById.mockResolvedValue(httpRemote);
  });

  it("dedups before downloading when the video's blake3 is already known", async () => {
    getVideoByBlake3.mockResolvedValueOnce({
      id: "existing-row",
      series_id: null,
      season_id: null,
    });
    const v = video({ blake3: "known-hash" } as Partial<QueuedVideo>);

    const result = await syncVideoToLocal(v, httpRemote);

    expect(result.success).toBe(true);
    expect(streamVideoToOPFSWithResume).not.toHaveBeenCalled();
    expect(addLocalVideo).not.toHaveBeenCalled();
    expect(markVideoSynced).toHaveBeenCalledWith(v.id);
  });

  it("dedups on a blake3 only discovered via metadata AFTER downloading, discarding the duplicate bytes", async () => {
    getClientForRemote.mockResolvedValue({
      music: {
        blobMetadata: vi.fn(async () => ({ success: true, data: { blake3: "late-hash" } })),
      },
    });
    getVideoByBlake3.mockResolvedValueOnce({
      id: "existing-row-2",
      series_id: null,
      season_id: null,
    });
    const v = video(); // no blake3 known upfront - early check can't fire

    const result = await syncVideoToLocal(v, httpRemote);

    expect(result.success).toBe(true);
    expect(streamVideoToOPFSWithResume).toHaveBeenCalledTimes(1);
    expect(deleteVideoFromOPFS).toHaveBeenCalledWith("opfs://video.mp4");
    expect(addLocalVideo).not.toHaveBeenCalled();
    expect(markVideoSynced).toHaveBeenCalledWith(v.id);
  });

  it("syncs normally (creates a new local row) when no existing video matches by blake3", async () => {
    getClientForRemote.mockResolvedValue({
      music: {
        blobMetadata: vi.fn(async () => ({ success: true, data: { blake3: "fresh-hash" } })),
      },
    });
    const v = video();

    const result = await syncVideoToLocal(v, httpRemote);

    expect(result.success).toBe(true);
    expect(addLocalVideo).toHaveBeenCalledTimes(1);
    expect(deleteVideoFromOPFS).not.toHaveBeenCalled();
  });
});
