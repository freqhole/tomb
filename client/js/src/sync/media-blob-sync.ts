//! Media Blob Sync - TypeScript Client Library
//!
//! This is the main client library for Phase 4.3 of the media blob sync system.
//! It provides a simple, framework-agnostic interface for synchronizing media blobs
//! with comprehensive event handling, pause/resume functionality, and offline support.

import { ApiClient } from "../lib/api-client.js";
import { WebSocketConnection } from "../lib/websocket-connection.js";
import { CoreSyncEngine, SyncOptions } from "./core-sync-engine.js";
import { SyncApiClient, createSyncApiClient } from "./sync-api-client.js";
import {
  SyncProgress,
  SyncError,
  SyncConflict,
  SyncRecommendationsResponse,
} from "./sync-schemas.js";
import { PersistentSyncState } from "./sync-state.js";
import type { MediaBlob } from "../lib/websocket-types.js";
import { SyncEventType, SyncEvent } from "./sync-events.js";
import type { SyncStatus } from "./event-types.js";

/**
 * Event types for MediaBlobSync
 */
export interface MediaBlobSyncProgressEvent {
  progress: SyncProgress;
}

export interface MediaBlobSyncConflictEvent {
  conflict: SyncConflict;
}

export interface MediaBlobSyncErrorEvent {
  error: SyncError;
}

export interface MediaBlobSyncItemsEvent {
  items: MediaBlob[];
}

export interface MediaBlobSyncConnectionEvent {
  isOnline: boolean;
  canSync: boolean;
}

/**
 * Media Blob Sync Client Configuration
 */
export interface MediaBlobSyncConfig {
  /** API server base URL */
  serverUrl: string;
  /** Authentication token */
  authToken: string;
  /** Client identifier (auto-generated if not provided) */
  clientId?: string;
  /** Default batch size for sync operations */
  batchSize?: number;
  /** Maximum retry attempts for failed operations */
  maxRetryAttempts?: number;
  /** Include binary data in sync by default */
  includeBinaryData?: boolean;
  /** Conflict resolution strategy */
  conflictResolution?: "manual" | "keep_local" | "keep_server";
  /** Enable local storage caching */
  enableStorage?: boolean;
  /** Enable real-time notifications via WebSocket */
  enableRealtime?: boolean;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Sync event listener function type
 */
export type SyncEventListener<T extends SyncEvent = SyncEvent> = (
  event: T
) => void;

/**
 * Re-export SyncStatus from event-types to avoid duplication
 */
export type { SyncStatus } from "./event-types.js";

/**
 * Main Media Blob Sync Client
 */
export class MediaBlobSync extends EventTarget {
  private config: MediaBlobSyncConfig;
  private syncEngine: CoreSyncEngine;
  private syncApiClient: SyncApiClient;
  private apiClient: ApiClient;
  private wsConnection: WebSocketConnection | null = null;
  private isInitialized = false;
  private currentStatus: SyncStatus;

  constructor(config: MediaBlobSyncConfig) {
    super();

    // Validate and normalize config
    this.config = {
      clientId: crypto.randomUUID(),
      batchSize: 50,
      maxRetryAttempts: 3,
      includeBinaryData: false,
      conflictResolution: "manual",
      enableStorage: true,
      enableRealtime: true,
      debug: false,
      ...config,
    };

    // Initialize API client
    this.apiClient = new ApiClient({
      baseUrl: this.config.serverUrl,
    });

    // Initialize sync API client
    this.syncApiClient = createSyncApiClient({
      apiClient: this.apiClient,
      validateRequests: true,
    });

    // Initialize sync engine
    const syncConfig = {
      apiBaseUrl: this.config.serverUrl,
      authToken: this.config.authToken,
      clientId: this.config.clientId!,
      batchSize: this.config.batchSize!,
      maxRetryAttempts: this.config.maxRetryAttempts!,
      includeBinaryData: this.config.includeBinaryData!,
      conflictResolution: this.config.conflictResolution!,
      enableStorage: this.config.enableStorage!,
    };

    this.syncEngine = new CoreSyncEngine(syncConfig, this.apiClient);

    // Initialize status
    this.currentStatus = {
      state: "never",
      totalItemsSynced: 0,
      conflicts: [],
      online: navigator.onLine,
    };

    // Setup event forwarding
    this.setupEventForwarding();
    this.setupNetworkMonitoring();

    if (this.config.debug) {
      console.log("🚀 MediaBlobSync initialized with config:", this.config);
    }
  }

