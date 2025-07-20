import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "solid-js";

// Create a proper IndexedDB mock that simulates persistence
class MockIndexedDB {
  private stores: Map<string, Map<string, any>> = new Map();
  private listeners: Array<(store: string, id: string) => void> = [];

  constructor() {
    this.stores.set("playlists", new Map());
    this.stores.set("songs", new Map());
  }

  // Mock DB interface
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
          console.log(`💾 Mock DB put(${storeName}):`, item);
          store.set(item.id, item);

          // Notify listeners of the change
          this.listeners.forEach(listener => listener(storeName, item.id));

          return Promise.resolve();
        },
        get: (id: string) => {
          const item = store.get(id);
          console.log(`🔍 Mock DB get(${storeName}, ${id}):`, item ? "found" : "not found");
          return Promise.resolve(item);
        },
        delete: (id: string) => {
          const deleted = store.delete(id);
          console.log(`🗑️ Mock DB delete(${storeName}, ${id}):`, deleted ? "deleted" : "not found");
          this.listeners.forEach(listener => listener(storeName, id));
          return Promise.resolve();
        },
        index: () => ({
          openCursor: () => Promise.resolve(null),
        }),
      }),
      done: Promise.resolve(),
    };
  }

  // Add listener for changes (simulates BroadcastChannel)
  addListener(listener: (store: string, id: string) => void) {
    this.listeners.push(listener);
  }

  // Reset for tests
  reset() {
    this.stores.clear();
    this.stores.set("playlists", new Map());
    this.stores.set("songs", new Map());
    this.listeners = [];
  }

  // Debug method
  debugState() {
    console.log("🔍 Mock DB State:");
    this.stores.forEach((store, storeName) => {
      console.log(`  ${storeName}: ${store.size} items`);
      store.forEach((item, id) => {
        console.log(`    ${id}: ${item.title || item.id}`);
      });
    });
  }
}

// Create singleton mock instance
const mockIndexedDB = new MockIndexedDB();

// Mock idb with our persistent mock
vi.mock("idb", () => ({
  openDB: vi.fn(() => Promise.resolve(mockIndexedDB)),
}));

// Mock BroadcastChannel with proper event simulation
class MockBroadcastChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(private channel: string) {}

  postMessage(data: any) {
    console.log(`📡 BroadcastChannel(${this.channel}) postMessage:`, data);

    // Simulate async message delivery
    setTimeout(() => {
      if (this.onmessage) {
        console.log(`📡 BroadcastChannel(${this.channel}) delivering message:`, data);
        this.onmessage({ data } as MessageEvent);
      }
    }, 10);
  }

  close() {}
}

global.BroadcastChannel = MockBroadcastChannel as any;

// Mock crypto.randomUUID with sequential IDs for predictability
let idCounter = 0;
Object.defineProperty(global, "crypto", {
  value: {
    randomUUID: vi.fn(() => `playlist-${++idCounter}`),
  },
  writable: true,
});

import { createPlaylistsQuery, createPlaylist } from "./services/indexedDBService.js";
import type { Playlist } from "./types/playlist.js";

