import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  effect: () => {},
  time: 0,
  duration: 100,
  playing: true,
  key: "episode-1" as string | null,
  clock: 0,
  sync: vi.fn(),
  record: vi.fn(),
  complete: vi.fn(),
  flush: vi.fn(),
  analytics: vi.fn(),
}));
vi.mock("solid-js", () => ({
  createRoot: (fn: () => void) => fn(),
  createEffect: (fn: () => void) => {
    state.effect = fn;
  },
}));
vi.mock("../../../app/services/storage/db", () => ({
  appState: () => ({
    current_item_key: state.key,
    queue: ["episode-1", "episode-2"].map((id) => ({
      kind: "video",
      video: { id, remote_server_id: "library", source_type: "remote" },
    })),
  }),
}));
vi.mock("../../../music/services/audio/playerState", () => ({
  currentTime: () => state.time,
  duration: () => state.duration,
  isPlaying: () => state.playing,
}));
vi.mock("./videoListenProgress", () => ({
  recordVideoTimeProgress: state.record,
  markVideoCompleted: state.complete,
  flushVideoProgress: state.flush,
}));
vi.mock("./videoServerProgressSync", () => ({
  syncVideoProgress: state.sync,
  startVideoRemoteSync: vi.fn(),
}));
vi.mock("../../../music/services/queue/serverSession", () => ({
  getSessionIdForRemote: () => "season-session",
}));
vi.mock("../../../music/services/analytics/analyticsQueue", () => ({
  queueAnalyticsEvent: state.analytics,
}));

import { installVideoPlaybackOrchestrator } from "./videoPlaybackOrchestrator";

installVideoPlaybackOrchestrator();

beforeEach(() => {
  state.key = null;
  state.clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => state.clock);
  state.effect();
  vi.clearAllMocks();
  state.time = 0;
  state.duration = 100;
  state.playing = true;
  state.key = "episode-1";
  state.effect();
});

function tick(time: number) {
  state.clock += 1000;
  state.time = time;
  state.effect();
}

describe("watch progress lifecycle", () => {
  it("flushes the outgoing episode's own position when the queue advances", () => {
    tick(30);
    tick(32);
    expect(state.sync).not.toHaveBeenCalled();
    state.key = "episode-2";
    tick(0);
    expect(state.sync).toHaveBeenCalledWith(
      expect.objectContaining({ id: "episode-1" }),
      32,
      100,
      "season-session"
    );
    expect(state.flush).toHaveBeenCalledWith(true);
  });

  it("flushes on pause and queue clear without sending progress every tick", () => {
    tick(20);
    tick(22);
    state.playing = false;
    state.effect();
    state.effect();
    expect(state.sync).toHaveBeenCalledTimes(1);
    expect(state.sync).toHaveBeenCalledWith(
      expect.objectContaining({ id: "episode-1" }),
      22,
      100,
      "season-session"
    );
    state.key = null;
    state.effect();
    expect(state.sync).toHaveBeenCalledTimes(2);
  });

  it("records completion once with the named queue session before advancing it", () => {
    for (let time = 1; time <= 90; time++) tick(time);
    expect(state.analytics).not.toHaveBeenCalled();
    expect(state.complete).not.toHaveBeenCalled();
    tick(91);
    tick(92);
    expect(state.complete).toHaveBeenCalledTimes(1);
    expect(state.analytics).toHaveBeenCalledTimes(1);
    expect(state.analytics).toHaveBeenCalledWith(
      "video_play_complete",
      expect.objectContaining({
        video_id: "episode-1",
        event_data: { played_seconds: 91, duration_seconds: 100 },
      })
    );
    expect(state.sync).toHaveBeenCalledWith(
      expect.objectContaining({ id: "episode-1" }),
      91,
      100,
      "season-session"
    );
  });

  it("does not count seeking past 90% or skipping as a play", () => {
    tick(95);
    tick(96);
    expect(state.analytics).not.toHaveBeenCalled();
    state.key = "episode-2";
    tick(0);
    expect(state.analytics).not.toHaveBeenCalled();
    for (let time = 1; time <= 90; time++) tick(time);
    expect(state.analytics).not.toHaveBeenCalled();
    tick(91);
    expect(state.analytics).toHaveBeenCalledTimes(1);
  });

  it("does not accumulate watch time from paused seeks", () => {
    tick(20);
    state.playing = false;
    tick(22);
    expect(state.record).not.toHaveBeenCalled();
  });
});
