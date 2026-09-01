// @vitest-environment jsdom
// tests for resolving a playable url from the local library.
//
// the library is OPFS in the browser and grimoire's filesystem under charnel.
// the previous local-first playback fix only handled OPFS, so charnel kept
// re-fetching songs it already had on disk.

import { beforeEach, describe, expect, it, vi } from "vitest";

const getSongBySha256 = vi.fn();
const readAudioFromOPFS = vi.fn();
const isCharnelMode = vi.fn(() => false);
const convertFileSrc = vi.fn((p: string) => `asset://localhost/${p}`);

vi.mock("./db/songs", () => ({
  getSongBySha256: (...a: unknown[]) => getSongBySha256(...a),
}));
vi.mock("../opfs/helpers", () => ({
  readAudioFromOPFS: (...a: unknown[]) => readAudioFromOPFS(...a),
}));
vi.mock("../../../app/services/charnel", () => ({
  isCharnelMode: () => isCharnelMode(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => convertFileSrc(p),
}));

import { resolveLocalAudioUrl } from "./localAudio";

beforeEach(() => {
  vi.clearAllMocks();
  isCharnelMode.mockReturnValue(false);
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:local-copy",
    revokeObjectURL: () => {},
  });
});

describe("resolveLocalAudioUrl in the browser", () => {
  it("returns an object url for a song in the library", async () => {
    getSongBySha256.mockResolvedValue({ opfs_path: "audio/abc.mp3" });
    readAudioFromOPFS.mockResolvedValue(new Blob(["x"]));
    expect(await resolveLocalAudioUrl("abc")).toBe("blob:local-copy");
  });

  it("returns null when the song is not in the library", async () => {
    getSongBySha256.mockResolvedValue(undefined);
    expect(await resolveLocalAudioUrl("abc")).toBeNull();
  });

  it("returns null when the library row has no opfs path", async () => {
    getSongBySha256.mockResolvedValue({ opfs_path: null });
    expect(await resolveLocalAudioUrl("abc")).toBeNull();
  });

  // a corrupt/missing local file should degrade to streaming, not hard-fail
  it("returns null when the opfs read throws", async () => {
    getSongBySha256.mockResolvedValue({ opfs_path: "audio/abc.mp3" });
    readAudioFromOPFS.mockRejectedValue(new Error("gone"));
    expect(await resolveLocalAudioUrl("abc")).toBeNull();
  });
});

describe("resolveLocalAudioUrl under charnel", () => {
  beforeEach(() => isCharnelMode.mockReturnValue(true));

  it("converts a local fs path into a playable asset url", async () => {
    expect(await resolveLocalAudioUrl("abc", "/var/lib/freqhole/abc.mp3")).toBe(
      "asset://localhost//var/lib/freqhole/abc.mp3"
    );
  });

  it("returns null without a local path rather than reading OPFS", async () => {
    expect(await resolveLocalAudioUrl("abc")).toBeNull();
    expect(getSongBySha256).not.toHaveBeenCalled();
  });

  it("does not touch OPFS even when a path is supplied", async () => {
    await resolveLocalAudioUrl("abc", "/tmp/abc.mp3");
    expect(readAudioFromOPFS).not.toHaveBeenCalled();
  });
});
