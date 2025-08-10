import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  extractAlbumArt,
  processPlaylistCover,
  validateImageFile,
  cleanupImageUrl,
  createImageUrlFromData,
  createImageUrlsFromData,
  getImageUrlForContext,
} from "./imageService.js";

// Mock HTML elements and APIs
const mockCanvas = {
  width: 0,
  height: 0,
  getContext: vi.fn(),
  toBlob: vi.fn(),
  toDataURL: vi.fn(),
};

const mockCanvasContext = {
  fillStyle: "",
  fillRect: vi.fn(),
  drawImage: vi.fn(),
  createLinearGradient: vi.fn(() => ({
    addColorStop: vi.fn(),
  })),
};

const mockImage = {
  width: 400,
  height: 300,
  onload: null as any,
  onerror: null as any,
  src: "",
  crossOrigin: "",
};

// Mock global APIs
global.Image = vi.fn(() => mockImage) as any;
global.document = {
  createElement: vi.fn((tag: string) => {
    if (tag === "canvas") return mockCanvas;
    return {};
  }),
} as any;

global.URL = {
  createObjectURL: vi.fn(() => `blob:mock-url-${Math.random()}`),
  revokeObjectURL: vi.fn(),
} as any;

// Helper to create mock file
function createMockFile(
  content: string,
  filename: string,
  type: string = "image/jpeg"
): File {
  const file = new File([content], filename, { type });

  // Add arrayBuffer method
  Object.defineProperty(file, "arrayBuffer", {
    value: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    writable: true,
  });

  return file;
}

// Helper to create mock image data with ID3 tags
function createMockAudioFileWithID3(): ArrayBuffer {
  const buffer = new ArrayBuffer(1024);
  const view = new DataView(buffer);

  // Write ID3v2 header
  view.setUint8(0, 0x49); // 'I'
  view.setUint8(1, 0x44); // 'D'
  view.setUint8(2, 0x33); // '3'
  view.setUint8(3, 0x03); // Version 2.3
  view.setUint8(4, 0x00); // Revision
  view.setUint8(5, 0x00); // Flags

  // Tag size (synchsafe integer) - 100 bytes
  view.setUint8(6, 0x00);
  view.setUint8(7, 0x00);
  view.setUint8(8, 0x00);
  view.setUint8(9, 0x64);

  // Write APIC frame
  let offset = 10;

  // Frame ID "APIC"
  view.setUint8(offset++, 0x41); // 'A'
  view.setUint8(offset++, 0x50); // 'P'
  view.setUint8(offset++, 0x49); // 'I'
  view.setUint8(offset++, 0x43); // 'C'

  // Frame size (50 bytes)
  view.setUint8(offset++, 0x00);
  view.setUint8(offset++, 0x00);
  view.setUint8(offset++, 0x00);
  view.setUint8(offset++, 0x32);

  // Frame flags
  view.setUint8(offset++, 0x00);
  view.setUint8(offset++, 0x00);

  // Encoding
  view.setUint8(offset++, 0x00);

  // MIME type "image/jpeg\0"
  const mimeType = "image/jpeg";
  for (let i = 0; i < mimeType.length; i++) {
    view.setUint8(offset++, mimeType.charCodeAt(i));
  }
  view.setUint8(offset++, 0x00); // null terminator

  // Picture type
  view.setUint8(offset++, 0x03);

  // Description (empty)
  view.setUint8(offset++, 0x00);

  // Image data (mock JPEG header)
  view.setUint8(offset++, 0xff);
  view.setUint8(offset++, 0xd8);
  view.setUint8(offset++, 0xff);
  view.setUint8(offset++, 0xe0);

  return buffer;
}

