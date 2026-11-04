// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicNowPlaying } from "@freqhole/api-client";

const mocks = vi.hoisted(() => {
  class SourceBufferStub extends EventTarget {
    updating = false;
    mode = "sequence";
    end = 0;
    buffered: TimeRanges;
    constructor() {
      super();
      const owner = this;
      this.buffered = {
        get length() {
          return owner.end > 0 ? 1 : 0;
        },
        start: () => 0,
        end: () => owner.end,
      };
    }
    appendBuffer(bytes: Uint8Array) {
      this.updating = true;
      queueMicrotask(() => {
        this.end += bytes[0];
        this.updating = false;
        this.dispatchEvent(new Event("updateend"));
      });
    }
    abort() {
      this.updating = false;
    }
    remove() {}
  }
  class MediaSourceStub extends EventTarget {
    static instances: MediaSourceStub[] = [];
    static isTypeSupported = () => true;
    readyState = "open";
    source = new SourceBufferStub();
    constructor() {
      super();
      MediaSourceStub.instances.push(this);
      queueMicrotask(() => this.dispatchEvent(new Event("sourceopen")));
    }
    addSourceBuffer() {
      return this.source;
    }
    endOfStream() {}
  }
  vi.stubGlobal("MediaSource", MediaSourceStub);
  return {
    MediaSourceStub,
    hello: null as ((json: string) => void) | null,
    meta: null as ((json: string) => void) | null,
    chunk: null as ((seq: number, init: boolean, bytes: Uint8Array) => void) | null,
    timelineTime: 0,
    timelineDuration: 60,
    remote: null as { remote_id: string } | null,
  };
});

vi.mock("../../api/client", () => ({
  isCharnelAvailable: () => false,
  getClientForRemote: vi.fn(),
  getMiddenNode: async () => ({
    tune_radio: async (
      _peer: string,
      _station: string,
      _resume: unknown,
      hello: (json: string) => void,
      meta: (json: string) => void,
      chunk: (seq: number, init: boolean, bytes: Uint8Array) => void
    ) => {
      mocks.hello = hello;
      mocks.meta = meta;
      mocks.chunk = chunk;
      return { leave: vi.fn() };
    },
  }),
}));
vi.mock("./charnelRadioAdapter", () => ({
  tuneRadioCharnel: vi.fn(),
  tuneRadioCharnelLocal: vi.fn(),
}));
vi.mock("../playbackCoordinator", () => ({
  registerStopRadio: vi.fn(),
  registerVolumeMirror: vi.fn(),
  stopMusicForRadio: async () => {},
}));
vi.mock("../../../music/services/audio/player", () => ({
  pause: vi.fn(),
  currentTime: () => mocks.timelineTime,
  duration: () => mocks.timelineDuration,
}));
vi.mock("./radioHistory", () => ({ recordHistoryEntry: async () => {} }));
vi.mock("./radioListenSession", () => ({
  RadioListenSession: class {
    start() {}
    record() {}
    async end() {}
  },
}));
vi.mock("../storage/currentRadioStation", () => ({
  currentRadioStation: () => null,
  setCurrentRadioStationPersisted: async () => {},
}));
vi.mock("../remotes/remoteManager", () => ({
  getRemoteByPeerAddr: async () => mocks.remote,
  getTauriManagedRemote: async () => null,
}));
vi.mock("./radioFavorite", () => ({
  currentFavorite: () => null,
  setCurrentFavorite: vi.fn(),
  fetchRadioFavorite: vi.fn(),
  setRadioFavoriteForPeer: vi.fn(),
}));

import {
  tuneIntoRadio,
  leaveRadio,
  setRadioAudioSink,
  radioNowPlaying,
  radioTrackPositionMs,
  radioElapsedMs,
} from "./radioService";
import { getClientForRemote } from "../../api/client";

let audio: HTMLVideoElement;
let paused = true;

