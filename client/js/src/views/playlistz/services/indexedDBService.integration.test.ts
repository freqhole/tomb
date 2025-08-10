import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot, createSignal } from "solid-js";

// Mock IndexedDB with persistence for integration testing
class MockIndexedDB {
  private stores: Map<string, Map<string, any>> = new Map();

  constructor() {
    this.stores.set("playlists", new Map());
    this.stores.set("songs", new Map());
  }

  getAll(storeName: string) {
    const store = this.stores.get(storeName) || new Map();
    return Promise.resolve(Array.from(store.values()));
  }

  transaction(storeName: string, _mode: string) {
    const store = this.stores.get(storeName) || new Map();
    return {
      objectStore: () => ({
        put: (item: any) => {
          store.set(item.id, item);
          return Promise.resolve();
        },
        get: (id: string) => Promise.resolve(store.get(id)),
        delete: (id: string) => {
          store.delete(id);
          return Promise.resolve();
        },
        index: () => ({ openCursor: () => Promise.resolve(null) }),
      }),
      done: Promise.resolve(),
    };
  }

  reset() {
    this.stores.clear();
    this.stores.set("playlists", new Map());
    this.stores.set("songs", new Map());
  }
}

const mockIndexedDB = new MockIndexedDB();

vi.mock("idb", () => ({
  openDB: vi.fn(() => Promise.resolve(mockIndexedDB)),
}));

global.BroadcastChannel = vi.fn(() => ({
  postMessage: vi.fn(),
  onmessage: null,
  close: vi.fn(),
})) as any;

let idCounter = 0;
Object.defineProperty(global, "crypto", {
  value: {
    randomUUID: vi.fn(() => `playlist-${++idCounter}`),
  },
  writable: true,
});

import { createPlaylistsQuery, createPlaylist } from "./indexedDBService.js";
import type { Playlist } from "../types/playlist.js";

describe("IndexedDB Service Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIndexedDB.reset();
    idCounter = 0;
  });

  it("should update live queries immediately after mutations", async () => {
    let updateCount = 0;
    let finalCount = 0;

    await new Promise<void>((resolve) => {
      createRoot(async (dispose) => {
        const playlistQuery = createPlaylistsQuery();
        const unsubscribe = playlistQuery.subscribe((playlists) => {
          updateCount++;
          finalCount = playlists.length;
        });

        await new Promise((r) => setTimeout(r, 50));

        // Create playlist - should trigger immediate update
        await createPlaylist({
          title: "Test Playlist",
          description: "Integration test",
          songIds: [],
        });

        await new Promise((r) => setTimeout(r, 50));

        expect(updateCount).toBeGreaterThan(1);
        expect(finalCount).toBe(1);

        unsubscribe();
        dispose();
        resolve();
      });
    });
  });

  it("should support multiple concurrent queries", async () => {
    let query1Count = 0;
    let query2Count = 0;

    await new Promise<void>((resolve) => {
      createRoot(async (dispose) => {
        const query1 = createPlaylistsQuery();
        const query2 = createPlaylistsQuery();

        const unsubscribe1 = query1.subscribe((playlists) => {
          query1Count = playlists.length;
        });

        const unsubscribe2 = query2.subscribe((playlists) => {
          query2Count = playlists.length;
        });

        await new Promise((r) => setTimeout(r, 50));

        await createPlaylist({
          title: "Shared Playlist",
          description: "Should update both queries",
          songIds: [],
        });

        await new Promise((r) => setTimeout(r, 50));

        expect(query1Count).toBe(1);
        expect(query2Count).toBe(1);

        unsubscribe1();
        unsubscribe2();
        dispose();
        resolve();
      });
    });
  });

  it("should fix the original UI reactivity bug", async () => {
    let backendCount = 0;
    let uiCount = 0;

    await new Promise<void>((resolve) => {
      createRoot(async (dispose) => {
        const [playlists, setPlaylists] = createSignal<Playlist[]>([]);

        const playlistQuery = createPlaylistsQuery();
        const unsubscribe = playlistQuery.subscribe((value) => {
          backendCount = value.length;
          setPlaylists([...value]);
          uiCount = playlists().length;
        });

        await new Promise((r) => setTimeout(r, 50));

        // Original bug: create playlist but UI doesn't update
        await createPlaylist({
          title: "Bug Fix Test",
          description: "Testing the fix",
          songIds: [],
        });

        await new Promise((r) => setTimeout(r, 100));

        // Bug is fixed when backend and UI counts match
        expect(backendCount).toBe(1);
        expect(uiCount).toBe(1);

        unsubscribe();
        dispose();
        resolve();
      });
    });
  });
});
