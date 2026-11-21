import { beforeEach, expect, it, vi } from "vitest";
import type { MediaItem } from "../storage/mediaItem";
import type { RadioStationRef } from "../storage/types";
import { queueToTunedStation } from "./queueToTunedStation";

const mocks = vi.hoisted(() => ({
  station: null as RadioStationRef | null,
  confirm: vi.fn(),
  leave: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  stations: vi.fn(),
  requests: vi.fn(),
  playing: null as { kind: "song" | "video"; song_id: string } | null,
  querySongs: vi.fn(),
  video: vi.fn(),
  metadata: vi.fn(),
  queryVideos: vi.fn(),
  submit: vi.fn(),
  clear: vi.fn(),
  client: vi.fn(),
  peer: vi.fn(),
  url: vi.fn(),
  managed: vi.fn(),
}));
vi.mock("../storage/currentRadioStation", () => ({ currentRadioStation: () => mocks.station }));
vi.mock("./radioService", () => ({
  radioStatus: () => "playing", radioNowPlaying: () => mocks.playing, leaveRadio: mocks.leave,
}));
vi.mock("../confirmState", () => ({ confirm: mocks.confirm }));
vi.mock("../players/activeTarget", () => ({ isRemoteTargetActive: () => false }));
vi.mock("../remotes/remoteManager", () => ({
  getRemoteByPeerAddr: mocks.peer,
  getRemoteByUrl: mocks.url,
  getTauriManagedRemote: mocks.managed,
}));
vi.mock("../../api/client", () => ({
  getClientForRemote: mocks.client,
  httpRemote: (baseUrl: string) => ({ transport: "http", base_url: baseUrl }),
}));
vi.mock("../../../components/feedback/Toast", () => ({
  toast: { error: mocks.error, success: mocks.success, info: mocks.info },
}));

const item = (id: string, remoteId = "station-remote"): Extract<MediaItem, { kind: "video" }> => ({
  kind: "video",
  video: {
    id, title: id, content_type: "movie", media_blob_id: "blob", created_at: 0, updated_at: 0,
    source_type: "remote", remote_server_id: remoteId, blake3: null, is_offline: false,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.peer.mockResolvedValue({ remote_id: "station-remote" });
  mocks.url.mockResolvedValue(undefined);
  mocks.managed.mockResolvedValue(null);
  mocks.client.mockResolvedValue({
    app: {
      radioStationsFull: mocks.stations, radioListRequests: mocks.requests,
      radioSubmitRequest: mocks.submit, radioClearRequests: mocks.clear,
    },
    video: { getVideo: mocks.video, queryVideos: mocks.queryVideos },
    music: { blobMetadataByBlake3: mocks.metadata, querySongs: mocks.querySongs },
  });
  mocks.station = { peer_addr: "peer", station_id: "station", station_name: "station", accepts_requests: true };
  mocks.playing = null;
  mocks.requests.mockResolvedValue({ success: true, data: { requests: [] } });
  mocks.stations.mockResolvedValue({ success: true, data: {
    stations: [{ station_id: "station", name: "station", accepts_requests: true, content_mode: "video_only" }],
  } });
  mocks.video.mockImplementation(async ({ id }: { id: string }) => ({ success: true, data: { id } }));
  mocks.submit.mockResolvedValue({ success: true });
  mocks.clear.mockResolvedValue({ success: true });
  mocks.confirm.mockResolvedValue(false);
});

it("uses the saved HTTP remote, preserving its configuration", async () => {
  const remote = { remote_id: "station-remote", transport: "http", base_url: "https://station.test", api_key: "test-key" };
  mocks.station = { peer_addr: remote.base_url, station_id: "station", station_name: "station" };
  mocks.url.mockResolvedValue(remote);
  expect(await queueToTunedStation([item("video")])).toBe("handled");
  expect(mocks.url).toHaveBeenCalledExactlyOnceWith(remote.base_url);
  expect(mocks.peer).not.toHaveBeenCalled();
  expect(mocks.client).toHaveBeenCalledExactlyOnceWith(remote);
  expect(mocks.submit).toHaveBeenCalledOnce();
});

it.each([
  { address: "http://station.test", ref: { transport: "http", base_url: "http://station.test" } },
  { address: "https://station.test", ref: { transport: "http", base_url: "https://station.test" } },
  { address: "peer", ref: { peer_addr: "peer" } },
])("keeps unsaved station references working ($address)", async ({ address, ref }) => {
  mocks.station = { peer_addr: address, station_id: "station", station_name: "station" };
  mocks.peer.mockResolvedValue(undefined);
  expect(await queueToTunedStation([item("video")])).toBe("handled");
  expect(mocks.client).toHaveBeenCalledExactlyOnceWith(ref);
  if ("base_url" in ref) {
    expect(mocks.url).toHaveBeenCalledExactlyOnceWith(address);
    expect(mocks.peer).not.toHaveBeenCalled();
  } else {
    expect(mocks.peer).toHaveBeenCalledExactlyOnceWith(address);
    expect(mocks.url).not.toHaveBeenCalled();
  }
  expect(mocks.error).not.toHaveBeenCalled();
});

it("keeps local station routing separate from URL and peer lookups", async () => {
  mocks.station = { peer_addr: "self", is_local: true, station_id: "station", station_name: "station" };
  expect(await queueToTunedStation([item("video")])).toBe("handled");
  expect(mocks.managed).toHaveBeenCalledOnce();
  expect(mocks.peer).not.toHaveBeenCalled();
  expect(mocks.url).not.toHaveBeenCalled();
  expect(mocks.client).toHaveBeenCalledExactlyOnceWith({ is_charnel_managed: true });
  expect(mocks.error).not.toHaveBeenCalled();
});

it("submits a batch to the station in order without a local queue fallback", async () => {
  expect(await queueToTunedStation([item("first"), item("second")], "next")).toBe("handled");
  expect(mocks.submit.mock.calls.map(([request]) => request)).toEqual([
    { station_id: "station", kind: "video", item_id: "first", queue_position: 0 },
    { station_id: "station", kind: "video", item_id: "second", queue_position: 1 },
  ]);
  expect(mocks.confirm).not.toHaveBeenCalled();
  expect(mocks.leave).not.toHaveBeenCalled();
  expect(mocks.success).not.toHaveBeenCalled();
  expect(mocks.info).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
});

it("uses a matching item from the station library even when media came from another remote", async () => {
  const video = item("other-video", "other-remote");
  video.video.blake3 = "shared-hash";
  mocks.metadata.mockResolvedValue({ success: true, data: { id: "station-blob" } });
  mocks.queryVideos.mockResolvedValue({ success: true, data: { items: [{ id: "station-video" }] } });
  expect(await queueToTunedStation([video])).toBe("handled");
  expect(mocks.metadata).toHaveBeenCalledWith({ blake3: "shared-hash" });
  expect(mocks.queryVideos).toHaveBeenCalledWith({
    params: { filters: { media_blob_ids: ["station-blob"], hide_offline: true }, limit: 1 },
    unassigned: false,
  });
  expect(mocks.video).not.toHaveBeenCalled();
  expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ item_id: "station-video" }));
});

