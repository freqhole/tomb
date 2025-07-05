//! Unified Sync Manager - Core Implementation
//!
//! This is the main implementation of the new unified sync system. It provides
//! a single, clean interface for synchronizing multiple domains (music, photos,
//! documents, etc.) with automatic WebSocket-based updates and service worker support.

import { SyncStatus, SyncEventType } from "./types.js";

import type {
  UnifiedSyncManager,
  SyncDomain,
  SyncAllOptions,
  SyncDomainOptions,
  SyncResult,
  SyncStatusMap,
  SyncProgressMap,
  SyncProgress,
  SyncEventListener,
  AnySyncEvent,
  SyncStartedEvent,
  SyncProgressEvent,
  SyncCompletedEvent,
  SyncFailedEvent,
  AutoSyncTriggeredEvent,
  // ConnectionChangedEvent,
  DomainConfig,
  UnifiedSyncConfig,
  SyncError,
  BinarySyncStats,
  BinarySyncProgressEvent,
  StorageStats,
} from "./types.js";
import { debugInfo, debugWarn, debugError } from "./debug.js";
import { ConnectionStatus } from "../lib/websocket-client.js";

import type { UnifiedStorage } from "./unified-storage.js";
import type { WebSocketClient } from "../lib/websocket-client.js";
import type { ApiClient } from "../lib/api-client.js";

import type { ServiceWorkerSyncManager } from "./service-worker-types.js";
import {
  createServiceWorkerSyncManager,
  isServiceWorkerSyncSupported,
} from "./service-worker-sync-manager.js";

/**
 * Main unified sync manager implementation
 */
export class UnifiedSyncManagerImpl implements UnifiedSyncManager {
  private storage: UnifiedStorage;
  // @ts-ignore - Will be used for WebSocket notifications in Phase 2
  private wsClient: WebSocketClient;
  // @ts-ignore - Used for direct API calls in sync operations
  private apiClient: ApiClient;
  private config: UnifiedSyncConfig;
  private domainConfigs: Record<SyncDomain, DomainConfig>;

  // State tracking
  private currentStatus: SyncStatusMap;
  private currentProgress: SyncProgressMap;
  private activeSyncs = new Set<SyncDomain>();
  private eventListeners = new Map<SyncEventType, Set<SyncEventListener>>();

  // Auto-sync state
  // @ts-ignore - Will be used for auto-sync features in Phase 3
  private autoSyncEnabled = false;
  private autoSyncTimeouts = new Map<SyncDomain, NodeJS.Timeout>();

  // Service worker integration
  private serviceWorkerSyncManager: ServiceWorkerSyncManager | null = null;

  constructor(
    storage: UnifiedStorage,
    wsClient: WebSocketClient,
    apiClient: ApiClient,
    config: UnifiedSyncConfig
  ) {
    this.storage = storage;
    this.wsClient = wsClient;
    this.apiClient = apiClient;
    this.config = config;
    this.domainConfigs = this.createMinimalDomainConfigs();

    // Initialize status tracking
    this.currentStatus = {
      music: SyncStatus.Never,
      photos: SyncStatus.Never,
      documents: SyncStatus.Never,
      videos: SyncStatus.Never,
    };

    this.currentProgress = {
      music: this.createEmptyProgress(),
      photos: this.createEmptyProgress(),
      documents: this.createEmptyProgress(),
      videos: this.createEmptyProgress(),
    };
  }

  /**
   * Initialize the sync manager
   */
  async initialize(): Promise<void> {
    debugInfo("🚀 Initializing UnifiedSyncManager...");

    // Initialize storage
    await this.storage.initialize();

    // Set up WebSocket listeners
    this.setupWebSocketListeners();

    // Load previous sync states
    await this.loadSyncStates();

    // Enable auto-sync if configured
    if (this.config.autoSync.enabled) {
      this.enableAutoSync(true);
    }

    // Initialize service worker sync if enabled and supported
    if (this.config.serviceWorker?.enabled && isServiceWorkerSyncSupported()) {
      try {
        this.serviceWorkerSyncManager = createServiceWorkerSyncManager(
          this,
          this.config.serviceWorker
        );
        await this.serviceWorkerSyncManager.initialize();
        console.log("✅ Service Worker sync initialized");
      } catch (error) {
        console.warn("⚠️ Service Worker sync initialization failed:", error);
      }
    }

    debugInfo("✅ UnifiedSyncManager initialized");
  }

  /**
   * Sync all domains
   */
  async syncAll(options: SyncAllOptions = {}): Promise<SyncResult> {
    debugInfo("🔄 Starting sync all domains...");

    const startTime = Date.now();
    const domainsToSync =
      options.domains || (Object.keys(this.domainConfigs) as SyncDomain[]);
    const priorityOrder = options.priorityOrder || domainsToSync;

    // Sort domains by priority
    const orderedDomains = priorityOrder.filter((domain) =>
      domainsToSync.includes(domain)
    );

    // Add any missing domains at the end
    domainsToSync.forEach((domain) => {
      if (!orderedDomains.includes(domain)) {
        orderedDomains.push(domain);
      }
    });

    const results: SyncResult[] = [];
    let totalItemsSynced = 0;
    const errors: SyncError[] = [];

    // Emit started event
    this.emitEvent({
      type: SyncEventType.Started,
      timestamp: new Date(),
      domain: orderedDomains[0], // First domain
      isFullSync: options.forceFullSync || false,
    } as SyncStartedEvent);

    // Sync each domain in order
    for (const domain of orderedDomains) {
      try {
        const domainOptions: SyncDomainOptions = {
          forceFullSync: options.forceFullSync,
          includeBinaryData: options.includeBinaryData,
          include_media_blobs: options.include_media_blobs,
        };

        const result = await this.syncDomain(domain, domainOptions);
        results.push(result);
        totalItemsSynced += result.itemsSynced;

        if (result.errors.length > 0) {
          errors.push(...result.errors);
        }
      } catch (error) {
        console.error(`❌ Failed to sync domain ${domain}:`, error);
        const syncError: SyncError = {
          code: "DOMAIN_SYNC_FAILED",
          message: `Failed to sync ${domain}: ${error instanceof Error ? error.message : String(error)}`,
          details: error,
        };
        errors.push(syncError);
      }
    }

    const duration = Date.now() - startTime;
    const finalStatus =
      errors.length > 0 ? SyncStatus.Failed : SyncStatus.Complete;

    // Create aggregate result
    const aggregateResult: SyncResult = {
      domain: "music", // Primary domain for now
      status: finalStatus,
      itemsSynced: totalItemsSynced,
      totalItems: results.reduce((sum, r) => sum + r.totalItems, 0),
      duration,
      errors,
      binaryStats: this.aggregateBinaryStats(results),
    };

    // Emit completion event
    this.emitEvent({
      type: SyncEventType.AllCompleted,
      timestamp: new Date(),
      result: aggregateResult,
    } as SyncCompletedEvent);

    console.log(
      `✅ Sync all completed: ${totalItemsSynced} items in ${duration}ms`
    );
    return aggregateResult;
  }

