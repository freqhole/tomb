/**
 * Sync Progress Bar Web Component
 *
 * A detailed progress bar component for sync operations with
 * visual progress, ETA, and batch information.
 */

/* @jsxImportSource solid-js */
import { customElement } from "solid-element";
import { createSignal, createEffect, Show } from "solid-js";

export interface SyncProgressProps {
  progress?: number; // 0-100
  itemsSynced?: number;
  totalItems?: number;
  currentBatch?: number;
  totalBatches?: number;
  estimatedRemainingSeconds?: number;
  showBatchInfo?: boolean;
  showETA?: boolean;
  showItemCount?: boolean;
  animated?: boolean;
  className?: string;
}

function SyncProgressComponent(props: SyncProgressProps) {
  const [progress, setProgress] = createSignal<number>(props.progress || 0);
  const [itemsSynced, setItemsSynced] = createSignal<number>(props.itemsSynced || 0);
  const [totalItems, setTotalItems] = createSignal<number>(props.totalItems || 0);
  const [currentBatch, setCurrentBatch] = createSignal<number>(props.currentBatch || 0);
  const [totalBatches, setTotalBatches] = createSignal<number>(props.totalBatches || 0);
  const [eta, setEta] = createSignal<number>(props.estimatedRemainingSeconds || 0);

  createEffect(() => {
    if (props.progress !== undefined) {
      setProgress(Math.max(0, Math.min(100, props.progress)));
    }
  });

  createEffect(() => {
    if (props.itemsSynced !== undefined) {
      setItemsSynced(props.itemsSynced);
    }
  });

  createEffect(() => {
    if (props.totalItems !== undefined) {
      setTotalItems(props.totalItems);
    }
  });

  createEffect(() => {
    if (props.currentBatch !== undefined) {
      setCurrentBatch(props.currentBatch);
    }
  });

  createEffect(() => {
    if (props.totalBatches !== undefined) {
      setTotalBatches(props.totalBatches);
    }
  });

  createEffect(() => {
    if (props.estimatedRemainingSeconds !== undefined) {
      setEta(props.estimatedRemainingSeconds);
    }
  });

  const formatETA = () => {
    const seconds = eta();
    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = Math.round(seconds % 60);
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    }
  };

  const getProgressColor = () => {
    if (progress() < 30) return "#ef4444"; // red
    if (progress() < 70) return "#f59e0b"; // amber
    return "#10b981"; // green
  };

  return (
    <div
      class={`sync-progress ${props.className || ""}`}
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "8px",
        padding: "12px",
        "border-radius": "8px",
        "background-color": "#f8fafc",
        border: "1px solid #e2e8f0",
        "font-family": "system-ui, -apple-system, sans-serif",
        "font-size": "14px",
        "min-width": "250px",
      }}
    >
      <style>{`
        .sync-progress .progress-bar {
          width: 100%;
          height: 8px;
          background-color: #e2e8f0;
          border-radius: 4px;
          overflow: hidden;
          position: relative;
        }
        .sync-progress .progress-fill {
          height: 100%;
          background-color: ${getProgressColor()};
          border-radius: 4px;
          transition: width 0.3s ease;
          position: relative;
        }
        .sync-progress .progress-fill.animated::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.4),
            transparent
          );
          animation: shimmer 1.5s infinite;
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .sync-progress .info-grid {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          align-items: center;
        }
        .sync-progress .stat {
          display: flex;
          align-items: center;
          gap: 4px;
          color: #6b7280;
          font-size: 12px;
        }
        .sync-progress .stat-value {
          font-weight: 600;
          color: #374151;
        }
      `}</style>

      {/* Main progress bar */}
      <div class="progress-bar">
        <div
          class={`progress-fill ${props.animated ? "animated" : ""}`}
          style={{ width: `${progress()}%` }}
        />
      </div>

      {/* Progress percentage */}
      <div class="info-grid">
        <div
          style={{
            "font-weight": "600",
            color: "#374151",
            "font-size": "16px",
          }}
        >
          {Math.round(progress())}%
        </div>

        <Show when={props.showETA && eta() > 0}>
          <div class="stat">
            <span>ETA:</span>
            <span class="stat-value">{formatETA()}</span>
          </div>
        </Show>
      </div>

      {/* Additional info */}
      <div class="info-grid">
        <Show when={props.showItemCount && totalItems() > 0}>
          <div class="stat">
            <span>Items:</span>
            <span class="stat-value">
              {itemsSynced().toLocaleString()} / {totalItems().toLocaleString()}
            </span>
          </div>
        </Show>

        <Show when={props.showBatchInfo && totalBatches() > 0}>
          <div class="stat">
            <span>Batch:</span>
            <span class="stat-value">
              {currentBatch()} / {totalBatches()}
            </span>
          </div>
        </Show>
      </div>
    </div>
  );
}

customElement("sync-progress", {
  progress: 0,
  itemsSynced: 0,
  totalItems: 0,
  currentBatch: 0,
  totalBatches: 0,
  estimatedRemainingSeconds: 0,
  showBatchInfo: true,
  showETA: true,
  showItemCount: true,
  animated: true,
  className: "",
}, SyncProgressComponent);

export default SyncProgressComponent;
