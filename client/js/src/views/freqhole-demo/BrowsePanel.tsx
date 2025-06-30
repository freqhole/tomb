import type { FilterConfig } from "./types";
import { ResizeHandle } from "./ResizeHandle";
import { useResize } from "./hooks/useResize";
import { useFreqholeStateContext } from "./context/FreqholeStateContext";

export function BrowsePanel() {
  const state = useFreqholeStateContext();

  // Event handler that works with context
  const updateFilter = (key: keyof FilterConfig, value: any) => {
    state.updateFilter(key, value);
  };

  const resize = useResize({
    initialWidth: state.browsePanelWidth(),
    minWidth: 250,
    maxWidth: 600,
    closeThreshold: 100,
    onWidthChange: (width) => state.setBrowsePanelWidth(width),
    onClose: () => state.toggleBrowsePanel(),
  });

  return (
    <div
      class={`browse-panel ${!state.isBrowsePanelOpen() ? "collapsed" : ""} ${
        resize.isDragging() ? "resizing" : ""
      }`}
      style={`
        width: ${state.isBrowsePanelOpen() ? resize.width() + "px" : "0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        overflow-x: hidden;
        transition: width 0.3s ease;
        position: relative;
        display: ${state.isBrowsePanelOpen() ? "flex" : "none"};
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
          📂 Browse
        </h2>
        <button
          onClick={() => state.toggleBrowsePanel()}
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

      {state.isBrowsePanelOpen() && (
        <div style="height: 100%; overflow-y: auto; flex: 1; padding: 20px;">
          <div
            class="filter-section"
            style="margin-bottom: 24px; overflow-y: auto; min-width: 0;"
          >
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #ffffff;">
              🔍 Quick Search
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

        .browse-panel button[title="Close panel"]:hover {
          background: rgba(255, 255, 255, 0.1) !important;
          color: #ff4444 !important;
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
        .browse-panel,
        .filter-panel {
          overflow-x: hidden;
        }

        .browse-panel *,
        .filter-panel * {
          max-width: 100%;
          box-sizing: border-box;
        }

        /* Smooth transitions for panel operations */
        .browse-panel.resizing,
        .filter-panel.resizing {
          transition: none !important;
        }
      `}</style>
    </div>
  );
}

export default BrowsePanel;
