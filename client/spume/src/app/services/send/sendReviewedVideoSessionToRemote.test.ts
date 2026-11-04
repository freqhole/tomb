import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Remote } from "../storage/schemas/remote";
import type { SyncVideoByBlake3Request, Transport } from "@freqhole/api-client";
import { closeVideoDB } from "../../../video/services/storage/db/init";
import { closeMusicDB } from "../../../music/services/storage/db/init";
import { addLocalVideo, updateLocalVideo } from "../../../video/services/storage/db/videos";
import { localVideoDataSource } from "../../../video/data/local/localSource";
import {
  createLocalVideoImportSession,
  recordLocalVideoImport,
  markLocalVideoGroupReviewed,
} from "../../../video/services/storage/db/importReview";
import { getLocalBrowserSourceRemote } from "../../../music/services/send/localBrowserSource";
import {
  sendReviewedVideosToRemote,
  retryFailedVideoSend,
} from "./sendReviewedVideoSessionToRemote";

const mocks = vi.hoisted(() => ({
  remote: vi.fn<(id: string) => Promise<Remote | undefined>>(),
  client: vi.fn(),
  sourceRequest: vi.fn(),
  destRequest: vi.fn<Transport["request"]>(),
  importImage: vi.fn(async (_bytes: Uint8Array) => "c".repeat(64)),
  stageVideo: vi.fn(async (_hash: string, read: () => Promise<Blob | null>) => {
    if (!(await read())) throw new Error("missing video");
  }),
  readVideo: vi.fn(async (_path: string) => new File(["video bytes"], "video.mp4")),
  readPoster: vi.fn(
    async (_path: string) => new File(["poster bytes"], "poster.jpg", { type: "image/jpeg" })
  ),
  jobStatus: vi.fn(),
  jobEntities: vi.fn(),
  progress: vi.fn(),
}));
vi.mock("../remotes/remoteManager", () => ({ getRemoteById: mocks.remote }));
vi.mock("../../api/client", () => ({
  getClientForRemote: mocks.client,
  getLocalNodeIdAsync: async () => "a".repeat(64),
  getMiddenNode: async () => ({ import_blob: mocks.importImage }),
  getTransportForRemote: async (remote: Remote) => ({
    request: remote.remote_id === "dest" ? mocks.destRequest : mocks.sourceRequest,
  }),
  isP2PTransportType: (remote: Remote) => remote.transport === "wasm",
}));
vi.mock("../../../video/services/opfs/helpers", () => ({
  readVideoFromOPFS: mocks.readVideo,
  readVideoPosterFromOPFS: mocks.readPoster,
}));
vi.mock("../../../lib/api/blobServing", () => ({ ensureBlobServable: mocks.stageVideo }));
vi.mock("../../../video/import/remoteImport", () => ({
  addTrackedJob: () => "send-job",
  updateJobStatus: mocks.jobStatus,
  updateJobProgress: vi.fn(),
  updateJobEntities: mocks.jobEntities,
}));
vi.mock("../jobs/jobService", () => ({
  waitForJobResult: async () => ({ status: "completed" }),
}));
vi.mock("../../../components/feedback/Toast", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));

const requests: SyncVideoByBlake3Request[] = [];

beforeEach(async () => {
  vi.clearAllMocks();
  closeVideoDB();
  closeMusicDB();
  indexedDB = new IDBFactory();
  requests.length = 0;
  const dest = {
    ...(await getLocalBrowserSourceRemote()),
    remote_id: "dest",
    name: "library",
    peer_addr: "b".repeat(64),
  };
  mocks.remote.mockImplementation(async (id) => (id === "dest" ? dest : undefined));
  mocks.destRequest.mockImplementation(async (_method, path, body) => {
    if (path === "/api/blobz/has") {
      return {
        status: 200,
        body: JSON.stringify({ success: true, data: { blake3s_present: [] } }),
      };
    }
    if (path !== "/api/sync/video-by-blake3") throw new Error(`unexpected route: ${path}`);
    requests.push(JSON.parse(body!));
    return { status: 200, body: JSON.stringify({ success: true, data: { job_id: "sync-job" } }) };
  });
});
afterEach(() => {
  closeVideoDB();
  closeMusicDB();
});

