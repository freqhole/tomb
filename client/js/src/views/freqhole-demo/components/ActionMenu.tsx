
import { Show, createSignal, onCleanup, createEffect } from "solid-js";
import type { MediaBlob } from "../../../lib/websocket-types";
import { getDisplayFilename } from "../../../lib/media-utils";
import { useFreqholeStateContext } from "../context/FreqholeStateContext";

export function ActionMenu() {
  const state = useFreqholeStateContext();
  let menuRef: HTMLDivElement | undefined;
  const [adjustedPosition, setAdjustedPosition] = createSignal({ x: 0, y: 0 });

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      state.setActionMenu(null);
    }
  };

  const handleGlobalClick = (event: MouseEvent) => {
    if (menuRef && !menuRef.contains(event.target as Node)) {
      event.preventDefault();
      event.stopPropagation();
      state.setActionMenu(null);
    }
  };

  const calculatePosition = () => {
    if (!menuRef) return;

    const menuWidth = 180;
    const menuHeight = 160;
    const position = state.actionMenu()?.position;
    if (!position) return;

    const { x, y } = position;

    // Calculate optimal position with viewport edge detection
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
    if (state.actionMenu()?.isOpen) {
      document.addEventListener("keydown", handleKeyDown, true);
      document.addEventListener("mousedown", handleGlobalClick, true);
      // Calculate position after effect runs
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

  const handleDownload = async () => {
    const item = state.actionMenu()?.item;
    if (!item) return;

    try {
      const filename = getDisplayFilename(item);
      const link = document.createElement("a");
      link.href = `/api/blobs/${item.id}`;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      console.log(`📥 Downloaded: ${filename}`);
    } catch (error) {
      console.error("Download failed:", error);
    }
    state.setActionMenu(null);
  };

  const handlePreview = () => {
    const item = state.actionMenu()?.item;
    if (!item) return;

    state.setPopupPreview({ item, isOpen: true });
    state.setActionMenu(null);
  };

  const handleDelete = () => {
    const item = state.actionMenu()?.item;
    if (!item) return;

    state.setConfirmDialog({
      isOpen: true,
      title: "Delete File",
      message: `Are you sure you want to delete this file? This action cannot be undone.`,
      items: [item],
      onConfirm: () => {
        // TODO: Implement actual delete API call
        console.log(`🗑️ Deleted: ${getDisplayFilename(item)}`);
        state.setConfirmDialog(null);
      },
    });
    state.setActionMenu(null);
  };

  const handleCopyUrl = async () => {
    const item = state.actionMenu()?.item;
    if (!item) return;

    try {
      const url = `${window.location.origin}/api/blobs/${item.id}`;
      await navigator.clipboard.writeText(url);
      console.log(`🔗 Copied URL for: ${getDisplayFilename(item)}`);
    } catch (error) {
      console.error("Copy URL failed:", error);
    }
    state.setActionMenu(null);
  };

  const getFileTypeIcon = (item: MediaBlob): string => {
    const mime = item.mime || "";
    if (mime.startsWith("image/")) return "🖼️";
    if (mime.startsWith("video/")) return "🎥";
    if (mime.startsWith("audio/")) return "🎵";
    if (mime.includes("pdf")) return "📄";
    if (mime.includes("text")) return "📝";
    return "📄";
  };

  return (
    <Show when={state.actionMenu()?.isOpen && state.actionMenu()?.item}>
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
          min-width: 180px;
          overflow: hidden;
          animation: slideIn 0.15s ease-out;
        `}
        onClick={(e) => e.stopPropagation()}
      >
        <Show when={state.actionMenu()?.item}>
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

                {/* Divider */}
                <div style="height: 1px; background: #444; margin: 4px 0;"></div>

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
                    (e.target as HTMLElement).style.background = "#2a1a1a";
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

          .action-menu-item:hover {
            background: #3a3a3a !important;
          }

          .action-menu-item:active {
            background: #444 !important;
          }
        `}</style>
      </div>
    </Show>
  );
}
