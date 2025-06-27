/**
 * Feed Controls Component
 *
 * A reusable component that provides controls and statistics for the media feed.
 * Includes refresh controls, display mode toggles, and feed statistics.
 */

/* @jsxImportSource solid-js */
import { Show, createMemo } from "solid-js";

export interface FeedControlsProps {
  totalCount: number;
  subscribedChannels: string[];
  lastUpdated: Date | null;
  isLoading?: boolean;
  mode?: "default" | "compact" | "detailed";
  onModeChange?: (mode: "default" | "compact" | "detailed") => void;
  onRefresh?: () => void;
  showStats?: boolean;
  showModeToggle?: boolean;
  className?: string;
}

export function FeedControlsComponent(props: FeedControlsProps) {
  const formatLastUpdated = createMemo(() => {
    if (!props.lastUpdated) return "Never";

    const now = new Date();
    const diff = now.getTime() - props.lastUpdated.getTime();

    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return props.lastUpdated.toLocaleDateString();
  });

  const containerStyles = () => ({
    display: "flex",
    "align-items": "center",
    "justify-content": "space-between",
    padding: "8px 12px",
    "background-color": "#f8fafc",
    border: "1px solid #e2e8f0",
    "border-radius": "6px",
    "font-size": "12px",
    color: "#64748b",
    gap: "12px",
    "flex-wrap": "wrap" as const,
  });

  const statsStyles = () => ({
    display: "flex",
    "align-items": "center",
    gap: "12px",
    "font-size": "12px",
  });

  const controlsStyles = () => ({
    display: "flex",
    "align-items": "center",
    gap: "8px",
  });

  const buttonStyles = (active = false) => ({
    padding: "4px 8px",
    "font-size": "11px",
    "font-weight": "500",
    border: "1px solid",
    "border-radius": "4px",
    cursor: "pointer",
    transition: "all 0.2s ease",
    "background-color": active ? "#3b82f6" : "white",
    "border-color": active ? "#3b82f6" : "#e2e8f0",
    color: active ? "white" : "#64748b",
  });

  const refreshButtonStyles = () => ({
    padding: "4px 8px",
    "font-size": "11px",
    "font-weight": "500",
    border: "1px solid #e2e8f0",
    "border-radius": "4px",
    cursor: props.isLoading ? "not-allowed" : "pointer",
    transition: "all 0.2s ease",
    "background-color": "white",
    color: "#64748b",
    opacity: props.isLoading ? 0.5 : 1,
    display: "flex",
    "align-items": "center",
    gap: "4px",
  });

  const handleModeChange = (mode: "default" | "compact" | "detailed") => {
    if (props.onModeChange) {
      props.onModeChange(mode);
    }
  };

  const handleRefresh = () => {
    if (props.onRefresh && !props.isLoading) {
      props.onRefresh();
    }
  };

  return (
    <div class={props.className} style={containerStyles()}>
      {/* Stats Section */}
      <Show when={props.showStats !== false}>
        <div style={statsStyles()}>
          <span title="Total items in feed">📊 {props.totalCount} items</span>

          <Show when={props.subscribedChannels.length > 0}>
            <span title="Subscribed notification channels">
              📡 {props.subscribedChannels.join(", ")}
            </span>
          </Show>

          <span title="Last updated time">🕒 {formatLastUpdated()}</span>
        </div>
      </Show>

      {/* Controls Section */}
      <div style={controlsStyles()}>
        {/* Refresh Button */}
        <Show when={props.onRefresh}>
          <button
            onClick={handleRefresh}
            disabled={props.isLoading}
            style={refreshButtonStyles()}
            title="Refresh feed data"
          >
            <span
              style={{
                transform: props.isLoading ? "rotate(360deg)" : "none",
                transition: "transform 1s linear",
                display: "inline-block",
              }}
            >
              🔄
            </span>
            Refresh
          </button>
        </Show>

        {/* Mode Toggle */}
        <Show when={props.showModeToggle !== false && props.onModeChange}>
          <div style={{ display: "flex", gap: "2px" }}>
            <button
              onClick={() => handleModeChange("compact")}
              style={buttonStyles(props.mode === "compact")}
              title="Compact view"
            >
              ≡
            </button>
            <button
              onClick={() => handleModeChange("default")}
              style={buttonStyles(props.mode === "default")}
              title="Default view"
            >
              ⊞
            </button>
            <button
              onClick={() => handleModeChange("detailed")}
              style={buttonStyles(props.mode === "detailed")}
              title="Detailed view"
            >
              ☰
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}

export default FeedControlsComponent;
