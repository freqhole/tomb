import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { usePlaylistManager } from "./usePlaylistManager.js";
import type { Playlist } from "../types/playlist.js";

// Mock the services
vi.mock("../services/indexedDBService.js", () => ({
  setupDB: vi.fn(),
  createPlaylist: vi.fn(),
  updatePlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  getAllSongs: vi.fn(),
  addSongToPlaylist: vi.fn(),
  removeSongFromPlaylist: vi.fn(),
  reorderSongs: vi.fn(),
  createPlaylistsQuery: vi.fn(() => ({
    subscribe: vi.fn((callback) => {
      // Simulate reactive query
      callback([]);
      return vi.fn(); // unsubscribe function
    }),
  })),
  createPlaylistSongsQuery: vi.fn(() => ({
    subscribe: vi.fn((callback) => {
      callback([]);
      return vi.fn();
    }),
  })),
}));

vi.mock("../services/fileProcessingService.js", () => ({
  filterAudioFiles: vi.fn(),
}));

vi.mock("../services/playlistDownloadService.js", () => ({
  parsePlaylistZip: vi.fn(),
  downloadPlaylistAsZip: vi.fn(),
}));

vi.mock("../services/standaloneService.js", () => ({
  initializeStandalonePlaylist: vi.fn(),
  clearStandaloneLoadingProgress: vi.fn(),
}));

vi.mock("../services/offlineService.js", () => ({
  initializeOfflineSupport: vi.fn(),
  updatePWAManifest: vi.fn(),
  cacheAudioFile: vi.fn(),
}));

vi.mock("../services/audioService.js", () => ({
  audioState: {
    currentSong: vi.fn(() => null),
    currentPlaylist: vi.fn(() => null),
  },
}));

vi.mock("../services/imageService.js", () => ({
  getImageUrlForContext: vi.fn(),
}));

describe("usePlaylistManager consolidated delete operations", () => {
  let dispose: () => void;
  let hook: ReturnType<typeof usePlaylistManager>;

  const mockPlaylist: Playlist = {
    id: "test-playlist",
    title: "Test Playlist",
    description: "Test Description",
    songIds: ["song1", "song2"],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    createRoot((disposeFn) => {
      dispose = disposeFn;
      hook = usePlaylistManager();
    });

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  afterEach(() => {
    if (dispose) {
      dispose();
    }
  });

  describe("playlist deletion", () => {
    it("should delete playlist and clear selectedPlaylist", async () => {
      const { deletePlaylist } = await import(
        "../services/indexedDBService.js"
      );

      // Mock successful deletion
      vi.mocked(deletePlaylist).mockResolvedValue();

      // Select playlist
      hook.selectPlaylist(mockPlaylist);
      expect(hook.selectedPlaylist()).toBeTruthy();
      expect(hook.selectedPlaylist()?.id).toBe("test-playlist");

      // Delete playlist
      await hook.handleDeletePlaylist();

      // Playlist should be cleared and service called
      expect(hook.selectedPlaylist()).toBeNull();
      expect(deletePlaylist).toHaveBeenCalledWith("test-playlist");
    });

    it("should handle deletion errors gracefully", async () => {
      const { deletePlaylist } = await import(
        "../services/indexedDBService.js"
      );

      // Mock service error
      vi.mocked(deletePlaylist).mockRejectedValue(new Error("Delete failed"));

      hook.selectPlaylist(mockPlaylist);

      await hook.handleDeletePlaylist();

      expect(hook.error()).toBe("Failed to delete playlist");
      expect(hook.selectedPlaylist()).toBeTruthy(); // Should remain selected on error
    });
  });

  describe("song removal", () => {
    it("should remove song from playlist", async () => {
      const { removeSongFromPlaylist } = await import(
        "../services/indexedDBService.js"
      );

      vi.mocked(removeSongFromPlaylist).mockResolvedValue();

      hook.selectPlaylist(mockPlaylist);

      await hook.handleRemoveSong("song1");

      expect(removeSongFromPlaylist).toHaveBeenCalledWith(
        "test-playlist",
        "song1"
      );
      expect(hook.error()).toBeNull();
    });

    it("should handle song removal errors", async () => {
      const { removeSongFromPlaylist } = await import(
        "../services/indexedDBService.js"
      );

      vi.mocked(removeSongFromPlaylist).mockRejectedValue(
        new Error("Remove failed")
      );

      hook.selectPlaylist(mockPlaylist);

      await hook.handleRemoveSong("song1");

      expect(hook.error()).toBe("Failed to remove song from playlist");
    });
  });

  describe("consolidated operations working correctly", () => {
    it("should demonstrate that delete operations now work with unified state", async () => {
      const { deletePlaylist, removeSongFromPlaylist } = await import(
        "../services/indexedDBService.js"
      );

      vi.mocked(deletePlaylist).mockResolvedValue();
      vi.mocked(removeSongFromPlaylist).mockResolvedValue();

      // All operations now use the same hook, so state is unified
      hook.selectPlaylist(mockPlaylist);

      // Song removal should work
      await hook.handleRemoveSong("song1");
      expect(removeSongFromPlaylist).toHaveBeenCalledWith(
        "test-playlist",
        "song1"
      );

      // Playlist deletion should work
      await hook.handleDeletePlaylist();
      expect(deletePlaylist).toHaveBeenCalledWith("test-playlist");
      expect(hook.selectedPlaylist()).toBeNull();
    });

    it("should have all necessary operations consolidated", () => {
      // Verify the hook exposes all needed operations
      expect(typeof hook.handleDeletePlaylist).toBe("function");
      expect(typeof hook.handleRemoveSong).toBe("function");
      expect(typeof hook.handleReorderSongs).toBe("function");
      expect(typeof hook.handlePlaylistUpdate).toBe("function");
      expect(typeof hook.handleDownloadPlaylist).toBe("function");
      expect(typeof hook.handleCachePlaylist).toBe("function");

      // And all the UI state
      expect(typeof hook.showDeleteConfirm).toBe("function");
      expect(typeof hook.setShowDeleteConfirm).toBe("function");
      expect(typeof hook.showPlaylistCover).toBe("function");
      expect(typeof hook.setShowPlaylistCover).toBe("function");
    });
  });
});
