//! Unit tests for sync state management
//!
//! Tests the core state management functionality including PersistentSyncState,
//! SyncSessionState, and state transitions.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  PersistentSyncState,
  SyncSessionState,
  SyncStatus,
  SyncConflict,
  SyncError,
} from "../src/sync/sync-state.js";

// Mock browser globals for Node.js environment
Object.defineProperty(globalThis, "window", {
  value: {},
  writable: true,
});

Object.defineProperty(globalThis, "navigator", {
  value: {
    onLine: true,
  },
  writable: true,
});

Object.defineProperty(globalThis, "crypto", {
  value: {
    randomUUID: () => "test-uuid-" + Math.random().toString(36).substring(2),
  },
  writable: true,
});

// Mock localStorage
const localStorageMock = {
  store: new Map<string, string>(),
  getItem: vi.fn((key: string) => localStorageMock.store.get(key) || null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageMock.store.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    localStorageMock.store.delete(key);
  }),
  clear: vi.fn(() => {
    localStorageMock.store.clear();
  }),
};

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

describe("PersistentSyncState", () => {
  const clientId = "test-client-id";

  beforeEach(() => {
    localStorageMock.store.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorageMock.store.clear();
  });

  describe("initialization", () => {
    it("should create new state with default values", () => {
      const state = new PersistentSyncState(clientId);

      expect(state.clientId).toBe(clientId);
      expect(state.status).toBe(SyncStatus.Never);
      expect(state.totalItemsSynced).toBe(0);
      expect(state.lastCursor).toBeUndefined();
      expect(state.lastSyncTime).toEqual(new Date(0));
    });

    it("should create state with custom values", () => {
      const lastSyncTime = new Date("2023-10-01T12:00:00Z");
      const updatedAt = new Date("2023-10-01T12:30:00Z");

      const state = new PersistentSyncState(
        clientId,
        lastSyncTime,
        100,
        SyncStatus.Complete,
        "cursor123",
        updatedAt
      );

      expect(state.clientId).toBe(clientId);
      expect(state.lastSyncTime).toEqual(lastSyncTime);
      expect(state.totalItemsSynced).toBe(100);
      expect(state.status).toBe(SyncStatus.Complete);
      expect(state.lastCursor).toBe("cursor123");
      expect(state.updatedAt).toEqual(updatedAt);
    });
  });

  describe("localStorage persistence", () => {
    it("should save state to localStorage", () => {
      const state = new PersistentSyncState(clientId);
      state.totalItemsSynced = 50;
      state.status = SyncStatus.InProgress;

      state.save();

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "webauthn_sync_state",
        expect.stringContaining('"totalItemsSynced":50')
      );
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "webauthn_sync_state",
        expect.stringContaining('"status":"InProgress"')
      );
    });

    it("should load state from localStorage", () => {
      // Setup stored state
      const storedData = {
        clientId,
        lastSyncTime: "2023-10-01T12:00:00.000Z",
        totalItemsSynced: 75,
        status: "Complete",
        lastCursor: "cursor456",
        updatedAt: "2023-10-01T12:30:00.000Z",
      };
      localStorageMock.store.set(
        "webauthn_sync_state",
        JSON.stringify(storedData)
      );

      const state = PersistentSyncState.load(clientId);

      expect(state.clientId).toBe(clientId);
      expect(state.totalItemsSynced).toBe(75);
      expect(state.status).toBe(SyncStatus.Complete);
      expect(state.lastCursor).toBe("cursor456");
      expect(state.lastSyncTime).toEqual(new Date("2023-10-01T12:00:00.000Z"));
    });

    it("should return default state when localStorage is empty", () => {
      const state = PersistentSyncState.load(clientId);

      expect(state.clientId).toBe(clientId);
      expect(state.status).toBe(SyncStatus.Never);
      expect(state.totalItemsSynced).toBe(0);
      expect(state.lastSyncTime).toEqual(new Date(0));
    });

    it("should return default state when localStorage has different clientId", () => {
      const storedData = {
        clientId: "different-client",
        lastSyncTime: "2023-10-01T12:00:00.000Z",
        totalItemsSynced: 75,
        status: "Complete",
      };
      localStorageMock.store.set(
        "webauthn_sync_state",
        JSON.stringify(storedData)
      );

      const state = PersistentSyncState.load(clientId);

      expect(state.clientId).toBe(clientId);
      expect(state.status).toBe(SyncStatus.Never);
      expect(state.totalItemsSynced).toBe(0);
    });

    it("should handle malformed localStorage data gracefully", () => {
      localStorageMock.store.set("webauthn_sync_state", "invalid-json");

      const state = PersistentSyncState.load(clientId);

      expect(state.clientId).toBe(clientId);
      expect(state.status).toBe(SyncStatus.Never);
    });
  });

  describe("state updates", () => {
    it("should update after successful sync", () => {
      const state = new PersistentSyncState(clientId);
      const syncTimestamp = new Date("2023-10-01T12:00:00Z");

      state.updateAfterSync(syncTimestamp, 25, "cursor123");

      expect(state.lastSyncTime).toEqual(syncTimestamp);
      expect(state.totalItemsSynced).toBe(25);
      expect(state.lastCursor).toBe("cursor123");
      expect(state.status).toBe(SyncStatus.InProgress);
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });

    it("should mark as complete when no cursor provided", () => {
      const state = new PersistentSyncState(clientId);
      const syncTimestamp = new Date("2023-10-01T12:00:00Z");

      state.updateAfterSync(syncTimestamp, 25);

      expect(state.status).toBe(SyncStatus.Complete);
      expect(state.lastCursor).toBeUndefined();
    });

    it("should accumulate synced items", () => {
      const state = new PersistentSyncState(clientId);

      state.updateAfterSync(new Date(), 10);
      state.updateAfterSync(new Date(), 15);

      expect(state.totalItemsSynced).toBe(25);
    });

    it("should mark as failed", () => {
      const state = new PersistentSyncState(clientId);
      state.status = SyncStatus.InProgress;

      state.markFailed();

      expect(state.status).toBe(SyncStatus.Failed);
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });

    it("should mark as paused", () => {
      const state = new PersistentSyncState(clientId);
      state.status = SyncStatus.InProgress;

      state.markPaused();

      expect(state.status).toBe(SyncStatus.Paused);
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });

    it("should reset state", () => {
      const state = new PersistentSyncState(clientId);
      state.totalItemsSynced = 100;
      state.status = SyncStatus.Complete;
      state.lastCursor = "cursor123";

      state.reset();

      expect(state.lastSyncTime).toEqual(new Date(0));
      expect(state.totalItemsSynced).toBe(0);
      expect(state.status).toBe(SyncStatus.Never);
      expect(state.lastCursor).toBeUndefined();
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });
  });

  describe("utility methods", () => {
    it("should detect if sync is in progress", () => {
      const state = new PersistentSyncState(clientId);

      expect(state.isInProgress()).toBe(false);

      state.status = SyncStatus.InProgress;
      expect(state.isInProgress()).toBe(true);
    });

    it("should calculate time since last sync", () => {
      const state = new PersistentSyncState(clientId);
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      state.lastSyncTime = oneHourAgo;

      const timeSince = state.timeSinceLastSync();

      expect(timeSince).toBeGreaterThan(3600000 - 1000); // About 1 hour, with small tolerance
      expect(timeSince).toBeLessThan(3600000 + 1000);
    });

    it("should convert to ClientSyncState", () => {
      const state = new PersistentSyncState(clientId);
      state.totalItemsSynced = 50;
      state.status = SyncStatus.Complete;
      state.lastCursor = "cursor123";

      const clientState = state.toClientSyncState();

      expect(clientState.client_id).toBe(clientId);
      expect(clientState.total_items_synced).toBe(50);
      expect(clientState.status).toBe(SyncStatus.Complete);
      expect(clientState.last_cursor).toBe("cursor123");
      expect(clientState.last_sync_time).toBe(state.lastSyncTime.toISOString());
      expect(clientState.updated_at).toBe(state.updatedAt.toISOString());
    });

    it("should create from ClientSyncState", () => {
      const clientState = {
        client_id: clientId,
        last_sync_time: "2023-10-01T12:00:00.000Z",
        total_items_synced: 75,
        status: SyncStatus.Complete,
        last_cursor: "cursor456",
        updated_at: "2023-10-01T12:30:00.000Z",
      };

      const state = PersistentSyncState.fromClientSyncState(clientState);

      expect(state.clientId).toBe(clientId);
      expect(state.totalItemsSynced).toBe(75);
      expect(state.status).toBe(SyncStatus.Complete);
      expect(state.lastCursor).toBe("cursor456");
      expect(state.lastSyncTime).toEqual(new Date("2023-10-01T12:00:00.000Z"));
      expect(state.updatedAt).toEqual(new Date("2023-10-01T12:30:00.000Z"));
    });
  });
});

