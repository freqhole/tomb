//! Test runner for sync demo functionality
//!
//! This test demonstrates the sync system working with mocked data,
//! showing the complete flow of events, state management, and persistence.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SyncDemo, runSyncDemo } from "../src/examples/sync/demo-example.js";
import { SyncEventType, SyncStatus } from "../src/sync/index.js";

// Mock browser globals for Node.js environment
Object.defineProperty(globalThis, "window", {
  value: {},
  writable: true,
});

Object.defineProperty(globalThis, "navigator", {
  value: { onLine: true },
  writable: true,
});

Object.defineProperty(globalThis, "crypto", {
  value: {
    randomUUID: () => "test-uuid-" + Math.random().toString(36).substring(2),
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

describe("Sync Demo", () => {
  let demo: SyncDemo;
  let capturedLogs: string[];

  beforeEach(() => {
    // Clear localStorage
    globalThis.localStorage.store.clear();
    vi.clearAllMocks();

    // Capture console.log output
    capturedLogs = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      capturedLogs.push(args.join(" "));
    });

    // Create demo instance
    demo = new SyncDemo("test-client");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("SyncDemo class", () => {
    it("should initialize with default state", () => {
      demo.showSyncState();

      expect(capturedLogs.some((log) => log.includes("Status: Never"))).toBe(
        true
      );
      expect(capturedLogs.some((log) => log.includes("Items Synced: 0"))).toBe(
        true
      );
      expect(
        capturedLogs.some((log) => log.includes("Session Active: false"))
      ).toBe(true);
    });

    it("should set up event listeners", () => {
      demo.setupEventListeners();

      expect(
        capturedLogs.some((log) => log.includes("Setting up event listeners"))
      ).toBe(true);
    });

    it("should perform mock sync operation", async () => {
      demo.setupEventListeners();

      await demo.performMockSync();

      // Verify sync events were logged
      expect(capturedLogs.some((log) => log.includes("Sync Started:"))).toBe(
        true
      );
      expect(capturedLogs.some((log) => log.includes("Items Received:"))).toBe(
        true
      );
      expect(capturedLogs.some((log) => log.includes("Batch Completed:"))).toBe(
        true
      );
      expect(capturedLogs.some((log) => log.includes("Sync Completed:"))).toBe(
        true
      );

      // Verify items were processed
      expect(
        capturedLogs.some((log) => log.includes("Processed: document1.txt"))
      ).toBe(true);
      expect(
        capturedLogs.some((log) => log.includes("Processed: photo1.jpg"))
      ).toBe(true);
      expect(
        capturedLogs.some((log) => log.includes("Processed: report.pdf"))
      ).toBe(true);
    });

    it("should track event history", async () => {
      demo.setupEventListeners();
      await demo.performMockSync();

      const events = demo.getEventHistory();
      const eventTypes = events.map((e) => e.type);

      expect(eventTypes).toContain(SyncEventType.SyncStarted);
      expect(eventTypes).toContain(SyncEventType.ItemsReceived);
      expect(eventTypes).toContain(SyncEventType.SyncBatchCompleted);
      expect(eventTypes).toContain(SyncEventType.SyncCompleted);

      // Should have multiple batches
      const batchEvents = events.filter(
        (e) => e.type === SyncEventType.SyncBatchCompleted
      );
      expect(batchEvents.length).toBeGreaterThan(1);
    });

    it("should persist state to localStorage", async () => {
      demo.setupEventListeners();
      await demo.performMockSync();

      demo.demonstrateStatePersistence();

      // Verify localStorage was called
      expect(globalThis.localStorage.setItem).toHaveBeenCalledWith(
        "webauthn_sync_state",
        expect.stringContaining("test-client")
      );

      // Verify persistence logging
      expect(
        capturedLogs.some((log) => log.includes("State saved to localStorage"))
      ).toBe(true);
      expect(
        capturedLogs.some((log) => log.includes("After loading new instance:"))
      ).toBe(true);
    });

    it("should reset state correctly", async () => {
      demo.setupEventListeners();
      await demo.performMockSync();

      // Verify state has data
      demo.showSyncState();
      expect(capturedLogs.some((log) => log.includes("Items Synced: 3"))).toBe(
        true
      );

      // Reset and verify
      demo.reset();
      demo.showSyncState();

      expect(
        capturedLogs.some((log) => log.includes("Resetting sync state"))
      ).toBe(true);
      expect(
        capturedLogs.some((log) => log.includes("State reset complete"))
      ).toBe(true);
    });

    it("should handle multiple sync operations", async () => {
      demo.setupEventListeners();

      // First sync
      await demo.performMockSync();
      let events = demo.getEventHistory();
      const firstSyncEvents = events.length;

      // Second sync (should be incremental)
      await demo.performMockSync();
      events = demo.getEventHistory();

      // Should have more events from second sync
      expect(events.length).toBeGreaterThan(firstSyncEvents);
    });
  });

  describe("runSyncDemo function", () => {
    it("should run complete demo workflow", async () => {
      // Capture console output
      const consoleSpy = vi.spyOn(console, "log").mockImplementation();

      await runSyncDemo();

      // Verify demo ran
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Starting Sync System Demo")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Demo completed successfully")
      );

      consoleSpy.mockRestore();
    });
  });

  describe("Event flow validation", () => {
    it("should emit events in correct order", async () => {
      const eventOrder: string[] = [];

      // Track event order
      demo.setupEventListeners();
      const eventSystem = (demo as any).eventSystem;

      eventSystem.onAny((event: any) => {
        eventOrder.push(event.type);
      });

      await demo.performMockSync();

      // Verify event ordering
      const startedIndex = eventOrder.indexOf(SyncEventType.SyncStarted);
      const completedIndex = eventOrder.lastIndexOf(
        SyncEventType.SyncCompleted
      );

      expect(startedIndex).toBe(0); // Should be first
      expect(completedIndex).toBe(eventOrder.length - 1); // Should be last

      // Verify progress events come between start and completion
      const progressIndices = eventOrder
        .map((type, index) =>
          type === SyncEventType.SyncProgress ? index : -1
        )
        .filter((index) => index !== -1);

      progressIndices.forEach((index) => {
        expect(index).toBeGreaterThan(startedIndex);
        expect(index).toBeLessThan(completedIndex);
      });
    });

    it("should emit batch events correctly", async () => {
      const batchEvents: any[] = [];

      demo.setupEventListeners();
      const eventSystem = (demo as any).eventSystem;

      eventSystem.on(SyncEventType.SyncBatchCompleted, (event: any) => {
        batchEvents.push(event);
      });

      await demo.performMockSync();

      // Should have multiple batches (3 items with batch size 2 = 2 batches)
      expect(batchEvents.length).toBe(2);

      // First batch should have hasMore = true
      expect(batchEvents[0].hasMore).toBe(true);
      expect(batchEvents[0].itemsInBatch).toBe(2);

      // Last batch should have hasMore = false
      expect(batchEvents[1].hasMore).toBe(false);
      expect(batchEvents[1].itemsInBatch).toBe(1);
    });
  });

  describe("State transitions", () => {
    it("should transition through sync states correctly", async () => {
      const stateTransitions: string[] = [];

      demo.setupEventListeners();
      const persistentState = (demo as any).persistentState;

      // Track initial state
      stateTransitions.push(persistentState.status);

      await demo.performMockSync();

      // Track final state
      stateTransitions.push(persistentState.status);

      expect(stateTransitions).toEqual([SyncStatus.Never, SyncStatus.Complete]);
    });

    it("should handle incremental sync state", async () => {
      demo.setupEventListeners();

      // First sync
      await demo.performMockSync();
      const persistentState = (demo as any).persistentState;
      expect(persistentState.status).toBe(SyncStatus.Complete);
      expect(persistentState.totalItemsSynced).toBe(3);

      // Second sync should build on first
      await demo.performMockSync();
      expect(persistentState.totalItemsSynced).toBe(6); // Should accumulate
    });
  });

  describe("Performance characteristics", () => {
    it("should complete sync in reasonable time", async () => {
      const startTime = Date.now();

      demo.setupEventListeners();
      await demo.performMockSync();

      const duration = Date.now() - startTime;

      // Should complete within 2 seconds (generous for CI environments)
      expect(duration).toBeLessThan(2000);
    });

    it("should handle batch processing delays", async () => {
      const eventTimes: number[] = [];

      demo.setupEventListeners();
      const eventSystem = (demo as any).eventSystem;

      eventSystem.on(SyncEventType.SyncBatchCompleted, () => {
        eventTimes.push(Date.now());
      });

      await demo.performMockSync();

      // Should have time gaps between batches (due to simulated delays)
      if (eventTimes.length > 1) {
        const timeDiff = eventTimes[1] - eventTimes[0];
        expect(timeDiff).toBeGreaterThan(100); // At least 100ms delay
      }
    });
  });
});
