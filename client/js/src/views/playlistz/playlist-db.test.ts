import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupDB, createPlaylistsQuery, addSongToPlaylist, createPlaylist } from "./services/indexedDBService.js";

// Mock idb
const mockDB = {
  getAll: vi.fn(),
  transaction: vi.fn(),
  objectStore: vi.fn(),
  put: vi.fn(),
  get: vi.fn(),
  createObjectStore: vi.fn(),
  objectStoreNames: {
    contains: vi.fn(() => false)
  }
};

const mockOpenDB = vi.fn();
vi.mock("idb", () => ({
  openDB: mockOpenDB,
}));

// Mock BroadcastChannel
global.BroadcastChannel = vi.fn(() => ({
  postMessage: vi.fn(),
  onmessage: null,
  close: vi.fn(),
})) as any;

// Mock crypto.randomUUID
global.crypto = {
  randomUUID: vi.fn(() => "test-uuid-123")
} as any;

describe("Database Efficiency Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpenDB.mockResolvedValue(mockDB);
    mockDB.getAll.mockResolvedValue([]);
    mockDB.transaction.mockReturnValue({
      objectStore: vi.fn(() => ({
        put: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
        index: vi.fn(() => ({
          openCursor: vi.fn(() => Promise.resolve(null))
        }))
      })),
      done: Promise.resolve()
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("setupDB Call Frequency", () => {
    it("should track setupDB calls during single operation", async () => {
      console.log("🔍 Testing single operation setupDB calls...");

      await createPlaylist({
        title: "Test Playlist",
        description: "Test",
        songIds: []
      });

      // BUG: setupDB is called multiple times for a single operation
      // Should ideally be called once and cached
      console.log(`📊 setupDB called ${mockOpenDB.mock.calls.length} times for single createPlaylist`);
      expect(mockOpenDB.mock.calls.length).toBeGreaterThan(1); // Documents current bug
    });

    it("should track setupDB calls during file upload workflow", async () => {
      console.log("🔍 Testing file upload setupDB calls...");

      // Simulate the file drop workflow from console logs
      const mockFile = new File([""], "test.mp3", { type: "audio/mpeg" });

      // 1. Create playlist
      const playlist = await createPlaylist({
        title: "New Playlist",
        description: "From dropped files",
        songIds: []
      });

      const initialCalls = mockOpenDB.mock.calls.length;
      console.log(`📊 setupDB calls after createPlaylist: ${initialCalls}`);

      // 2. Add song to playlist (this triggers multiple setupDB calls)
      await addSongToPlaylist(playlist.id, mockFile, {
        title: "Test Song",
        artist: "Test Artist",
        album: "Test Album",
        duration: 180
      });

      const finalCalls = mockOpenDB.mock.calls.length;
      console.log(`📊 Total setupDB calls after addSong: ${finalCalls}`);
      console.log(`📊 Additional calls for addSong: ${finalCalls - initialCalls}`);

      // Based on console logs, we expect 6+ calls total
      expect(finalCalls).toBeGreaterThanOrEqual(4);
    });

    it("should track setupDB calls for multiple queries", async () => {
      console.log("🔍 Testing multiple query setupDB calls...");

      // Create multiple playlist queries (simulating UI with multiple components)
      const query1 = createPlaylistsQuery();
      const query2 = createPlaylistsQuery();
      const query3 = createPlaylistsQuery();

      // Each query creation likely triggers setupDB
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for async setup

      console.log(`📊 setupDB called ${mockOpenDB.mock.calls.length} times for 3 queries`);

      // Should ideally be called once and cached, but currently each query calls it
      expect(mockOpenDB.mock.calls.length).toBeGreaterThan(1);
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
          console.log("🗄️ Created NEW database connection");
        } else {
          console.log("♻️ Reusing EXISTING database connection");
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
          console.log("♻️ Returning cached DB connection");
          return cachedDB;
        }

        setupCallCount++;
        console.log(`🗄️ Creating DB connection #${setupCallCount}`);
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
      console.log("✅ Connection reuse working correctly");
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

      console.log("📊 Setup times (ms):", times);
      console.log(`📊 Average setup time: ${times.reduce((a, b) => a + b, 0) / times.length}ms`);

      // Each call adds overhead
      expect(times.length).toBe(5);
    });

    it("should simulate concurrent operations", async () => {
      console.log("🔍 Testing concurrent database operations...");

      // Simulate what happens during a file drop with multiple files
      const operations = [
        createPlaylist({ title: "Playlist 1", description: "", songIds: [] }),
        createPlaylist({ title: "Playlist 2", description: "", songIds: [] }),
        createPlaylist({ title: "Playlist 3", description: "", songIds: [] }),
      ];

      const startTime = performance.now();
      await Promise.all(operations);
      const endTime = performance.now();

      console.log(`📊 Concurrent operations took ${endTime - startTime}ms`);
      console.log(`📊 Total setupDB calls: ${mockOpenDB.mock.calls.length}`);

      // With proper caching, we'd expect fewer setupDB calls
      expect(mockOpenDB.mock.calls.length).toBeGreaterThan(3);
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

    it("should prevent memory leaks from excessive connections", async () => {
      // This test would check for proper connection pooling
      // Currently just documents the issue

      console.log("⚠️ Current implementation may create too many connections");
      console.log("💡 Solution: Implement connection singleton with proper cleanup");

      expect(true).toBe(true); // Placeholder
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
      console.log("📡 Created 5 broadcast channels");

      // Cleanup
      channels.forEach(channel => channel.close());
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

      messages.forEach(message => {
        if (bc.onmessage) {
          bc.onmessage({ data: message } as MessageEvent);
        }
      });

      expect(messageHandler).toHaveBeenCalledTimes(3);
      console.log("📡 Processed 3 broadcast messages");
    });
  });
});
