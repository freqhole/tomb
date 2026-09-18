// @vitest-environment jsdom
//
// wider integration tests for charnelPlaybackAdapter.ts's replaceQueue/
// appendQueue - exercises the REAL resolve pipeline (mediaRefResolve.ts,
// unmocked) plus the real dedup/pending-preview orchestration in
// resolveAndDeliverQueueItems, mocking only: (a) the actual network/db
// boundary mediaRefResolve.ts itself talks to (same mocks
// mediaRefResolve.test.ts already uses), and (b) queue.ts's
// addToQueue/playQueue/clearQueue, which is the assertion boundary - did
// the resolved item actually get handed to the real queue, with the
// right shape, in the right order. this is the seam
// mediaRefResolve.test.ts alone doesn't cover: a resolve can succeed in
// isolation while still never reaching the queue (dedup swallowing it, or
// the queue-add step itself throwing) - both of which previously failed
// completely silently (see this file's own error-handling fix).

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaRef } from "../index";
import type { AppState } from "../../app/services/storage/types";
import type { MediaItem } from "../../app/services/storage/mediaItem";

// charnelPlaybackAdapter.ts runs a module-scope `createRoot(() =>
// createEffect(...))` (the recentlyPlayed tracker) that calls `appState()`
// synchronously the instant the module is imported - before any of this
// test file's own top-level `let`/`const` statements have run (vitest
// hoists every `vi.mock` factory - and the imports that trigger them -
// above the rest of the file). a plain `let state = null` declared below
// a `vi.mock` call is still in the temporal dead zone at that point, so
// the mock factory must close over something created via `vi.hoisted`
// instead, which vitest guarantees runs before anything else.
const stateHolder = vi.hoisted(() => ({ current: null as Partial<AppState> | null }));
const setQueueMock = vi.fn(async (items: MediaItem[]) => {
  stateHolder.current = { ...stateHolder.current, queue: items } as AppState;
});
vi.mock("../../app/services/storage/db", () => ({
  appState: () => stateHolder.current,
  setQueue: (...a: unknown[]) => setQueueMock(...(a as [MediaItem[]])),
  setAutoDownloadEnabled: vi.fn(),
  getAutoDownloadEnabled: vi.fn(() => false),
}));

const addToQueue = vi.fn(async (...args: unknown[]) => {
  void args;
});
const clearQueue = vi.fn(async (...args: unknown[]) => {
  void args;
});
const playQueue = vi.fn(async (...args: unknown[]) => {
  void args;
});
vi.mock("../../music/services/queue/queue", () => ({
  addToQueue: (...a: unknown[]) => addToQueue(...a),
  clearQueue: (...a: unknown[]) => clearQueue(...a),
  playQueue: (...a: unknown[]) => playQueue(...a),
  removeFromQueue: vi.fn(),
  reorderQueue: vi.fn(),
}));

vi.mock("../../music/services/audio/player", () => ({
  pause: vi.fn(),
  play: vi.fn(),
  playNext: vi.fn(async () => {}),
  seek: vi.fn(),
  setPlayerVolume: vi.fn(),
}));
vi.mock("../../music/services/audio/playerState", () => ({
  currentTime: () => 0,
  isPlaying: () => false,
  volume: () => 1,
}));
vi.mock("../../app/services/radio/radioService", () => ({
  leaveRadio: vi.fn(),
  tuneIntoRadio: vi.fn(async () => {}),
}));

// mediaRefResolve.ts's own network/db boundary - same mocks
// mediaRefResolve.test.ts uses, since this suite exercises the REAL
// resolve functions on top of them (not a mocked resolve step).
const isCharnelAvailable = vi.fn(() => false);
const getClientForRemote = vi.fn();
const createRemote = vi.fn();
const getRemoteByPeerAddr = vi.fn();
const getTauriManagedRemote = vi.fn();
const getSongByBlake3 = vi.fn();
const getVideoByBlake3 = vi.fn();
const syncSongToLocal = vi.fn();
const syncVideoToLocal = vi.fn();
const adaptSongFromAPI = vi.fn();

vi.mock("../../app/api/client", () => ({
  isCharnelAvailable: () => isCharnelAvailable(),
  getClientForRemote: (...a: unknown[]) => getClientForRemote(...(a as [])),
  // resolveMediaRefToSong/Video's self-node-id short-circuit - none of
  // these tests are exercising "am I my own source peer", so always
  // resolve to null (not self) here.
  getLocalNodeIdAsync: () => Promise.resolve(null),
}));
vi.mock("../../app/services/remotes/remoteManager", () => ({
  createRemote: (...a: unknown[]) => createRemote(...(a as [])),
  getRemoteByPeerAddr: (...a: unknown[]) => getRemoteByPeerAddr(...(a as [])),
  getTauriManagedRemote: (...a: unknown[]) => getTauriManagedRemote(...(a as [])),
}));
vi.mock("../../music/services/storage/db/songs", () => ({
  getSongByBlake3: (...a: unknown[]) => getSongByBlake3(...(a as [])),
}));
vi.mock("../../video/services/storage/db/videos", () => ({
  getVideoByBlake3: (...a: unknown[]) => getVideoByBlake3(...(a as [])),
}));
vi.mock("../../music/services/sync/syncSongToLocal", () => ({
  syncSongToLocal: (...a: unknown[]) => syncSongToLocal(...(a as [])),
}));
vi.mock("../../video/services/sync/syncVideoToLocal", () => ({
  syncVideoToLocal: (...a: unknown[]) => syncVideoToLocal(...(a as [])),
}));
vi.mock("../../music/data/remote/adapters", () => ({
  adaptSongFromAPI: (...a: unknown[]) => adaptSongFromAPI(...(a as [])),
}));
vi.mock("../../queryClient", () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));
vi.mock("../../music/queries/queryKeys", () => ({
  queryKeys: { songs: { all: () => ["songs"] }, albums: { all: () => ["albums"] } },
}));
vi.mock("../../video/queries/queryKeys", () => ({
  videoQueryKeys: { videos: { all: () => ["videos"] } },
}));

