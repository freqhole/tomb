import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  effect: () => {},
  time: 0,
  duration: 100,
  playing: true,
  key: "song-1" as string | null,
  clock: 0,
  analytics: vi.fn(),
  record: vi.fn(),
  complete: vi.fn(),
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
    queue: ["song-1", "song-2"].map((id) => ({
      kind: "song",
      song: { id, media_blob_id: "blob", remote_server_id: "remote" },
    })),
  }),
}));
vi.mock("./playerState", () => ({
  currentTime: () => state.time,
  duration: () => state.duration,
  isPlaying: () => state.playing,
}));
vi.mock("../storage/types", () => ({ songIdentityKey: (song: { id: string }) => song.id }));
vi.mock("../queue/listenProgress", () => ({
  activeHistoryEntryId: () => "history",
  consumePendingServerReconnect: vi.fn(),
  markSongCompleted: state.complete,
  recordTimeProgress: state.record,
}));
vi.mock("../queue/queueProgress", () => ({ updateQueueItemProgress: vi.fn() }));
vi.mock("../analytics/analyticsQueue", () => ({ queueAnalyticsEvent: state.analytics }));

import { installPlaybackOrchestrator } from "./playbackOrchestrator";

installPlaybackOrchestrator();

beforeEach(() => {
  state.key = null;
  state.clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => state.clock);
  state.effect();
  vi.clearAllMocks();
  state.time = 0;
  state.duration = 100;
  state.playing = true;
  state.key = "song-1";
  state.effect();
});

function tick(time: number) {
  state.clock += 1000;
  state.time = time;
  state.effect();
}

describe("music play analytics", () => {
  it("counts a play strictly after 90% actual listening and carries its evidence", () => {
    for (let time = 1; time <= 90; time++) tick(time);
    expect(state.analytics).not.toHaveBeenCalled();
    tick(91);
    tick(92);
    expect(state.analytics).toHaveBeenCalledTimes(1);
    expect(state.analytics).toHaveBeenCalledWith(
      "play_complete",
      expect.objectContaining({
        song_id: "song-1",
        event_data: { played_seconds: 91, duration_seconds: 100 },
      })
    );
    expect(state.complete).toHaveBeenCalledTimes(1);
  });

  it("does not credit seeking to the end or paused movement", () => {
    tick(95);
    tick(96);
    state.playing = false;
    tick(98);
    state.playing = true;
    tick(99);
    expect(state.analytics).not.toHaveBeenCalled();
    expect(state.record).toHaveBeenCalledTimes(1);
  });

  it("resets qualification when clearing or advancing the queue", () => {
    for (let time = 1; time <= 80; time++) tick(time);
    state.key = "song-2";
    tick(0);
    for (let time = 1; time <= 20; time++) tick(time);
    expect(state.analytics).not.toHaveBeenCalled();
    state.key = null;
    state.effect();
    state.key = "song-2";
    tick(95);
    tick(96);
    expect(state.analytics).not.toHaveBeenCalled();
  });
});
