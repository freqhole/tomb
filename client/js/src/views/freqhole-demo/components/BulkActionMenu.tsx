import { Show, createSignal, onMount, onCleanup } from "solid-js";

export interface BulkActionMenuProps {
  selectedCount: number;
  isOpen: boolean;
  onClose: () => void;
  onDownloadAll?: () => void;
  onDeleteAll?: () => void;
  onClearSelection?: () => void;
  position: { x: number; y: number };
}

export function BulkActionMenu(props: BulkActionMenuProps) {
  let menuRef: HTMLDivElement | undefined;
  const [adjustedPosition, setAdjustedPosition] = createSignal({ x: 0, y: 0 });

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
    }
  };

  const handleGlobalClick = (event: MouseEvent) => {
    // Close menu if clicking outside
    if (menuRef && !menuRef.contains(event.target as Node)) {
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
    }
  };

  const calculatePosition = () => {
    if (!menuRef) return;

    const menuWidth = 200;
    const menuHeight = 180;
    const { x, y } = props.position;

    // Calculate optimal position with viewport edge detection
    let adjustedX = x;
    let adjustedY = y;

    // Adjust horizontal position if menu would go off screen
    if (x + menuWidth > window.innerWidth) {
      adjustedX = window.innerWidth - menuWidth - 8;
    }
    if (adjustedX < 8) {
      adjustedX = 8;
    }

    // Adjust vertical position if menu would go off screen
    if (y + menuHeight > window.innerHeight) {
      adjustedY = y - menuHeight - 4;
    }
    if (adjustedY < 8) {
      adjustedY = 8;
    }

    setAdjustedPosition({ x: adjustedX, y: adjustedY });
  };

  onMount(() => {
    if (props.isOpen) {
      document.addEventListener("keydown", handleKeyDown, true);
      document.addEventListener("click", handleGlobalClick, true);
      // Calculate position after mount
      setTimeout(calculatePosition, 0);
    }
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("click", handleGlobalClick, true);
  });

  // Update event listeners when menu state changes
  const updateEventListeners = () => {
    if (props.isOpen) {
      document.addEventListener("keydown", handleKeyDown, true);
      document.addEventListener("click", handleGlobalClick, true);
      calculatePosition();
    } else {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("click", handleGlobalClick, true);
    }
  };

  // Watch for prop changes
  onMount(() => {
    const checkProps = () => {
      updateEventListeners();
      requestAnimationFrame(checkProps);
    };
    checkProps();
  });

  const handleDownloadAll = () => {
    if (props.onDownloadAll) {
      props.onDownloadAll();
    }
    props.onClose();
  };

  const handleDeleteAll = () => {
    if (props.onDeleteAll) {
      props.onDeleteAll();
    }
    props.onClose();
  };

  const handleClearSelection = () => {
    if (props.onClearSelection) {
      props.onClearSelection();
    }
    props.onClose();
  };

  return (
    <Show when={props.isOpen && props.selectedCount > 0}>
      <div
        ref={menuRef}
        class="bulk-action-menu"
        style={`
          position: fixed;
          top: ${adjustedPosition().y}px;
          left: ${adjustedPosition().x}px;
          background: #2a2a2a;
          border: 1px solid #444444;
          border-radius: 6px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
          z-index: 1000;
          min-width: 200px;
          overflow: hidden;
          backdrop-filter: blur(10px);
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
          <span>📦</span>
          <span>
            {props.selectedCount} item{props.selectedCount === 1 ? "" : "s"}{" "}
            selected
          </span>
        </div>

        {/* Menu Items */}
        <div style="padding: 4px 0;">
          {/* Download All */}
          <button
            class="bulk-action-menu-item"
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
            <span>Download All ({props.selectedCount})</span>
          </button>

          {/* Export as ZIP */}
          <button
            class="bulk-action-menu-item"
            onClick={() => {
              // TODO: Implement ZIP export
              console.log("Export as ZIP not implemented yet");
              props.onClose();
            }}
            style={`
              width: 100%;
              padding: 8px 12px;
              background: transparent;
              border: none;
              color: #888888;
              text-align: left;
              cursor: not-allowed;
              display: flex;
              align-items: center;
              gap: 8px;
              font-size: 13px;
              transition: background 0.15s;
            `}
          >
            <span>🗜️</span>
            <span>Export as ZIP (Soon)</span>
          </button>

          {/* Add to Playlist */}
          <button
            class="bulk-action-menu-item"
            onClick={() => {
              // TODO: Implement playlist functionality
              console.log("Add to playlist not implemented yet");
              props.onClose();
            }}
            style={`
              width: 100%;
              padding: 8px 12px;
              background: transparent;
              border: none;
              color: #888888;
              text-align: left;
              cursor: not-allowed;
              display: flex;
              align-items: center;
              gap: 8px;
              font-size: 13px;
              transition: background 0.15s;
            `}
          >
            <span>🎵</span>
            <span>Add to Playlist (Soon)</span>
          </button>

          {/* Separator */}
          <div
            style={`
              height: 1px;
              background: #444444;
              margin: 4px 8px;
            `}
          />

          {/* Clear Selection */}
          <button
            class="bulk-action-menu-item"
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
            <span>✖️</span>
            <span>Clear Selection</span>
          </button>

          {/* Delete All */}
          <button
            class="bulk-action-menu-item"
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
              (e.target as HTMLElement).style.background =
                "rgba(239, 68, 68, 0.1)";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.background = "transparent";
            }}
          >
            <span>🗑️</span>
            <span>Delete All ({props.selectedCount})</span>
          </button>
        </div>
      </div>
    </Show>
  );
}
