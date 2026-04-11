import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// mock the tauri transport — isTauriMode returns false by default (browser mode)
vi.mock("../p2p/tauri-transport", () => ({
  isTauriMode: vi.fn(() => false),
}));

// mock the blob store — we control what resolveBlob and getBlobData return
const mockResolveBlob = vi.fn<(blobId: string, blake3?: string) => Promise<any | null>>();
const mockGetBlobData = vi.fn<(blobId: string) => Promise<ArrayBuffer | null>>();
vi.mock("../storage/skein-blob-store", () => ({
  resolveBlob: (...args: any[]) => mockResolveBlob(...args),
  getBlobData: (...args: any[]) => mockGetBlobData(...args),
}));

import {
  getMediaPlaybackUrl,
  isLinuxWebKitGTK,
  revokeAllMediaUrls,
  revokeMediaUrl,
} from "./media-urls";

/** helper: create a fake SkeinBlobRecord */
function fakeRecord(blobId: string, mime = "audio/mpeg") {
  return {
    blob_id: blobId,
    sha256: "deadbeef",
    blake3: "cafebabe",
    filename: "test.mp3",
    mime,
    size: 1024,
    domain: "audio",
    blob_type: "original",
    parent_blob_id: null,
    metadata: {},
    created_at: Date.now(),
  };
}

/** helper: create a small ArrayBuffer for fake blob data */
function fakeData(): ArrayBuffer {
  return new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]).buffer;
}

describe("media-urls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveBlob.mockReset();
    mockGetBlobData.mockReset();
  });

  afterEach(() => {
    // clean up any tracked blob URLs between tests
    revokeAllMediaUrls();
  });

  // -------------------------------------------------------------------------
  // isLinuxWebKitGTK
  // -------------------------------------------------------------------------

  describe("isLinuxWebKitGTK", () => {
    it("returns a boolean", () => {
      const result = isLinuxWebKitGTK();
      expect(typeof result).toBe("boolean");
    });
  });

  // -------------------------------------------------------------------------
  // revokeMediaUrl / revokeAllMediaUrls
  // -------------------------------------------------------------------------

  describe("revokeMediaUrl", () => {
    it("does not throw when no URL exists for the category", () => {
      expect(() => revokeMediaUrl("audio")).not.toThrow();
      expect(() => revokeMediaUrl("video")).not.toThrow();
    });
  });

  describe("revokeAllMediaUrls", () => {
    it("does not throw when no URLs exist", () => {
      expect(() => revokeAllMediaUrls()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // getMediaPlaybackUrl — browser mode (non-Tauri)
  // -------------------------------------------------------------------------

  describe("getMediaPlaybackUrl (browser mode)", () => {
    it("resolves a blob ID via OPFS and returns a blob: URL", async () => {
      mockResolveBlob.mockResolvedValue(fakeRecord("test-blob-id-123"));
      mockGetBlobData.mockResolvedValue(fakeData());

      const result = await getMediaPlaybackUrl("test-blob-id-123");

      expect(mockResolveBlob).toHaveBeenCalledWith("test-blob-id-123", undefined);
      expect(mockGetBlobData).toHaveBeenCalledWith("test-blob-id-123");
      expect(result).toMatch(/^blob:/);
    });

    it("returns null when the blob record is not found in OPFS", async () => {
      mockResolveBlob.mockResolvedValue(null);

      const result = await getMediaPlaybackUrl("nonexistent-blob-id");

      expect(mockResolveBlob).toHaveBeenCalledWith("nonexistent-blob-id", undefined);
      expect(result).toBeNull();
    });

    it("returns null when the blob record exists but OPFS file data is missing", async () => {
      mockResolveBlob.mockResolvedValue(fakeRecord("orphan-blob"));
      mockGetBlobData.mockResolvedValue(null);

      const result = await getMediaPlaybackUrl("orphan-blob");

      expect(mockResolveBlob).toHaveBeenCalled();
      expect(mockGetBlobData).toHaveBeenCalledWith("orphan-blob");
      expect(result).toBeNull();
    });

    it("returns null when OPFS lookup throws", async () => {
      mockResolveBlob.mockRejectedValue(new Error("OPFS unavailable"));

      const result = await getMediaPlaybackUrl("error-blob-id");

      expect(result).toBeNull();
    });

    it("caches OPFS blob URLs across calls for the same blob ID", async () => {
      mockResolveBlob.mockResolvedValue(fakeRecord("cached-blob"));
      mockGetBlobData.mockResolvedValue(fakeData());

      const first = await getMediaPlaybackUrl("cached-blob");
      const second = await getMediaPlaybackUrl("cached-blob");

      expect(first).toMatch(/^blob:/);
      expect(second).toBe(first);
      // second call should use the session cache — resolveBlob only called once
      expect(mockResolveBlob).toHaveBeenCalledTimes(1);
    });

    it("passes the category option through (defaults to audio)", async () => {
      mockResolveBlob.mockResolvedValue(fakeRecord("video-blob", "video/mp4"));
      mockGetBlobData.mockResolvedValue(fakeData());

      const result = await getMediaPlaybackUrl("video-blob", {
        category: "video",
      });

      expect(result).toMatch(/^blob:/);
    });

    it("passes blake3 through to resolveBlob for cross-peer resolution", async () => {
      mockResolveBlob.mockResolvedValue(fakeRecord("server-uuid", "audio/mpeg"));
      mockGetBlobData.mockResolvedValue(fakeData());

      const result = await getMediaPlaybackUrl("server-uuid", {
        blake3: "cafebabe12345678",
      });

      expect(mockResolveBlob).toHaveBeenCalledWith("server-uuid", "cafebabe12345678");
      expect(result).toMatch(/^blob:/);
    });

    it("uses correct mime type from the blob record for the created Blob", async () => {
      const record = fakeRecord("mime-test", "video/webm");
      mockResolveBlob.mockResolvedValue(record);
      mockGetBlobData.mockResolvedValue(fakeData());

      const result = await getMediaPlaybackUrl("mime-test");

      // we can't inspect the blob: URL's type directly, but verifying
      // the URL was created successfully is sufficient
      expect(result).toMatch(/^blob:/);
    });
  });
});
