import { Show } from "solid-js";
import { useFreqholeAppContext } from "../context/FreqholeStateContext";

export function SelectionToolbar() {
  const { selection, state, addLog } = useFreqholeAppContext();

  const handleDownload = () => {
    const selectedCount = selection.selectedItems().size;
    addLog(`📥 Downloading ${selectedCount} selected items`);
    // TODO: Implement bulk download
  };

  const handleMore = (event: MouseEvent) => {
    const currentMenu = state.bulkActionMenu();
    if (currentMenu?.isOpen) {
      // Close if already open
      state.setBulkActionMenu(null);
    } else {
      // Position menu above the More button
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      const position = {
        x: rect.left + rect.width / 2 - 100, // Center horizontally
        y: rect.top - 10, // Position above button
      };

      state.setBulkActionMenu({
        isOpen: true,
        position,
      });

      const selectedCount = selection.selectedItems().size;
      addLog(`⋯ Bulk action menu opened for ${selectedCount} items`);
    }
  };

  const handleClear = () => {
    const selectedCount = selection.selectedItems().size;
    selection.clearSelection();
    addLog(`🗑️ Cleared selection of ${selectedCount} items`);
  };

  const selectedCount = () => selection.selectedItems().size;

  return (
    <Show when={selectedCount() > 1}>
      <div
        class="selection-toolbar"
        style={`
          position: fixed;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: #1a1a1a;
          border: 1px solid #3a3a3a;
          border-radius: 8px;
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          z-index: 100;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          animation: slideUp 0.3s ease-out;
        `}
      >
        <span
          class="selection-count"
          style={`
            color: #ffffff;
            font-weight: 500;
            font-size: 14px;
          `}
        >
          {selectedCount()} item{selectedCount() === 1 ? "" : "s"} selected
        </span>

        <button
          class="toolbar-button primary"
          onClick={handleDownload}
          title="Download selected files"
          style={`
            background: #ff00ff;
            color: #000000;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            transition: all 0.2s ease;
            user-select: none;
          `}
        >
          📥 Download
        </button>

        <button
          class="toolbar-button secondary"
          onClick={handleMore}
          title="More actions"
          style={`
            background: #333333;
            color: #ffffff;
            border: 1px solid #666666;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s ease;
            user-select: none;
          `}
        >
          ⋯ More
        </button>

        <button
          class="toolbar-button clear"
          onClick={handleClear}
          title="Clear selection"
          style={`
            background: transparent;
            color: #888888;
            border: 1px solid #555555;
            padding: 6px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            line-height: 1;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            user-select: none;
          `}
        >
          ×
        </button>

        <style>{`
          @keyframes slideUp {
            from {
              opacity: 0;
              transform: translateX(-50%) translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateX(-50%) translateY(0);
            }
          }

          .toolbar-button:hover {
            transform: translateY(-1px);
          }

          .toolbar-button.primary:hover {
            background: #ff33ff !important;
            color: #000000 !important;
            box-shadow: 0 2px 8px rgba(255, 0, 255, 0.3);
          }

          .toolbar-button.secondary:hover {
            background: #444444 !important;
            border-color: #777777 !important;
          }

          .toolbar-button.clear:hover {
            background: #333333 !important;
            color: #ffffff !important;
            border-color: #777777 !important;
          }

          .selection-toolbar:hover {
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
          }
        `}</style>
      </div>
    </Show>
  );
}

export default SelectionToolbar;