function nowPlaying(
  id: string,
  kind: "song" | "video" = "video",
  durationMs = 60_000
): PublicNowPlaying {
  return { kind, song_id: id, title: id || "switching tracks…", duration_ms: durationMs };
}
function meta(seq: number, id: string, kind: "song" | "video" = "video") {
  mocks.meta!(
    JSON.stringify({ init_seq: seq, now_playing: nowPlaying(id, kind), listener_count: 2 })
  );
}
async function chunks(seq: number, seconds: number) {
  mocks.chunk!(seq, true, new Uint8Array([0]));
  mocks.chunk!(seq + 1, false, new Uint8Array([seconds]));
  for (let i = 0; i < 6; i++) await Promise.resolve();
}
async function tick(time: number) {
  audio.currentTime = time;
  await vi.advanceTimersByTimeAsync(500);
}
async function tune(kind: "song" | "video" = "video", timeline = false) {
  await tuneIntoRadio("a".repeat(64), { stationId: "station" });
  mocks.hello!(
    JSON.stringify({
      init_seq: 10,
      codec:
        kind === "video"
          ? 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"'
          : 'audio/mp4; codecs="mp4a.40.2"',
      now_playing: nowPlaying("first", kind),
      broadcaster_timeline_only: timeline,
    })
  );
  if (!timeline) await chunks(10, 60);
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:radio");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  mocks.timelineTime = 0;
  mocks.timelineDuration = 60;
  mocks.remote = null;
  audio = document.createElement("video");
  paused = true;
  Object.defineProperties(audio, {
    paused: { get: () => paused },
    readyState: { get: () => 4 },
    buffered: { get: () => mocks.MediaSourceStub.instances.at(-1)!.source.buffered },
  });
  vi.spyOn(audio, "play").mockImplementation(async () => {
    paused = false;
  });
  vi.spyOn(audio, "pause").mockImplementation(() => {
    paused = true;
  });
  vi.spyOn(audio, "load").mockImplementation(() => {});
  setRadioAudioSink(audio);
});
afterEach(() => {
  leaveRadio();
  setRadioAudioSink(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("radio display follows buffered playback", () => {
  it.each(["song", "video"] as const)(
    "keeps %s metadata until the media ends, then shows the gap until the next starts",
    async (kind) => {
      await tune(kind);
      await tick(15);
      meta(10, "", kind);
      expect(radioNowPlaying()?.song_id).toBe("first");
      await tick(59.99);
      expect(radioNowPlaying()?.song_id).toBe("first");
      await tick(60);
      expect(radioNowPlaying()?.title).toBe("switching tracks…");
      meta(20, "second", kind);
      await chunks(20, 40);
      await tick(60);
      expect(radioNowPlaying()?.song_id).toBe("second");
      expect(radioTrackPositionMs()).toBe(0);
      await tick(65);
      expect(radioTrackPositionMs()).toBe(5000);
    }
  );

  it("does not flash a switching banner when the next track is already buffered", async () => {
    await tune();
    await tick(10);
    meta(10, "");
    meta(20, "second");
    await chunks(20, 40);
    await tick(59.99);
    expect(radioNowPlaying()?.song_id).toBe("first");
    await tick(60);
    expect(radioNowPlaying()?.song_id).toBe("second");
  });

  it("does not replace the gap banner just because the next track's init header arrived", async () => {
    await tune();
    await tick(15);
    meta(10, "");
    meta(20, "second");
    mocks.chunk!(20, true, new Uint8Array([0]));
    for (let i = 0; i < 6; i++) await Promise.resolve();
    await tick(60);
    expect(radioNowPlaying()?.title).toBe("switching tracks…");
    mocks.chunk!(21, false, new Uint8Array([20]));
    for (let i = 0; i < 6; i++) await Promise.resolve();
    await tick(60);
    await tick(61);
    expect(radioNowPlaying()?.song_id).toBe("second");
  });

  it("shows a real end-of-track waiting gap even if the decoder stops just before the last timestamp", async () => {
    await tune();
    await tick(59.99);
    meta(10, "");
    expect(radioNowPlaying()?.song_id).toBe("first");
    audio.dispatchEvent(new Event("waiting"));
    expect(radioNowPlaying()?.title).toBe("switching tracks…");
  });

  it("resets track position on every boundary, without resetting total listening time", async () => {
    await tune();
    await tick(25);
    expect(radioTrackPositionMs()).toBe(25_000);
    meta(20, "second");
    await chunks(20, 40);
    await tick(70);
    expect(radioTrackPositionMs()).toBe(10_000);
    const listened = radioElapsedMs();
    meta(30, "third");
    await chunks(30, 50);
    await tick(105);
    expect(radioNowPlaying()?.song_id).toBe("third");
    expect(radioTrackPositionMs()).toBe(5000);
    expect(radioElapsedMs()).toBeGreaterThan(listened);
    leaveRadio();
    expect(radioTrackPositionMs()).toBe(0);
  });

  it("latches late metadata to its recorded boundary", async () => {
    await tune();
    await tick(15);
    await chunks(20, 40);
    meta(20, "second");
    await tick(60);
    expect(radioNowPlaying()?.song_id).toBe("second");
    expect(radioTrackPositionMs()).toBe(0);
    await tick(66);
    expect(radioTrackPositionMs()).toBe(6000);
  });

  it("treats a repeated item as a new track, not an immediate refresh", async () => {
    await tune();
    await tick(15);
    meta(20, "first");
    await chunks(20, 60);
    await tick(30);
    expect(radioTrackPositionMs()).toBe(30_000);
    await tick(65);
    expect(radioTrackPositionMs()).toBe(5000);
  });

  it("uses the queue player's track time in timeline mode and defers early banners there too", async () => {
    await tune("song", true);
    mocks.timelineTime = 15;
    expect(radioTrackPositionMs()).toBe(15_000);
    meta(10, "", "song");
    await tick(0);
    expect(radioNowPlaying()?.song_id).toBe("first");
    mocks.timelineTime = 60;
    await tick(0);
    expect(radioNowPlaying()?.title).toBe("switching tracks…");
  });
});

describe("radio video resume progress", () => {
  function progressClient() {
    const upsert = vi.fn(async () => ({ success: true, data: {} }));
    mocks.remote = { remote_id: "station-library" };
    vi.mocked(getClientForRemote).mockResolvedValue({
      entities: { upsertPlaybackProgress: upsert },
    } as never);
    return upsert;
  }
  async function settle() {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }

  it("marks an episode finished when it plays out, then saves where the next one was left", async () => {
    const upsert = progressClient();
    await tune();
    await tick(30);
    meta(20, "second");
    await chunks(20, 40);
    await tick(60);
    await settle();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_type: "video",
        entity_id: "first",
        position_fraction: 1,
        position_seconds: 60,
      })
    );
    await tick(70);
    leaveRadio();
    await settle();
    expect(upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ entity_id: "second", position_seconds: 10 })
    );
  });

  it("adds the broadcast start offset when a station resumes an episode mid-way", async () => {
    const upsert = progressClient();
    await tune();
    await tick(30);
    mocks.meta!(
      JSON.stringify({
        init_seq: 20,
        now_playing: { ...nowPlaying("second", "video", 1_800_000), start_offset_ms: 300_000 },
        listener_count: 2,
      })
    );
    await chunks(20, 40);
    await tick(60);
    await tick(70);
    leaveRadio();
    await settle();
    expect(upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ entity_id: "second", position_seconds: 310 })
    );
  });

  it("does not record song tracks as video progress", async () => {
    const upsert = progressClient();
    await tune("song");
    await tick(30);
    leaveRadio();
    await settle();
    expect(upsert).not.toHaveBeenCalled();
  });
});
