import { beforeEach, expect, it, vi } from "vitest";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import type { SendPlaylistPayload } from "./sendToRemote";
import { sendToLocalLibrary } from "./sendToLocalLibrary";

const mocks = vi.hoisted(() => ({
  song: vi.fn(),
  video: vi.fn(),
  findSong: vi.fn(),
  findVideo: vi.fn(),
  findVideoId: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock("../sync", () => ({ syncSongToLocal: mocks.song, canSyncSong: () => true }));
vi.mock("../storage/db", () => ({ initMusicDB: async () => "db" }));
vi.mock("../storage/db/songs", () => ({ findExistingSongByContentHash: mocks.findSong }));
vi.mock("../storage/playlists", () => ({ upsertLocalPlaylistWithItems: mocks.upsert }));
vi.mock("../../../video/services/storage/db/videos", () => ({
  getVideoByBlake3: mocks.findVideo,
  getLocalVideoById: mocks.findVideoId,
}));
vi.mock("../../../video/services/sync/syncVideoToLocal", () => ({ syncVideoToLocal: mocks.video }));
vi.mock("../../../app/services/transfers/blobTransferRegistry", () => ({
  registerBlobTransfer: vi.fn(), updateBlobTransferProgress: vi.fn(), completeBlobTransfer: vi.fn(),
}));
vi.mock("./sendToRemote", () => ({
  SendToRemoteError: class extends Error {
    constructor(message: string, public readonly progress: unknown) { super(message); }
  },
}));

const remote: Remote = {
  remote_id: "source", name: "source", transport: "http", base_url: "https://example.test",
  is_active: false, last_connected_at: null, created_at: 0, updated_at: 0,
  description: null, image_url: null, image_blob_id: null, version: null, last_info_check: null,
};
const payload = {
  kind: "playlist",
  playlistId: "playlist",
  title: "playlist",
  songs: [{ id: "remote-song", title: "song", sha256: "", blake3: "song-hash" }],
  videos: [{ id: "remote-video", title: "video", blake3: "video-hash" }],
  memberOrder: [{ kind: "video", blake3: "video-hash" }, { kind: "song", blake3: "song-hash" }],
} as SendPlaylistPayload;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.song.mockResolvedValue({ success: true, localSongId: "local-song" });
  mocks.video.mockResolvedValue({ success: true, videoId: "local-video" });
});

it("syncs mixed playlist members in order using destination ids", async () => {
  const result = await sendToLocalLibrary(payload, remote);
  expect(result.phase).toBe("done");
  expect(mocks.video).toHaveBeenCalledWith(
    expect.objectContaining({ id: "remote-video", remote_server_id: "source" }),
    remote,
    { force: true, originalOnly: true },
  );
  expect(mocks.upsert).toHaveBeenCalledWith("db", expect.objectContaining({
    playlist_id: "synced-playlist",
  }), [
    { entity_type: "video", entity_id: "local-video" },
    { entity_type: "song", entity_id: "local-song" },
  ]);
});

it("does not replace a playlist with incomplete membership", async () => {
  mocks.video.mockResolvedValue({ success: false, error: "transfer failed" });
  await expect(sendToLocalLibrary(payload, remote)).rejects.toThrow("video not available locally");
  expect(mocks.upsert).not.toHaveBeenCalled();
});

it("rebuilds the playlist after retrying a failed member", async () => {
  mocks.findVideo.mockResolvedValue({ id: "existing-local-video" });
  const result = await sendToLocalLibrary(payload, remote, { retryBlake3s: ["song-hash"] });
  expect(result.phase).toBe("done");
  expect(mocks.video).not.toHaveBeenCalled();
  expect(mocks.upsert).toHaveBeenCalledWith("db", expect.anything(), [
    { entity_type: "video", entity_id: "existing-local-video" },
    { entity_type: "song", entity_id: "local-song" },
  ]);
});
