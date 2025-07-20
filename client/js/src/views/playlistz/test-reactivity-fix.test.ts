import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot, createEffect } from "solid-js";

// Mock IndexedDB Service
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

// Mock BroadcastChannel
global.BroadcastChannel = vi.fn(() => ({
  postMessage: vi.fn(),
  onmessage: null,
  close: vi.fn(),
})) as any;

// Mock crypto.randomUUID
Object.defineProperty(global, "crypto", {
  value: {
    randomUUID: vi.fn(() => "test-uuid-123"),
  },
  writable: true,
});

import { usePlaylistsQuery } from "./hooks/usePlaylistsQuery.js";
import { createPlaylist } from "./services/indexedDBService.js";

describe("Reactivity Fix Verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("should trigger effects when playlists change", async () => {
    let effectRuns = 0;
    let lastCount = -1;

    await new Promise<void>((resolve) => {
      createRoot(async (dispose) => {
        console.log("🧪 Testing fixed reactivity...");

        const playlists = usePlaylistsQuery();

        // This effect should run when playlists change
        createEffect(() => {
          const count = playlists().length;
          effectRuns++;
          lastCount = count;
          console.log(`🎯 Effect run #${effectRuns}: ${count} playlists`);
        });

        // Wait for initial effect
        await new Promise(r => setTimeout(r, 100));
        console.log(`📊 Initial state: ${effectRuns} effects, ${lastCount} playlists`);

        // Create a playlist to trigger update
        console.log("🔨 Creating playlist to test reactivity...");
        await createPlaylist({
          title: "Test Playlist",
          description: "Test",
          songIds: [],
        });

        // Wait for effects to propagate
        await new Promise(r => setTimeout(r, 200));

        console.log(`📊 Final state: ${effectRuns} effects, ${lastCount} playlists`);
        console.log(`✅ Effects triggered: ${effectRuns > 1 ? "YES" : "NO"}`);

        // The fix should ensure effects run more than once
        expect(effectRuns).toBeGreaterThan(1);

        dispose();
        resolve();
      });
    });
  });

  it("should update UI when playlist count changes", async () => {
    let uiUpdateCount = 0;
    let displayedCount = 0;

    await new Promise<void>((resolve) => {
      createRoot(async (dispose) => {
        console.log("🖥️ Testing UI update simulation...");

        const playlists = usePlaylistsQuery();

        // Simulate UI rendering effect
        createEffect(() => {
          const count = playlists().length;
          uiUpdateCount++;
          displayedCount = count;
          console.log(`🖼️ UI update #${uiUpdateCount}: displaying ${count} playlists`);
        });

        // Initial state
        await new Promise(r => setTimeout(r, 100));
        const initialUpdates = uiUpdateCount;
        const initialDisplay = displayedCount;

        // Mock data change to simulate playlist creation
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

        // Trigger broadcast update
        const bc = new BroadcastChannel("musicPlaylistDB-changes");
        if (bc.onmessage) {
          bc.onmessage({
            data: { type: "mutation", store: "playlists", id: "new-playlist" },
          } as MessageEvent);
        }

        // Wait for updates
        await new Promise(r => setTimeout(r, 300));

        console.log(`📊 UI Update Results:`);
        console.log(`   Initial: ${initialUpdates} updates, showing ${initialDisplay}`);
        console.log(`   Final: ${uiUpdateCount} updates, showing ${displayedCount}`);
        console.log(`   Change detected: ${uiUpdateCount > initialUpdates ? "YES" : "NO"}`);

        // UI should have updated
        expect(uiUpdateCount).toBeGreaterThan(initialUpdates);

        dispose();
        resolve();
      });
    });
  });

  it("should handle rapid playlist updates", async () => {
    let allCounts: number[] = [];

    await new Promise<void>((resolve) => {
      createRoot(async (dispose) => {
        console.log("⚡ Testing rapid updates...");

        const playlists = usePlaylistsQuery();

        createEffect(() => {
          const count = playlists().length;
          allCounts.push(count);
          console.log(`📊 Count update: ${count} (total updates: ${allCounts.length})`);
        });

        // Simulate rapid playlist creation
        for (let i = 1; i <= 3; i++) {
          mockDB.getAll.mockResolvedValue(
            Array.from({ length: i }, (_, idx) => ({
              id: `playlist-${idx + 1}`,
              title: `Playlist ${idx + 1}`,
              description: "",
              songIds: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            }))
          );

          const bc = new BroadcastChannel("musicPlaylistDB-changes");
          if (bc.onmessage) {
            bc.onmessage({
              data: { type: "mutation", store: "playlists", id: `playlist-${i}` },
            } as MessageEvent);
          }

          await new Promise(r => setTimeout(r, 100));
        }

        console.log(`📊 All counts tracked: [${allCounts.join(", ")}]`);
        console.log(`✅ Reactivity working: ${allCounts.length > 1 ? "YES" : "NO"}`);

        // Should have tracked multiple updates
        expect(allCounts.length).toBeGreaterThan(1);

        // Final count should be 3
        const finalCount = allCounts[allCounts.length - 1];
        expect(finalCount).toBe(3);

        dispose();
        resolve();
      });
    });
  });
});