import { charnelPlaybackAdapter, pendingQueuePreviews } from "./charnelPlaybackAdapter";

const remote = { remote_id: "remote-1", base_url: "", peer_addr: "peer-a" };

function videoRef(over: Partial<MediaRef> = {}): MediaRef {
  return {
    source_peer_addr: "peer-a",
    blake3_hash: "b3-video-1",
    kind: "video",
    title: "a video",
    duration_ms: 60_000,
    ...over,
  };
}

function songRef(over: Partial<MediaRef> = {}): MediaRef {
  return {
    source_peer_addr: "peer-a",
    blake3_hash: "b3-song-1",
    kind: "audio",
    title: "a song",
    artist: "an artist",
    duration_ms: 180_000,
    mime_type: "audio/mpeg",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stateHolder.current = { queue: [], current_sha256: null } as unknown as AppState;
  isCharnelAvailable.mockReturnValue(false);
  getRemoteByPeerAddr.mockResolvedValue(null);
  createRemote.mockResolvedValue(remote);
  getSongByBlake3.mockResolvedValue(null);
  getVideoByBlake3.mockResolvedValue(null);
  syncSongToLocal.mockResolvedValue({ success: true, localSongId: "row-1" });
  syncVideoToLocal.mockResolvedValue({ success: true, videoId: "row-1" });

  // browser-mode resolve checks the local library twice: once as a
  // short-circuit BEFORE syncing (miss expected here), once again as the
  // read-back AFTER a successful sync (must now hit, or the resolved item
  // never reaches the queue - mirrors mediaRefResolve.test.ts's own
  // mockResolvedValueOnce(null).mockResolvedValueOnce(...) pattern, but
  // keyed per-hash here since a single test can resolve more than one
  // distinct item).
  const videoCallsByHash = new Map<string, number>();
  getVideoByBlake3.mockImplementation(async (blake3: string) => {
    const count = (videoCallsByHash.get(blake3) ?? 0) + 1;
    videoCallsByHash.set(blake3, count);
    return count === 1 ? null : { id: `local-${blake3}`, blake3, title: "a video" };
  });
  const songCallsByHash = new Map<string, number>();
  getSongByBlake3.mockImplementation(async (blake3: string) => {
    const count = (songCallsByHash.get(blake3) ?? 0) + 1;
    songCallsByHash.set(blake3, count);
    return count === 1 ? null : { sha256: `local-${blake3}`, blake3, title: "a song" };
  });
});

describe("charnelPlaybackAdapter.appendQueue", () => {
  it("resolves a video MediaRef through the real resolve pipeline and adds it to the local queue", async () => {
    // the real regression this covers: a resolve can succeed in complete
    // isolation (see mediaRefResolve.test.ts) while the item still never
    // reaches the actual queue - this exercises both halves together.
    await charnelPlaybackAdapter.appendQueue(undefined, [videoRef()]);

    expect(syncVideoToLocal).toHaveBeenCalledTimes(1);
    expect(addToQueue).toHaveBeenCalledTimes(1);
    const [queued] = addToQueue.mock.calls[0] as unknown as [MediaItem[]];
    expect(queued[0].kind).toBe("video");
  });

  it("resolves a song MediaRef the same way", async () => {
    await charnelPlaybackAdapter.appendQueue(undefined, [songRef()]);

    expect(syncSongToLocal).toHaveBeenCalledTimes(1);
    expect(addToQueue).toHaveBeenCalledTimes(1);
    const [queued] = addToQueue.mock.calls[0] as unknown as [MediaItem[]];
    expect(queued[0].kind).toBe("song");
  });

  it("skips an item already in the local queue instead of re-adding it", async () => {
    stateHolder.current = {
      queue: [{ kind: "video", video: { id: "existing", blake3: "b3-video-1", title: "x" } }],
      current_sha256: null,
    } as unknown as AppState;

    await charnelPlaybackAdapter.appendQueue(undefined, [videoRef()]);

    expect(syncVideoToLocal).not.toHaveBeenCalled();
    expect(addToQueue).not.toHaveBeenCalled();
  });

  it("does not let one item's queue-add failure drop the rest of the batch", async () => {
    // the real bug this covers: a thrown addToQueue for one item
    // previously propagated uncaught out of resolveAndDeliverQueueItems,
    // aborting every item still queued behind it with no error surfaced
    // anywhere the user could see. now it must be caught, logged, and
    // the batch must continue.
    addToQueue.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(undefined);

    await charnelPlaybackAdapter.appendQueue(undefined, [
      videoRef({ blake3_hash: "b3-video-1" }),
      videoRef({ blake3_hash: "b3-video-2" }),
    ]);

    expect(addToQueue).toHaveBeenCalledTimes(2);
  });

  it("resolves multiple distinct items in order", async () => {
    await charnelPlaybackAdapter.appendQueue(undefined, [
      videoRef({ blake3_hash: "b3-video-1" }),
      songRef({ blake3_hash: "b3-song-1" }),
    ]);

    expect(addToQueue).toHaveBeenCalledTimes(2);
    expect((addToQueue.mock.calls[0][0] as unknown as MediaItem[])[0].kind).toBe("video");
    expect((addToQueue.mock.calls[1][0] as unknown as MediaItem[])[0].kind).toBe("song");
  });
});

