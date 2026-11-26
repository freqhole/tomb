import { beforeEach, expect, it, vi } from "vitest";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import { importPlaylistItemsToLocal } from "./importPlaylistItemsToLocal";

const mocks = vi.hoisted(() => ({
  song: vi.fn(),
  video: vi.fn(),
  syncSong: vi.fn(),
  syncVideo: vi.fn(),
}));
vi.mock("../../data/remote/remoteSource", () => ({
  RemoteMusicDataSource: class { getSongById = mocks.song; },
}));
vi.mock("../../../video/data/remote/remoteSource", () => ({
  RemoteVideoDataSource: class { getVideoById = mocks.video; },
}));
vi.mock("./syncSongToLocal", () => ({ syncSongToLocal: mocks.syncSong }));
vi.mock("../../../video/services/sync/syncVideoToLocal", () => ({ syncVideoToLocal: mocks.syncVideo }));

const remote: Remote = {
  remote_id: "source", name: "source library", transport: "http", base_url: "https://example.test",
  is_active: false, last_connected_at: null, created_at: 0, updated_at: 0,
  description: null, image_url: null, image_blob_id: null, version: null, last_info_check: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.song.mockResolvedValue({ id: "remote-song", title: "song" });
  mocks.video.mockResolvedValue({ id: "remote-video", title: "video" });
  mocks.syncSong.mockResolvedValue({ success: true, localSongId: "local-song" });
  mocks.syncVideo.mockResolvedValue({ success: true, videoId: "local-video" });
});

it("imports mixed items and returns destination ids in their original order", async () => {
  const result = await importPlaylistItemsToLocal([
    { entity_type: "video", entity_id: "remote-video" },
    { entity_type: "song", entity_id: "remote-song" },
  ], remote);
  expect(result).toEqual([
    { entity_type: "video", entity_id: "local-video" },
    { entity_type: "song", entity_id: "local-song" },
  ]);
  expect(mocks.syncVideo).toHaveBeenCalledWith(
    expect.objectContaining({ id: "remote-video" }), remote, { force: true, originalOnly: true }
  );
  expect(mocks.syncSong).toHaveBeenCalledWith(
    expect.objectContaining({ id: "remote-song", remote_server_id: "source" }), undefined, remote
  );
});

it("rejects a failed import rather than returning an invalid playlist reference", async () => {
  mocks.syncSong.mockResolvedValue({ success: false, error: "transfer failed" });
  await expect(importPlaylistItemsToLocal([
    { entity_type: "song", entity_id: "remote-song" },
  ], remote)).rejects.toThrow('failed to import "song": transfer failed');
});