async function localVideo(session: string, id = "video") {
  await addLocalVideo({
    id,
    title: id,
    opfs_path: `${id}.mp4`,
    poster_opfs_path: `${id}.jpg`,
    file_name: `${id}.mp4`,
    file_size: 11,
    mime_type: "video/mp4",
    blake3: id === "video" ? "d".repeat(64) : "e".repeat(64),
  });
  await recordLocalVideoImport(session, id);
}

describe("sending reviewed browser videos", () => {
  it("sends OPFS bytes and reviewed series/season/poster metadata without querying the browser as a remote API", async () => {
    const session = await createLocalVideoImportSession({
      remoteId: "dest",
      remoteName: "library",
    });
    await localVideo(session);
    const series = await localVideoDataSource.createVideoSeries({
      title: "reviewed series",
      description: "description",
    });
    const season = await localVideoDataSource.createVideoSeason({
      series_id: series.id,
      season_number: 3,
      title: "season three",
    });
    await updateLocalVideo("video", {
      series_id: series.id,
      season_id: season.id,
      episode_number: 7,
      content_type: "series",
    });
    await sendReviewedVideosToRemote(session, "dest", "library", null, ["video"], mocks.progress);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      blake3: "d".repeat(64),
      source_node_id: "a".repeat(64),
      series_title: "reviewed series",
      series_description: "description",
      season_number: 3,
      season_title: "season three",
      episode_number: 7,
      video_images: [{ blake3: "c".repeat(64), mime_type: "image/jpeg", is_primary: true }],
    });
    expect(mocks.stageVideo).toHaveBeenCalledWith("d".repeat(64), expect.any(Function));
    expect(mocks.readVideo).toHaveBeenCalledWith("video.mp4");
    expect(mocks.readPoster).toHaveBeenCalledWith("video.jpg");
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.sourceRequest).not.toHaveBeenCalled();
    expect(mocks.progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ done: true, failedAlbums: 0 })
    );
  });

  it("preserves reviewed music-video links and retries a failed browser send", async () => {
    const session = await createLocalVideoImportSession({
      remoteId: "dest",
      remoteName: "library",
    });
    await localVideo(session);
    await localVideoDataSource.updateVideo({
      video_id: "video",
      content_type: "music_video",
      artist_name: "artist",
      album_title: "album",
    });
    mocks.destRequest.mockRejectedValueOnce(new Error("offline"));
    // skip the optional /has lookup and fail the actual send.
    mocks.destRequest.mockRejectedValueOnce(new Error("offline"));
    await sendReviewedVideosToRemote(session, "dest", "library", null, ["video"], mocks.progress);
    expect(mocks.jobStatus).toHaveBeenLastCalledWith("send-job", "failed", expect.any(Object));
    await retryFailedVideoSend("send-job", "video", "dest", "library", null);
    expect(requests[0]).toMatchObject({
      content_type: "music_video",
      artist_name: "artist",
      album_title: "album",
    });
    expect(mocks.jobStatus).toHaveBeenLastCalledWith("send-job", "completed", undefined);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("includes earlier-reviewed videos when finishing a session after reopening", async () => {
    const session = await createLocalVideoImportSession({
      remoteId: "dest",
      remoteName: "library",
    });
    await localVideo(session);
    await localVideo(session, "second");
    await markLocalVideoGroupReviewed(session, "video");
    closeVideoDB();
    await sendReviewedVideosToRemote(session, "dest", "library", null, ["second"]);
    expect(requests.map((request) => request.title)).toEqual(["video", "second"]);
  });
});
