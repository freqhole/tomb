import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem, QueuedVideo } from "../storage/mediaItem";
import type { Song } from "../../../music/services/storage/types";

const mocks = vi.hoisted(() => ({
  queue: [] as MediaItem[],
  apply: vi.fn(),
  getRemote: vi.fn(),
  remoteSongs: vi.fn(),
  localSongs: vi.fn(),
  album: vi.fn(),
  artist: vi.fn(),
  remoteVideo: vi.fn(),
  localVideo: vi.fn(),
  localVideoImages: vi.fn(),
  log: vi.fn(),
}));
vi.mock("../storage/db", () => ({
  appState: () => ({ queue: mocks.queue }),
  applyHistoryArtwork: mocks.apply,
}));
vi.mock("../remotes/remoteManager", () => ({ getRemoteById: mocks.getRemote }));
vi.mock("../../../music/data/local/localSource", () => ({
  localDataSource: { getSongsByIds: mocks.localSongs },
}));
vi.mock("../../../music/data/remote/remoteSource", () => ({
  RemoteMusicDataSource: class {
    constructor(public remote: { remote_id: string }) {}
    getSongsByIds(ids: string[]) { return mocks.remoteSongs(this.remote.remote_id, ids); }
  },
}));
vi.mock("../../../music/services/storage/db", () => ({
  getAlbumById: mocks.album,
  getArtistById: mocks.artist,
}));
vi.mock("../../../video/data/local/localSource", () => ({
  localVideoDataSource: { getVideoById: mocks.localVideo, getEntityImages: mocks.localVideoImages },
}));
vi.mock("../../../video/data/remote/remoteSource", () => ({
  RemoteVideoDataSource: class {
    constructor(public remote: { remote_id: string }) {}
    getVideoById(id: string) { return mocks.remoteVideo(this.remote.remote_id, id); }
  },
}));
vi.mock("../../../utils/logger", () => ({ error: mocks.log }));

import { newHistoryQueueItems, refreshHistoryArtwork } from "./historyArtwork";

function song(id: string, remote: string | null): MediaItem {
  return { kind: "song", song: {
    id, remote_server_id: remote, source_type: remote ? "remote" : "local",
    album_id: "album", artist_id: "artist",
  } as Song };
}

describe("history artwork refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queue = [];
    mocks.getRemote.mockImplementation(async (id: string) => ({ remote_id: id }));
  });

  it("uses each item's source and batches song lookups without changing history ids", async () => {
    const history = [song("a", "one"), song("b", "two"), song("c", null)];
    mocks.queue = newHistoryQueueItems(history);
    mocks.remoteSongs.mockImplementation(async (_remote: string, ids: string[]) =>
      ids.map((id) => ({ id, images: [{ remote_blob_id: `fresh-${id}` }] })));
    mocks.localSongs.mockResolvedValue([{ id: "c", album_id: "album", artist_id: "artist" }]);
    mocks.album.mockResolvedValue({ images: [{ local_blob_id: "album-art" }] });
    mocks.artist.mockResolvedValue({ images: [{ local_blob_id: "artist-art" }] });
    await refreshHistoryArtwork(mocks.queue);
    expect(mocks.remoteSongs).toHaveBeenCalledWith("one", ["a"]);
    expect(mocks.remoteSongs).toHaveBeenCalledWith("two", ["b"]);
    expect(mocks.localSongs).toHaveBeenCalledWith(["c"]);
    const updates = mocks.apply.mock.calls[0][0] as Map<string, { after: MediaItem }>;
    expect(updates.size).toBe(3);
    const localId = mocks.queue[2].kind === "song" ? mocks.queue[2].song.queue_entry_id! : "";
    expect(updates.get(localId)?.after).toMatchObject({
      song: { album_images: [{ local_blob_id: "album-art" }], artist_images: [{ local_blob_id: "artist-art" }] },
    });
    expect(history[0].kind === "song" && history[0].song.queue_entry_id).toBeUndefined();
  });

  it("logs lookup failures and leaves those entries unchanged", async () => {
    mocks.queue = newHistoryQueueItems([song("missing", "one")]);
    mocks.getRemote.mockResolvedValue(undefined);
    await refreshHistoryArtwork(mocks.queue);
    expect(mocks.log).toHaveBeenCalled();
    expect(mocks.apply.mock.calls[0][0].size).toBe(0);
  });

  it("limits song batches and refreshes local video images and posters", async () => {
    const songs = Array.from({ length: 51 }, (_, index) => song(`s${index}`, "one"));
    const video: MediaItem = { kind: "video", video: {
      id: "video", source_type: "local", poster_blob_id: "old",
    } as QueuedVideo };
    mocks.queue = newHistoryQueueItems([...songs, video]);
    mocks.remoteSongs.mockImplementation(async (_remote: string, ids: string[]) =>
      ids.map((id) => ({ id, images: [] })));
    mocks.localVideo.mockResolvedValue({ id: "video", poster_blob_id: "new", poster_opfs_path: "poster" });
    mocks.localVideoImages.mockResolvedValue([
      { local_blob_id: "image", is_primary: true, blob_type: "thumbnail" },
    ]);
    await refreshHistoryArtwork(mocks.queue);
    expect(mocks.remoteSongs.mock.calls.map((call) => call[1].length)).toEqual([50, 1]);
    const updates = mocks.apply.mock.calls[0][0] as Map<string, { after: MediaItem }>;
    const queuedVideo = mocks.queue[51];
    if (queuedVideo.kind !== "video") throw new Error("expected video");
    expect(updates.get(queuedVideo.video.queue_entry_id!)?.after).toMatchObject({
      video: {
        poster_blob_id: "new",
        poster_opfs_path: "poster",
        images: [{ blob_id: "image", is_primary: 1 }],
      },
    });
  });

  it("keeps a locally generated waveform when the source has none", async () => {
    const item = song("a", "one");
    if (item.kind !== "song") throw new Error("expected song");
    item.song.images = [{
      remote_blob_id: "local-waveform", remote_server_id: "self",
      is_primary: false, blob_type: "waveform",
    }];
    mocks.queue = newHistoryQueueItems([item]);
    mocks.remoteSongs.mockResolvedValue([{ id: "a", images: [{ remote_blob_id: "fresh-cover", blob_type: "original" }] }]);
    await refreshHistoryArtwork(mocks.queue);
    const updates = mocks.apply.mock.calls[0][0] as Map<string, { after: MediaItem }>;
    const queued = mocks.queue[0];
    if (queued.kind !== "song") throw new Error("expected song");
    expect(updates.get(queued.song.queue_entry_id!)?.after).toMatchObject({
      song: { images: [{ remote_blob_id: "fresh-cover" }, { remote_blob_id: "local-waveform" }] },
    });
  });
});
