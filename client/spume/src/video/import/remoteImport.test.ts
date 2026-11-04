import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteLike } from "../../app/api/client";
import { clearAllVideoJobs, getVideoUploadJobs, uploadVideoFilesToRemote } from "./remoteImport";

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  upload: vi.fn(async () => ({ success: true, data: { job_id: "job" } })),
  status: vi.fn(async () => ({
    success: true,
    data: {
      jobs: { job: { session_id: "session", result: JSON.stringify({ video_id: "video" }) } },
    },
  })),
}));
vi.mock("../../app/api/client", () => ({
  getClientForRemote: mocks.client,
}));
vi.mock("../../app/services/jobs/jobService", () => ({
  JobPoller: class {
    async waitForJob() {
      return { status: "completed" };
    }
  },
}));
vi.mock("../../music/data", () => ({
  getCurrentRemote: () => ({ remote_id: "browsed-remote" }),
  getCurrentUser: () => ({ user_id: "user" }),
}));
vi.mock("../../components/feedback/Toast", () => ({
  toast: { error: vi.fn(), info: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  clearAllVideoJobs();
  mocks.client.mockResolvedValue({
    upload: { video: mocks.upload },
    music: { getJobStatus: mocks.status },
  });
});

describe("Charnel video-file imports", () => {
  it("imports app File objects locally and resolves review before announcing completion", async () => {
    const local: RemoteLike = { remote_id: "local", is_charnel_managed: true };
    const resolved = vi.fn();
    const completed = vi.fn(() => {
      expect(resolved).toHaveBeenCalledWith("session");
      expect(getVideoUploadJobs()[0]).toMatchObject({
        status: "completed",
        remoteId: "local",
        sessionId: "session",
        videoId: "video",
      });
    });
    const file = new File(["video"], "video.mp4", { type: "video/mp4" });
    await uploadVideoFilesToRemote([file], completed, local, resolved, {
      remoteId: "destination",
      remoteName: "library",
    });
    await vi.waitFor(() => expect(completed).toHaveBeenCalledOnce());
    expect(mocks.client).toHaveBeenCalledExactlyOnceWith(local);
    expect(mocks.upload).toHaveBeenCalledWith(file, expect.any(Function), {
      targetRemoteId: "destination",
      targetRemoteName: "library",
    });
  });

  it("keeps a failed session lookup visible instead of reporting a completed reviewable upload", async () => {
    mocks.status.mockRejectedValueOnce(new Error("status unavailable"));
    const completed = vi.fn();
    await uploadVideoFilesToRemote([new File(["video"], "video.mp4")], completed, {
      remote_id: "local",
    });
    await vi.waitFor(() => expect(getVideoUploadJobs()[0].status).toBe("failed"));
    expect(completed).not.toHaveBeenCalled();
    expect(getVideoUploadJobs()[0].errorFull).toContain("status unavailable");
  });
});
