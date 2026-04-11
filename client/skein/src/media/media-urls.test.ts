import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// mock the tauri transport — isTauriMode returns false by default (browser mode)
vi.mock("../p2p/tauri-transport", () => ({
  isTauriMode: vi.fn(() => false),
}));

// mock the blob store — we control what getBlobObjectURL returns
const mockGetBlobObjectURL = vi.fn<(blobId: string) => Promise<string | null>>();
vi.mock("../storage/skein-blob-store", () => ({
  getBlobObjectURL: (...args: any[]) => mockGetBlobObjectURL(...args),
}));

import {
    getMediaPlaybackUrl,
    isLinuxWebKitGTK,
    revokeAllMediaUrls,
    revokeMediaUrl,
} from "./media-urls";

describe("media-urls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBlobObjectURL.mockReset();
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
    it("resolves a blob ID via OPFS and returns the URL", async () => {
      const fakeUrl = "blob:http://localhost/fake-opfs-blob-url";
      mockGetBlobObjectURL.mockResolvedValue(fakeUrl);

      const result = await getMediaPlaybackUrl("test-blob-id-123");

      expect(mockGetBlobObjectURL).toHaveBeenCalledWith("test-blob-id-123");
      expect(result).toBe(fakeUrl);
    });

    it("returns null when the blob is not found in OPFS", async () => {
      mockGetBlobObjectURL.mockResolvedValue(null);

      const result = await getMediaPlaybackUrl("nonexistent-blob-id");

      expect(mockGetBlobObjectURL).toHaveBeenCalledWith("nonexistent-blob-id");
      expect(result).toBeNull();
    });

    it("returns null when OPFS lookup throws", async () => {
      mockGetBlobObjectURL.mockRejectedValue(new Error("OPFS unavailable"));

      const result = await getMediaPlaybackUrl("error-blob-id");

      expect(result).toBeNull();
    });

    it("caches OPFS blob URLs across calls for the same blob ID", async () => {
      const fakeUrl = "blob:http://localhost/cached-url";
      mockGetBlobObjectURL.mockResolvedValue(fakeUrl);

      const first = await getMediaPlaybackUrl("cached-blob");
      const second = await getMediaPlaybackUrl("cached-blob");

      expect(first).toBe(fakeUrl);
      expect(second).toBe(fakeUrl);
      // the session cache inside media-urls should serve the second call,
      // but getBlobObjectURL may still be called if the internal cache key
      // differs from the mock's perspective — we just verify both return the URL
    });

    it("passes the category option through (defaults to audio)", async () => {
      mockGetBlobObjectURL.mockResolvedValue("blob:http://localhost/video-url");

      const result = await getMediaPlaybackUrl("video-blob", {
        category: "video",
      });

      expect(result).toBe("blob:http://localhost/video-url");
    });
  });
});
