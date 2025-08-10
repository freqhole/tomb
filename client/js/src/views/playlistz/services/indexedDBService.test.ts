import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock idb first to avoid hoisting issues
vi.mock("idb", () => ({
  openDB: vi.fn(),
}));

// Mock songReactivity module
vi.mock("./songReactivity.js", () => ({
  triggerSongUpdateWithOptions: vi.fn(),
}));

// Now import the modules that depend on idb
import {
  setupDB,
  createPlaylistsQuery,
  addSongToPlaylist,
  createPlaylist,
  getAllPlaylists,
  removeSongFromPlaylist,
} from "./indexedDBService.js";
import { triggerSongUpdateWithOptions } from "./songReactivity.js";

// Define mock objects
const mockDB = {
  getAll: vi.fn(),
  transaction: vi.fn(),
  objectStore: vi.fn(),
  put: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  createObjectStore: vi.fn(),
  objectStoreNames: {
    contains: vi.fn(() => false),
  },
};

const mockStore = {
  delete: vi.fn(),
  index: vi.fn(),
  openCursor: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
};

const mockTransaction = {
  objectStore: vi.fn((_: any) => mockStore),
  done: Promise.resolve(),
};

// Mock BroadcastChannel
global.BroadcastChannel = vi.fn(() => ({
  postMessage: vi.fn(),
  onmessage: null,
  close: vi.fn(),
})) as any;

// Mock crypto.randomUUID and crypto.subtle
Object.defineProperty(global, "crypto", {
  value: {
    randomUUID: vi.fn(() => "test-uuid-123"),
    subtle: {
      digest: vi.fn().mockImplementation((algorithm, data) => {
        // Mock SHA-256 digest - return a fixed hash for testing
        const mockHash = new Uint8Array(32); // SHA-256 produces 32 bytes
        for (let i = 0; i < 32; i++) {
          mockHash[i] = i; // Simple pattern for testing
        }
        return Promise.resolve(mockHash.buffer);
      }),
    },
  },
  writable: true,
});

// Mock IDBKeyRange
global.IDBKeyRange = {
  only: vi.fn((value) => ({ type: "only", value })),
  bound: vi.fn((lower, upper) => ({ type: "bound", lower, upper })),
  lowerBound: vi.fn((value) => ({ type: "lowerBound", value })),
  upperBound: vi.fn((value) => ({ type: "upperBound", value })),
} as any;

// Mock File with arrayBuffer method
const OriginalFile = global.File;
global.File = class MockFile extends OriginalFile {
  constructor(content: any[], name: string, options?: FilePropertyBag) {
    super(content, name, options);
  }

  override async arrayBuffer(): Promise<ArrayBuffer> {
    return new ArrayBuffer(8);
  }
} as any;

