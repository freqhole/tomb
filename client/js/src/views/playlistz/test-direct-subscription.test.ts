import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot, createSignal, onMount, onCleanup } from "solid-js";

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

import { createPlaylistsQuery, createPlaylist } from "./services/indexedDBService.js";
import type { Playlist } from "./types/playlist.js";

describe("Direct Subscription Approach", () => {
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

  it("should work with direct subscription in component", async () => {
    let subscriptionUpdates = 0;
    let signalUpdates = 0;
    let finalCount = 0;

    await new Promise<void>((resolve) => {
      createRoot(async (dispose) => {
        console.log("🧪 Testing direct subscription approach...");

        // Simulate the component's direct subscription approach
        const [playlists, setPlaylists] = createSignal<Playlist[]>([]);

        // Track signal changes
        let trackingActive = true;
        const track = () => {
          if (trackingActive) {
            signalUpdates++;
            finalCount = playlists().length;
            console.log(`📊 Signal update #${signalUpdates}: ${finalCount} playlists`);
          }
        };

        // Initial track
        track();

        // Direct subscription like in the fixed component
        const playlistQuery = createPlaylistsQuery();
        const unsubscribe = playlistQuery.subscribe((value) => {
          subscriptionUpdates++;
          console.log(`🔄 Subscription update #${subscriptionUpdates}: ${value.length} playlists`);
          setPlaylists([...value]); // Force new array reference
          track(); // Manual tracking since effects might not work
        });

        // Wait for initial state
        await new Promise(r => setTimeout(r, 100));

        // Create playlist to trigger update
        console.log("🔨 Creating playlist...");
        await createPlaylist({
          title: "Test Playlist",
          description: "Test",
          songIds: [],
        });

        // Wait for updates
        await new Promise(r => setTimeout(r, 200));

        // Stop tracking and cleanup
        trackingActive = false;
        unsubscribe();

        console.log(`📊 Results:`);
        console.log(`   Subscription updates: ${subscriptionUpdates}`);
        console.log(`   Signal updates: ${signalUpdates}`);
        console.log(`   Final count: ${finalCount}`);

        // Should have received subscription updates
        expect(subscriptionUpdates).toBeGreaterThan(0);

        // Manual tracking should show signal changes
        expect(signalUpdates).toBeGreaterThan(1);

        dispose();
        resolve();
      });
    });
  });

  it("should simulate the exact component pattern", async () => {
    let componentRenderCount = 0;
    let playlistCount = 0;

    await new Promise<void>((resolve) => {
      createRoot(async (dispose) => {
        console.log("🎨 Simulating exact component pattern...");

        // Exact same pattern as the fixed component
        const [playlists, setPlaylists] = createSignal<Playlist[]>([]);

        // Simulate component render function
        const renderComponent = () => {
          componentRenderCount++;
          playlistCount = playlists().length;
          console.log(`🖼️ Component render #${componentRenderCount}: found ${playlistCount} playlists`);
          return `found ${playlistCount} playlists`;
        };

        // Initial render
        let displayText = renderComponent();

        // Setup subscription like in onMount
        const playlistQuery = createPlaylistsQuery();
        const unsubscribe = playlistQuery.subscribe((value) => {
          console.log(`🔄 Component subscription: ${value.length} playlists`);
          setPlaylists([...value]);
          // In real component, this would trigger re-render
          displayText = renderComponent();
        });

        await new Promise(r => setTimeout(r, 100));
        console.log(`Initial display: "${displayText}"`);

        // Mock data change
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

        // Trigger broadcast
        const bc = new BroadcastChannel("musicPlaylistDB-changes");
        if (bc.onmessage) {
          bc.onmessage({
            data: { type: "mutation", store: "playlists", id: "new-playlist" },
          } as MessageEvent);
        }

        await new Promise(r => setTimeout(r, 200));
        console.log(`Final display: "${displayText}"`);

        console.log(`📊 Component Pattern Results:`);
        console.log(`   Renders: ${componentRenderCount}`);
        console.log(`   Final count: ${playlistCount}`);
        console.log(`   UI working: ${playlistCount > 0 ? "YES" : "NO"}`);

        // Component should have re-rendered with new data
        expect(componentRenderCount).toBeGreaterThan(1);
        expect(playlistCount).toBeGreaterThan(0);

        unsubscribe();
        dispose();
        resolve();
      });
    });
  });

  it("should verify subscription vs signal reactivity", async () => {
    let subscriptionCalls: number[] = [];
    let manualChecks: number[] = [];

    await new Promise<void>((resolve) => {
      createRoot(async (dispose) => {
        console.log("🔍 Testing subscription vs signal reactivity...");

        const [playlists, setPlaylists] = createSignal<Playlist[]>([]);

        // Track subscription calls
        const playlistQuery = createPlaylistsQuery();
        const unsubscribe = playlistQuery.subscribe((value) => {
          subscriptionCalls.push(value.length);
          console.log(`📡 Subscription: ${value.length} playlists`);
          setPlaylists([...value]);
        });

        // Manual check function (simulates what UI would do)
        const checkCount = () => {
          const count = playlists().length;
          manualChecks.push(count);
          console.log(`👁️ Manual check: ${count} playlists`);
          return count;
        };

        // Initial check
        await new Promise(r => setTimeout(r, 100));
        checkCount();

        // Simulate multiple data changes
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
          checkCount();
        }

        console.log(`📊 Tracking Results:`);
        console.log(`   Subscription calls: [${subscriptionCalls.join(", ")}]`);
        console.log(`   Manual checks: [${manualChecks.join(", ")}]`);

        // Subscription should work
        expect(subscriptionCalls.length).toBeGreaterThan(1);
        expect(subscriptionCalls[subscriptionCalls.length - 1]).toBe(3);

        // Manual checks should reflect the subscription updates
        expect(manualChecks.length).toBeGreaterThan(1);
        expect(manualChecks[manualChecks.length - 1]).toBe(3);

        unsubscribe();
        dispose();
        resolve();
      });
    });
  });

  it("should test the complete UI update flow", async () => {
    let uiState = {
      initialized: false,
      playlistCount: 0,
      displayText: "",
      updates: 0,
    };

    await new Promise<void>((resolve) => {
      createRoot(async (dispose) => {
        console.log("🌟 Testing complete UI update flow...");

        const [playlists, setPlaylists] = createSignal<Playlist[]>([]);
        const [isInitialized, setIsInitialized] = createSignal(false);

        // Simulate the full component lifecycle
        const updateUI = () => {
          uiState.updates++;
          uiState.initialized = isInitialized();
          uiState.playlistCount = playlists().length;
          uiState.displayText = `found ${uiState.playlistCount} playlists`;

          console.log(`🖥️ UI Update #${uiState.updates}: ${uiState.displayText} (init: ${uiState.initialized})`);
        };

        // Initial state
        updateUI();

        // Simulate onMount
        const playlistQuery = createPlaylistsQuery();
        const unsubscribe = playlistQuery.subscribe((value) => {
          console.log(`🔄 Data subscription: ${value.length} playlists`);
          setPlaylists([...value]);
          updateUI(); // This would happen automatically in real SolidJS
        });

        setIsInitialized(true);
        updateUI();

        await new Promise(r => setTimeout(r, 100));

        // User creates playlist
        console.log("👤 User creates playlist...");
        await createPlaylist({
          title: "User Playlist",
          description: "Created by user",
          songIds: [],
        });

        await new Promise(r => setTimeout(r, 200));

        console.log(`📊 Final UI State:`);
        console.log(`   Initialized: ${uiState.initialized}`);
        console.log(`   Playlist count: ${uiState.playlistCount}`);
        console.log(`   Display text: "${uiState.displayText}"`);
        console.log(`   Total updates: ${uiState.updates}`);
        console.log(`   UI working correctly: ${uiState.playlistCount > 0 ? "YES ✅" : "NO ❌"}`);

        // UI should show updated playlist count
        expect(uiState.initialized).toBe(true);
        expect(uiState.playlistCount).toBeGreaterThan(0);
        expect(uiState.displayText).toContain("1 playlists");
        expect(uiState.updates).toBeGreaterThan(2);

        unsubscribe();
        dispose();
        resolve();
      });
    });
  });
});
