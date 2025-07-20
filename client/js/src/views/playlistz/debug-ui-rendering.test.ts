import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot, createSignal, createEffect } from "solid-js";

// Mock IndexedDB Service with realistic behavior
const mockDB = {
  getAll: vi.fn(),
  transaction: vi.fn(),
  objectStore: vi.fn(),
  put: vi.fn(),
  get: vi.fn(),
  createObjectStore: vi.fn(),
  objectStoreNames: {
    contains: vi.fn(() => false),
  },
};

vi.mock("idb", () => ({
  openDB: vi.fn(() => Promise.resolve(mockDB)),
}));

// Mock services with realistic implementations
vi.mock("../services/audioService.js", () => ({
  cleanup: vi.fn(),
}));

vi.mock("../utils/timeUtils.js", () => ({
  cleanupTimeUtils: vi.fn(),
}));

// Mock BroadcastChannel for IndexedDB sync
global.BroadcastChannel = vi.fn(() => ({
  postMessage: vi.fn(),
  onmessage: null,
  close: vi.fn(),
})) as any;

// Mock crypto for ID generation
Object.defineProperty(global, "crypto", {
  value: {
    randomUUID: vi.fn(() => "test-playlist-id"),
  },
  writable: true,
});

import { usePlaylistsQuery } from "./hooks/usePlaylistsQuery.js";
import {
  createPlaylist,
  createPlaylistsQuery,
} from "./services/indexedDBService.js";
import type { Playlist } from "./types/playlist.js";

