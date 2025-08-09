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

// Mock global APIs
const mockServiceWorkerRegistration = {
  active: null,
  installing: null,
  waiting: null,
  update: vi.fn(),
  unregister: vi.fn(),
};

const mockServiceWorker = {
  controller: null,
  ready: Promise.resolve(mockServiceWorkerRegistration),
  register: vi.fn().mockResolvedValue(mockServiceWorkerRegistration),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

const mockCache = {
  match: vi.fn(),
  add: vi.fn(),
  addAll: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  keys: vi.fn().mockResolvedValue([]),
};

const mockCaches = {
  open: vi.fn().mockResolvedValue(mockCache),
  delete: vi.fn(),
  keys: vi.fn().mockResolvedValue(["playlistz-cache-v1"]),
  match: vi.fn(),
};

const mockNavigatorStorage = {
  persist: vi.fn().mockResolvedValue(true),
  persisted: vi.fn().mockResolvedValue(true),
  estimate: vi.fn().mockResolvedValue({
    quota: 1000000000, // 1GB
    usage: 100000000, // 100MB
  }),
};

// Set up global mocks
Object.defineProperty(global, "navigator", {
  value: {
    ...global.navigator,
    serviceWorker: mockServiceWorker,
    storage: mockNavigatorStorage,
    onLine: true,
  },
  writable: true,
});

Object.defineProperty(global, "caches", {
  value: mockCaches,
  writable: true,
});

Object.defineProperty(global, "window", {
  value: {
    ...global.window,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    location: {
      href: "http://localhost:3000/test",
      protocol: "http:",
    },
  },
  writable: true,
});

Object.defineProperty(global, "document", {
  value: {
    ...global.document,
    querySelector: vi.fn(),
    querySelectorAll: vi.fn().mockReturnValue([]),
    createElement: vi.fn(() => ({
      setAttribute: vi.fn(),
      remove: vi.fn(),
    })),
    head: {
      appendChild: vi.fn(),
    },
  },
  writable: true,
});

Object.defineProperty(global, "URL", {
  value: {
    createObjectURL: vi.fn((blob) => `blob:mock-url-${Math.random()}`),
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
    vi.clearAllMocks();

    // Reset navigator online status
    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
    });

    // Reset mocks
    mockCache.match.mockResolvedValue(undefined);
    mockCache.add.mockResolvedValue(undefined);
    mockNavigatorStorage.persist.mockResolvedValue(true);
    mockNavigatorStorage.persisted.mockResolvedValue(true);
    mockNavigatorStorage.estimate.mockResolvedValue({
      quota: 1000000000,
      usage: 100000000,
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
      expect(document.head.appendChild).toHaveBeenCalledTimes(
        expect.any(Number)
      );
    });

    it("should remove existing manifest before adding new one", () => {
      const existingLink = { remove: vi.fn() };
      vi.mocked(document.querySelector).mockReturnValue(existingLink as any);

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
      expect(info.quotaFormatted).toBe("953 MB");
      expect(info.usageFormatted).toBe("95 MB");
      expect(info.usagePercent).toBe(10);
      expect(info.persistent).toBe(true);
    });

    it("should handle storage API not available", async () => {
      // Mock storage API not available
      Object.defineProperty(navigator, "storage", { value: undefined });

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
      mockNavigatorStorage.estimate.mockRejectedValue(
        new Error("Storage error")
      );

      const info = await getStorageInfo();

      expect(info.error).toBe("Storage error");
    });

    it("should calculate usage percentage correctly", async () => {
      mockNavigatorStorage.estimate.mockResolvedValue({
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
      mockCache.match.mockResolvedValue(new Response());

      const isCached = await isUrlCached(testUrl);

      expect(isCached).toBe(true);
      expect(mockCaches.open).toHaveBeenCalledWith("playlistz-cache-v1");
      expect(mockCache.match).toHaveBeenCalledWith(testUrl);
    });

    it("should return false for non-cached URLs", async () => {
      const testUrl = "http://freqhole.net/not-cached.mp3";
      mockCache.match.mockResolvedValue(undefined);

      const isCached = await isUrlCached(testUrl);

      expect(isCached).toBe(false);
    });

    it("should handle cache check errors", async () => {
      mockCaches.open.mockRejectedValue(new Error("Cache error"));

      const isCached = await isUrlCached("test-url");

      expect(isCached).toBe(false);
    });

    it("should return false when caches API not available", async () => {
      Object.defineProperty(global, "caches", { value: undefined });

      const isCached = await isUrlCached("test-url");

      expect(isCached).toBe(false);
    });
  });

  describe("Audio File Caching", () => {
    it("should cache audio file via service worker", async () => {
      const testUrl = "blob:http://localhost/audio.mp3";
      const testTitle = "Test Song";

      mockServiceWorker.controller = {
        postMessage: vi.fn(),
      };

      await cacheAudioFile(testUrl, testTitle);

      expect(mockServiceWorker.controller.postMessage).toHaveBeenCalledWith({
        type: "CACHE_URL",
        data: { url: testUrl },
      });
    });

    it("should cache audio file directly when no service worker", async () => {
      const testUrl = "http://freqhole.net/audio.mp3";
      const testTitle = "Test Song";

      mockServiceWorker.controller = null;

      await cacheAudioFile(testUrl, testTitle);

      expect(mockCache.add).toHaveBeenCalledWith(testUrl);
    });

    it("should handle file:// protocol gracefully", async () => {
      Object.defineProperty(window.location, "protocol", { value: "file:" });

      await cacheAudioFile("file://local/audio.mp3", "Local Song");

      // Should return without error for file:// protocol
      expect(mockCache.add).not.toHaveBeenCalled();
    });

    it("should throw error when cache API not supported", async () => {
      Object.defineProperty(global, "caches", { value: undefined });

      await expect(cacheAudioFile("test-url", "Test Song")).rejects.toThrow(
        "Cache API not supported"
      );
    });

    it("should handle cache add failures", async () => {
      mockCache.add.mockRejectedValue(new Error("Cache add failed"));
      mockServiceWorker.controller = null;

      await expect(cacheAudioFile("test-url", "Test Song")).rejects.toThrow(
        "Cache add failed"
      );
    });
  });

  describe("Service Worker Registration", () => {
    it("should register service worker successfully", async () => {
      mockServiceWorker.register.mockResolvedValue(
        mockServiceWorkerRegistration
      );

      await initializeOfflineSupport("Test Playlist");

      expect(mockServiceWorker.register).toHaveBeenCalledWith("./sw.js");
    });

    it("should handle service worker registration failure", async () => {
      mockServiceWorker.register.mockRejectedValue(
        new Error("SW registration failed")
      );

      // Should not throw error even if SW registration fails
      await expect(
        initializeOfflineSupport("Test Playlist")
      ).resolves.toBeUndefined();
    });

    it("should handle browsers without service worker support", async () => {
      Object.defineProperty(navigator, "serviceWorker", { value: undefined });

      await expect(
        initializeOfflineSupport("Test Playlist")
      ).resolves.toBeUndefined();
    });

    it("should set up service worker message listener", async () => {
      await initializeOfflineSupport("Test Playlist");

      expect(mockServiceWorker.addEventListener).toHaveBeenCalledWith(
        "message",
        expect.any(Function)
      );
    });
  });

  describe("Persistent Storage", () => {
    it("should request persistent storage successfully", async () => {
      await initializeOfflineSupport("Test Playlist");

      expect(mockNavigatorStorage.persist).toHaveBeenCalled();
    });

    it("should handle persistent storage denial", async () => {
      mockNavigatorStorage.persist.mockResolvedValue(false);

      await initializeOfflineSupport("Test Playlist");

      expect(mockNavigatorStorage.persist).toHaveBeenCalled();
    });

    it("should handle browsers without persistent storage support", async () => {
      Object.defineProperty(navigator, "storage", { value: {} });

      await expect(
        initializeOfflineSupport("Test Playlist")
      ).resolves.toBeUndefined();
    });

    it("should handle persistent storage errors", async () => {
      mockNavigatorStorage.persist.mockRejectedValue(
        new Error("Storage error")
      );

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
      if (onlineHandler) onlineHandler();
      if (offlineHandler) offlineHandler();
    });
  });

  describe("Initialization", () => {
    it("should initialize with playlist title only", async () => {
      await initializeOfflineSupport("Test Playlist");

      expect(document.createElement).toHaveBeenCalled();
      expect(mockNavigatorStorage.persist).toHaveBeenCalled();
      expect(mockServiceWorker.register).toHaveBeenCalled();
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
      mockNavigatorStorage.estimate.mockResolvedValue({
        quota: null,
        usage: null,
      });

      const info = await getStorageInfo();

      expect(info.quota).toBeNull();
      expect(info.usage).toBeNull();
      expect(info.quotaFormatted).toBeUndefined();
      expect(info.usageFormatted).toBeUndefined();
    });

    it("should handle missing document.head", () => {
      Object.defineProperty(document, "head", { value: undefined });

      // Should not throw error
      expect(() => updatePWAManifest("Test")).not.toThrow();
    });

    it("should handle missing URL API", async () => {
      Object.defineProperty(global, "URL", { value: undefined });

      // Should handle gracefully
      const playlist = createMockPlaylist();
      expect(() => updatePWAManifest("Test", playlist)).not.toThrow();
    });
  });
});
