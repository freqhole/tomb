// @vitest-environment jsdom
// tests for resolving a playable url from the local video library.
// mirrors localAudio.test.ts - the OPFS/charnel split applies to video too.

import { beforeEach, describe, expect, it, vi } from "vitest";

const getLocalVideoById = vi.fn();
const readVideoFromOPFS = vi.fn();
const isCharnelMode = vi.fn(() => false);
const convertFileSrc = vi.fn((p: string) => `asset://localhost/${p}`);

vi.mock("./storage/db/videos", () => ({
  getLocalVideoById: (...a: unknown[]) => getLocalVideoById(...a),
}));
vi.mock("./opfs/helpers", () => ({
  readVideoFromOPFS: (...a: unknown[]) => readVideoFromOPFS(...a),
}));
vi.mock("../../app/services/charnel", () => ({
  isCharnelMode: () => isCharnelMode(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => convertFileSrc(p),
}));

import { resolveLocalVideoUrl } from "./localVideo";

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

  it("returns null without a local path rather than reading OPFS", async () => {
    expect(await resolveLocalVideoUrl("v1")).toBeNull();
    expect(getLocalVideoById).not.toHaveBeenCalled();
  });
});