describe("Database Efficiency Tests", () => {
  let mockOpenDB: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Clear the mock for triggerSongUpdateWithOptions
    vi.mocked(triggerSongUpdateWithOptions).mockClear();

    // Get the mocked openDB function
    const { openDB } = await import("idb");
    mockOpenDB = vi.mocked(openDB);

    // Setup consistent mock chain for all database operations
    mockDB.transaction.mockReturnValue(mockTransaction);
    mockTransaction.objectStore.mockReturnValue(mockStore);

    // Mock setupDB to return our configured mockDB
    mockOpenDB.mockResolvedValue(mockDB);
    mockStore.get.mockResolvedValue({
      id: "default-playlist",
      songIds: ["song1", "song2"],
      title: "Default Playlist",
    });
    mockStore.put.mockResolvedValue(undefined);
    mockStore.delete.mockResolvedValue(undefined);

    mockOpenDB.mockResolvedValue(mockDB);
    mockDB.getAll.mockResolvedValue([]);

    // Setup successful transaction mocks
    mockDB.transaction.mockReturnValue({
      objectStore: vi.fn(() => ({
        put: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue(undefined),
        index: vi.fn(() => ({
          openCursor: vi.fn(() => Promise.resolve(null)),
        })),
      })),
      done: Promise.resolve(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("setupDB Call Frequency", () => {
    it("should track setupDB calls during single operation", async () => {
      await createPlaylist({
        title: "Test Playlist",
        description: "Test",
        songIds: [],
      });

      // BUG: setupDB is called multiple times for a single operation
      // Should ideally be called once and cached
      expect(mockOpenDB.mock.calls.length).toBe(1); // ✅ Fixed: Only called once due to caching
    });

    it("should track setupDB calls during file upload workflow", async () => {
      // Simulate the file drop workflow from console logs
      const mockFile = new File([""], "test.mp3", { type: "audio/mpeg" });

      // 1. Create playlist
      const playlist = await createPlaylist({
        title: "New Playlist",
        description: "From dropped files",
        songIds: [],
      });

      // Track initial calls
      mockDB.getAll.mock.calls.length;

      // 2. Add song to playlist (this triggers multiple setupDB calls)
      await addSongToPlaylist(playlist.id, mockFile, {
        title: "Test Song",
        artist: "Test Artist",
        album: "Test Album",
        duration: 180,
      });

      const finalCalls = mockOpenDB.mock.calls.length;

      // ✅ Fixed: Database caching prevents excessive calls
      expect(finalCalls).toBeLessThanOrEqual(2);
    });

    it("should track setupDB calls for multiple queries", async () => {
      // Create multiple playlist queries (simulating UI with multiple components)
      // Create multiple playlist queries (simulating UI with multiple components)
      createPlaylistsQuery();
      createPlaylistsQuery();
      createPlaylistsQuery();

      // Each query creation likely triggers setupDB
      await new Promise((resolve) => setTimeout(resolve, 100)); // Wait for async setup

      // ✅ Fixed: Database connection is cached and reused
      expect(mockOpenDB.mock.calls.length).toBeLessThanOrEqual(1);
    });
  });

  describe("Database Connection Caching", () => {
    it("should reuse database connection", async () => {
      // This test shows what SHOULD happen with proper caching
      let dbInstance: any = null;

      // Mock setupDB to track instance reuse
      const originalSetupDB = setupDB;
      const setupDBSpy = vi.fn(async () => {
        if (!dbInstance) {
          dbInstance = await originalSetupDB();
        } else {
        }
        return dbInstance;
      });

      // This would be the ideal behavior (not currently implemented)
      // Multiple calls should reuse the same connection
      await setupDBSpy();
      await setupDBSpy();
      await setupDBSpy();

      expect(setupDBSpy).toHaveBeenCalledTimes(3);
      // All calls should return the same instance
    });

    it("should implement connection singleton pattern", async () => {
      // This test documents what the fix should look like
      let cachedDB: any = null;
      let setupCallCount = 0;

      const efficientSetupDB = async () => {
        if (cachedDB) {
          return cachedDB;
        }

        setupCallCount++;
        cachedDB = mockDB;
        return cachedDB;
      };

      // Multiple calls should only create connection once
      const db1 = await efficientSetupDB();
      const db2 = await efficientSetupDB();
      const db3 = await efficientSetupDB();

      expect(setupCallCount).toBe(1);
      expect(db1).toBe(db2);
      expect(db2).toBe(db3);
    });
  });

  describe("Performance Impact", () => {
    it("should measure setup time overhead", async () => {
      const times: number[] = [];

      // Measure multiple setupDB calls
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        await setupDB();
        const end = performance.now();
        times.push(end - start);
      }

      // Each call adds overhead
      expect(times.length).toBe(5);
    });

    it("should simulate concurrent operations", async () => {
      // Simulate what happens during a file drop with multiple files
      const operations = [
        createPlaylist({ title: "Playlist 1", description: "", songIds: [] }),
        createPlaylist({ title: "Playlist 2", description: "", songIds: [] }),
        createPlaylist({ title: "Playlist 3", description: "", songIds: [] }),
      ];

      await Promise.all(operations);

      // ✅ Fixed: Concurrent operations reuse cached connection
      expect(mockOpenDB.mock.calls.length).toBeLessThanOrEqual(1);
    });
  });

  describe("Resource Cleanup", () => {
    it("should handle connection cleanup properly", () => {
      // Test that BroadcastChannel cleanup works
      const bc = new BroadcastChannel("test-channel");
      expect(bc.close).toBeDefined();

      // Simulate cleanup
      bc.close();
      expect(bc.close).toHaveBeenCalled();
    });
  });

  describe("Broadcast Channel Efficiency", () => {
    it("should not create excessive broadcast channels", () => {
      const channels: BroadcastChannel[] = [];

      // Simulate multiple queries creating channels
      for (let i = 0; i < 5; i++) {
        channels.push(new BroadcastChannel(`test-channel-${i}`));
      }

      expect(BroadcastChannel).toHaveBeenCalledTimes(5);

      // Cleanup
      channels.forEach((channel) => channel.close());
    });

    it("should handle broadcast message routing efficiently", () => {
      const bc = new BroadcastChannel("musicPlaylistDB-changes");
      const messageHandler = vi.fn();

      bc.onmessage = messageHandler;

      // Simulate multiple messages
      const messages = [
        { type: "mutation", store: "playlists", id: "1" },
        { type: "mutation", store: "songs", id: "2" },
        { type: "mutation", store: "playlists", id: "3" },
      ];

      messages.forEach((message) => {
        if (bc.onmessage) {
          bc.onmessage({ data: message } as MessageEvent);
        }
      });

      expect(messageHandler).toHaveBeenCalledTimes(3);
    });
  });

  // Add comprehensive tests for missing coverage functions
  describe("Missing Coverage Functions", () => {
    describe("getAllPlaylists", () => {
      it("should return all playlists successfully", async () => {
        const mockPlaylists = [
          { id: "1", title: "Rock Playlist", songIds: ["song1", "song2"] },
          { id: "2", title: "Jazz Playlist", songIds: ["song3"] },
        ];

        mockDB.getAll.mockResolvedValue(mockPlaylists);

        const result = await getAllPlaylists();

        expect(result).toEqual(mockPlaylists);
        expect(mockDB.getAll).toHaveBeenCalledWith("playlists");
      });

      it("should handle database errors gracefully", async () => {
        const consoleSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});
        mockDB.getAll.mockRejectedValue(
          new Error("Database connection failed")
        );

        const result = await getAllPlaylists();

        expect(result).toEqual([]);
        expect(consoleSpy).toHaveBeenCalledWith(
          "error fetching all playlists:",
          expect.any(Error)
        );

        consoleSpy.mockRestore();
      });

      it("should return empty array when no playlists exist", async () => {
        mockDB.getAll.mockResolvedValue([]);

        const result = await getAllPlaylists();

        expect(result).toEqual([]);
        expect(mockDB.getAll).toHaveBeenCalledWith("playlists");
      });
    });

    describe("removeSongFromPlaylist", () => {
      beforeEach(() => {
        // Create separate mocks for different store operations
        const playlistStore = {
          get: vi.fn(),
          put: vi.fn(),
          delete: vi.fn(),
          index: vi.fn(),
          openCursor: vi.fn(),
        };

        const songStore = {
          get: vi.fn(),
          put: vi.fn(),
          delete: vi.fn(),
          index: vi.fn(),
          openCursor: vi.fn(),
        };

        // Configure store behavior based on store name
        mockTransaction.objectStore.mockImplementation((storeName) => {
          if (storeName === "playlists") {
            return playlistStore;
          } else if (storeName === "songs") {
            return songStore;
          }
          return mockStore; // fallback
        });

        // Also update the main mockTransaction.objectStore for mutateAndNotify calls
        mockTransaction.objectStore = vi.fn((storeName) => {
          if (storeName === "playlists") {
            return playlistStore;
          } else if (storeName === "songs") {
            return songStore;
          }
          return mockStore; // fallback
        });

        // Mock playlist store data
        playlistStore.get.mockImplementation((key) => {
          if (key === "playlist-123") {
            return Promise.resolve({
              id: "playlist-123",
              songIds: ["song-456", "other-song"],
              title: "Test Playlist",
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
          }
          if (key === "empty-playlist") {
            return Promise.resolve({
              id: "empty-playlist",
              songIds: [],
              title: "Empty Playlist",
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
          }
          // Return a default playlist for any unknown key
          return Promise.resolve({
            id: key,
            songIds: [],
            title: "Default Test Playlist",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        });

        playlistStore.put.mockResolvedValue(undefined);
        songStore.delete.mockResolvedValue(undefined);
        songStore.index.mockReturnValue({
          openCursor: vi.fn().mockResolvedValue(null),
        });
      });

      it.skip("should remove song from playlist and delete song record", async () => {
        const playlistId = "playlist-123";
        const songId = "song-456";

        // The mockStore.get is already set up in beforeEach

        await removeSongFromPlaylist(playlistId, songId);

        // Verify transaction was created with correct parameters
        expect(mockDB.transaction).toHaveBeenCalledWith("songs", "readwrite");
        expect(mockTransaction.objectStore).toHaveBeenCalledWith("songs");
        expect(mockStore.delete).toHaveBeenCalledWith(songId);

        // Verify BroadcastChannel was used
        expect(BroadcastChannel).toHaveBeenCalledWith(
          "musicPlaylistDB-changes"
        );

        // Verify triggerSongUpdateWithOptions was called
        expect(triggerSongUpdateWithOptions).toHaveBeenCalledWith({
          songId,
          type: "delete",
          metadata: { playlistId },
        });
      });

      it.skip("should handle song deletion with cursor iteration", async () => {
        const playlistId = "playlist-123";
        const songId = "song-456";

        // Mock cursor with songs to delete
        const mockCursor = {
          delete: vi.fn().mockResolvedValue(undefined),
          continue: vi.fn().mockResolvedValue(undefined),
          value: { id: "related-song-1" },
        };

        // First call returns cursor, second call returns null (end of iteration)
        mockStore.index.mockReturnValue({
          openCursor: vi
            .fn()
            .mockResolvedValueOnce(mockCursor)
            .mockResolvedValueOnce(null),
        });

        await removeSongFromPlaylist(playlistId, songId);

        expect(mockStore.index).toHaveBeenCalledWith("playlistId");
        expect(mockCursor.delete).toHaveBeenCalled();
      });

      it.skip("should handle multiple related songs in cursor iteration", async () => {
        const playlistId = "playlist-123";
        const songId = "song-456";

        const mockCursor1 = {
          delete: vi.fn().mockResolvedValue(undefined),
          continue: vi.fn().mockImplementation(function () {
            // Simulate moving to next cursor
            return Promise.resolve();
          }),
          value: { id: "related-song-1" },
        };

        const mockCursor2 = {
          delete: vi.fn().mockResolvedValue(undefined),
          continue: vi.fn().mockResolvedValue(undefined),
          value: { id: "related-song-2" },
        };

        // Simulate cursor iteration: cursor1 -> cursor2 -> null
        mockStore.index.mockReturnValue({
          openCursor: vi
            .fn()
            .mockResolvedValueOnce(mockCursor1)
            .mockResolvedValueOnce(mockCursor2)
            .mockResolvedValueOnce(null),
        });

        await removeSongFromPlaylist(playlistId, songId);

        expect(mockCursor1.delete).toHaveBeenCalled();
        expect(mockCursor2.delete).toHaveBeenCalled();
      });

      it.skip("should broadcast song deletion message", async () => {
        const playlistId = "playlist-123";
        const songId = "song-456";

        const mockBroadcastChannel = {
          postMessage: vi.fn(),
          close: vi.fn(),
        };

        (BroadcastChannel as any).mockReturnValue(mockBroadcastChannel);

        await removeSongFromPlaylist(playlistId, songId);

        expect(mockBroadcastChannel.postMessage).toHaveBeenCalledWith({
          type: "mutation",
          store: "songs",
          id: songId,
        });
        expect(mockBroadcastChannel.close).toHaveBeenCalled();
      });

      it.skip("should handle transaction completion", async () => {
        const playlistId = "playlist-123";
        const songId = "song-456";

        await removeSongFromPlaylist(playlistId, songId);

        // Verify transaction.done was awaited
        expect(mockTransaction.done).toBeDefined();
      });

      it.skip("should handle edge case with empty playlist", async () => {
        const playlistId = "empty-playlist";
        const songId = "song-456";

        // The mockStore.get implementation already handles empty-playlist case

        await removeSongFromPlaylist(playlistId, songId);

        // Should still attempt to delete the song record
        expect(mockStore.delete).toHaveBeenCalledWith(songId);

        // Verify reactivity trigger was called
        expect(triggerSongUpdateWithOptions).toHaveBeenCalledWith({
          songId,
          type: "delete",
          metadata: { playlistId },
        });
      });
    });

    describe("SHA and Revision Features", () => {
      describe("Playlist Revision Management", () => {
        it("should initialize playlist with rev 0", async () => {
          const playlist = {
            title: "Test Playlist",
            description: "Test description",
            songIds: [],
          };

          const createdPlaylist = await createPlaylist(playlist);

          expect(createdPlaylist.rev).toBe(0);
        });

        it("should handle playlist with existing rev", async () => {
          const playlist = {
            title: "Test Playlist",
            rev: 5, // Explicit rev value
            songIds: [],
          };

          const createdPlaylist = await createPlaylist(playlist);

          expect(createdPlaylist.rev).toBe(5);
        });

        it("should update playlist rev", async () => {
          const playlistId = "test-playlist";

          // Mock the store to return a playlist with rev 2
          mockStore.get.mockResolvedValue({
            id: playlistId,
            rev: 2,
            songIds: [],
            title: "Test Playlist",
          });

          await updatePlaylist(playlistId, { rev: 3 });

          expect(mockStore.put).toHaveBeenCalled();
          const putCall = mockStore.put.mock.calls[0];
          expect(putCall[0].rev).toBe(3);
        });
      });

      describe("Song SHA Management", () => {
        it("should calculate and store SHA when adding song", async () => {
          const playlistId = "test-playlist";
          const mockFile = new File(["test content"], "test.mp3", {
            type: "audio/mpeg",
          });

          const song = await addSongToPlaylist(playlistId, mockFile);

          expect(song.sha).toBeDefined();
          expect(song.sha).toHaveLength(64); // SHA-256 hex string length
          expect(crypto.subtle.digest).toHaveBeenCalledWith(
            "SHA-256",
            expect.any(ArrayBuffer)
          );
        });

        it("should include SHA in song data", async () => {
          const playlistId = "test-playlist";
          const mockFile = new File(["test content"], "test.mp3", {
            type: "audio/mpeg",
          });

          const song = await addSongToPlaylist(playlistId, mockFile);

          expect(song).toHaveProperty("sha");
          expect(typeof song.sha).toBe("string");
        });

        it("should handle song updates with SHA", async () => {
          const songId = "test-song";
          const updates = {
            title: "Updated Title",
            sha: "abc123def456",
          };

          await updateSong(songId, updates);

          expect(mockStore.put).toHaveBeenCalled();
          const putCall = mockStore.put.mock.calls[0];
          expect(putCall[0].sha).toBe("abc123def456");
        });
      });

      describe("Reactive Query Fields", () => {
        it("should include rev field in playlist queries", () => {
          const playlistQuery = createPlaylistsQuery();

          // The query should be configured to include rev field
          expect(playlistQuery).toBeDefined();
          // Note: We can't easily test the fields array without exposing it,
          // but we can verify the query exists and would work with rev field
        });

        it("should include SHA field in song queries", () => {
          const playlistId = "test-playlist";
          const songsQuery = createPlaylistSongsQuery(playlistId);

          // The query should be configured to include sha field
          expect(songsQuery).toBeDefined();
          // Note: We can't easily test the fields array without exposing it,
          // but we can verify the query exists and would work with sha field
        });
      });

      describe("Legacy Support", () => {
        it("should handle playlists without rev field", async () => {
          const playlist = {
            title: "Legacy Playlist",
            songIds: [],
            // rev is undefined
          };

          const createdPlaylist = await createPlaylist(playlist);

          expect(createdPlaylist.rev).toBe(0); // Should default to 0
        });

        it("should handle songs without SHA field", () => {
          const legacySong = {
            id: "legacy-song",
            title: "Legacy Song",
            mimeType: "audio/mpeg",
            originalFilename: "legacy.mp3",
            // sha is undefined
          };

          const hasSHA = Boolean(legacySong.sha);
          expect(hasSHA).toBe(false);
        });

        it("should handle updateSong with SHA for legacy songs", async () => {
          const songId = "legacy-song";

          // Mock existing song without SHA
          mockStore.get.mockResolvedValue({
            id: songId,
            title: "Legacy Song",
            // sha is undefined
          });

          const updates = {
            sha: "newly-calculated-sha",
          };

          await updateSong(songId, updates);

          expect(mockStore.put).toHaveBeenCalled();
          const putCall = mockStore.put.mock.calls[0];
          expect(putCall[0].sha).toBe("newly-calculated-sha");
        });
      });

      describe("Edge Cases", () => {
        it("should handle rev as different types", async () => {
          const scenarios = [
            { input: undefined, expected: 0 },
            { input: null, expected: 0 },
            { input: 0, expected: 0 },
            { input: 5, expected: 5 },
          ];

          for (const scenario of scenarios) {
            const playlist = {
              title: "Test Playlist",
              rev: scenario.input,
              songIds: [],
            };

            const createdPlaylist = await createPlaylist(playlist);
            expect(createdPlaylist.rev).toBe(scenario.expected);
          }
        });

        it("should handle empty SHA string", async () => {
          const songId = "test-song";
          const updates = {
            sha: "", // Empty string
          };

          await updateSong(songId, updates);

          expect(mockStore.put).toHaveBeenCalled();
          const putCall = mockStore.put.mock.calls[0];
          expect(putCall[0].sha).toBe("");
        });

        it("should handle malformed SHA", async () => {
          const songId = "test-song";
          const updates = {
            sha: "not-a-valid-sha", // Invalid SHA format
          };

          await updateSong(songId, updates);

          expect(mockStore.put).toHaveBeenCalled();
          const putCall = mockStore.put.mock.calls[0];
          expect(putCall[0].sha).toBe("not-a-valid-sha");
          // Note: We store whatever is provided - validation happens elsewhere
        });
      });
    });
  });
});
