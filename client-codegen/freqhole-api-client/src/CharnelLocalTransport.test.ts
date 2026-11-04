import { beforeEach, describe, expect, it, vi } from "vitest";
import { CharnelLocalTransport } from "./CharnelLocalTransport.js";
import { createUploadMethods } from "./domains/upload.js";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  convertFileSrc: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "p2p_import_begin") return "upload";
    if (command === "local_import_finish") return "/tmp/video.mp4";
    if (command === "api_call")
      return {
        success: true,
        data: {
          blob_id: "blob",
          job_id: "job",
          blake3: "a".repeat(64),
          size: 5,
          mime: "video/mp4",
          existing: false,
          message: "uploaded",
        },
      };
  });
});

describe("Charnel local video upload", () => {
  it("passes the send destination through bounded IPC upload into the local review request", async () => {
    const client = createUploadMethods(new CharnelLocalTransport(""));
    const result = await client.video(new File(["video"], "video.mp4"), undefined, {
      targetRemoteId: "dest",
      targetRemoteName: "library",
    });
    expect(result.success).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("p2p_import_chunk", {
      uploadId: "upload",
      data: "dmlkZW8=",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("api_call", {
      path: "/api/upload/video",
      body: {
        file_path: "/tmp/video.mp4",
        filename: "video.mp4",
        wait_for_completion: true,
        target_remote_id: "dest",
        target_remote_name: "library",
      },
    });
    expect(mocks.invoke).toHaveBeenLastCalledWith("local_import_cleanup", {
      filePath: "/tmp/video.mp4",
    });
  });
});
