// @vitest-environment jsdom
//
// integration-style test for playerQueuePush.ts's drain-on-ack wiring -
// explicitly flagged as an untested gap in
// docs/cenotaph-player-queue-unification-plan.md's task 3b/testing section.
// exercises the REAL exported push function end-to-end (artwork resolution,
// blob import, command send, drain) - only the actual network/transport
// boundary is mocked (fetch, sendPlayerCommand, the wasm midden node),
// so a real regression in the ack-gating (`if (!ack?.ok) return`) or in
// how pushed hashes get extracted would show up here.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Song } from "../../../music/services/storage/types";
import type { AppState } from "../storage/types";
import type { MediaItem, QueuedVideo } from "../storage/mediaItem";

let state: Partial<AppState> | null = null;
const setQueueMock = vi.fn(async (items: MediaItem[]) => {
  state = { ...state, queue: items } as AppState;
});
vi.mock("../storage/db", () => ({
  appState: () => state,
  setQueue: (...a: unknown[]) => setQueueMock(...(a as [MediaItem[]])),
}));

const sendPlayerCommand = vi.fn();
vi.mock("./playerPairingClient", () => ({
  sendPlayerCommand: (...a: unknown[]) => sendPlayerCommand(...(a as [])),
  subscribeToPlayerStatus: vi.fn(() => () => {}),
}));

const isCharnelMode = vi.fn(() => false);
vi.mock("../charnel/mode", () => ({ isCharnelMode: () => isCharnelMode() }));
const isCharnelAvailable = vi.fn(() => false);
const getClientForRemote = vi.fn();
const getMiddenNode = vi.fn();
const getLocalNodeIdAsync = vi.fn();
vi.mock("../../api/client", () => ({
  isCharnelAvailable: () => isCharnelAvailable(),
  getClientForRemote: (...a: unknown[]) => getClientForRemote(...(a as [])),
  getMiddenNode: () => getMiddenNode(),
  getLocalNodeIdAsync: () => getLocalNodeIdAsync(),
}));
const adminDispatchOrThrow = vi.fn();
const adminClientFor = vi.fn(async () => ({ dispatchOrThrow: adminDispatchOrThrow }));
vi.mock("../../api/adminClient", () => ({
  adminClientFor: (...a: unknown[]) => adminClientFor(...(a as [])),
}));
const getRemoteById = vi.fn(async () => null as unknown);
vi.mock("../remotes/remoteManager", () => ({
  getRemoteById: (...a: unknown[]) => getRemoteById(...(a as [])),
  getRemoteByPeerAddr: vi.fn(async () => null),
  onRemoteStatusChange: vi.fn(),
}));
// resolveArtwork()'s remote_blob_id branch isn't exercised (test songs have
// no images) - mocked out anyway since blobResolver.ts's real module
// transitively pulls in syncSongToLocal.ts -> remoteHealth.ts, which calls
// remoteManager's onRemoteStatusChange() at import time regardless.
vi.mock("../../../music/services/storage/blobResolver", () => ({
  isValidHttpUrl: vi.fn(() => false),
  resolveBlobUrl: vi.fn(async () => ""),
}));
vi.mock("../../../music/services/storage/audioAccess", () => ({
  getAudioURL: vi.fn(async () => "https://example.test/audio.mp3"),
}));
vi.mock("../../../video/services/videoBlobAccess", () => ({
  getVideoURL: vi.fn(async () => "https://example.test/video.mp4"),
}));
// local-file-path fast path (importLocalFileByPath) is exercised by its own
// test - here isCharnelMode() is false anyway, so these just need to not
// pull in their real modules' transitive imports at load time.
vi.mock("../media/resolveCharnelLocalBlobPath", () => ({
  resolveCharnelLocalBlobPath: vi.fn(async () => null),
}));
vi.mock("../../../video/services/localVideo", () => ({
  resolveLocalVideoPath: vi.fn(async () => null),
}));

const pullBlobToLocalStore = vi.fn();
vi.mock("../charnel/commands", () => ({
  fetchLocalNodeId: vi.fn(async () => "this-device"),
  importBlobByPath: vi.fn(async () => "b3-1"),
  beginChunkedBlobImport: vi.fn(async () => "upload-1"),
  appendChunkedBlobImport: vi.fn(async () => 0),
  finishChunkedBlobImport: vi.fn(async () => "b3-1"),
  abortChunkedBlobImport: vi.fn(async () => {}),
  pullBlobToLocalStore: (...a: unknown[]) => pullBlobToLocalStore(...a),
}));

