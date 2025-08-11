import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies using factory pattern
vi.mock("./indexedDBService.js", () => ({
  setupDB: vi.fn(),
  mutateAndNotify: vi.fn(),
  DB_NAME: "musicPlaylistDB",
  PLAYLISTS_STORE: "playlists",
  SONGS_STORE: "songs",
}));

vi.mock("./songReactivity.js", () => ({
  triggerSongUpdateWithOptions: vi.fn(),
}));

// Import after mocks are set up
import {
  standaloneLoadingProgress,
  setStandaloneLoadingProgress,
  initializeStandalonePlaylist,
  loadStandaloneSongAudioData,
  songNeedsAudioData,
  clearStandaloneLoadingProgress,
} from "./standaloneService.js";
import { setupDB, mutateAndNotify } from "./indexedDBService.js";

// Mock solid-js
vi.mock("solid-js", () => {
  let currentProgress: any = null;

  return {
    createSignal: vi.fn(() => [
      () => currentProgress,
      (value: any) => {
        currentProgress = value;
      },
    ]),
  };
});

// Mock global objects
global.fetch = vi.fn();

describe("Standalone Service", () => {
  let mockDB: any;
  let mockTransaction: any;
  let mockStore: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockStore = {
      get: vi.fn(),
      put: vi.fn(),
      getAll: vi.fn(),
      delete: vi.fn(),
    };

    mockTransaction = {
      objectStore: vi.fn().mockReturnValue(mockStore),
      done: Promise.resolve(),
    };

    mockDB = {
      transaction: vi.fn().mockReturnValue(mockTransaction),
      get: vi.fn(),
      put: vi.fn(),
      getAll: vi.fn(),
    };

    vi.mocked(setupDB).mockResolvedValue(mockDB);
    vi.mocked(mutateAndNotify).mockResolvedValue(undefined);

    // Reset progress
    setStandaloneLoadingProgress(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Loading Progress Management", () => {
    it("should initialize with null progress", () => {
      expect(standaloneLoadingProgress()).toBeNull();
    });

    it("should update loading progress", () => {
      const progress = {
        current: 5,
        total: 10,
        currentSong: "Song Title",
        phase: "updating" as const,
      };

      setStandaloneLoadingProgress(progress);
      expect(standaloneLoadingProgress()).toEqual(progress);
    });

    it("should clear loading progress", () => {
      setStandaloneLoadingProgress({
        current: 5,
        total: 10,
        currentSong: "Song Title",
        phase: "updating",
      });

      setStandaloneLoadingProgress(null);
      expect(standaloneLoadingProgress()).toBeNull();
    });

    it("should handle different loading phases", () => {
      const phases = [
        "initializing",
        "checking",
        "updating",
        "complete",
        "reloading",
      ] as const;

      phases.forEach((phase) => {
        setStandaloneLoadingProgress({
          current: 1,
          total: 1,
          currentSong: "Test Song",
          phase,
        });

        expect(standaloneLoadingProgress()?.phase).toBe(phase);
      });
    });
  });

  describe("initializeStandalonePlaylist", () => {
    let mockPlaylistData: any;
    let mockCallbacks: any;

    beforeEach(() => {
      mockPlaylistData = {
        playlist: {
          id: "standalone-playlist",
          title: "Standalone Playlist",
          description: "A test playlist",
          songCount: 2,
          rev: 1,
        },
        songs: [
          {
            id: "song1",
            title: "Song One",
            artist: "Artist One",
            album: "Album One",
            duration: 180,
            originalFilename: "song1.mp3",
            fileSize: 1000000,
          },
          {
            id: "song2",
            title: "Song Two",
            artist: "Artist Two",
            album: "Album Two",
            duration: 240,
            originalFilename: "song2.mp3",
            fileSize: 1500000,
          },
        ],
      };

      mockCallbacks = {
        setSelectedPlaylist: vi.fn(),
        setPlaylistSongs: vi.fn(),
        setSidebarCollapsed: vi.fn(),
        setError: vi.fn(),
      };
    });

    it("should initialize standalone playlist successfully", async () => {
      await initializeStandalonePlaylist(mockPlaylistData, mockCallbacks);

      expect(setupDB).toHaveBeenCalled();
      expect(mockCallbacks.setSelectedPlaylist).toHaveBeenCalled();
      expect(mockCallbacks.setPlaylistSongs).toHaveBeenCalled();
    });

    it("should handle database errors gracefully", async () => {
      vi.mocked(setupDB).mockRejectedValue(new Error("Database setup failed"));

      await initializeStandalonePlaylist(mockPlaylistData, mockCallbacks);

      expect(mockCallbacks.setError).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load")
      );
    });

    it("should handle invalid playlist data", async () => {
      const invalidData = null;

      await initializeStandalonePlaylist(invalidData, mockCallbacks);

      expect(mockCallbacks.setError).toHaveBeenCalled();
    });

    it("should handle missing callbacks gracefully", async () => {
      const partialCallbacks = {
        setSelectedPlaylist: vi.fn(),
        // Missing other callbacks
      };

      await expect(
        initializeStandalonePlaylist(mockPlaylistData, partialCallbacks as any)
      ).rejects.toThrow("callbacks.setError is not a function");
    });
  });

  describe("loadStandaloneSongAudioData", () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    it("should load audio data for song successfully", async () => {
      const songId = "test-song";
      const mockSong = {
        id: songId,
        title: "Test Song",
        originalFilename: "test.mp3",
        standaloneFilePath: "data/test.mp3",
      };

      mockDB.get.mockResolvedValue(mockSong);

      const mockAudioData = new ArrayBuffer(2000);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(mockAudioData),
      } as any);

      const result = await loadStandaloneSongAudioData(songId);

      expect(setupDB).toHaveBeenCalled();
      expect(mockDB.get).toHaveBeenCalledWith("songs", songId);
      expect(result).toBe(true);
    });

    it("should handle song not found", async () => {
      const songId = "non-existent-song";
      mockDB.get.mockResolvedValue(undefined);

      const result = await loadStandaloneSongAudioData(songId);

      expect(result).toBe(false);
    });

    it("should handle audio loading errors", async () => {
      const songId = "test-song";
      const mockSong = {
        id: songId,
        title: "Test Song",
        originalFilename: "test.mp3",
        standaloneFilePath: "data/test.mp3",
      };

      mockDB.get.mockResolvedValue(mockSong);
      vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

      const result = await loadStandaloneSongAudioData(songId);

      expect(result).toBe(false);
    });

    it("should handle database errors", async () => {
      const songId = "test-song";
      vi.mocked(setupDB).mockRejectedValue(new Error("Database error"));

      const result = await loadStandaloneSongAudioData(songId);

      expect(result).toBe(false);
    });
  });

  describe("songNeedsAudioData", () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    it("should return true for song without audio data", async () => {
      const mockSong = {
        id: "test-song",
        title: "Test Song",
      };

      mockDB.get.mockResolvedValue(mockSong);

      const result = await songNeedsAudioData(mockSong);

      expect(result).toBe(true);
    });

    it("should return false for song with audio data", async () => {
      const mockSong = {
        id: "test-song",
        title: "Test Song",
        audioData: new ArrayBuffer(1000),
      };

      mockDB.get.mockResolvedValue(mockSong);

      const result = await songNeedsAudioData(mockSong);

      expect(result).toBe(false);
    });

    it("should return true for song not in database", async () => {
      const mockSong = {
        id: "non-existent-song",
        title: "Non-existent Song",
      };

      mockDB.get.mockResolvedValue(undefined);

      const result = await songNeedsAudioData(mockSong);

      expect(result).toBe(true);
    });

    it("should handle database errors gracefully", async () => {
      const mockSong = {
        id: "test-song",
        title: "Test Song",
      };

      vi.mocked(setupDB).mockRejectedValue(new Error("Database error"));

      const result = await songNeedsAudioData(mockSong);

      expect(result).toBe(true); // Default to needing data on error
    });

    it("should return false for file protocol", async () => {
      // Mock window.location.protocol
      const originalLocation = window.location;
      Object.defineProperty(window, "location", {
        value: { protocol: "file:" },
        writable: true,
      });

      const mockSong = {
        id: "test-song",
        title: "Test Song",
        standaloneFilePath: "file:///path/to/song.mp3",
      };

      // Mock the database to return the song
      mockDB.get.mockResolvedValue(mockSong);

      const result = await songNeedsAudioData(mockSong);

      expect(result).toBe(false);

      // Restore original location
      Object.defineProperty(window, "location", {
        value: originalLocation,
        writable: true,
      });
    });
  });

  describe("clearStandaloneLoadingProgress", () => {
    it("should clear loading progress", () => {
      // Set some progress first
      setStandaloneLoadingProgress({
        current: 5,
        total: 10,
        currentSong: "Test Song",
        phase: "updating",
      });

      expect(standaloneLoadingProgress()).not.toBeNull();

      // Clear progress
      clearStandaloneLoadingProgress();

      expect(standaloneLoadingProgress()).toBeNull();
    });

    it("should handle clearing when already null", () => {
      // Ensure it's already null
      setStandaloneLoadingProgress(null);
      expect(standaloneLoadingProgress()).toBeNull();

      // Should not throw when clearing already null progress
      expect(() => {
        clearStandaloneLoadingProgress();
      }).not.toThrow();

      expect(standaloneLoadingProgress()).toBeNull();
    });
  });

  describe("Integration with other services", () => {
    it("should properly integrate with setupDB", async () => {
      const songId = "integration-song";
      const mockSong = {
        id: songId,
        title: "Integration Song",
        originalFilename: "integration.mp3",
        standaloneFilePath: "data/integration.mp3",
      };

      mockDB.get.mockResolvedValue(mockSong);

      const mockAudioData = new ArrayBuffer(2000);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(mockAudioData),
      } as any);

      const result = await loadStandaloneSongAudioData(songId);

      expect(setupDB).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("should handle progress updates correctly", () => {
      const progressStates = [
        { phase: "initializing", current: 0, total: 5 },
        { phase: "checking", current: 1, total: 5 },
        { phase: "updating", current: 3, total: 5 },
        { phase: "complete", current: 5, total: 5 },
      ] as const;

      progressStates.forEach((state) => {
        setStandaloneLoadingProgress({
          ...state,
          currentSong: "Test Song",
        });

        const currentProgress = standaloneLoadingProgress();
        expect(currentProgress?.phase).toBe(state.phase);
        expect(currentProgress?.current).toBe(state.current);
        expect(currentProgress?.total).toBe(state.total);
      });
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("should handle malformed playlist data", async () => {
      const malformedData = {
        // Missing playlist object
        songs: [],
      };

      const mockCallbacks = {
        setSelectedPlaylist: vi.fn(),
        setPlaylistSongs: vi.fn(),
        setSidebarCollapsed: vi.fn(),
        setError: vi.fn(),
      };

      await initializeStandalonePlaylist(malformedData as any, mockCallbacks);

      expect(mockCallbacks.setError).toHaveBeenCalled();
    });

    it("should handle very large song datasets", async () => {
      const songId = "large-song";
      const largeSong = {
        id: songId,
        title: "Large Song",
        originalFilename: "large.mp3",
        fileSize: 100 * 1024 * 1024, // 100MB
        standaloneFilePath: "data/large.mp3",
      };

      mockDB.get.mockResolvedValue(largeSong);

      const largeAudioData = new ArrayBuffer(100 * 1024 * 1024);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(largeAudioData),
      } as any);

      const result = await loadStandaloneSongAudioData(songId);

      expect(result).toBe(true);
    });

    it("should handle network timeouts gracefully", async () => {
      const songId = "timeout-song";
      const mockSong = {
        id: songId,
        title: "Timeout Song",
        originalFilename: "timeout.mp3",
        standaloneFilePath: "data/timeout.mp3",
      };

      mockDB.get.mockResolvedValue(mockSong);

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Network timeout")), 100);
      });

      vi.mocked(fetch).mockReturnValue(timeoutPromise as any);

      const result = await loadStandaloneSongAudioData(songId);

      expect(result).toBe(false);
    });

    it("should handle concurrent song loading", async () => {
      const songIds = ["song1", "song2", "song3"];
      const mockSongs = songIds.map((id) => ({
        id,
        title: `Song ${id}`,
        originalFilename: `${id}.mp3`,
        standaloneFilePath: `data/${id}.mp3`,
      }));

      songIds.forEach((_, index) => {
        mockDB.get.mockResolvedValueOnce(mockSongs[index]);
      });

      const mockAudioData = new ArrayBuffer(2000);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(mockAudioData),
      } as any);

      const promises = songIds.map((songId) =>
        loadStandaloneSongAudioData(songId)
      );
      const results = await Promise.all(promises);

      expect(results.every((result) => result === true)).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe("Performance Considerations", () => {
    it("should handle rapid progress updates efficiently", async () => {
      const startTime = performance.now();

      // Simulate rapid progress updates
      for (let i = 0; i < 1000; i++) {
        setStandaloneLoadingProgress({
          current: i,
          total: 1000,
          currentSong: `Song ${i}`,
          phase: "updating",
        });
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete quickly (less than 50ms on most systems)
      expect(duration).toBeLessThan(50);
      expect(standaloneLoadingProgress()?.current).toBe(999);
    });

    it("should handle audio data checking efficiently", async () => {
      const startTime = performance.now();

      // Test multiple songs
      const songs = Array.from({ length: 100 }, (_, i) => ({
        id: `song${i}`,
        title: `Song ${i}`,
      }));

      // Mock some songs with audio data, some without
      for (let i = 0; i < 100; i++) {
        const songWithAudio =
          i % 2 === 0 ? { audioData: new ArrayBuffer(1000) } : {};
        mockDB.get.mockResolvedValueOnce({ ...songs[i], ...songWithAudio });
      }

      const promises = songs.map((song) => songNeedsAudioData(song));
      await Promise.all(promises);

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete efficiently
      expect(duration).toBeLessThan(200);
    });
  });

  describe("Advanced Playlist Scenarios", () => {
    describe("initializeStandalonePlaylist with existing data", () => {
      it("should handle playlist revision updates", async () => {
        const existingPlaylist = {
          id: "existing-playlist",
          title: "Existing Playlist",
          rev: 1,
          songIds: ["existing-song"],
        };

        mockDB.get.mockResolvedValueOnce(existingPlaylist);
        mockDB.getAll.mockResolvedValue([
          {
            id: "existing-song",
            title: "Existing Song",
            playlistId: "existing-playlist",
            sha: "old-sha",
          },
        ]);

        const playlistData = {
          playlist: {
            id: "existing-playlist",
            title: "Updated Playlist",
            rev: 2, // Higher revision
          },
          songs: [
            {
              id: "existing-song",
              title: "Updated Song",
              sha: "new-sha", // Different SHA
              originalFilename: "updated.mp3",
            },
          ],
        };

        const mockCallbacks = {
          setSelectedPlaylist: vi.fn(),
          setPlaylistSongs: vi.fn(),
          setSidebarCollapsed: vi.fn(),
          setError: vi.fn(),
        };

        await initializeStandalonePlaylist(playlistData, mockCallbacks);

        expect(mockCallbacks.setSelectedPlaylist).toHaveBeenCalled();
        expect(mockCallbacks.setPlaylistSongs).toHaveBeenCalled();
        expect(mutateAndNotify).toHaveBeenCalled();
      });

      it("should skip update when revision is same", async () => {
        const existingPlaylist = {
          id: "same-rev-playlist",
          title: "Same Rev Playlist",
          rev: 1,
          songIds: ["song1"],
        };

        mockDB.get.mockResolvedValueOnce(existingPlaylist);
        mockDB.getAll.mockResolvedValue([
          {
            id: "song1",
            title: "Song One",
            playlistId: "same-rev-playlist",
            sha: "same-sha",
          },
        ]);

        const playlistData = {
          playlist: {
            id: "same-rev-playlist",
            title: "Same Rev Playlist",
            rev: 1, // Same revision
          },
          songs: [
            {
              id: "song1",
              title: "Song One",
              sha: "same-sha",
            },
          ],
        };

        const mockCallbacks = {
          setSelectedPlaylist: vi.fn(),
          setPlaylistSongs: vi.fn(),
          setSidebarCollapsed: vi.fn(),
          setError: vi.fn(),
        };

        await initializeStandalonePlaylist(playlistData, mockCallbacks);

        expect(mockCallbacks.setSelectedPlaylist).toHaveBeenCalled();
        expect(mockCallbacks.setPlaylistSongs).toHaveBeenCalled();
        // Should use existing data without processing
      });

      it("should create new playlist when none exists", async () => {
        mockDB.get.mockResolvedValueOnce(undefined); // No existing playlist

        const playlistData = {
          playlist: {
            id: "brand-new-playlist",
            title: "Brand New Playlist",
            description: "A completely new playlist",
            rev: 0,
          },
          songs: [
            {
              id: "new-song",
              title: "New Song",
              originalFilename: "new.mp3",
              sha: "new-sha",
            },
          ],
        };

        const mockCallbacks = {
          setSelectedPlaylist: vi.fn(),
          setPlaylistSongs: vi.fn(),
          setSidebarCollapsed: vi.fn(),
          setError: vi.fn(),
        };

        await initializeStandalonePlaylist(playlistData, mockCallbacks);

        expect(mockCallbacks.setSelectedPlaylist).toHaveBeenCalled();
        expect(mockCallbacks.setPlaylistSongs).toHaveBeenCalled();
        expect(mutateAndNotify).toHaveBeenCalled();
      });
    });

    describe("loadStandaloneSongAudioData edge cases", () => {
      it("should skip loading for file protocol", async () => {
        const originalLocation = window.location;
        Object.defineProperty(window, "location", {
          value: { protocol: "file:" },
          writable: true,
        });

        const songId = "file-protocol-song";
        const mockSong = {
          id: songId,
          title: "File Protocol Song",
          standaloneFilePath: "data/file-song.mp3",
        };

        mockDB.get.mockResolvedValue(mockSong);

        const result = await loadStandaloneSongAudioData(songId);

        expect(result).toBe(true);
        expect(fetch).not.toHaveBeenCalled();

        // Restore original location
        Object.defineProperty(window, "location", {
          value: originalLocation,
          writable: true,
        });
      });

      it("should return false when song has no standalone file path", async () => {
        const songId = "no-path-song";
        const mockSong = {
          id: songId,
          title: "No Path Song",
          standaloneFilePath: undefined,
        };

        mockDB.get.mockResolvedValue(mockSong);

        const consoleSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        const result = await loadStandaloneSongAudioData(songId);

        expect(result).toBe(false);
        expect(consoleSpy).toHaveBeenCalledWith(
          `Song ${songId} has no standalone file path`
        );

        consoleSpy.mockRestore();
      });

      it("should return true when song already has audio data", async () => {
        const songId = "has-audio-song";
        const mockSong = {
          id: songId,
          title: "Has Audio Song",
          audioData: new ArrayBuffer(5000),
        };

        mockDB.get.mockResolvedValue(mockSong);

        const result = await loadStandaloneSongAudioData(songId);

        expect(result).toBe(true);
        expect(fetch).not.toHaveBeenCalled();
      });

      it("should handle fetch response without arrayBuffer method", async () => {
        const songId = "invalid-response-song";
        const mockSong = {
          id: songId,
          title: "Invalid Response Song",
          standaloneFilePath: "data/invalid.mp3",
        };

        mockDB.get.mockResolvedValue(mockSong);

        // Mock fetch to return response without arrayBuffer method
        vi.mocked(fetch).mockResolvedValue({
          ok: true,
          arrayBuffer: undefined,
        } as any);

        const result = await loadStandaloneSongAudioData(songId);

        expect(result).toBe(false);
      });
    });

    describe("songNeedsAudioData advanced scenarios", () => {
      it("should handle songs with zero-length audio data", async () => {
        const mockSong = { id: "zero-audio-song" };

        mockDB.get.mockResolvedValue({
          id: "zero-audio-song",
          audioData: new ArrayBuffer(0), // Zero length
        });

        const result = await songNeedsAudioData(mockSong);

        expect(result).toBe(true);
      });

      it("should handle songs with null audio data", async () => {
        const mockSong = { id: "null-audio-song" };

        mockDB.get.mockResolvedValue({
          id: "null-audio-song",
          audioData: null,
        });

        const result = await songNeedsAudioData(mockSong);

        expect(result).toBe(true);
      });

      it("should handle songs with valid audio data", async () => {
        const mockSong = { id: "valid-audio-song" };

        mockDB.get.mockResolvedValue({
          id: "valid-audio-song",
          audioData: new ArrayBuffer(5000),
        });

        const result = await songNeedsAudioData(mockSong);

        expect(result).toBe(false);
      });
    });
  });

  describe("Background Image Loading", () => {
    it("should handle background image loading after playlist initialization", async () => {
      // Mock setTimeout to capture the callback
      const originalSetTimeout = global.setTimeout;
      const timeoutCallbacks: Array<() => void> = [];

      global.setTimeout = vi.fn((callback: () => void, delay: number) => {
        timeoutCallbacks.push(callback);
        return originalSetTimeout(callback, delay);
      }) as any;

      const playlistData = {
        playlist: {
          id: "image-playlist",
          title: "Image Playlist",
          imageExtension: ".jpg",
          imageMimeType: "image/jpeg",
        },
        songs: [
          {
            id: "image-song",
            title: "Image Song",
            imageExtension: ".png",
            imageMimeType: "image/png",
            originalFilename: "image-song.mp3",
          },
        ],
      };

      const mockCallbacks = {
        setSelectedPlaylist: vi.fn(),
        setPlaylistSongs: vi.fn(),
        setSidebarCollapsed: vi.fn(),
        setError: vi.fn(),
      };

      mockDB.get.mockResolvedValue(undefined); // New playlist

      await initializeStandalonePlaylist(playlistData, mockCallbacks);

      // Verify that image loading was scheduled
      expect(setTimeout).toHaveBeenCalled();

      // Restore setTimeout
      global.setTimeout = originalSetTimeout;
    });
  });

  describe("Progress Management Edge Cases", () => {
    it("should handle rapid progress updates", () => {
      for (let i = 0; i < 100; i++) {
        setStandaloneLoadingProgress({
          current: i,
          total: 100,
          currentSong: `Song ${i}`,
          phase: "updating",
        });
      }

      const finalProgress = standaloneLoadingProgress();
      expect(finalProgress?.current).toBe(99);
      expect(finalProgress?.total).toBe(100);
    });

    it("should handle null progress updates", () => {
      setStandaloneLoadingProgress({
        current: 50,
        total: 100,
        currentSong: "Test Song",
        phase: "updating",
      });

      expect(standaloneLoadingProgress()).not.toBeNull();

      setStandaloneLoadingProgress(null);

      expect(standaloneLoadingProgress()).toBeNull();
    });

    it("should handle different progress phases", () => {
      const phases = ["initializing", "reloading", "updating"] as const;

      phases.forEach((phase) => {
        setStandaloneLoadingProgress({
          current: 1,
          total: 3,
          currentSong: `${phase} song`,
          phase,
        });

        const progress = standaloneLoadingProgress();
        expect(progress?.phase).toBe(phase);
      });
    });
  });

  describe("Memory and Performance", () => {
    it("should handle large song collections efficiently", async () => {
      const largeSongCount = 1000;
      const playlistData = {
        playlist: {
          id: "large-playlist",
          title: "Large Playlist",
        },
        songs: Array.from({ length: largeSongCount }, (_, i) => ({
          id: `song-${i}`,
          title: `Song ${i}`,
          originalFilename: `song-${i}.mp3`,
          sha: `sha-${i}`,
        })),
      };

      const mockCallbacks = {
        setSelectedPlaylist: vi.fn(),
        setPlaylistSongs: vi.fn(),
        setSidebarCollapsed: vi.fn(),
        setError: vi.fn(),
      };

      mockDB.get.mockResolvedValue(undefined); // New playlist

      const startTime = performance.now();

      await initializeStandalonePlaylist(playlistData, mockCallbacks);

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should handle large collections efficiently
      expect(duration).toBeLessThan(1000);
      expect(mockCallbacks.setPlaylistSongs).toHaveBeenCalled();
    });
  });
});
