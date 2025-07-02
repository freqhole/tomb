/**
 * Sync Status Indicator Web Component
 *
 * A minimal web component that displays the current sync status
 * with a colored indicator and optional text/progress information.
 */

/* @jsxImportSource solid-js */
import { customElement } from "solid-element";
import { createSignal, createEffect, Show } from "solid-js";
import { SyncStatus } from "../sync/index.js";
import type { SyncStatus as SyncStatusType } from "../sync/index.js";

export interface SyncStatusProps {
  status?: SyncStatusType;
  showText?: boolean;
  showProgress?: boolean;
  itemsSynced?: number;
  totalItems?: number;
  compact?: boolean;
  className?: string;
}

function SyncStatusComponent(props: SyncStatusProps) {
  const [status, setStatus] = createSignal<SyncStatusType>(
    props.status || SyncStatus.Never
  );
  const [itemsSynced, setItemsSynced] = createSignal<number>(
    props.itemsSynced || 0
  );
  const [totalItems, setTotalItems] = createSignal<number>(
    props.totalItems || 0
  );

  createEffect(() => {
    if (props.status !== undefined) {
      setStatus(props.status);
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

  const getStatusColor = () => {
    switch (status()) {
      case SyncStatus.Never:
        return "#94a3b8"; // gray
      case SyncStatus.Complete:
        return "#10b981"; // green
      case SyncStatus.InProgress:
        return "#f59e0b"; // amber
      case SyncStatus.Failed:
        return "#ef4444"; // red
      case SyncStatus.Paused:
        return "#8b5cf6"; // purple
      default:
        return "#94a3b8";
    }
  };

  const getStatusText = () => {
    switch (status()) {
      case SyncStatus.Never:
        return "Not synced";
      case SyncStatus.Complete:
        return "Up to date";
      case SyncStatus.InProgress:
        return "Syncing...";
      case SyncStatus.Failed:
        return "Sync failed";
      case SyncStatus.Paused:
        return "Paused";
      default:
        return "Unknown";
    }
  };

  const getStatusIcon = () => {
    switch (status()) {
      case SyncStatus.Never:
        return "○";
      case SyncStatus.Complete:
        return "✓";
      case SyncStatus.InProgress:
        return "⟳";
      case SyncStatus.Failed:
        return "⚠";
      case SyncStatus.Paused:
        return "⏸";
      default:
        return "○";
    }
  };

  const progressPercentage = () => {
    if (totalItems() === 0) return 0;
    return Math.round((itemsSynced() / totalItems()) * 100);
  };

  return (
    <div
      class={`sync-status ${props.compact ? "compact" : ""} ${props.className || ""}`}
      style={{
        display: "inline-flex",
        "align-items": "center",
        gap: props.compact ? "4px" : "8px",
        padding: props.compact ? "4px 8px" : "8px 12px",
        "border-radius": "6px",
        "background-color": "#f8fafc",
        border: `1px solid ${getStatusColor()}20`,
        "font-family": "system-ui, -apple-system, sans-serif",
        "font-size": props.compact ? "12px" : "14px",
      }}
    >
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .sync-status .status-icon.spinning {
          animation: spin 1s linear infinite;
        }
        .sync-status .progress-bar {
          background-color: #e2e8f0;
          border-radius: 4px;
          overflow: hidden;
          height: 4px;
        }
        .sync-status .progress-fill {
          height: 100%;
          background-color: ${getStatusColor()};
          transition: width 0.3s ease;
          border-radius: 4px;
        }
      `}</style>

      <span
        class={`status-icon ${status() === SyncStatus.InProgress ? "spinning" : ""}`}
        style={{
          color: getStatusColor(),
          "font-weight": "bold",
          "font-size": props.compact ? "14px" : "16px",
        }}
      >
        {getStatusIcon()}
      </span>

      <Show when={props.showText !== false}>
        <span
          style={{
            color: "#374151",
            "font-weight": "500",
          }}
        >
          {getStatusText()}
        </span>
      </Show>

      <Show
        when={
          props.showProgress &&
          status() === SyncStatus.InProgress &&
          totalItems() > 0
        }
      >
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "4px",
            "min-width": "80px",
          }}
        >
          <div class="progress-bar" style={{ width: "80px" }}>
            <div
              class="progress-fill"
              style={{ width: `${progressPercentage()}%` }}
            />
          </div>
          <span
            style={{
              "font-size": "11px",
              color: "#6b7280",
              "text-align": "center",
            }}
          >
            {itemsSynced()}/{totalItems()} ({progressPercentage()}%)
          </span>
        </div>
      </Show>
    </div>
  );
}

customElement(
  "sync-status",
  {
    status: undefined,
    showText: true,
    showProgress: false,
    itemsSynced: 0,
    totalItems: 0,
    compact: false,
    className: "",
  },
  SyncStatusComponent
);

export default SyncStatusComponent;
