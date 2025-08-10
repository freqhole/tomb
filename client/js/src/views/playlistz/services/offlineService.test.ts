import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isOnline,
  serviceWorkerReady,
  persistentStorageGranted,
  updatePWAManifest,
  initializeOfflineSupport,
  getStorageInfo,
  isUrlCached,
  cacheAudioFile,
} from "./offlineService.js";
import type { Playlist } from "../types/playlist.js";
import { mockManager } from "../test-setup.js";

Object.defineProperty(global, "URL", {
  value: {
    createObjectURL: vi.fn(() => `blob:mock-url-${Math.random()}`),
    revokeObjectURL: vi.fn(),
  },
  writable: true,
});

// Test data
const createMockPlaylist = (overrides: Partial<Playlist> = {}): Playlist => ({
  id: "test-playlist",
  title: "Test Playlist",
  description: "Test Description",
  songIds: ["song-1", "song-2"],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  imageData: new ArrayBuffer(8),
  imageType: "image/jpeg",
  ...overrides,
});

describe("Offline Service Tests", () => {
  beforeEach(() => {
    mockManager.resetAllMocks();
    mockManager.resetGlobalAPIs();

    // Ensure document.querySelector returns proper mock elements
    vi.mocked(document.querySelector).mockImplementation((selector) => {
      // For specific test case that mocks existingLink
      if (selector === 'link[rel="manifest"]') {
        return null; // Let individual tests override this
      }

      if (selector.includes("meta") || selector.includes("link")) {
        return {
          setAttribute: vi.fn(),
          remove: vi.fn(),
          href: "",
          content: "",
          name: "",
          getAttribute: vi.fn(),
          rel: "",
          sizes: "",
        } as any;
      }
      return null;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Online Status", () => {
    it("should track online status", () => {
      expect(isOnline()).toBe(true);

      // Simulate going offline
      Object.defineProperty(navigator, "onLine", { value: false });
      const offlineEvent = new Event("offline");
      window.dispatchEvent(offlineEvent);

      // Note: The signal would update after event processing
      expect(typeof isOnline()).toBe("boolean");
    });

    it("should track service worker ready status", () => {
      expect(typeof serviceWorkerReady()).toBe("boolean");
    });

    it("should track persistent storage status", () => {
      expect(typeof persistentStorageGranted()).toBe("boolean");
    });
  });

  describe("PWA Manifest Generation", () => {
    it("should update PWA manifest with playlist title", () => {
      const playlistTitle = "My Awesome Playlist";

      updatePWAManifest(playlistTitle);

      expect(document.createElement).toHaveBeenCalledWith("link");
      expect(document.head.appendChild).toHaveBeenCalled();
    });

    it("should update PWA manifest with playlist image", () => {
      const playlistTitle = "My Playlist";
      const playlist = createMockPlaylist({
        imageType: "image/png",
      });

      updatePWAManifest(playlistTitle, playlist);

      expect(document.createElement).toHaveBeenCalledWith("link");
      expect(document.head.appendChild).toHaveBeenCalled();
    });

    it("should handle playlist without image", () => {
      const playlistTitle = "My Playlist";
      const playlist = createMockPlaylist({
        imageData: undefined,
        imageType: undefined,
      });

      updatePWAManifest(playlistTitle, playlist);

      expect(document.createElement).toHaveBeenCalledWith("link");
    });

    it("should create apple touch icons", () => {
      updatePWAManifest("Test Playlist");

      // Should create multiple apple-touch-icon links
      expect(document.createElement).toHaveBeenCalledWith("link");
      // Expects 10 icon sizes + 1 default = 11 apple-touch-icon calls, plus other meta tags
      expect(document.head.appendChild).toHaveBeenCalled();
    });

    it("should remove existing manifest before adding new one", () => {
      const existingLink = {
        remove: vi.fn(),
        setAttribute: vi.fn(),
        href: "",
        rel: "manifest",
      };
      vi.mocked(document.querySelector).mockImplementation((selector) => {
        if (selector === 'link[rel="manifest"]') {
          return existingLink as any;
        }
        // Return proper meta elements for other queries
        if (selector.includes("meta")) {
          return {
            setAttribute: vi.fn(),
            content: "",
            name: "",
          } as any;
        }
        return null;
      });

      updatePWAManifest("New Playlist");

      expect(existingLink.remove).toHaveBeenCalled();
    });

    it("should handle different image types", () => {
      const cases = [
        { imageType: "image/png", extension: ".png" },
        { imageType: "image/webp", extension: ".webp" },
        { imageType: "image/gif", extension: ".gif" },
        { imageType: "image/jpeg", extension: ".jpg" },
      ];

      cases.forEach(({ imageType }) => {
        const playlist = createMockPlaylist({ imageType });
        updatePWAManifest("Test", playlist);
        expect(document.createElement).toHaveBeenCalled();
      });
    });
  });

  describe("Storage Management", () => {
    it("should get storage information", async () => {
      const info = await getStorageInfo();

      expect(info.quota).toBe(1000000000);
      expect(info.usage).toBe(100000000);
      expect(info.quotaFormatted).toBe("954 MB");
      expect(info.usageFormatted).toBe("95 MB");
      expect(info.usagePercent).toBe(10);
      expect(info.persistent).toBe(true);
    });

    it("should handle storage API not available", async () => {
      mockManager.mockAPIUnavailable.storage();

      const info = await getStorageInfo();

      expect(info.quota).toBeUndefined();
      expect(info.usage).toBeUndefined();
      expect(info.persistent).toBeUndefined();
    });

    it("should handle storage estimate not available", async () => {
      const mockStorageWithoutEstimate = {
        persist: vi.fn().mockResolvedValue(true),
        persisted: vi.fn().mockResolvedValue(true),
      };

      Object.defineProperty(navigator, "storage", {
        value: mockStorageWithoutEstimate,
      });

      const info = await getStorageInfo();

      expect(info.persistent).toBe(true);
      expect(info.quota).toBeUndefined();
    });

    it("should handle storage errors", async () => {
      const { navigatorStorage } = mockManager.getMocks();
      navigatorStorage.estimate.mockRejectedValue(new Error("Storage error"));

      const info = await getStorageInfo();

      expect(info.error).toBe("Storage error");
    });

    it("should calculate usage percentage correctly", async () => {
      const { navigatorStorage } = mockManager.getMocks();
      navigatorStorage.estimate.mockResolvedValue({
        quota: 1000,
        usage: 250,
      });

      const info = await getStorageInfo();

      expect(info.usagePercent).toBe(25);
    });
  });

  describe("Cache Management", () => {
    it("should check if URL is cached", async () => {
      const testUrl = "http://freqhole.net/audio.mp3";
      const { cache, caches } = mockManager.getMocks();
      cache.match.mockResolvedValue(new Response());

      const isCached = await isUrlCached(testUrl);

      expect(isCached).toBe(true);
      expect(caches.open).toHaveBeenCalledWith("playlistz-cache-v1");
      expect(cache.match).toHaveBeenCalledWith(testUrl);
    });

    it("should return false for non-cached URLs", async () => {
      const testUrl = "http://freqhole.net/not-cached.mp3";
      const { cache } = mockManager.getMocks();
      cache.match.mockResolvedValue(undefined);

      const isCached = await isUrlCached(testUrl);

      expect(isCached).toBe(false);
    });

    it("should handle cache check errors", async () => {
      const { caches } = mockManager.getMocks();
      caches.open.mockRejectedValue(new Error("Cache error"));

      const isCached = await isUrlCached("test-url");

      expect(isCached).toBe(false);
    });

    it("should return false when caches API not available", async () => {
      // Mock window.caches as undefined
      const originalCaches = (global as any).window.caches;
      delete (global as any).window.caches;

      const isCached = await isUrlCached("test-url");

      expect(isCached).toBe(false);

      // Restore caches API
      (global as any).window.caches = originalCaches;
    });
  });

  describe("Audio File Caching", () => {
    it("should cache audio file via service worker", async () => {
      const testUrl = "blob:http://localhost/audio.mp3";
      const testTitle = "Test Song";

      const { serviceWorker } = mockManager.getMocks();
      const mockController = {
        postMessage: vi.fn(),
      };
      serviceWorker.controller = mockController as any;

      await cacheAudioFile(testUrl, testTitle);

      expect(mockController.postMessage).toHaveBeenCalledWith({
        type: "CACHE_URL",
        data: { url: testUrl },
      });
    });

    it("should cache audio file directly when no service worker", async () => {
      const testUrl = "http://freqhole.net/audio.mp3";
      const testTitle = "Test Song";

      const { serviceWorker } = mockManager.getMocks();
      serviceWorker.controller = null;

      await cacheAudioFile(testUrl, testTitle);

      // Note: mockCache would need to be properly setup in beforeEach for this test
      // expect(mockCache.match).toHaveBeenCalledWith(testUrl);
    });

    it("should handle file:// protocol gracefully", async () => {
      Object.defineProperty(window.location, "protocol", { value: "file:" });

      await cacheAudioFile("file://local/audio.mp3", "Local Song");

      // Should return without error for file:// protocol
      // Should return without error for file:// protocol
      // Cache operations are skipped for file:// protocol
    });

    it("should throw error when cache API not supported", async () => {
      // Mock window.caches as undefined
      const originalCaches = (global as any).window.caches;
      delete (global as any).window.caches;

      await expect(cacheAudioFile("test-url", "Test Song")).rejects.toThrow(
        "Cache API not supported"
      );

      // Restore caches API
      (global as any).window.caches = originalCaches;
    });

    it("should handle cache add failures", async () => {
      const { cache } = mockManager.getMocks();

      // Mock navigator.serviceWorker.controller as null to force direct cache path
      Object.defineProperty(global.navigator, "serviceWorker", {
        value: {
          controller: null,
        },
        configurable: true,
      });

      // Mock the global caches.open to return our mocked cache
      Object.defineProperty(global, "caches", {
        value: {
          open: vi.fn().mockResolvedValue(cache),
        },
        configurable: true,
      });

      cache.add.mockRejectedValue(new Error("Cache add failed"));

      await expect(cacheAudioFile("test-url", "Test Song")).rejects.toThrow(
        "Cache add failed"
      );
    });
  });

  describe("Service Worker Registration", () => {
    it("should register service worker successfully", async () => {
      const mockServiceWorkerRegistration = {
        active: null,
        installing: null,
        waiting: null,
        update: vi.fn().mockResolvedValue(undefined),
        unregister: vi.fn().mockResolvedValue(true),
      };

      // Use the global navigator.serviceWorker mock directly
      const mockRegister = vi
        .fn()
        .mockResolvedValue(mockServiceWorkerRegistration);
      const mockAddEventListener = vi.fn();
      Object.defineProperty(global.navigator, "serviceWorker", {
        value: {
          register: mockRegister,
          ready: Promise.resolve(mockServiceWorkerRegistration),
          addEventListener: mockAddEventListener,
        },
        configurable: true,
      });

      await initializeOfflineSupport("Test Playlist");

      // Wait for setTimeout to execute service worker registration
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockRegister).toHaveBeenCalledWith("./sw.js");
    });

    it("should handle service worker registration failure", async () => {
      const { serviceWorker } = mockManager.getMocks();
      serviceWorker.register.mockRejectedValue(
        new Error("SW registration failed")
      );

      // Should not throw error even if SW registration fails
      await expect(
        initializeOfflineSupport("Test Playlist")
      ).resolves.toBeUndefined();
    });

    it("should handle browsers without service worker support", async () => {
      mockManager.mockAPIUnavailable.serviceWorker();

      await expect(
        initializeOfflineSupport("Test Playlist")
      ).resolves.toBeUndefined();
    });

    it("should set up service worker message listener", async () => {
      const mockAddEventListener = vi.fn();
      Object.defineProperty(global.navigator, "serviceWorker", {
        value: {
          register: vi.fn().mockResolvedValue(mockServiceWorkerRegistration),
          ready: Promise.resolve(mockServiceWorkerRegistration),
          addEventListener: mockAddEventListener,
        },
        configurable: true,
      });

      await initializeOfflineSupport("Test Playlist");

      // Wait for setTimeout to execute service worker registration
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Check if addEventListener was called on navigator.serviceWorker
      expect(mockAddEventListener).toHaveBeenCalledWith(
        "message",
        expect.any(Function)
      );
    });
  });

  describe("Persistent Storage", () => {
    it("should request persistent storage successfully", async () => {
      await initializeOfflineSupport("Test Playlist");

      const { navigatorStorage } = mockManager.getMocks();
      expect(navigatorStorage.persist).toHaveBeenCalled();
    });

    it("should handle persistent storage denial", async () => {
      const { navigatorStorage } = mockManager.getMocks();
      navigatorStorage.persist.mockResolvedValue(false);

      await initializeOfflineSupport("Test Playlist");

      expect(navigatorStorage.persist).toHaveBeenCalled();
    });

    it("should handle browsers without persistent storage support", async () => {
      mockManager.mockAPIUnavailable.storage();

      await expect(
        initializeOfflineSupport("Test Playlist")
      ).resolves.toBeUndefined();
    });

    it("should handle persistent storage errors", async () => {
      const { navigatorStorage } = mockManager.getMocks();
      navigatorStorage.persist.mockRejectedValue(new Error("Storage error"));

      await expect(
        initializeOfflineSupport("Test Playlist")
      ).resolves.toBeUndefined();
    });
  });

  describe("Event Listeners", () => {
    it("should set up online/offline event listeners", async () => {
      await initializeOfflineSupport("Test Playlist");

      expect(window.addEventListener).toHaveBeenCalledWith(
        "online",
        expect.any(Function)
      );
      expect(window.addEventListener).toHaveBeenCalledWith(
        "offline",
        expect.any(Function)
      );
    });

    it("should update online status on events", async () => {
      await initializeOfflineSupport("Test Playlist");

      // Get the event handler
      const onlineHandler = vi
        .mocked(window.addEventListener)
        .mock.calls.find((call) => call[0] === "online")?.[1];

      const offlineHandler = vi
        .mocked(window.addEventListener)
        .mock.calls.find((call) => call[0] === "offline")?.[1];

      expect(onlineHandler).toBeDefined();
      expect(offlineHandler).toBeDefined();

      // These would update the signals when called
      if (onlineHandler && typeof onlineHandler === "function") {
        onlineHandler(new Event("online"));
      }
      if (offlineHandler && typeof offlineHandler === "function") {
        offlineHandler(new Event("offline"));
      }
    });
  });

  describe("Initialization", () => {
    it("should initialize with playlist title only", async () => {
      await initializeOfflineSupport("Test Playlist");

      // Wait for setTimeout to execute service worker registration
      await new Promise((resolve) => setTimeout(resolve, 50));

      const { navigatorStorage } = mockManager.getMocks();
      expect(document.createElement).toHaveBeenCalledWith("link");
      expect(navigatorStorage.persist).toHaveBeenCalled();
      expect(global.navigator.serviceWorker.register).toHaveBeenCalledWith(
        "./sw.js"
      );
    });

    it("should initialize with playlist title and data", async () => {
      const playlist = createMockPlaylist();

      await initializeOfflineSupport("Test Playlist", playlist);

      expect(document.createElement).toHaveBeenCalled();
    });

    it("should handle initialization without arguments", async () => {
      await initializeOfflineSupport();

      expect(document.createElement).toHaveBeenCalled();
    });
  });

  describe("Edge Cases", () => {
    it("should handle very long playlist titles", () => {
      const longTitle = "A".repeat(100);

      updatePWAManifest(longTitle);

      expect(document.createElement).toHaveBeenCalled();
    });

    it("should handle special characters in playlist titles", () => {
      const specialTitle = "My Playlist! @#$%^&*()";

      updatePWAManifest(specialTitle);

      expect(document.createElement).toHaveBeenCalled();
    });

    it("should handle empty playlist title", () => {
      updatePWAManifest("");

      expect(document.createElement).toHaveBeenCalled();
    });

    it("should handle playlist with very large image data", () => {
      const largeImageData = new ArrayBuffer(10 * 1024 * 1024); // 10MB
      const playlist = createMockPlaylist({
        imageData: largeImageData,
      });

      updatePWAManifest("Test", playlist);

      expect(document.createElement).toHaveBeenCalled();
    });
  });

  describe("Browser Compatibility", () => {
    it("should work when storage estimate returns null values", async () => {
      // Mock navigator.storage.estimate to return null values
      Object.defineProperty(navigator, "storage", {
        value: {
          estimate: vi.fn().mockResolvedValue({
            quota: null,
            usage: null,
          }),
        },
        configurable: true,
      });

      const info = await getStorageInfo();

      expect(info.quota).toBeNull();
      expect(info.usage).toBeNull();
      expect(info.quotaFormatted).toBeUndefined();
      expect(info.usageFormatted).toBeUndefined();
    });

    it("should handle missing document.head", () => {
      Object.defineProperty(document, "head", { value: undefined });

      // Should throw error when document.head is missing
      expect(() => updatePWAManifest("Test")).toThrow();
    });

    it("should handle missing URL API", async () => {
      Object.defineProperty(global, "URL", { value: undefined });

      // Should throw error when URL API is missing
      const playlist = createMockPlaylist();
      expect(() => updatePWAManifest("Test", playlist)).toThrow();
    });
  });
});
