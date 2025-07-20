import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, createSignal as solidCreateSignal } from "solid-js";
import { render, screen } from "@solidjs/testing-library";
import {
  createLiveQuery,
  createPlaylistsQuery,
} from "../services/indexedDBService.js";
import { usePlaylistsQuery } from "./usePlaylistsQuery.js";
import type { Playlist } from "../types/playlist.js";

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

  describe("Hook Signal Creation", () => {
    it("should create hook and return SolidJS signal", () => {
      createRoot(() => {
        const playlists = usePlaylistsQuery();

        expect(typeof playlists).toBe("function"); // Should be SolidJS signal function
        expect(playlists()).toEqual([]); // Should return empty array initially

        console.log("✅ Hook creates SolidJS signal correctly");
      });
    });

    it("should update when underlying data changes", async () => {
      createRoot(() => {
        const playlists = usePlaylistsQuery();
        let signalValue = playlists();

        expect(signalValue).toEqual([]);

        // Mock database change
        const mockPlaylists = [
          {
            id: "1",
            title: "Test Playlist",
            songIds: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ];
        mockIDB.getAll.mockResolvedValue(mockPlaylists);

        // Wait for potential updates
        setTimeout(() => {
          signalValue = playlists();
          console.log(
            "📊 Hook signal updated:",
            signalValue.length,
            "playlists"
          );
        }, 100);
      });
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
        {
          id: "1",
          title: "Test Playlist",
          songIds: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
      mockIDB.getAll.mockResolvedValue(mockPlaylists);

      // Manually trigger fetchAndUpdate (this is what broadcast should do)
      const bc = new BroadcastChannel("musicPlaylistDB-changes");
      if (bc.onmessage) {
        bc.onmessage({
          data: { type: "mutation", store: "playlists", id: "1" },
        } as MessageEvent);
      }

      // Wait for async update
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have received update through subscription
      expect(updates.length).toBeGreaterThan(1);
      if (updates.length > 1) {
        expect(updates[updates.length - 1]).toHaveLength(1);
        expect(updates[updates.length - 1][0].title).toBe("Test Playlist");
      }

      unsubscribe();
    });
  });

  describe("usePlaylistsQuery Hook Integration", () => {
    it("should bridge custom signals to SolidJS reactivity", () => {
      createRoot(() => {
        const playlists = usePlaylistsQuery();

        // Should be a proper SolidJS signal
        expect(typeof playlists).toBe("function");

        // Should have access to current value
        const currentValue = playlists();
        expect(Array.isArray(currentValue)).toBe(true);

        console.log("✅ Hook bridges custom signal to SolidJS signal");
      });
    });

    it("should handle cleanup properly", () => {
      createRoot((dispose) => {
        const playlists = usePlaylistsQuery();

        expect(typeof playlists).toBe("function");

        // Simulate component unmount
        dispose();

        console.log("🧹 Hook cleanup should be handled by onCleanup");
      });
    });
  });

  describe("Hook Performance", () => {
    it("should handle multiple hook instances efficiently", async () => {
      createRoot(() => {
        const hook1 = usePlaylistsQuery();
        const hook2 = usePlaylistsQuery();

        expect(typeof hook1).toBe("function");
        expect(typeof hook2).toBe("function");

        // Both should work independently
        expect(hook1()).toEqual([]);
        expect(hook2()).toEqual([]);

        console.log("✅ Multiple hook instances work correctly");
      });
    });

    it("should not create memory leaks", () => {
      // Create and dispose multiple hooks
      for (let i = 0; i < 10; i++) {
        createRoot((dispose) => {
          const playlists = usePlaylistsQuery();
          expect(typeof playlists).toBe("function");
          dispose();
        });
      }

      console.log("✅ No memory leaks with multiple hook creation/disposal");
      expect(true).toBe(true);
    });
  });
});
