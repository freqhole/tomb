// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedVideo } from "../../../app/services/storage/mediaItem";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(async () => ({ success: true })),
  session: "season-session" as string | null,
  warn: vi.fn(),
}));
vi.mock("../../../app/services/storage/db", () => ({ appState: () => null }));
vi.mock("../../../music/services/audio/playerState", () => ({
  currentTime: () => 0,
  duration: () => 100,
  isPlaying: () => false,
}));
vi.mock("../../../app/api/client", () => ({
  getClientForRemote: async () => ({ entities: { upsertPlaybackProgress: mocks.upsert } }),
}));
vi.mock("../../../app/services/remotes/remoteManager", () => ({
  getRemoteById: async () => ({ remote_id: "library" }),
}));
vi.mock("./videoListenProgress", () => ({ activeVideoHistoryEntryId: () => "history" }));
vi.mock("../../../music/services/queue/serverSession", () => ({
  getSessionIdForRemote: () => mocks.session,
}));
vi.mock("../../../utils/logger", () => ({ warn: mocks.warn }));

import { stopVideoRemoteSync, syncVideoProgress } from "./videoServerProgressSync";

const video = {
  id: "episode",
  source_type: "remote",
  remote_server_id: "library",
} as QueuedVideo;

beforeEach(() => {
  stopVideoRemoteSync();
  vi.clearAllMocks();
  mocks.session = "season-session";
  mocks.upsert.mockResolvedValue({ success: true });
});

describe("server watch progress", () => {
  it("attaches named queue context while retaining individual resume positions", async () => {
    await syncVideoProgress(video, 42, 100);
    expect(mocks.upsert).toHaveBeenCalledWith({
      entity_type: "video",
      entity_id: "episode",
      position_fraction: 0.42,
      position_seconds: 42,
      duration_seconds: 100,
      session_id: "season-session",
    });
  });

  it("keeps the session for trailing progress after its final item completes", async () => {
    await syncVideoProgress(video, 90, 100);
    mocks.session = null;
    await syncVideoProgress(video, 95, 100);
    expect(mocks.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ session_id: "season-session" })
    );
    stopVideoRemoteSync();
    await syncVideoProgress(video, 20, 100);
    expect(mocks.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ session_id: undefined })
    );
  });

  it("does not reuse a completed session for a different video", async () => {
    await syncVideoProgress(video, 90, 100);
    mocks.session = null;
    await syncVideoProgress({ ...video, id: "another-video" }, 20, 100);
    expect(mocks.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ session_id: undefined })
    );
  });

  it("does not submit invalid positions or browser-only videos", async () => {
    await syncVideoProgress(video, NaN, 100);
    await syncVideoProgress(video, 10, 0);
    await syncVideoProgress({ ...video, source_type: "local" }, 10, 100);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
