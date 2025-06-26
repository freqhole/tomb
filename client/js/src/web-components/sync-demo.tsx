/**
 * Sync Demo Web Component
 *
 * A complete demo component that integrates all sync UI components
 * with a working sync manager for end-to-end testing.
 */

/* @jsxImportSource solid-js */
import { customElement } from "solid-element";
import { createSignal, createEffect, onMount, onCleanup, Show } from "solid-js";
import { ApiClient } from "../lib/api-client.js";
import {
  createSyncManager,
  SyncEventType,
  SyncStatus,
  type SyncManager,
} from "../sync/index.js";
import SyncStatusComponent from "./sync-status.js";
import SyncProgressComponent from "./sync-progress.js";
import SyncControlsComponent from "./sync-controls.js";

export interface SyncDemoProps {
  apiBaseUrl?: string;
  clientId?: string;
  autoConnect?: boolean;
  className?: string;
}

function SyncDemoComponent(props: SyncDemoProps) {
  const [syncManager, setSyncManager] = createSignal<SyncManager | null>(null);
  const [status, setStatus] = createSignal<SyncStatus>(SyncStatus.Never);
  const [progress, setProgress] = createSignal<number>(0);
  const [itemsSynced, setItemsSynced] = createSignal<number>(0);
  const [totalItems, setTotalItems] = createSignal<number>(0);
  const [currentBatch, setCurrentBatch] = createSignal<number>(0);
  const [totalBatches, setTotalBatches] = createSignal<number>(0);
  const [eta, setEta] = createSignal<number>(0);
  const [isConnected, setIsConnected] = createSignal<boolean>(false);
  const [error, setError] = createSignal<string | null>(null);
  const [logs, setLogs] = createSignal<string[]>([]);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-9), `[${timestamp}] ${message}`]);
  };

  const initializeSyncManager = async () => {
    try {
      const apiClient = new ApiClient({
        baseUrl: props.apiBaseUrl || "http://localhost:8080",
      });

      const manager = createSyncManager(
        apiClient,
        props.clientId || `demo-client-${Date.now()}`,
        {
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
        }
      );

      // Set up event listeners
      manager.on(SyncEventType.SyncStarted, (event: any) => {
        setStatus(SyncStatus.InProgress);
        addLog(`Sync started: ${event.isFullSync ? "Full" : "Incremental"}`);
        if (event.estimatedItems) {
          setTotalItems(event.estimatedItems);
        }
      });

      manager.on(SyncEventType.SyncProgress, (event: any) => {
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

      manager.on(SyncEventType.SyncCompleted, (event: any) => {
        setStatus(SyncStatus.Idle);
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

      manager.on(SyncEventType.SyncFailed, (event: any) => {
        setStatus(SyncStatus.Failed);
        setError(event.error.message);
        addLog(`Sync failed: ${event.error.message}`);
      });

      manager.on(SyncEventType.SyncBatchCompleted, (event: any) => {
        addLog(
          `Batch ${event.batchNumber} completed: ${event.itemsInBatch} items`
        );
      });

      manager.on(SyncEventType.ConnectionChanged, (event: any) => {
        setIsConnected(event.isOnline);
        addLog(`Connection: ${event.isOnline ? "Online" : "Offline"}`);
      });

      manager.on(SyncEventType.SyncConflict, (event: any) => {
        addLog(
          `Conflict detected: ${event.conflict.id} (${event.conflict.type})`
        );
      });

      await manager.initialize();
      setSyncManager(manager);
      setIsConnected(true);
      setStatus(SyncStatus.Idle);
      addLog("Sync manager initialized");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      addLog(`Initialization failed: ${errorMessage}`);
    }
  };

  const handleStartSync = async () => {
    const manager = syncManager();
    if (!manager) return;

    try {
      setError(null);
      await manager.sync({ force: false });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Sync failed";
      setError(errorMessage);
      addLog(`Sync error: ${errorMessage}`);
    }
  };

  const handleStopSync = async () => {
    const manager = syncManager();
    if (!manager) return;

    try {
      await manager.stopSync();
      setStatus(SyncStatus.Idle);
      addLog("Sync stopped");
    } catch (err) {
      addLog(
        `Stop sync error: ${err instanceof Error ? err.message : "Unknown error"}`
      );
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
    if (!manager) return;

    try {
      setError(null);
      await manager.sync({ force: true });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Force sync failed";
      setError(errorMessage);
      addLog(`Force sync error: ${errorMessage}`);
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
    if (manager) {
      await manager.cleanup();
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

      {/* Controls */}
      <Show when={syncManager()}>
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
            {logs().map((log, index) => (
              <div key={index} style={{ "margin-bottom": "2px" }}>
                {log}
              </div>
            ))}
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
    clientId: undefined,
    autoConnect: true,
    className: "",
  },
  SyncDemoComponent
);

export default SyncDemoComponent;
