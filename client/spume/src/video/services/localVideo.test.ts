// @vitest-environment jsdom
// tests for resolving a playable url from the local video library.
// mirrors localAudio.test.ts - the OPFS/charnel split applies to video too.

import { beforeEach, describe, expect, it, vi } from "vitest";

const getLocalVideoById = vi.fn();
const readVideoFromOPFS = vi.fn();
const isCharnelMode = vi.fn(() => false);
const convertFileSrc = vi.fn((p: string) => `asset://localhost/${p}`);
const syncVideoToLocal = vi.fn(async () => ({ success: false }) as Record<string, unknown>);
const invoke = vi.fn();

vi.mock("./storage/db/videos", () => ({
  getLocalVideoById: (...a: unknown[]) => getLocalVideoById(...a),
}));
vi.mock("./opfs/helpers", () => ({
  readVideoFromOPFS: (...a: unknown[]) => readVideoFromOPFS(...a),
}));
// pulls in the midden wasm module transitively, which vitest cannot resolve
vi.mock("./sync/syncVideoToLocal", () => ({
  syncVideoToLocal: (...a: unknown[]) => syncVideoToLocal(...(a as [])),
}));
vi.mock("../../app/services/charnel", () => ({
  isCharnelMode: () => isCharnelMode(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => convertFileSrc(p),
  invoke: (...a: unknown[]) => invoke(...(a as [])),
}));

import { resolveLocalVideoUrl, resolveLocalVideoPath } from "./localVideo";

beforeEach(() => {
  vi.clearAllMocks();
  isCharnelMode.mockReturnValue(false);
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:local-video",
    revokeObjectURL: () => {},
  });
});

describe("resolveLocalVideoUrl in the browser", () => {
  it("returns an object url for a video in the library", async () => {
    getLocalVideoById.mockResolvedValue({ opfs_path: "video/v1.mp4" });
    readVideoFromOPFS.mockResolvedValue(new Blob(["x"]));
    expect(await resolveLocalVideoUrl("v1")).toBe("blob:local-video");
  });

  it("returns null when the video is not in the library", async () => {
    getLocalVideoById.mockResolvedValue(undefined);
    expect(await resolveLocalVideoUrl("v1")).toBeNull();
  });

  it("returns null when the opfs read throws", async () => {
    getLocalVideoById.mockResolvedValue({ opfs_path: "video/v1.mp4" });
    readVideoFromOPFS.mockRejectedValue(new Error("gone"));
    expect(await resolveLocalVideoUrl("v1")).toBeNull();
  });
});

describe("resolveLocalVideoUrl under charnel", () => {
  beforeEach(() => isCharnelMode.mockReturnValue(true));

  it("converts a local fs path into a playable asset url", async () => {
    expect(await resolveLocalVideoUrl("v1", "/var/lib/freqhole/v1.mp4")).toBe(
      "asset://localhost//var/lib/freqhole/v1.mp4"
    );
  });

  it("buffers an asset url into a blob url for the HTML video fallback", async () => {
    const fetch = vi.fn(async () => new Response(new Blob(["video"]), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    expect(await resolveLocalVideoUrl("v1", "/var/lib/freqhole/v1.mp4", true)).toBe(
      "blob:local-video"
    );
    expect(fetch).toHaveBeenCalledWith("asset://localhost//var/lib/freqhole/v1.mp4");
  });

  it("returns null when buffering the asset url fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 }))
    );
    expect(await resolveLocalVideoUrl("v1", "/var/lib/freqhole/v1.mp4", true)).toBeNull();
  });

  it("returns null without a local path rather than reading OPFS", async () => {
    expect(await resolveLocalVideoUrl("v1")).toBeNull();
    expect(getLocalVideoById).not.toHaveBeenCalled();
  });
});

// gstreamer opens a real file, so an asset:// url or an OPFS object url is no
// use to it - the video window needs a filesystem path or nothing.
describe("resolveLocalVideoPath", () => {
  function video(over: Record<string, unknown> = {}) {
    return { id: "v1", title: "v", source_type: "remote", ...over } as never;
  }

  it("returns null in the browser, which has no filesystem library", async () => {
    isCharnelMode.mockReturnValue(false);
    expect(await resolveLocalVideoPath(video())).toBeNull();
  });

  describe("under charnel", () => {
    beforeEach(() => isCharnelMode.mockReturnValue(true));

    it("uses a locally-imported video's own path", async () => {
      const v = video({ source_type: "local", opfs_path: "/media/v1.mp4" });
      expect(await resolveLocalVideoPath(v)).toBe("/media/v1.mp4");
      expect(syncVideoToLocal).not.toHaveBeenCalled();
    });

    it("resolves a library video's media blob to a filesystem path", async () => {
      invoke.mockResolvedValue({ path: "/library/video.mp4" });
      const v = video({ source_type: "synced", media_blob_id: "local-blob" });
      expect(await resolveLocalVideoPath(v)).toBe("/library/video.mp4");
      expect(invoke).toHaveBeenCalledWith("resolve_blob_path", { blobId: "local-blob" });
    });

    it("returns null when grimoire cannot resolve the local blob", async () => {
      invoke.mockRejectedValue(new Error("not found"));
      const v = video({ source_type: "synced", media_blob_id: "local-blob" });
      expect(await resolveLocalVideoPath(v)).toBeNull();
    });

    it("syncs a remote video and uses the path grimoire reports", async () => {
      syncVideoToLocal.mockResolvedValue({ success: true, localPath: "/lib/v1.mp4" });
      expect(await resolveLocalVideoPath(video())).toBe("/lib/v1.mp4");
    });

    it("returns null when the sync fails, so the caller can fall back", async () => {
      syncVideoToLocal.mockResolvedValue({ success: false, error: "peer unreachable" });
      expect(await resolveLocalVideoPath(video())).toBeNull();
    });

    // a sync that succeeds without a path means there is nothing to open
    it("returns null when the sync reports no path", async () => {
      syncVideoToLocal.mockResolvedValue({ success: true });
      expect(await resolveLocalVideoPath(video())).toBeNull();
    });
  });
});
