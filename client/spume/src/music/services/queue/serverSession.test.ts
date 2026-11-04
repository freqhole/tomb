import { describe, expect, it, vi } from "vitest";
import type { MediaItem } from "../../../app/services/storage/mediaItem";

vi.mock("../../../app/api/client", () => ({
  getClientForRemote: vi.fn(),
  isNetworkError: vi.fn(),
}));
vi.mock("../../../app/services/remotes/remoteManager", () => ({ getRemoteById: vi.fn() }));
vi.mock("../../../app/services/storage/db", () => ({ appState: () => null }));
vi.mock("./queueHistory", () => ({
  updateHistoryServerSession: vi.fn(),
  clearHistoryServerSession: vi.fn(),
}));
vi.mock("./smartLabel", () => ({ computeSmartMediaLabel: () => "queue" }));

import { resolveSessionType } from "./serverSession";

const videos = [{ kind: "video", video: { id: "episode" } }] as MediaItem[];
const songs = [{ kind: "song", song: { id: "track" } }] as MediaItem[];

describe("playback session media classification", () => {
  it("uses watching sessions for video-only queues even with a generic source", () => {
    for (const type of ["shuffle", "playlist", "song"] as const) {
      expect(resolveSessionType({ type, label: "queue" }, videos)).toBe("video");
    }
  });

  it("keeps named series and season queues grouped", () => {
    expect(resolveSessionType({ type: "series", label: "a series" }, videos)).toBe("video_series");
    expect(resolveSessionType({ type: "season", label: "season 1" }, videos)).toBe("video_season");
  });

  it("preserves music and mixed session behavior", () => {
    expect(resolveSessionType({ type: "album", label: "album" }, songs)).toBe("album");
    expect(resolveSessionType({ type: "genre", label: "genre" }, songs)).toBe("taxon");
    expect(resolveSessionType({ type: "series", label: "queue" }, [...songs, ...videos])).toBe(
      "mixed"
    );
  });
});
