/**
 * Unified Sync Demo Web Component - Clean Version
 *
 * A simplified demo component showcasing the unified sync system with:
 * - WebSocket connection with status indicator
 * - Single "Sync All" button
 * - Clean progress tracking
 * - Auto-sync toggle
 * - Minimal activity logging
 * - No window object exposures or toast notifications
 */

/* @jsxImportSource solid-js */
import { customElement } from "solid-element";
import {
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  Show,
  For,
} from "solid-js";
import { ApiClient } from "../lib/api-client.js";
import { WebSocketClient } from "../lib/websocket-client.js";
import {
  setupUnifiedSyncQuick,
  SyncStatus,
  SyncEventType,
  type UnifiedSyncManager,
  type SyncStatusMap,
  type SyncProgressMap,
  type SyncProgressEvent,
  type SyncCompletedEvent,
} from "../sync/index.js";
import { enableDebug, disableDebug, configureDebug } from "../sync/debug.js";
import { WebSocketStatus as WebSocketStatusComponent } from "./websocket-status.js";
import { ConnectionStatus } from "../lib/websocket-client.js";
import { formatRelativeTime, formatFullDateTime } from "../lib/date-utils.js";

// Helper function to format domain progress display
const formatDomainProgress = (
  domain: string,
  progress: any,
  breakdown?: any
) => {
  if (domain === "music" && breakdown) {
    // For music, show songs and playlists breakdown from actual data
    const parts = [];

    if (breakdown.songs > 0) {
      parts.push(`${breakdown.songs} songs`);
    }

    if (breakdown.playlists > 0) {
      parts.push(`${breakdown.playlists} playlists`);
    }

    return parts.length > 0 ? parts.join(", ") : "0 items";
  } else if (domain === "photos" && breakdown) {
    // For photos, show photos and galleries breakdown from actual data
    const parts = [];

    if (breakdown.photos > 0) {
      parts.push(`${breakdown.photos} photos`);
    }

    if (breakdown.galleries > 0) {
      parts.push(`${breakdown.galleries} galleries`);
    }

    return parts.length > 0 ? parts.join(", ") : "0 items";
  } else if (domain === "music") {
    // Fallback for music without breakdown
    const songs = progress.itemsProcessed || 0;
    return songs > 0 ? `${songs} songs` : "0 items";
  } else if (domain === "photos") {
    // Fallback for photos without breakdown
    const photos = progress.itemsProcessed || 0;
    return photos > 0 ? `${photos} photos` : "0 items";
  } else {
    // For other domains, show standard format
    const processed = progress.itemsProcessed || 0;
    const total = progress.totalItems || 0;
    return `${processed}/${total} items`;
  }
};

export interface UnifiedSyncDemoProps {
  apiBaseUrl?: string;
  clientId?: string;
  enableAutoSync?: boolean;
  debug?: boolean;
  className?: string;
}

