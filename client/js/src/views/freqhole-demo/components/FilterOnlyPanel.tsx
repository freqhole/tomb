import { createSignal, For, createMemo } from "solid-js";
import type { FilterConfig, ColumnVisibility } from "../types";
import { ResizeHandle } from "../ResizeHandle";
import { useResize } from "../hooks/useResize";
import { ColumnManager } from "./ColumnManager";
import { useFreqholeStateContext } from "../context/FreqholeStateContext";
import { useWebSocketFeed } from "../../../hooks/useWebSocketFeed";
import { useFreqholeData } from "../hooks/useFreqholeData";
import { useResponsiveColumns } from "../hooks/useResponsiveColumns";
import type { NotificationChannel } from "../../../lib/websocket-types";

export function FilterOnlyPanel() {
  const state = useFreqholeStateContext();
  const [showColumnSettings, setShowColumnSettings] = createSignal(false);

  // Set up the same hooks that the main component uses
  const feed = useWebSocketFeed({
    wsUrl: state.wsUrl(),
    channels: ["MediaBlobs"] as NotificationChannel[],
    debug: state.debug(),
    autoConnect: state.autoConnect(),
    autoRefresh: state.autoRefresh() ?? true,
    pageSize: 50,
  });

  const data = useFreqholeData({
    items: () => feed.state().items,
    filterConfig: state.filterConfig,
    sortConfig: state.sortConfig,
  });

  const responsiveColumns = useResponsiveColumns({
    baseColumnVisibility: () => state.columnVisibility(),
  });

  // Computed values from hooks
  const availableMimeCategories = createMemo(() => data.mimeCategories());
  const availableBlobTypes = createMemo(() => data.blobTypes());

  // Event handlers that work with context
  const updateFilter = (key: keyof FilterConfig, value: any) => {
    state.updateFilter(key, value);
  };

  const toggleColumnVisibility = (column: keyof ColumnVisibility) => {
    state.toggleColumn(column);
  };

  const resize = useResize({
    initialWidth: state.filterPanelWidth(),
    minWidth: 250,
    maxWidth: 600,
    closeThreshold: 100,
    onWidthChange: (width) => state.setFilterPanelWidth(width),
    onClose: () => state.toggleFilterPanel(),
  });

  return (
    <div
      class={`filter-panel ${!state.isFilterPanelOpen() ? "collapsed" : ""} ${
        resize.isDragging() ? "resizing" : ""
      }`}
      style={`
        width: ${state.isFilterPanelOpen() ? resize.width() + "px" : "0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        overflow-x: hidden;
        transition: width 0.3s ease;
        position: relative;
        display: ${state.isFilterPanelOpen() ? "flex" : "none"};
        flex-direction: column;
        height: 100%;
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
          padding: 0 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          z-index: 10;
          flex-shrink: 0;
        `}
      >
        <h2 style="margin: 0; font-size: 18px; color: #ffffff; font-weight: 600;">
          🔍 Filters & Columns
        </h2>
        <button
          onClick={() => state.toggleFilterPanel()}
          title="Close panel"
          style={`
            background: transparent;
            border: none;
            color: #888888;
            font-size: 18px;
            cursor: pointer;
            padding: 4px;
            border-radius: 3px;
            transition: all 0.2s;
          `}
        >
          ✕
        </button>
      </div>

      {state.isFilterPanelOpen() && (
        <div style="height: 100%; overflow-y: auto; flex: 1; padding: 20px;">
          <div style="overflow-y: auto; min-width: 0;">
            {/* Name Search */}
            <div
              class="filter-section"
              style="margin-bottom: 24px; overflow-y: auto; min-width: 0;"
            >
              <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #ffffff;">
                📄 Name Search
              </h3>
              <input
                class="filter-input"
                type="text"
                placeholder="Search by filename..."
                value={state.filterConfig().name}
                onInput={(e) => updateFilter("name", e.currentTarget.value)}
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
              />
            </div>

            {/* MIME Type Filter */}
            <div class="filter-section" style="margin-bottom: 24px;">
              <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #ffffff;">
                🎭 Content Type
              </h3>
              <select
                value={state.filterConfig().mime}
                onChange={(e) => updateFilter("mime", e.currentTarget.value)}
                style={`
                width: 100%;
                padding: 8px;
                background: #000000;
                border: 1px solid #3a3a3a;
                border-radius: 4px;
                color: #ffffff;
                font-size: 14px;
                box-sizing: border-box;
              `}
              >
                <option value="">All Types</option>
                <For each={availableMimeCategories()}>
                  {(category) => <option value={category}>{category}</option>}
                </For>
              </select>
            </div>

            {/* Blob Type Filter */}
            <div class="filter-section" style="margin-bottom: 24px;">
              <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #ffffff;">
                🏷️ Blob Type
              </h3>
              <select
                value={state.filterConfig().blobType}
                onChange={(e) =>
                  updateFilter("blobType", e.currentTarget.value)
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
              `}
              >
                <option value="">All Blob Types</option>
                <For each={availableBlobTypes()}>
                  {(category) => <option value={category}>{category}</option>}
                </For>
              </select>
            </div>

            {/* File Size Range */}
            <div class="filter-section" style="margin-bottom: 24px;">
              <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #ffffff;">
                📏 File Size
              </h3>
              <div style="display: flex; gap: 8px; align-items: center;">
                <input
                  type="number"
                  placeholder="Min"
                  value={state.filterConfig().minSize || ""}
                  onInput={(e) =>
                    updateFilter(
                      "minSize",
                      parseInt(e.currentTarget.value) || 0
                    )
                  }
                  style={`
                  max-width: 33%;
                  padding: 6px;
                  background: #000000;
                  border: 1px solid #3a3a3a;
                  border-radius: 4px;
                  color: #ffffff;
                  font-size: 12px;
                  box-sizing: border-box;
                `}
                />
                <span style="color: #888; font-size: 12px;">to</span>
                <input
                  type="number"
                  placeholder="Max"
                  value={state.filterConfig().maxSize || ""}
                  onInput={(e) =>
                    updateFilter(
                      "maxSize",
                      parseInt(e.currentTarget.value) || 0
                    )
                  }
                  style={`
                  max-width: 33%;
                  padding: 6px;
                  background: #000000;
                  border: 1px solid #3a3a3a;
                  border-radius: 4px;
                  color: #ffffff;
                  font-size: 12px;
                  box-sizing: border-box;
                `}
                />
                <span style="color: #888; font-size: 12px;">bytes</span>
              </div>
            </div>

            {/* Quick size filters */}
            <div class="filter-section" style="margin-bottom: 24px;">
              <h4 style="margin: 0 0 8px 0; font-size: 14px; color: #888;">
                Quick Size Filters
              </h4>
              <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                <button
                  onClick={() => {
                    updateFilter("minSize", 0);
                    updateFilter("maxSize", 1024 * 1024); // 1MB
                  }}
                  style={`
                  padding: 4px 8px;
                  background: #333;
                  border: 1px solid #555;
                  border-radius: 4px;
                  color: #fff;
                  font-size: 11px;
                  cursor: pointer;
                  transition: all 0.2s;
                `}
                >
                  &lt; 1MB
                </button>
                <button
                  onClick={() => {
                    updateFilter("minSize", 1024 * 1024);
                    updateFilter("maxSize", 10 * 1024 * 1024); // 10MB
                  }}
                  style={`
                  padding: 4px 8px;
                  background: #333;
                  border: 1px solid #555;
                  border-radius: 4px;
                  color: #fff;
                  font-size: 11px;
                  cursor: pointer;
                  transition: all 0.2s;
                `}
                >
                  1-10MB
                </button>
                <button
                  onClick={() => {
                    updateFilter("minSize", 10 * 1024 * 1024); // 10MB+
                    updateFilter("maxSize", 0);
                  }}
                  style={`
                  padding: 4px 8px;
                  background: #333;
                  border: 1px solid #555;
                  border-radius: 4px;
                  color: #fff;
                  font-size: 11px;
                  cursor: pointer;
                  transition: all 0.2s;
                `}
                >
                  &gt; 10MB
                </button>
              </div>
            </div>

            {/* Column Visibility Toggle */}
            <div class="filter-section" style="margin-bottom: 24px;">
              <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #ffffff;">
                👁️ Column Visibility
              </h3>
              <button
                onClick={() => setShowColumnSettings(!showColumnSettings())}
                class="toggle-button"
                style={`
                width: 100%;
                padding: 8px 12px;
                background: #333333;
                border: 1px solid #555555;
                border-radius: 4px;
                color: #ffffff;
                font-size: 14px;
                cursor: pointer;
                transition: all 0.2s;
                display: flex;
                justify-content: space-between;
                align-items: center;
              `}
              >
                <span>Manage Columns</span>
                <span style="transform: rotate(90deg); font-size: 12px;">
                  {showColumnSettings() ? "▼" : "▶"}
                </span>
              </button>
              {showColumnSettings() && (
                <div style="margin-top: 12px;">
                  <ColumnManager
                    columnVisibility={state.columnVisibility()}
                    onColumnToggle={toggleColumnVisibility}
                    responsiveColumnVisibility={responsiveColumns.responsiveColumnVisibility()}
                    hiddenColumns={responsiveColumns.getHiddenColumns()}
                    breakpointInfo={responsiveColumns.getBreakpointInfo()}
                  />
                </div>
              )}
            </div>

            {/* Reset Filters */}
            <div class="filter-section" style="margin-bottom: 24px;">
              <button
                onClick={() => {
                  // Reset all filters to default values
                  updateFilter("name", "");
                  updateFilter("mime", "");
                  updateFilter("blobType", "");
                  updateFilter("minSize", 0);
                  updateFilter("maxSize", 100000000);
                  updateFilter("hasParent", "all");
                  updateFilter("hasLocalPath", "all");
                }}
                style={`
                width: 100%;
                padding: 12px;
                background: #444444;
                border: 1px solid #666666;
                border-radius: 6px;
                color: #ffffff;
                font-size: 14px;
                cursor: pointer;
                transition: all 0.2s;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                font-weight: 600;
              `}
                onMouseEnter={(e) => {
                  (e.target as HTMLElement).style.background = "#555555";
                  (e.target as HTMLElement).style.borderColor = "#777777";
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLElement).style.background = "#444444";
                  (e.target as HTMLElement).style.borderColor = "#666666";
                }}
              >
                <span>Reset All Filters</span>
              </button>
            </div>

            {/* Results Summary */}
            <div
              class="filter-section"
              style="margin-bottom: 24px; padding: 12px; background: #252525; border-radius: 6px; border: 1px solid #444;"
            >
              <h4 style="margin: 0 0 8px 0; font-size: 14px; color: #888;">
                📊 Results
              </h4>
              <p style="margin: 0; font-size: 14px; color: #ffffff;">
                Showing{" "}
                <span style="color: #00ff00; font-weight: 600;">
                  {data.filteredData().length}
                </span>{" "}
                of <span style="color: #888;">{feed.state().items.length}</span>{" "}
                total files
                {data.filteredData().length < feed.state().items.length && (
                  <span style="color: #ff9900;">
                    {feed.state().items.length - data.filteredData().length}{" "}
                    files filtered out
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      <ResizeHandle
        position="right"
        isDragging={resize.isDragging()}
        onMouseDown={(e) => resize.handleMouseDown(e, "left")}
      />

      <style>{`
        .filter-input:focus {
          outline: none;
          border-color: #ff00ff;
        }

        .filter-panel select:focus {
          outline: none;
          border-color: #ff00ff;
        }

        .filter-panel input:focus {
          outline: none;
          border-color: #ff00ff;
        }

        .filter-panel button[title="Close panel"]:hover {
          background: rgba(255, 255, 255, 0.1) !important;
          color: #ff4444 !important;
        }

        .toggle-button:hover {
          filter: brightness(1.1);
        }

        /* Quick filter buttons hover effects */
        .filter-section button:hover {
          background: #444 !important;
          border-color: #666 !important;
        }

        /* Global resizing behavior */
        body.resizing {
          cursor: col-resize !important;
          user-select: none !important;
        }

        body.resizing * {
          cursor: col-resize !important;
          user-select: none !important;
        }
      `}</style>
    </div>
  );
}