describe("Image Service Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default canvas context mock
    mockCanvas.getContext.mockReturnValue(mockCanvasContext);
    mockCanvas.toBlob.mockImplementation((callback) => {
      const blob = new Blob(["fake image data"], { type: "image/jpeg" });
      if (callback) callback(blob);
    });
    mockCanvas.toDataURL.mockReturnValue("data:image/png;base64,fake-data");

    // Reset image mock
    mockImage.width = 400;
    mockImage.height = 300;
    mockImage.onload = null;
    mockImage.onerror = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("extractAlbumArt", () => {
    it("should extract album art from file with ID3 tags", async () => {
      const mockFile = createMockFile("fake audio", "test.mp3", "audio/mpeg");
      const mockBuffer = createMockAudioFileWithID3();

      vi.mocked(mockFile.arrayBuffer).mockResolvedValue(mockBuffer);

      const result = await extractAlbumArt(mockFile);

      expect(result.success).toBe(true);
      expect(result.albumArt).toBeDefined();
      expect(result.albumArt).toMatch(/^blob:/);
      expect(global.URL.createObjectURL).toHaveBeenCalled();
    });

    it("should handle file without ID3 tags", async () => {
      const mockFile = createMockFile("fake audio", "test.mp3", "audio/mpeg");
      const buffer = new ArrayBuffer(10);

      vi.mocked(mockFile.arrayBuffer).mockResolvedValue(buffer);

      const result = await extractAlbumArt(mockFile);

      expect(result.success).toBe(false);
      expect(result.error).toBe("No ID3v2 tag found");
    });

    it("should handle file too small for ID3 tags", async () => {
      const mockFile = createMockFile("fake", "test.mp3", "audio/mpeg");
      const buffer = new ArrayBuffer(5);

      vi.mocked(mockFile.arrayBuffer).mockResolvedValue(buffer);

      const result = await extractAlbumArt(mockFile);

      expect(result.success).toBe(false);
      expect(result.error).toBe("File too small to contain ID3 tags");
    });

    it("should handle files without APIC frame", async () => {
      const mockFile = createMockFile("fake audio", "test.mp3", "audio/mpeg");
      const buffer = new ArrayBuffer(100);
      const view = new DataView(buffer);

      // Write ID3v2 header without APIC frame
      view.setUint8(0, 0x49); // 'I'
      view.setUint8(1, 0x44); // 'D'
      view.setUint8(2, 0x33); // '3'
      view.setUint8(3, 0x03); // Version
      view.setUint8(4, 0x00); // Revision
      view.setUint8(5, 0x00); // Flags

      // Tag size
      view.setUint8(6, 0x00);
      view.setUint8(7, 0x00);
      view.setUint8(8, 0x00);
      view.setUint8(9, 0x50);

      vi.mocked(mockFile.arrayBuffer).mockResolvedValue(buffer);

      const result = await extractAlbumArt(mockFile);

      expect(result.success).toBe(false);
      expect(result.error).toBe("No album art found in ID3 tags");
    });

    it("should handle extraction errors", async () => {
      const mockFile = createMockFile("fake audio", "test.mp3", "audio/mpeg");

      vi.mocked(mockFile.arrayBuffer).mockRejectedValue(
        new Error("Read failed")
      );

      const result = await extractAlbumArt(mockFile);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Read failed");
    });
  });

  describe("processPlaylistCover", () => {
    it("should process valid image file successfully", async () => {
      const mockFile = createMockFile("fake image", "cover.jpg", "image/jpeg");

      // Mock successful image loading
      setTimeout(() => {
        if (mockImage.onload) {
          mockImage.onload();
        }
      }, 0);

      const result = await processPlaylistCover(mockFile);

      expect(result.success).toBe(true);
      expect(result.imageData).toBeDefined();
      expect(result.thumbnailData).toBeDefined();
      expect(result.metadata).toEqual({
        width: 400,
        height: 300,
        format: "image/jpeg",
        size: mockFile.size,
      });
    });

    it("should reject non-image files", async () => {
      const mockFile = createMockFile(
        "fake text",
        "document.txt",
        "text/plain"
      );

      const result = await processPlaylistCover(mockFile);

      expect(result.success).toBe(false);
      expect(result.error).toBe("File is not an image");
    });

    it("should reject files that are too large", async () => {
      const mockFile = createMockFile("fake image", "huge.jpg", "image/jpeg");
      Object.defineProperty(mockFile, "size", { value: 11 * 1024 * 1024 }); // 11MB

      const result = await processPlaylistCover(mockFile);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Image file too large (max 10MB)");
    });

    it("should handle image load errors", async () => {
      const mockFile = createMockFile(
        "fake image",
        "corrupted.jpg",
        "image/jpeg"
      );

      // Mock image load error
      setTimeout(() => {
        if (mockImage.onerror) {
          mockImage.onerror();
        }
      }, 0);

      const result = await processPlaylistCover(mockFile);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid image file");
    });

    it("should handle canvas context creation failure", async () => {
      const mockFile = createMockFile("fake image", "test.jpg", "image/jpeg");

      // Mock canvas context failure
      mockCanvas.getContext.mockReturnValue(null);

      setTimeout(() => {
        if (mockImage.onload) {
          mockImage.onload();
        }
      }, 0);

      const result = await processPlaylistCover(mockFile);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Cannot create canvas context");
    });

    it("should handle blob creation failure", async () => {
      const mockFile = createMockFile("fake image", "test.jpg", "image/jpeg");

      // Mock canvas toBlob failure
      mockCanvas.toBlob.mockImplementation((callback) => {
        if (callback) callback(null);
      });

      setTimeout(() => {
        if (mockImage.onload) {
          mockImage.onload();
        }
      }, 0);

      const result = await processPlaylistCover(mockFile);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Failed to create thumbnail data");
    });
  });

  describe("validateImageFile", () => {
    it("should validate supported image types", () => {
      const jpegFile = createMockFile("fake", "test.jpg", "image/jpeg");
      const pngFile = createMockFile("fake", "test.png", "image/png");
      const gifFile = createMockFile("fake", "test.gif", "image/gif");
      const webpFile = createMockFile("fake", "test.webp", "image/webp");

      expect(validateImageFile(jpegFile)).toEqual({ valid: true });
      expect(validateImageFile(pngFile)).toEqual({ valid: true });
      expect(validateImageFile(gifFile)).toEqual({ valid: true });
      expect(validateImageFile(webpFile)).toEqual({ valid: true });
    });

    it("should reject unsupported file types", () => {
      const textFile = createMockFile("fake", "test.txt", "text/plain");
      const bmpFile = createMockFile("fake", "test.bmp", "image/bmp");

      expect(validateImageFile(textFile)).toEqual({
        valid: false,
        error: "Unsupported image format. Use JPEG, PNG, GIF, or WebP.",
      });

      expect(validateImageFile(bmpFile)).toEqual({
        valid: false,
        error: "Unsupported image format. Use JPEG, PNG, GIF, or WebP.",
      });
    });

    it("should reject files that are too large", () => {
      const largeFile = createMockFile("fake", "huge.jpg", "image/jpeg");
      Object.defineProperty(largeFile, "size", { value: 11 * 1024 * 1024 }); // 11MB

      expect(validateImageFile(largeFile)).toEqual({
        valid: false,
        error: "Image file too large. Maximum size is 10MB.",
      });
    });

    it("should accept files at the size limit", () => {
      const maxSizeFile = createMockFile("fake", "max.jpg", "image/jpeg");
      Object.defineProperty(maxSizeFile, "size", { value: 10 * 1024 * 1024 }); // 10MB

      expect(validateImageFile(maxSizeFile)).toEqual({ valid: true });
    });
  });

  describe("cleanupImageUrl", () => {
    it("should revoke blob URLs", () => {
      const blobUrl = "blob:http://localhost/fake-url";

      cleanupImageUrl(blobUrl);

      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith(blobUrl);
    });

    it("should not revoke non-blob URLs", () => {
      const httpUrl = "http://example.com/image.jpg";
      const dataUrl = "data:image/jpeg;base64,fake-data";

      cleanupImageUrl(httpUrl);
      cleanupImageUrl(dataUrl);

      expect(global.URL.revokeObjectURL).not.toHaveBeenCalled();
    });
  });

  describe("createImageUrlFromData", () => {
    it("should create blob URL from image data", () => {
      const imageData = new ArrayBuffer(8);
      const mimeType = "image/png";

      const url = createImageUrlFromData(imageData, mimeType);

      expect(url).toMatch(/^blob:/);
      expect(global.URL.createObjectURL).toHaveBeenCalled();

      // Verify blob was created with correct type
      const calls = vi.mocked(global.URL.createObjectURL).mock.calls;
      expect(calls).toHaveLength(1);
      const blob = calls[0]![0] as Blob;
      expect(blob.type).toBe(mimeType);
    });

    it("should use default JPEG type when not specified", () => {
      const imageData = new ArrayBuffer(8);

      createImageUrlFromData(imageData);

      const calls = vi.mocked(global.URL.createObjectURL).mock.calls;
      expect(calls).toHaveLength(1);
      const blob = calls[0]![0] as Blob;
      expect(blob.type).toBe("image/jpeg");
    });
  });

  describe("createImageUrlsFromData", () => {
    it("should create URLs for both thumbnail and full-size images", () => {
      const thumbnailData = new ArrayBuffer(4);
      const fullSizeData = new ArrayBuffer(8);
      const mimeType = "image/png";

      const result = createImageUrlsFromData(
        thumbnailData,
        fullSizeData,
        mimeType
      );

      expect(result.thumbnailUrl).toMatch(/^blob:/);
      expect(result.fullSizeUrl).toMatch(/^blob:/);
      expect(global.URL.createObjectURL).toHaveBeenCalledTimes(2);

      // Verify both blobs were created with correct type
      const calls = vi.mocked(global.URL.createObjectURL).mock.calls;
      expect(calls).toHaveLength(2);
      expect((calls[0]![0] as Blob).type).toBe(mimeType);
      expect((calls[1]![0] as Blob).type).toBe(mimeType);
    });
  });

  describe("getImageUrlForContext", () => {
    const thumbnailData = new ArrayBuffer(4);
    const fullSizeData = new ArrayBuffer(8);
    const mimeType = "image/jpeg";

    it("should return full-size image for background context", () => {
      const url = getImageUrlForContext(
        thumbnailData,
        fullSizeData,
        mimeType,
        "background"
      );

      expect(url).toMatch(/^blob:/);
      // Should prefer full-size for background
      const calls = vi.mocked(global.URL.createObjectURL).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const blob = calls[0]![0] as Blob;
      expect(blob.size).toBe(8); // full-size data size
    });

    it("should return full-size image for modal context", () => {
      const url = getImageUrlForContext(
        thumbnailData,
        fullSizeData,
        mimeType,
        "modal"
      );

      expect(url).toMatch(/^blob:/);
      // Should prefer full-size for modal
      const calls = vi.mocked(global.URL.createObjectURL).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const blob = calls[0]![0] as Blob;
      expect(blob.size).toBe(8); // full-size data size
    });

    it("should return thumbnail for thumbnail context", () => {
      const url = getImageUrlForContext(
        thumbnailData,
        fullSizeData,
        mimeType,
        "thumbnail"
      );

      expect(url).toMatch(/^blob:/);
      // Should prefer thumbnail for thumbnail context
      const calls = vi.mocked(global.URL.createObjectURL).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const blob = calls[0]![0] as Blob;
      expect(blob.size).toBe(4); // thumbnail data size
    });

    it("should fallback to thumbnail when full-size not available", () => {
      const url = getImageUrlForContext(
        thumbnailData,
        undefined,
        mimeType,
        "background"
      );

      expect(url).toMatch(/^blob:/);
      const calls = vi.mocked(global.URL.createObjectURL).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const blob = calls[0]![0] as Blob;
      expect(blob.size).toBe(4); // thumbnail data size
    });

    it("should fallback to full-size when thumbnail not available", () => {
      const url = getImageUrlForContext(
        undefined,
        fullSizeData,
        mimeType,
        "thumbnail"
      );

      expect(url).toMatch(/^blob:/);
      const calls = vi.mocked(global.URL.createObjectURL).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const blob = calls[0]![0] as Blob;
      expect(blob.size).toBe(8); // full-size data size
    });

    it("should return null when no data available", () => {
      const url = getImageUrlForContext(undefined, undefined, mimeType);

      expect(url).toBeNull();
      expect(global.URL.createObjectURL).not.toHaveBeenCalled();
    });

    it("should return null when no mime type provided", () => {
      const url = getImageUrlForContext(thumbnailData, fullSizeData, undefined);

      expect(url).toBeNull();
      expect(global.URL.createObjectURL).not.toHaveBeenCalled();
    });

    it("should default to thumbnail context when not specified", () => {
      const url = getImageUrlForContext(thumbnailData, fullSizeData, mimeType);

      expect(url).toMatch(/^blob:/);
      const calls = vi.mocked(global.URL.createObjectURL).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const blob = calls[0]![0] as Blob;
      expect(blob.size).toBe(4); // thumbnail data size (default behavior)
    });
  });

  describe("Error Handling", () => {
    it("should handle unexpected errors in extractAlbumArt", async () => {
      const mockFile = createMockFile("fake", "test.mp3", "audio/mpeg");

      // Mock unexpected error
      vi.mocked(mockFile.arrayBuffer).mockImplementation(() => {
        throw new Error("Unexpected error");
      });

      const result = await extractAlbumArt(mockFile);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Unexpected error");
    });

    it("should handle unexpected errors in processPlaylistCover", async () => {
      const mockFile = createMockFile("fake", "test.jpg", "image/jpeg");

      // Mock unexpected error during array buffer reading
      vi.mocked(mockFile.arrayBuffer).mockRejectedValue(
        new Error("Buffer read failed")
      );

      const result = await processPlaylistCover(mockFile);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Buffer read failed");
    });
  });

  describe("Edge Cases", () => {
    it("should handle very small images", async () => {
      const mockFile = createMockFile("tiny", "tiny.jpg", "image/jpeg");

      // Mock tiny image dimensions
      mockImage.width = 50;
      mockImage.height = 50;

      setTimeout(() => {
        if (mockImage.onload) {
          mockImage.onload();
        }
      }, 0);

      const result = await processPlaylistCover(mockFile);

      expect(result.success).toBe(true);
      expect(result.metadata?.width).toBe(50);
      expect(result.metadata?.height).toBe(50);
    });

    it("should handle square images", async () => {
      const mockFile = createMockFile("square", "square.jpg", "image/jpeg");

      mockImage.width = 300;
      mockImage.height = 300;

      setTimeout(() => {
        if (mockImage.onload) {
          mockImage.onload();
        }
      }, 0);

      const result = await processPlaylistCover(mockFile);

      expect(result.success).toBe(true);
      expect(result.metadata?.width).toBe(300);
      expect(result.metadata?.height).toBe(300);
    });

    it("should handle landscape images", async () => {
      const mockFile = createMockFile("landscape", "wide.jpg", "image/jpeg");

      mockImage.width = 800;
      mockImage.height = 400;

      setTimeout(() => {
        if (mockImage.onload) {
          mockImage.onload();
        }
      }, 0);

      const result = await processPlaylistCover(mockFile);

      expect(result.success).toBe(true);
      expect(result.metadata?.width).toBe(800);
      expect(result.metadata?.height).toBe(400);
    });
  });
});