  /**
   * Sync a specific domain
   */
  async syncDomain(
    domain: SyncDomain,
    options: SyncDomainOptions = {}
  ): Promise<SyncResult> {
    debugInfo(`🔄 Starting sync for domain: ${domain}`);

    if (this.activeSyncs.has(domain)) {
      throw new Error(`Sync already in progress for domain: ${domain}`);
    }

    this.activeSyncs.add(domain);
    this.updateStatus(domain, SyncStatus.InProgress);

    const startTime = Date.now();
    const errors: SyncError[] = [];

    try {
      // Emit started event
      this.emitEvent({
        type: SyncEventType.Started,
        timestamp: new Date(),
        domain,
        isFullSync: options.forceFullSync || false,
      } as SyncStartedEvent);

      // Step 1: Sync structured data
      const structuredResult = await this.syncStructuredData(domain, options);

      // Step 2: Binary data sync via WebSocket
      let binaryStats: BinarySyncStats | undefined;
      if (
        options.includeBinaryData &&
        (domain === "music" || domain === "photos")
      ) {
        debugInfo("🔄 Starting binary data sync...");
        binaryStats = await this.syncBinaryData(domain);
      }

      const duration = Date.now() - startTime;
      const result: SyncResult = {
        domain,
        status: SyncStatus.Complete,
        itemsSynced: structuredResult.itemsSynced,
        totalItems: structuredResult.totalItems,
        duration,
        binaryStats,
        errors,
      };

      // Update status
      this.updateStatus(domain, SyncStatus.Complete);
      this.updateProgress(domain, {
        status: SyncStatus.Complete,
        progress: 100,
        itemsProcessed: result.itemsSynced,
        totalItems: result.totalItems,
        currentBatch: 1,
        totalBatches: 1,
        currentOperation: "Complete",
      });

      // Save sync completion state - use songs count for music domain
      const itemsToSave =
        domain === "music" && result.breakdown
          ? result.breakdown.songs.itemsSynced
          : result.itemsSynced;
      await this.storage.saveSyncCompletion(domain, itemsToSave);

      // Emit completion event
      this.emitEvent({
        type: SyncEventType.DomainCompleted,
        timestamp: new Date(),
        domain,
        result,
      } as SyncCompletedEvent);

      console.log(
        `✅ Domain ${domain} sync completed: ${result.itemsSynced} items`
      );
      return result;
    } catch (error) {
      debugError(`❌ Domain ${domain} sync failed:`, error);

      const syncError: SyncError = {
        code: "SYNC_FAILED",
        message: error instanceof Error ? error.message : String(error),
        details: error,
      };
      errors.push(syncError);

      this.updateStatus(domain, SyncStatus.Failed);

      // Emit failure event
      this.emitEvent({
        type: SyncEventType.Failed,
        timestamp: new Date(),
        domain,
        error: syncError,
      } as SyncFailedEvent);

      const duration = Date.now() - startTime;
      return {
        domain,
        status: SyncStatus.Failed,
        itemsSynced: 0,
        totalItems: 0,
        duration,
        errors,
      };
    } finally {
      this.activeSyncs.delete(domain);
    }
  }

  /**
   * Get a blob URL for media content
   */
  async getBlobUrl(blobId: string): Promise<string | null> {
    try {
      // Check if we have cached raw binary data
      const binaryData = await this.storage.getBinaryData(blobId);
      if (binaryData) {
        // Get metadata from media_blobs table (as per plan)
        const mediaBlobs = await this.storage.getItems("documents"); // media_blobs table
        const mediaBlob = mediaBlobs.find((blob: any) => blob.id === blobId);

        if (mediaBlob) {
          // Create blob URL from cached data using metadata from media_blobs
          const blob = new Blob([binaryData], {
            type: mediaBlob.mime || "application/octet-stream",
          });
          return URL.createObjectURL(blob);
        }
      }

      // Fall back to direct API URL
      return `${this.config.apiBaseUrl}/blobs/${blobId}`;
    } catch (error) {
      console.error(`Failed to get blob URL for ${blobId}:`, error);
      return null;
    }
  }

  /**
   * Enable/disable auto-sync
   */
  enableAutoSync(enabled: boolean): void {
    debugInfo(`${enabled ? "🔄 Enabling" : "⏸️ Disabling"} auto-sync...`);

    this.autoSyncEnabled = enabled;

    if (enabled) {
      // Set up periodic sync if configured
      if (this.config.autoSync.periodicInterval) {
        this.setupPeriodicSync();
      }
    } else {
      // Clear all auto-sync timeouts
      this.autoSyncTimeouts.forEach((timeout) => clearTimeout(timeout));
      this.autoSyncTimeouts.clear();
    }
  }

  /**
   * Get current sync status
   */
  getStatus(): SyncStatusMap {
    return { ...this.currentStatus };
  }

  /**
   * Get current sync progress
   */
  getProgress(): SyncProgressMap {
    return {
      music: { ...this.currentProgress.music },
      photos: { ...this.currentProgress.photos },
      documents: { ...this.currentProgress.documents },
      videos: { ...this.currentProgress.videos },
    };
  }

  /**
   * Completely destroy all data and reset the system
   */
  async destroyAll(): Promise<void> {
    debugInfo("💥 Starting complete system teardown...");

    try {
      // Disable auto-sync first
      debugInfo("⏸️ Disabling auto-sync...");
      this.enableAutoSync(false);

      // Clear all active syncs
      debugInfo("🛑 Clearing active syncs...");
      this.activeSyncs.clear();

      // Reset status and progress
      debugInfo("🔄 Resetting sync status...");
      this.currentStatus = {
        music: SyncStatus.Never,
        photos: SyncStatus.Never,
        documents: SyncStatus.Never,
        videos: SyncStatus.Never,
      };

      this.currentProgress = {
        music: this.createEmptyProgress(),
        photos: this.createEmptyProgress(),
        documents: this.createEmptyProgress(),
        videos: this.createEmptyProgress(),
      };

      // Destroy all storage data
      debugInfo("🗑️ Destroying storage database...");
      await this.storage.destroyAll();
      debugInfo("✅ Storage database destroyed");

      debugInfo("🗑️ Complete system teardown successful");

      // Emit teardown event
      this.emitEvent({
        type: SyncEventType.AllCompleted,
        timestamp: new Date(),
        result: {
          domain: "music",
          status: SyncStatus.Complete,
          itemsSynced: 0,
          totalItems: 0,
          duration: 0,
          errors: [],
        },
      });
    } catch (error) {
      debugError("❌ Failed to destroy system:", error);
      throw new Error(`System teardown failed: ${error}`);
    }
  }

