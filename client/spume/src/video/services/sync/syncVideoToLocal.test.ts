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

const resolvePlaybackBlobId = vi.fn(async (...args: unknown[]) => {
  void args;
  return "blob-1";
});
vi.mock("../playbackBlobId", () => ({
  resolvePlaybackBlobId: (...a: unknown[]) => resolvePlaybackBlobId(...a),
}));

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
vi.mock("../syncState", () => ({ markVideoSynced: vi.fn() }));
vi.mock("../../queries/cacheUpdates", () => ({ invalidateVideoLibraryQueries: vi.fn() }));
vi.mock("../storage/db/videos", () => ({
  addLocalVideo: vi.fn(),
  getLocalVideoById: vi.fn(async () => null),
  updateLocalVideo: vi.fn(),
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
vi.mock("../opfs/helpers", () => ({
  writeVideoPosterToOPFS: vi.fn(),
  writeVideoToOPFS: vi.fn(),
  streamVideoToOPFSWithResume: vi.fn(),
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
  resolvePlaybackBlobId.mockResolvedValue("blob-1");
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
});