  /**
   * Initialize the sync client
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      await this.syncEngine.initialize();

      // Initialize WebSocket if enabled
      if (this.config.enableRealtime) {
        await this.initializeWebSocket();
      }

      this.isInitialized = true;
      this.updateStatus();

      if (this.config.debug) {
        console.log("✅ MediaBlobSync initialized successfully");
      }

      this.dispatchEvent(new CustomEvent("initialized"));
    } catch (error) {
      if (this.config.debug) {
        console.error("❌ MediaBlobSync initialization failed:", error);
      }
      throw error;
    }
  }

  /**
   * Start synchronization
   */
  async sync(options: Partial<SyncOptions> = {}): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      this.currentStatus.state = "syncing";
      this.dispatchEvent(new CustomEvent("sync-started"));

      await this.syncEngine.sync(options);

      this.currentStatus.state = "idle";
      this.updateStatus();
      this.dispatchEvent(new CustomEvent("sync-completed"));
    } catch (error) {
      this.currentStatus.state = "failed";
      this.updateStatus();
      this.dispatchEvent(new CustomEvent("sync-failed", { detail: error }));
      throw error;
    }
  }

  /**
   * Start a full synchronization (re-download everything)
   */
  async fullSync(): Promise<void> {
    return this.sync({ fullSync: true, force: true });
  }

  /**
   * Pause the current sync operation
   */
  pauseSync(): void {
    if (this.currentStatus.state === "syncing") {
      this.syncEngine.pauseSync();
      this.currentStatus.state = "paused";
      this.updateStatus();
      this.dispatchEvent(new CustomEvent("sync-paused"));
    }
  }

  /**
   * Resume a paused sync operation
   */
  async resumeSync(): Promise<void> {
    if (this.currentStatus.state === "paused") {
      this.currentStatus.state = "syncing";
      this.dispatchEvent(new CustomEvent("sync-resumed"));

      try {
        await this.syncEngine.resumeSync();
        this.currentStatus.state = "idle";
        this.updateStatus();
        this.dispatchEvent(new CustomEvent("sync-completed"));
      } catch (error) {
        this.currentStatus.state = "failed";
        this.updateStatus();
        this.dispatchEvent(new CustomEvent("sync-failed", { detail: error }));
        throw error;
      }
    }
  }

  /**
   * Get current sync status
   */
  getStatus(): SyncStatus {
    return { ...this.currentStatus };
  }

  /**
   * Get sync recommendations from server
   */
  async getRecommendations(): Promise<SyncRecommendationsResponse | null> {
    try {
      return await this.syncEngine.getSyncRecommendations();
    } catch (error) {
      if (this.config.debug) {
        console.warn("Failed to get sync recommendations:", error);
      }
      return null;
    }
  }

  /**
   * Check if sync is needed
   */
  async shouldSync(): Promise<boolean> {
    try {
      const result = await this.syncApiClient.checkSyncNeeded();
      return result.should_sync;
    } catch (error) {
      if (this.config.debug) {
        console.warn("Failed to check if sync is needed:", error);
      }
      return true; // Default to syncing on error
    }
  }

  /**
   * Resolve a sync conflict
   */
  async resolveConflict(
    conflictId: string,
    resolution: "keep_local" | "keep_server" | "merge" | "skip"
  ): Promise<void> {
    // Find the conflict
    const conflictIndex = this.currentStatus.conflicts.findIndex(
      (c) => c.id === conflictId
    );
    if (conflictIndex === -1) {
      throw new Error(`Conflict ${conflictId} not found`);
    }

    const conflict = this.currentStatus.conflicts[conflictIndex];
    if (conflict) {
      conflict.resolved = true;
      conflict.resolution = resolution;
    }

    // Remove from current conflicts
    this.currentStatus.conflicts.splice(conflictIndex, 1);
    this.updateStatus();

    this.dispatchEvent(
      new CustomEvent("conflict-resolved", {
        detail: { conflictId, resolution },
      })
    );
  }

  /**
   * Get pending conflicts
   */
  getConflicts(): SyncConflict[] {
    return [...this.currentStatus.conflicts];
  }

  /**
   * Subscribe to sync events
   */
  on<T extends keyof SyncEventMap>(event: T, listener: SyncEventMap[T]): void {
    this.addEventListener(event, listener as EventListener);
  }

  /**
   * Unsubscribe from sync events
   */
  off<T extends keyof SyncEventMap>(event: T, listener: SyncEventMap[T]): void {
    this.removeEventListener(event, listener as EventListener);
  }

  /**
   * Subscribe to sync events (one-time)
   */
  once<T extends keyof SyncEventMap>(
    event: T,
    listener: SyncEventMap[T]
  ): void {
    const oneTimeListener = (e: Event) => {
      listener(e as any);
      this.removeEventListener(event, oneTimeListener);
    };
    this.addEventListener(event, oneTimeListener);
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    if (this.wsConnection) {
      this.wsConnection.disconnect();
    }

    await this.syncEngine.cleanup();
    this.isInitialized = false;

    if (this.config.debug) {
      console.log("🧹 MediaBlobSync destroyed");
    }
  }

  // Private methods

  private setupEventForwarding(): void {
    // Forward sync engine events to our event system
    this.syncEngine.on(
      SyncEventType.Progress,
      (event: { progress: SyncProgress }) => {
        this.currentStatus.progress = event.progress;
        this.updateStatus();
        this.dispatchEvent(
          new CustomEvent<MediaBlobSyncProgressEvent>("progress", {
            detail: { progress: event.progress },
          })
        );
      }
    );

    this.syncEngine.on(
      SyncEventType.ConflictDetected,
      (event: { conflict: SyncConflict }) => {
        this.currentStatus.conflicts.push(event.conflict);
        this.updateStatus();
        this.dispatchEvent(
          new CustomEvent<MediaBlobSyncConflictEvent>("conflict", {
            detail: { conflict: event.conflict },
          })
        );
      }
    );

    this.syncEngine.on(SyncEventType.Failed, (event: { error: SyncError }) => {
      this.dispatchEvent(
        new CustomEvent<MediaBlobSyncErrorEvent>("error", {
          detail: { error: event.error },
        })
      );
    });

    this.syncEngine.on(
      SyncEventType.ItemsReceived,
      (event: { items: MediaBlob[] }) => {
        this.dispatchEvent(
          new CustomEvent<MediaBlobSyncItemsEvent>("items-received", {
            detail: { items: event.items },
          })
        );
      }
    );

    this.syncEngine.on(
      SyncEventType.ConnectionChanged,
      (event: { isOnline: boolean; canSync: boolean }) => {
        this.currentStatus.online = event.isOnline;
        this.updateStatus();
        this.dispatchEvent(
          new CustomEvent<MediaBlobSyncConnectionEvent>("connection-changed", {
            detail: { isOnline: event.isOnline, canSync: event.canSync },
          })
        );
      }
    );
  }

  private setupNetworkMonitoring(): void {
    const updateOnlineStatus = () => {
      this.currentStatus.online = navigator.onLine;
      this.updateStatus();
    };

    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
  }

  private async initializeWebSocket(): Promise<void> {
    try {
      this.wsConnection = new WebSocketConnection({
        url: this.config.serverUrl.replace("http", "ws") + "/ws",
      });

      this.wsConnection.addEventListener("message", (event: Event) => {
        if (event instanceof MessageEvent) {
          const data = JSON.parse(event.data);
          if (
            data.type === "media_blob_updated" ||
            data.type === "media_blob_created"
          ) {
            this.dispatchEvent(
              new CustomEvent("realtime-update", { detail: data })
            );

            // Auto-sync if enabled and not currently syncing
            if (this.currentStatus.state === "idle") {
              this.sync({ force: false }).catch((error) => {
                if (this.config.debug) {
                  console.warn("Auto-sync failed:", error);
                }
              });
            }
          }
        }
      });

      await this.wsConnection.connect();

      if (this.config.debug) {
        console.log("📡 WebSocket connection established");
      }
    } catch (error) {
      if (this.config.debug) {
        console.warn("WebSocket initialization failed:", error);
      }
    }
  }

  private updateStatus(): void {
    const syncProgress = this.syncEngine.getSyncStatus();
    const persistentState = PersistentSyncState.load(this.config.clientId!);

    // Map sync status to our status
    switch (syncProgress.status) {
      case "Never":
        this.currentStatus.state = "never";
        break;
      case "InProgress":
        this.currentStatus.state = "syncing";
        break;
      case "Complete":
        this.currentStatus.state = "idle";
        break;
      case "Failed":
        this.currentStatus.state = "failed";
        break;
      case "Paused":
        this.currentStatus.state = "paused";
        break;
    }

    this.currentStatus.totalItemsSynced = persistentState.totalItemsSynced;
    this.currentStatus.lastSync =
      persistentState.lastSyncTime.getTime() > 0
        ? persistentState.lastSyncTime
        : undefined;
    this.currentStatus.progress = syncProgress;

    this.dispatchEvent(
      new CustomEvent("status-changed", {
        detail: this.currentStatus,
      })
    );
  }
}

