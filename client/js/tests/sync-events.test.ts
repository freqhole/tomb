//! Unit tests for sync events system
//!
//! Tests the event emitter, event builder, and event filtering functionality
//! for the sync system.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SyncEventType,
  SyncEventEmitter,
  SyncEventBuilder,
  createSyncEventSystem,
  SyncStartedEvent,
  SyncProgressEvent,
  SyncFailedEvent,
  SyncConflictEvent,
} from '../src/sync/sync-events.js';
import { SyncProgress, SyncError, SyncConflict } from '../src/sync/sync-state.js';

describe('SyncEventEmitter', () => {
  let emitter: SyncEventEmitter;

  beforeEach(() => {
    emitter = new SyncEventEmitter();
  });

  describe('event listener management', () => {
    it('should add and call event listeners', () => {
      const listener = vi.fn();

      emitter.on(SyncEventType.SyncStarted, listener);

      const event: SyncStartedEvent = {
        type: SyncEventType.SyncStarted,
        timestamp: new Date(),
        sessionId: 'test-session',
        clientId: 'test-client',
        isFullSync: false,
      };

      emitter.emit(event);

      expect(listener).toHaveBeenCalledWith(event);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should support multiple listeners for same event type', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      emitter.on(SyncEventType.SyncStarted, listener1);
      emitter.on(SyncEventType.SyncStarted, listener2);

      const event: SyncStartedEvent = {
        type: SyncEventType.SyncStarted,
        timestamp: new Date(),
        sessionId: 'test-session',
        clientId: 'test-client',
        isFullSync: true,
      };

      emitter.emit(event);

      expect(listener1).toHaveBeenCalledWith(event);
      expect(listener2).toHaveBeenCalledWith(event);
    });

    it('should remove event listeners', () => {
      const listener = vi.fn();

      emitter.on(SyncEventType.SyncStarted, listener);
      emitter.off(SyncEventType.SyncStarted, listener);

      const event: SyncStartedEvent = {
        type: SyncEventType.SyncStarted,
        timestamp: new Date(),
        sessionId: 'test-session',
        clientId: 'test-client',
        isFullSync: false,
      };

      emitter.emit(event);

      expect(listener).not.toHaveBeenCalled();
    });

    it('should support one-time listeners', () => {
      const listener = vi.fn();

      emitter.once(SyncEventType.SyncStarted, listener);

      const event: SyncStartedEvent = {
        type: SyncEventType.SyncStarted,
        timestamp: new Date(),
        sessionId: 'test-session',
        clientId: 'test-client',
        isFullSync: false,
      };

      emitter.emit(event);
      emitter.emit(event); // Second emit

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should support global listeners', () => {
      const globalListener = vi.fn();

      emitter.onAny(globalListener);

      const startedEvent: SyncStartedEvent = {
        type: SyncEventType.SyncStarted,
        timestamp: new Date(),
        sessionId: 'test-session',
        clientId: 'test-client',
        isFullSync: false,
      };

      const progressEvent: SyncProgressEvent = {
        type: SyncEventType.SyncProgress,
        timestamp: new Date(),
        sessionId: 'test-session',
        clientId: 'test-client',
        progress: {
          status: 'InProgress' as any,
          items_synced: 10,
        },
      };

      emitter.emit(startedEvent);
      emitter.emit(progressEvent);

      expect(globalListener).toHaveBeenCalledTimes(2);
      expect(globalListener).toHaveBeenCalledWith(startedEvent);
      expect(globalListener).toHaveBeenCalledWith(progressEvent);
    });

    it('should remove global listeners', () => {
      const globalListener = vi.fn();

      emitter.onAny(globalListener);
      emitter.offAny(globalListener);

      const event: SyncStartedEvent = {
        type: SyncEventType.SyncStarted,
        timestamp: new Date(),
        sessionId: 'test-session',
        clientId: 'test-client',
        isFullSync: false,
      };

      emitter.emit(event);

      expect(globalListener).not.toHaveBeenCalled();
    });
  });

  describe('event history', () => {
    it('should maintain event history', () => {
      const event1: SyncStartedEvent = {
        type: SyncEventType.SyncStarted,
        timestamp: new Date(),
        sessionId: 'test-session',
        clientId: 'test-client',
        isFullSync: false,
      };

      const event2: SyncProgressEvent = {
        type: SyncEventType.SyncProgress,
        timestamp: new Date(),
        sessionId: 'test-session',
        clientId: 'test-client',
        progress: {
          status: 'InProgress' as any,
          items_synced: 5,
        },
      };

      emitter.emit(event1);
      emitter.emit(event2);

      const history = emitter.getEventHistory();
      expect(history).toHaveLength(2);
      expect(history[0]).toBe(event1);
      expect(history[1]).toBe(event2);
    });

    it('should limit event history size', () => {
      // Create emitter with smaller max history for testing
      const smallEmitter = new SyncEventEmitter();
      (smallEmitter as any).maxHistorySize = 3;

      for (let i = 0; i < 5; i++) {
        const event: SyncStartedEvent = {
          type: SyncEventType.SyncStarted,
          timestamp: new Date(),
          sessionId: `session-${i}`,
          clientId: 'test-client',
          isFullSync: false,
        };
        smallEmitter.emit(event);
      }

      const history = smallEmitter.getEventHistory();
      expect(history).toHaveLength(3);
      expect(history[0].sessionId).toBe('session-2'); // Oldest kept
      expect(history[2].sessionId).toBe('session-4'); // Newest
    });

    it('should get recent events by type', () => {
      // Emit different event types
      const startedEvent: SyncStartedEvent = {
        type: SyncEventType.SyncStarted,
        timestamp: new Date(),
        sessionId: 'test-session',
        clientId: 'test-client',
        isFullSync: false,
      };

      const progressEvent1: SyncProgressEvent = {
        type: SyncEventType.SyncProgress,
        timestamp: new Date(),
        sessionId: 'test-session',
        clientId: 'test-client',
        progress: { status: 'InProgress' as any, items_synced: 5 },
      };

      const progressEvent2: SyncProgressEvent = {
        type: SyncEventType.SyncProgress,
        timestamp: new Date(),
        sessionId: 'test-session',
        clientId: 'test-client',
        progress: { status: 'InProgress' as any, items_synced: 10 },
      };

      emitter.emit(startedEvent);
      emitter.emit(progressEvent1);
      emitter.emit(progressEvent2);

      const progressEvents = emitter.getRecentEvents(SyncEventType.SyncProgress, 10);
      expect(progressEvents).toHaveLength(2);
      expect(progressEvents[0]).toBe(progressEvent1);
      expect(progressEvents[1]).toBe(progressEvent2);

      const startedEvents = emitter.getRecentEvents(SyncEventType.SyncStarted, 10);
      expect(startedEvents).toHaveLength(1);
      expect(startedEvents[0]).toBe(startedEvent);
    });

    it('should clear event history', () => {
      const event: SyncStartedEvent = {
        type: SyncEventType.SyncStarted,
        timestamp: new Date(),
        sessionId: 'test-session',
        clientId: 'test-client',
        isFullSync: false,
      };

      emitter.emit(event);
      expect(emitter.getEventHistory()).toHaveLength(1);

      emitter.clearHistory();
      expect(emitter.getEventHistory()).toHaveLength(0);
    });
  });

  describe('listener management', () => {
    it('should count listeners by type', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      expect(emitter.listenerCount(SyncEventType.SyncStarted)).toBe(0);

      emitter.on(SyncEventType.SyncStarted, listener1);
      expect(emitter.listenerCount(SyncEventType.SyncStarted)).toBe(1);

      emitter.on(SyncEventType.SyncStarted, listener2);
      expect(emitter.listenerCount(SyncEventType.SyncStarted)).toBe(2);

      emitter.off(SyncEventType.SyncStarted, listener1);
      expect(emitter.listenerCount(SyncEventType.SyncStarted)).toBe(1);
    });

    it('should count total listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const globalListener = vi.fn();

      expect(emitter.totalListenerCount()).toBe(0);

      emitter.on(SyncEventType.SyncStarted, listener1);
      emitter.on(SyncEventType.SyncProgress, listener2);
      emitter.onAny(globalListener);

      expect(emitter.totalListenerCount()).toBe(3);
    });

    it('should remove all listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const globalListener = vi.fn();

      emitter.on(SyncEventType.SyncStarted, listener1);
      emitter.on(SyncEventType.SyncProgress, listener2);
      emitter.onAny(globalListener);

      emitter.removeAllListeners();

      expect(emitter.totalListenerCount()).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should handle listener errors gracefully', () => {
      const errorListener = vi.fn(() => {
        throw new Error('Listener error');
      });
      const workingListener = vi.fn();

      // Mock console.error to avoid test output pollution
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      emitter.on(SyncEventType.SyncStarted, errorListener);
      emitter.on(SyncEventType.SyncStarted, workingListener);

      const event: SyncStartedEvent = {
        type: SyncEventType.SyncStarted,
        timestamp: new Date(),
        sessionId: 'test-session',
        clientId: 'test-client',
        isFullSync: false,
      };

      emitter.emit(event);

      expect(errorListener).toHaveBeenCalled();
      expect(workingListener).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});

describe('SyncEventBuilder', () => {
  const sessionId = 'test-session';
  const clientId = 'test-client';
  let builder: SyncEventBuilder;

  beforeEach(() => {
    builder = new SyncEventBuilder(sessionId, clientId);
  });

  describe('event creation', () => {
    it('should create sync started event', () => {
      const event = builder.syncStarted(true, 100);

      expect(event.type).toBe(SyncEventType.SyncStarted);
      expect(event.sessionId).toBe(sessionId);
      expect(event.clientId).toBe(clientId);
      expect(event.isFullSync).toBe(true);
      expect(event.estimatedItems).toBe(100);
      expect(event.timestamp).toBeInstanceOf(Date);
    });

    it('should create sync progress event', () => {
      const progress: SyncProgress = {
        status: 'InProgress' as any,
        items_synced: 50,
        total_items: 100,
        progress: 50,
      };

      const event = builder.syncProgress(progress);

      expect(event.type).toBe(SyncEventType.SyncProgress);
      expect(event.progress).toBe(progress);
    });

    it('should create sync completed event', () => {
      const event = builder.syncCompleted(100, 5000, 2);

      expect(event.type).toBe(SyncEventType.SyncCompleted);
      expect(event.totalItems).toBe(100);
      expect(event.duration).toBe(5000);
      expect(event.conflictsResolved).toBe(2);
    });

    it('should create sync failed event', () => {
      const error: SyncError = {
        type: 'network_error',
        message: 'Connection failed',
        timestamp: new Date().toISOString(),
        recoverable: true,
      };

      const event = builder.syncFailed(error, false, 5000);

      expect(event.type).toBe(SyncEventType.SyncFailed);
      expect(event.error).toBe(error);
      expect(event.canRetry).toBe(false);
      expect(event.retryDelay).toBe(5000);
    });

    it('should create sync paused event', () => {
      const event = builder.syncPaused('network', false);

      expect(event.type).toBe(SyncEventType.SyncPaused);
      expect(event.reason).toBe('network');
      expect(event.canResume).toBe(false);
    });

    it('should create sync resumed event', () => {
      const event = builder.syncResumed('cursor123');

      expect(event.type).toBe(SyncEventType.SyncResumed);
      expect(event.resumeFromCursor).toBe('cursor123');
    });

    it('should create sync conflict event', () => {
      const conflict: SyncConflict = {
        id: 'conflict1',
        media_blob_id: 'blob1',
        type: 'version',
        local_version: {} as any,
        server_version: {} as any,
        detected_at: new Date().toISOString(),
        resolved: false,
      };

      const event = builder.syncConflict(conflict);

      expect(event.type).toBe(SyncEventType.SyncConflict);
      expect(event.conflict).toBe(conflict);
    });

    it('should create sync conflict resolved event', () => {
      const event = builder.syncConflictResolved('conflict1', 'keep_server');

      expect(event.type).toBe(SyncEventType.SyncConflictResolved);
      expect(event.conflictId).toBe('conflict1');
      expect(event.resolution).toBe('keep_server');
    });

    it('should create connection changed event', () => {
      const event = builder.connectionChanged(false, false);

      expect(event.type).toBe(SyncEventType.ConnectionChanged);
      expect(event.isOnline).toBe(false);
      expect(event.canSync).toBe(false);
    });

    it('should create items received event', () => {
      const items = [{ id: 'blob1' } as any, { id: 'blob2' } as any];
      const event = builder.itemsReceived(items, 1, 2);

      expect(event.type).toBe(SyncEventType.ItemsReceived);
      expect(event.items).toBe(items);
      expect(event.batchNumber).toBe(1);
      expect(event.totalReceived).toBe(2);
    });

    it('should create items processed event', () => {
      const event = builder.itemsProcessed(8, 2, 10);

      expect(event.type).toBe(SyncEventType.ItemsProcessed);
      expect(event.processedCount).toBe(8);
      expect(event.failedCount).toBe(2);
      expect(event.totalProcessed).toBe(10);
    });
  });

  describe('default values', () => {
    it('should use default values for optional parameters', () => {
      const event = builder.syncFailed({
        type: 'error',
        message: 'test',
        timestamp: new Date().toISOString(),
        recoverable: true,
      });

      expect(event.canRetry).toBe(true); // default
      expect(event.retryDelay).toBeUndefined(); // default
    });

    it('should use default canSync value based on isOnline', () => {
      const onlineEvent = builder.connectionChanged(true);
      expect(onlineEvent.canSync).toBe(true);

      const offlineEvent = builder.connectionChanged(false);
      expect(offlineEvent.canSync).toBe(false);
    });
  });
});

describe('createSyncEventSystem', () => {
  const sessionId = 'test-session';
  const clientId = 'test-client';

  it('should create event system with emitter and builder', () => {
    const system = createSyncEventSystem(sessionId, clientId);

    expect(system.emitter).toBeInstanceOf(SyncEventEmitter);
    expect(system.builder).toBeInstanceOf(SyncEventBuilder);
    expect(typeof system.emit).toBe('function');
    expect(typeof system.on).toBe('function');
    expect(typeof system.once).toBe('function');
    expect(typeof system.off).toBe('function');
    expect(typeof system.onAny).toBe('function');
    expect(typeof system.offAny).toBe('function');
  });

  it('should provide convenience methods that work', () => {
    const system = createSyncEventSystem(sessionId, clientId);
    const listener = vi.fn();

    system.on(SyncEventType.SyncStarted, listener);

    const event = system.builder.syncStarted(false);
    system.emit(event);

    expect(listener).toHaveBeenCalledWith(event);
  });

  it('should bind methods correctly', () => {
    const system = createSyncEventSystem(sessionId, clientId);
    const listener = vi.fn();

    // Test that bound methods work when destructured
    const { on, emit, builder } = system;

    on(SyncEventType.SyncStarted, listener);
    const event = builder.syncStarted(false);
    emit(event);

    expect(listener).toHaveBeenCalledWith(event);
  });
});