const registerBlobTransfer = vi.fn();
const updateBlobTransferProgress = vi.fn();
const completeBlobTransfer = vi.fn();
vi.mock("../transfers/blobTransferRegistry", () => ({
  registerBlobTransfer: (...a: unknown[]) => registerBlobTransfer(...a),
  updateBlobTransferProgress: (...a: unknown[]) => updateBlobTransferProgress(...a),
  completeBlobTransfer: (...a: unknown[]) => completeBlobTransfer(...a),
}));

import {
  pushSongsToPlayer,
  appendSongsToPlayer,
  pushVideosToPlayer,
  appendVideosToPlayer,
  queueItemTransferStatus,
  handleUnresolvedItems,
} from "./playerQueuePush";
import { resetRemoteStatus } from "./remotePlaybackControl";

function song(over: Partial<Song> = {}): Song {
  return {
    sha256: "hash-1",
    blake3: "b3-1",
    title: "a song",
    artist_name: "an artist",
    duration_seconds: 200,
    mime_type: "audio/mpeg",
    images: [],
    // no remote_server_id - skips the cross-remote-bridging branch
    // entirely, so this test only needs to mock the fetch+import path.
    ...over,
  } as unknown as Song;
}

function video(over: Partial<QueuedVideo> = {}): QueuedVideo {
  return {
    id: "vid-1",
    title: "a video",
    duration_seconds: 300,
    content_type: "movie",
    source_type: "local",
    // deliberately no `blake3` - a locally-imported/never-synced video
    // commonly has none set at all (see QueuedVideo.blake3's own doc
    // comment) - this is the exact shape that exposed the drain bug.
    ...over,
  } as unknown as QueuedVideo;
}

beforeEach(() => {
  vi.clearAllMocks();
  // remoteStatus is module-level state in remotePlaybackControl.ts - reset
  // it so a previous test's confirmed status doesn't leak into this one.
  resetRemoteStatus();
  isCharnelMode.mockReturnValue(false);
  isCharnelAvailable.mockReturnValue(false);
  state = { queue: [{ kind: "song", song: song() }], current_sha256: "hash-1" } as AppState;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        ({
          headers: { get: () => null },
          arrayBuffer: async () => new ArrayBuffer(4),
          blob: async () => ({
            arrayBuffer: async () => new ArrayBuffer(4),
            type: "video/mp4",
          }),
        }) as unknown as Response
    )
  );
  getMiddenNode.mockResolvedValue({
    node_id: () => "this-device",
    import_blob: async () => "b3-1",
  });
  getLocalNodeIdAsync.mockResolvedValue("this-device");
});

describe("pushSongsToPlayer drain-on-ack", () => {
  // per pruneLocalQueueAfterSuccessfulPush's confirmation-gated design, the
  // CURRENTLY-PLAYING pushed item is only drained once the ack's own
  // `status` confirms the remote is now on it too - a real command_ack
  // always carries this (see dispatcher.ts's `{ ok: true, status }`).
  function ackConfirming(blake3Hash: string) {
    return {
      type: "command_ack",
      ok: true,
      status: {
        type: "status",
        state: "now_playing",
        item: { source_peer_addr: "player-peer", blake3_hash: blake3Hash },
        position_ms: 0,
        server_time_ms: Date.now(),
        queue: [],
        auto_download_enabled: false,
        volume: 1,
        recently_played: [],
      },
    };
  }

  it("drains the pushed song from the local queue once the player ACKs and confirms it", async () => {
    sendPlayerCommand.mockResolvedValue(ackConfirming("b3-1"));

    await pushSongsToPlayer("player-peer", [song()]);

    expect(setQueueMock).toHaveBeenCalledTimes(1);
    expect(setQueueMock.mock.calls[0][0]).toEqual([]);
  });

  it("holds the item back if the ack's own status hasn't confirmed the handoff yet", async () => {
    // ok:true but no status at all - matches a bare/legacy ack shape.
    sendPlayerCommand.mockResolvedValue({ type: "command_ack", ok: true });

    await pushSongsToPlayer("player-peer", [song()]);

    // nothing to drain: the only pushed item IS the current item, and it's
    // held back pending confirmation - correctly a no-op, not a bug.
    expect(setQueueMock).not.toHaveBeenCalled();
  });

  it("does NOT drain anything when the player rejects the command", async () => {
    sendPlayerCommand.mockResolvedValue({
      type: "command_ack",
      ok: false,
      reason: "not_in_session",
    });

    await pushSongsToPlayer("player-peer", [song()]);

    expect(setQueueMock).not.toHaveBeenCalled();
  });

  it("does NOT drain anything when sendPlayerCommand throws (transport failure)", async () => {
    sendPlayerCommand.mockRejectedValue(new Error("dial failed"));

    await expect(pushSongsToPlayer("player-peer", [song()])).rejects.toThrow("dial failed");
    expect(setQueueMock).not.toHaveBeenCalled();
  });

  it("only drains the songs that were actually part of THIS push, not unrelated queue items", async () => {
    state = {
      queue: [
        { kind: "song", song: song() },
        { kind: "song", song: song({ sha256: "hash-2", blake3: "b3-2", title: "unrelated" }) },
      ],
      current_sha256: "hash-1",
    } as AppState;
    sendPlayerCommand.mockResolvedValue(ackConfirming("b3-1"));

    await pushSongsToPlayer("player-peer", [song()]);

    const kept = setQueueMock.mock.calls[0][0] as MediaItem[];
    expect(kept.map((i) => (i.kind === "song" ? i.song.sha256 : i.video.id))).toEqual(["hash-2"]);
  });
});

