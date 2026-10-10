// tests for the single canonical "fire the rolling pre-cache window"
// trigger - exercises the song/video index math and the "current item is
// a video" null-currentSongId handoff, since every call site (queue.ts,
// player.ts, preCacheScheduler.ts) relies on this getting those right.

import { beforeEach, describe, expect, it, vi } from "vitest";

const preCacheNextSongs = vi.fn(async () => {});
const preCacheNextP2PSongs = vi.fn(async () => {});
const preCacheNextVideos = vi.fn(async () => {});

vi.mock("../cache/blobCache", () => ({
  preCacheNextSongs: (...args: unknown[]) => preCacheNextSongs(...(args as [])),
}));
vi.mock("../storage/blobResolver", () => ({
  preCacheNextP2PSongs: (...args: unknown[]) => preCacheNextP2PSongs(...(args as [])),
}));
vi.mock("../../../video/services/videoPreCache", () => ({
  preCacheNextVideos: (...args: unknown[]) => preCacheNextVideos(...(args as [])),
}));

import type { MediaItem } from "../../../app/services/storage/mediaItem";
import { triggerPreCache, PRE_CACHE_MINUTES_AHEAD } from "./triggerPreCache";

function songItem(sha256: string): { mediaItem: MediaItem; inner: { sha256: string; id: string } } {
  const inner = { sha256, id: sha256 };
  return { mediaItem: { kind: "song", song: inner } as unknown as MediaItem, inner };
}

function videoItem(id: string): { mediaItem: MediaItem; inner: { id: string } } {
  const inner = { id };
  return { mediaItem: { kind: "video", video: inner } as unknown as MediaItem, inner };
}

beforeEach(() => {
  preCacheNextSongs.mockClear();
  preCacheNextP2PSongs.mockClear();
  preCacheNextVideos.mockClear();
});

describe("triggerPreCache", () => {
  it("no-ops when currentKey is falsy", () => {
    const a = songItem("a");
    const b = songItem("b");
    triggerPreCache([a.mediaItem, b.mediaItem], null);
    triggerPreCache([a.mediaItem, b.mediaItem], undefined);
    expect(preCacheNextSongs).not.toHaveBeenCalled();
    expect(preCacheNextP2PSongs).not.toHaveBeenCalled();
    expect(preCacheNextVideos).not.toHaveBeenCalled();
  });

  it("song-only queue: passes currentKey through and the start index after it", () => {
    const a = songItem("a");
    const b = songItem("b");
    const c = songItem("c");
    triggerPreCache([a.mediaItem, b.mediaItem, c.mediaItem], "b");

    expect(preCacheNextSongs).toHaveBeenCalledWith(
      "b",
      [a.inner, b.inner, c.inner],
      PRE_CACHE_MINUTES_AHEAD,
      2 // songs up to and including "b"
    );
    expect(preCacheNextP2PSongs).toHaveBeenCalledWith(
      "b",
      [a.inner, b.inner, c.inner],
      PRE_CACHE_MINUTES_AHEAD,
      2
    );
    expect(preCacheNextVideos).toHaveBeenCalledWith([], PRE_CACHE_MINUTES_AHEAD, 0);
  });

  it("mixed queue, current item is a song: song index/videoStart both account for interleaved videos", () => {
    const a = songItem("a");
    const v1 = videoItem("v1");
    const b = songItem("b");
    const v2 = videoItem("v2");
    triggerPreCache([a.mediaItem, v1.mediaItem, b.mediaItem, v2.mediaItem], "b");

    // songs after/including "b" -> songStart = 2 ("a","b" both counted)
    expect(preCacheNextSongs).toHaveBeenCalledWith(
      "b",
      [a.inner, b.inner],
      PRE_CACHE_MINUTES_AHEAD,
      2
    );
    // only "v1" precedes "b" -> videoStart = 1
    expect(preCacheNextVideos).toHaveBeenCalledWith(
      [v1.inner, v2.inner],
      PRE_CACHE_MINUTES_AHEAD,
      1
    );
  });

  it("mixed queue, current item is a video: currentSongId is null so callers rely on songStart instead", () => {
    const a = songItem("a");
    const v1 = videoItem("v1");
    const b = songItem("b");
    const v2 = videoItem("v2");
    triggerPreCache([a.mediaItem, v1.mediaItem, b.mediaItem, v2.mediaItem], "v1");

    // currentKey ("v1") doesn't match any song - currentSongKey must be
    // null so preCacheNextSongs/preCacheNextP2PSongs don't go looking for
    // it in the song-only subset (it's genuinely absent there).
    expect(preCacheNextSongs).toHaveBeenCalledWith(
      null,
      [a.inner, b.inner],
      PRE_CACHE_MINUTES_AHEAD,
      1 // only "a" precedes "v1"
    );
    expect(preCacheNextVideos).toHaveBeenCalledWith(
      [v1.inner, v2.inner],
      PRE_CACHE_MINUTES_AHEAD,
      1 // "v1" itself counted (videos up to and including it)
    );
  });
});
