import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import type { SendPlaylistPayload } from "./sendToRemote";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  buildPlaylist: vi.fn(),
  buildSong: vi.fn(),
  checkBlobs: vi.fn(),
  waitForJob: vi.fn(),
}));
vi.mock("../../../app/api/client", () => ({
  getTransportForRemote: vi.fn(async () => ({ request: mocks.request })),
}));
vi.mock("../../../app/services/send/sendValidation", () => ({
  isValidSendDestination: () => true,
  resolveSourceNodeId: () => "source-node",
  checkBlobsPresentOnDest: mocks.checkBlobs,
  peerUnauthorizedMessage: vi.fn(),
}));
vi.mock("../../data/remote/remoteSource", () => ({ RemoteMusicDataSource: class {} }));
vi.mock("../../../lib/api/blobServing", () => ({ ensureBlobServable: vi.fn() }));
vi.mock("./buildSyncRequests", () => ({
  buildSyncPlaylistRequest: mocks.buildPlaylist,
  buildSyncAlbumRequest: vi.fn(),
  buildSyncSongByBlake3Request: mocks.buildSong,
}));
vi.mock("./albumSendMetadata", () => ({ loadAlbumSendMetadata: vi.fn() }));
vi.mock("../../../video/services/sync/buildSyncVideoRequest", () => ({
  buildSyncVideoByBlake3Body: vi.fn(),
}));
vi.mock("../../../app/services/jobs/jobService", () => ({ waitForJobResult: mocks.waitForJob }));

import { sendToRemote } from "./sendToRemote";

const source = { remote_id: "source", name: "source" } as Remote;
const dest = { remote_id: "dest", name: "dest" } as Remote;
const payload = {
  kind: "playlist",
  playlistId: "playlist",
  title: "playlist",
  songs: [{ id: "song", blake3: "song-hash", sha256: "sha" }],
  videos: [{ id: "video", blake3: "video-hash" }],
  memberOrder: [
    { kind: "video", blake3: "video-hash" },
    { kind: "song", blake3: "song-hash" },
  ],
} as SendPlaylistPayload;

describe("playlist sends", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.buildPlaylist.mockImplementation(async (options) => ({ members: options.members }));
    mocks.request.mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        success: true,
        data: {
          playlist_id: "synced",
          members_added: 2,
          missing_member_blake3s: [],
          song_stubs_created: 0,
          images_linked: 0,
          missing_image_blake3s: [],
        },
      }),
    });
  });

  it("updates full ordered membership on a retry", async () => {
    await sendToRemote(payload, source, dest, { retryBlake3s: [] });
    expect(mocks.buildPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ members: payload.memberOrder })
    );
    expect(mocks.request).toHaveBeenCalledWith(
      "POST",
      "/api/sync/playlist",
      JSON.stringify({ members: payload.memberOrder })
    );
  });

  it("refuses an incomplete member list rather than overwriting a playlist", async () => {
    await expect(
      sendToRemote({ ...payload, memberOrder: payload.memberOrder!.slice(0, 1) }, source, dest, {
        retryBlake3s: [],
      })
    ).rejects.toThrow("playlist membership could not be resolved");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("refuses to treat a playlist whose members lack hashes as empty", async () => {
    const song = { ...payload.songs[0], blake3: "" };
    await expect(
      sendToRemote({ ...payload, songs: [song], videos: [], memberOrder: [] }, source, dest, {
        retryBlake3s: [],
      })
    ).rejects.toThrow("playlist has members without a blake3 hash");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("reports unresolved destination members as a failure", async () => {
    mocks.request.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({
        success: true,
        data: {
          playlist_id: "synced",
          members_added: 0,
          missing_member_blake3s: ["song-hash"],
          song_stubs_created: 0,
          images_linked: 0,
          missing_image_blake3s: [],
        },
      }),
    });
    await expect(sendToRemote(payload, source, dest, { retryBlake3s: [] })).rejects.toThrow(
      "playlist is missing 1 member"
    );
  });

  it("reconciles artist images for an existing song and reports missing images", async () => {
    const song: SendPlaylistPayload["songs"][number] = {
      ...payload.songs[0],
      title: "song",
      artist_images: [{ remote_blob_id: "artist-image", blob_type: "original", is_primary: true }],
    };
    mocks.checkBlobs.mockResolvedValue(new Set(["song-hash"]));
    mocks.buildSong.mockResolvedValue({
      artist_images: [{ blake3: "image-hash" }],
    });
    mocks.request.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ success: true, data: { job_id: "job" } }),
    });
    mocks.waitForJob.mockResolvedValue({
      status: "completed",
      result: {
        song_id: "song",
        media_blob_id: "blob",
        artist_id: "artist",
        file_path: "song.mp3",
        blake3: "song-hash",
        existing: true,
        images_linked: 0,
        missing_image_blake3s: ["image-hash"],
      },
    });
    const result = await sendToRemote({ kind: "song", song }, source, dest, {
      retryBlake3s: ["song-hash"],
    });
    expect(mocks.buildSong).toHaveBeenCalledOnce();
    expect(result.syncedSongs).toBe(1);
    expect(result.errors).toContain("song song: 1 image(s) could not be synced");
  });
});