describe("SyncSessionState", () => {
  const sessionId = "test-session-id";
  let persistentState: PersistentSyncState;

  beforeEach(() => {
    persistentState = new PersistentSyncState("test-client");
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("should create session with initial values", () => {
      const session = new SyncSessionState(sessionId, persistentState);

      expect(session.sessionId).toBe(sessionId);
      expect(session.persistentState).toBe(persistentState);
      expect(session.currentBatch).toBe(0);
      expect(session.itemsInCurrentSession).toBe(0);
      expect(session.conflicts).toEqual([]);
      expect(session.errors).toEqual([]);
      expect(session.startTime).toBeInstanceOf(Date);
    });
  });

  describe("conflict management", () => {
    it("should add conflicts", () => {
      const session = new SyncSessionState(sessionId, persistentState);
      const conflict: SyncConflict = {
        id: "conflict1",
        media_blob_id: "blob1",
        type: "version",
        local_version: {} as any,
        server_version: {} as any,
        detected_at: new Date().toISOString(),
        resolved: false,
      };

      session.addConflict(conflict);

      expect(session.conflicts).toHaveLength(1);
      expect(session.conflicts[0]).toBe(conflict);
    });

    it("should get unresolved conflicts", () => {
      const session = new SyncSessionState(sessionId, persistentState);
      const resolvedConflict: SyncConflict = {
        id: "conflict1",
        media_blob_id: "blob1",
        type: "version",
        local_version: {} as any,
        server_version: {} as any,
        detected_at: new Date().toISOString(),
        resolved: true,
      };
      const unresolvedConflict: SyncConflict = {
        id: "conflict2",
        media_blob_id: "blob2",
        type: "metadata",
        local_version: {} as any,
        server_version: {} as any,
        detected_at: new Date().toISOString(),
        resolved: false,
      };

      session.addConflict(resolvedConflict);
      session.addConflict(unresolvedConflict);

      const unresolved = session.getUnresolvedConflicts();
      expect(unresolved).toHaveLength(1);
      expect(unresolved[0].id).toBe("conflict2");
    });
  });

  describe("error management", () => {
    it("should add errors", () => {
      const session = new SyncSessionState(sessionId, persistentState);
      const error: SyncError = {
        type: "network_error",
        message: "Connection failed",
        timestamp: new Date().toISOString(),
        recoverable: true,
      };

      session.addError(error);

      expect(session.errors).toHaveLength(1);
      expect(session.errors[0]).toBe(error);
    });

    it("should get recoverable errors", () => {
      const session = new SyncSessionState(sessionId, persistentState);
      const recoverableError: SyncError = {
        type: "network_error",
        message: "Connection failed",
        timestamp: new Date().toISOString(),
        recoverable: true,
      };
      const fatalError: SyncError = {
        type: "auth_error",
        message: "Unauthorized",
        timestamp: new Date().toISOString(),
        recoverable: false,
      };

      session.addError(recoverableError);
      session.addError(fatalError);

      const recoverable = session.getRecoverableErrors();
      expect(recoverable).toHaveLength(1);
      expect(recoverable[0].type).toBe("network_error");
    });
  });

  describe("session metrics", () => {
    it("should calculate session duration", () => {
      const session = new SyncSessionState(sessionId, persistentState);

      // Wait a small amount to ensure duration > 0
      const duration = session.getSessionDuration();
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it("should clear session state", () => {
      const session = new SyncSessionState(sessionId, persistentState);

      // Add some data
      session.currentBatch = 5;
      session.itemsInCurrentSession = 100;
      session.addConflict({
        id: "conflict1",
        media_blob_id: "blob1",
        type: "version",
        local_version: {} as any,
        server_version: {} as any,
        detected_at: new Date().toISOString(),
        resolved: false,
      });
      session.addError({
        type: "error",
        message: "test error",
        timestamp: new Date().toISOString(),
        recoverable: true,
      });

      session.clear();

      expect(session.currentBatch).toBe(0);
      expect(session.itemsInCurrentSession).toBe(0);
      expect(session.conflicts).toEqual([]);
      expect(session.errors).toEqual([]);
      expect(session.startTime).toBeInstanceOf(Date);
    });
  });
});
