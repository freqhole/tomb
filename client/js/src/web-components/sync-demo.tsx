/**
 * Sync Demo Web Component
 *
 * A complete demo component that integrates all sync UI components
 * with a working sync manager for end-to-end testing.
 */

/* @jsxImportSource solid-js */
import { customElement } from "solid-element";
import { createSignal, onMount, onCleanup, Show, For } from "solid-js";
import { ApiClient } from "../lib/api-client.js";
import { SyncStorageManager } from "../sync-legacy/sync-storage.js";
import { WebSocketClient } from "../lib/websocket-client.js";
import {
  createSyncManager,
  IntegratedSyncManager,
  createIntegratedSyncManager,
  defaultIntegratedSyncConfig,
  SyncStatus,
  SyncEventType,
  type SyncManager,
  type SyncStatus as SyncStatusType,
  type IntegratedSyncProgress,
  type IntegratedSyncResult,
} from "../sync-legacy/index.js";
import SyncStatusComponent from "./sync-status.js";
import SyncProgressComponent from "./sync-progress.js";
import SyncControlsComponent from "./sync-controls.js";

export interface SyncDemoProps {
  apiBaseUrl?: string;
  clientId?: string;
  autoConnect?: boolean;
  className?: string;
  enableMusicSync?: boolean;
  enableBinarySync?: boolean;
}