it("prefers a video's blake3 over its row id even on the same remote", async () => {
  const video = item("outdated-id");
  video.video.blake3 = "shared-hash";
  mocks.metadata.mockResolvedValue({ success: true, data: { id: "station-blob" } });
  mocks.queryVideos.mockResolvedValue({ success: true, data: { items: [{ id: "matching-video" }] } });
  expect(await queueToTunedStation([video])).toBe("handled");
  expect(mocks.video).not.toHaveBeenCalled();
  expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ item_id: "matching-video" }));
  expect(mocks.confirm).not.toHaveBeenCalled();
});

it("queues one station item when different remotes supply the same video hash", async () => {
  const first = item("first-remote-id", "first-remote");
  const second = item("second-remote-id", "second-remote");
  first.video.blake3 = second.video.blake3 = "shared-hash";
  mocks.metadata.mockResolvedValue({ success: true, data: { id: "station-blob" } });
  mocks.queryVideos.mockResolvedValue({ success: true, data: { items: [{ id: "station-video" }] } });
  expect(await queueToTunedStation([first, second], "next")).toBe("handled");
  expect(mocks.submit).toHaveBeenCalledExactlyOnceWith({
    station_id: "station", kind: "video", item_id: "station-video", queue_position: 0,
  });
  expect(mocks.confirm).not.toHaveBeenCalled();
});

it("matches songs from another remote by blake3 rather than the source song id", async () => {
  const song: MediaItem = { kind: "song", song: {
    id: "browser-song", sha256: "", title: "song", artist_id: "artist", album_id: "album",
    track_number: 1, disc_number: 1, duration_seconds: 42, year: null, bpm: null,
    track_artist: null, lyrics: null, metadata: null, created_at: 0, updated_at: 0,
    artist_name: "artist", album_title: "album", album_added_at: 0, album_primary_genre_id: null,
    source_type: "remote", opfs_path: null, file_name: null, file_size: null,
    last_modified: null, mime_type: null, source_url: null, downloaded_at: null,
    remote_server_id: "other-remote", remote_song_id: "other-song", blake3: "song-hash", added_at: 0,
  } };
  mocks.stations.mockResolvedValue({ success: true, data: {
    stations: [{ station_id: "station", name: "station", accepts_requests: true, content_mode: "audio_only" }],
  } });
  mocks.querySongs.mockResolvedValue({ success: true, data: { items: [{ song: { id: "station-song" } }] } });
  expect(await queueToTunedStation([song])).toBe("handled");
  expect(mocks.querySongs).toHaveBeenCalledWith({
    filters: { media_blob_blake3: ["song-hash"], hide_offline: true }, limit: 1,
  });
  expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ kind: "song", item_id: "station-song" }));
  expect(mocks.confirm).not.toHaveBeenCalled();
});