describe("appendSongsToPlayer drain-on-ack", () => {
  // the exact bug reported live: add a song locally (it becomes the local
  // current item), select an ALREADY-PLAYING remote target - the song gets
  // appended to the remote's queue correctly, but it never left the local
  // queue. Root cause: append never causes a handoff (the remote keeps
  // playing whatever it already was), so a confirmation-gated drain (the
  // `pushSongsToPlayer` behavior, correct for a real replace/handoff) can
  // never fire for an appended item - the remote will never report the
  // freshly-appended song as its current item. append must drain on a
  // plain successful ack, no confirmation required.
  it("drains the current local item immediately on a successful append ack, even with NO confirming status", async () => {
    sendPlayerCommand.mockResolvedValue({ type: "command_ack", ok: true });

    await appendSongsToPlayer("player-peer", [song()]);

    expect(setQueueMock).toHaveBeenCalledTimes(1);
    expect(setQueueMock.mock.calls[0][0]).toEqual([]);
  });

  it("still drains even when the remote's status shows a completely different current item", async () => {
    sendPlayerCommand.mockResolvedValue({
      type: "command_ack",
      ok: true,
      status: {
        type: "status",
        state: "now_playing",
        item: { source_peer_addr: "player-peer", blake3_hash: "already-playing-hash" },
        position_ms: 0,
        server_time_ms: Date.now(),
        queue: [],
        auto_download_enabled: false,
        volume: 1,
        recently_played: [],
      },
    });

    await appendSongsToPlayer("player-peer", [song()]);

    expect(setQueueMock).toHaveBeenCalledTimes(1);
    expect(setQueueMock.mock.calls[0][0]).toEqual([]);
  });

  it("does NOT drain anything when the player rejects the append", async () => {
    sendPlayerCommand.mockResolvedValue({
      type: "command_ack",
      ok: false,
      reason: "not_in_session",
    });

    await appendSongsToPlayer("player-peer", [song()]);

    expect(setQueueMock).not.toHaveBeenCalled();
  });
});

