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
  setupPhase3AutoSyncQuick,
  SYNC_FEATURES,
  SYNC_PHASES,
  SyncStatus,
  SyncEventType,
  type UnifiedSyncManager,
  type SyncProgress,
  type SyncStatusMap,
  type SyncProgressMap,
  type AnySyncEvent,
} from "../sync/index.js";
import SyncStatusComponent from "./sync-status.js";
import SyncProgressComponent from "./sync-progress.js";
import { WebSocketStatus as WebSocketStatusComponent } from "./websocket-status.js";
import { ConnectionStatus } from "../lib/websocket-client.js";
import { setupPhase3AutoSync } from "../sync/phase3-auto-sync-integration.js";

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
  const [syncStatus, setSyncStatus] = createSignal<SyncStatusMap>({});
  const [syncProgress, setSyncProgress] = createSignal<SyncProgressMap>({});
  const [overallStatus, setOverallStatus] = createSignal(SyncStatus.Never);
  const [overallProgress, setOverallProgress] = createSignal<SyncProgress>({
    totalItems: 0,
    completedItems: 0,
    currentBatch: 0,
    totalBatches: 0,
    estimatedTimeRemaining: 0,
    bytesTransferred: 0,
    totalBytes: 0,
    binaryStats: null,
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
      const api = new ApiClient(baseUrl);
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
        setIsConnected(status === ConnectionStatus.Connected);
        addLog(`🔗 WebSocket status: ${status}`);
        console.log("🐛 WebSocket status change:", {
          status,
          isConnected: status === ConnectionStatus.Connected,
          isInitialized: isInitialized(),
        });

        if (status === ConnectionStatus.Connected) {
          setConnectionError(null);
          // Force UI update when connected
          console.log("🔌 WebSocket connected - forcing UI update");
        } else if (status === ConnectionStatus.Error) {
          setConnectionError("WebSocket connection error");
        }
      };

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

      // Set up unified sync system with Phase 3 auto-sync
      // Set up Phase 3 auto-sync system
      addLog("⚙️ Setting up unified sync manager...");
      const { syncManager: manager, phase3System: p3System } =
        await setupPhase3AutoSyncQuick(ws, api, {
          apiBaseUrl: baseUrl,
          clientId,
          enableUserNotifications: props.enableUserNotifications ?? true,
          enableBackgroundSync: serviceWorkerEnabled(),
        });

      setSyncManager(manager);
      setPhase3System(p3System);

      // Set up sync event listeners
      setupSyncEventListeners(manager);

      // Enable auto-sync if requested
      if (autoSyncEnabled()) {
        addLog("🔄 Enabling auto-sync...");
        manager.enableAutoSync();
      }

      setIsInitialized(true);
      addLog("✅ Unified Sync System initialized successfully");
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
          buttonEnabled: initialized && connected && !syncing,
        });
      });

      // Show current phase status
      Object.entries(SYNC_PHASES).forEach(([phase, status]) => {
        addLog(`${phase}: ${status}`);
      });
    } catch (error) {
      addLog(`❌ Initialization failed: ${error.message}`);
      setConnectionError(error.message);
    }
  };

  const setupSyncEventListeners = (manager: UnifiedSyncManager) => {
    manager.on(SyncEventType.SyncStarted, (event) => {
      addLog(`🔄 Sync started: ${event.domains?.join(", ") || "all domains"}`);
      setIsSyncing(true);
      setOverallStatus(SyncStatus.InProgress);
    });

    manager.on(SyncEventType.SyncProgress, (event) => {
      setSyncStatus(manager.getStatus());
      setSyncProgress(manager.getProgress());
      setOverallProgress(event.overallProgress);

      if (event.domain) {
        addLog(
          `📊 ${event.domain}: ${event.progress.completedItems}/${event.progress.totalItems} items`
        );
      }
    });

    manager.on(SyncEventType.SyncCompleted, (event) => {
      addLog(
        `✅ Sync completed: ${event.domains?.join(", ") || "all domains"}`
      );
      setIsSyncing(false);
      setLastSyncTime(new Date());
      setOverallStatus(SyncStatus.Completed);

      if (event.stats) {
        addLog(
          `📈 Stats: ${event.stats.totalItems} items, ${Math.round(event.stats.totalTime / 1000)}s`
        );
      }

      // Trigger image grid refresh when sync completes
      setBinaryDataCount((prev) => prev + 1);
    });

    manager.on(SyncEventType.SyncFailed, (event) => {
      addLog(`❌ Sync failed: ${event.error.message}`);
      setIsSyncing(false);
      setOverallStatus(SyncStatus.Failed);
    });

    manager.on(SyncEventType.AutoSyncTriggered, (event) => {
      addLog(
        `🔔 Auto-sync triggered: ${event.reason} (${event.domains?.join(", ") || "all domains"})`
      );
    });

    manager.on(SyncEventType.ConnectionChanged, (event) => {
      addLog(`🔗 Connection ${event.connected ? "established" : "lost"}`);
    });

    manager.on(SyncEventType.BinarySyncProgress, (event) => {
      if (event.stats) {
        const { completed, total, speed } = event.stats;
        addLog(
          `📁 Binary sync: ${completed}/${total} files (${Math.round(speed / 1024)}KB/s)`
        );
      }
    });
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
        `✨ Sync completed! Synced domains: ${result.syncedDomains?.join(", ") || "none"}`
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
        manager.enableAutoSync();
      } else {
        addLog("⏸️ Auto-sync disabled");
        // Note: There's no disable method in the current API
      }
    }
  };

  const handleDestroyAll = async () => {
    const manager = syncManager();
    if (!manager || isSyncing()) return;

    try {
      addLog("💥 Starting complete database teardown...");

      await manager.destroyAll();

      addLog("🗑️ Database completely destroyed!");
      addLog("🔄 Reinitializing system...");

      // Reset UI state
      setIsInitialized(false);
      setLastSyncTime(null);

      // Reinitialize the sync manager
      await initializeSystem();

      addLog("✅ System reinitialized successfully!");
    } catch (error) {
      addLog(`❌ Teardown failed: ${error.message}`);
    }
  };

  // Reactive effect to load image grid when binary data is available
  createEffect(async () => {
    const manager = syncManager();
    const initialized = isInitialized();
    const _ = binaryDataCount(); // Track binary data changes

    if (!manager || !initialized) return;

    try {
      // Get first 100 image blobs
      const imageBlobs = (await manager.getMediaBlobs()).slice(0, 100);

      if (imageBlobs.length === 0) {
        setImageUrls([]);
        return;
      }

      console.log(
        `📷 Found ${imageBlobs.length} image blobs, creating URLs...`
      );

      const urls: string[] = [];
      for (const blob of imageBlobs) {
        const url = await manager.getBlobUrl(blob.id);
        if (url) {
          urls.push(url);
        }
      }

      if (urls.length > 0) {
        setImageUrls(urls);
        addLog(`🎨 Image grid loaded: ${urls.length} images`);
      }
    } catch (error) {
      console.error("Failed to load image grid:", error);
    }
  });

  const handleConnect = () => {
    const ws = websocketClient();
    if (ws && !isConnected()) {
      addLog("🔄 Connecting WebSocket...");
      ws.connect();
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
    const percentage =
      progress.totalItems > 0
        ? Math.round((progress.completedItems / progress.totalItems) * 100)
        : 0;

    return {
      percentage,
      itemsText: `${progress.completedItems}/${progress.totalItems} items`,
      batchText:
        progress.totalBatches > 0
          ? `Batch ${progress.currentBatch}/${progress.totalBatches}`
          : "",
      etaText:
        progress.estimatedTimeRemaining > 0
          ? `ETA: ${Math.round(progress.estimatedTimeRemaining / 1000)}s`
          : "",
      speedText: progress.binaryStats?.speed
        ? `${Math.round(progress.binaryStats.speed / 1024)}KB/s`
        : "",
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
            class={`sync-all-button ${isSyncing() ? "syncing" : ""}`}
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
          <div class="progress-display">
            <SyncProgressComponent
              progress={getOverallStats().percentage}
              itemsSynced={overallProgress().completedItems}
              totalItems={overallProgress().totalItems}
              currentBatch={overallProgress().currentBatch}
              totalBatches={overallProgress().totalBatches}
              eta={overallProgress().estimatedTimeRemaining}
              showDetails={true}
              className="unified-progress"
            />

            <div class="progress-stats">
              <div class="stat-item">
                <span class="stat-label">Items:</span>
                <span class="stat-value">{getOverallStats().itemsText}</span>
              </div>
              <Show when={getOverallStats().batchText}>
                <div class="stat-item">
                  <span class="stat-label">Batches:</span>
                  <span class="stat-value">{getOverallStats().batchText}</span>
                </div>
              </Show>
              <Show when={getOverallStats().speedText}>
                <div class="stat-item">
                  <span class="stat-label">Speed:</span>
                  <span class="stat-value">{getOverallStats().speedText}</span>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </Show>

      {/* Domain Status Overview */}
      <Show when={Object.keys(syncStatus()).length > 0}>
        <div class="domain-status">
          <h3>🎵 Domain Status</h3>
          <div class="domain-grid">
            <For each={Object.entries(syncStatus())}>
              {([domain, status]) => (
                <div class={`domain-card ${status.toLowerCase()}`}>
                  <div class="domain-name">
                    {domain === "music"
                      ? "🎵"
                      : domain === "photos"
                        ? "📸"
                        : "📁"}{" "}
                    {domain}
                  </div>
                  <SyncStatusComponent status={status} compact={true} />
                  <Show when={syncProgress()[domain]}>
                    <div class="domain-progress">
                      {syncProgress()[domain].completedItems}/
                      {syncProgress()[domain].totalItems}
                    </div>
                  </Show>
                </div>
              )}
            </For>
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
                    style={{
                      width: "100px",
                      height: "100px",
                      "object-fit": "cover",
                      border: "1px solid #ddd",
                      "border-radius": "4px",
                    }}
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

      <style jsx>{`
        .unified-sync-demo {
          padding: 20px;
          max-width: 800px;
          margin: 0 auto;
          font-family:
            -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        .demo-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 30px;
          padding-bottom: 15px;
          border-bottom: 2px solid #e0e0e0;
        }

        .demo-header h2 {
          margin: 0;
          color: #2c3e50;
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
        .system-info {
          margin-bottom: 25px;
          padding: 15px;
          border: 1px solid #ddd;
          border-radius: 8px;
          background: #f9f9f9;
        }

        .connection-section h3,
        .feature-toggles h3,
        .sync-controls h3,
        .progress-section h3,
        .domain-status h3,
        .image-grid-section h3,
        .activity-log h3,
        .system-info h3 {
          margin: 0 0 15px 0;
          color: #34495e;
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
          color: black;
        }

        .toggle-control {
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
        }

        .toggle-control input[type="checkbox"] {
          margin: 0;
        }

        .main-controls {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 15px;
        }

        .sync-all-button {
          padding: 15px 30px;
          font-size: 18px;
          font-weight: 600;
          border: none;
          border-radius: 8px;
          background: linear-gradient(135deg, #3498db, #2980b9);
          color: white;
          cursor: pointer;
          transition: all 0.3s ease;
          min-width: 200px;
        }

        .sync-all-button:hover:not(:disabled) {
          background: linear-gradient(135deg, #2980b9, #3498db);
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(52, 152, 219, 0.3);
        }

        .sync-all-button:disabled {
          background: #95a5a6;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .sync-all-button.syncing {
          background: linear-gradient(135deg, #e67e22, #d35400);
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
          color: #7f8c8d;
          font-size: 14px;
        }

        .progress-display {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }

        .progress-stats {
          display: flex;
          gap: 20px;
          flex-wrap: wrap;
        }

        .stat-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 8px 12px;
          background: white;
          border-radius: 4px;
          border: 1px solid #ddd;
        }

        .stat-label {
          font-size: 12px;
          color: #7f8c8d;
          font-weight: 600;
        }

        .stat-value {
          font-size: 14px;
          color: #2c3e50;
          font-weight: 500;
        }

        .domain-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 15px;
        }

        .domain-card {
          padding: 15px;
          border-radius: 8px;
          background: white;
          border: 2px solid #ecf0f1;
          text-align: center;
        }

        .domain-card.completed {
          border-color: #2ecc71;
          background: #d5f6e3;
        }

        .domain-card.inprogress {
          border-color: #f39c12;
          background: #fef9e7;
        }

        .domain-card.failed {
          border-color: #e74c3c;
          background: #fadbd8;
        }

        .domain-name {
          font-weight: 600;
          margin-bottom: 8px;
          color: #2c3e50;
        }

        .domain-progress {
          font-size: 12px;
          color: #7f8c8d;
          margin-top: 5px;
        }

        .log-container {
          max-height: 200px;
          overflow-y: auto;
          background: white;
          border: 1px solid #ddd;
          border-radius: 4px;
          padding: 10px;
        }

        .log-entry {
          padding: 4px 0;
          font-family: "Monaco", "Menlo", monospace;
          font-size: 12px;
          color: #2c3e50;
          border-bottom: 1px solid #f0f0f0;
        }

        .log-entry:last-child {
          border-bottom: none;
        }

        .log-empty {
          color: #95a5a6;
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
          padding: 8px 0;
          border-bottom: 1px solid #e0e0e0;
        }

        .info-item:last-child {
          border-bottom: none;
        }

        .info-label {
          font-weight: 600;
          color: #34495e;
        }

        .info-value {
          color: #7f8c8d;
          font-family: "Monaco", "Menlo", monospace;
          font-size: 12px;
        }

        .image-grid-section {
          margin-bottom: 25px;
          padding: 20px;
          background: #f8f9fa;
          border-radius: 8px;
          border: 1px solid #e9ecef;
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
          background: white;
          border-radius: 4px;
          overflow: hidden;
        }

        .image-item img {
          transition: transform 0.2s ease;
        }

        .image-item img:hover {
          transform: scale(1.05);
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
