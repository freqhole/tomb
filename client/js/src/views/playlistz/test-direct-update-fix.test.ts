import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "solid-js";

// Mock IndexedDB with persistence
class MockIndexedDB {
  private stores: Map<string, Map<string, any>> = new Map();

  constructor() {
    this.stores.set("playlists", new Map());
    this.stores.set("songs", new Map());
  }

  getAll(storeName: string) {
    const store = this.stores.get(storeName) || new Map();
    const items = Array.from(store.values());
    console.log(`📊 Mock DB getAll(${storeName}): ${items.length} items`);
    return Promise.resolve(items);
  }

  transaction(storeName: string, mode: string) {
    const store = this.stores.get(storeName) || new Map();

    return {
      objectStore: () => ({
        put: (item: any) => {
          console.log(`💾 Mock DB put(${storeName}):`, item.title);
          store.set(item.id, item);
          return Promise.resolve();
        },
        get: (id: string) => {
          const item = store.get(id);
          return Promise.resolve(item);
        },
        delete: (id: string) => {
          store.delete(id);
          return Promise.resolve();
        },
        index: () => ({
          openCursor: () => Promise.resolve(null),
        }),
      }),
      done: Promise.resolve(),
    };
  }

  reset() {
    this.stores.clear();
    this.stores.set("playlists", new Map());
    this.stores.set("songs", new Map());
  }

  debugState() {
    console.log("🔍 Mock DB State:");
    this.stores.forEach((store, storeName) => {
      console.log(`  ${storeName}: ${store.size} items`);
    });
  }
}

const mockIndexedDB = new MockIndexedDB();

vi.mock("idb", () => ({
  openDB: vi.fn(() => Promise.resolve(mockIndexedDB)),
}));

// Mock BroadcastChannel (simplified)
global.BroadcastChannel = vi.fn(() => ({
  postMessage: vi.fn(),
  onmessage: null,
  close: vi.fn(),
})) as any;

// Mock crypto
let idCounter = 0;
Object.defineProperty(global, "crypto", {
  value: {
    randomUUID: vi.fn(() => `playlist-${++idCounter}`),
  },
  writable: true,
});

import { createPlaylistsQuery, createPlaylist } from "./services/indexedDBService.js";
import type { Playlist } from "./types/playlist.js";