describe("video queueing (drain-on-ack for videos)", () => {
  // the live bug: "i can't queue videos" - a video with no local blake3
  // (common for a locally-imported/never-synced video - see
  // QueuedVideo.blake3's own doc comment) never drains from the local
  // queue after a successful push/append, because the old drain path
  // recomputed a hash from the STALE local video object
  // (`mediaItemBlake3`, which has no id fallback for video, unlike song's
  // `?? sha256`) instead of using the hash that was ACTUALLY sent on the
  // wire (freshly computed by `importMediaBytes`/`videoToMediaRef`).
  it("appendVideosToPlayer drains a video with no local blake3 after a successful ack", async () => {
    const v = video({ blake3: undefined });
    state = { queue: [{ kind: "video", video: v }], current_sha256: "vid-1" } as AppState;
    sendPlayerCommand.mockResolvedValue({ type: "command_ack", ok: true });

    await appendVideosToPlayer("player-peer", [v]);

    expect(setQueueMock).toHaveBeenCalledTimes(1);
    expect(setQueueMock.mock.calls[0][0]).toEqual([]);
  });

  it("pushVideosToPlayer drains a video with no local blake3 once the ack confirms the handoff", async () => {
    const v = video({ blake3: undefined });
    state = { queue: [{ kind: "video", video: v }], current_sha256: "vid-1" } as AppState;
    sendPlayerCommand.mockResolvedValue({
      type: "command_ack",
      ok: true,
      status: {
        type: "status",
        state: "now_playing",
        // the wire hash the mocked import always returns - see
        // getMiddenNode.mockResolvedValue's import_blob in beforeEach.
        item: { source_peer_addr: "player-peer", blake3_hash: "b3-1" },
        position_ms: 0,
        server_time_ms: Date.now(),
        queue: [],
        auto_download_enabled: false,
        volume: 1,
        recently_played: [],
      },
    });

    await pushVideosToPlayer("player-peer", [v]);

    expect(setQueueMock).toHaveBeenCalledTimes(1);
    expect(setQueueMock.mock.calls[0][0]).toEqual([]);
  });

  it("does not drain an unrelated video still sitting in the local queue", async () => {
    const pushed = video({ blake3: undefined });
    const other = video({ id: "vid-2", blake3: undefined, title: "unrelated" });
    state = {
      queue: [
        { kind: "video", video: pushed },
        { kind: "video", video: other },
      ],
      current_sha256: "vid-1",
    } as AppState;
    sendPlayerCommand.mockResolvedValue({ type: "command_ack", ok: true });

    await appendVideosToPlayer("player-peer", [pushed]);

    const kept = setQueueMock.mock.calls[0][0] as MediaItem[];
    expect(kept.map((i) => (i.kind === "song" ? i.song.sha256 : i.video.id))).toEqual(["vid-2"]);
  });
});

describe("withTransferStatus's bucket-A registry wiring (relay/proxy path)", () => {
  // a video with no local blake3 and no remote_server_id can't take the
  // optimistic/bridged fast paths in videoToMediaRef - it falls all the
  // way to the last-resort fetch+import relay, exercising
  // withTransferStatus exactly like the "no local blake3" drain tests
  // above already do (this just adds assertions on the NEW bucket-A
  // wiring + queueItemTransferStatus, not the drain behavior).
  it("registers and completes a bucket-A transfer, and clears queueItemTransferStatus once done", async () => {
    // needs a genuinely streamed/chunked fetch+import to ever produce a
    // "fetching" progress call at all - the suite's default fetch/
    // getMiddenNode mocks (no content-length, no start_import) hit the
    // whole-buffer fallback, which reports no progress in either phase
    // (matches production behavior for that same fallback).
    const total = 8;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        let sent = false;
        return {
          headers: { get: (name: string) => (name === "content-length" ? String(total) : null) },
          body: {
            getReader: () => ({
              read: async () => {
                if (sent) return { done: true, value: undefined };
                sent = true;
                return { done: false, value: new Uint8Array(total) };
              },
            }),
          },
        } as unknown as Response;
      })
    );
    getMiddenNode.mockResolvedValue({
      node_id: () => "this-device",
      start_import: () => ({
        push: async () => {},
        finish: async () => "b3-1",
        abort: () => {},
      }),
    });

    const v = video({ blake3: undefined });
    state = { queue: [{ kind: "video", video: v }], current_sha256: "vid-1" } as AppState;
    sendPlayerCommand.mockResolvedValue({ type: "command_ack", ok: true });

    await appendVideosToPlayer("player-peer", [v]);

    expect(registerBlobTransfer).toHaveBeenCalledWith("pending:vid-1", "download", {
      bytesTotal: total,
    });
    expect(updateBlobTransferProgress).toHaveBeenCalledWith("pending:vid-1", total, total);
    expect(completeBlobTransfer).toHaveBeenCalledWith("pending:vid-1");
    // status is cleared once the relay finishes - no stale "fetching"/
    // "sending" row left behind for a transfer that's already done.
    expect(queueItemTransferStatus("pending:vid-1")).toBeUndefined();
  });

  it("still completes bucket A and clears status even when the relay fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unreachable");
      })
    );
    const v = video({ blake3: undefined });
    state = { queue: [{ kind: "video", video: v }], current_sha256: "vid-1" } as AppState;

    await expect(appendVideosToPlayer("player-peer", [v])).rejects.toThrow();

    // registerBlobTransfer never got called at all here (the fetch throws
    // before any progress callback fires), so there's nothing for bucket A
    // to complete - the important assertion is that status still cleaned up.
    expect(queueItemTransferStatus("pending:vid-1")).toBeUndefined();
  });
});

