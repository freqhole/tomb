// @vitest-environment jsdom
//
// regression tests for importVideoFiles's blake3 dedup pre-check - added
// alongside music's identical pattern (see music/import/localImport.test.ts)
// since local video import previously had NO duplicate detection at all:
// re-importing the same file just created a second row.
//
// extractVideoMetadata (the offscreen <video>/<canvas> pipeline) isn't
// mockable in isolation (it's a private, non-exported function called
// directly within this same module) and jsdom never fires real media
// events for a fake blob url - so `document.createElement("video")` is
// stubbed with a fake element whose `duration` is 0, which makes
// extractVideoMetadata resolve immediately without ever needing a
// "seeked" event or canvas frame capture.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isOPFSSupported = vi.fn(() => true);
const writeVideoToOPFS = vi.fn(async (_file: File, id: string) => `video/${id}.mp4`);
const writeVideoPosterToOPFS = vi.fn(async () => "video-posters/poster.jpg");
const addLocalVideo = vi.fn(async (input: Record<string, unknown>) => ({ ...input }));
const getVideoByBlake3 = vi.fn(async (_blake3: string): Promise<unknown> => undefined);
const isCharnelMode = vi.fn(() => false);
const hashBlake3Streaming = vi.fn(async (file: File) => `hash-${file.name}`);

vi.mock("../services/opfs/helpers", () => ({
  isOPFSSupported: (...a: unknown[]) => isOPFSSupported(...(a as [])),
  writeVideoToOPFS: (...a: unknown[]) => writeVideoToOPFS(...(a as [File, string])),
  writeVideoPosterToOPFS: (...a: unknown[]) => writeVideoPosterToOPFS(...(a as [])),
}));
vi.mock("../services/storage/db/videos", () => ({
  addLocalVideo: (...a: unknown[]) => addLocalVideo(...(a as [Record<string, unknown>])),
  getVideoByBlake3: (...a: unknown[]) => getVideoByBlake3(...(a as [string])),
}));
vi.mock("../../app/services/charnel", () => ({
  isCharnelMode: (...a: unknown[]) => isCharnelMode(...(a as [])),
}));
vi.mock("@freqhole/reliquary/worker", () => ({
  hashBlake3Streaming: (...a: unknown[]) => hashBlake3Streaming(...(a as [File])),
}));

import { importVideoFiles } from "./localImport";

class FakeVideoElement extends EventTarget {
  preload = "";
  muted = false;
  playsInline = false;
  duration = 0;
  videoWidth = 0;
  videoHeight = 0;
  currentTime = 0;
  set src(_value: string) {
    queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
  }
}

function fakeFile(name: string): File {
  return new File(["fake bytes"], name, { type: "video/mp4" });
}

let realCreateElement: typeof document.createElement;

beforeEach(() => {
  vi.clearAllMocks();
  isOPFSSupported.mockReturnValue(true);
  isCharnelMode.mockReturnValue(false);
  getVideoByBlake3.mockResolvedValue(undefined);
  hashBlake3Streaming.mockImplementation(async (file: File) => `hash-${file.name}`);
  realCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "video") return new FakeVideoElement() as unknown as HTMLVideoElement;
    return realCreateElement(tag);
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("importVideoFiles dedup", () => {
  it("skips a file whose blake3 already exists locally, without writing it to opfs", async () => {
    getVideoByBlake3.mockImplementation(async (blake3: string) =>
      blake3 === "hash-dup.mp4" ? { id: "existing-id" } : undefined
    );

    const result = await importVideoFiles([fakeFile("dup.mp4")]);

    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(0);
    expect(writeVideoToOPFS).not.toHaveBeenCalled();
    expect(addLocalVideo).not.toHaveBeenCalled();
  });

  it("imports a file whose blake3 has no existing match", async () => {
    const result = await importVideoFiles([fakeFile("new.mp4")]);

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(addLocalVideo).toHaveBeenCalledWith(
      expect.objectContaining({ blake3: "hash-new.mp4", file_name: "new.mp4" })
    );
  });

  it("imports two different files in the same batch instead of treating the second as a duplicate", async () => {
    const result = await importVideoFiles([fakeFile("a.mp4"), fakeFile("b.mp4")]);

    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
    expect(addLocalVideo).toHaveBeenCalledTimes(2);
  });

  it("never dedups on a null blake3 (hash failure)", async () => {
    hashBlake3Streaming.mockRejectedValue(new Error("out of memory"));

    const result = await importVideoFiles([fakeFile("unhashable.mp4")]);

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(getVideoByBlake3).not.toHaveBeenCalled();
    expect(addLocalVideo).toHaveBeenCalledWith(expect.objectContaining({ blake3: null }));
  });
});
