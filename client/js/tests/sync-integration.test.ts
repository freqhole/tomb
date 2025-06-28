//! Integration tests for sync functionality
//!
//! Tests the sync system components working together, including the sync manager,
//! storage, events, and API integration with mocked server responses.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createSyncManager,
  SyncEventType,
  SyncStatus,
  SyncManager,
} from "../src/sync/index.js";
import { ApiClient } from "../src/lib/api-client.js";

// Mock browser globals for Node.js environment
Object.defineProperty(globalThis, "window", {
  value: {
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (id: number) => clearInterval(id),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
  writable: true,
});

Object.defineProperty(globalThis, "navigator", {
  value: { onLine: true },
  writable: true,
});

Object.defineProperty(globalThis, "crypto", {
  value: {
    randomUUID: () => "test-uuid-" + Math.random().toString(36).substring(2),
    subtle: {
      digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
    },
  },
  writable: true,
});

Object.defineProperty(globalThis, "localStorage", {
  value: {
    store: new Map<string, string>(),
    getItem: vi.fn(
      (key: string) => globalThis.localStorage.store.get(key) || null
    ),
    setItem: vi.fn((key: string, value: string) =>
      globalThis.localStorage.store.set(key, value)
    ),
    removeItem: vi.fn((key: string) =>
      globalThis.localStorage.store.delete(key)
    ),
    clear: vi.fn(() => globalThis.localStorage.store.clear()),
  },
  writable: true,
});

// Mock IndexedDB
const mockIDBDatabase = {
  transaction: vi.fn(),
  createObjectStore: vi.fn(),
  objectStoreNames: { contains: vi.fn(() => false) },
  close: vi.fn(),
};

const mockIDBRequest = {
  onsuccess: null as ((event: any) => void) | null,
  onerror: null as ((event: any) => void) | null,
  result: mockIDBDatabase,
  error: null,
};

Object.defineProperty(globalThis, "indexedDB", {
  value: {
    open: vi.fn(() => mockIDBRequest),
  },
  writable: true,
});

describe("Sync Integration Tests", () => {
  let apiClient: ApiClient;
  let syncManager: SyncManager;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    globalThis.localStorage.store.clear();

    // Mock fetch for API calls
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Create API client
    apiClient = new ApiClient({
      baseUrl: "http://localhost:8080",
    });

    // Create sync manager with test configuration
    syncManager = createSyncManager(apiClient, "integration-test-client", {
      defaultPageSize: 10,
      maxPageSize: 50,
      minSyncInterval: 1000, // 1 second for testing
      storage: {
        enabled: false, // Disable IndexedDB for integration tests
        maxSize: 10 * 1024 * 1024,
        maxCacheAge: 1,
      },
      conflictResolution: {
        defaultStrategy: "manual",
        autoResolveSimple: false,
      },
    });

    // Setup IndexedDB mock to simulate successful initialization
    mockIDBRequest.onsuccess = () => {};
    setTimeout(() => {
      if (mockIDBRequest.onsuccess) {
        mockIDBRequest.onsuccess({ target: { result: mockIDBDatabase } });
      }
    }, 0);
  });

  afterEach(async () => {
    await syncManager.cleanup();
    vi.restoreAllMocks();
  });

  describe("Basic sync workflow", () => {
    it("should perform a complete sync workflow", async () => {
      // Mock successful sync API responses
      mockFetch
        // First call: incremental sync
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              items: [
                {
                  id: "blob-1",
                  sha256: "hash1",
                  size: 1024,
                  mime: "text/plain",
                  source_client_id: "test-client",
                  local_path: null,
                  metadata: { name: "test1.txt" },
                  created_at: "2023-10-01T12:00:00Z",
                  updated_at: "2023-10-01T12:00:00Z",
                  deleted_at: null,
                  data: null,
                },
                {
                  id: "blob-2",
                  sha256: "hash2",
                  size: 2048,
                  mime: "image/jpeg",
                  source_client_id: "test-client",
                  local_path: null,
                  metadata: { name: "test2.jpg" },
                  created_at: "2023-10-01T12:05:00Z",
                  updated_at: "2023-10-01T12:05:00Z",
                  deleted_at: null,
                  data: null,
                },
              ],
              pagination: {
                batch_size: 2,
                has_more: false,
                next_cursor: null,
                progress: 1.0,
                suggested_delay: 60,
              },
              sync_timestamp: "2023-10-01T12:10:00Z",
              is_full_sync: false,
              total_items: 2,
            }),
            { status: 200 }
          )
        )
        // Second call: sync acknowledgment
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ success: true }), { status: 200 })
        );

      // Track events
      const events: any[] = [];
      syncManager.onAny((event) => events.push(event));

      // Initialize and sync
      await syncManager.initialize();
      await syncManager.sync({ force: true });

      // Verify API calls were made
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify incremental sync call
      const firstCall = mockFetch.mock.calls[0];
      expect(firstCall[0]).toContain("/api/sync/media");

      // Verify acknowledgment call
      const secondCall = mockFetch.mock.calls[1];
      expect(secondCall[0]).toContain("/api/sync/media/acknowledge");
      expect(secondCall[1].method).toBe("POST");

      // Verify events were emitted
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain(SyncEventType.SyncStarted);
      expect(eventTypes).toContain(SyncEventType.ItemsReceived);
      expect(eventTypes).toContain(SyncEventType.ItemsProcessed);
      expect(eventTypes).toContain(SyncEventType.SyncBatchCompleted);
      expect(eventTypes).toContain(SyncEventType.SyncCompleted);

      // Verify sync status
      const status = syncManager.getSyncStatus();
      expect(status.status).toBe(SyncStatus.Complete);
      expect(status.items_synced).toBe(2);
    });

    it("should handle paginated sync responses", async () => {
      // Mock paginated responses
      mockFetch
        // First batch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              items: [{ id: "blob-1", sha256: "hash1" }],
              pagination: {
                batch_size: 1,
                has_more: true,
                next_cursor: "cursor-page-2",
                progress: 0.5,
                suggested_delay: 1,
              },
              sync_timestamp: "2023-10-01T12:00:00Z",
              is_full_sync: false,
              total_items: 2,
            }),
            { status: 200 }
          )
        )
        // Second batch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              items: [{ id: "blob-2", sha256: "hash2" }],
              pagination: {
                batch_size: 1,
                has_more: false,
                next_cursor: null,
                progress: 1.0,
                suggested_delay: 60,
              },
              sync_timestamp: "2023-10-01T12:01:00Z",
              is_full_sync: false,
              total_items: 2,
            }),
            { status: 200 }
          )
        )
        // Acknowledgments
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ success: true }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ success: true }), { status: 200 })
        );

      const progressEvents: any[] = [];
      syncManager.on(SyncEventType.SyncBatchCompleted, (event) =>
        progressEvents.push(event)
      );

      await syncManager.initialize();
      await syncManager.sync({ force: true });

      // Verify two batches were processed
      expect(progressEvents).toHaveLength(2);
      expect(progressEvents[0].hasMore).toBe(true);
      expect(progressEvents[1].hasMore).toBe(false);

      // Verify API calls for both batches + acknowledgments
      expect(mockFetch).toHaveBeenCalledTimes(4);

      const status = syncManager.getSyncStatus();
      expect(status.items_synced).toBe(2);
      expect(status.current_batch).toBe(2);
    });

    it("should handle sync failures gracefully", async () => {
      // Mock failed API response
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const errorEvents: any[] = [];
      syncManager.on(SyncEventType.SyncFailed, (event) =>
        errorEvents.push(event)
      );

      await syncManager.initialize();

      // Sync should fail but not throw
      await expect(syncManager.sync({ force: true })).rejects.toThrow(
        "Network error"
      );

      // Verify error event was emitted
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].error.message).toBe("Network error");

      const status = syncManager.getSyncStatus();
      expect(status.status).toBe(SyncStatus.Failed);
    });
  });

  describe("Event system integration", () => {
    it("should emit events in correct order during sync", async () => {
      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              items: [{ id: "blob-1", sha256: "hash1" }],
              pagination: {
                batch_size: 1,
                has_more: false,
                next_cursor: null,
              },
              sync_timestamp: "2023-10-01T12:00:00Z",
              is_full_sync: false,
              total_items: 1,
            }),
            { status: 200 }
          )
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ success: true }), { status: 200 })
        );

      const eventOrder: string[] = [];
      const eventTypes = [
        SyncEventType.SyncStarted,
        SyncEventType.ItemsReceived,
        SyncEventType.ItemsProcessed,
        SyncEventType.SyncBatchCompleted,
        SyncEventType.SyncCompleted,
      ];

      eventTypes.forEach((type) => {
        syncManager.on(type, () => eventOrder.push(type));
      });

      await syncManager.initialize();
      await syncManager.sync({ force: true });

      // Verify events were emitted in expected order
      expect(eventOrder).toEqual(eventTypes);
    });

    it("should handle multiple event listeners correctly", async () => {
      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              items: [],
              pagination: { batch_size: 0, has_more: false },
              sync_timestamp: "2023-10-01T12:00:00Z",
              is_full_sync: false,
            }),
            { status: 200 }
          )
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ success: true }), { status: 200 })
        );

      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const globalListener = vi.fn();

      syncManager.on(SyncEventType.SyncStarted, listener1);
      syncManager.on(SyncEventType.SyncStarted, listener2);
      syncManager.onAny(globalListener);

      await syncManager.initialize();
      await syncManager.sync({ force: true });

      // Both specific listeners should be called
      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();

      // Global listener should receive all events
      expect(globalListener.mock.calls.length).toBeGreaterThan(2);
    });
  });

  describe("State persistence", () => {
    it("should persist sync state across sessions", async () => {
      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              items: [{ id: "blob-1", sha256: "hash1" }],
              pagination: { batch_size: 1, has_more: false },
              sync_timestamp: "2023-10-01T12:00:00Z",
              is_full_sync: false,
              total_items: 1,
            }),
            { status: 200 }
          )
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ success: true }), { status: 200 })
        );

      await syncManager.initialize();
      await syncManager.sync({ force: true });

      // Verify state was persisted
      expect(globalThis.localStorage.setItem).toHaveBeenCalledWith(
        "webauthn_sync_state",
        expect.stringContaining("integration-test-client")
      );

      // Create new sync manager with same client ID
      const newSyncManager = createSyncManager(
        apiClient,
        "integration-test-client",
        {
          storage: { enabled: false },
        }
      );

      await newSyncManager.initialize();

      // Should load previous state
      const status = newSyncManager.getSyncStatus();
      expect(status.items_synced).toBe(1);

      await newSyncManager.cleanup();
    });
  });

  describe("Error handling and recovery", () => {
    it("should handle API errors without crashing", async () => {
      // Mock 500 error response
      mockFetch.mockResolvedValueOnce(
        new Response("Internal Server Error", { status: 500 })
      );

      await syncManager.initialize();

      await expect(syncManager.sync({ force: true })).rejects.toThrow();

      const status = syncManager.getSyncStatus();
      expect(status.status).toBe(SyncStatus.Failed);
    });

    it("should handle malformed API responses", async () => {
      // Mock invalid JSON response
      mockFetch.mockResolvedValueOnce(
        new Response("invalid json", {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

      await syncManager.initialize();

      await expect(syncManager.sync({ force: true })).rejects.toThrow();
    });

    it("should handle timeout scenarios", async () => {
      // Mock slow response
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve(
                  new Response(JSON.stringify({ items: [] }), { status: 200 })
                ),
              5000
            )
          )
      );

      await syncManager.initialize();

      // Should timeout and fail
      await expect(syncManager.sync({ force: true })).rejects.toThrow();
    });
  });

  describe("Connection status handling", () => {
    it("should handle online/offline status changes", async () => {
      const connectionEvents: any[] = [];
      syncManager.on(SyncEventType.ConnectionChanged, (event) =>
        connectionEvents.push(event)
      );

      await syncManager.initialize();

      // Simulate going offline
      Object.defineProperty(navigator, "onLine", {
        value: false,
        writable: true,
      });

      // Simulate the window event
      const offlineEvent = new Event("offline");
      window.dispatchEvent?.(offlineEvent);

      // Should not be able to sync when offline
      await expect(syncManager.sync()).rejects.toThrow(
        "Cannot sync while offline"
      );

      // Simulate coming back online
      Object.defineProperty(navigator, "onLine", {
        value: true,
        writable: true,
      });

      const onlineEvent = new Event("online");
      window.dispatchEvent?.(onlineEvent);

      // Connection events should have been emitted
      expect(connectionEvents.length).toBeGreaterThan(0);
    });
  });

  describe("Conflict handling", () => {
    it("should handle sync conflicts", async () => {
      // This test would require mocking storage with conflicting data
      // For now, just verify the conflict resolution methods exist
      expect(typeof syncManager.getConflicts).toBe("function");
      expect(typeof syncManager.resolveConflict).toBe("function");

      const conflicts = await syncManager.getConflicts();
      expect(Array.isArray(conflicts)).toBe(true);
    });
  });
});