  /**
   * Get media blobs for image grid
   */
  async getMediaBlobs(): Promise<any[]> {
    try {
      const allBlobs: any[] = [];

      // Get media blobs from documents domain (music thumbnails, etc.)
      try {
        const mediaBlobs = await this.storage.getItems("documents");
        const imageBlobs = mediaBlobs.filter(
          (blob: any) => blob.mime && blob.mime.startsWith("image/")
        );
        allBlobs.push(...imageBlobs);
      } catch (error) {
        console.warn("Failed to get media blobs from documents:", error);
      }

      // Get photo thumbnails from photos domain
      try {
        const photos = await this.storage.getItems("photos");
        for (const photo of photos) {
          // Add thumbnail blob (prioritize thumbnails for grid display)
          if (photo.thumbnail_blob_id) {
            allBlobs.push({
              id: photo.thumbnail_blob_id,
              mime: "image/jpeg", // Assume thumbnails are JPEG
              created_at: photo.created_at,
              type: "thumbnail",
              photo_id: photo.id,
              title: photo.title,
            });
          }
          // Also add main photo blob if no thumbnail
          else if (photo.media_blob_id) {
            allBlobs.push({
              id: photo.media_blob_id,
              mime: "image/jpeg", // Assume photos are images
              created_at: photo.created_at,
              type: "photo",
              photo_id: photo.id,
              title: photo.title,
            });
          }
        }
      } catch (error) {
        console.warn("Failed to get photos for image grid:", error);
      }

      // Sort by created_at date (most recent first)
      const sortedBlobs = allBlobs.sort((a: any, b: any) => {
        const dateA = new Date(a.created_at || 0);
        const dateB = new Date(b.created_at || 0);
        return dateB.getTime() - dateA.getTime();
      });

      debugInfo(
        `📸 Image grid: Found ${sortedBlobs.length} total images (${sortedBlobs.filter((b) => b.type === "thumbnail").length} thumbnails, ${sortedBlobs.filter((b) => b.type === "photo").length} photos) - sorted by most recent first`
      );

      return sortedBlobs;
    } catch (error) {
      console.error("Failed to get media blobs:", error);
      return [];
    }
  }

  /**
   * Check if binary data exists for a blob ID
   */
  async hasBinaryData(blobId: string): Promise<boolean> {
    try {
      const data = await this.storage.getBinaryData(blobId);
      return !!data;
    } catch (error) {
      debugError(`Failed to check binary data for ${blobId}:`, error);
      return false;
    }
  }

  async getVideosBreakdown(): Promise<{
    videos: number;
    videoPlaylists: number;
    videoPlaylistItems: number;
  }> {
    try {
      return await this.storage.getVideosBreakdown();
    } catch (error) {
      debugError("Failed to get videos breakdown:", error);
      return { videos: 0, videoPlaylists: 0, videoPlaylistItems: 0 };
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<StorageStats> {
    try {
      return await this.storage.getStats();
    } catch (error) {
      debugError("Failed to get storage stats:", error);
      return {
        itemCounts: { music: 0, photos: 0, documents: 0, videos: 0 },
        totalSize: 0,
        binarySize: 0,
        lastSyncTimes: {
          music: null,
          photos: null,
          documents: null,
          videos: null,
        },
      };
    }
  }

  async getMusicBreakdown(): Promise<{
    songs: number;
    playlists: number;
    playlistSongs: number;
  }> {
    try {
      return await this.storage.getMusicBreakdown();
    } catch (error) {
      debugError("Failed to get music breakdown:", error);
      return { songs: 0, playlists: 0, playlistSongs: 0 };
    }
  }

  async getPhotosBreakdown(): Promise<{
    photos: number;
    galleries: number;
    photoGalleries: number;
  }> {
    try {
      return await this.storage.getPhotosBreakdown();
    } catch (error) {
      debugError("Failed to get photos breakdown:", error);
      return { photos: 0, galleries: 0, photoGalleries: 0 };
    }
  }

  /**
   * Create minimal domain configs to avoid import issues
   */
  private createMinimalDomainConfigs(): Record<SyncDomain, DomainConfig> {
    const baseConfig = {
      defaultOptions: {
        pageSize: 50,
        includeBinaryData: true,
        forceFullSync: false,
      },
      transforms: {
        fromApi: (data: any) => data,
        toStorage: (data: any) => data,
        fromStorage: (data: any) => data,
      },
    };

    return {
      music: {
        ...baseConfig,
        domain: "music" as SyncDomain,
        endpoints: {
          list: "/api/songs",
          item: "/api/songs/{id}",
          sync: "/api/sync/songs",
        },
      },
      photos: {
        ...baseConfig,
        domain: "photos" as SyncDomain,
        endpoints: {
          list: "/api/photos",
          item: "/api/photos/{id}",
          sync: "/api/sync/photos",
        },
      },
      documents: {
        ...baseConfig,
        domain: "documents" as SyncDomain,
        endpoints: {
          list: "/api/media_blobs",
          item: "/api/media_blobs/{id}",
          sync: "/api/sync/media_blobs",
        },
      },
      videos: {
        ...baseConfig,
        domain: "videos" as SyncDomain,
        endpoints: {
          list: "/api/videos",
          item: "/api/videos/{id}",
          sync: "/api/sync/videos",
        },
      },
    };
  }

  /**
   * Initialize WebSocket listeners for real-time updates
   */
  on(event: SyncEventType, listener: SyncEventListener): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  /**
   * Unsubscribe from sync events
   */
  off(event: SyncEventType, listener: SyncEventListener): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  /**
   * Get service worker sync manager (if available)
   */
  async getServiceWorkerSyncManager(): Promise<ServiceWorkerSyncManager | null> {
    return this.serviceWorkerSyncManager;
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    console.log("🧹 Destroying UnifiedSyncManager...");

    // Clear auto-sync timeouts
    this.enableAutoSync(false);

    // Cleanup service worker sync manager
    if (this.serviceWorkerSyncManager) {
      await this.serviceWorkerSyncManager.destroy();
      this.serviceWorkerSyncManager = null;
    }

    // Clear event listeners
    this.eventListeners.clear();

    // Clear active syncs
    this.activeSyncs.clear();

    console.log("✅ UnifiedSyncManager destroyed");
  }

  // Private helper methods

  private async syncStructuredData(
    domain: SyncDomain,
    options: SyncDomainOptions = {}
  ) {
    const domainConfig = this.domainConfigs[domain];

    // For music domain, sync songs, playlists, and playlist_songs together
    if (domain === "music") {
      return this.syncMusicDomain(options);
    }

    // For photos domain, sync photos, galleries, and photo_galleries together
    if (domain === "photos") {
      return this.syncPhotosDomain(options);
    }

    if (domain === "videos") {
      return this.syncVideosDomain(options);
    }

    const pageSize =
      options.pageSize || domainConfig.defaultOptions.pageSize || 50;

    // Get cursor for incremental sync
    let cursor: string | null = null;
    if (!options.forceFullSync) {
      // TODO: Get last sync cursor from storage
      cursor = null; // For now, always do full sync
    }

    let page = 0;
    let totalItemsSynced = 0;
    let totalItems = 0;
    let hasMore = true;

    while (
      hasMore &&
      (!options.maxItems || totalItemsSynced < options.maxItems)
    ) {
      page++;
      console.log(`📄 Syncing ${domain} page ${page}...`);

      // Build query parameters
      const queryParams: URLSearchParams = new URLSearchParams({
        page_size: pageSize.toString(),
        ...(cursor && { cursor }),
      });

      // Make API request using simple fetch
      const url = `${this.config.apiBaseUrl}${domainConfig.endpoints.sync}?${queryParams}`;
      const response: Response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.authToken && {
            Authorization: `Bearer ${this.config.authToken}`,
          }),
        },
      });