describe("handleUnresolvedItems: direct P2P pull vs js fetch+import relay", () => {
  // regression coverage, when bridging fails but a P2P source remote
  // (peer_addr) is still known, this device must pull the blob DIRECTLY
  // from that peer (charnel/tauri: `pullBlobToLocalStore`, entirely rust-side)
  // instead of falling back to the js fetch()+chunked-import relay -
  // see `tryDirectP2PPull` in playerQueuePush.ts.
  const p2pRemote = {
    remote_id: "remote-1",
    name: "source remote",
    transport: "app",
    peer_addr: "source-peer-node-id",
    is_active: true,
    last_connected_at: null,
    created_at: 0,
    updated_at: 0,
    description: null,
    image_url: null,
    image_blob_id: null,
    version: null,
    last_info_check: null,
  } as unknown as Awaited<ReturnType<typeof getRemoteById>>;

  beforeEach(() => {
    isCharnelMode.mockReturnValue(true);
    getRemoteById.mockResolvedValue(p2pRemote);
    // bridging fails - this device isn't admin on the source remote.
    adminDispatchOrThrow.mockRejectedValue(new Error("not admin"));
  });

  it("pulls directly from the known P2P source peer instead of relaying through js fetch", async () => {
    const s = song({ remote_server_id: "remote-1" });
    state = { queue: [{ kind: "song", song: s }], current_sha256: "hash-1" } as AppState;
    sendPlayerCommand.mockResolvedValue({ type: "command_ack", ok: true });
    pullBlobToLocalStore.mockResolvedValue(undefined);

    // populate pushedItemsByHash so handleUnresolvedItems has something
    // to retry.
    await pushSongsToPlayer("player-peer", [s]);

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await handleUnresolvedItems("player-peer", [
      { blake3_hash: "b3-1", source_peer_addr: "source-peer-node-id" },
    ]);

    expect(pullBlobToLocalStore).toHaveBeenCalledWith("source-peer-node-id", "b3-1");
    // the js fetch+import relay must never run once the direct pull
    // succeeds - no bytes should cross into js memory at all.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to the js fetch+import relay if the direct pull itself fails", async () => {
    const s = song({ remote_server_id: "remote-1" });
    state = { queue: [{ kind: "song", song: s }], current_sha256: "hash-1" } as AppState;
    sendPlayerCommand.mockResolvedValue({ type: "command_ack", ok: true });
    pullBlobToLocalStore.mockRejectedValue(new Error("peer offline"));

    await pushSongsToPlayer("player-peer", [s]);

    const fetchSpy = vi.fn(
      async () =>
        ({
          headers: { get: () => null },
          arrayBuffer: async () => new ArrayBuffer(4),
        }) as unknown as Response
    );
    vi.stubGlobal("fetch", fetchSpy);

    await handleUnresolvedItems("player-peer", [
      { blake3_hash: "b3-1", source_peer_addr: "source-peer-node-id" },
    ]);

    expect(pullBlobToLocalStore).toHaveBeenCalledWith("source-peer-node-id", "b3-1");
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("browser/wasm mode: pulls directly via the midden node instead of relaying through js fetch", async () => {
    isCharnelMode.mockReturnValue(false);
    const downloadVerifiedToStoreWithEnsure = vi.fn().mockResolvedValue(undefined);
    getMiddenNode.mockResolvedValue({
      node_id: () => "this-device",
      download_verified_to_store_with_ensure: downloadVerifiedToStoreWithEnsure,
    });

    const s = song({ remote_server_id: "remote-1" });
    state = { queue: [{ kind: "song", song: s }], current_sha256: "hash-1" } as AppState;
    sendPlayerCommand.mockResolvedValue({ type: "command_ack", ok: true });

    await pushSongsToPlayer("player-peer", [s]);

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await handleUnresolvedItems("player-peer", [
      { blake3_hash: "b3-1", source_peer_addr: "source-peer-node-id" },
    ]);

    expect(downloadVerifiedToStoreWithEnsure).toHaveBeenCalledWith("source-peer-node-id", "b3-1");
    expect(pullBlobToLocalStore).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
