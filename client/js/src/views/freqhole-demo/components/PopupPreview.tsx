/* @jsxImportSource solid-js */
import { Show, onMount, onCleanup } from "solid-js";
import { getDisplayFilename } from "../../../lib/media-utils";
import { formatBytes } from "../../../lib/format-utils";
import { useFreqholeStateContext } from "../context/FreqholeStateContext";

export function PopupPreview() {
  const state = useFreqholeStateContext();
  let overlayRef: HTMLDivElement | undefined;

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      state.setPopupPreview(null);
    }
  };

  const handleOverlayClick = (event: MouseEvent) => {
    // Close if clicking on the backdrop (not the content)
    if (event.target === overlayRef) {
      event.preventDefault();
      event.stopPropagation();
      state.setPopupPreview(null);
    }
  };

  onMount(() => {
    if (state.popupPreview()?.isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      document.addEventListener("click", handleOverlayClick);
      document.body.style.overflow = "hidden";
    }
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown, true);
    // Restore body scroll
    document.body.style.overflow = "";
  });

  // Update event listeners when popup state changes
  const updateEventListeners = () => {
    if (state.popupPreview()?.isOpen) {
      document.addEventListener("keydown", handleKeyDown, true);
      document.addEventListener("click", handleOverlayClick, true);
      document.body.style.overflow = "hidden";
    } else {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("click", handleOverlayClick, true);
      document.body.style.overflow = "";
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

  return (
    <Show when={state.popupPreview()?.isOpen && state.popupPreview()?.item}>
      <div
        ref={overlayRef}
        class="popup-overlay"
        onClick={handleOverlayClick}
        style={`
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(4px);
        `}
      >
        <div
          class="popup-content"
          style={`
            background: #2a2a2a;
            border-radius: 8px;
            padding: 24px;
            position: relative;
            max-width: 80vw;
            max-height: 80vh;
            overflow: auto;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          `}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close Button */}
          <button
            class="popup-close"
            onClick={() => state.setPopupPreview(null)}
            style={`
              position: absolute;
              top: 12px;
              right: 12px;
              background: #ef4444;
              border: none;
              color: #ffffff;
              width: 32px;
              height: 32px;
              border-radius: 50%;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 16px;
              font-weight: bold;
              z-index: 1001;
              transition: background 0.2s;
            `}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.background = "#dc2626";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.background = "#ef4444";
            }}
          >
            ×
          </button>

          <Show when={state.popupPreview()?.item}>
            {(item) => {
              const mimeType = item().mime || "";
              const isImage = mimeType.startsWith("image/");
              const isVideo = mimeType.startsWith("video/");
              const isAudio = mimeType.startsWith("audio/");
              const filename = getDisplayFilename(item());

              return (
                <>
                  {/* Media Content */}
                  <div
                    style={`
                      text-align: center;
                      margin-bottom: 24px;
                    `}
                  >
                    <Show when={isImage}>
                      <img
                        class="popup-image"
                        src={`/api/blobs/${item().id}`}
                        alt={filename}
                        style={`
                          max-width: 80vw;
                          max-height: 70vh;
                          object-fit: contain;
                          border-radius: 4px;
                        `}
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = "none";
                          // Show error message
                          const errorDiv = document.createElement("div");
                          errorDiv.innerHTML = `
                            <div style="padding: 40px; text-align: center; color: #ef4444;">
                              <div style="font-size: 3rem; margin-bottom: 1rem;">❌</div>
                              <div>Failed to load image</div>
                              <div style="font-size: 12px; margin-top: 8px; color: #888;">${filename}</div>
                            </div>
                          `;
                          target.parentNode?.appendChild(errorDiv);
                        }}
                      />
                    </Show>

                    <Show when={isVideo}>
                      <video
                        class="popup-video"
                        controls
                        preload="metadata"
                        style={`
                          max-width: 80vw;
                          max-height: 70vh;
                          border-radius: 4px;
                        `}
                      >
                        <source
                          src={`/api/blobs/${item().id}`}
                          type={mimeType}
                        />
                        Your browser does not support video playback.
                      </video>
                    </Show>

                    <Show when={isAudio}>
                      <div
                        style={`
                          display: flex;
                          flex-direction: column;
                          align-items: center;
                          gap: 16px;
                          padding: 40px;
                        `}
                      >
                        <div style="font-size: 4rem;">🎵</div>
                        <div style="font-size: 18px; font-weight: 600; color: #e0e0e0;">
                          {filename}
                        </div>
                        <audio controls style="width: 100%; max-width: 400px;">
                          <source
                            src={`/api/blobs/${item().id}`}
                            type={mimeType}
                          />
                          Your browser does not support audio playback.
                        </audio>
                      </div>
                    </Show>

                    <Show when={!isImage && !isVideo && !isAudio}>
                      <div
                        style={`
                          padding: 40px;
                          text-align: center;
                          color: #b0b0b0;
                        `}
                      >
                        <div style="font-size: 3rem; margin-bottom: 1rem;">
                          📎
                        </div>
                        <div>File preview not available</div>
                        <div style="margin-top: 16px;">
                          <a
                            href={`/api/blobs/${item().id}`}
                            target="_blank"
                            style={`
                              padding: 8px 16px;
                              background: #ff00ff;
                              color: #000000;
                              text-decoration: none;
                              border-radius: 4px;
                              font-weight: 600;
                            `}
                          >
                            Download File
                          </a>
                        </div>
                      </div>
                    </Show>
                  </div>

                  {/* Metadata */}
                  <div
                    class="popup-meta"
                    style={`
                      border-top: 1px solid #444444;
                      padding-top: 16px;
                      font-size: 14px;
                      color: #e0e0e0;
                    `}
                  >
                    <h3 style="margin: 0 0 16px 0; font-size: 16px; color: #ffffff;">
                      File Information
                    </h3>

                    <div
                      class="popup-meta-grid"
                      style="display: grid; gap: 8px;"
                    >
                      <div
                        class="popup-meta-row"
                        style="display: flex; justify-content: space-between;"
                      >
                        <span style="font-weight: 600;">Name:</span>
                        <span style="word-break: break-all; text-align: right; max-width: 60%;">
                          {filename}
                        </span>
                      </div>

                      <div
                        class="popup-meta-row"
                        style="display: flex; justify-content: space-between;"
                      >
                        <span style="font-weight: 600;">ID:</span>
                        <span style="font-family: monospace; font-size: 12px; color: #888;">
                          {item().id}
                        </span>
                      </div>

                      <div
                        class="popup-meta-row"
                        style="display: flex; justify-content: space-between;"
                      >
                        <span style="font-weight: 600;">SHA256:</span>
                        <span style="font-family: monospace; font-size: 11px; color: #888; word-break: break-all; max-width: 60%; text-align: right;">
                          {item().sha256}
                        </span>
                      </div>

                      <div
                        class="popup-meta-row"
                        style="display: flex; justify-content: space-between;"
                      >
                        <span style="font-weight: 600;">Type:</span>
                        <span>{item().blob_type}</span>
                      </div>

                      <div
                        class="popup-meta-row"
                        style="display: flex; justify-content: space-between;"
                      >
                        <span style="font-weight: 600;">MIME:</span>
                        <span>{mimeType || "unknown"}</span>
                      </div>

                      <div
                        class="popup-meta-row"
                        style="display: flex; justify-content: space-between;"
                      >
                        <span style="font-weight: 600;">Size:</span>
                        <span>{formatBytes(item().size || 0)}</span>
                      </div>

                      <div
                        class="popup-meta-row"
                        style="display: flex; justify-content: space-between;"
                      >
                        <span style="font-weight: 600;">Created:</span>
                        <span style="font-size: 12px;">
                          {new Date(item().created_at).toLocaleString()}
                        </span>
                      </div>

                      <Show when={item().parent_blob_id}>
                        <div
                          class="popup-meta-row"
                          style="display: flex; justify-content: space-between;"
                        >
                          <span style="font-weight: 600;">Parent:</span>
                          <span style="font-family: monospace; font-size: 11px; color: #888;">
                            {item().parent_blob_id}
                          </span>
                        </div>
                      </Show>

                      <Show when={item().local_path}>
                        <div
                          class="popup-meta-row"
                          style="display: flex; justify-content: space-between;"
                        >
                          <span style="font-weight: 600;">Local Path:</span>
                          <span style="font-family: monospace; font-size: 11px; color: #888; word-break: break-all; max-width: 60%; text-align: right;">
                            {item().local_path}
                          </span>
                        </div>
                      </Show>
                    </div>
                  </div>
                </>
              );
            }}
          </Show>
        </div>
      </div>
    </Show>
  );
}