const UnifiedSyncDemoComponent = (props: UnifiedSyncDemoProps = {}) => {
  // Core system signals
  const [isInitialized, setIsInitialized] = createSignal(false);
  const [isConnected, setIsConnected] = createSignal(false);
  const [isSyncing, setIsSyncing] = createSignal(false);
  const [connectionStatus, setConnectionStatus] = createSignal(
    ConnectionStatus.Disconnected
  );
  const [connectionError, setConnectionError] = createSignal<string | null>(
    null
  );

  // Progress and overall state
  const [overallProgress, setOverallProgress] = createSignal({
    status: SyncStatus.Never,
    progress: 0,
    itemsProcessed: 0,
    totalItems: 0,
    currentBatch: 0,
    totalBatches: 0,
    eta: 0,
    currentOperation: "Ready",
  });

  // Image grid for binary data
  const [imageUrls, setImageUrls] = createSignal<string[]>([]);
  const [binaryDataCount, setBinaryDataCount] = createSignal<number>(0);

  // Storage usage signals
  const [totalStorage, setTotalStorage] = createSignal<string>("Loading...");
  const [musicStorage, setMusicStorage] = createSignal<string>("Loading...");
  const [binaryStorage, setBinaryStorage] = createSignal<string>("Loading...");

  // Sync state signals
  const [syncStatus, setSyncStatus] = createSignal<SyncStatusMap>({
    music: SyncStatus.Never,
    photos: SyncStatus.Never,
    videos: SyncStatus.Never,
    documents: SyncStatus.Never,
  });
  const [syncProgress, setSyncProgress] = createSignal<SyncProgressMap>({
    music: {
      status: SyncStatus.Never,
      progress: 0,
      itemsProcessed: 0,
      totalItems: 0,
      currentBatch: 0,
      totalBatches: 0,
      eta: 0,
    },
    photos: {
      status: SyncStatus.Never,
      progress: 0,
      itemsProcessed: 0,
      totalItems: 0,
      currentBatch: 0,
      totalBatches: 0,
      eta: 0,
    },
    videos: {
      status: SyncStatus.Never,
      progress: 0,
      itemsProcessed: 0,
      totalItems: 0,
      currentBatch: 0,
      totalBatches: 0,
      eta: 0,
    },
    documents: {
      status: SyncStatus.Never,
      progress: 0,
      itemsProcessed: 0,
      totalItems: 0,
      currentBatch: 0,
      totalBatches: 0,
      eta: 0,
    },
  });

  // UI state signals
  const [autoSyncEnabled, setAutoSyncEnabled] = createSignal(
    props?.enableAutoSync ?? true
  );
  const [debugEnabled, setDebugEnabled] = createSignal(props?.debug ?? false);
  const [lastSyncTime, setLastSyncTime] = createSignal<Date | null>(null);
  const [logs, setLogs] = createSignal<string[]>([]);
  const [musicBreakdown, setMusicBreakdown] = createSignal<{
    songs: number;
    playlists: number;
    playlistSongs: number;
  } | null>(null);
  const [photosBreakdown, setPhotosBreakdown] = createSignal<{
    photos: number;
    galleries: number;
    photoGalleries: number;
  } | null>(null);

  // System instances
  const [websocketClient, setWebsocketClient] =
    createSignal<WebSocketClient | null>(null);
  const [syncManager, setSyncManager] = createSignal<UnifiedSyncManager | null>(
    null
  );
  const [autoSyncSystem, setAutoSyncSystem] = createSignal<any>(null);

  // Debug logging
  const log = (message: string, data?: any) => {
    if (props?.debug) {
      console.log(`[UnifiedSyncDemo] ${message}`, data || "");
    }
  };

  // UI logging
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-19), `[${timestamp}] ${message}`]);
  };

  // Generate client ID
  const getClientId = () => {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (props?.clientId && uuidRegex.test(props.clientId)) {
      return props.clientId;
    }
    return crypto.randomUUID();
  };

  // Initialize the unified sync system
  const initializeSystem = async () => {
    try {
      log("initializing system");
      addLog("🚀 Initializing Unified Sync System...");

      const baseUrl = props?.apiBaseUrl || "http://localhost:8080";
      const clientId = getClientId();

      log("created client", { baseUrl, clientId: clientId.slice(0, 8) });
      addLog(`📋 Client ID: ${clientId.slice(0, 8)}...`);

      // Create API client and WebSocket
      const api = new ApiClient({ baseUrl });
      const ws = new WebSocketClient({
        url: baseUrl.replace("http", "ws") + "/ws",
        autoReconnect: true,
        debug: debugEnabled() || props?.debug || false,
      });

      setWebsocketClient(ws);

      // Set up WebSocket event listeners
      const handleStatusChange = (status: ConnectionStatus) => {
        log("handleStatusChange called", {
          status,
          previous: connectionStatus(),
        });
        setConnectionStatus(status);
        const connected = status === ConnectionStatus.Connected;
        setIsConnected(connected);
        log("websocket status change", { status, connected });
        addLog(`🔗 WebSocket: ${status}`);

        if (connected) {
          setConnectionError(null);
          addLog("✅ WebSocket connected successfully");
        } else if (status === ConnectionStatus.Error) {
          setConnectionError("WebSocket connection error");
        }
      };

      ws.on("statusChange", handleStatusChange);
      ws.on("error", (error) => {
        log("websocket error", error);
        addLog(`❌ WebSocket error: ${error.message}`);
        setConnectionError(error.message);
      });

      // Set up notification handling
      ws.on("notification", (data) => {
        log("received notification", {
          channel: data.channel,
          event_type: data.event_type,
        });
        addLog(`📬 Notification: ${data.channel}/${data.event_type}`);

        // Handle music library updates
        if (
          data.channel === "MediaBlobs" &&
          (data.event_type === "song.created" ||
            data.event_type === "song.updated" ||
            data.event_type === "song.deleted" ||
            data.event_type === "music.library.updated")
        ) {
          addLog(`🎵 Music event: ${data.event_type}`);

          // Update last sync time to show activity
          setLastSyncTime(new Date());
        }
      });

      // Set up unified sync system
      log("setting up unified sync system");
      const { syncManager: manager, autoSyncSystem: autoSystem } =
        await setupUnifiedSyncQuick(ws, api, {
          apiBaseUrl: baseUrl,
          clientId,
          enableUserNotifications: false,
          enableBackgroundSync: false,
        });

      if (!manager) {
        throw new Error("Failed to create sync manager");
      }

      if (!autoSystem) {
        throw new Error("Failed to create auto-sync system");
      }

      setSyncManager(manager);
      setAutoSyncSystem(autoSystem);

      // Set up sync event listeners
      setupSyncEventListeners(manager);

      // Auto-connect WebSocket
      log("auto-connecting websocket");
      ws.connect();

      // Wait for connection with timeout
      const connectTimeout = 10000; // 10 seconds
      const startTime = Date.now();
      while (ws.getStatus() !== ConnectionStatus.Connected) {
        if (Date.now() - startTime > connectTimeout) {
          throw new Error("WebSocket connection timeout");
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Manually trigger status update to ensure signals are set
      const finalStatus = ws.getStatus();
      log("final websocket status after connect", finalStatus);
      setConnectionStatus(finalStatus);
      setIsConnected(finalStatus === ConnectionStatus.Connected);

      addLog(`🔗 WebSocket connection established: ${finalStatus}`);

      // Initialize domain status from IDB
      try {
        const storageStats = await manager.getStorageStats();
        log("storage stats from IDB", storageStats);

        // Get the actual sync status from the manager first
        const managerStatus = manager.getStatus();
        const managerProgress = manager.getProgress();

        // For initial load, use manager status but supplement with IDB counts where available
        const initialStatus: SyncStatusMap = {
          music: managerStatus.music || SyncStatus.Never,
          photos: managerStatus.photos || SyncStatus.Never,
          documents: managerStatus.documents || SyncStatus.Never,
          videos: managerStatus.videos || SyncStatus.Never,
        };

        // Use storage stats for completed domains, manager progress for others
        const initialProgress: SyncProgressMap = {
          music: {
            status: initialStatus.music,
            progress:
              initialStatus.music === SyncStatus.Complete
                ? 100
                : managerProgress.music?.progress || 0,
            itemsProcessed:
              initialStatus.music === SyncStatus.Complete
                ? storageStats.itemCounts.music
                : managerProgress.music?.itemsProcessed || 0,
            totalItems:
              initialStatus.music === SyncStatus.Complete
                ? storageStats.itemCounts.music
                : managerProgress.music?.totalItems || 0,
            currentBatch: managerProgress.music?.currentBatch || 1,
            totalBatches: managerProgress.music?.totalBatches || 1,
            eta: 0,
          },
          photos: {
            status: initialStatus.photos,
            progress:
              initialStatus.photos === SyncStatus.Complete
                ? 100
                : managerProgress.photos?.progress || 0,
            itemsProcessed:
              initialStatus.photos === SyncStatus.Complete
                ? storageStats.itemCounts.photos
                : managerProgress.photos?.itemsProcessed || 0,
            totalItems:
              initialStatus.photos === SyncStatus.Complete
                ? storageStats.itemCounts.photos
                : managerProgress.photos?.totalItems || 0,
            currentBatch: managerProgress.photos?.currentBatch || 1,
            totalBatches: managerProgress.photos?.totalBatches || 1,
            eta: 0,
          },
          documents: {
            status: initialStatus.documents,
            progress:
              initialStatus.documents === SyncStatus.Complete
                ? 100
                : managerProgress.documents?.progress || 0,
            itemsProcessed:
              initialStatus.documents === SyncStatus.Complete
                ? storageStats.itemCounts.documents
                : managerProgress.documents?.itemsProcessed || 0,
            totalItems:
              initialStatus.documents === SyncStatus.Complete
                ? storageStats.itemCounts.documents
                : managerProgress.documents?.totalItems || 0,
            currentBatch: managerProgress.documents?.currentBatch || 1,
            totalBatches: managerProgress.documents?.totalBatches || 1,
            eta: 0,
          },
          videos: {
            status: initialStatus.videos,
            progress:
              initialStatus.videos === SyncStatus.Complete
                ? 100
                : managerProgress.videos?.progress || 0,
            itemsProcessed:
              initialStatus.videos === SyncStatus.Complete
                ? storageStats.itemCounts.videos
                : managerProgress.videos?.itemsProcessed || 0,
            totalItems:
              initialStatus.videos === SyncStatus.Complete
                ? storageStats.itemCounts.videos
                : managerProgress.videos?.totalItems || 0,
            currentBatch: managerProgress.videos?.currentBatch || 1,
            totalBatches: managerProgress.videos?.totalBatches || 1,
            eta: 0,
          },
        };

        setSyncStatus(initialStatus);
        setSyncProgress(initialProgress);

        // Initialize last sync time from storage stats
        const lastSyncTimes = Object.values(storageStats.lastSyncTimes).filter(
          Boolean
        );
        if (lastSyncTimes.length > 0) {
          // Find the most recent sync time across all domains
          const mostRecentSync = lastSyncTimes.reduce(
            (latest, current) => {
              return current && (!latest || current > latest)
                ? current
                : latest;
            },
            null as Date | null
          );

          if (mostRecentSync) {
            setLastSyncTime(mostRecentSync);
            log("initialized last sync time", mostRecentSync);
          }
        }

        // Load music breakdown if music domain has data
        if (initialStatus.music === SyncStatus.Complete) {
          manager.getMusicBreakdown().then((breakdown) => {
            setMusicBreakdown(breakdown);
            log("loaded music breakdown", breakdown);
          });
        }

        // Load photos breakdown if photos domain has data
        if (initialStatus.photos === SyncStatus.Complete) {
          manager.getPhotosBreakdown().then((breakdown) => {
            setPhotosBreakdown(breakdown);
            log("loaded photos breakdown", breakdown);
          });
        }

        log("initialized from IDB", {
          status: initialStatus,
          itemCounts: storageStats.itemCounts,
        });

        addLog(
          `📊 Loaded from IDB: ${Object.values(initialStatus).filter((s) => s === SyncStatus.Complete).length} domains with data`
        );

        // Calculate initial storage usage
        setTimeout(() => {
          calculateStorageUsage();
        }, 2000);

        // Load image grid if we have data
        setTimeout(() => {
          loadImageGrid();
        }, 1000);
      } catch (error) {
        log("failed to get initial status", error);
        // Use fallback status
        setSyncStatus({
          music: SyncStatus.Never,
          photos: SyncStatus.Never,
          videos: SyncStatus.Never,
          documents: SyncStatus.Never,
        });
      }

      setIsInitialized(true);
      log("system initialized successfully");
      addLog("✅ System initialized successfully");
    } catch (error: any) {
      log("initialization failed", error);
      addLog(`❌ Initialization failed: ${error.message}`);
      setConnectionError(error.message);
    }
  };

  // Set up sync event listeners
  const setupSyncEventListeners = (manager: UnifiedSyncManager) => {
    manager.on(SyncEventType.Started, (event) => {
      log("sync started", { domain: event.domain });
      addLog(`🔄 Sync started: ${event.domain || "all domains"}`);
      setIsSyncing(true);
      setOverallProgress({
        status: SyncStatus.InProgress,
        progress: 0,
        itemsProcessed: 0,
        totalItems: 0,
        currentBatch: 0,
        totalBatches: 0,
        eta: 0,
        currentOperation: "Starting sync...",
      });
    });

    manager.on(SyncEventType.Progress, (event) => {
      const progressEvent = event as SyncProgressEvent;

      // Force immediate UI update with fresh data from manager
      const freshStatus = manager.getStatus();
      const freshProgress = manager.getProgress();
      setSyncStatus(freshStatus);
      setSyncProgress(freshProgress);

      // Calculate overall progress from all domains
      const domainProgressValues = Object.values(freshProgress);
      const totalItems = domainProgressValues.reduce(
        (sum, p) => sum + p.totalItems,
        0
      );
      const completedItems = domainProgressValues.reduce(
        (sum, p) => sum + p.itemsProcessed,
        0
      );
      const totalBatches = domainProgressValues.reduce(
        (sum, p) => sum + p.totalBatches,
        0
      );
      const currentBatch = domainProgressValues.reduce(
        (sum, p) => sum + p.currentBatch,
        0
      );

      const overallPercentage =
        totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

      setOverallProgress({
        status: SyncStatus.InProgress,
        progress: overallPercentage,
        itemsProcessed: completedItems,
        totalItems: totalItems,
        currentBatch: currentBatch,
        totalBatches: totalBatches,
        eta: progressEvent.progress?.eta || 0,
        currentOperation:
          progressEvent.progress?.currentOperation ||
          `Syncing ${progressEvent.domain}`,
      });

      if (progressEvent.domain && progressEvent.progress) {
        addLog(
          `📊 ${progressEvent.domain}: ${progressEvent.progress.itemsProcessed}/${progressEvent.progress.totalItems} items (${progressEvent.progress.progress}%)`
        );
      }
    });

    manager.on(SyncEventType.DomainCompleted, (event) => {
      const completeEvent = event as SyncCompletedEvent;
      log("domain sync completed", {
        domain: completeEvent.domain,
        itemsSynced: completeEvent.result.itemsSynced,
      });
      addLog(
        `✅ Domain sync completed: ${completeEvent.domain} - ${completeEvent.result.itemsSynced} items`
      );

      if (completeEvent.domain) {
        setSyncStatus((prev) => ({
          ...prev,
          [completeEvent.domain!]: SyncStatus.Complete,
        }));
      }

      setLastSyncTime(new Date());

      // Update music breakdown after domain sync completion
      const manager = syncManager();
      if (manager && completeEvent.domain === "music") {
        manager.getMusicBreakdown().then((breakdown) => {
          setMusicBreakdown(breakdown);
          log("updated music breakdown after domain sync", breakdown);
        });
      }

      // Update photos breakdown after domain sync completion
      if (manager && completeEvent.domain === "photos") {
        manager.getPhotosBreakdown().then((breakdown) => {
          setPhotosBreakdown(breakdown);
          log("updated photos breakdown after domain sync", breakdown);
        });
      }

      // Refresh UI state for the completed domain
      setTimeout(() => {
        const currentManager = syncManager();
        if (currentManager) {
          setSyncStatus(currentManager.getStatus());
          setSyncProgress(currentManager.getProgress());
        }
      }, 100);

      // Update storage usage after domain sync completion
      setTimeout(() => {
        calculateStorageUsage();
      }, 1500);

      // Check for binary data if this was a music domain sync
      if (completeEvent.domain === "music") {
        setTimeout(() => {
          loadImageGrid();
        }, 2000);
      }
    });

    manager.on(SyncEventType.AllCompleted, (event) => {
      const completeEvent = event as SyncCompletedEvent;
      log("sync completed", {
        domain: completeEvent.domain,
        itemsSynced: completeEvent.result.itemsSynced,
      });
      addLog(
        `✅ Sync completed: ${completeEvent.domain || "all domains"} - ${completeEvent.result.itemsSynced} items`
      );

      if (completeEvent.domain) {
        setSyncStatus((prev) => ({
          ...prev,
          [completeEvent.domain!]: SyncStatus.Complete,
        }));
      }

      setIsSyncing(false);
      setLastSyncTime(new Date());

      // Update music breakdown after sync completion
      const manager = syncManager();
      if (manager) {
        manager.getMusicBreakdown().then((breakdown) => {
          setMusicBreakdown(breakdown);
          log("updated music breakdown after sync", breakdown);
        });

        if (manager) {
          manager.getPhotosBreakdown().then((breakdown) => {
            setPhotosBreakdown(breakdown);
            log("updated photos breakdown after sync", breakdown);
          });
        }
      }

      // Set final overall progress to show 100% completion
      setOverallProgress({
        status: SyncStatus.Complete,
        progress: 100,
        itemsProcessed: overallProgress().itemsProcessed,
        totalItems: overallProgress().totalItems,
        currentBatch: overallProgress().totalBatches,
        totalBatches: overallProgress().totalBatches,
        eta: 0,
        currentOperation: "Complete",
      });

      // Refresh UI state
      setTimeout(() => {
        const currentManager = syncManager();
        if (currentManager) {
          setSyncStatus(currentManager.getStatus());
          setSyncProgress(currentManager.getProgress());
        }
      }, 100);

      // Trigger image grid refresh when sync completes
      setBinaryDataCount((prev) => prev + 1);

      // Update storage usage after sync completion
      setTimeout(() => {
        calculateStorageUsage();
      }, 1500);

      // Check for binary data with longer delay if binary sync happened
      if (
        completeEvent.result &&
        completeEvent.result.binaryStats &&
        completeEvent.result.binaryStats.cached > 0
      ) {
        addLog(`🖼️ Binary sync completed, checking for images...`);
        setTimeout(() => {
          loadImageGrid();
        }, 2000); // Longer wait for WebSocket binary data to be stored
      }

      // Auto-hide progress after a few seconds
      setTimeout(() => {
        if (!isSyncing()) {
          setOverallProgress({
            status: SyncStatus.Never,
            progress: 0,
            itemsProcessed: 0,
            totalItems: 0,
            currentBatch: 0,
            totalBatches: 0,
            eta: 0,
            currentOperation: "Ready",
          });
        }
      }, 5000);
    });

    manager.on(SyncEventType.Failed, (event) => {
      const failedEvent = event as any;
      log("sync failed", failedEvent);
      addLog(
        `❌ Sync failed: ${failedEvent.error?.message || "Unknown error"}`
      );
      setIsSyncing(false);
    });

    // Binary sync progress tracking
    manager.on(SyncEventType.BinaryProgress, (event) => {
      const binaryEvent = event as any;
      const { currentItem: completed, totalItems: total, domain } = binaryEvent;

      if (domain && total > 0) {
        setSyncProgress((prev) => ({
          ...prev,
          [domain]: {
            ...prev[domain],
            itemsProcessed: completed,
            totalItems: total,
            currentOperation: `Downloading binary data (${completed}/${total})`,
          },
        }));

        // Update overall progress to show binary sync progress
        setOverallProgress({
          status: SyncStatus.InProgress,
          progress: binaryEvent.progress || 0,
          itemsProcessed: completed,
          totalItems: total,
          currentBatch: completed,
          totalBatches: total,
          eta: 0,
          currentOperation: `Downloading binary data (${completed}/${total})`,
        });
      }
    });
  };

  // Load image grid when binary data becomes available
  const loadImageGrid = async () => {
    const manager = syncManager();
    if (!manager || !isInitialized()) return;

    try {
      // Get first 100 image blobs for the grid
      const imageBlobs = (await manager.getMediaBlobs()).slice(0, 100);

      if (imageBlobs.length === 0) {
        setImageUrls([]);
        return;
      }

      addLog(
        `📷 Found ${imageBlobs.length} image blobs, checking binary data...`
      );

      const urls: string[] = [];
      let binaryDataCount = 0;

      for (const blob of imageBlobs) {
        // Check if we actually have binary data for this blob
        try {
          const hasBinary = await manager.hasBinaryData(blob.id);
          if (hasBinary) {
            binaryDataCount++;
            const url = await manager.getBlobUrl(blob.id);
            if (url) {
              urls.push(url);
            }
          }
        } catch (error) {
          // Skip this blob if there's an error
          continue;
        }
      }

      if (urls.length > 0) {
        setImageUrls(urls);
        addLog(
          `🎨 Image grid loaded: ${urls.length} images (${binaryDataCount} with binary data)`
        );
      } else if (binaryDataCount === 0 && imageBlobs.length > 0) {
        addLog(
          `📷 Found ${imageBlobs.length} image metadata but no binary data yet`
        );
      }
    } catch (error: any) {
      addLog(`❌ Failed to load image grid: ${error.message}`);
    }
  };

  // Storage usage calculation
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const calculateStorageUsage = async () => {
    try {
      const manager = syncManager();
      if (!manager) {
        log("no sync manager available for storage stats");
        return;
      }

      log("calculating storage usage");
      // Get storage stats from the unified sync manager
      const stats = await manager.getStorageStats();
      log("storage stats received", stats);

      // Fallback values if stats are empty/null
      const safeStats = {
        totalSize: stats?.totalSize || 0,
        itemCounts: stats?.itemCounts || {
          music: 0,
          photos: 0,
          documents: 0,
          videos: 0,
        },
        binarySize: stats?.binarySize || 0,
      };

      // Update reactive signals
      const totalText = formatBytes(safeStats.totalSize);
      const musicSize = safeStats.itemCounts.music;
      const musicText = musicSize > 0 ? `${musicSize} items` : "No data";
      const binaryText = formatBytes(safeStats.binarySize);

      setTotalStorage(totalText);
      setMusicStorage(musicText);
      setBinaryStorage(binaryText);

      log("updated storage stats", {
        total: totalText,
        music: musicText,
        binary: binaryText,
      });
    } catch (error) {
      console.error("Could not calculate storage usage:", error);

      // Set error state using signals
      setTotalStorage("Error");
      setMusicStorage("Error");
      setBinaryStorage("Error");
    }
  };

  // Reactive effect to track button state and ensure UI updates
  createEffect(() => {
    const connected = isConnected();
    const initialized = isInitialized();
    const syncing = isSyncing();
    const wsStatus = connectionStatus();

    log("button state reactive check", {
      connected,
      initialized,
      syncing,
      wsStatus,
      buttonEnabled: connected && !syncing,
    });

    // Force UI update if there's a mismatch
    const ws = websocketClient();
    if (ws) {
      const actualStatus = ws.getStatus();
      if (actualStatus !== wsStatus) {
        log("status mismatch detected, correcting", { actualStatus, wsStatus });
        setConnectionStatus(actualStatus);
        setIsConnected(actualStatus === ConnectionStatus.Connected);
      }
    }
  });

  // Reactive effect to trigger image grid loading
  createEffect(() => {
    const manager = syncManager();
    const initialized = isInitialized();
    const _ = binaryDataCount(); // Track binary data changes

    if (manager && initialized) {
      // Poll for binary data since WebSocket sync happens async
      loadImageGrid();

      // Also set up a polling mechanism to check again
      const pollInterval = setInterval(() => {
        loadImageGrid();
      }, 3000); // Check every 3 seconds

      // Clean up after 30 seconds
      setTimeout(() => {
        clearInterval(pollInterval);
      }, 30000);
    }
  });

  // Handle sync all
  const handleSyncAll = async () => {
    const manager = syncManager();
    if (!manager || isSyncing()) return;

    try {
      log("starting sync all");
      addLog("🔄 Starting sync for all domains...");

      const result = await manager.syncAll({
        domains: ["music", "photos"], // Start with core domains
        includeBinaryData: true, // Enable WebSocket binary sync
        forceFullSync: false,
      });

      addLog(
        `✨ Sync completed! Domain: ${result.domain}, Items: ${result.itemsSynced}/${result.totalItems}`
      );
    } catch (error: any) {
      log("sync all failed", error);
      addLog(`❌ Sync failed: ${error.message}`);
    }
  };

  // Handle auto-sync toggle
  const handleToggleAutoSync = async () => {
    const autoSystem = autoSyncSystem();
    if (!autoSystem) {
      addLog("❌ Auto-sync system not available");
      return;
    }

    try {
      const newEnabled = !autoSyncEnabled();
      setAutoSyncEnabled(newEnabled);

      if (newEnabled) {
        if (autoSystem.start) {
          await autoSystem.start();
        } else if (autoSystem.enable) {
          await autoSystem.enable();
        }
        log("auto-sync enabled");
        addLog("🔄 Auto-sync enabled");
      } else {
        if (autoSystem.stop) {
          await autoSystem.stop();
        } else if (autoSystem.disable) {
          await autoSystem.disable();
        }
        log("auto-sync disabled");
        addLog("⏸️ Auto-sync disabled");
      }
    } catch (error: any) {
      log("auto-sync toggle failed", error);
      addLog(`❌ Auto-sync toggle failed: ${error.message}`);
      // Revert the toggle on error
      setAutoSyncEnabled(!autoSyncEnabled());
    }
  };

  // Handle debug toggle
  const handleToggleDebug = () => {
    const newDebugState = !debugEnabled();
    setDebugEnabled(newDebugState);

    // Configure debug utilities directly
    if (newDebugState) {
      enableDebug();
      configureDebug({
        enabled: true,
        timestamps: true,
        levels: {
          info: true,
          warn: true,
          error: true,
          debug: true,
        },
      });
    } else {
      disableDebug();
    }

    // Update WebSocket debug state if client exists
    const ws = websocketClient();
    if (ws) {
      ws.setDebug(newDebugState);
    }

    // Update global debug state for compatibility
    if (typeof window !== "undefined") {
      (window as any).debugEnabled = newDebugState;
    }

    log(`Debug logging ${newDebugState ? "enabled" : "disabled"}`);
    addLog(`🔧 Debug logging ${newDebugState ? "enabled" : "disabled"}`);
  };

  // Auto-connect handles connection, no manual connect/disconnect needed

  // Calculate overall progress
  const getOverallProgress = () => {
    const progress = syncProgress();
    const totalItems = Object.values(progress).reduce(
      (sum, p) => sum + p.totalItems,
      0
    );
    const processedItems = Object.values(progress).reduce(
      (sum, p) => sum + p.itemsProcessed,
      0
    );
    const percentage =
      totalItems > 0 ? Math.round((processedItems / totalItems) * 100) : 0;

    return {
      percentage,
      processedItems,
      totalItems,
      text:
        totalItems > 0
          ? `${processedItems}/${totalItems} items (${percentage}%)`
          : "Ready",
    };
  };

  // Initialize on mount
  onMount(() => {
    log("component mounted");

    // Initialize debug state if debug prop is set
    if (debugEnabled()) {
      enableDebug();
      configureDebug({
        enabled: true,
        timestamps: true,
        levels: {
          info: true,
          warn: true,
          error: true,
          debug: true,
        },
      });

      if (typeof window !== "undefined") {
        (window as any).debugEnabled = true;
      }
    }

    initializeSystem();
  });

  // Cleanup on unmount
  onCleanup(() => {
    log("component unmounting");
    const ws = websocketClient();
    if (ws) {
      ws.disconnect();
    }
  });

  return (
    <div class={`unified-sync-demo ${props?.className || ""}`}>
      <div class="demo-header">
        <h2>🚀 Unified Sync System Demo</h2>
        <div class="status-badges">
          <span
            class={`status-badge ${isInitialized() ? "success" : "pending"}`}
          >
            {isInitialized() ? "✅ Ready" : "⏳ Initializing"}
          </span>
          <span class={`status-badge ${isConnected() ? "success" : "error"}`}>
            {isConnected() ? "🔗 Connected" : "🔗 Disconnected"} (
            {connectionStatus()})
          </span>
        </div>
      </div>

      {/* Connection Section */}
      <div class="connection-section">
        <h3>🔗 Connection</h3>
        <div class="connection-status">
          <Show when={websocketClient()}>
            <WebSocketStatusComponent
              status={connectionStatus()}
              showText={true}
              compact={true}
            />
            <span
              class={`connection-text ${isConnected() ? "connected" : "disconnected"}`}
            >
              {isConnected() ? "Connected" : "Disconnected"} (Status:{" "}
              {connectionStatus()})
            </span>
          </Show>
        </div>
        <Show when={connectionError()}>
          <div class="error-message">❌ {connectionError()}</div>
        </Show>
      </div>

      {/* Auto-Sync Control */}
      <div class="autosync-section">
        <h3>⚙️ Auto-Sync</h3>
        <label class="toggle-control">
          <input
            type="checkbox"
            checked={autoSyncEnabled()}
            onChange={handleToggleAutoSync}
            disabled={!isInitialized()}
          />
          <span>Enable real-time auto-sync</span>
        </label>

        <label class="toggle-control">
          <input
            type="checkbox"
            checked={debugEnabled()}
            onChange={handleToggleDebug}
          />
          <span>Enable debug logging</span>
        </label>
      </div>

      {/* Sync Controls */}
      <div class="sync-section">
        <h3>🎯 Sync Control</h3>
        <div class="sync-controls">
          <button
            class={`btn btn-sync ${isSyncing() ? "syncing" : ""}`}
            onClick={handleSyncAll}
            disabled={!isConnected() || isSyncing()}
            title={
              !isConnected()
                ? "WebSocket must be connected to sync"
                : isSyncing()
                  ? "Sync in progress..."
                  : "Sync all domains"
            }
          >
            {isSyncing() ? "🔄 Syncing..." : "🚀 Sync All"}
          </button>

          <Show when={lastSyncTime()}>
            <div class="last-sync" title={formatFullDateTime(lastSyncTime()!)}>
              Last sync: {formatRelativeTime(lastSyncTime()!)}
            </div>
          </Show>
        </div>
      </div>

      {/* Progress Section */}
      <Show when={isSyncing() || overallProgress().totalItems > 0}>
        <div class="progress-section">
          <h3>📊 Sync Progress</h3>

          {/* Horizontal progress bar - always visible when syncing */}
          <Show when={isSyncing()}>
            <div class="horizontal-progress-container">
              <div class="horizontal-progress-bar">
                <div
                  class="horizontal-progress-fill"
                  style={{
                    width: `${
                      overallProgress().totalItems > 0
                        ? overallProgress().progress
                        : Math.min(
                            85,
                            Math.max(10, overallProgress().itemsProcessed * 0.5)
                          )
                    }%`,
                    background:
                      overallProgress().totalItems > 0
                        ? "linear-gradient(90deg, magenta, #cc00cc)"
                        : "linear-gradient(90deg, #ff6600, #cc4400)",
                  }}
                />
              </div>
              <div class="horizontal-progress-text">
                <Show when={overallProgress().totalItems > 0}>
                  <span class="progress-percentage">
                    {overallProgress().progress}%
                  </span>
                </Show>
                <Show when={overallProgress().currentOperation}>
                  <div class="progress-operation">
                    {overallProgress().currentOperation}
                  </div>
                </Show>
                <Show when={overallProgress().totalItems === 0}>
                  <span class="progress-initializing">
                    {overallProgress().currentOperation ||
                      (overallProgress().itemsProcessed > 0
                        ? `Processing... (${overallProgress().itemsProcessed} items)`
                        : "Initializing sync...")}
                  </span>
                </Show>
                <Show when={overallProgress().totalItems > 0}>
                  <span class="progress-items">
                    {overallProgress().itemsProcessed}/
                    {overallProgress().totalItems} items
                  </span>
                </Show>
              </div>
            </div>
          </Show>
        </div>
      </Show>

      {/* Domain Status */}
      <div class="domains-section">
        <h3>📁 Domain Status</h3>
        <div class="domain-grid">
          <For each={Object.entries(syncStatus())}>
            {([domain, status]) => (
              <div class={`domain-card ${status.toLowerCase()}`}>
                <div class="domain-name">{domain}</div>
                <div class="domain-status">{status}</div>
                <div class="domain-progress">
                  {formatDomainProgress(
                    domain,
                    syncProgress()[domain as keyof SyncProgressMap],
                    domain === "music"
                      ? musicBreakdown()
                      : domain === "photos"
                        ? photosBreakdown()
                        : undefined
                  )}
                </div>
              </div>
            )}
          </For>
        </div>
      </div>

      {/* Image Grid */}
      <Show when={imageUrls().length > 0}>
        <div class="image-grid-section">
          <h3>
            🖼️ Binary Data Image Grid ({imageUrls().length} images) - Updated:{" "}
            {new Date().toLocaleTimeString()}
          </h3>
          <div class="image-grid">
            <For each={imageUrls()}>
              {(url, index) => (
                <div class="image-item">
                  <img
                    src={url}
                    alt={`Recent image ${index() + 1}`}
                    class="grid-image"
                    onError={(e) => {
                      log(`failed to load image ${index() + 1}`, url);
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Storage Statistics */}
      <div class="storage-stats">
        <h3>💾 Storage Usage</h3>
        <div class="storage-display">
          <div class="storage-item">
            <span class="storage-label">Total:</span>
            <span class="storage-value">{totalStorage()}</span>
          </div>
          <div class="storage-breakdown">
            <div class="storage-item">
              <span class="storage-label">Music:</span>
              <span class="storage-value">{musicStorage()}</span>
            </div>
            <div class="storage-item">
              <span class="storage-label">Binary Data:</span>
              <span class="storage-value">{binaryStorage()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Activity Log */}
      <div class="log-section">
        <h3>📋 Activity Log</h3>
        <div class="log-container">
          <For each={logs().slice().reverse()}>
            {(log) => <div class="log-entry">{log}</div>}
          </For>
          <Show when={logs().length === 0}>
            <div class="log-empty">No activity yet...</div>
          </Show>
        </div>
      </div>

      <style>{`
        .unified-sync-demo {
          font-family:
            -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
          background: black;
          color: white;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
        }

        .demo-header {
          text-align: center;
          margin-bottom: 30px;
          padding-bottom: 20px;
          border-bottom: 1px solid #333;
        }

        .demo-header h2 {
          margin: 0 0 10px 0;
          color: white;
        }

        .status-badges {
          display: flex;
          gap: 10px;
          justify-content: center;
          margin-top: 10px;
        }

        .status-badge {
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 500;
        }

        .status-badge.success {
          background: #0f5132;
          color: #d1e7dd;
        }

        .status-badge.pending {
          background: #664d03;
          color: #fff3cd;
        }

        .status-badge.error {
          background: #842029;
          color: #f8d7da;
        }

        .connection-section,
        .autosync-section,
        .sync-section,
        .progress-section,
        .domains-section,
        .log-section {
          margin-bottom: 25px;
          padding: 20px;
          background: #111;
          border-radius: 6px;
          border: 1px solid #333;
        }

        .connection-section h3,
        .autosync-section h3,
        .sync-section h3,
        .progress-section h3,
        .domains-section h3,
        .log-section h3 {
          margin: 0 0 15px 0;
          font-size: 16px;
          color: white;
        }

        .connection-status {
          display: flex;
          align-items: center;
          gap: 15px;
        }

        .connection-buttons {
          display: flex;
          gap: 10px;
        }

        .toggle-control {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          color: white;
        }

        .sync-controls {
          display: flex;
          align-items: center;
          gap: 20px;
        }

        .btn {
          padding: 10px 20px;
          border: none;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .btn-primary {
          background: #007bff;
          color: white;
        }

        .btn-primary:hover:not(:disabled) {
          background: #0056b3;
        }

        .btn-secondary {
          background: #6c757d;
          color: white;
        }

        .btn-secondary:hover:not(:disabled) {
          background: #545b62;
        }

        .btn-sync {
          background: magenta;
          color: black;
          position: relative;
          font-weight: 600;
        }

        .btn-sync:hover:not(:disabled) {
          background: #ff40ff;
        }

        .btn-sync.syncing {
          background: #cc00cc;
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0% {
            opacity: 1;
          }
          50% {
            opacity: 0.7;
          }
          100% {
            opacity: 1;
          }
        }

        .last-sync {
          font-size: 12px;
          color: #ccc;
        }

        .progress-bar {
          width: 100%;
          height: 8px;
          background: #333;
          border-radius: 4px;
          overflow: hidden;
          margin-bottom: 10px;
        }

        .progress-fill {
          height: 100%;
          background: magenta;
          transition: width 0.3s ease;
        }

        .progress-text {
          text-align: center;
          font-size: 14px;
          color: white;
        }

        .domain-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 15px;
        }

        .domain-card {
          padding: 15px;
          border-radius: 6px;
          border: 1px solid #333;
          background: #222;
        }

        .domain-card.complete {
          border-color: #0f0;
          background: #003300;
        }

        .domain-card.in_progress {
          border-color: magenta;
          background: #330033;
        }

        .domain-card.never {
          border-color: #666;
          background: #1a1a1a;
        }

        .domain-name {
          font-weight: 600;
          margin-bottom: 5px;
          text-transform: capitalize;
          color: white;
        }

        .domain-status {
          font-size: 12px;
          color: #ccc;
          margin-bottom: 5px;
        }

        .domain-progress {
          font-size: 11px;
          color: #aaa;
        }

        .log-container {
          max-height: 200px;
          overflow-y: auto;
          background: #000;
          border: 1px solid #333;
          border-radius: 4px;
          padding: 10px;
        }

        .log-entry {
          font-family: "Monaco", "Consolas", monospace;
          font-size: 12px;
          padding: 2px 0;
          border-bottom: 1px solid #333;
          color: #ccc;
        }

        .log-entry:last-child {
          border-bottom: none;
        }

        .log-empty {
          text-align: center;
          color: #666;
          font-style: italic;
          padding: 20px;
        }

        .error-message {
          margin-top: 10px;
          padding: 10px;
          background: #330000;
          border: 1px solid #660000;
          border-radius: 4px;
          color: #ff6666;
          font-size: 14px;
        }

        .horizontal-progress-container {
          margin-bottom: 20px;
          padding: 16px;
          background: #111;
          border: 1px solid #333;
          border-radius: 8px;
        }

        .horizontal-progress-bar {
          width: 100%;
          height: 12px;
          background: #333;
          border-radius: 6px;
          overflow: hidden;
          position: relative;
          margin-bottom: 8px;
        }

        .horizontal-progress-fill {
          height: 100%;
          border-radius: 6px;
          transition: width 0.5s ease;
          position: relative;
        }

        .horizontal-progress-fill::after {
          content: "";
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.3),
            transparent
          );
          animation: shimmer 2s infinite;
        }

        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }

        .horizontal-progress-text {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 14px;
          color: white;
        }

        .progress-percentage {
          font-weight: 600;
          color: magenta;
          font-size: 16px;
        }

        .progress-items {
          color: #ccc;
        }

        .progress-initializing {
          color: magenta;
          font-weight: 500;
        }

        .progress-operation {
          color: #ccc;
          font-size: 13px;
          font-style: italic;
        }

        .image-grid-section {
          margin-bottom: 25px;
          padding: 20px;
          background: #111;
          border-radius: 6px;
          border: 1px solid #333;
        }

        .image-grid-section h3 {
          margin: 0 0 15px 0;
          font-size: 16px;
          color: white;
        }

        .image-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
          gap: 10px;
          margin-top: 15px;
        }

        .image-item {
          display: flex;
          justify-content: center;
          align-items: center;
          background: black;
          color: white;
          border-radius: 4px;
          overflow: hidden;
        }

        .grid-image {
          width: 100px;
          height: 100px;
          object-fit: cover;
          border: 2px solid #333;
          border-radius: 6px;
          transition: all 0.3s ease;
          background: #222;
        }

        .grid-image:hover {
          transform: scale(1.05);
          box-shadow: 0 4px 15px rgba(255, 0, 255, 0.3);
        }

        .storage-stats {
          margin-bottom: 25px;
          padding: 20px;
          background: #111;
          border-radius: 6px;
          border: 1px solid #333;
        }

        .storage-stats h3 {
          margin: 0 0 15px 0;
          font-size: 16px;
          color: white;
        }

        .storage-display {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .storage-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          background: #222;
          border-radius: 6px;
          border: 1px solid #444;
        }

        .storage-label {
          font-weight: 500;
          color: white;
        }

        .storage-value {
          font-weight: 600;
          color: magenta;
          font-family: "Monaco", "Menlo", monospace;
          font-size: 13px;
        }

        .storage-breakdown {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin-top: 8px;
        }

        .storage-breakdown .storage-item {
          background: #1a1a1a;
          border-color: #333;
        }

        .connection-text {
          margin-left: 10px;
          font-weight: 500;
          font-size: 14px;
        }

        .connection-text.connected {
          color: #0f0;
        }

        .connection-text.disconnected {
          color: #f00;
        }
      `}</style>
    </div>
  );
};

export default customElement(
  "unified-sync-demo",
  {
    apiBaseUrl: "",
    clientId: "",
    enableAutoSync: true,
    debug: false,
    className: "",
  },
  UnifiedSyncDemoComponent
);
