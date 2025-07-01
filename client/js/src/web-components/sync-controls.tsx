/**
 * Sync Control Panel Web Component
 *
 * A control panel for managing sync operations with buttons for
 * start, stop, pause, resume, and force sync actions.
 */

/* @jsxImportSource solid-js */
import { customElement } from "solid-element";
import { createSignal, createEffect, Show } from "solid-js";
import { SyncStatus } from "../sync-legacy/index.js";
import type { SyncStatus as SyncStatusType } from "../sync-legacy/index.js";

export interface SyncControlsProps {
  status?: SyncStatusType;
  disabled?: boolean;
  showForceSync?: boolean;
  showPauseResume?: boolean;
  compact?: boolean;
  className?: string;
  onStartSync?: () => void;
  onStopSync?: () => void;
  onPauseSync?: () => void;
  onResumeSync?: () => void;
  onForceSync?: () => void;
}

function SyncControlsComponent(props: SyncControlsProps) {
  const [status, setStatus] = createSignal<SyncStatusType>(
    props.status || SyncStatus.Never
  );
  const [isPaused, setIsPaused] = createSignal<boolean>(false);

  createEffect(() => {
    if (props.status !== undefined) {
      setStatus(props.status);
    }
  });

  const isInProgress = () => status() === SyncStatus.InProgress;
  const canStart = () => !isInProgress() && !props.disabled;
  const canStop = () => isInProgress() && !props.disabled;
  const canPause = () => isInProgress() && !isPaused() && !props.disabled;
  const canResume = () => isInProgress() && isPaused() && !props.disabled;
  const canForceSync = () => !isInProgress() && !props.disabled;

  const handleStartSync = () => {
    if (canStart() && props.onStartSync) {
      props.onStartSync();
    }
  };

  const handleStopSync = () => {
    if (canStop() && props.onStopSync) {
      props.onStopSync();
    }
  };

  const handlePauseSync = () => {
    if (canPause() && props.onPauseSync) {
      setIsPaused(true);
      props.onPauseSync();
    }
  };

  const handleResumeSync = () => {
    if (canResume() && props.onResumeSync) {
      setIsPaused(false);
      props.onResumeSync();
    }
  };

  const handleForceSync = () => {
    if (canForceSync() && props.onForceSync) {
      props.onForceSync();
    }
  };

  const buttonStyle = (
    enabled: boolean,
    variant: "primary" | "secondary" | "danger" = "secondary"
  ) => ({
    padding: props.compact ? "6px 12px" : "8px 16px",
    "border-radius": "6px",
    border: "1px solid",
    "font-size": props.compact ? "12px" : "14px",
    "font-weight": "500",
    cursor: enabled ? "pointer" : "not-allowed",
    transition: "all 0.2s ease",
    "background-color": enabled
      ? variant === "primary"
        ? "#3b82f6"
        : variant === "danger"
          ? "#ef4444"
          : "#ffffff"
      : "#f3f4f6",
    color: enabled
      ? variant === "primary" || variant === "danger"
        ? "#ffffff"
        : "#374151"
      : "#9ca3af",
    "border-color": enabled
      ? variant === "primary"
        ? "#3b82f6"
        : variant === "danger"
          ? "#ef4444"
          : "#d1d5db"
      : "#d1d5db",
  });

  return (
    <div
      class={`sync-controls ${props.compact ? "compact" : ""} ${props.className || ""}`}
      style={{
        display: "flex",
        gap: props.compact ? "6px" : "8px",
        "align-items": "center",
        padding: props.compact ? "8px" : "12px",
        "border-radius": "8px",
        "background-color": "#f8fafc",
        border: "1px solid #e2e8f0",
        "font-family": "system-ui, -apple-system, sans-serif",
      }}
    >
      <style>{`
        .sync-controls button:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        .sync-controls button:active:not(:disabled) {
          transform: translateY(0);
        }
        .sync-controls button:disabled {
          opacity: 0.6;
        }
      `}</style>

      {/* Start/Resume button */}
      <Show when={!isInProgress() || isPaused()}>
        <button
          onClick={isPaused() ? handleResumeSync : handleStartSync}
          disabled={!canStart() && !canResume()}
          style={buttonStyle(canStart() || canResume(), "primary")}
        >
          {isPaused() ? "▶ Resume" : "▶ Start Sync"}
        </button>
      </Show>

      {/* Pause button */}
      <Show when={props.showPauseResume && isInProgress() && !isPaused()}>
        <button
          onClick={handlePauseSync}
          disabled={!canPause()}
          style={buttonStyle(canPause())}
        >
          ⏸ Pause
        </button>
      </Show>

      {/* Stop button */}
      <Show when={isInProgress()}>
        <button
          onClick={handleStopSync}
          disabled={!canStop()}
          style={buttonStyle(canStop(), "danger")}
        >
          ⏹ Stop
        </button>
      </Show>

      {/* Force sync button */}
      <Show when={props.showForceSync && !isInProgress()}>
        <button
          onClick={handleForceSync}
          disabled={!canForceSync()}
          style={buttonStyle(canForceSync())}
          title="Force a full sync, ignoring cache"
        >
          🔄 Force Sync
        </button>
      </Show>

      {/* Status indicator */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "4px",
          "margin-left": "auto",
          "font-size": props.compact ? "11px" : "12px",
          color: "#6b7280",
        }}
      >
        <span
          style={{
            width: "8px",
            height: "8px",
            "border-radius": "50%",
            "background-color":
              status() === SyncStatus.InProgress
                ? "#f59e0b"
                : status() === SyncStatus.Complete
                  ? "#10b981"
                  : status() === SyncStatus.Failed
                    ? "#ef4444"
                    : "#94a3b8",
          }}
        />
        <span>
          {status() === SyncStatus.InProgress
            ? isPaused()
              ? "Paused"
              : "Syncing"
            : status() === SyncStatus.Complete
              ? "Ready"
              : status() === SyncStatus.Failed
                ? "Error"
                : "Not synced"}
        </span>
      </div>
    </div>
  );
}

customElement(
  "sync-controls",
  {
    status: undefined,
    disabled: false,
    showForceSync: true,
    showPauseResume: true,
    compact: false,
    className: "",
    onStartSync: undefined,
    onStopSync: undefined,
    onPauseSync: undefined,
    onResumeSync: undefined,
    onForceSync: undefined,
  },
  SyncControlsComponent
);

export default SyncControlsComponent;
