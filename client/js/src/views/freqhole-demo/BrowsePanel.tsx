import { Show } from "solid-js";
import type { FilterConfig } from "./types";
import { ResizeHandle } from "./ResizeHandle";
import { useResize } from "./hooks/useResize";

export interface BrowsePanelProps {
  isOpen: boolean;
  filterConfig: FilterConfig;
  onTogglePanel: () => void;
  onFilterChange: (key: keyof FilterConfig, value: any) => void;
  onWidthChange: (width: number) => void;
  initialWidth: number;
}

export function BrowsePanel(props: BrowsePanelProps) {
  const resize = useResize({
    initialWidth: props.initialWidth,
    minWidth: 300,
    maxWidth: 800,
    onWidthChange: props.onWidthChange,
  });

  return (
    <div
      class={`browse-panel ${!props.isOpen ? "collapsed" : ""} ${
        resize.isDragging() ? "resizing" : ""
      }`}
      style={`
        width: ${resize.width()}px;
        background: #2a2a2a;
        border-right: 1px solid #3a3a3a;
        padding: 20px;
        overflow-y: auto;
        transition: margin-left 0.3s ease;
        position: relative;
        flex-shrink: 0;
      `}
    >
      <Show when={props.isOpen}>
        <button
          class="panel-close-button"
          onClick={props.onTogglePanel}
          style={`
            position: absolute;
            top: 10px;
            right: 10px;
            background: transparent;
            border: none;
            color: #888;
            cursor: pointer;
            font-size: 14px;
            padding: 4px 8px;
            border-radius: 4px;
            transition: background-color 0.2s;
          `}
        >
          ← Hide Browse
        </button>
      </Show>

      <div class="filter-section" style="margin-bottom: 24px;">
        <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #e0e0e0;">
          🔍 Name Search
        </h3>
        <input
          class="filter-input"
          type="text"
          placeholder="Search by filename..."
          value={props.filterConfig.name}
          onInput={(e) => props.onFilterChange("name", e.currentTarget.value)}
          style={`
            width: 100%;
            padding: 8px;
            background: #1a1a1a;
            border: 1px solid #3a3a3a;
            border-radius: 4px;
            color: #e0e0e0;
            font-size: 14px;
          `}
        />
      </div>

      <ResizeHandle
        position="right"
        isDragging={resize.isDragging()}
        onMouseDown={(e) => resize.handleMouseDown(e, "left")}
      />

      <style>{`
        .browse-panel.collapsed {
          margin-left: -${resize.width()}px;
        }

        .browse-panel.resizing {
          pointer-events: auto;
        }

        .filter-input:focus {
          outline: none;
          border-color: #0070f3;
        }

        .panel-close-button:hover {
          background: rgba(255, 255, 255, 0.1);
        }
      `}</style>
    </div>
  );
}

export default BrowsePanel;
