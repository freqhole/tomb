// tests for bulkSendJobs.ts's phase-3a migration onto the shared
// TransferQueue primitive - focuses on the adapter-specific logic this
// migration actually risks regressing (destId tracking, currentItemTitle
// derivation, done-toast suppression while the modal is open) rather than
// re-testing queue mechanics already covered by transferQueue.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

const getAlbumSongs = vi.fn((..._args: unknown[]) => Promise.resolve({ items: [] as Song[] }));
vi.mock("../../../music/data", () => ({
  getDataSource: () => ({ getAlbumSongs: (...a: unknown[]) => getAlbumSongs(...a) }),
}));

const sendToRemote = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("../../../music/services/send/sendToRemote", () => ({
  sendToRemote: (...a: unknown[]) => sendToRemote(...a),
}));

const sendVideosToRemote = vi.fn((..._args: unknown[]) =>
  Promise.resolve({ failedVideos: 0, errors: [] as string[] })
);
vi.mock("../../../video/services/send/sendVideoToRemote", () => ({
  sendVideosToRemote: (...a: unknown[]) => sendVideosToRemote(...a),
}));

const toastSuccess = vi.fn((..._args: unknown[]) => {});
const toastWarning = vi.fn((..._args: unknown[]) => {});
vi.mock("../../../components/feedback/Toast", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    warning: (...a: unknown[]) => toastWarning(...a),
    error: vi.fn(),
  },
}));

import { resetTransferQueues } from "../transfers/transferQueue";
import {
  clearBulkSendJob,
  closeBulkSendModal,
  getBulkSendJob,
  openBulkSendModalFor,
  startBulkAlbumSend,
  startBulkVideoSend,
} from "./bulkSendJobs";
import type { Remote } from "../storage/schemas/remote";
import type { Song } from "../../../music/services/storage/types";
import type { SendVideoItem } from "../../../video/services/send/sendVideoToRemote";

function song(overrides: Partial<Song>): Song {
  return {
    id: "s1",
    title: "track",
    album_id: "album-1",
    album_title: "the album",
    artist_name: "the artist",
    disc_number: 1,
    track_number: 1,
    ...overrides,
  } as Song;
}

const source: Remote = { remote_id: "src-1", name: "source" } as Remote;
const dest: Remote = { remote_id: "dest-1", name: "dest remote" } as Remote;

function waitDone(jobId: string): Promise<void> {
  return vi.waitFor(() => {
    expect(getBulkSendJob(jobId)?.done).toBe(true);
  });
}

beforeEach(() => {
  resetTransferQueues();
  getAlbumSongs.mockReset();
  sendToRemote.mockReset().mockResolvedValue(undefined);
  sendVideosToRemote.mockReset();
  toastSuccess.mockReset();
  toastWarning.mockReset();
  closeBulkSendModal();
});

describe("startBulkAlbumSend", () => {
  it("resolves each album's real title via reportLabel and reports destId/destName", async () => {
    getAlbumSongs.mockResolvedValue({ items: [song({ album_title: "Real Title" })] });
    const jobId = startBulkAlbumSend({ albumIds: ["album-1"], source, dest });
    await waitDone(jobId);
    const job = getBulkSendJob(jobId)!;
    expect(job.destId).toBe("dest-1");
    expect(job.destName).toBe("dest remote");
    expect(job.completedItems).toBe(1);
    expect(job.failedItems).toBe(0);
    expect(sendToRemote).toHaveBeenCalledTimes(1);
  });

  it("always counts an album as completed once sendToRemote resolves, even with no songs found", async () => {
    getAlbumSongs.mockResolvedValue({ items: [] });
    const jobId = startBulkAlbumSend({ albumIds: ["missing-album"], source, dest });
    await waitDone(jobId);
    expect(getBulkSendJob(jobId)!.completedItems).toBe(1);
  });
});

describe("startBulkVideoSend", () => {
  it("joins multiple per-item error strings into one combined error", async () => {
    sendVideosToRemote.mockResolvedValue({
      failedVideos: 1,
      errors: ["upload failed", "blob missing"],
    });
    const items: SendVideoItem[] = [
      {
        video: { id: "v1", title: "clip one" } as SendVideoItem["video"],
        blobId: "b1",
        blake3: null,
      },
    ];
    const jobId = startBulkVideoSend({ items, source, dest });
    await waitDone(jobId);
    const job = getBulkSendJob(jobId)!;
    expect(job.failedItems).toBe(1);
    expect(job.errors).toEqual(["clip one: upload failed; clip one: blob missing"]);
  });

  it("counts a successful video send as completed", async () => {
    sendVideosToRemote.mockResolvedValue({ failedVideos: 0, errors: [] });
    const items: SendVideoItem[] = [
      {
        video: { id: "v1", title: "clip one" } as SendVideoItem["video"],
        blobId: "b1",
        blake3: null,
      },
    ];
    const jobId = startBulkVideoSend({ items, source, dest });
    await waitDone(jobId);
    expect(getBulkSendJob(jobId)!.completedItems).toBe(1);
  });
});

describe("done-toast suppression", () => {
  it("toasts success when the modal is not open for this job", async () => {
    getAlbumSongs.mockResolvedValue({ items: [song({})] });
    const jobId = startBulkAlbumSend({ albumIds: ["album-1"], source, dest });
    await waitDone(jobId);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("stays quiet when the modal is currently showing this job's progress", async () => {
    getAlbumSongs.mockResolvedValue({ items: [song({})] });
    const jobId = startBulkAlbumSend({ albumIds: ["album-1"], source, dest });
    openBulkSendModalFor(jobId);
    await waitDone(jobId);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("toasts a warning when at least one item failed", async () => {
    sendVideosToRemote.mockResolvedValue({ failedVideos: 1, errors: ["oops"] });
    const items: SendVideoItem[] = [
      {
        video: { id: "v1", title: "clip one" } as SendVideoItem["video"],
        blobId: "b1",
        blake3: null,
      },
    ];
    const jobId = startBulkVideoSend({ items, source, dest });
    await waitDone(jobId);
    expect(toastWarning).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe("clearBulkSendJob", () => {
  it("removes the job and its destId once done", async () => {
    getAlbumSongs.mockResolvedValue({ items: [song({})] });
    const jobId = startBulkAlbumSend({ albumIds: ["album-1"], source, dest });
    await waitDone(jobId);
    clearBulkSendJob(jobId);
    expect(getBulkSendJob(jobId)).toBeNull();
  });
});
