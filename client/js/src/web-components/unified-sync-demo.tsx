/**
 * Unified Sync Demo Web Component - Phase 4
 *
 * A complete demo component showcasing the new unified sync system with:
 * - Auto WebSocket connection with status indicator
 * - Single "Sync All" button (no domain-specific buttons)
 * - Progress bars and stats from existing sync-demo
 * - Service worker toggle
 * - Auto-sync enable/disable
 * - Real-time sync notifications using existing Music/MediaBlobs channels
 *
 * Uses the clean sync/ system (not sync-legacy/)
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
  createConfiguredSyncManager,
  setupUnifiedSyncQuick,
  SYNC_FEATURES,
  SyncStatus,
  SyncEventType,
  type UnifiedSyncManager,
  type SyncProgress,
  type SyncStatusMap,
  type SyncProgressMap,
  type SyncProgressEvent,
  type SyncCompletedEvent,
  type SyncFailedEvent,
  type AutoSyncTriggeredEvent,
  type ConnectionChangedEvent,
  type BinarySyncProgressEvent,
} from "../sync/index.js";
import { enableDebug, disableDebug } from "../sync/debug.js";
import SyncStatusComponent from "./sync-status.js";
import SyncProgressComponent from "./sync-progress.js";
import { WebSocketStatus as WebSocketStatusComponent } from "./websocket-status.js";
import { ConnectionStatus } from "../lib/websocket-client.js";

export interface UnifiedSyncDemoProps {
  apiBaseUrl?: string;
  clientId?: string;
  autoConnect?: boolean;
  enableServiceWorker?: boolean;
  enableAutoSync?: boolean;
  className?: string;
  enableUserNotifications?: boolean;
}

function UnifiedSyncDemoComponent(props: UnifiedSyncDemoProps) {
  // Core managers
  const [syncManager, setSyncManager] = createSignal<UnifiedSyncManager | null>(
    null
  );
  const [phase3System, setPhase3System] = createSignal<any>(null);
  const [websocketClient, setWebsocketClient] =
    createSignal<WebSocketClient | null>(null);
  const [apiClient, setApiClient] = createSignal<ApiClient | null>(null);

  // Connection state
  const [isConnected, setIsConnected] = createSignal<boolean>(false);
  const [connectionStatus, setConnectionStatus] =
    createSignal<ConnectionStatus>(ConnectionStatus.Disconnected);
  const [isInitialized, setIsInitialized] = createSignal<boolean>(false);
  const [connectionError, setConnectionError] = createSignal<string | null>(
    null
  );

  // Sync state
  const [syncStatus, setSyncStatus] = createSignal<SyncStatusMap>({
    music: SyncStatus.Never,
    photos: SyncStatus.Never,
    documents: SyncStatus.Never,
    videos: SyncStatus.Never,
  });
  const [syncProgress, setSyncProgress] = createSignal<SyncProgressMap>({
    music: {
      status: SyncStatus.Never,
      progress: 0,
      itemsProcessed: 0,
      totalItems: 0,
      currentBatch: 0,
      totalBatches: 0,
    },
    photos: {
      status: SyncStatus.Never,
      progress: 0,
      itemsProcessed: 0,
      totalItems: 0,
      currentBatch: 0,
      totalBatches: 0,
    },
    documents: {
      status: SyncStatus.Never,
      progress: 0,
      itemsProcessed: 0,
      totalItems: 0,
      currentBatch: 0,
      totalBatches: 0,
    },
    videos: {
      status: SyncStatus.Never,
      progress: 0,
      itemsProcessed: 0,
      totalItems: 0,
      currentBatch: 0,
      totalBatches: 0,
    },
  });
  const [overallStatus, setOverallStatus] = createSignal(SyncStatus.Never);
  const [overallProgress, setOverallProgress] = createSignal<SyncProgress>({
    status: SyncStatus.Never,
    progress: 0,
    itemsProcessed: 0,
    totalItems: 0,
    currentBatch: 0,
    totalBatches: 0,
    eta: 0,
    currentOperation: "Ready",
  });

  // Feature toggles
  const [serviceWorkerEnabled, setServiceWorkerEnabled] = createSignal(
    props.enableServiceWorker ?? true
  );
  const [autoSyncEnabled, setAutoSyncEnabled] = createSignal(
    props.enableAutoSync ?? true
  );

  // UI state
  const [logs, setLogs] = createSignal<string[]>([]);
  const [isSyncing, setIsSyncing] = createSignal<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = createSignal<Date | null>(null);
  const [imageUrls, setImageUrls] = createSignal<string[]>([]);
  const [binaryDataCount, setBinaryDataCount] = createSignal<number>(0);
  const [debugEnabled, setDebugEnabled] = createSignal<boolean>(false);

  // Storage usage signals
  const [totalStorage, setTotalStorage] = createSignal<string>("Loading...");
  const [musicStorage, setMusicStorage] = createSignal<string>("Loading...");
  const [binaryStorage, setBinaryStorage] = createSignal<string>("Loading...");

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-9), `[${timestamp}] ${message}`]);
  };

  // Generate or validate UUID for clientId
  const generateUUID = () => {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback UUID v4 generator
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c == "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      }
    );
  };

  const getClientId = () => {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (props.clientId && uuidRegex.test(props.clientId)) {
      return props.clientId;
    }
    return generateUUID();
  };

  const initializeSystem = async () => {
    try {
      addLog("🚀 Initializing Unified Sync System...");

      const baseUrl = props.apiBaseUrl || "http://localhost:8080";
      const clientId = getClientId();

      addLog(`📋 Client ID: ${clientId}`);
      addLog(`🌐 API Base URL: ${baseUrl}`);

      // Create API client
      const api = new ApiClient({ baseUrl });
      setApiClient(api);

      // Create WebSocket client
      const wsUrl =
        baseUrl.replace("http", "ws").replace("3001", "8080") + "/ws";
      const ws = new WebSocketClient({
        url: wsUrl,
        autoReconnect: true,
        reconnectDelay: 3000,
        debug: true,
      });
      setWebsocketClient(ws);

      // Set up WebSocket connection handlers
      // Set up WebSocket event handlers
      const handleStatusChange = (status: ConnectionStatus) => {
        setConnectionStatus(status);
        const connected = status === ConnectionStatus.Connected;
        setIsConnected(connected);
        addLog(`🔗 WebSocket status: ${status}`);
        console.log("🐛 WebSocket status change:", {
          status,
          isConnected: connected,
          isInitialized: isInitialized(),
        });

        if (connected) {
          setConnectionError(null);
          console.log("🔌 WebSocket connected - forcing UI update");
        } else if (status === ConnectionStatus.Error) {
          setConnectionError("WebSocket connection error");
        }
      };

      // Set up event listeners BEFORE connecting
      ws.on("statusChange", handleStatusChange);

      ws.on("error", (error) => {
        setConnectionError(error.message);
        addLog(`❌ WebSocket error: ${error.message}`);
      });

      // Auto-connect if enabled
      if (props.autoConnect !== false) {
        addLog("🔄 Auto-connecting WebSocket...");
        ws.connect();
      }

      // Set up unified sync system with auto-sync
      addLog("⚙️ Setting up unified sync manager...");
      const { syncManager: manager, autoSyncSystem } =
        await setupUnifiedSyncQuick(ws, api, {
          apiBaseUrl: baseUrl,
          clientId,
          enableUserNotifications: props.enableUserNotifications ?? true,
          enableBackgroundSync: serviceWorkerEnabled(),
        });

      setSyncManager(manager);
      setPhase3System(autoSyncSystem);

      // Set up sync event listeners
      setupSyncEventListeners(manager);

      // Enable auto-sync if requested
      if (autoSyncEnabled()) {
        addLog("🔄 Enabling auto-sync...");
        manager.enableAutoSync(true);
      }

      // Initialize domain status from existing storage data
      try {
        const storageStats = await manager.getStorageStats();
        console.log("🐛 Initial storage stats:", storageStats);

        // Set initial status based on existing data
        const initialStatus: SyncStatusMap = {
          music:
            (storageStats.itemCounts?.music || 0) > 0
              ? SyncStatus.Complete
              : SyncStatus.Never,
          photos:
            (storageStats.itemCounts?.photos || 0) > 0
              ? SyncStatus.Complete
              : SyncStatus.Never,
          documents:
            (storageStats.itemCounts?.documents || 0) > 0
              ? SyncStatus.Complete
              : SyncStatus.Never,
          videos:
            (storageStats.itemCounts?.videos || 0) > 0
              ? SyncStatus.Complete
              : SyncStatus.Never,
        };

        const initialProgress: SyncProgressMap = {
          music: {
            status: initialStatus.music,
            progress: initialStatus.music === SyncStatus.Complete ? 100 : 0,
            itemsProcessed: storageStats.itemCounts?.music || 0,
            totalItems: storageStats.itemCounts?.music || 0,
            currentBatch: 1,
            totalBatches: 1,
          },
          photos: {
            status: initialStatus.photos,
            progress: initialStatus.photos === SyncStatus.Complete ? 100 : 0,
            itemsProcessed: storageStats.itemCounts?.photos || 0,
            totalItems: storageStats.itemCounts?.photos || 0,
            currentBatch: 1,
            totalBatches: 1,
          },
          documents: {
            status: initialStatus.documents,
            progress: initialStatus.documents === SyncStatus.Complete ? 100 : 0,
            itemsProcessed: storageStats.itemCounts?.documents || 0,
            totalItems: storageStats.itemCounts?.documents || 0,
            currentBatch: 1,
            totalBatches: 1,
          },
          videos: {
            status: initialStatus.videos,
            progress: initialStatus.videos === SyncStatus.Complete ? 100 : 0,
            itemsProcessed: storageStats.itemCounts?.videos || 0,
            totalItems: storageStats.itemCounts?.videos || 0,
            currentBatch: 1,
            totalBatches: 1,
          },
        };

        setSyncStatus(initialStatus);
        setSyncProgress(initialProgress);
        addLog(
          `📊 Initialized domain status: ${Object.values(initialStatus).filter((s) => s === SyncStatus.Complete).length} domains with data`
        );
      } catch (error) {
        console.warn("Could not initialize domain status:", error);
        // Fallback to manager's current status
        setSyncStatus(manager.getStatus());
        setSyncProgress(manager.getProgress());
        addLog("📊 Using default domain status");
      }

      // Calculate initial storage usage
      setTimeout(() => {
        calculateStorageUsage();
      }, 2000);

      setIsInitialized(true);
      addLog("✅ Unified Sync System initialized successfully");

      // Final connection state sync
      const currentWsStatus = ws.getStatus();
      if (currentWsStatus === ConnectionStatus.Connected && !isConnected()) {
        setIsConnected(true);
        setConnectionError(null);
      }

      // Ensure connectionStatus signal matches actual WebSocket status
      setConnectionStatus(currentWsStatus);

      console.log("🐛 State after initialization:", {
        isInitialized: true,
        isConnected: isConnected(),
        isSyncing: isSyncing(),
      });

      // Add reactive effect to ensure button state updates when connection changes
      createEffect(() => {
        const connected = isConnected();
        const initialized = isInitialized();
        const syncing = isSyncing();
        console.log("🔄 Button state check:", {
          connected,
          initialized,
          syncing,
          buttonEnabled: connected && initialized && !syncing,
        });
      });

      addLog("✅ Unified Sync System initialized successfully");
    } catch (error) {
      addLog(`❌ Initialization failed: ${error.message}`);
      setConnectionError(error.message);
    }
  };

  const setupSyncEventListeners = (manager: UnifiedSyncManager) => {
    manager.on(SyncEventType.Started, (event) => {
      addLog(`🔄 Sync started: ${event.domain || "all domains"}`);
      setIsSyncing(true);
      setOverallStatus(SyncStatus.InProgress);
    });

    manager.on(SyncEventType.Progress, (event) => {
      const progressEvent = event as SyncProgressEvent;

      // Force immediate UI update with fresh data from manager
      const freshStatus = manager.getStatus();
      const freshProgress = manager.getProgress();
      setSyncStatus(freshStatus);
      setSyncProgress(freshProgress);

      // Log meaningful progress updates only
      if (freshProgress[progressEvent.domain].totalItems > 0) {
        console.log(
          `📊 ${progressEvent.domain}: ${freshProgress[progressEvent.domain].itemsProcessed}/${freshProgress[progressEvent.domain].totalItems} (${freshProgress[progressEvent.domain].progress}%)`
        );
      }

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
        eta: progressEvent.progress.eta,
        currentOperation:
          progressEvent.progress.currentOperation ||
          `Syncing ${progressEvent.domain}`,
      });

      if (progressEvent.domain) {
        addLog(
          `📊 ${progressEvent.domain}: ${progressEvent.progress.itemsProcessed}/${progressEvent.progress.totalItems} items (${progressEvent.progress.progress}%)`
        );
      }
    });

    manager.on(SyncEventType.AllCompleted, (event) => {
      const completedEvent = event as SyncCompletedEvent;
      addLog(`✅ Sync completed: ${completedEvent.domain || "all domains"}`);
      setIsSyncing(false);
      setLastSyncTime(new Date());
      setOverallStatus(SyncStatus.Complete);

      // Update final progress state
      const finalProgressMap = manager.getProgress();
      setSyncProgress(finalProgressMap);

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

      if (completedEvent.result) {
        addLog(
          `📈 Stats: ${completedEvent.result.itemsSynced} items, ${Math.round(completedEvent.result.duration / 1000)}s`
        );
      }

      // Trigger image grid refresh when sync completes
      setBinaryDataCount((prev) => prev + 1);

      // Update storage usage after sync completion
      setTimeout(() => {
        calculateStorageUsage();
      }, 1500);

      // Check for binary data with longer delay if binary sync happened
      if (
        completedEvent.result &&
        completedEvent.result.binaryStats &&
        completedEvent.result.binaryStats.cached > 0
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
      const failedEvent = event as SyncFailedEvent;
      addLog(`❌ Sync failed: ${failedEvent.error.message}`);
      setIsSyncing(false);
      setOverallStatus(SyncStatus.Failed);
    });

    manager.on(SyncEventType.AutoSyncTriggered, (event) => {
      const autoSyncEvent = event as AutoSyncTriggeredEvent;
      addLog(
        `🔄 Auto-sync triggered for ${autoSyncEvent.trigger}: ${autoSyncEvent.domain}`
      );
    });

    manager.on(SyncEventType.ConnectionChanged, (event) => {
      const connectionEvent = event as ConnectionChangedEvent;
      addLog(
        `🔗 Connection ${connectionEvent.isOnline ? "established" : "lost"}`
      );
    });

    manager.on(SyncEventType.BinaryProgress, (event) => {
      const binaryEvent = event as BinarySyncProgressEvent;
      if (binaryEvent.currentItem && binaryEvent.totalItems) {
        const completed = binaryEvent.currentItem;
        const total = binaryEvent.totalItems;
        addLog(`📁 Binary sync: ${completed}/${total} files`);

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
        console.log("🐛 No sync manager available for storage stats");
        return;
      }

      console.log("🐛 Calculating storage usage...");
      // Get storage stats from the unified sync manager
      const stats = await manager.getStorageStats();
      console.log("🐛 Storage stats received:", stats);

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
      console.log("🐛 Safe stats:", safeStats);

      // Update reactive signals instead of DOM manipulation
      const totalText = formatBytes(safeStats.totalSize);
      const musicSize = safeStats.itemCounts.music;
      const musicText = musicSize > 0 ? `${musicSize} items` : "No data";
      const binaryText = formatBytes(safeStats.binarySize);

      setTotalStorage(totalText);
      setMusicStorage(musicText);
      setBinaryStorage(binaryText);

      console.log("🐛 Updated storage stats:", {
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

  const handleSyncAll = async () => {
    const manager = syncManager();
    if (!manager || isSyncing()) return;

    try {
      addLog("🚀 Starting unified sync for all domains...");

      const result = await manager.syncAll({
        domains: ["music", "photos"], // Start with core domains
        includeBinaryData: true, // Enable WebSocket binary sync
        forceFullSync: false,
      });

      addLog(
        `✨ Sync completed! Domain: ${result.domain}, Items: ${result.itemsSynced}/${result.totalItems}`
      );
    } catch (error) {
      addLog(`❌ Sync failed: ${error.message}`);
    }
  };

  const handleToggleServiceWorker = async () => {
    const newValue = !serviceWorkerEnabled();
    setServiceWorkerEnabled(newValue);
    addLog(`🔧 Service Worker ${newValue ? "enabled" : "disabled"}`);

    const manager = syncManager();
    if (manager && phase3System()) {
      // Reinitialize with new service worker setting
      const p3 = phase3System();
      if (p3.setBackgroundSyncEnabled) {
        await p3.setBackgroundSyncEnabled(newValue);
      }
    }
  };

  const handleToggleAutoSync = async () => {
    const newValue = !autoSyncEnabled();
    setAutoSyncEnabled(newValue);

    const manager = syncManager();
    if (manager) {
      if (newValue) {
        addLog("🔄 Enabling auto-sync...");
        manager.enableAutoSync(true);
      } else {
        addLog("⏸️ Disabling auto-sync...");
        manager.enableAutoSync(false);
      }
    }
  };

  const handleDestroyAll = async () => {
    const manager = syncManager();
    if (!manager || isSyncing()) return;

    try {
      addLog("💥 Starting complete database teardown...");

      // Reset UI state first
      setIsInitialized(false);
      setLastSyncTime(null);
      setImageUrls([]);
      setBinaryDataCount(0);

      // Destroy the database
      await syncManager()?.destroy();
      addLog("🗑️ Database completely destroyed!");

      // Clear existing sync manager
      setSyncManager(null);
      setPhase3System(null);

      addLog("🔄 Reinitializing system...");

      // Reinitialize the sync manager
      await initializeSystem();

      addLog("✅ System reinitialized successfully!");
    } catch (error) {
      addLog(`❌ Teardown failed: ${error.message}`);
      console.error("Destroy error:", error);
    }
  };

  // Load image grid when binary data becomes available
  const loadImageGrid = async () => {
    const manager = syncManager();
    if (!manager || !isInitialized()) return;

    try {
      // Get first 100 image blobs
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
    } catch (error) {
      addLog(`❌ Failed to load image grid: ${error.message}`);
    }
  };

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

  const handleConnect = () => {
    const ws = websocketClient();
    if (ws && !isConnected()) {
      addLog("🔄 Connecting WebSocket...");
      ws.connect();
    }
  };

  const handleToggleDebug = () => {
    const newState = !debugEnabled();
    setDebugEnabled(newState);

    if (newState) {
      enableDebug();
      addLog("🐛 Debug logging enabled");
    } else {
      disableDebug();
      addLog("🔇 Debug logging disabled");
    }
  };

  const handleDisconnect = () => {
    const ws = websocketClient();
    if (ws && isConnected()) {
      addLog("🔌 Disconnecting WebSocket...");
      ws.disconnect();
    }
  };

  // Initialize on mount
  onMount(() => {
    initializeSystem();
  });

  // Cleanup on unmount
  onCleanup(() => {
    const ws = websocketClient();
    const manager = syncManager();

    if (ws) {
      ws.disconnect();
    }

    if (manager) {
      manager.destroy();
    }
  });

  // Calculate overall statistics
  const getOverallStats = () => {
    const progress = overallProgress();
    const percentage = progress.progress;

    return {
      percentage,
      itemsText: `${progress.itemsProcessed}/${progress.totalItems} items`,
      batchText:
        progress.totalBatches > 0
          ? `Batch ${progress.currentBatch}/${progress.totalBatches}`
          : "",
      etaText:
        progress.eta && progress.eta > 0
          ? `ETA: ${Math.round(progress.eta)}s`
          : "",
      speedText: "", // Remove binary stats reference for now
    };
  };

  return (
    <div class={`unified-sync-demo ${props.className || ""}`}>
      <div class="demo-header">
        <h2>🚀 Unified Sync System Demo</h2>
        <div class="phase-info">
          <span class="phase-badge">Phase 4: Unified UI Demo</span>
          <span class="version-badge">v1.0.0</span>
        </div>
      </div>

      {/* Connection Status */}
      <div class="connection-section">
        <h3>🔗 Connection Status</h3>
        <div class="connection-controls">
          <Show when={websocketClient()}>
            <WebSocketStatusComponent
              status={connectionStatus()}
              showText={true}
              compact={true}
            />
            <div class="connection-buttons">
              <Show when={!isConnected()}>
                <button
                  class="connect-button"
                  onClick={handleConnect}
                  disabled={connectionStatus() === ConnectionStatus.Connecting}
                >
                  {connectionStatus() === ConnectionStatus.Connecting
                    ? "Connecting..."
                    : "Connect"}
                </button>
              </Show>
              <Show when={isConnected()}>
                <button class="disconnect-button" onClick={handleDisconnect}>
                  Disconnect
                </button>
              </Show>
            </div>
          </Show>
          <div class="initialization-status">
            <span
              class={`status-indicator ${isInitialized() ? "success" : "pending"}`}
            >
              {isInitialized() ? "✅ Initialized" : "⏳ Initializing..."}
            </span>
          </div>
        </div>
      </div>

      {/* Feature Toggles */}
      <div class="feature-toggles">
        <h3>⚙️ Feature Controls</h3>
        <div class="toggle-controls">
          <label class="toggle-control">
            <input
              type="checkbox"
              checked={serviceWorkerEnabled()}
              onChange={handleToggleServiceWorker}
              disabled={!isInitialized()}
            />
            <span>🔧 Service Worker Background Sync</span>
          </label>
          <label class="toggle-control">
            <input
              type="checkbox"
              checked={autoSyncEnabled()}
              onChange={handleToggleAutoSync}
              disabled={!isInitialized()}
            />
            <span>🔄 Auto-Sync on Changes</span>
          </label>
          <label class="toggle-control">
            <input
              type="checkbox"
              checked={debugEnabled()}
              onChange={handleToggleDebug}
            />
            <span>🐛 Debug Logging</span>
          </label>
          <Show when={props.enableUserNotifications !== false}>
            <label class="toggle-control">
              <input type="checkbox" checked disabled />
              <span>🔔 User Notifications</span>
            </label>
          </Show>
        </div>
      </div>

      {/* Main Sync Controls */}
      <div class="sync-controls">
        <h3>🎯 Unified Sync Control</h3>
        <div class="main-controls">
          <button
            class={`sync-all-button ${isSyncing() ? "syncing pulse" : ""}`}
            onClick={() => {
              console.log("🐛 Button click - Debug state:", {
                isInitialized: isInitialized(),
                isConnected: isConnected(),
                isSyncing: isSyncing(),
                buttonDisabled:
                  !isInitialized() || !isConnected() || isSyncing(),
              });
              handleSyncAll();
            }}
            disabled={!isInitialized() || !isConnected() || isSyncing()}
          >
            <Show
              when={isSyncing()}
              fallback={<span>🚀 Sync All Domains</span>}
            >
              <span>🔄 Syncing...</span>
            </Show>
          </button>

          <button
            class="destroy-button"
            onClick={handleDestroyAll}
            disabled={!isInitialized() || isSyncing()}
            style={{
              "background-color": "#dc3545",
              color: "white",
              border: "none",
              padding: "10px 20px",
              "border-radius": "5px",
              cursor:
                !isInitialized() || isSyncing() ? "not-allowed" : "pointer",
              opacity: !isInitialized() || isSyncing() ? "0.5" : "1",
              "margin-left": "10px",
            }}
            title="Completely destroy all IndexedDB data (for testing)"
          >
            💥 Destroy All Data
          </button>

          <Show when={lastSyncTime()}>
            <div class="last-sync">
              Last sync: {lastSyncTime()?.toLocaleTimeString()}
            </div>
          </Show>
        </div>
      </div>

      {/* Progress Display */}
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
                        ? getOverallStats().percentage
                        : Math.min(
                            85,
                            Math.max(10, overallProgress().itemsProcessed * 0.5)
                          )
                    }%`,
                    background:
                      overallProgress().totalItems > 0
                        ? "linear-gradient(90deg, #3b82f6, #1d4ed8)"
                        : "linear-gradient(90deg, #f59e0b, #d97706)",
                  }}
                />
              </div>
              <div class="horizontal-progress-text">
                <Show when={overallProgress().totalItems > 0}>
                  <span class="progress-percentage">
                    {getOverallStats().percentage}%
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
                    {getOverallStats().itemsText}
                  </span>
                </Show>
              </div>
            </div>
          </Show>
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

      {/* Domain Status Overview - Only show music domain for now */}
      <Show when={syncStatus().music && syncProgress().music}>
        <div class="domain-status">
          <h3>🎵 Music Domain Status</h3>
          <div class="domain-grid">
            <div class={`domain-card ${syncStatus().music.toLowerCase()}`}>
              <div class="domain-name">🎵 music</div>
              <SyncStatusComponent status={syncStatus().music} compact={true} />
              <div class="domain-progress">
                <div class="domain-progress-text">
                  {syncProgress().music.itemsProcessed}/
                  {syncProgress().music.totalItems} items
                </div>
                <div class="domain-progress-bar">
                  <div
                    class="domain-progress-fill"
                    style={{
                      width: `${syncProgress().music.progress}%`,
                      "background-color":
                        syncStatus().music === "in_progress"
                          ? "#ff00ff"
                          : "#0f0",
                    }}
                  />
                </div>
                <div class="domain-progress-percent">
                  {Math.round(syncProgress().music.progress)}%
                </div>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* Image Grid */}
      <Show when={imageUrls().length > 0}>
        <div class="image-grid-section">
          <h3>🖼️ Binary Data Image Grid ({imageUrls().length} images)</h3>
          <div class="image-grid">
            <For each={imageUrls()}>
              {(url, index) => (
                <div class="image-item">
                  <img
                    src={url}
                    alt={`Image ${index() + 1}`}
                    class="grid-image"
                    onError={(e) => {
                      console.log(`Failed to load image ${index() + 1}:`, url);
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Activity Log */}
      <div class="activity-log">
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

      {/* System Information */}
      <div class="system-info">
        <h3>ℹ️ System Information</h3>
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">Sync Features:</span>
            <span class="info-value">
              {Object.entries(SYNC_FEATURES)
                .filter(([_, enabled]) => enabled)
                .map(([feature, _]) => feature)
                .join(", ")}
            </span>
          </div>
          <div class="info-item">
            <span class="info-label">Client ID:</span>
            <span class="info-value">{getClientId().slice(0, 8)}...</span>
          </div>
          <div class="info-item">
            <span class="info-label">API URL:</span>
            <span class="info-value">
              {props.apiBaseUrl || "http://localhost:8080"}
            </span>
          </div>
        </div>
      </div>

      <style>{`
        .unified-sync-demo {
          padding: 20px;
          max-width: 800px;
          margin: 0 auto;
          font-family:
            -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background: black;
          color: white;
          border-radius: 12px;
        }

        .demo-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 30px;
          padding-bottom: 15px;
          border-bottom: 2px solid #333;
        }

        .demo-header h2 {
          margin: 0;
          color: white;
        }

        .phase-info {
          display: flex;
          gap: 10px;
        }

        .phase-badge,
        .version-badge {
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
        }

        .phase-badge {
          background: #3498db;
          color: white;
        }

        .version-badge {
          background: #2ecc71;
          color: white;
        }

        .connection-section,
        .feature-toggles,
        .sync-controls,
        .progress-section,
        .domain-status,
        .image-grid-section,
        .activity-log,
        .system-info,
        .storage-stats {
          margin-bottom: 25px;
          padding: 15px;
          border: 1px solid #333;
          border-radius: 8px;
          background: #111;
        }

        .connection-section h3,
        .feature-toggles h3,
        .sync-controls h3,
        .progress-section h3,
        .domain-status h3,
        .image-grid-section h3,
        .activity-log h3,
        .system-info h3,
        .storage-stats h3 {
          margin: 0 0 15px 0;
          color: white;
          font-size: 16px;
        }

        .connection-controls {
          display: flex;
          align-items: center;
          gap: 15px;
        }

        .connection-buttons {
          display: flex;
          gap: 10px;
        }

        .connect-button,
        .disconnect-button {
          padding: 6px 12px;
          border: none;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .connect-button {
          background: #3498db;
          color: white;
        }

        .connect-button:hover:not(:disabled) {
          background: #2980b9;
        }

        .connect-button:disabled {
          background: #95a5a6;
          cursor: not-allowed;
        }

        .disconnect-button {
          background: #e74c3c;
          color: white;
        }

        .disconnect-button:hover {
          background: #c0392b;
        }

        .status-indicator {
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 500;
        }

        .status-indicator.success {
          background: #d4edda;
          color: #155724;
        }

        .status-indicator.pending {
          background: #fff3cd;
          color: #856404;
        }

        .toggle-controls {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .toggle-control {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          user-select: none;
          color: white;
        }

        .toggle-control input[type="checkbox"] {
          cursor: pointer;
        }

        .toggle-control input[type="checkbox"]:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .main-controls {
          display: flex;
          align-items: center;
          gap: 15px;
          margin-bottom: 15px;
        }

        .sync-all-button {
          padding: 15px 30px;
          font-size: 18px;
          font-weight: 600;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.3s ease;
          background: #ff00ff;
          color: black;
          min-width: 200px;
        }

        .sync-all-button:hover:not(:disabled) {
          background: #ff00ff;
          transform: translateY(-2px);
          box-shadow: 0 4px 15px rgba(255, 0, 255, 0.3);
        }

        .sync-all-button:disabled {
          background: #333;
          color: #666;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .sync-all-button.syncing {
          background: linear-gradient(135deg, #ff00ff, #cc00cc);
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.8;
          }
        }

        .last-sync {
          color: #ccc;
          font-size: 14px;
        }

        .loading-indicator {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px;
          background: #f8f9fa;
          border: 1px solid #e9ecef;
          border-radius: 8px;
          font-size: 14px;
          color: #6c757d;
        }

        .loading-spinner {
          width: 20px;
          height: 20px;
          border: 2px solid #e9ecef;
          border-top: 2px solid #007bff;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
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
          color: #ff00ff;
          font-size: 16px;
        }

        .progress-items {
          color: #ccc;
        }

        .progress-initializing {
          color: #ff00ff;
          font-weight: 500;
        }

        .progress-operation {
          color: #ccc;
          font-size: 13px;
          font-style: italic;
        }

        .progress-display {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .domain-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 15px;
        }

        .domain-card {
          padding: 15px;
          border: 2px solid #333;
          border-radius: 8px;
          background: #222;
          transition: all 0.2s ease;
        }

        .domain-card.complete {
          border-color: #0f0;
          background: #001100;
        }

        .domain-card.in_progress {
          border-color: #ff00ff;
          background: #330033;
        }

        .domain-card.failed {
          border-color: #e74c3c;
          background: #fadbd8;
        }

        .domain-name {
          font-weight: 600;
          margin-bottom: 10px;
          color: white;
        }

        .domain-progress {
          margin-top: 8px;
          font-size: 12px;
        }

        .domain-progress-text {
          color: #ccc;
          margin-bottom: 4px;
        }

        .domain-progress-bar {
          width: 100%;
          height: 4px;
          background-color: #444;
          border-radius: 2px;
          overflow: hidden;
          margin-bottom: 4px;
        }

        .domain-progress-fill {
          height: 100%;
          transition: width 0.3s ease;
          border-radius: 2px;
        }

        .domain-progress-percent {
          color: white;
          font-weight: 500;
          text-align: center;
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
          color: #ff00ff;
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

        .log-container {
          max-height: 200px;
          overflow-y: auto;
          border: 1px solid #333;
          border-radius: 4px;
          background: #111;
          padding: 10px;
        }

        .log-entry {
          padding: 4px 0;
          font-family: "Monaco", "Menlo", monospace;
          font-size: 12px;
          color: #ccc;
          border-bottom: 1px solid #333;
        }

        .log-entry:last-child {
          border-bottom: none;
        }

        .log-empty {
          color: #666;
          font-style: italic;
          text-align: center;
          padding: 20px;
        }

        .info-grid {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .info-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0;
          border-bottom: 1px solid #333;
        }

        .info-item:last-child {
          border-bottom: none;
        }

        .info-label {
          font-weight: 600;
          color: #34495e;
        }

        .info-value {
          font-family: "Monaco", "Menlo", monospace;
          color: white;
          font-size: 13px;
        }

        .image-grid-section {
          margin-bottom: 25px;
          padding: 20px;
          background: #111;
          border-radius: 8px;
          border: 1px solid #333;
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

        .grid-image:error {
          border-color: #f00;
          background: #330000;
        }

        @media (max-width: 600px) {
          .unified-sync-demo {
            padding: 15px;
          }

          .demo-header {
            flex-direction: column;
            gap: 10px;
            text-align: center;
          }

          .connection-controls {
            flex-direction: column;
            align-items: stretch;
          }

          .progress-stats {
            justify-content: center;
          }

          .domain-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

customElement(
  "unified-sync-demo",
  {
    apiBaseUrl: undefined,
    clientId: undefined,
    autoConnect: true,
    enableServiceWorker: true,
    enableAutoSync: true,
    className: "",
    enableUserNotifications: true,
  },
  UnifiedSyncDemoComponent
);

export default UnifiedSyncDemoComponent;