describe("charnelPlaybackAdapter.replaceQueue", () => {
  it("clears the queue, plays the first resolved item, and appends the rest", async () => {
    await charnelPlaybackAdapter.replaceQueue(undefined, [
      videoRef({ blake3_hash: "b3-video-1" }),
      songRef({ blake3_hash: "b3-song-1" }),
    ]);

    expect(clearQueue).toHaveBeenCalledTimes(1);
    expect(playQueue).toHaveBeenCalledTimes(1);
    expect(addToQueue).toHaveBeenCalledTimes(1);
    const [firstItems] = playQueue.mock.calls[0] as unknown as [MediaItem[]];
    expect(firstItems[0].kind).toBe("video");
    const [restItems] = addToQueue.mock.calls[0] as unknown as [MediaItem[]];
    expect(restItems[0].kind).toBe("song");
  });

  it("renders a pending preview row for every item BEFORE clearQueue() resolves - optimistic UI must come first", async () => {
    let resolveClear!: () => void;
    clearQueue.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveClear = resolve;
        })
    );

    const replacePromise = charnelPlaybackAdapter.replaceQueue(undefined, [
      videoRef({ blake3_hash: "b3-video-1" }),
      songRef({ blake3_hash: "b3-song-1" }),
    ]);

    // let microtasks flush up to (but not past) the still-pending clearQueue().
    await Promise.resolve();
    await Promise.resolve();

    expect(clearQueue).toHaveBeenCalledTimes(1);
    const keys = pendingQueuePreviews().map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(["b3-video-1", "b3-song-1"]));

    resolveClear();
    await replacePromise;
  });
});

describe("charnel mode (tauri build)", () => {
  beforeEach(() => {
    isCharnelAvailable.mockReturnValue(true);
    getTauriManagedRemote.mockResolvedValue({ remote_id: "local-remote", base_url: "" });
  });

  it("appendQueue resolves a video via the real grimoire read-back path and queues it with its blake3 intact", async () => {
    // grimoire's own Video read-back has no blake3 field at all (round 12
    // fix re-attaches it from the wire MediaRef) - this proves the fix
    // actually reaches the item that lands in the real queue, not just
    // mediaRefResolve.ts's own return value in isolation.
    const client = {
      video: {
        getVideo: vi.fn(async () => ({ success: true, data: { id: "row-1", title: "a video" } })),
      },
    };
    getClientForRemote.mockResolvedValue(client);

    await charnelPlaybackAdapter.appendQueue(undefined, [videoRef()]);

    expect(addToQueue).toHaveBeenCalledTimes(1);
    const [queued] = addToQueue.mock.calls[0] as unknown as [MediaItem[]];
    expect(queued[0].kind).toBe("video");
    expect(queued[0].kind === "video" && queued[0].video.blake3).toBe("b3-video-1");
  });

  it("appendQueue resolves a song via the real grimoire query read-back path", async () => {
    const client = {
      music: {
        querySongs: vi.fn(async () => ({
          success: true,
          data: { items: [{ id: "row-1", sha256: "row-1", blake3: "b3-song-1" }] },
        })),
      },
    };
    getClientForRemote.mockResolvedValue(client);
    adaptSongFromAPI.mockImplementation((apiItem: Record<string, unknown>) => ({
      ...apiItem,
      title: "a song",
    }));

    await charnelPlaybackAdapter.appendQueue(undefined, [songRef()]);

    expect(addToQueue).toHaveBeenCalledTimes(1);
    const [queued] = addToQueue.mock.calls[0] as unknown as [MediaItem[]];
    expect(queued[0].kind).toBe("song");
  });

  it("does not queue anything if the charnel sync-to-local fails, and logs why", async () => {
    syncVideoToLocal.mockResolvedValue({ success: false, error: "no local grimoire path" });

    await charnelPlaybackAdapter.appendQueue(undefined, [videoRef()]);

    expect(addToQueue).not.toHaveBeenCalled();
  });
});