/**
 * Event map for type-safe event handling
 */
export interface SyncEventMap {
  initialized: (event: CustomEvent) => void;
  "sync-started": (event: CustomEvent) => void;
  "sync-completed": (event: CustomEvent) => void;
  "sync-failed": (event: CustomEvent<Error>) => void;
  "sync-paused": (event: CustomEvent) => void;
  "sync-resumed": (event: CustomEvent) => void;
  progress: (event: CustomEvent<SyncProgress>) => void;
  conflict: (event: CustomEvent<SyncConflict>) => void;
  "conflict-resolved": (
    event: CustomEvent<{ conflictId: string; resolution: string }>
  ) => void;
  error: (event: CustomEvent<SyncError>) => void;
  "items-received": (event: CustomEvent<MediaBlob[]>) => void;
  "realtime-update": (event: CustomEvent<any>) => void;
  "connection-changed": (event: CustomEvent<{ online: boolean }>) => void;
  "status-changed": (event: CustomEvent<SyncStatus>) => void;
}

/**
 * Factory function to create a configured sync client
 */
export function createMediaBlobSync(
  config: MediaBlobSyncConfig
): MediaBlobSync {
  return new MediaBlobSync(config);
}

/**
 * Utility to check if browser supports the sync features
 */
export function isSyncSupported(): boolean {
  return !!(
    typeof window !== "undefined" &&
    window.crypto &&
    typeof window.crypto.randomUUID === "function" &&
    window.localStorage &&
    window.EventTarget &&
    typeof AbortController !== "undefined"
  );
}

/**
 * Get default sync configuration
 */
export function getDefaultSyncConfig(): Partial<MediaBlobSyncConfig> {
  return {
    batchSize: 50,
    maxRetryAttempts: 3,
    includeBinaryData: false,
    conflictResolution: "manual",
    enableStorage: true,
    enableRealtime: true,
    debug: false,
  };
}

/**
 * Validate sync configuration
 */
export function validateMediaBlobSyncConfig(
  config: Partial<MediaBlobSyncConfig>
): void {
  if (!config.serverUrl) {
    throw new Error("serverUrl is required");
  }

  if (!config.authToken) {
    throw new Error("authToken is required");
  }

  try {
    new URL(config.serverUrl);
  } catch {
    throw new Error("serverUrl must be a valid URL");
  }

  if (config.batchSize && (config.batchSize < 1 || config.batchSize > 1000)) {
    throw new Error("batchSize must be between 1 and 1000");
  }

  if (
    config.maxRetryAttempts &&
    (config.maxRetryAttempts < 0 || config.maxRetryAttempts > 10)
  ) {
    throw new Error("maxRetryAttempts must be between 0 and 10");
  }
}
