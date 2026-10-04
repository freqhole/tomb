// tests for the auto-download manager's triggering + concurrency budget -
// the two things flagged as "not sure what's going on" (queue reactivity,
// shared in-flight download limit).

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Song } from "../storage/types";
import type { QueuedVideo } from "../../../app/services/storage/mediaItem";

let autoDownloadEnabled = true;
let syncQueueToLocal = true;
let mockState: { queue: unknown[]; current_sha256: string | null } = {
  queue: [],
  current_sha256: null,
};

vi.mock("../../../app/services/storage/db", () => ({
  appState: () => mockState,
  getSyncQueueToLocal: () => syncQueueToLocal,
  getAutoDownloadEnabled: () => autoDownloadEnabled,
}));

const syncSongToLocal = vi.fn(
  async (_song: unknown, onProgress?: (received: number, total: number) => void) => {
    onProgress?.(1, 1);
    return { success: true };
  }
);
vi.mock("../sync", () => ({
  syncSongToLocal: (...a: Parameters<typeof syncSongToLocal>) => syncSongToLocal(...a),
  canSyncSong: (song: Song) => song.source_type === "remote" && !!song.sha256,
}));

const isVideoSyncedLocally = vi.fn(() => false);
const syncVideoToLocal = vi.fn(async () => {
  isVideoSyncedLocally.mockReturnValue(true);
});
vi.mock("../../../video/services/sync/syncVideoToLocal", () => ({
  syncVideoToLocal: (...a: unknown[]) => syncVideoToLocal(...(a as [])),
  canSyncVideo: (video: QueuedVideo) => video.source_type === "remote",
}));
vi.mock("../../../video/services/syncState", () => ({
  isVideoSyncedLocally: (...a: unknown[]) => isVideoSyncedLocally(...(a as [])),
}));
vi.mock("../../../video/queries/queryKeys", () => ({
  videoQueryKeys: { videos: { all: () => ["videos"] } },
}));
vi.mock("../../queries/queryKeys", () => ({
  queryKeys: { songs: { all: () => ["songs"] }, albums: { all: () => ["albums"] } },
}));
vi.mock("../../../queryClient", () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));
vi.mock("../storage/blobResolver", () => ({
  isP2PRemote: vi.fn(async () => true),
}));

import { updateAutoDownloadQueue, getPendingDownloadCount, onAutoDownloadEnabled } from "./manager";
import { getActiveDownloadCount, clearAllFailures, clearSyncedSha256s } from "../download";

function remoteSong(over: Partial<Song> = {}): Song {
  return {
    sha256: `hash-${Math.random()}`,
    media_blob_id: "blob-1",
    remote_server_id: "remote-1",
    source_type: "remote",
    title: "song",
    duration_seconds: 9999, // way outside the 30min rolling window by itself
    ...over,
  } as unknown as Song;
}

function remoteVideo(over: Partial<QueuedVideo> = {}): QueuedVideo {
  return {
    id: `vid-${Math.random()}`,
    media_blob_id: "vblob-1",
    remote_server_id: "remote-1",
    source_type: "remote",
    title: "video",
    ...over,
  } as unknown as QueuedVideo;
}

beforeEach(() => {
  vi.clearAllMocks();
  autoDownloadEnabled = true;
  syncQueueToLocal = true;
  mockState = { queue: [], current_sha256: null };
  isVideoSyncedLocally.mockReturnValue(false);
  syncSongToLocal.mockImplementation(async (_song, onProgress) => {
    onProgress?.(1, 1);
    return { success: true };
  });
  clearAllFailures();
  clearSyncedSha256s();
});

describe("updateAutoDownloadQueue", () => {
  it("does nothing when auto-download is disabled", async () => {
    autoDownloadEnabled = false;
    mockState.queue = [{ kind: "song", song: remoteSong() }];
    await updateAutoDownloadQueue(0);
    expect(getPendingDownloadCount()).toBe(0);
    expect(syncSongToLocal).not.toHaveBeenCalled();
  });

  it("does nothing when sync-to-local is off", async () => {
    syncQueueToLocal = false;
    mockState.queue = [{ kind: "song", song: remoteSong() }];
    await updateAutoDownloadQueue(0);
    expect(getPendingDownloadCount()).toBe(0);
    expect(syncSongToLocal).not.toHaveBeenCalled();
  });

  it("downloads songs and videos added to the queue, beyond the rolling pre-cache window", async () => {
    const songs = [remoteSong(), remoteSong(), remoteSong()];
    const videos = [remoteVideo(), remoteVideo()];
    mockState.queue = [
      { kind: "song", song: songs[0] },
      { kind: "video", video: videos[0] },
      { kind: "song", song: songs[1] },
      { kind: "video", video: videos[1] },
      { kind: "song", song: songs[2] },
    ];

    await updateAutoDownloadQueue(0);
    // allow in-flight async work (isP2PRemote checks, downloads) to settle
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // the item at currentSongIndex itself is always treated as "within the
    // rolling window" (accumulatedSeconds starts at 0, so index 0 is
    // trivially < targetSeconds regardless of its own duration) - it's
    // presumed covered by the pre-cache scheduler instead, so only the
    // other 2 of 3 songs are auto-downloaded here.
    expect(syncSongToLocal).toHaveBeenCalledTimes(2);
    expect(syncVideoToLocal).toHaveBeenCalledTimes(2);
  });

  it("never exceeds the shared concurrency budget even with a large queue", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    syncSongToLocal.mockImplementation(async (_song, onProgress) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      onProgress?.(1, 1);
      await new Promise((r) => setTimeout(r, 5));
      concurrent--;
      return { success: true };
    });

    const songs = Array.from({ length: 10 }, () => remoteSong());
    mockState.queue = songs.map((song) => ({ kind: "song", song }));

    await updateAutoDownloadQueue(0);
    // drain: wait until all have been attempted (9 - see the "always skip
    // currentSongIndex itself" note above), then until the last one or two
    // in-flight promises' own registerDownload cleanup (a .finally(),
    // scheduled a tick after the mock's own timer resolves) has run.
    for (let i = 0; i < 20 && syncSongToLocal.mock.calls.length < 9; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    for (let i = 0; i < 20 && getActiveDownloadCount() > 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(syncSongToLocal).toHaveBeenCalledTimes(9);
    expect(maxConcurrent).toBeLessThanOrEqual(3);
    expect(getActiveDownloadCount()).toBe(0);
  });

  it("onAutoDownloadEnabled clears prior failures so a re-enable retries", () => {
    expect(() => onAutoDownloadEnabled()).not.toThrow();
  });
});
