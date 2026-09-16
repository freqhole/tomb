// @vitest-environment jsdom
//
// integration-style tests for the controller-side "drain local queue once
// the remote ACKs it" behavior (docs/cenotaph-player-queue-unification-plan.md
// task 3b) - exercises the real reactive chain (`applyRemoteStatusFromAck`
// -> `remoteStatus`/`remoteCurrentItem` -> `pruneLocalQueueAfterSuccessfulPush`)
// rather than mocking `remoteCurrentItem` directly, so a real bug in that
// wiring would actually surface here. only the local-queue read/write
// boundary (`appState`/`setQueue`) is mocked - real `MediaItem` helpers
// (`mediaItemKey`/`mediaItemBlake3`) are used unmocked.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "../storage/mediaItem";
import type { AppState } from "../storage/types";

let state: Partial<AppState> | null = null;
const setQueueMock = vi.fn(async (items: MediaItem[]) => {
  state = { ...state, queue: items } as AppState;
});

vi.mock("../storage/db", () => ({
  appState: () => state,
  setQueue: (...a: unknown[]) => setQueueMock(...(a as [MediaItem[]])),
}));
// avoids pulling in getMiddenNode()'s real wasm/midden import chain (not
// exercised by anything under test here - remoteStatus is driven directly
// via applyRemoteStatusFromAck below, not through a real dial).
vi.mock("./playerPairingClient", () => ({
  sendPlayerCommand: vi.fn(),
  subscribeToPlayerStatus: vi.fn(() => () => {}),
}));

import {
  applyRemoteStatusFromAck,
  pruneLocalQueueAfterSuccessfulPush,
  resetRemoteStatus,
  type RemoteStatus,
} from "./remotePlaybackControl";

function song(sha256: string, blake3: string): MediaItem {
  return { kind: "song", song: { sha256, blake3, title: sha256 } } as unknown as MediaItem;
}

function video(id: string, blake3: string | null = null): MediaItem {
  return { kind: "video", video: { id, blake3, title: id } } as unknown as MediaItem;
}

/** builds a `PushedQueueItem` - `key` is the local `mediaItemKey()`
 * (sha256/id), `blake3Hash` is whatever hash actually ended up on the
 * wire for it (may have nothing to do with the local item's own `blake3`
 * field - see `pruneLocalQueueAfterSuccessfulPush`'s own doc comment). */
function pushed(key: string, blake3Hash: string): { key: string; blake3Hash: string } {
  return { key, blake3Hash };
}

function statusFor(blake3Hash: string, positionMs = 0): RemoteStatus {
  return {
    type: "status",
    state: "now_playing",
    item: { source_peer_addr: "peer-a", blake3_hash: blake3Hash },
    position_ms: positionMs,
    server_time_ms: Date.now(),
    queue: [],
    auto_download_enabled: false,
    volume: 1,
    recently_played: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRemoteStatus();
  state = {
    queue: [song("s1", "b1"), song("s2", "b2"), video("v1", "b3")],
    current_sha256: "s1",
  } as AppState;
});