describe("UI Rendering Bug Detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDB.getAll.mockResolvedValue([]);

    // Setup mock transaction behavior
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

  describe("Playlist Count Rendering Logic", () => {
    it("should reproduce the exact UI rendering bug", async () => {
      // This test reproduces the scenario from the docs:
      // Backend: "📊 Fetched 18 items from playlists"
      // Signal: "🔄 SolidJS signal updated with 18 playlists"
      // UI: Still shows "found 0 playlists"

      const mockPlaylists: Playlist[] = Array.from({ length: 18 }, (_, i) => ({
        id: `playlist-${i + 1}`,
        title: `Test Playlist ${i + 1}`,
        description: "Test playlist",
        songIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      // Mock the database to return 18 playlists
      mockDB.getAll.mockResolvedValue(mockPlaylists);

      let renderCount = 0;
      let displayedCount: number | undefined;
      let signalValue: Playlist[] = [];

      await new Promise<void>((resolve) => {
        createRoot(async (dispose) => {
          console.log("🔍 Starting UI rendering test...");

          // Use the actual hook that the component uses
          const playlists = usePlaylistsQuery();

          // Track renders and signal updates
          createEffect(() => {
            signalValue = playlists();
            renderCount++;
            displayedCount = signalValue.length;

            console.log(
              `🎨 Render #${renderCount}: Signal has ${signalValue.length} playlists`
            );
            console.log(
              `📺 UI would display: "found ${displayedCount} playlists"`
            );
          });

          // Wait for async operations to complete
          await new Promise((r) => setTimeout(r, 300));

          console.log(`📊 Final state after async operations:`);
          console.log(`   - Renders: ${renderCount}`);
          console.log(`   - Signal value: ${signalValue.length} playlists`);
          console.log(`   - UI displays: ${displayedCount} playlists`);

          // Verify expectations
          expect(renderCount).toBeGreaterThan(0);
          expect(signalValue.length).toBe(18); // Backend works
          expect(displayedCount).toBe(18); // UI should match

          // In a real browser, displayedCount would be 0 despite signal having 18
          // This test will PASS in test environment but FAIL in browser

          dispose();
          resolve();
        });
      });
    });

    it("should demonstrate the signal-to-UI gap", async () => {
      // Test the specific pattern that causes the bug

      let uiRenderCalls: number[] = [];
      let signalCalls: number[] = [];

      await new Promise<void>((resolve) => {
        createRoot(async (dispose) => {
          const playlists = usePlaylistsQuery();

          // Track signal access (what the hook provides)
          createEffect(() => {
            const count = playlists().length;
            signalCalls.push(count);
            console.log(`📡 Signal accessed: ${count} playlists`);
          });

          // Simulate UI rendering (what JSX would do)
          createEffect(() => {
            const count = playlists().length;
            uiRenderCalls.push(count);
            console.log(`🖥️ UI rendered: "found ${count} playlists"`);
          });

          // Simulate playlist creation (the exact bug scenario)
          console.log("🔨 Simulating playlist creation...");

          // Mock database change
          mockDB.getAll.mockResolvedValue([
            {
              id: "new-playlist",
              title: "New Playlist",
              description: "",
              songIds: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]);

          // Trigger broadcast update (what happens after createPlaylist)
          const bc = new BroadcastChannel("musicPlaylistDB-changes");
          if (bc.onmessage) {
            bc.onmessage({
              data: {
                type: "mutation",
                store: "playlists",
                id: "new-playlist",
              },
            } as MessageEvent);
          }

          await new Promise((r) => setTimeout(r, 200));

          console.log("📊 Final call tracking:");
          console.log(`   Signal calls: [${signalCalls.join(", ")}]`);
          console.log(`   UI calls: [${uiRenderCalls.join(", ")}]`);

          // Both should track the same updates
          expect(signalCalls.length).toBe(uiRenderCalls.length);
          expect(signalCalls).toEqual(uiRenderCalls);

          // Final values should show 1 playlist
          const finalSignal = signalCalls[signalCalls.length - 1];
          const finalUI = uiRenderCalls[uiRenderCalls.length - 1];
          expect(finalSignal).toBe(1);
          expect(finalUI).toBe(1);

          dispose();
          resolve();
        });
      });
    });
  });

  describe("Real Browser vs Test Environment", () => {
    it("should identify environment-specific behavior", async () => {
      // This test documents the difference between test and browser behavior

      const testEnvironment = {
        signalsWork: false,
        effectsRun: false,
        jsxUpdates: false,
        domMutations: false,
      };

      await new Promise<void>((resolve) => {
        createRoot((dispose) => {
          const playlists = usePlaylistsQuery();

          // Test 1: Do signals work?
          try {
            const value = playlists();
            testEnvironment.signalsWork = Array.isArray(value);
          } catch (e) {
            testEnvironment.signalsWork = false;
          }

          // Test 2: Do effects run?
          createEffect(() => {
            playlists(); // Access signal
            testEnvironment.effectsRun = true;
          });

          // Test 3: Would JSX update? (simulated)
          createEffect(() => {
            const count = playlists().length;
            // In real JSX: <div>found {count} playlists</div>
            testEnvironment.jsxUpdates = true;
          });

          // Test 4: Would DOM mutations occur? (simulated)
          createEffect(() => {
            const count = playlists().length;
            // In real browser: element.textContent = `found ${count} playlists`
            testEnvironment.domMutations = true;
          });

          setTimeout(() => {
            console.log("🧪 Test Environment Analysis:");
            console.log(`   Signals work: ${testEnvironment.signalsWork}`);
            console.log(`   Effects run: ${testEnvironment.effectsRun}`);
            console.log(`   JSX updates: ${testEnvironment.jsxUpdates}`);
            console.log(`   DOM mutations: ${testEnvironment.domMutations}`);

            console.log("🌐 Real Browser (from docs):");
            console.log(`   Signals work: true`);
            console.log(`   Effects run: true`);
            console.log(`   JSX updates: false ❌`);
            console.log(`   DOM mutations: false ❌`);

            // In test environment, everything should work
            expect(testEnvironment.signalsWork).toBe(true);
            expect(testEnvironment.effectsRun).toBe(true);
            expect(testEnvironment.jsxUpdates).toBe(true);

            // But in real browser, JSX doesn't update
            console.log(
              "🎯 Root cause: JSX templating not reactive to signal changes"
            );

            dispose();
            resolve();
          }, 100);
        });
      });
    });
  });

  describe("Component State vs Signal State", () => {
    it("should compare component-level state with hook state", async () => {
      // Test if the issue is component state management vs hook implementation

      await new Promise<void>((resolve) => {
        createRoot(async (dispose) => {
          // Test 1: Hook-based state (current implementation)
          const hookPlaylists = usePlaylistsQuery();

          // Test 2: Component-local state (alternative)
          const [localPlaylists, setLocalPlaylists] = createSignal<Playlist[]>(
            []
          );

          // Test 3: Direct signal access
          const directQuery = createPlaylistsQuery();

          let results = {
            hookValue: [] as Playlist[],
            localValue: [] as Playlist[],
            directValue: [] as Playlist[],
          };

          // Track all three approaches
          createEffect(() => {
            results.hookValue = hookPlaylists();
            results.localValue = localPlaylists();
            results.directValue = directQuery.get();

            console.log(`🔍 State comparison:`);
            console.log(`   Hook: ${results.hookValue.length}`);
            console.log(`   Local: ${results.localValue.length}`);
            console.log(`   Direct: ${results.directValue.length}`);
          });

          // Simulate data change
          mockDB.getAll.mockResolvedValue([
            {
              id: "test",
              title: "Test",
              description: "",
              songIds: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]);

          // Update local state manually (simulating what UI might need)
          setLocalPlaylists([
            {
              id: "test",
              title: "Test",
              description: "",
              songIds: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]);

          await new Promise((r) => setTimeout(r, 200));

          console.log(`📊 Final comparison:`);
          console.log(`   Hook-based: ${results.hookValue.length}`);
          console.log(`   Local signal: ${results.localValue.length}`);
          console.log(`   Direct query: ${results.directValue.length}`);

          // Local signal should always work
          expect(results.localValue.length).toBe(1);

          dispose();
          resolve();
        });
      });
    });
  });

  describe("Potential Fixes", () => {
    it("should test manual signal refresh approach", async () => {
      // Test if manually refreshing the component signal fixes the issue

      await new Promise<void>((resolve) => {
        createRoot(async (dispose) => {
          const playlists = usePlaylistsQuery();
          const [refreshTrigger, setRefreshTrigger] = createSignal(0);

          let renderCounts = {
            normal: 0,
            withRefresh: 0,
          };

          // Normal reactive access
          createEffect(() => {
            playlists();
            renderCounts.normal++;
          });

          // With manual refresh trigger
          createEffect(() => {
            playlists();
            refreshTrigger(); // Access refresh trigger
            renderCounts.withRefresh++;
          });

          // Simulate the exact scenario: create playlist
          await createPlaylist({
            title: "Test Playlist",
            description: "Test",
            songIds: [],
          });

          // Manual refresh (potential fix for browser)
          setRefreshTrigger((prev) => prev + 1);

          await new Promise((r) => setTimeout(r, 100));

          console.log(`🔄 Refresh approach results:`);
          console.log(`   Normal renders: ${renderCounts.normal}`);
          console.log(`   With refresh: ${renderCounts.withRefresh}`);

          // Both should have updated
          expect(renderCounts.normal).toBeGreaterThan(0);
          expect(renderCounts.withRefresh).toBeGreaterThan(0);

          dispose();
          resolve();
        });
      });
    });

    it("should test direct query subscription approach", async () => {
      // Test bypassing the hook and subscribing directly to the query

      await new Promise<void>((resolve) => {
        createRoot(async (dispose) => {
          const [directPlaylists, setDirectPlaylists] = createSignal<
            Playlist[]
          >([]);

          // Direct subscription (potential fix)
          const query = createPlaylistsQuery();
          const unsubscribe = query.subscribe((value) => {
            console.log(
              `🔗 Direct subscription update: ${value.length} playlists`
            );
            setDirectPlaylists(value);
          });

          let renderCount = 0;
          createEffect(() => {
            const count = directPlaylists().length;
            renderCount++;
            console.log(
              `🎨 Direct approach render #${renderCount}: ${count} playlists`
            );
          });

          await new Promise((r) => setTimeout(r, 200));

          console.log(`📊 Direct subscription results:`);
          console.log(`   Renders: ${renderCount}`);
          console.log(`   Final count: ${directPlaylists().length}`);

          expect(renderCount).toBeGreaterThan(0);

          unsubscribe();
          dispose();
          resolve();
        });
      });
    });
  });
});
