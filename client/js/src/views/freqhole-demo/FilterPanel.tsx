import { createSignal, Show, For } from "solid-js";
import type { FilterConfig, GridViewMode, ColumnVisibility } from "./types";
import { ResizeHandle } from "./ResizeHandle";
import { useResize } from "./hooks/useResize";
import { ColumnManager } from "./components/ColumnManager";

export interface FilterPanelProps {
  isOpen: boolean;
  filterConfig: FilterConfig;
  viewMode: GridViewMode;
  columnVisibility: ColumnVisibility;
  wsUrl: string;
  autoConnect: boolean;
  autoRefresh: boolean;
  debug: boolean;
  connectionStatus: string;
  hasPendingUpdates: boolean;
  pendingUpdatesCount: number;
  filteredCount: number;
  totalCount: number;
  sortConfig: { field: string; direction: string };
  lastUpdated: Date | null;
  mimeCategories: string[];
  blobTypes: string[];
  logs: string[];
  onTogglePanel: () => void;
  onFilterChange: (key: keyof FilterConfig, value: any) => void;
  onViewModeChange: (mode: GridViewMode) => void;
  onColumnToggle: (column: keyof ColumnVisibility) => void;
  onWsUrlChange: (url: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
  onApplyPendingUpdates: () => void;
  onToggleAutoConnect: () => void;
  onToggleAutoRefresh: () => void;
  onToggleDebug: () => void;
  onReset: () => void;
  onWidthChange: (width: number) => void;
  initialWidth: number;
}

export function FilterPanel(props: FilterPanelProps) {
  const [showColumnSettings, setShowColumnSettings] = createSignal(false);

  const resize = useResize({
    initialWidth: props.initialWidth,
    minWidth: 250,
    maxWidth: 600,
    closeThreshold: 100,
    onWidthChange: props.onWidthChange,
    onClose: props.onTogglePanel,
  });

  const getConnectionStatusStyle = (status: string) => {
    const statusColors: Record<string, string> = {
      Connected: "color: #10b981;",
      Connecting: "color: #f59e0b;",
      Disconnected: "color: #ef4444;",
      Error: "color: #ef4444;",
    };
    return statusColors[status] || "color: #6b7280;";
  };

  return (
    <div
      class={`filter-panel ${!props.isOpen ? "collapsed" : ""} ${
        resize.isDragging() ? "resizing" : ""
      }`}
      style={`
        width: ${props.isOpen ? resize.width() + "px" : "0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-left: 1px solid #3a3a3a;
        padding: ${props.isOpen ? "20px" : "0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
      `}
    >
      {/* Sticky Header Bar */}
      <div
        style={`
          position: sticky;
          top: 0;
          background: #1a1a1a;
          border-bottom: 1px solid #3a3a3a;
          height: 60px;
          padding: 0 16px;
          margin: -20px -20px 20px -20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          z-index: 10;
        `}
      >
        <h3 style="margin: 0; font-size: 14px; color: #ffffff; font-weight: 600;">
          Controls
        </h3>
        <button
          onClick={props.onTogglePanel}
          title="Close panel"
          style={`
            background: transparent;
            border: none;
            color: #888;
            cursor: pointer;
            font-size: 16px;
            padding: 4px;
            border-radius: 4px;
            transition: all 0.2s;
            line-height: 1;
          `}
        >
          ×
        </button>
      </div>

      {props.isOpen && (
        <div style="overflow-y: auto; height: calc(100vh - 120px); min-width: 0; overflow-x: hidden;">
          {/* WebSocket Connection */}
          <div class="filter-section" style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #e0e0e0;">
              🔌 WebSocket Connection
            </h3>
            <input
              class="filter-input"
              type="text"
              placeholder="WebSocket URL"
              value={props.wsUrl}
              onInput={(e) => props.onWsUrlChange(e.currentTarget.value)}
              style={`
            width: 100%;
            padding: 8px;
            background: #000000;
            border: 1px solid #3a3a3a;
            border-radius: 4px;
            color: #ffffff;
            font-size: 14px;
            margin-bottom: 8px;
            box-sizing: border-box;
            min-width: 0;
          `}
            />
            <div style="margin-bottom: 8px; font-size: 14px;">
              Status:{" "}
              <span style={getConnectionStatusStyle(props.connectionStatus)}>
                {props.connectionStatus}
              </span>
            </div>
            <div style="margin-bottom: 24px; min-width: 0;">
              <button
                class="ws-button"
                onClick={props.onConnect}
                disabled={props.connectionStatus === "Connected"}
                style={`
              background: #ff00ff;
              border: 1px solid #ff00ff;
              color: #000000;
              padding: 6px 12px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              margin-right: 8px;
              transition: background-color 0.2s;
            `}
              >
                Connect
              </button>
              <button
                class="ws-button danger"
                onClick={props.onDisconnect}
                disabled={props.connectionStatus === "Disconnected"}
                style={`
              background: #666666;
              border: 1px solid #666666;
              color: #ffffff;
              padding: 6px 12px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: background-color 0.2s;
            `}
              >
                Disconnect
              </button>
            </div>
            <div style="display: flex; gap: 8px; align-items: center; font-size: 12px;">
              Auto-connect:
              <button
                class={`toggle-button ${props.autoConnect ? "active" : ""}`}
                onClick={props.onToggleAutoConnect}
                style={`
              background: ${props.autoConnect ? "#ff00ff" : "#333333"};
              border: 1px solid ${props.autoConnect ? "#ff00ff" : "#666666"};
              color: ${props.autoConnect ? "#000000" : "#ffffff"};
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.2s;
            `}
              >
                {props.autoConnect ? "ON" : "OFF"}
              </button>
            </div>
          </div>

          {/* Auto-refresh */}
          <div class="filter-section" style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #e0e0e0;">
              🔄 Auto-refresh
            </h3>
            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
              <button
                class={`toggle-button ${props.autoRefresh ? "active" : ""}`}
                onClick={props.onToggleAutoRefresh}
                style={`
              background: ${props.autoRefresh ? "#ff00ff" : "#333333"};
              border: 1px solid ${props.autoRefresh ? "#ff00ff" : "#666666"};
              color: ${props.autoRefresh ? "#000000" : "#ffffff"};
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.2s;
            `}
              >
                {props.autoRefresh ? "ON" : "OFF"}
              </button>
              <button
                class="ws-button"
                onClick={props.onRefresh}
                style={`
              background: #ff00ff;
              border: 1px solid #ff00ff;
              color: #000000;
              padding: 6px 12px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: background-color 0.2s;
            `}
              >
                Refresh
              </button>
            </div>
            <Show when={props.hasPendingUpdates && !props.autoRefresh}>
              <div style="margin-bottom: 24px; min-width: 0;">
                <button
                  class="ws-button"
                  onClick={props.onApplyPendingUpdates}
                  style={`
                background: #f59e0b;
                border: 1px solid #f59e0b;
                color: #000000;
                padding: 6px 12px;
                border-radius: 4px;
                font-size: 12px;
                cursor: pointer;
                transition: background-color 0.2s;
              `}
                >
                  Apply {props.pendingUpdatesCount} Updates
                </button>
              </div>
            </Show>
          </div>

          {/* Content Type Filter */}
          <div class="filter-section" style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #e0e0e0;">
              📄 Content Type
            </h3>
            <select
              class="filter-select"
              value={props.filterConfig.mime}
              onChange={(e) =>
                props.onFilterChange("mime", e.currentTarget.value)
              }
              style={`
            width: 100%;
            padding: 8px;
            background: #000000;
            border: 1px solid #3a3a3a;
            border-radius: 4px;
            color: #ffffff;
            font-size: 14px;
            box-sizing: border-box;
            min-width: 0;
          `}
            >
              <option value="">All Types</option>
              <For each={props.mimeCategories}>
                {(category) => <option value={category}>{category}</option>}
              </For>
            </select>
          </div>

          {/* Blob Type Filter */}
          <div class="filter-section" style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #e0e0e0;">
              🏷️ Blob Type
            </h3>
            <select
              class="filter-select"
              value={props.filterConfig.blobType}
              onChange={(e) =>
                props.onFilterChange("blobType", e.currentTarget.value)
              }
              style={`
            width: 100%;
            padding: 8px;
            background: #000000;
            border: 1px solid #3a3a3a;
            border-radius: 4px;
            color: #ffffff;
            font-size: 14px;
            box-sizing: border-box;
            min-width: 0;
          `}
            >
              <option value="">All Types</option>
              <For each={props.blobTypes}>
                {(type) => <option value={type}>{type}</option>}
              </For>
            </select>
          </div>

          {/* Size Range Filter */}
          <div class="filter-section" style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #e0e0e0;">
              📏 Size Range (bytes)
            </h3>
            <div style="display: flex; gap: 10px; align-items: center;">
              <input
                class="filter-input"
                type="number"
                placeholder="Min"
                value={props.filterConfig.minSize}
                onInput={(e) =>
                  props.onFilterChange(
                    "minSize",
                    parseInt(e.currentTarget.value) || 0
                  )
                }
                style={`
              flex: 1;
              padding: 8px;
              background: #1a1a1a;
              border: 1px solid #3a3a3a;
              border-radius: 4px;
              color: #e0e0e0;
              font-size: 14px;
            `}
              />
              <span style="color: #888;">-</span>
              <input
                class="filter-input"
                type="number"
                placeholder="Max"
                value={props.filterConfig.maxSize}
                onInput={(e) =>
                  props.onFilterChange(
                    "maxSize",
                    parseInt(e.currentTarget.value) || 0
                  )
                }
                style={`
              flex: 1;
              padding: 8px;
              background: #1a1a1a;
              border: 1px solid #3a3a3a;
              border-radius: 4px;
              color: #e0e0e0;
              font-size: 14px;
            `}
              />
            </div>
          </div>

          {/* Has Parent Filter */}
          <div class="filter-section" style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #e0e0e0;">
              🔗 Has Parent
            </h3>
            <select
              class="filter-select"
              value={props.filterConfig.hasParent}
              onChange={(e) =>
                props.onFilterChange("hasParent", e.currentTarget.value)
              }
              style={`
            width: 100%;
            padding: 8px;
            background: #000000;
            border: 1px solid #3a3a3a;
            border-radius: 4px;
            color: #ffffff;
            font-size: 14px;
            box-sizing: border-box;
            min-width: 0;
          `}
            >
              <option value="all">All</option>
              <option value="yes">Has Parent</option>
              <option value="no">No Parent</option>
            </select>
          </div>

          {/* Has Local Path Filter */}
          <div class="filter-section" style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #e0e0e0;">
              📁 Has Local Path
            </h3>
            <select
              class="filter-select"
              value={props.filterConfig.hasLocalPath}
              onChange={(e) =>
                props.onFilterChange("hasLocalPath", e.currentTarget.value)
              }
              style={`
            width: 100%;
            padding: 8px;
            background: #000000;
            border: 1px solid #3a3a3a;
            border-radius: 4px;
            color: #ffffff;
            font-size: 14px;
            box-sizing: border-box;
            min-width: 0;
          `}
            >
              <option value="all">All</option>
              <option value="yes">Has Local Path</option>
              <option value="no">No Local Path</option>
            </select>
          </div>

          {/* View Mode */}
          <div class="filter-section" style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #e0e0e0;">
              🎨 View Mode
            </h3>
            <div style="display: flex; gap: 4px; margin-bottom: 12px;">
              <button
                class={`view-mode-button ${props.viewMode === "compact" ? "active" : ""}`}
                onClick={() => props.onViewModeChange("compact")}
                style={`
              flex: 1;
              padding: 6px 12px;
              background: ${props.viewMode === "compact" ? "#ff00ff" : "#333333"};
              border: 1px solid ${props.viewMode === "compact" ? "#ff00ff" : "#666666"};
              color: ${props.viewMode === "compact" ? "#000000" : "#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `}
              >
                Compact
              </button>
              <button
                class={`view-mode-button ${props.viewMode === "default" ? "active" : ""}`}
                onClick={() => props.onViewModeChange("default")}
                style={`
              flex: 1;
              padding: 6px 12px;
              background: ${props.viewMode === "default" ? "#ff00ff" : "#333333"};
              border: 1px solid ${props.viewMode === "default" ? "#ff00ff" : "#666666"};
              color: ${props.viewMode === "default" ? "#000000" : "#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `}
              >
                Default
              </button>
              <button
                class={`view-mode-button ${props.viewMode === "detailed" ? "active" : ""}`}
                onClick={() => props.onViewModeChange("detailed")}
                style={`
              flex: 1;
              padding: 6px 12px;
              background: ${props.viewMode === "detailed" ? "#ff00ff" : "#333333"};
              border: 1px solid ${props.viewMode === "detailed" ? "#ff00ff" : "#666666"};
              color: ${props.viewMode === "detailed" ? "#000000" : "#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `}
              >
                Detailed
              </button>
            </div>
          </div>

          {/* Column Visibility */}
          <div class="filter-section" style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #e0e0e0;">
              👁️ Column Visibility
            </h3>
            <button
              class={`toggle-button ${showColumnSettings() ? "active" : ""}`}
              onClick={() => setShowColumnSettings(!showColumnSettings())}
              style={`
            margin-bottom: 12px;
            width: 100%;
            padding: 10px;
            background: ${showColumnSettings() ? "#ff00ff" : "#333333"};
            box-sizing: border-box;
            min-width: 0;
            border: 1px solid ${showColumnSettings() ? "#ff00ff" : "#666666"};
            color: ${showColumnSettings() ? "#000000" : "#ffffff"};
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
          `}
            >
              <span>
                {showColumnSettings() ? "Hide" : "Show"} Column Settings
              </span>
            </button>
            <div
              class={`column-settings ${!showColumnSettings() ? "collapsed" : ""}`}
              style={`
            max-height: ${showColumnSettings() ? "600px" : "0"};
            overflow: hidden;
            transition: max-height 0.3s ease;
            margin-bottom: ${showColumnSettings() ? "16px" : "0"};
          `}
            >
              <ColumnManager
                columnVisibility={props.columnVisibility}
                onColumnToggle={props.onColumnToggle}
                onResetToDefaults={() => {
                  // Reset to recommended columns
                  const defaults = {
                    id: false,
                    thumbnail: true,
                    name: true,
                    mime: true,
                    blob_type: false,
                    size: true,
                    parent_blob_id: false,
                    local_path: false,
                    created_at: true,
                    updated_at: false,
                    actions: true,
                  };
                  Object.entries(defaults).forEach(([key, value]) => {
                    if (
                      props.columnVisibility[key as keyof ColumnVisibility] !==
                      value
                    ) {
                      props.onColumnToggle(key as keyof ColumnVisibility);
                    }
                  });
                }}
              />
            </div>
          </div>

          {/* Data Info */}
          <div class="filter-section" style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #e0e0e0;">
              📊 Data Info
            </h3>
            <p style="font-size: 12px; color: #888; margin: 0 0 10px 0; line-height: 1.4;">
              Total: {props.totalCount} blobs
              <br />
              Filtered: {props.filteredCount} results
              <br />
              Sort: {props.sortConfig.field} ({props.sortConfig.direction})
              <br />
              Last updated: {props.lastUpdated?.toLocaleTimeString() || "Never"}
            </p>
            <div style="margin-bottom: 24px; min-width: 0;">
              Debug:
              <button
                class={`toggle-button ${props.debug ? "active" : ""}`}
                onClick={props.onToggleDebug}
                style={`
              margin-left: 8px;
              padding: 4px 8px;
              background: ${props.debug ? "#ff00ff" : "#333333"};
              border: 1px solid ${props.debug ? "#ff00ff" : "#666666"};
              color: ${props.debug ? "#000000" : "#ffffff"};
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.2s;
            `}
              >
                {props.debug ? "ON" : "OFF"}
              </button>
            </div>
            <button
              class="reset-button"
              onClick={props.onReset}
              title="Reset all filters and settings"
              style={`
            width: 100%;
            padding: 8px;
            background: #ef4444;
            border: 1px solid #ef4444;
            color: #ffffff;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: background-color 0.2s;
            box-sizing: border-box;
            min-width: 0;
          `}
            >
              Reset All
            </button>
          </div>

          {/* Debug Logs */}
          <Show when={props.debug && props.logs.length > 0}>
            <div class="filter-section">
              <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #e0e0e0;">
                🐛 Debug Logs
              </h3>
              <div
                class="debug-logs"
                style={`
              max-height: 200px;
              overflow-y: auto;
              background: #111111;
              border: 1px solid #333333;
              border-radius: 4px;
              padding: 8px;
            `}
              >
                <For each={props.logs}>
                  {(log) => (
                    <div style="font-size: 11px; color: #888; margin-bottom: 2px; font-family: monospace;">
                      {log}
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      )}

      <ResizeHandle
        position="left"
        isDragging={resize.isDragging()}
        onMouseDown={(e) => resize.handleMouseDown(e, "right")}
      />

      <style>{`
        .filter-input:focus {
          outline: none;
          border-color: #0070f3;
        }

        .ws-button:hover {
          background: rgba(255, 0, 255, 0.8);
        }

        .ws-button.danger:hover {
          background: #555555;
        }

        .ws-button:disabled {
          background: #444444;
          border-color: #444444;
          color: #888888;
          cursor: not-allowed;
        }

        .reset-button:hover {
          background: #dc2626;
        }

        .filter-panel button[title="Close panel"]:hover {
          background: rgba(255, 255, 255, 0.1) !important;
          color: #ff4444 !important;
        }
      `}</style>
    </div>
  );
}

export default FilterPanel;
