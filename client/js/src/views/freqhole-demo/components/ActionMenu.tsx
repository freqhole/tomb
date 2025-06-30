import { Show, createSignal, onMount, onCleanup } from "solid-js";
import type { MediaBlob } from "../../../lib/websocket-types";
import { getDisplayFilename } from "../../../lib/media-utils";

export interface ActionMenuProps {
  item: MediaBlob | null;
  isOpen: boolean;
  onClose: () => void;
  onDownload?: (item: MediaBlob) => void;
  onPreview?: (item: MediaBlob) => void;
  onDelete?: (item: MediaBlob) => void;
  onCopyUrl?: (item: MediaBlob) => void;
  position: { x: number; y: number };
}

export function ActionMenu(props: ActionMenuProps) {
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

    const menuWidth = 180;
    const menuHeight = 160;
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

  const handleDownload = () => {
    if (props.item && props.onDownload) {
      props.onDownload(props.item);
    }
    props.onClose();
  };

  const handlePreview = () => {
    if (props.item && props.onPreview) {
      props.onPreview(props.item);
    }
    props.onClose();
  };

  const handleDelete = () => {
    if (props.item && props.onDelete) {
      props.onDelete(props.item);
    }
    props.onClose();
  };

  const handleCopyUrl = () => {
    if (props.item && props.onCopyUrl) {
      props.onCopyUrl(props.item);
    }
    props.onClose();
  };

  const getFileTypeIcon = (item: MediaBlob) => {
    const mime = item.mime || "";
    if (mime.startsWith("image/")) return "🖼️";
    if (mime.startsWith("video/")) return "🎥";
    if (mime.startsWith("audio/")) return "🎵";
    if (mime.includes("pdf")) return "📄";
    if (mime.includes("text")) return "📝";
    return "📎";
  };

  return (
    <Show when={props.isOpen && props.item}>
      <div
        ref={menuRef}
        class="action-menu"
        style={`
          position: fixed;
          top: ${adjustedPosition().y}px;
          left: ${adjustedPosition().x}px;
          background: #2a2a2a;
          border: 1px solid #444444;
          border-radius: 6px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
          z-index: 1000;
          min-width: 180px;
          overflow: hidden;
          backdrop-filter: blur(10px);
        `}
        onClick={(e) => e.stopPropagation()}
      >
        <Show when={props.item}>
          {(item) => (
            <>
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
                <span>{getFileTypeIcon(item())}</span>
                <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  {getDisplayFilename(item())}
                </span>
              </div>

              {/* Menu Items */}
              <div style="padding: 4px 0;">
                {/* Preview */}
                <button
                  class="action-menu-item"
                  onClick={handlePreview}
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
                  <span>👁️</span>
                  <span>Preview</span>
                </button>

                {/* Download */}
                <button
                  class="action-menu-item"
                  onClick={handleDownload}
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
                  <span>Download</span>
                </button>

                {/* Copy URL */}
                <button
                  class="action-menu-item"
                  onClick={handleCopyUrl}
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
                  <span>🔗</span>
                  <span>Copy URL</span>
                </button>

                {/* Separator */}
                <div
                  style={`
                    height: 1px;
                    background: #444444;
                    margin: 4px 8px;
                  `}
                />

                {/* Delete */}
                <button
                  class="action-menu-item"
                  onClick={handleDelete}
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
                  <span>Delete</span>
                </button>
              </div>
            </>
          )}
        </Show>
      </div>
    </Show>
  );
}
