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
        padding: ${state.isBrowsePanelOpen() ? "20px" : "0"};
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
          padding: 8px 16px;
          margin: -20px -20px 20px -20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          z-index: 10;
        `}
      >
        <h3 style="margin: 0; font-size: 14px; color: #ffffff; font-weight: 600;">
          📁 Browse
        </h3>
        <button
          onClick={() => state.toggleBrowsePanel()}
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

      {state.isBrowsePanelOpen() && (
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

          {/* Quick search tips */}
          <div style="margin-top: 8px; font-size: 12px; color: #666;">
            <div style="margin-bottom: 4px;">💡 Quick Tips:</div>
            <div style="margin-left: 8px; line-height: 1.4;">
              • Type to search filenames
              <br />
              • Use * for wildcards
              <br />• Case insensitive search
            </div>
          </div>

          {/* Search status */}
          <div style="margin-top: 12px; padding: 8px; background: #252525; border-radius: 4px; border: 1px solid #444;">
            <div style="font-size: 12px; color: #888;">
              {state.filterConfig().name ? (
                <>
                  <span style="color: #00ff00;">🔍 Searching for:</span>{" "}
                  <span style="color: #ffffff; font-weight: 600;">
                    "{state.filterConfig().name}"
                  </span>
                </>
              ) : (
                <span style="color: #888;">Type to start searching...</span>
              )}
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
