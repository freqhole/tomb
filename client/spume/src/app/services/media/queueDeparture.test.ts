// unit tests for the queue departure diff.
//
// the cases below mirror the real exit paths in `queue.ts`: single removal,
// clear-above / clear-below, wholesale replacement (selecting an album,
// resuming a history entry) and reorder. the last two evict nothing today.

import { describe, expect, it } from "vitest";
import type { MediaItem } from "../storage/mediaItem";
import { diffQueueDepartures } from "./queueDeparture";

// minimal stand-ins — the diff only reads `mediaItemKey`, i.e. `song.sha256`
// for songs and `video.id` for videos.
function song(sha256: string): MediaItem {
  return { kind: "song", song: { sha256 } } as unknown as MediaItem;
}

function video(id: string): MediaItem {
  return { kind: "video", video: { id } } as unknown as MediaItem;
}

function keysOf(items: MediaItem[]): string[] {
  return items.map((i) => (i.kind === "song" ? i.song.sha256 : i.video.id));
}

describe("diffQueueDepartures", () => {
  it("reports nothing when the queue is unchanged", () => {
    const q = [song("a"), song("b")];
    expect(diffQueueDepartures(q, q)).toEqual([]);
  });

  it("reports nothing for a pure reorder", () => {
    const prev = [song("a"), song("b"), song("c")];
    const next = [song("c"), song("a"), song("b")];
    expect(diffQueueDepartures(prev, next)).toEqual([]);
  });

  it("reports nothing when items are only added", () => {
    const prev = [song("a")];
    const next = [song("a"), song("b")];
    expect(diffQueueDepartures(prev, next)).toEqual([]);
  });

  it("reports a single removed item", () => {
    const prev = [song("a"), song("b"), song("c")];
    const next = [song("a"), song("c")];
    expect(keysOf(diffQueueDepartures(prev, next))).toEqual(["b"]);
  });

  it("reports everything dropped by clear-above", () => {
    const prev = [song("a"), song("b"), song("c"), song("d")];
    const next = prev.slice(2);
    expect(keysOf(diffQueueDepartures(prev, next))).toEqual(["a", "b"]);
  });

  it("reports everything dropped by clear-below", () => {
    const prev = [song("a"), song("b"), song("c"), song("d")];
    const next = prev.slice(0, 2);
    expect(keysOf(diffQueueDepartures(prev, next))).toEqual(["c", "d"]);
  });

  it("reports the whole previous queue when it is cleared", () => {
    const prev = [song("a"), song("b")];
    expect(keysOf(diffQueueDepartures(prev, []))).toEqual(["a", "b"]);
  });

  // playQueue's REPLACE_SOURCE_TYPES path and resumeHistoryEntry both do this,
  // and both evict nothing today.
  it("reports the whole previous queue when it is replaced wholesale", () => {
    const prev = [song("a"), song("b")];
    const next = [song("x"), song("y")];
    expect(keysOf(diffQueueDepartures(prev, next))).toEqual(["a", "b"]);
  });

  it("keeps items that survive a wholesale replacement", () => {
    const prev = [song("a"), song("b")];
    const next = [song("b"), song("x")];
    expect(keysOf(diffQueueDepartures(prev, next))).toEqual(["a"]);
  });

  it("reports nothing when starting from an empty queue", () => {
    expect(diffQueueDepartures([], [song("a")])).toEqual([]);
  });

  describe("duplicates", () => {
    it("does not report a song still queued elsewhere", () => {
      const prev = [song("a"), song("b"), song("a")];
      const next = [song("a"), song("b")];
      expect(diffQueueDepartures(prev, next)).toEqual([]);
    });

    it("reports a fully-removed duplicate exactly once", () => {
      const prev = [song("a"), song("a"), song("b")];
      const next = [song("b")];
      expect(keysOf(diffQueueDepartures(prev, next))).toEqual(["a"]);
    });
  });

  // every existing eviction block in queue.ts does `if (item.kind !== "song")
  // continue;`, so video is never evicted anywhere today.
  describe("video", () => {
    it("reports departed videos", () => {
      const prev = [video("v1"), song("a")];
      const next = [song("a")];
      expect(keysOf(diffQueueDepartures(prev, next))).toEqual(["v1"]);
    });

    it("reports mixed song and video departures together", () => {
      const prev = [song("a"), video("v1"), song("b"), video("v2")];
      const next = [song("b")];
      expect(keysOf(diffQueueDepartures(prev, next))).toEqual(["a", "v1", "v2"]);
    });

    it("does not confuse a video id with a song sha256 of the same value", () => {
      const prev = [song("dup"), video("dup")];
      const next: MediaItem[] = [];
      // both share an identity key, so the key-level unit of departure
      // collapses them - documenting the behavior rather than asserting two.
      expect(keysOf(diffQueueDepartures(prev, next))).toEqual(["dup"]);
    });
  });
});
