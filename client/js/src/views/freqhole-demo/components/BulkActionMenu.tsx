
import { Show, createSignal, onCleanup, createEffect } from "solid-js";
import { useFreqholeStateContext } from "../context/FreqholeStateContext";

export function BulkActionMenu() {
  const state = useFreqholeStateContext();
  let menuRef: HTMLDivElement | undefined;
  const [adjustedPosition, setAdjustedPosition] = createSignal({ x: 0, y: 0 });

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      state.setBulkActionMenu(null);
    }
  };

  const handleGlobalClick = (event: MouseEvent) => {
    if (menuRef && !menuRef.contains(event.target as Node)) {
      event.preventDefault();
      event.stopPropagation();
      state.setBulkActionMenu(null);
    }
  };

  const calculatePosition = () => {
    if (!menuRef) return;

    const menuWidth = 200;
    const menuHeight = 140;
    const position = state.bulkActionMenu()?.position;
    if (!position) return;

    const { x, y } = position;

    let adjustedX = x;
    let adjustedY = y;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Adjust horizontal position if menu would overflow
    if (x + menuWidth > viewportWidth) {
      adjustedX = Math.max(10, viewportWidth - menuWidth - 10);
    }

    // Adjust vertical position if menu would overflow
    if (y + menuHeight > viewportHeight) {
      adjustedY = Math.max(10, y - menuHeight);
    }

    setAdjustedPosition({ x: adjustedX, y: adjustedY });
  };

  // Handle position calculation when menu opens
  createEffect(() => {
    if (state.bulkActionMenu()?.isOpen) {
      document.addEventListener("keydown", handleKeyDown, true);
      document.addEventListener("mousedown", handleGlobalClick, true);
      setTimeout(calculatePosition, 0);
    } else {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("mousedown", handleGlobalClick, true);
    }
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("mousedown", handleGlobalClick, true);
  });

  const handleDownloadAll = async () => {
    // TODO: Get selected items from context and implement bulk download
    console.log("🗑️ Bulk download requested");
    state.setBulkActionMenu(null);
  };

  const handleDeleteAll = () => {
    // TODO: Get selected items from context and show confirm dialog
    console.log("🗑️ Bulk delete requested");
    state.setBulkActionMenu(null);
  };

  const handleClearSelection = () => {
    // TODO: Clear selection from context
    console.log("🔄 Clear selection requested");
    state.setBulkActionMenu(null);
  };

  return (
    <Show when={state.bulkActionMenu()?.isOpen}>
      <div
        ref={menuRef}
        style={`
          position: fixed;
          left: ${adjustedPosition().x}px;
          top: ${adjustedPosition().y}px;
          background: #1a1a1a;
          border: 1px solid #3a3a3a;
          border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
          z-index: 1000;
          min-width: 200px;
          overflow: hidden;
          animation: slideIn 0.15s ease-out;
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Menu Header */}
        <div
          style={`
            padding: 8px 12px;
            font-size: 11px;
            color: #888;
            border-bottom: 1px solid #444;
            background: #1a1a1a;
            display: flex;
            align-items: center;
            gap: 6px;
          `}
        >
          <span>⚡</span>
          <span>Bulk Actions ({0} selected)</span>
        </div>

        {/* Menu Items */}
        <div style="padding: 4px 0;">
          {/* Download All */}
          <button
            onClick={handleDownloadAll}
            style={`
              width: 100%;
              padding: 8px 12px;
              background: transparent;
              border: none;
              color: #e0e0e0;
              text-align: left;
              cursor: pointer;
              display: flex;
              align-items: center;
              gap: 8px;
              font-size: 13px;
              transition: background 0.15s;
            `}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.background = "#3a3a3a";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.background = "transparent";
            }}
          >
            <span>📥</span>
            <span>Download All</span>
          </button>

          {/* Clear Selection */}
          <button
            onClick={handleClearSelection}
            style={`
              width: 100%;
              padding: 8px 12px;
              background: transparent;
              border: none;
              color: #e0e0e0;
              text-align: left;
              cursor: pointer;
              display: flex;
              align-items: center;
              gap: 8px;
              font-size: 13px;
              transition: background 0.15s;
            `}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.background = "#3a3a3a";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.background = "transparent";
            }}
          >
            <span>🔄</span>
            <span>Clear Selection</span>
          </button>

          {/* Divider */}
          <div style="height: 1px; background: #444; margin: 4px 0;"></div>

          {/* Delete All */}
          <button
            onClick={handleDeleteAll}
            style={`
              width: 100%;
              padding: 8px 12px;
              background: transparent;
              border: none;
              color: #ef4444;
              text-align: left;
              cursor: pointer;
              display: flex;
              align-items: center;
              gap: 8px;
              font-size: 13px;
              transition: background 0.15s;
            `}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.background = "#2a1a1a";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.background = "transparent";
            }}
          >
            <span>🗑️</span>
            <span>Delete All</span>
          </button>
        </div>

        <style>{`
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: scale(0.95) translateY(-8px);
            }
            to {
              opacity: 1;
              transform: scale(1) translateY(0);
            }
          }
        `}</style>
      </div>
    </Show>
  );
}