function SyncDemoComponent(props: SyncDemoProps) {
  const [syncManager, setSyncManager] = createSignal<SyncManager | null>(null);
  const [integratedSyncManager, setIntegratedSyncManager] =
    createSignal<IntegratedSyncManager | null>(null);
  const [websocketClient, setWebsocketClient] =
    createSignal<WebSocketClient | null>(null);
  const [status, setStatus] = createSignal<SyncStatusType>(SyncStatus.Never);
  const [integratedStatus, setIntegratedStatus] = createSignal<SyncStatusType>(
    SyncStatus.Never
  );
  const [progress, setProgress] = createSignal<number>(0);
  const [itemsSynced, setItemsSynced] = createSignal<number>(0);
  const [totalItems, setTotalItems] = createSignal<number>(0);
  const [currentBatch, setCurrentBatch] = createSignal<number>(0);
  const [totalBatches, setTotalBatches] = createSignal<number>(0);
  const [eta, setEta] = createSignal<number>(0);
  const [isConnected, setIsConnected] = createSignal<boolean>(false);
  const [error, setError] = createSignal<string | null>(null);
  const [logs, setLogs] = createSignal<string[]>([]);
  const [integratedProgress, setIntegratedProgress] =
    createSignal<IntegratedSyncProgress | null>(null);
  const [binaryStats, setBinaryStats] = createSignal<any>(null);
  // Note: Auto-sync polling has been replaced by WebSocket notifications
  // See websocket-feed-demo.tsx for real-time feed updates

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-9), `[${timestamp}] ${message}`]);
  };

  // Auto-sync polling removed - use WebSocket notifications instead

  const initializeSyncManager = async () => {
    try {
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

      // Validate UUID format
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      let clientId: string;
      if (props.clientId && uuidRegex.test(props.clientId)) {
        clientId = props.clientId;
        addLog(`Using provided clientId: ${clientId}`);
      } else {
        clientId = generateUUID();
        if (props.clientId) {
          addLog(
            `Provided clientId "${props.clientId}" is not a valid UUID, generated: ${clientId}`
          );
        } else {
          addLog(`Generated new clientId: ${clientId}`);
        }
      }

      const apiClient = new ApiClient({
        baseUrl: props.apiBaseUrl || "http://localhost:8080",
      });

      // Initialize WebSocket client for binary sync
      const wsClient = new WebSocketClient({
        url:
          (props.apiBaseUrl || "http://localhost:8080").replace("http", "ws") +
          "/ws",
        maxReconnectAttempts: 5,
        reconnectDelay: 1000,
      });

      try {
        await wsClient.connect();
        setWebsocketClient(wsClient);
        addLog("WebSocket connected for binary sync");
      } catch (wsErr) {
        addLog(
          `WebSocket connection failed: ${wsErr instanceof Error ? wsErr.message : "Unknown error"}`
        );
      }

      const manager = createSyncManager(apiClient, clientId, {
        defaultPageSize: 10,
        includeBinaryData: false,
        storage: {
          enabled: true,
          maxSize: 50 * 1024 * 1024, // 50MB
          maxCacheAge: 7,
        },
        conflictResolution: {
          defaultStrategy: "manual",
          autoResolveSimple: false,
        },
      });

      // Set up event listeners
      manager.on(SyncEventType.Started, (event: any) => {
        setStatus(SyncStatus.InProgress);
        addLog(`Sync started: ${event.fullSync ? "Full" : "Incremental"}`);
        if (event.estimatedItems) {
          setTotalItems(event.estimatedItems);
        }
      });

      manager.on(SyncEventType.Progress, (event: any) => {
        const { progress: progressData } = event;
        setProgress(progressData.progress || 0);
        setItemsSynced(progressData.items_synced || 0);
        setTotalItems(progressData.total_items || 0);
        setCurrentBatch(progressData.current_batch || 0);
        setTotalBatches(progressData.total_batches || 0);
        setEta(progressData.estimated_remaining_seconds || 0);
        addLog(
          `Progress: ${Math.round(progressData.progress || 0)}% (${progressData.items_synced}/${progressData.total_items})`
        );
      });

      manager.on(SyncEventType.Completed, (event: any) => {
        setStatus(SyncStatus.Complete);
        setProgress(100);
        addLog(
          `Sync completed: ${event.totalItems} items in ${(event.duration / 1000).toFixed(1)}s`
        );
        // Reset progress after a delay
        setTimeout(() => {
          setProgress(0);
          setCurrentBatch(0);
          setTotalBatches(0);
          setEta(0);
        }, 2000);
      });

      manager.on(SyncEventType.Failed, (event: any) => {
        setStatus(SyncStatus.Failed);
        setError(event.error.message);
        addLog(`Sync failed: ${event.error.message}`);
      });

      manager.on(SyncEventType.BatchCompleted, (event: any) => {
        addLog(
          `Batch ${event.batchNumber} completed: ${event.itemsInBatch} items`
        );
      });

      manager.on(SyncEventType.ConnectionChanged, (event: any) => {
        setIsConnected(event.isOnline);
        addLog(`Connection: ${event.isOnline ? "Online" : "Offline"}`);
      });

      manager.on(SyncEventType.ConflictDetected, (event: any) => {
        addLog(
          `Conflict detected: ${event.conflict.id} (${event.conflict.type})`
        );
      });

      await manager.initialize();
      setSyncManager(manager);
      setIsConnected(true);
      setStatus(SyncStatus.Complete);
      addLog("Sync manager initialized");

      // Initialize integrated sync manager if enabled
      if (props.enableMusicSync !== false) {
        try {
          addLog(`Creating integrated sync manager with clientId: ${clientId}`);

          // Validate clientId before proceeding
          addLog(`Validating clientId format...`);
          if (!clientId) {
            throw new Error("ClientId is undefined or empty");
          }

          // Create storage instance first
          addLog(`Creating storage manager...`);
          const storageManager = new SyncStorageManager({
            database_name: "webauthn_sync_storage",
            version: 4,
            max_storage_size: 100 * 1024 * 1024,
            max_cache_age_days: 30,
          });

          const config = {
            ...defaultIntegratedSyncConfig,
            apiBaseUrl: props.apiBaseUrl || "http://localhost:8080",
            authToken: "demo-token",
            clientId: clientId,
            batchSize: 25,
            maxRetryAttempts: 3,
            retryDelay: 1000,
            conflictResolution: "manual",
            enableStorage: true,
            maxStorageSize: 100 * 1024 * 1024,
            maxCacheAge: 30,
            enableWebSocketBinarySync: props.enableBinarySync !== false,
            autoSyncOnNewBlobs: true,
            binarySync: {
              priorityMimeTypes: ["image/", "audio/"],
              batchSize: 3,
              maxFileSize: 10 * 1024 * 1024,
              debug: true,
            },
          };

          addLog(`Config created, calling createIntegratedSyncManager...`);
          const integratedManager = createIntegratedSyncManager(
            wsClient,
            storageManager,
            config
          );

          // Set up integrated sync event listeners
          integratedManager.addEventListener("progress", (event: any) => {
            const progress = event.detail;
            setIntegratedProgress(progress);
            setIntegratedStatus(progress.overallStatus);

            addLog(
              `Integrated sync: ${progress.overallStatus} - Music: ${progress.musicSync.status}, Binary: ${progress.binarySync.status}`
            );

            if (progress.combinedProgress !== undefined) {
              setProgress(progress.combinedProgress);
            }
          });

          integratedManager.addEventListener("complete", (event: any) => {
            const result: IntegratedSyncResult = event.detail;
            addLog(
              `Integrated sync complete! Music: ${result.musicSync.itemsSynced} items, Binary: ${result.binarySync.thumbnailsCached} thumbnails (${Math.round(result.binarySync.bytesCached / 1024)}KB)`
            );
            setIntegratedStatus(SyncStatus.Complete);
          });

          integratedManager.addEventListener(
            "media_blob_added",
            (event: any) => {
              const { mediaBlob } = event.detail;
              addLog(
                `New media blob detected: ${mediaBlob.id} (${mediaBlob.mime})`
              );
            }
          );

          integratedManager.addEventListener("error", (event: any) => {
            const { error } = event.detail;
            addLog(
              `Integrated sync error: ${error instanceof Error ? error.message : error}`
            );
          });

          addLog("Calling integratedManager.initialize()...");
          await integratedManager.initialize();
          setIntegratedSyncManager(integratedManager);
          addLog("Integrated sync manager ready");

          // Update stats
          const stats = await integratedManager.getStats();
          setBinaryStats(stats.binary);
        } catch (err) {
          const errorDetails =
            err instanceof Error ? err.message : JSON.stringify(err);
          addLog(`Integrated sync initialization failed: ${errorDetails}`);
          console.error("Full error details:", err);
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      addLog(`Initialization failed: ${errorMessage}`);
    }
  };

  const handleStartSync = async () => {
    const manager = syncManager();
    const integratedManager = integratedSyncManager();

    if (integratedManager) {
      try {
        setError(null);
        addLog("Starting integrated sync (music + binary data)...");
        await integratedManager.sync({
          force: false,
          syncBinaryData: props.enableBinarySync !== false,
          pageSize: 25,
        });
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Integrated sync failed";
        setError(errorMessage);
        addLog(`Integrated sync error: ${errorMessage}`);
      }
    } else if (manager) {
      try {
        setError(null);
        await manager.sync({ force: false });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Sync failed";
        setError(errorMessage);
        addLog(`Sync error: ${errorMessage}`);
      }
    }
  };

  const handleStopSync = async () => {
    const manager = syncManager();
    const integratedManager = integratedSyncManager();

    if (integratedManager) {
      addLog(
        "Integrated sync stop not implemented (sync will complete current batch)"
      );
    } else if (manager) {
      try {
        await manager.stopSync();
        setStatus(SyncStatus.Complete);
        addLog("Sync stopped");
      } catch (err) {
        addLog(
          `Stop sync error: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
    }
  };

  const handlePauseSync = () => {
    const manager = syncManager();
    if (!manager) return;

    try {
      manager.pauseSync();
      addLog("Sync paused");
    } catch (err) {
      addLog(
        `Pause sync error: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  };

  const handleResumeSync = async () => {
    const manager = syncManager();
    if (!manager) return;

    try {
      await manager.resumeSync();
      addLog("Sync resumed");
    } catch (err) {
      addLog(
        `Resume sync error: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  };

  const handleForceSync = async () => {
    const manager = syncManager();
    const integratedManager = integratedSyncManager();

    if (integratedManager) {
      try {
        setError(null);
        addLog("Starting forced integrated sync...");
        await integratedManager.sync({
          force: true,
          syncBinaryData: props.enableBinarySync !== false,
          pageSize: 25,
        });
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Force sync failed";
        setError(errorMessage);
        addLog(`Force sync error: ${errorMessage}`);
      }
    } else if (manager) {
      try {
        setError(null);
        await manager.sync({ force: true });
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Force sync failed";
        setError(errorMessage);
        addLog(`Force sync error: ${errorMessage}`);
      }
    }
  };

  const handleRequestThumbnails = async () => {
    const integratedManager = integratedSyncManager();
    if (!integratedManager) {
      addLog("Integrated sync manager not available");
      return;
    }

    try {
      addLog("Requesting thumbnails for first media blob...");
      // This is a demo - in real usage you'd have a specific blob ID
      addLog("Note: This requires media blobs to exist in storage");
    } catch (err) {
      addLog(
        `Thumbnail request error: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  };

  const handleBinarySync = async () => {
    const integratedManager = integratedSyncManager();
    if (!integratedManager) {
      addLog("Integrated sync manager not available");
      return;
    }

    try {
      addLog("Starting WebSocket binary data sync...");
      await integratedManager.sync({
        force: false,
        syncBinaryData: true,
        pageSize: 25,
      });
    } catch (err) {
      addLog(
        `Binary sync error: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  };

  const updateIntegratedStats = async () => {
    const integratedManager = integratedSyncManager();
    if (!integratedManager) return;

    try {
      const stats = await integratedManager.getStats();
      setBinaryStats(stats.binary);
    } catch (err) {
      // Silently fail stats updates
    }
  };

  const handleUploadTestFile = async () => {
    try {
      // Create a simple test file
      const testContent = "This is a test file for binary sync demo";
      const blob = new Blob([testContent], { type: "text/plain" });
      const file = new File([blob], "test-file.txt", { type: "text/plain" });

      addLog(`Creating test file: ${file.name} (${file.size} bytes)`);

      // Create FormData for upload
      const formData = new FormData();
      formData.append("file", file);

      // Upload via API
      const apiBaseUrl = props.apiBaseUrl || "http://localhost:8080";
      const response = await fetch(`${apiBaseUrl}/api/media/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const result = await response.json();
      addLog(`Test file uploaded successfully: ${result.id}`);
      addLog("Now try syncing to see binary data in action!");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Upload failed";
      addLog(`Test file upload error: ${errorMsg}`);
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  onMount(() => {
    if (props.autoConnect !== false) {
      initializeSyncManager();
    }
  });

  onCleanup(async () => {
    const manager = syncManager();
    const integratedManager = integratedSyncManager();

    if (manager) {
      await manager.cleanup();
    }

    if (integratedManager) {
      await integratedManager.close();
    }
  });

  return (
    <div
      class={`sync-demo ${props.className || ""}`}
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "16px",
        padding: "20px",
        "border-radius": "12px",
        "background-color": "#ffffff",
        border: "1px solid #e2e8f0",
        "box-shadow": "0 1px 3px rgba(0, 0, 0, 0.1)",
        "font-family": "system-ui, -apple-system, sans-serif",
        "max-width": "600px",
        margin: "0 auto",
      }}
    >
      <style>{`
        .sync-demo .logs-container {
          background-color: #1f2937;
          color: #f3f4f6;
          padding: 12px;
          border-radius: 6px;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 12px;
          line-height: 1.4;
          max-height: 200px;
          overflow-y: auto;
        }
        .sync-demo .logs-container::-webkit-scrollbar {
          width: 6px;
        }
        .sync-demo .logs-container::-webkit-scrollbar-track {
          background: #374151;
        }
        .sync-demo .logs-container::-webkit-scrollbar-thumb {
          background: #6b7280;
          border-radius: 3px;
        }
      `}</style>

      {/* Header */}
      <div style={{ "text-align": "center" }}>
        <h2
          style={{ margin: "0 0 8px 0", color: "#111827", "font-size": "24px" }}
        >
          🔄 Sync Demo
        </h2>
        <p style={{ margin: "0", color: "#6b7280", "font-size": "14px" }}>
          End-to-end sync system demonstration
        </p>
      </div>

      {/* Connection Status */}
      <div
        style={{
          display: "flex",
          "justify-content": "center",
          gap: "12px",
          "align-items": "center",
        }}
      >
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "6px",
            padding: "6px 12px",
            "border-radius": "20px",
            "background-color": isConnected() ? "#dcfce7" : "#fee2e2",
            color: isConnected() ? "#166534" : "#991b1b",
            "font-size": "12px",
            "font-weight": "500",
          }}
        >
          <span>{isConnected() ? "🟢" : "🔴"}</span>
          {isConnected() ? "Connected" : "Disconnected"}
        </div>

        <Show when={!syncManager()}>
          <button
            onClick={initializeSyncManager}
            style={{
              padding: "6px 12px",
              "border-radius": "6px",
              border: "1px solid #3b82f6",
              "background-color": "#3b82f6",
              color: "#ffffff",
              "font-size": "12px",
              "font-weight": "500",
              cursor: "pointer",
            }}
          >
            Connect
          </button>
        </Show>
      </div>

      {/* Error Display */}
      <Show when={error()}>
        <div
          style={{
            padding: "12px",
            "border-radius": "6px",
            "background-color": "#fee2e2",
            color: "#991b1b",
            border: "1px solid #fecaca",
            "font-size": "14px",
          }}
        >
          ⚠️ {error()}
        </div>
      </Show>

      {/* Sync Status */}
      <div style={{ display: "flex", "justify-content": "center" }}>
        <SyncStatusComponent
          status={status()}
          showText={true}
          showProgress={true}
          itemsSynced={itemsSynced()}
          totalItems={totalItems()}
        />
      </div>

      {/* Progress Bar */}
      <Show when={status() === SyncStatus.InProgress}>
        <SyncProgressComponent
          progress={progress()}
          itemsSynced={itemsSynced()}
          totalItems={totalItems()}
          currentBatch={currentBatch()}
          totalBatches={totalBatches()}
          estimatedRemainingSeconds={eta()}
          showBatchInfo={true}
          showETA={true}
          showItemCount={true}
          animated={true}
        />
      </Show>

      {/* Media Blob Sync Controls */}
      <Show when={syncManager()}>
        <div>
          <h3
            style={{
              margin: "0 0 12px 0",
              "font-size": "16px",
              color: "#374151",
            }}
          >
            📁 Media Blob Sync
          </h3>
          <SyncControlsComponent
            status={status()}
            disabled={!isConnected()}
            showForceSync={true}
            showPauseResume={true}
            compact={false}
            onStartSync={handleStartSync}
            onStopSync={handleStopSync}
            onPauseSync={handlePauseSync}
            onResumeSync={handleResumeSync}
            onForceSync={handleForceSync}
          />
        </div>
      </Show>

      {/* Integrated Sync Section */}
      <Show when={integratedSyncManager()}>
        <div
          style={{
            padding: "16px",
            "border-radius": "8px",
            "background-color": "#f8fafc",
            border: "1px solid #e2e8f0",
          }}
        >
          <h3
            style={{
              margin: "0 0 12px 0",
              "font-size": "16px",
              color: "#374151",
            }}
          >
            🎵📸 Integrated Sync (Music + Binary)
          </h3>

          {/* Integrated Progress */}
          <Show when={integratedProgress()}>
            <div style={{ "margin-bottom": "12px" }}>
              <div
                style={{
                  display: "flex",
                  "justify-content": "space-between",
                  "align-items": "center",
                  "margin-bottom": "4px",
                }}
              >
                <span style={{ "font-size": "12px", color: "#6b7280" }}>
                  Overall: {integratedProgress()?.overallStatus}
                </span>
                <span style={{ "font-size": "12px", color: "#6b7280" }}>
                  {Math.round(integratedProgress()?.combinedProgress || 0)}%
                </span>
              </div>
              <div
                style={{
                  width: "100%",
                  height: "6px",
                  "background-color": "#e2e8f0",
                  "border-radius": "3px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    "background-color": "#3b82f6",
                    width: `${integratedProgress()?.combinedProgress || 0}%`,
                    transition: "width 0.3s ease",
                  }}
                />
              </div>

              {/* Sub-progress bars */}
              <div style={{ "margin-top": "8px", "font-size": "11px" }}>
                <div style={{ "margin-bottom": "2px" }}>
                  Music: {integratedProgress()?.musicSync.status}(
                  {integratedProgress()?.musicSync.totalItemsSynced || 0} items)
                </div>
                <div>
                  Binary: {integratedProgress()?.binarySync.status}(
                  {integratedProgress()?.binarySync.thumbnailsCached || 0}{" "}
                  cached,
                  {Math.round(
                    (integratedProgress()?.binarySync.bytesCached || 0) / 1024
                  )}
                  KB)
                </div>
              </div>
            </div>
          </Show>

          {/* Binary Cache Stats */}
          <Show when={binaryStats()}>
            <div
              style={{
                display: "grid",
                "grid-template-columns": "repeat(auto-fit, minmax(80px, 1fr))",
                gap: "8px",
                "margin-bottom": "12px",
              }}
            >
              <div
                style={{
                  "text-align": "center",
                  padding: "8px",
                  "background-color": "#ffffff",
                  "border-radius": "4px",
                }}
              >
                <div
                  style={{
                    "font-size": "18px",
                    "font-weight": "bold",
                    color: "#3b82f6",
                  }}
                >
                  {binaryStats()?.totalItems || 0}
                </div>
                <div style={{ "font-size": "10px", color: "#6b7280" }}>
                  Cached
                </div>
              </div>
              <div
                style={{
                  "text-align": "center",
                  padding: "8px",
                  "background-color": "#ffffff",
                  "border-radius": "4px",
                }}
              >
                <div
                  style={{
                    "font-size": "18px",
                    "font-weight": "bold",
                    color: "#10b981",
                  }}
                >
                  {Math.round((binaryStats()?.totalSize || 0) / 1024)}KB
                </div>
                <div style={{ "font-size": "10px", color: "#6b7280" }}>
                  Size
                </div>
              </div>
              <div
                style={{
                  "text-align": "center",
                  padding: "8px",
                  "background-color": "#ffffff",
                  "border-radius": "4px",
                }}
              >
                <div
                  style={{
                    "font-size": "18px",
                    "font-weight": "bold",
                    color: "#f59e0b",
                  }}
                >
                  {Math.round((binaryStats()?.hitRate || 0) * 100)}%
                </div>
                <div style={{ "font-size": "10px", color: "#6b7280" }}>
                  Hit Rate
                </div>
              </div>
            </div>
          </Show>

          {/* Integrated Sync Controls */}
          <div
            style={{
              display: "flex",
              gap: "8px",
              "flex-wrap": "wrap",
            }}
          >
            <button
              onClick={handleStartSync}
              disabled={
                !isConnected() || integratedStatus() === SyncStatus.InProgress
              }
              style={{
                padding: "8px 12px",
                "border-radius": "6px",
                border: "1px solid #3b82f6",
                "background-color": "#3b82f6",
                color: "#ffffff",
                "font-size": "12px",
                "font-weight": "500",
                cursor:
                  integratedStatus() === SyncStatus.InProgress
                    ? "not-allowed"
                    : "pointer",
                opacity: integratedStatus() === SyncStatus.InProgress ? 0.6 : 1,
              }}
            >
              Sync All (Music + Binary)
            </button>
            <button
              onClick={handleBinarySync}
              disabled={
                !isConnected() || integratedStatus() === SyncStatus.InProgress
              }
              style={{
                padding: "8px 12px",
                "border-radius": "6px",
                border: "1px solid #8b5cf6",
                "background-color": "#8b5cf6",
                color: "#ffffff",
                "font-size": "12px",
                "font-weight": "500",
                cursor:
                  integratedStatus() === SyncStatus.InProgress
                    ? "not-allowed"
                    : "pointer",
                opacity: integratedStatus() === SyncStatus.InProgress ? 0.6 : 1,
              }}
            >
              Binary Sync Only
            </button>
            <button
              onClick={handleRequestThumbnails}
              disabled={
                !isConnected() || integratedStatus() === SyncStatus.InProgress
              }
              style={{
                padding: "8px 12px",
                "border-radius": "6px",
                border: "1px solid #f59e0b",
                "background-color": "#f59e0b",
                color: "#ffffff",
                "font-size": "12px",
                "font-weight": "500",
                cursor:
                  integratedStatus() === SyncStatus.InProgress
                    ? "not-allowed"
                    : "pointer",
                opacity: integratedStatus() === SyncStatus.InProgress ? 0.6 : 1,
              }}
            >
              Request Thumbnails
            </button>
            <button
              onClick={updateIntegratedStats}
              style={{
                padding: "8px 12px",
                "border-radius": "6px",
                border: "1px solid #6b7280",
                "background-color": "#ffffff",
                color: "#6b7280",
                "font-size": "12px",
                "font-weight": "500",
                cursor: "pointer",
              }}
            >
              Refresh Stats
            </button>
            <button
              onClick={handleUploadTestFile}
              style={{
                padding: "8px 12px",
                "border-radius": "6px",
                border: "1px solid #ef4444",
                "background-color": "#ef4444",
                color: "#ffffff",
                "font-size": "12px",
                "font-weight": "500",
                cursor: "pointer",
              }}
            >
              Upload Test File
            </button>
          </div>
        </div>
      </Show>

      {/* Activity Logs */}
      <div>
        <div
          style={{
            display: "flex",
            "justify-content": "space-between",
            "align-items": "center",
            "margin-bottom": "8px",
          }}
        >
          <h3 style={{ margin: "0", "font-size": "16px", color: "#374151" }}>
            Activity Log
          </h3>
          <button
            onClick={clearLogs}
            style={{
              padding: "4px 8px",
              "border-radius": "4px",
              border: "1px solid #d1d5db",
              "background-color": "#ffffff",
              color: "#6b7280",
              "font-size": "12px",
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        </div>
        <div class="logs-container">
          <Show
            when={logs().length > 0}
            fallback={
              <div style={{ color: "#9ca3af", "font-style": "italic" }}>
                No activity yet...
              </div>
            }
          >
            <For each={logs()}>
              {(log) => <div style={{ "margin-bottom": "2px" }}>{log}</div>}
            </For>
          </Show>
        </div>
      </div>
    </div>
  );
}

customElement(
  "sync-demo",
  {
    apiBaseUrl: "http://localhost:8080",
    clientId: crypto.randomUUID(),
    autoConnect: true,
    className: "",
    enableMusicSync: true,
  },
  SyncDemoComponent
);

export default SyncDemoComponent;