it("skips queued, currently playing, and batch duplicates without leaving holes in play-next order", async () => {
  mocks.requests.mockResolvedValue({ success: true, data: {
    requests: [{ kind: "video", item_id: "queued" }],
  } });
  mocks.playing = { kind: "video", song_id: "playing" };
  expect(await queueToTunedStation([
    item("queued"), item("playing"), item("new"), item("new"), item("last"),
  ], "next")).toBe("handled");
  expect(mocks.submit.mock.calls.map(([request]) => request)).toEqual([
    { station_id: "station", kind: "video", item_id: "new", queue_position: 0 },
    { station_id: "station", kind: "video", item_id: "last", queue_position: 1 },
  ]);
  expect(mocks.confirm).not.toHaveBeenCalled();
  expect(mocks.info).not.toHaveBeenCalled();
  expect(mocks.success).not.toHaveBeenCalled();
});

it("does not confuse a station lookup failure with missing content", async () => {
  const video = item("video", "other-remote");
  video.video.blake3 = "hash";
  mocks.metadata.mockResolvedValue({
    success: false, error: { issues: [{ path: ["unauthorized"], message: "sign in again" }] },
  });
  expect(await queueToTunedStation([video])).toBe("handled");
  expect(mocks.confirm).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("sign in again"));
});

it("offers local queuing when the content hash is genuinely missing", async () => {
  const video = item("video", "other-remote");
  video.video.blake3 = "hash";
  mocks.metadata.mockResolvedValue({
    success: false, error: { issues: [{ path: ["media_blob_not_found"], message: "missing blob" }] },
  });
  expect(await queueToTunedStation([video])).toBe("handled");
  expect(mocks.confirm).toHaveBeenCalledOnce();
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
});

it("preflights all items and leaves the station untouched when the user cancels", async () => {
  mocks.video.mockResolvedValue({ success: false, error: { issues: [{ path: ["video_not_found"] }] } });
  expect(await queueToTunedStation([item("missing")])).toBe("handled");
  expect(mocks.confirm).toHaveBeenCalledOnce();
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.clear).not.toHaveBeenCalled();
  expect(mocks.leave).not.toHaveBeenCalled();
});

it("switches only local listening after confirmation without clearing the station queue", async () => {
  mocks.video.mockResolvedValue({ success: false, error: { issues: [{ path: ["video_not_found"] }] } });
  mocks.confirm.mockResolvedValue(true);
  expect(await queueToTunedStation([item("missing")])).toBe("local");
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
    confirmText: "stop listening and queue locally",
    variant: "secondary",
    cancelVariant: "danger",
    cancelLast: true,
  }));
  expect(mocks.clear).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.leave).toHaveBeenCalledOnce();
});

it("does not queue locally if stopping local station playback fails", async () => {
  mocks.video.mockResolvedValue({ success: false, error: { issues: [{ path: ["video_not_found"] }] } });
  mocks.confirm.mockResolvedValue(true);
  mocks.leave.mockImplementationOnce(() => { throw new Error("could not stop station playback"); });
  expect(await queueToTunedStation([item("missing")])).toBe("handled");
  expect(mocks.clear).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("could not stop station playback"));
});

it("does not stop a different station after the confirmation dialog", async () => {
  mocks.video.mockResolvedValue({ success: false, error: { issues: [{ path: ["video_not_found"] }] } });
  mocks.confirm.mockImplementation(async () => {
    mocks.station = { peer_addr: "peer", station_id: "other-station", station_name: "other station" };
    return true;
  });
  expect(await queueToTunedStation([item("missing")])).toBe("handled");
  expect(mocks.clear).not.toHaveBeenCalled();
  expect(mocks.leave).not.toHaveBeenCalled();
  expect(mocks.info).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
});

it("leaves curated stations running when switching to local playback", async () => {
  mocks.stations.mockResolvedValue({ success: true, data: {
    stations: [{ station_id: "station", name: "station", accepts_requests: false }],
  } });
  mocks.confirm.mockResolvedValue(true);
  expect(await queueToTunedStation([item("video")])).toBe("local");
  expect(mocks.clear).not.toHaveBeenCalled();
  expect(mocks.leave).toHaveBeenCalledOnce();
});

it("preserves local queuing when there is no tuned station", async () => {
  mocks.station = null;
  expect(await queueToTunedStation([item("video")])).toBe("local");
  expect(mocks.stations).not.toHaveBeenCalled();
});
