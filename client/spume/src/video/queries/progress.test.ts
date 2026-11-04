import { describe, expect, it, vi } from "vitest";
import type { VideoQueueHistoryEntry } from "../../app/services/storage/types";
import type { QueuedVideo } from "../../app/services/storage/mediaItem";

vi.mock("../../music/data", () => ({ getRemoteClient: async () => null }));
vi.mock("../../music/data/currentState", () => ({ getCurrentRemote: () => null }));
vi.mock("../../app/api/client", () => ({ getClientForRemote: vi.fn() }));
vi.mock("../../app/services/remotes/remoteManager", () => ({ getTauriManagedRemote: vi.fn() }));
vi.mock("../../app/services/charnel", () => ({ isCharnelMode: () => false }));
vi.mock("../services/queue/videoQueueHistory", () => ({ videoQueueHistory: () => [] }));

import { mergeVideoHistoryProgress, pickResumeTarget, resumePositionFor } from "./progress";

const videos = [
  { id: "episode-1", blake3: "hash-1", remote_server_id: "library" },
  { id: "episode-2", blake3: "hash-2", remote_server_id: "library" },
];

function history(overrides: Partial<VideoQueueHistoryEntry> = {}): VideoQueueHistoryEntry {
  return {
    id: "history",
    type: "season",
    label: "a series · season 1",
    videos: videos.map((video) => ({ ...video, duration_seconds: 100 }) as QueuedVideo),
    video_count: 2,
    queued_at: 1_000,
    progress_updated_at: 10_000,
    watched_seconds: 30,
    total_seconds: 200,
    videos_completed: 0,
    current_video_index: 0,
    current_video_position: 30,
    ...overrides,
  };
}

describe("series resume from watch history", () => {
  it("resumes a season's current episode before its first server sync", () => {
    const progress = mergeVideoHistoryProgress(videos, new Map(), [history()]);
    expect(pickResumeTarget(videos, progress)).toEqual({ index: 0, positionSeconds: 30 });
    expect(resumePositionFor("episode-1", progress)).toBe(30);
  });

  it("also recognizes an episode played on its own or imported into the browser", () => {
    const entry = history({
      type: "video",
      videos: [{ id: "local-copy", blake3: "hash-2", duration_seconds: 100 } as QueuedVideo],
    });
    expect(pickResumeTarget(videos, mergeVideoHistoryProgress(videos, new Map(), [entry]))).toEqual(
      { index: 1, positionSeconds: 30 }
    );
  });

  it("advances to the next episode after completion, but not past the series end", () => {
    const progress = mergeVideoHistoryProgress(videos, new Map(), [
      history({ current_video_position: 95 }),
    ]);
    expect(pickResumeTarget(videos, progress)).toEqual({ index: 1, positionSeconds: 0 });
    expect(resumePositionFor("episode-1", progress)).toBeUndefined();
    const finished = mergeVideoHistoryProgress(videos, new Map(), [
      history({ current_video_index: 1, current_video_position: 100 }),
    ]);
    expect(pickResumeTarget(videos, finished)).toBeNull();
  });

  it("keeps newer server progress and ignores untouched history entries", () => {
    const server = new Map([
      ["episode-1", { position_fraction: 0.6, position_seconds: 60, updated_at: 20 }],
    ]);
    const progress = mergeVideoHistoryProgress(videos, server, [
      history(),
      history({ current_video_index: 1, current_video_position: 0 }),
    ]);
    expect(pickResumeTarget(videos, progress)).toEqual({ index: 0, positionSeconds: 60 });
    expect(progress.has("episode-2")).toBe(false);
  });

  it("does not confuse equal ids on different libraries without a matching hash", () => {
    const progress = mergeVideoHistoryProgress(
      [{ id: "episode-1", remote_server_id: "other-library" }],
      new Map(),
      [history()]
    );
    expect(progress.size).toBe(0);
  });
});
