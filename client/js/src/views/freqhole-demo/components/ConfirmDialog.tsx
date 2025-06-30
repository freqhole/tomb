/* @jsxImportSource solid-js */
import { Show, onMount, onCleanup } from "solid-js";

import { getDisplayFilename } from "../../../lib/media-utils";
import { useFreqholeStateContext } from "../context/FreqholeStateContext";

export function ConfirmDialog() {
  const state = useFreqholeStateContext();
  let dialogRef: HTMLDivElement | undefined;
  let confirmButtonRef: HTMLButtonElement | undefined;

  // Focus management
  onMount(() => {
    if (state.confirmDialog()?.isOpen && confirmButtonRef) {
      // Focus the confirm button when dialog opens
      setTimeout(() => confirmButtonRef?.focus(), 100);
    }
  });

  // Keyboard handling
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!state.confirmDialog()?.isOpen) return;

    if (e.key === "Escape") {
      e.preventDefault();
      state.setConfirmDialog(null);
    } else if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      state.confirmDialog()?.onConfirm?.();
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown, true);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown, true);
  });

  // Click outside to close
  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === dialogRef) {
      state.setConfirmDialog(null);
    }
  };

  const confirmStyle = "danger";
  const confirmText = "Confirm";
  const cancelText = "Cancel";

  return (
    <Show when={state.confirmDialog()?.isOpen}>
      <div
        ref={dialogRef}
        class="confirm-dialog-backdrop"
        onClick={handleBackdropClick}
        style={`
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          backdrop-filter: blur(4px);
          animation: fadeIn 0.15s ease-out;
        `}
      >
        <div
          class="confirm-dialog"
          style={`
            background: #1a1a1a;
            border: 1px solid #3a3a3a;
            border-radius: 12px;
            padding: 24px;
            max-width: 500px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
            animation: slideIn 0.2s ease-out;
          `}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div style="margin-bottom: 16px;">
            <h2
              style={`
                margin: 0 0 8px 0;
                font-size: 20px;
                font-weight: 600;
                color: ${confirmStyle === "danger" ? "#ef4444" : "#ffffff"};
                display: flex;
                align-items: center;
                gap: 8px;
              `}
            >
              <span style="font-size: 24px;">
                {confirmStyle === "danger" ? "⚠️" : "❓"}
              </span>
              {state.confirmDialog()?.title || "Confirm Action"}
            </h2>
          </div>

          {/* Message */}
          <div
            style={`
              margin-bottom: 20px;
              color: #e0e0e0;
              line-height: 1.5;
              font-size: 14px;
            `}
          >
            {state.confirmDialog()?.message || "Are you sure?"}
          </div>

          {/* Items List (if provided) */}
          <Show
            when={
              state.confirmDialog()?.items &&
              (state.confirmDialog()?.items?.length || 0) > 0
            }
          >
            <div
              style={`
                margin-bottom: 20px;
                max-height: 200px;
                overflow-y: auto;
                border: 1px solid #333;
                border-radius: 4px;
                background: #0a0a0a;
              `}
            >
              {/* Header for items list */}
              <div
                style={`
                  padding: 8px 12px;
                  background: #1a1a1a;
                  border-bottom: 1px solid #333;
                  font-size: 12px;
                  color: #888;
                  font-weight: 500;
                `}
              >
                Files to be affected (
                {state.confirmDialog()?.items?.length || 0}):
              </div>

              {/* Items */}
              {state.confirmDialog()?.items?.map((item) => (
                <div
                  style={`
                    padding: 8px 12px;
                    border-bottom: 1px solid #1a1a1a;
                    font-size: 13px;
                    color: #ccc;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                  `}
                >
                  <span style="font-size: 16px;">📄</span>
                  <span
                    style={`
                      flex: 1;
                      overflow: hidden;
                      text-overflow: ellipsis;
                      white-space: nowrap;
                    `}
                  >
                    {getDisplayFilename(item)}
                  </span>
                  <span style="font-size: 11px; color: #666;">
                    {item.size ? `${Math.round(item.size / 1024)}KB` : ""}
                  </span>
                </div>
              ))}
            </div>
          </Show>

          {/* Warning for bulk deletes */}
          <Show
            when={
              state.confirmDialog()?.items &&
              (state.confirmDialog()?.items?.length || 0) > 1
            }
          >
            <div
              style={`
                margin-bottom: 20px;
                padding: 12px;
                background: rgba(239, 68, 68, 0.1);
                border: 1px solid rgba(239, 68, 68, 0.3);
                border-radius: 6px;
                color: #ef4444;
                font-size: 13px;
                display: flex;
                align-items: center;
                gap: 8px;
              `}
            >
              <span style="font-size: 18px;">⚠️</span>
              <span>
                This action cannot be undone. All{" "}
                {state.confirmDialog()?.items?.length || 0} files will be
                permanently deleted.
              </span>
            </div>
          </Show>

          {/* Actions */}
          <div
            style={`
              display: flex;
              gap: 12px;
              justify-content: flex-end;
            `}
          >
            <button
              onClick={() => state.setConfirmDialog(null)}
              style={`
                padding: 10px 20px;
                background: #333;
                border: 1px solid #555;
                color: #fff;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
                transition: all 0.15s ease;
              `}
            >
              {cancelText}
            </button>
            <button
              ref={confirmButtonRef}
              onClick={() => state.confirmDialog()?.onConfirm?.()}
              style={`
                padding: 10px 20px;
                background: ${confirmStyle === "danger" ? "#ef4444" : "#ff00ff"};
                border: 1px solid ${confirmStyle === "danger" ? "#dc2626" : "#dd00dd"};
                color: #ffffff;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 600;
                transition: all 0.15s ease;
              `}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: scale(0.9) translateY(-20px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }

        .confirm-dialog-backdrop button:hover {
          transform: translateY(-1px);
          filter: brightness(1.1);
        }

        .confirm-dialog-backdrop button:active {
          transform: translateY(0);
        }

        .confirm-dialog-backdrop button:focus {
          outline: 2px solid #ff00ff;
          outline-offset: 2px;
        }

        /* Scrollbar styling for items list */
        .confirm-dialog div::-webkit-scrollbar {
          width: 6px;
        }

        .confirm-dialog div::-webkit-scrollbar-track {
          background: #1a1a1a;
        }

        .confirm-dialog div::-webkit-scrollbar-thumb {
          background: #444;
          border-radius: 3px;
        }

        .confirm-dialog div::-webkit-scrollbar-thumb:hover {
          background: #666;
        }
      `}</style>
    </Show>
  );
}

export default ConfirmDialog;