describe("Persistence Mock Test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIndexedDB.reset();
    idCounter = 0;
  });

  it("should properly persist and retrieve playlists", async () => {
    console.log("🧪 Testing playlist persistence...");

    let subscriptionUpdates: Playlist[][] = [];
    let finalCount = 0;

    await new Promise<void>((resolve) => {
      createRoot(async (dispose) => {
        // Create query and track updates
        const playlistQuery = createPlaylistsQuery();
        const unsubscribe = playlistQuery.subscribe((playlists) => {
          subscriptionUpdates.push([...playlists]);
          finalCount = playlists.length;
          console.log(`📊 Query update: ${playlists.length} playlists`);
        });

        // Wait for initial query
        await new Promise(r => setTimeout(r, 100));
        console.log(`Initial state: ${finalCount} playlists`);
        mockIndexedDB.debugState();

        // Create first playlist
        console.log("🔨 Creating first playlist...");
        const playlist1 = await createPlaylist({
          title: "First Playlist",
          description: "Test playlist 1",
          songIds: [],
        });
        console.log(`Created playlist: ${playlist1.id}`);

        // Wait for broadcast and update
        await new Promise(r => setTimeout(r, 200));
        console.log(`After first creation: ${finalCount} playlists`);
        mockIndexedDB.debugState();

        // Create second playlist
        console.log("🔨 Creating second playlist...");
        const playlist2 = await createPlaylist({
          title: "Second Playlist",
          description: "Test playlist 2",
          songIds: [],
        });
        console.log(`Created playlist: ${playlist2.id}`);

        // Wait for broadcast and update
        await new Promise(r => setTimeout(r, 200));
        console.log(`After second creation: ${finalCount} playlists`);
        mockIndexedDB.debugState();

        console.log("📊 All subscription updates:");
        subscriptionUpdates.forEach((update, index) => {
          console.log(`  Update ${index}: ${update.length} playlists`);
        });

        // Verify the persistence worked
        expect(subscriptionUpdates.length).toBeGreaterThan(1);
        expect(finalCount).toBe(2);
        expect(subscriptionUpdates[subscriptionUpdates.length - 1]).toHaveLength(2);

        unsubscribe();
        dispose();
        resolve();
      });
    });
  });

  it("should handle rapid playlist creation correctly", async () => {
    console.log("⚡ Testing rapid playlist creation...");

    let allUpdates: number[] = [];

    await new Promise<void>((resolve) => {
      createRoot(async (dispose) => {
        const playlistQuery = createPlaylistsQuery();
        const unsubscribe = playlistQuery.subscribe((playlists) => {
          allUpdates.push(playlists.length);
          console.log(`📊 Update: ${playlists.length} playlists`);
        });

        await new Promise(r => setTimeout(r, 50));

        // Create 3 playlists rapidly
        const promises = [];
        for (let i = 1; i <= 3; i++) {
          promises.push(createPlaylist({
            title: `Rapid Playlist ${i}`,
            description: `Created rapidly #${i}`,
            songIds: [],
          }));
        }

        await Promise.all(promises);

        // Wait for all broadcasts to propagate
        await new Promise(r => setTimeout(r, 300));

        console.log("📊 All count updates:", allUpdates);
        mockIndexedDB.debugState();

        // Should end up with 3 playlists
        expect(allUpdates[allUpdates.length - 1]).toBe(3);
        expect(allUpdates.length).toBeGreaterThan(1);

        unsubscribe();
        dispose();
        resolve();
      });
    });
  });

  it("should simulate the exact browser bug scenario", async () => {
    console.log("🐛 Simulating browser bug scenario...");

    let uiDisplayCount = 0;
    let backendDataCount = 0;
    let signalUpdateCount = 0;

    await new Promise<void>((resolve) => {
      createRoot(async (dispose) => {
        // Simulate component with direct subscription (our fix)
        const [playlists, setPlaylists] = createSignal<Playlist[]>([]);

        // Track what the UI would display
        const renderUI = () => {
          uiDisplayCount = playlists().length;
          console.log(`🖥️ UI would display: "found ${uiDisplayCount} playlists"`);
        };

        // Setup subscription like in component
        const playlistQuery = createPlaylistsQuery();
        const unsubscribe = playlistQuery.subscribe((value) => {
          backendDataCount = value.length;
          signalUpdateCount++;
          console.log(`🔄 Backend data: ${backendDataCount} playlists`);
          setPlaylists([...value]);
          renderUI(); // In real SolidJS, this happens automatically
        });

        // Initial state
        await new Promise(r => setTimeout(r, 100));
        renderUI();

        console.log("📊 Initial state:");
        console.log(`  Backend: ${backendDataCount} playlists`);
        console.log(`  UI: ${uiDisplayCount} playlists`);
        console.log(`  Signal updates: ${signalUpdateCount}`);

        // User creates playlist (the exact bug scenario)
        console.log("👤 User clicks 'Create Playlist'...");
        await createPlaylist({
          title: "User Playlist",
          description: "Created by user action",
          songIds: [],
        });

        // Wait for all updates to propagate
        await new Promise(r => setTimeout(r, 300));

        console.log("📊 Final state:");
        console.log(`  Backend: ${backendDataCount} playlists`);
        console.log(`  UI: ${uiDisplayCount} playlists`);
        console.log(`  Signal updates: ${signalUpdateCount}`);

        // The fix should ensure UI matches backend
        console.log(`✅ Bug fixed: ${uiDisplayCount === backendDataCount ? "YES" : "NO"}`);

        expect(backendDataCount).toBe(1); // Backend should have 1 playlist
        expect(uiDisplayCount).toBe(1);   // UI should also show 1 playlist
        expect(signalUpdateCount).toBeGreaterThan(1); // Signal should have updated

        mockIndexedDB.debugState();
        unsubscribe();
        dispose();
        resolve();
      });
    });
  });

  it("should test the component's playlist count display logic", async () => {
    console.log("🎯 Testing playlist count display logic...");

    let renderCount = 0;
    let displayTexts: string[] = [];

    await new Promise<void>((resolve) => {
      createRoot(async (dispose) => {
        const [playlists, setPlaylists] = createSignal<Playlist[]>([]);

        // Simulate the exact JSX logic from the component
        const renderPlaylistCount = () => {
          renderCount++;
          const count = playlists().length;
          const text = `found ${count} playlists`;
          displayTexts.push(text);
          console.log(`🎨 Render #${renderCount}: ${text}`);
          return text;
        };

        // Setup query subscription
        const playlistQuery = createPlaylistsQuery();
        const unsubscribe = playlistQuery.subscribe((value) => {
          console.log(`🔄 Subscription update: ${value.length} playlists`);
          setPlaylists([...value]);
          renderPlaylistCount(); // Manual render trigger (automatic in real SolidJS)
        });

        // Initial render
        await new Promise(r => setTimeout(r, 100));

        // Create playlists one by one to test incremental updates
        for (let i = 1; i <= 3; i++) {
          console.log(`Creating playlist ${i}...`);
          await createPlaylist({
            title: `Test Playlist ${i}`,
            description: `Playlist number ${i}`,
            songIds: [],
          });

          await new Promise(r => setTimeout(r, 150)); // Wait for update
        }

        console.log("📊 All display texts:", displayTexts);
        console.log(`Total renders: ${renderCount}`);

        // Should show progression: 0 -> 1 -> 2 -> 3 playlists
        expect(displayTexts[0]).toBe("found 0 playlists");
        expect(displayTexts[displayTexts.length - 1]).toBe("found 3 playlists");
        expect(renderCount).toBeGreaterThan(3);

        unsubscribe();
        dispose();
        resolve();
      });
    });
  });
});
