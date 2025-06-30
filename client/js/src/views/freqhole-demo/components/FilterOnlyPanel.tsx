/* @jsxImportSource solid-js */
import { createSignal, For } from "solid-js";
import type { FilterConfig, ColumnVisibility } from "../types";
import { ResizeHandle } from "../ResizeHandle";
import { useResize } from "../hooks/useResize";
import { ColumnManager } from "./ColumnManager";

export interface FilterOnlyPanelProps {
  isOpen: boolean;
  filterConfig: FilterConfig;
  columnVisibility: ColumnVisibility;
  onTogglePanel: () => void;
  onFilterChange: (key: keyof FilterConfig, value: any) => void;
  onColumnToggle: (column: keyof ColumnVisibility) => void;
  onWidthChange: (width: number) => void;
  initialWidth: number;
  mimeCategories: string[];
  blobTypeCategories: string[];
  totalCount: number;
  filteredCount: number;
}

export function FilterOnlyPanel(props: FilterOnlyPanelProps) {
  const [showColumnSettings, setShowColumnSettings] = createSignal(false);

  const resize = useResize({
    initialWidth: props.initialWidth,
    minWidth: 250,
    maxWidth: 600,
    closeThreshold: 100,
    onWidthChange: props.onWidthChange,
    onClose: props.onTogglePanel,
  });

  return (
    <div
      class={`filter-panel ${!props.isOpen ? "collapsed" : ""} ${
        resize.isDragging() ? "resizing" : ""
      }`}
      style={`
        width: ${props.isOpen ? resize.width() + "px" : "0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        padding: ${props.isOpen ? "20px" : "0"};
        overflow-x: hidden;
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
          padding: 8px 16px;
          margin: -20px -20px 20px -20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          z-index: 10;
        `}
      >
        <h3 style="margin: 0; font-size: 14px; color: #ffffff; font-weight: 600;">
          🔍 Filters & Columns
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
              value={props.filterConfig.name}
              onInput={(e) =>
                props.onFilterChange("name", e.currentTarget.value)
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
            />
          </div>

          {/* MIME Type Filter */}
          <div class="filter-section" style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #ffffff;">
              🎭 Content Type
            </h3>
            <select
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
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #ffffff;">
              🏷️ Blob Type
            </h3>
            <select
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
              `}
            >
              <option value="">All Blob Types</option>
              <For each={props.blobTypeCategories}>
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
                value={props.filterConfig.minSize || ""}
                onInput={(e) =>
                  props.onFilterChange(
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
                `}
              />
              <span style="color: #888; font-size: 12px;">to</span>
              <input
                type="number"
                placeholder="Max"
                value={props.filterConfig.maxSize || ""}
                onInput={(e) =>
                  props.onFilterChange(
                    "maxSize",
                    parseInt(e.currentTarget.value) || 100000000
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
                `}
              />
            </div>
            <div style="font-size: 11px; color: #666; margin-top: 4px;">
              Size in bytes
            </div>
          </div>

          {/* Column Settings */}
          <div class="filter-section" style="margin-bottom: 24px;">
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

          {/* Filter Summary */}
          <div class="filter-section" style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #e0e0e0;">
              📊 Filter Results
            </h3>
            <p style="font-size: 12px; color: #888; margin: 0; line-height: 1.4;">
              Showing: {props.filteredCount} of {props.totalCount} files
              <br />
              {props.filteredCount !== props.totalCount && (
                <span style="color: #ff9900;">
                  {props.totalCount - props.filteredCount} files filtered out
                </span>
              )}
            </p>
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

        /* Global resizing behavior */
        body.resizing {
          cursor: col-resize !important;
          user-select: none !important;
        }

        body.resizing * {
          cursor: col-resize !important;
          user-select: none !important;
        }

        /* Prevent overflow in panel content */
        .filter-panel {
          overflow-x: hidden;
        }

        .filter-panel * {
          max-width: 100%;
          box-sizing: border-box;
        }

        /* Smooth transitions for panel operations */
        .filter-panel.resizing {
          transition: none !important;
        }
      `}</style>
    </div>
  );
}

export default FilterOnlyPanel;