describe("pruneLocalQueueAfterSuccessfulPush (isReplace: true - a real handoff)", () => {
  it("drains non-current pushed items immediately, keeping items that weren't pushed", async () => {
    pruneLocalQueueAfterSuccessfulPush([pushed("s2", "b2")], true);
    expect(setQueueMock).toHaveBeenCalledTimes(1);
    const kept = setQueueMock.mock.calls[0][0] as MediaItem[];
    expect(kept.map((i) => (i.kind === "song" ? i.song.sha256 : i.video.id))).toEqual(["s1", "v1"]);
  });

  it("drains video items too (not just songs - a real pre-existing gap this fixed)", async () => {
    pruneLocalQueueAfterSuccessfulPush([pushed("v1", "b3")], true);
    const kept = setQueueMock.mock.calls[0][0] as MediaItem[];
    expect(kept.some((i) => i.kind === "video")).toBe(false);
  });

  it("drains a video even when its LOCAL blake3 is null/absent, matching by key instead of content hash", async () => {
    // the real bug: a locally-imported/never-synced video commonly has no
    // `blake3` field at all - the actual wire hash sent at push time (e.g.
    // freshly computed from imported bytes) has nothing to do with that
    // local field, so matching by content hash silently never matched
    // anything and the video sat in the local queue forever ("i can't
    // queue videos"). matching by `mediaItemKey()` (always non-null) fixes
    // this regardless of whether/what the wire hash was.
    state = {
      queue: [song("s1", "b1"), video("v-no-hash", null)],
      current_sha256: "s1",
    } as AppState;
    pruneLocalQueueAfterSuccessfulPush([pushed("v-no-hash", "freshly-computed-hash")], true);
    const kept = setQueueMock.mock.calls[0][0] as MediaItem[];
    expect(kept.map((i) => (i.kind === "song" ? i.song.sha256 : i.video.id))).toEqual(["s1"]);
  });

  it("holds back the currently-playing item until the remote confirms it's playing the same one", async () => {
    // remote hasn't reported anything yet - current item must be kept.
    pruneLocalQueueAfterSuccessfulPush([pushed("s1", "b1"), pushed("s2", "b2")], true);
    let kept = setQueueMock.mock.calls[0][0] as MediaItem[];
    expect(kept.map((i) => (i.kind === "song" ? i.song.sha256 : i.video.id))).toEqual(["s1", "v1"]);

    // remote now confirms it's on b1 too - safe to drain it now.
    applyRemoteStatusFromAck(statusFor("b1"));
    setQueueMock.mockClear();
    pruneLocalQueueAfterSuccessfulPush([pushed("s1", "b1")], true);
    kept = setQueueMock.mock.calls[0][0] as MediaItem[];
    expect(kept.map((i) => (i.kind === "song" ? i.song.sha256 : i.video.id))).toEqual(["v1"]);
  });

  it("does not drain the current item if the remote reports a DIFFERENT current item", async () => {
    applyRemoteStatusFromAck(statusFor("some-other-hash"));
    // only the (held-back) current item was pushed - nothing actually
    // changes, so this is correctly a no-op (no setQueue call at all).
    pruneLocalQueueAfterSuccessfulPush([pushed("s1", "b1")], true);
    expect(setQueueMock).not.toHaveBeenCalled();
  });

  it("is a no-op when nothing in the queue matches the pushed keys", async () => {
    pruneLocalQueueAfterSuccessfulPush([pushed("not-in-queue", "not-in-queue")], true);
    expect(setQueueMock).not.toHaveBeenCalled();
  });

  it("is a no-op with an empty push list", async () => {
    pruneLocalQueueAfterSuccessfulPush([], true);
    expect(setQueueMock).not.toHaveBeenCalled();
  });
});

describe("pruneLocalQueueAfterSuccessfulPush (isReplace: false - append, no handoff)", () => {
  // the real bug reported live: adding a song locally, then selecting an
  // ALREADY-PLAYING remote target appends it there correctly, but it never
  // left the local queue - because the old code applied the same
  // "hold back current item until the remote confirms" gate to appends
  // too, and an appended item never becomes the remote's current item (it
  // was only added to the tail), so the confirmation could never arrive.
  it("drains the current item immediately on a successful append ack, with NO remote confirmation needed", async () => {
    // no applyRemoteStatusFromAck call at all - remote is playing
    // something completely different, exactly like a real append.
    pruneLocalQueueAfterSuccessfulPush([pushed("s1", "b1")], false);
    expect(setQueueMock).toHaveBeenCalledTimes(1);
    const kept = setQueueMock.mock.calls[0][0] as MediaItem[];
    expect(kept.map((i) => (i.kind === "song" ? i.song.sha256 : i.video.id))).toEqual(["s2", "v1"]);
  });

  it("still drains even when the remote reports a totally different current item", async () => {
    applyRemoteStatusFromAck(statusFor("some-other-hash"));
    pruneLocalQueueAfterSuccessfulPush([pushed("s1", "b1")], false);
    const kept = setQueueMock.mock.calls[0][0] as MediaItem[];
    expect(kept.map((i) => (i.kind === "song" ? i.song.sha256 : i.video.id))).toEqual(["s2", "v1"]);
  });

  it("drains an appended video with no local blake3, matching by key", async () => {
    state = {
      queue: [song("s1", "b1"), video("v-no-hash", null)],
      current_sha256: "s1",
    } as AppState;
    pruneLocalQueueAfterSuccessfulPush([pushed("v-no-hash", "freshly-computed-hash")], false);
    const kept = setQueueMock.mock.calls[0][0] as MediaItem[];
    expect(kept.map((i) => (i.kind === "song" ? i.song.sha256 : i.video.id))).toEqual(["s1"]);
  });
});