      if (!response.ok) {
        throw new Error(
          `API request failed: ${response.status} ${response.statusText}`
        );
      }

      const data: any = await response.json();
      const items = data.items || [];
      totalItems = data.total_count || items.length;

      if (items.length === 0) {
        hasMore = false;
        break;
      }

      // Transform and store items
      const transformedItems = items.map((item: any) =>
        domainConfig.transforms.toStorage(domainConfig.transforms.fromApi(item))
      );

      await this.storage.storeItems(domain, transformedItems);
      totalItemsSynced += items.length;

      // Update progress
      this.updateProgress(domain, {
        status: SyncStatus.InProgress,
        progress: Math.min(100, (totalItemsSynced / totalItems) * 100),
        itemsProcessed: totalItemsSynced,
        totalItems,
        currentBatch: page,
        totalBatches: Math.ceil(totalItems / pageSize),
        currentOperation: `Syncing ${domain} data`,
      });

      // Emit progress event
      this.emitEvent({
        type: SyncEventType.Progress,
        timestamp: new Date(),
        domain,
        progress: this.currentProgress[domain],
      } as SyncProgressEvent);

      // Update cursor for next page
      cursor = data.next_cursor;
      hasMore = !!cursor && items.length === pageSize;

      // Respect maxItems limit
      if (options.maxItems && totalItemsSynced >= options.maxItems) {
        break;
      }
    }

    return { itemsSynced: totalItemsSynced, totalItems };
  }

  /**
   * Unified music domain sync - handles songs, playlists, and playlist_songs together
   */
  private async syncMusicDomain(options: SyncDomainOptions) {
    debugInfo("🎵 Starting unified music domain sync...");

    let totalItemsSynced = 0;
    let totalItems = 0;

    // 1. Sync songs first
    debugInfo("🎵 Syncing songs...");
    const songsResult = await this.syncMusicDataType("songs", options);
    totalItemsSynced += songsResult.itemsSynced;
    totalItems += songsResult.totalItems;

    // 2. Sync playlists
    console.log("📋 Syncing playlists...");
    let playlistsResult = { itemsSynced: 0, totalItems: 0 };
    try {
      playlistsResult = await this.syncMusicDataType("playlists", options);
      console.log("✅ Playlists sync result:", playlistsResult);
      totalItemsSynced += playlistsResult.itemsSynced;
      totalItems += playlistsResult.totalItems;
    } catch (error) {
      console.error("❌ Playlists sync failed:", error);
      // Continue with other syncs even if playlists fail
    }

    // 3. Sync playlist_songs relationships
    console.log("🔗 Syncing playlist songs...");
    let playlistSongsResult = { itemsSynced: 0, totalItems: 0 };
    try {
      playlistSongsResult = await this.syncMusicDataType(
        "playlist-songs",
        options
      );
      console.log("✅ Playlist songs sync result:", playlistSongsResult);
      totalItemsSynced += playlistSongsResult.itemsSynced;
      totalItems += playlistSongsResult.totalItems;
    } catch (error) {
      console.error("❌ Playlist songs sync failed:", error);
      // Continue with other syncs even if playlist_songs fail
    }

    // 4. Sync media_blobs (the metadata, not binary data) - if enabled
    let mediaBlobsResult = { itemsSynced: 0, totalItems: 0 };
    if (options.include_media_blobs !== false) {
      console.log("📦 Syncing media blobs...");
      mediaBlobsResult = await this.syncMediaBlobs(options);
      totalItemsSynced += mediaBlobsResult.itemsSynced;
      totalItems += mediaBlobsResult.totalItems;
    } else {
      console.log("⏭️ Skipping media blobs sync (disabled)");
    }

    console.log(
      `✅ Unified music sync complete: ${totalItemsSynced} total items`
    );

    // Return breakdown for better UI display - prioritize songs count
    return {
      itemsSynced: songsResult.itemsSynced, // Show songs count as primary
      totalItems: songsResult.totalItems,
      breakdown: {
        songs: songsResult,
        playlists: playlistsResult,
        playlistSongs: playlistSongsResult,
        mediaBlobs: mediaBlobsResult,
      },
    };
  }

  /**
   * Unified photos domain sync - handles photos, galleries, and photo_galleries together
   */
  private async syncPhotosDomain(options: SyncDomainOptions) {
    debugInfo("🖼️ Starting unified photos domain sync...");

    let totalItemsSynced = 0;
    let totalItems = 0;

    // 1. Sync photos first
    debugInfo("🖼️ Syncing photos...");
    const photosResult = await this.syncPhotosDataType("photos", options);
    totalItemsSynced += photosResult.itemsSynced;
    totalItems += photosResult.totalItems;

    // 2. Sync galleries
    console.log("📁 Syncing galleries...");
    let galleriesResult = { itemsSynced: 0, totalItems: 0 };
    try {
      galleriesResult = await this.syncPhotosDataType("galleries", options);
      console.log("✅ Galleries sync result:", galleriesResult);
      totalItemsSynced += galleriesResult.itemsSynced;
      totalItems += galleriesResult.totalItems;
    } catch (error) {
      console.error("❌ Galleries sync failed:", error);
      // Continue with other syncs even if galleries fail
    }

    // 3. Sync photo_galleries relationships
    console.log("🔗 Syncing photo galleries...");
    let photoGalleriesResult = { itemsSynced: 0, totalItems: 0 };
    try {
      photoGalleriesResult = await this.syncPhotosDataType(
        "photo-galleries",
        options
      );
      console.log("✅ Photo galleries sync result:", photoGalleriesResult);
      totalItemsSynced += photoGalleriesResult.itemsSynced;
      totalItems += photoGalleriesResult.totalItems;
    } catch (error) {
      console.error("❌ Photo galleries sync failed:", error);
      // Continue with other syncs even if photo_galleries fail
    }

    console.log(
      `✅ Unified photos sync complete: ${totalItemsSynced} total items`
    );

    // Return breakdown for better UI display - prioritize photos count
    return {
      itemsSynced: photosResult.itemsSynced, // Show photos count as primary
      totalItems: photosResult.totalItems,
      breakdown: {
        photos: photosResult.itemsSynced,
        galleries: galleriesResult.itemsSynced,
        photoGalleries: photoGalleriesResult.itemsSynced,
      },
    };
  }

  /**
   * Unified videos domain sync - handles videos, video playlists, and video playlist items together
   */
  private async syncVideosDomain(options: SyncDomainOptions) {
    debugInfo("🎬 Starting unified videos domain sync...");

    // Sync videos first
    const videosResult = await this.syncVideosDataType("videos", options);

    // Sync video playlists
    const videoPlaylistsResult = await this.syncVideosDataType(
      "video-playlists",
      options
    );

    // Sync video playlist items
    const videoPlaylistItemsResult = await this.syncVideosDataType(
      "video-playlist-items",
      options
    );

    debugInfo(
      `🎬 Videos domain sync completed: ${videosResult.itemsSynced} videos, ${videoPlaylistsResult.itemsSynced} playlists, ${videoPlaylistItemsResult.itemsSynced} playlist items`
    );

    // Return breakdown for better UI display - prioritize videos count
    return {
      itemsSynced: videosResult.itemsSynced, // Show videos count as primary
      totalItems: videosResult.totalItems,
      breakdown: {
        videos: videosResult.itemsSynced,
        videoPlaylists: videoPlaylistsResult.itemsSynced,
        videoPlaylistItems: videoPlaylistItemsResult.itemsSynced,
      },
    };
  }

  /**
   * Sync specific videos data type (videos, video-playlists, video-playlist-items)
   */
  private async syncVideosDataType(
    dataType: string,
    options: SyncDomainOptions
  ): Promise<{ itemsSynced: number; totalItems: number }> {
    const endpoint = `/api/sync/${dataType}`;
    const pageSize = options.pageSize || 20;
    let totalItemsSynced = 0;
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      try {
        const queryParams = new URLSearchParams();
        queryParams.append("page_size", pageSize.toString());
        if (cursor) {
          queryParams.append("cursor", cursor);
        }
        if (options.forceFullSync !== true && options.lastSyncTime) {
          queryParams.append("last_sync_time", options.lastSyncTime);
        }

        const url = `${this.config.apiBaseUrl}${endpoint}?${queryParams}`;
        debugInfo(`🔄 Fetching ${dataType} from: ${url}`);

        const response = await fetch(url, {
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const items = data.items || [];

        if (items.length > 0) {
          await this.storage.storeItems("videos", items);
          totalItemsSynced += items.length;
          debugInfo(`✅ Stored ${items.length} ${dataType} items`);
        }

        hasMore = data.pagination?.has_more || false;
        cursor = data.pagination?.next_cursor || null;

        debugInfo(
          `📄 ${dataType} page complete: ${items.length} items, hasMore: ${hasMore}`
        );
      } catch (error) {
        debugError(`❌ Failed to sync ${dataType}:`, error);
        throw error;
      }
    }

    debugInfo(`🎬 ${dataType} sync complete: ${totalItemsSynced} items total`);
    return { itemsSynced: totalItemsSynced, totalItems: totalItemsSynced };
  }

  /**
   * Sync specific photos data type (photos, galleries, photo-galleries)
   */
  private async syncPhotosDataType(
    dataType: string,
    options: SyncDomainOptions
  ): Promise<{ itemsSynced: number; totalItems: number }> {
    const endpoint = `/api/sync/${dataType}`;
    const pageSize = options.pageSize || 50;
    let totalItemsSynced = 0;
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      try {
        const queryParams = new URLSearchParams();
        queryParams.append("page_size", pageSize.toString());
        if (cursor) {
          queryParams.append("cursor", cursor);
        }
        if (options.forceFullSync !== true && options.lastSyncTime) {
          queryParams.append("last_sync_time", options.lastSyncTime);
        }

        const url = `${this.config.apiBaseUrl}${endpoint}?${queryParams}`;
        debugInfo(`🔄 Fetching ${dataType} from: ${url}`);

        const response = await fetch(url, {
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const items = data.items || [];

        debugInfo(`📦 Received ${items.length} ${dataType} items`);

        if (items.length > 0) {
          await this.storage.storeItems("photos", items);
          totalItemsSynced += items.length;
        }

        // Check pagination
        hasMore = data.pagination?.has_more === true;
        cursor = data.pagination?.next_cursor || null;

        debugInfo(
          `📄 Pagination: hasMore=${hasMore}, cursor=${cursor}, synced=${totalItemsSynced}`
        );
      } catch (error) {
        debugError(`❌ Failed to sync ${dataType}:`, error);
        throw error;
      }
    }

    return { itemsSynced: totalItemsSynced, totalItems: totalItemsSynced };
  }

  /**
   * Sync specific music data type (songs, playlists, playlist-songs)
   */
  private async syncMusicDataType(
    dataType: string,
    options: SyncDomainOptions
  ): Promise<{ itemsSynced: number; totalItems: number }> {
    const pageSize = Math.min(options.pageSize || 50, 100); // Cap at 100 items
    const endpoint =
      dataType === "songs"
        ? `/api/sync/songs`
        : dataType === "playlists"
          ? `/api/sync/playlists`
          : `/api/sync/playlist-songs`;

    let cursor: string | null = null;
    let totalItemsSynced = 0;
    let hasMore = true;
    let page = 0;
    const maxPages = 20; // Safety limit to prevent infinite loops

    debugInfo(`🚀 Starting ${dataType} sync with pageSize: ${pageSize}`);

    while (
      hasMore &&
      page < maxPages &&
      (!options.maxItems || totalItemsSynced < options.maxItems)
    ) {
      page++;

      try {
        const queryParams = new URLSearchParams({
          page_size: pageSize.toString(),
        });

        if (cursor !== null) {
          queryParams.set("cursor", cursor);
        }

        const url = `${this.config.apiBaseUrl}${endpoint}?${queryParams}`;
        debugInfo(
          `🔄 Syncing ${dataType} page ${page}/${maxPages} from: ${url}`
        );

        const response = await fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            ...(this.config.authToken && {
              Authorization: `Bearer ${this.config.authToken}`,
            }),
          },
        });

        if (!response.ok) {
          throw new Error(
            `Failed to sync ${dataType}: ${response.status} ${response.statusText}`
          );
        }

        const data = await response.json();
        const items = data.items || [];
        const pagination = data.pagination || {};

        debugInfo(`📊 ${dataType} page ${page} response:`, {
          itemsCount: items.length,
          hasMore: pagination.has_more || false,
          nextCursor: pagination.next_cursor || null,
        });

        if (items.length === 0) {
          debugInfo(`📭 No more ${dataType} items, stopping sync`);
          break;
        }

        // Safety check for data size
        const itemSizeCheck = JSON.stringify(items).length;
        if (itemSizeCheck > 10 * 1024 * 1024) {
          // 10MB limit
          debugWarn(`⚠️ Large ${dataType} response: ${itemSizeCheck} bytes`);
        }

        // Transform and store items directly to correct table
        const domainConfig = this.domainConfigs["music"];
        const transformedItems = items
          .map((item: any) => {
            try {
              return domainConfig.transforms.toStorage(
                domainConfig.transforms.fromApi(item)
              );
            } catch (error) {
              debugError(
                `❌ Transform error for ${dataType} item:`,
                item,
                error
              );
              return null;
            }
          })
          .filter((item: any) => item !== null);

        debugInfo(
          `🔄 Storing ${transformedItems.length} ${dataType} items to storage`
        );

        // Store directly to the correct table
        await this.storeToMusicTable(dataType, transformedItems);
        totalItemsSynced += items.length;

        // Use server's pagination info
        hasMore = pagination.has_more || false;
        cursor = pagination.next_cursor || null;

        debugInfo(
          `✅ Synced ${dataType} page ${page}: ${items.length} items (total: ${totalItemsSynced})`
        );
      } catch (error) {
        debugError(`❌ Failed to sync ${dataType} page ${page}:`, error);
        break; // Exit the while loop on error
      }
    }

    debugInfo(`🎯 Completed ${dataType} sync: ${totalItemsSynced} total items`);
    return { itemsSynced: totalItemsSynced, totalItems: totalItemsSynced };
  }

  /**
   * Sync media blobs metadata (not binary data)
   */
  private async syncMediaBlobs(
    options: SyncDomainOptions
  ): Promise<{ itemsSynced: number; totalItems: number }> {
    const pageSize = options.pageSize || 50;
    const endpoint = `/api/sync/media`;

    let cursor: string | null = null;
    let totalItemsSynced = 0;
    let hasMore = true;
    let page = 0;

    while (
      hasMore &&
      (!options.maxItems || totalItemsSynced < options.maxItems)
    ) {
      page++;

      const queryParams = new URLSearchParams({
        page_size: pageSize.toString(),
        include_data: "false", // We only want metadata, not binary data
      });

      if (cursor !== null) {
        queryParams.set("cursor", cursor);
      }

      const url = `${this.config.apiBaseUrl}${endpoint}?${queryParams}`;
      console.log(`🔄 Syncing media_blobs page ${page} from: ${url}`);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.authToken && {
            Authorization: `Bearer ${this.config.authToken}`,
          }),
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to sync media_blobs: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      const items = data.items || [];
      const pagination = data.pagination || {};

      console.log(`📊 media_blobs page ${page} response:`, {
        itemsCount: items.length,
        hasMore: pagination.has_more || false,
        nextCursor: pagination.next_cursor || null,
      });

      if (items.length === 0) {
        break;
      }

      // Store media blobs to media_blobs table
      console.log(`🔄 Storing ${items.length} media_blobs items to storage`);

      await this.storage.storeItemsToTable("media_blobs", items);
      totalItemsSynced += items.length;

      // Use server's pagination info
      hasMore = pagination.has_more || false;
      cursor = pagination.next_cursor || null;

      console.log(
        `✅ Synced media_blobs page ${page}: ${items.length} items (total: ${totalItemsSynced})`
      );
    }

    console.log(
      `🎯 Completed media_blobs sync: ${totalItemsSynced} total items`
    );
    return { itemsSynced: totalItemsSynced, totalItems: totalItemsSynced };
  }

  /**
   * Store items directly to the correct music table
   */
  private async storeToMusicTable(
    dataType: string,
    items: any[]
  ): Promise<void> {
    const tableName =
      dataType === "songs"
        ? "songs"
        : dataType === "playlists"
          ? "playlists"
          : "playlist_songs";

    // Store directly using the storage's table-specific method
    if (tableName === "songs") {
      await this.storage.storeItemsToTable("songs", items);
    } else if (tableName === "playlists") {
      await this.storage.storeItemsToTable("playlists", items);
    } else {
      await this.storage.storeItemsToTable("playlist_songs", items);
    }
  }

  /**
   * Sync binary data for media blobs using WebSocket
   */
  private async syncBinaryData(
    domain: SyncDomain = "music"
  ): Promise<BinarySyncStats> {
    const startTime = Date.now();
    let itemsSynced = 0;
    let totalBytes = 0;
    let errors: string[] = [];

    try {
      // Get all media blobs that need binary data
      let mediaBlobs;
      if (domain === "photos") {
        // For photos, get both photos and their thumbnails
        const photos = await this.storage.getItems("photos");
        mediaBlobs = [];

        // Add main photo blobs
        for (const photo of photos) {
          if (photo.media_blob_id) {
            mediaBlobs.push({
              id: photo.media_blob_id,
              type: "photo",
              photo_id: photo.id,
            });
          }
          // Add thumbnail blobs
          if (photo.thumbnail_blob_id) {
            mediaBlobs.push({
              id: photo.thumbnail_blob_id,
              type: "thumbnail",
              photo_id: photo.id,
            });
          }
        }
      } else {
        // For music and other domains, use media_blobs table
        mediaBlobs = await this.storage.getItems("documents"); // media_blobs table is used for documents domain
      }

      debugInfo(
        `📦 Found ${mediaBlobs.length} media blobs to check for binary data`
      );

      // Count items that actually need binary data
      // Only sync blobs that have database-stored binary data (has_binary_data = true)
      const itemsToSync = [];
      for (const blob of mediaBlobs) {
        const existingData = await this.storage.getBinaryData(blob.id);
        if (!existingData) {
          // Check if this blob has database-stored binary data
          // Skip file-based blobs (those with has_binary_data = false)
          if (blob.has_binary_data === true) {
            itemsToSync.push(blob);
          } else {
            debugInfo(
              `⏭️ Skipping blob ${blob.id} - no database binary data (file-based)`
            );
          }
        }
      }

      const totalItemsToSync = itemsToSync.length;
      debugInfo(`📦 Need to sync ${totalItemsToSync} binary items`);

      // Process blobs in parallel batches for much faster sync
      const concurrency_limit = 5; // Process 5 blobs simultaneously
      let processed = 0;

      // Split items into batches
      const batches: any[][] = [];
      for (let i = 0; i < itemsToSync.length; i += concurrency_limit) {
        batches.push(itemsToSync.slice(i, i + concurrency_limit));
      }

      debugInfo(
        `📦 Processing ${batches.length} batches of ${concurrency_limit} items each`
      );

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        if (!batch) continue;

        debugInfo(
          `🔄 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} items)`
        );

        // Safety check: ensure we don't have too many hanging requests
        if (this.pendingBinaryRequests.size > 20) {
          debugWarn(
            `⚠️ High number of pending requests (${this.pendingBinaryRequests.size}) before batch ${batchIndex + 1}`
          );
        }

        const batchStartTime = Date.now();
        debugInfo(
          `🚀 Starting batch ${batchIndex + 1} with ${batch.length} items at ${new Date().toLocaleTimeString()}`
        );

        const batchResults = await Promise.allSettled(
          batch.map(async (blob, index) => {
            const globalIndex = processed + index + 1;
            const requestStartTime = Date.now();

            debugInfo(
              `🔄 [${globalIndex}/${totalItemsToSync}] Starting request for blob ${blob.id} at ${new Date().toLocaleTimeString()}`
            );

            // Emit binary progress event
            this.emitEvent({
              type: SyncEventType.BinaryProgress,
              timestamp: new Date(),
              domain: domain, // Use the actual domain being synced
              blobId: blob.id,
              progress:
                totalItemsToSync > 0
                  ? Math.round((globalIndex / totalItemsToSync) * 100)
                  : 0,
              currentItem: globalIndex,
              totalItems: totalItemsToSync,
            } as BinarySyncProgressEvent);

            try {
              // Request binary data via WebSocket
              const binaryData = await this.requestBinaryDataViaWebSocket(
                blob.id
              );

              const requestDuration = Date.now() - requestStartTime;

              if (binaryData) {
                // Store binary data (metadata comes from media_blobs table as per plan)
                await this.storage.storeBinaryData(blob.id, binaryData);

                debugInfo(
                  `✅ [${globalIndex}/${totalItemsToSync}] Completed ${blob.id} in ${requestDuration}ms (${binaryData.byteLength} bytes)`
                );

                return {
                  success: true,
                  blobId: blob.id,
                  bytes: binaryData.byteLength,
                };
              } else {
                debugWarn(
                  `⚠️ [${globalIndex}/${totalItemsToSync}] No data received for ${blob.id} after ${requestDuration}ms`
                );
                return {
                  success: false,
                  blobId: blob.id,
                  error: "No data received",
                };
              }
            } catch (error) {
              const requestDuration = Date.now() - requestStartTime;
              debugError(
                `❌ [${globalIndex}/${totalItemsToSync}] Error for ${blob.id} after ${requestDuration}ms:`,
                error
              );
              return {
                success: false,
                blobId: blob.id,
                error: error instanceof Error ? error.message : String(error),
              };
            }
          })
        );

        // Process batch results
        for (const result of batchResults) {
          if (result.status === "fulfilled") {
            const data = result.value;
            if (data.success) {
              itemsSynced++;
              totalBytes += data.bytes || 0;
            } else {
              const errorMsg = `Failed to sync binary data for ${data.blobId}: ${data.error}`;
              debugError(errorMsg);
              errors.push(errorMsg);
            }
          } else {
            const errorMsg = `Batch processing error: ${result.reason}`;
            debugError(errorMsg);
            errors.push(errorMsg);
          }
        }

        processed += batch.length;
        const batchDuration = Date.now() - batchStartTime;
        debugInfo(
          `✅ Completed batch ${batchIndex + 1}/${batches.length} in ${batchDuration}ms - ${itemsSynced} successful, ${errors.length} failed`
        );
        debugInfo(
          `📊 Pending requests after batch: ${this.pendingBinaryRequests.size}`
        );

        // Check for any stale pending requests for this batch
        const staleBlobIds = batch.filter((blob) =>
          this.pendingBinaryRequests.has(blob.id)
        );
        if (staleBlobIds.length > 0) {
          debugWarn(
            `🧹 Found ${staleBlobIds.length} stale pending requests: [${staleBlobIds.map((b) => b.id).join(", ")}]`
          );
          for (const blob of staleBlobIds) {
            debugWarn(`🧹 Cleaning up stale pending request for ${blob.id}`);
            this.removePendingBinaryRequest(blob.id);
          }
        }

        // Add delay between batches to help debug timing issues
        if (batchIndex < batches.length - 1) {
          debugInfo(`⏳ Brief pause before next batch...`);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      const duration = Date.now() - startTime;
      const skipped = mediaBlobs.length - itemsSynced - errors.length;
      debugInfo(
        `🎉 Binary sync complete: ${itemsSynced} cached, ${skipped} skipped, ${errors.length} failed, ${totalBytes} bytes in ${duration}ms`
      );

      return {
        cached: itemsSynced,
        skipped,
        failed: errors.length,
        bytesDownloaded: totalBytes,
      };
    } catch (error) {
      const errorMsg = `Binary sync failed: ${error}`;
      debugError(errorMsg);
      throw new Error(errorMsg);
    }
  }

  /**
   * Request binary data for a blob via WebSocket and wait for binary response
   * Uses the existing WebSocket connection with proper concurrent handling
   */
  private async requestBinaryDataViaWebSocket(
    blobId: string
  ): Promise<ArrayBuffer | null> {
    return new Promise((resolve, reject) => {
      // Quick connection health check - fail fast if disconnected
      if (this.wsClient.getStatus() !== ConnectionStatus.Connected) {
        reject(new Error(`WebSocket not connected for blob ${blobId}`));
        return;
      }

      // Prevent too many pending requests (system health check)
      if (this.pendingBinaryRequests.size > 100) {
        reject(
          new Error(
            `Too many pending requests (${this.pendingBinaryRequests.size}) - system may be stalled`
          )
        );
        return;
      }

      // Store this request in pending requests
      debugInfo(`📝 Setting up request for ${blobId}`);
      this.addPendingBinaryRequest(
        blobId,
        (data) => {
          // Convert number array to ArrayBuffer
          const arrayBuffer = new ArrayBuffer(data.data.length);
          const uint8Array = new Uint8Array(arrayBuffer);
          uint8Array.set(data.data);

          debugInfo(
            `✅ Received and converted binary data for ${blobId} (${arrayBuffer.byteLength} bytes)`
          );

          resolve(arrayBuffer);
        },
        (error) => {
          debugError(`❌ Error for ${blobId}:`, error);
          reject(new Error(`Server error: ${error.message}`));
        }
      );

      // Send the request using the existing connection
      const success = this.wsClient.getMediaBlobData(blobId);

      if (!success) {
        debugError(`❌ Failed to send getMediaBlobData request for ${blobId}`);
        this.removePendingBinaryRequest(blobId);
        reject(
          new Error(`Failed to send WebSocket request for blob ${blobId}`)
        );
        return;
      }

      debugInfo(
        `📤 Sent binary data request for ${blobId} via existing WebSocket connection (pending: ${this.pendingBinaryRequests.size})`
      );

      // Race condition check: verify the request is still pending after sending
      setTimeout(() => {
        if (this.pendingBinaryRequests.has(blobId)) {
          debugInfo(
            `⏱️ Request ${blobId} still pending after 100ms - this is normal`
          );
        } else {
          debugInfo(
            `⚡ Request ${blobId} completed within 100ms - very fast response!`
          );
        }
      }, 100);
    });
  }

  private pendingBinaryRequests = new Map<
    string,
    {
      resolve: (data: { id: string; data: number[]; mime?: string }) => void;
      reject: (error: { message: string; code?: string }) => void;
    }
  >();

  private binaryDataListenerSetup = false;

  private addPendingBinaryRequest(
    blobId: string,
    resolve: (data: { id: string; data: number[]; mime?: string }) => void,
    reject: (error: { message: string; code?: string }) => void
  ) {
    debugInfo(
      `📝 Adding pending request for ${blobId} (pending count: ${this.pendingBinaryRequests.size})`
    );
    this.pendingBinaryRequests.set(blobId, { resolve, reject });
    debugInfo(
      `📊 Pending requests after add: ${this.pendingBinaryRequests.size}`
    );

    // Setup global listeners only once
    if (!this.binaryDataListenerSetup) {
      this.binaryDataListenerSetup = true;

      debugInfo("🔧 Setting up binary data listeners (ONCE)");

      // Handle binary data (WebSocket client handles metadata matching)
      this.wsClient.on("mediaBlobData", (data) => {
        debugInfo(
          `📨 Received mediaBlobData for ${data.id} (${data.data?.length || 0} bytes)`
        );
        debugInfo(
          `📊 Current pending requests: [${Array.from(this.pendingBinaryRequests.keys()).join(", ")}]`
        );

        const request = this.pendingBinaryRequests.get(data.id);
        if (request) {
          debugInfo(
            `✅ Found pending request for ${data.id}, resolving and removing from pending`
          );
          this.pendingBinaryRequests.delete(data.id);
          debugInfo(
            `📊 Pending requests after removal: ${this.pendingBinaryRequests.size}`
          );
          request.resolve(data);
        } else {
          debugWarn(
            `⚠️ No pending request found for ${data.id}! Available requests: [${Array.from(this.pendingBinaryRequests.keys()).join(", ")}]`
          );
        }
      });

      this.wsClient.on("error", (error) => {
        debugError(
          "❌ WebSocket error, notifying all pending requests:",
          error
        );
        debugError(
          `📊 Clearing ${this.pendingBinaryRequests.size} pending requests due to WebSocket error`
        );
        // Notify all pending requests of the error
        this.pendingBinaryRequests.forEach((request, blobId) => {
          debugError(
            `❌ Rejecting pending request for ${blobId} due to WebSocket error`
          );
          request.reject(error);
        });
        this.pendingBinaryRequests.clear();
      });
    } else {
      debugInfo(
        `📝 Adding request for ${blobId} to existing listener setup (total pending: ${this.pendingBinaryRequests.size})`
      );
    }
  }

  private removePendingBinaryRequest(blobId: string) {
    const existed = this.pendingBinaryRequests.has(blobId);
    this.pendingBinaryRequests.delete(blobId);
    debugInfo(
      `🗑️ ${existed ? "Removed" : "Attempted to remove non-existent"} pending request for ${blobId} (remaining: ${this.pendingBinaryRequests.size})`
    );
  }

  private setupWebSocketListeners(): void {
    // WebSocket listeners are now handled by the auto-sync notification router
  }

  private setupPeriodicSync(): void {
    if (!this.config.autoSync.periodicInterval) return;

    const intervalMs = this.config.autoSync.periodicInterval * 60 * 1000;

    for (const domain of this.config.autoSync.domains) {
      const timeout = setInterval(async () => {
        console.log(`⏰ Periodic sync triggered for ${domain}`);

        this.emitEvent({
          type: SyncEventType.AutoSyncTriggered,
          timestamp: new Date(),
          domain,
          trigger: "periodic",
        } as AutoSyncTriggeredEvent);

        try {
          await this.syncDomain(domain, { includeBinaryData: true });
        } catch (error) {
          console.error(`Periodic sync failed for domain ${domain}:`, error);
        }
      }, intervalMs);

      this.autoSyncTimeouts.set(domain, timeout as any);
    }
  }

  private async loadSyncStates(): Promise<void> {
    // Load last sync states from storage
    debugInfo("📋 Loading sync states from storage...");
    const stats = await this.storage.getStats();

    for (const domain of Object.keys(this.currentStatus) as SyncDomain[]) {
      const lastSyncTime = stats.lastSyncTimes[domain];
      if (lastSyncTime) {
        debugInfo(
          `✅ Restored ${domain} sync state: ${lastSyncTime.toISOString()} (${stats.itemCounts[domain]} items)`
        );
        this.currentStatus[domain] = SyncStatus.Complete;
      } else {
        debugInfo(`📝 No previous sync found for ${domain}`);
      }
    }

    debugInfo("📋 Sync state loading complete");
  }

  private updateStatus(domain: SyncDomain, status: SyncStatus): void {
    this.currentStatus[domain] = status;
  }

  private updateProgress(domain: SyncDomain, progress: SyncProgress): void {
    this.currentProgress[domain] = progress;
  }

  private createEmptyProgress(): SyncProgress {
    return {
      status: SyncStatus.Never,
      progress: 0,
      itemsProcessed: 0,
      totalItems: 0,
      currentBatch: 0,
      totalBatches: 0,
    };
  }

  private emitEvent(event: AnySyncEvent): void {
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(event);
        } catch (error) {
          debugError(`Error in sync event listener:`, error);
        }
      });
    }
  }

  private aggregateBinaryStats(
    results: SyncResult[]
  ): BinarySyncStats | undefined {
    const statsArray = results
      .map((r) => r.binaryStats)
      .filter((stats): stats is BinarySyncStats => !!stats);

    if (statsArray.length === 0) return undefined;

    return {
      cached: statsArray.reduce((sum, stats) => sum + stats.cached, 0),
      skipped: statsArray.reduce((sum, stats) => sum + stats.skipped, 0),
      failed: statsArray.reduce((sum, stats) => sum + stats.failed, 0),
      bytesDownloaded: statsArray.reduce(
        (sum, stats) => sum + stats.bytesDownloaded,
        0
      ),
    };
  }
}

/**
 * Factory function to create a unified sync manager
 */
export function createUnifiedSyncManager(
  storage: UnifiedStorage,
  wsClient: WebSocketClient,
  apiClient: ApiClient,
  config: UnifiedSyncConfig
): UnifiedSyncManager {
  return new UnifiedSyncManagerImpl(storage, wsClient, apiClient, config);
}