describe("Direct Update Fix Test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIndexedDB.reset();
    idCounter = 0;
  });

  it("should update queries immediately with direct updates", async () => {
    console.log("🧪 Testing direct update mechanism...");

    let updateCount = 0;
    let lastCount = 0;
    let allUpdates: number[] = [];

    await new Promise<void>((resolve) => {
      createRoot(async (dispose) => {
        // Create query and track updates
        const playlistQuery = createPlaylistsQuery();

        const unsubscribe = playlistQuery.subscribe((playlists) => {
          updateCount++;
          lastCount = playlists.length;
          allUpdates.push(lastCount);
          console.log(`📊 Query update #${updateCount}: ${lastCount} playlists`);
        });

        // Wait for initial state
        await new Promise(r => setTimeout(r, 50));
        console.log(`Initial: ${lastCount} playlists`);

        // Create first playlist
        console.log("🔨 Creating first playlist...");
        await createPlaylist({
          title: "Test Playlist 1",
          description: "First test",
          songIds: [],
        });

        await new Promise(r => setTimeout(r, 50));
        console.log(`After first: ${lastCount} playlists`);

        // Create second playlist
        console.log("🔨 Creating second playlist...");
        await createPlaylist({
          title: "Test Playlist 2",
          description: "Second test",
          songIds: [],
        });

        await new Promise(r => setTimeout(r, 50));
        console.log(`After second: ${lastCount} playlists`);

        console.log(`📊 All updates: [${allUpdates.join(", ")}]`);
        console.log(`✅ Direct updates working: ${lastCount === 2 ? "YES" : "NO"}`);

        mockIndexedDB.debugState();

        // Should have immediate updates
        expect(updateCount).toBeGreaterThan(2);
        expect(lastCount).toBe(2);
        expect(allUpdates[allUpdates.length - 1]).toBe(2);

        unsubscribe();
        dispose();
        resolve();
      });
    });
  });

  it("should handle multiple queries correctly", async () => {
    console.log("🔄 Testing multiple query updates...");

    let query1Updates = 0;
    let query2Updates = 0;
    let finalCount1 = 0;
    let finalCount2 = 0;

    await new Promise<void>((resolve) => {
      createRoot(async (dispose) => {
        // Create two separate queries
        const query1 = createPlaylistsQuery();
        const query2 = createPlaylistsQuery();

        const unsubscribe1 = query1.subscribe((playlists) => {
          query1Updates++;
          finalCount1 = playlists.length;
          console.log(`📊 Query1 update #${query1Updates}: ${finalCount1} playlists`);
        });

        const unsubscribe2 = query2.subscribe((playlists) => {
          query2Updates++;
          finalCount2 = playlists.length;
          console.log(`📊 Query2 update #${query2Updates}: ${finalCount2} playlists`);
        });

        await new Promise(r => setTimeout(r, 50));

        // Create playlist - should update both queries
        console.log("🔨 Creating playlist...");
        await createPlaylist({
          title: "Shared Playlist",
          description: "Should update both queries",
          songIds: [],
        });

        await new Promise(r => setTimeout(r, 50));

        console.log(`Query 1: ${query1Updates} updates, final count: ${finalCount1}`);
        console.log(`Query 2: ${query2Updates} updates, final count: ${finalCount2}`);

        // Both queries should be updated
        expect(query1Updates).toBeGreaterThan(1);
        expect(query2Updates).toBeGreaterThan(1);
        expect(finalCount1).toBe(1);
        expect(finalCount2).toBe(1);

        unsubscribe1();
        unsubscribe2();
        dispose();
        resolve();
      });
    });
  });

  it("should simulate exact component behavior", async () => {
    console.log("🎨 Simulating component with direct subscription...");

    let componentRenders = 0;
    let displayText = "";

    await new Promise<void>((resolve) => {
      createRoot(async (dispose) => {
        // Simulate component state
        const [playlists, setPlaylists] = createSignal<Playlist[]>([]);

        // Simulate component render function
        const renderComponent = () => {
          componentRenders++;
          const count = playlists().length;
          displayText = `found ${count} playlists`;
          console.log(`🖼️ Component render #${componentRenders}: ${displayText}`);
        };

        // Setup direct subscription like in fixed component
        const playlistQuery = createPlaylistsQuery();
        const unsubscribe = playlistQuery.subscribe((value) => {
          console.log(`🔄 Component subscription: ${value.length} playlists`);
          setPlaylists([...value]);
          renderComponent();
        });

        await new Promise(r => setTimeout(r, 50));
        console.log(`Initial render: "${displayText}"`);

        // User creates playlist
        console.log("👤 User creates playlist...");
        await createPlaylist({
          title: "User Created",
          description: "Created by user interaction",
          songIds: [],
        });

        await new Promise(r => setTimeout(r, 100));
        console.log(`Final render: "${displayText}"`);
        console.log(`✅ UI updated correctly: ${displayText.includes("1") ? "YES" : "NO"}`);

        // Component should show updated count
        expect(componentRenders).toBeGreaterThan(1);
        expect(displayText).toBe("found 1 playlists");

        unsubscribe();
        dispose();
        resolve();
      });
    });
  });

  it("should verify the fix solves the original bug", async () => {
    console.log("🐛 Testing original bug scenario...");

    let backendCount = 0;
    let uiCount = 0;
    let signalUpdates = 0;

    await new Promise<void>((resolve) => {
      createRoot(async (dispose) => {
        const [playlists, setPlaylists] = createSignal<Playlist[]>([]);

        const playlistQuery = createPlaylistsQuery();
        const unsubscribe = playlistQuery.subscribe((value) => {
          backendCount = value.length;
          signalUpdates++;
          console.log(`🔄 Backend: ${backendCount} playlists (signal update #${signalUpdates})`);
          setPlaylists([...value]);
          uiCount = playlists().length;
          console.log(`🖥️ UI: ${uiCount} playlists`);
        });

        await new Promise(r => setTimeout(r, 50));

        console.log("📊 Before creating playlist:");
        console.log(`  Backend: ${backendCount}`);
        console.log(`  UI: ${uiCount}`);

        // The exact bug scenario: create playlist
        await createPlaylist({
          title: "Bug Test Playlist",
          description: "Testing the bug fix",
          songIds: [],
        });

        await new Promise(r => setTimeout(r, 100));

        console.log("📊 After creating playlist:");
        console.log(`  Backend: ${backendCount}`);
        console.log(`  UI: ${uiCount}`);
        console.log(`  Signal updates: ${signalUpdates}`);
        console.log(`🎯 Bug fixed: ${backendCount === uiCount && uiCount > 0 ? "YES ✅" : "NO ❌"}`);

        // The bug is fixed if UI matches backend
        expect(backendCount).toBe(1);
        expect(uiCount).toBe(1);
        expect(signalUpdates).toBeGreaterThan(1);

        unsubscribe();
        dispose();
        resolve();
      });
    });
  });
});
