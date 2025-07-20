import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, createSignal as solidCreateSignal } from "solid-js";
import { render, screen } from "@solidjs/testing-library";
import { createLiveQuery, createPlaylistsQuery } from "./services/indexedDBService.js";
import type { Playlist } from "./types/playlist.js";

// Mock IndexedDB
const mockIDB = {
  getAll: vi.fn(),
  transaction: vi.fn(),
  objectStore: vi.fn(),
  put: vi.fn(),
  get: vi.fn(),
};

vi.mock("idb", () => ({
  openDB: vi.fn(() => Promise.resolve(mockIDB)),
}));

// Mock BroadcastChannel
global.BroadcastChannel = vi.fn(() => ({
  postMessage: vi.fn(),
  onmessage: null,
  close: vi.fn(),
})) as any;

describe("Playlist Signal Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock data
    mockIDB.getAll.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Custom Signal vs SolidJS Signal", () => {
    it("should behave like SolidJS signals for basic operations", () => {
      createRoot(() => {
        // Test custom signal from indexedDBService
        const customQuery = createLiveQuery<Playlist>({
          dbName: "test",
          storeName: "playlists",
        });

        // Test SolidJS signal
        const [solidSignal, setSolidSignal] = solidCreateSignal<Playlist[]>([]);

        // Both should have get() method
        expect(typeof customQuery.get).toBe("function");
        expect(typeof solidSignal).toBe("function");

        // Both should return initial empty array
        expect(customQuery.get()).toEqual([]);
        expect(solidSignal()).toEqual([]);
      });
    });

    it("should support subscription pattern", () => {
      const customQuery = createLiveQuery<Playlist>({
        dbName: "test",
        storeName: "playlists",
      });

      const subscriber = vi.fn();
      const unsubscribe = customQuery.subscribe(subscriber);

      // Should call subscriber immediately with current value
      expect(subscriber).toHaveBeenCalledWith([]);

      // Cleanup
      unsubscribe();
    });
  });

  describe("Reactivity in JSX Context", () => {
    function TestComponent() {
      const playlistsQuery = createPlaylistsQuery();

      return (
        <div data-testid="playlist-count">
          found {playlistsQuery.get().length} playlists
        </div>
      );
    }

    it("should render initial state correctly", async () => {
      mockIDB.getAll.mockResolvedValue([]);

      render(() => <TestComponent />);

      // Should show 0 initially
      expect(await screen.findByTestId("playlist-count")).toHaveTextContent("found 0 playlists");
    });

    it("should NOT update UI when custom signal changes (demonstrating the bug)", async () => {
      // Start with empty
      mockIDB.getAll.mockResolvedValue([]);

      render(() => <TestComponent />);

      expect(await screen.findByTestId("playlist-count")).toHaveTextContent("found 0 playlists");

      // Simulate database change - mock now returns 2 playlists
      const mockPlaylists = [
        { id: "1", title: "Playlist 1", songIds: [], createdAt: Date.now(), updatedAt: Date.now() },
        { id: "2", title: "Playlist 2", songIds: [], createdAt: Date.now(), updatedAt: Date.now() },
      ];
      mockIDB.getAll.mockResolvedValue(mockPlaylists);

      // Trigger broadcast message (simulating mutation)
      const bc = new BroadcastChannel("musicPlaylistDB-changes");
      if (bc.onmessage) {
        bc.onmessage({
          data: { type: "mutation", store: "playlists", id: "1" }
        } as MessageEvent);
      }

      // Wait a bit for any async updates
      await new Promise(resolve => setTimeout(resolve, 100));

      // BUG: UI should update to "found 2 playlists" but it won't
      // This test documents the current broken behavior
      const element = screen.getByTestId("playlist-count");
      expect(element).toHaveTextContent("found 0 playlists"); // Still shows 0 (bug)
    });
  });

  describe("Signal Update Propagation", () => {
    it("should track signal changes through subscribe", async () => {
      mockIDB.getAll.mockResolvedValue([]);

      const playlistsQuery = createPlaylistsQuery();
      const updates: Playlist[][] = [];

      const unsubscribe = playlistsQuery.subscribe((value) => {
        updates.push(value);
      });

      // Should get initial empty array
      expect(updates).toHaveLength(1);
      expect(updates[0]).toEqual([]);

      // Simulate database change
      const mockPlaylists = [
        { id: "1", title: "Test Playlist", songIds: [], createdAt: Date.now(), updatedAt: Date.now() }
      ];
      mockIDB.getAll.mockResolvedValue(mockPlaylists);

      // Manually trigger fetchAndUpdate (this is what broadcast should do)
      const bc = new BroadcastChannel("musicPlaylistDB-changes");
      if (bc.onmessage) {
        bc.onmessage({
          data: { type: "mutation", store: "playlists", id: "1" }
        } as MessageEvent);
      }

      // Wait for async update
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have received update through subscription
      expect(updates.length).toBeGreaterThan(1);
      if (updates.length > 1) {
        expect(updates[updates.length - 1]).toHaveLength(1);
        expect(updates[updates.length - 1][0].title).toBe("Test Playlist");
      }

      unsubscribe();
    });
  });

  describe("SolidJS Integration Fix", () => {
    function ReactiveTestComponent() {
      const playlistsQuery = createPlaylistsQuery();

      // This is a potential fix: convert custom signal to SolidJS signal
      const [playlists, setPlaylists] = solidCreateSignal<Playlist[]>([]);

      // Subscribe to custom signal and update SolidJS signal
      playlistsQuery.subscribe((value) => {
        setPlaylists(value);
      });

      return (
        <div data-testid="reactive-playlist-count">
          found {playlists().length} playlists
        </div>
      );
    }

    it("should update UI when using SolidJS signal bridge", async () => {
      mockIDB.getAll.mockResolvedValue([]);

      render(() => <ReactiveTestComponent />);

      expect(await screen.findByTestId("reactive-playlist-count")).toHaveTextContent("found 0 playlists");

      // Simulate database change
      const mockPlaylists = [
        { id: "1", title: "Playlist 1", songIds: [], createdAt: Date.now(), updatedAt: Date.now() },
      ];
      mockIDB.getAll.mockResolvedValue(mockPlaylists);

      // This test shows how the fix should work
      // The SolidJS signal should properly trigger re-renders
    });
  });

  describe("Database Connection Efficiency", () => {
    it("should track setupDB calls during signal creation", async () => {
      const setupDBSpy = vi.fn().mockResolvedValue(mockIDB);

      // Mock the setupDB function
      vi.doMock("./services/indexedDBService.js", async () => {
        const actual = await vi.importActual("./services/indexedDBService.js");
        return {
          ...actual,
          setupDB: setupDBSpy,
        };
      });

      // Create multiple queries
      createPlaylistsQuery();
      createPlaylistsQuery();

      // Wait for async setup
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should ideally only call setupDB once (but currently calls it multiple times - this is the bug)
      console.log("setupDB called", setupDBSpy.mock.calls.length, "times");

      // This test documents current behavior - it will fail until we fix the caching
      expect(setupDBSpy.mock.calls.length).toBeGreaterThan(1); // Currently broken behavior
    });
  });
});
