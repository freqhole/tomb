// @vitest-environment jsdom

// integration test for the actual bug report: an item removed from the
// queue mid-download must never reach play() once that download
// resolves, no matter how long it takes. loadGuard.test.ts already
// covers the pure generation-counter logic in isolation; this is the
// missing piece - does VideoBackend.loadAndPlay actually consult it
// correctly against a REAL, slow-resolving download, racing against a
// real cancelMediaLoads() call (the same one setQueue()'s departure
// diff fires on removal)?
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "../../app/services/storage/mediaItem";
import { beginMediaLoad, cancelMediaLoads } from "../../app/services/media/loadGuard";

vi.mock("../../app/services/storage/db", () => ({ setCurrentSong: vi.fn(async () => {}) }));
vi.mock("../../music/services/audio/mediaSessionBridge", () => ({
  registerWatchdog: () => () => {},
}));
vi.mock("./queue/videoPlaybackOrchestrator", () => ({
  installVideoPlaybackOrchestrator: () => {},
}));
vi.mock("../../music/services/download", () => ({
  addToLoadingSet: () => {},
  updateLoadingProgress: () => {},
  removeFromLoadingSet: () => {},
}));
vi.mock("../../music/services/audio/playerState", () => ({
  isPlaying: () => false,
  pendingUpNextItemKey: () => null,
  setPendingUpNextItemKey: () => {},
}));

// the actual "download" step - deliberately resolves only when the test
// tells it to, simulating a slow remote fetch that's still in flight
// when the item gets removed from the queue.
let resolveDownload: (url: string) => void;
const getVideoURL = vi.fn(
  () =>
    new Promise<string>((resolve) => {
      resolveDownload = resolve;
    })
);
vi.mock("./videoBlobAccess", () => ({ getVideoURL: () => getVideoURL() }));

import { VideoBackend } from "./videoBackend";

function video(id: string): MediaItem {
  return {
    kind: "video",
    video: {
      id,
      title: `video ${id}`,
      content_type: "movie",
      media_blob_id: "blob",
      created_at: 0,
      updated_at: 0,
      added_at: 0,
      source_type: "remote",
      is_offline: false,
    },
  } as MediaItem;
}

describe("VideoBackend.loadAndPlay vs. mid-download removal", () => {
  let backend: VideoBackend;
  let playSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    backend = new VideoBackend();
    const el = backend.element();
    // jsdom's <video>.play() always rejects ("not implemented") - stub it
    // so a wrongly-reached play() call is unambiguous and doesn't throw.
    playSpy = vi.spyOn(el, "play").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never calls play() for an item removed from the queue while its download was still in flight", async () => {
    const item = video("v-removed-mid-download");
    // mirrors playVideo()'s real sequence: beginMediaLoad() happens
    // BEFORE the download starts, not a hardcoded value.
    const generation = beginMediaLoad("v-removed-mid-download");
    const playPromise = backend.loadAndPlay(item, { loadGeneration: generation });

    // the item leaves the queue (mirrors purgeDepartedMedia.ts's call on
    // setQueue's departure diff) WHILE getVideoURL is still unresolved.
    cancelMediaLoads(["v-removed-mid-download"]);

    // only now does the slow download actually finish.
    resolveDownload("blob:fake-video-url");
    await playPromise;

    expect(playSpy).not.toHaveBeenCalled();
  });

  it("still plays normally when nothing was removed", async () => {
    const item = video("v-kept");
    const generation = beginMediaLoad("v-kept");
    const playPromise = backend.loadAndPlay(item, { loadGeneration: generation });
    resolveDownload("blob:fake-video-url");
    await playPromise;

    expect(playSpy).toHaveBeenCalledTimes(1);
  });
});
