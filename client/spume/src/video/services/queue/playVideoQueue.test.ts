import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedVideo } from "../../../app/services/storage/mediaItem";

const mocks = vi.hoisted(() => ({
  setQueue: vi.fn(),
  play: vi.fn(),
  history: vi.fn(async () => "history"),
  track: vi.fn(),
  sync: vi.fn(),
  sessions: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("../../../app/services/storage/db", () => ({ setQueue: mocks.setQueue }));
vi.mock("../../../music/services/audio/player", () => ({ playMediaItem: mocks.play }));
vi.mock("./videoQueueHistory", () => ({
  addVideoHistoryEntry: mocks.history,
  updateVideoHistoryServerSession: vi.fn(),
}));
vi.mock("./videoListenProgress", () => ({ resumeVideoTracking: mocks.track }));
vi.mock("./videoServerProgressSync", () => ({ startVideoRemoteSync: mocks.sync }));
vi.mock("../../../app/services/players/remoteQueueMirror", () => ({
  mirrorReplaceVideosToQueue: vi.fn(),
}));
vi.mock("../../../music/services/queue/triggerPreCache", () => ({ triggerPreCache: vi.fn() }));
vi.mock("../../../music/services/queue/serverSession", () => ({
  createServerSessions: mocks.sessions,
  resumeServerSession: vi.fn(),
}));
vi.mock("../../../app/services/remotes/remoteManager", () => ({ getRemoteById: vi.fn() }));
vi.mock("../../../components/feedback/Toast", () => ({ toast: { error: vi.fn() } }));

import { playVideoQueue } from "./playVideoQueue";

const videos = ["episode-1", "episode-2"].map(
  (id) => ({ id, title: id, duration_seconds: 100 }) as QueuedVideo
);
const source = { type: "season" as const, label: "a series · season 1", entity_id: "season" };

beforeEach(() => vi.clearAllMocks());

describe("resuming a named video queue", () => {
  it("uses seconds consistently and initializes history at the selected episode", async () => {
    await playVideoQueue(videos, 1, source, 42);
    expect(mocks.play).toHaveBeenCalledWith(
      expect.objectContaining({ video: expect.objectContaining({ id: "episode-2" }) }),
      { userInitiated: true, initialPosition: 42 }
    );
    const progress = {
      watched_seconds: 0,
      videos_completed: 1,
      current_video_index: 1,
      current_video_position: 42,
    };
    expect(mocks.history).toHaveBeenCalledWith(expect.any(Array), source, progress);
    expect(mocks.track).toHaveBeenCalledWith("history", progress);
    expect(mocks.sessions).toHaveBeenCalledWith(expect.any(Array), source);
  });

  it("does not mint another feed session when resuming an existing server session", async () => {
    await playVideoQueue(videos, 1, source, 42, { skipServerSession: true });
    expect(mocks.track).toHaveBeenCalled();
    expect(mocks.sync).toHaveBeenCalled();
    expect(mocks.sessions).not.toHaveBeenCalled();
  });
});
