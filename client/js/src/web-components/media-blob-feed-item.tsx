/**
 * Media Blob Feed Item Component
 *
 * Displays a single media blob item in the feed with thumbnail, metadata,
 * loading states, and placeholder support.
 */

/* @jsxImportSource solid-js */
import { customElement } from "solid-element";
import { createSignal, createEffect, Show } from "solid-js";
import type { MediaBlob } from "../lib/websocket-types.js";
import { BlobClient } from "../lib/blob-client.js";

export interface MediaBlobFeedItemProps {
  /** The media blob to display */
  blob: MediaBlob;
  /** Show thumbnail (default: true) */
  showThumbnail?: boolean;
  /** Show metadata (default: true) */
  showMetadata?: boolean;
  /** Show timestamps (default: true) */
  showTimestamps?: boolean;
  /** Compact display mode (default: false) */
  compact?: boolean;
  /** Enable click to view full size (default: true) */
  clickable?: boolean;
  /** Custom CSS class */
  className?: string;
  /** Thumbnail size in pixels (default: 120) */
  thumbnailSize?: number;
  /** Show loading placeholder while thumbnail loads */
  showLoadingPlaceholder?: boolean;
  /** Base URL for blob API (default: current origin) */
  baseUrl?: string;
  /** Enable inline blob viewer expansion (default: true) */
  enableInlineViewer?: boolean;
}

interface ThumbnailState {
  loading: boolean;
  error: boolean;
  url: string | null;
}

function MediaBlobFeedItemComponent(props: MediaBlobFeedItemProps) {
  const [thumbnailState, setThumbnailState] = createSignal<ThumbnailState>({
    loading: true,
    error: false,
    url: null,
  });

  const [expanded, setExpanded] = createSignal(false);
  const [blobViewerLoading, setBlobViewerLoading] = createSignal(false);
  const [blobViewerError, setBlobViewerError] = createSignal<string | null>(
    null
  );

  const blobClient = new BlobClient({
    baseUrl: props.baseUrl || window.location.origin,
  });

  const showThumbnail = () => props.showThumbnail !== false;
  const showMetadata = () => props.showMetadata !== false;
  const showTimestamps = () => props.showTimestamps !== false;
  const compact = () => props.compact || false;
  const clickable = () => props.clickable !== false;
  const thumbnailSize = () => props.thumbnailSize || 120;
  const showLoadingPlaceholder = () => props.showLoadingPlaceholder !== false;
  const enableInlineViewer = () => props.enableInlineViewer !== false;

  const formatFileSize = (size?: number): string => {
    if (!size) return "Unknown size";

    const units = ["B", "KB", "MB", "GB"];
    let unitIndex = 0;
    let fileSize = size;

    while (fileSize >= 1024 && unitIndex < units.length - 1) {
      fileSize /= 1024;
      unitIndex++;
    }

    return `${fileSize.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
  };

  const formatTimestamp = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 1) return "Just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;

      return date.toLocaleDateString();
    } catch {
      return "Unknown time";
    }
  };

  const getMimeTypeIcon = (mimeType?: string): string => {
    if (!mimeType) return "📄";

    if (mimeType.startsWith("image/")) return "🖼️";
    if (mimeType.startsWith("video/")) return "🎬";
    if (mimeType.startsWith("audio/")) return "🎵";
    if (mimeType.includes("pdf")) return "📋";
    if (mimeType.includes("text")) return "📝";

    return "📄";
  };

  const loadThumbnail = async () => {
    if (!showThumbnail()) return;

    setThumbnailState({ loading: true, error: false, url: null });

    try {
      // Try to load thumbnail from server
      // First check if there's a thumbnail endpoint available
      const thumbnailUrl = `/api/v1/media_blobs/${props.blob.id}/thumbnail`;

      const response = await fetch(thumbnailUrl, {
        method: "HEAD", // Check if thumbnail exists
        credentials: "include",
      });

      if (response.ok) {
        setThumbnailState({
          loading: false,
          error: false,
          url: thumbnailUrl,
        });
      } else {
        // No thumbnail available, show placeholder
        setThumbnailState({
          loading: false,
          error: false,
          url: null,
        });
      }
    } catch (error) {
      console.warn("Failed to load thumbnail for", props.blob.id, error);
      setThumbnailState({
        loading: false,
        error: true,
        url: null,
      });
    }
  };

  const handleItemClick = () => {
    if (!clickable()) return;

    if (enableInlineViewer()) {
      toggleExpanded();
    } else {
      // Emit custom event for parent components to handle
      const event = new CustomEvent("media-blob-click", {
        detail: { blob: props.blob },
        bubbles: true,
      });
      // Dispatch from the component element
      const element = document.querySelector(
        `[data-blob-id="${props.blob.id}"]`
      );
      element?.dispatchEvent(event);
    }
  };

  const toggleExpanded = () => {
    setExpanded(!expanded());
    if (!expanded()) {
      setBlobViewerError(null);
    }
  };

  const handleViewBlob = async (e: Event) => {
    e.stopPropagation();
    if (!enableInlineViewer()) {
      // Open blob in new tab/window
      window.open(`/api/blobs/${props.blob.id}`, "_blank");
      return;
    }

    setBlobViewerLoading(true);
    setBlobViewerError(null);
    setExpanded(true);

    try {
      // Pre-load blob to check if it exists
      await blobClient.getBlobMetadata(props.blob.id);
    } catch (error) {
      setBlobViewerError(`Failed to load blob: ${error}`);
    } finally {
      setBlobViewerLoading(false);
    }
  };

  const handleDownloadBlob = async (e: Event) => {
    e.stopPropagation();
    try {
      const filename =
        (props.blob.metadata as any)?.filename || `blob-${props.blob.id}`;
      await blobClient.downloadBlob(props.blob.id, filename);
    } catch (error) {
      console.error("Download failed:", error);
      // Could emit an error event here
    }
  };

  const copyBlobId = async (e: Event) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(props.blob.id);
      // Could show a toast notification here
    } catch (error) {
      console.error("Failed to copy blob ID:", error);
    }
    const element = document.querySelector(`[data-blob-id="${props.blob.id}"]`);
    element?.dispatchEvent(event);
  };

  const handleThumbnailLoad = () => {
    setThumbnailState((prev) => ({ ...prev, loading: false }));
  };

  const handleThumbnailError = () => {
    setThumbnailState((prev) => ({ ...prev, loading: false, error: true }));
  };

  // Load thumbnail when component mounts or blob changes
  createEffect(() => {
    if (props.blob?.id) {
      loadThumbnail();
    }
  });

  return (
    <div
      class={`media-blob-feed-item ${compact() ? "compact" : ""} ${
        clickable() ? "clickable" : ""
      } ${props.className || ""}`}
      data-blob-id={props.blob.id}
      onClick={handleItemClick}
      style={{
        display: "flex",
        "flex-direction": compact() ? "row" : "column",
        gap: compact() ? "12px" : "8px",
        padding: compact() ? "8px" : "12px",
        border: "1px solid #e2e8f0",
        "border-radius": "8px",
        "background-color": "#ffffff",
        cursor: clickable() ? "pointer" : "default",
        transition: "all 0.2s ease",
        ...(clickable() && {
          ":hover": {
            "box-shadow": "0 2px 8px rgba(0, 0, 0, 0.1)",
            transform: "translateY(-1px)",
          },
        }),
      }}
    >
      <style>{`
        .media-blob-feed-item.clickable:hover {
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          transform: translateY(-1px);
        }

        .media-blob-feed-item .thumbnail-container {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          overflow: hidden;
          background-color: #f8fafc;
          border: 1px solid #e2e8f0;
        }

        .media-blob-feed-item .thumbnail-loading {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }

        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: .5;
          }
        }

        .media-blob-feed-item .metadata {
          font-size: 12px;
          color: #6b7280;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .media-blob-feed-item .metadata-item {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .media-blob-feed-item.compact .content {
          flex: 1;
          min-width: 0;
        }

        .media-blob-feed-item .title {
          font-weight: 500;
          color: #111827;
          margin: 0 0 4px 0;
          font-size: 14px;
          word-break: break-all;
        }

        .media-blob-feed-item.compact .title {
          font-size: 13px;
          margin: 0 0 2px 0;
        }
      `}</style>

      {/* Thumbnail Section */}
      <Show when={showThumbnail()}>
        <div
          class="thumbnail-container"
          style={{
            width: `${thumbnailSize()}px`,
            height: `${thumbnailSize()}px`,
            "min-width": `${thumbnailSize()}px`,
            "min-height": `${thumbnailSize()}px`,
          }}
        >
          <Show
            when={!thumbnailState().loading && thumbnailState().url}
            fallback={
              <div
                class={`thumbnail-placeholder ${
                  thumbnailState().loading && showLoadingPlaceholder()
                    ? "thumbnail-loading"
                    : ""
                }`}
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "center",
                  "font-size": compact() ? "24px" : "32px",
                  color: "#9ca3af",
                }}
              >
                {thumbnailState().loading
                  ? "⏳"
                  : getMimeTypeIcon(props.blob.mime)}
              </div>
            }
          >
            <img
              src={thumbnailState().url!}
              alt={`Thumbnail for ${props.blob.sha256.slice(0, 8)}`}
              style={{
                width: "100%",
                height: "100%",
                "object-fit": "cover",
              }}
              onLoad={handleThumbnailLoad}
              onError={handleThumbnailError}
            />
          </Show>
        </div>
      </Show>

      {/* Content Section */}
      <div
        class="content"
        style={{ flex: compact() ? "1" : "auto", "min-width": "0" }}
      >
        <div
          style={{
            display: "flex",
            "justify-content": "space-between",
            "align-items": "flex-start",
            gap: "8px",
          }}
        >
          <div style={{ flex: "1", "min-width": "0" }}>
            {/* Title */}
            <h3 class="title">
              {props.blob.local_path?.split("/").pop() ||
                `${props.blob.sha256.slice(0, 8)}...${props.blob.sha256.slice(-4)}`}
            </h3>

            {/* Metadata */}
            <Show when={showMetadata()}>
              <div class="metadata">
                <div class="metadata-item">
                  <span>{getMimeTypeIcon(props.blob.mime)}</span>
                  <span>{props.blob.mime || "Unknown type"}</span>
                </div>

                <Show when={props.blob.size}>
                  <div class="metadata-item">
                    <span>📏</span>
                    <span>{formatFileSize(props.blob.size)}</span>
                  </div>
                </Show>

                <Show when={props.blob.source_client_id}>
                  <div class="metadata-item">
                    <span>📱</span>
                    <span title={props.blob.source_client_id}>
                      {props.blob.source_client_id?.slice(0, 8)}...
                    </span>
                  </div>
                </Show>
              </div>
            </Show>

            {/* Timestamps */}
            <Show when={showTimestamps()}>
              <div
                style={{
                  "margin-top": "4px",
                  "font-size": "11px",
                  color: "#9ca3af",
                }}
              >
                <Show
                  when={props.blob.created_at !== props.blob.updated_at}
                  fallback={
                    <span>Added {formatTimestamp(props.blob.created_at)}</span>
                  }
                >
                  <span>
                    Added {formatTimestamp(props.blob.created_at)} • Updated{" "}
                    {formatTimestamp(props.blob.updated_at)}
                  </span>
                </Show>
              </div>
            </Show>
          </div>

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: "4px", "flex-shrink": "0" }}>
            <button
              onClick={handleViewBlob}
              style={{
                padding: "4px 8px",
                "font-size": "12px",
                border: "1px solid #d1d5db",
                "border-radius": "4px",
                "background-color": "#f9fafb",
                cursor: "pointer",
                display: "flex",
                "align-items": "center",
                gap: "4px",
              }}
              title="View blob content"
            >
              👁️ {expanded() ? "Hide" : "View"}
            </button>
            <button
              onClick={handleDownloadBlob}
              style={{
                padding: "4px 8px",
                "font-size": "12px",
                border: "1px solid #d1d5db",
                "border-radius": "4px",
                "background-color": "#f9fafb",
                cursor: "pointer",
                display: "flex",
                "align-items": "center",
                gap: "4px",
              }}
              title="Download blob"
            >
              📥
            </button>
            <button
              onClick={copyBlobId}
              style={{
                padding: "4px 8px",
                "font-size": "12px",
                border: "1px solid #d1d5db",
                "border-radius": "4px",
                "background-color": "#f9fafb",
                cursor: "pointer",
                display: "flex",
                "align-items": "center",
                gap: "4px",
              }}
              title="Copy blob ID"
            >
              📋
            </button>
          </div>
        </div>

        {/* Expanded Blob Viewer */}
        <Show when={expanded()}>
          <div
            style={{
              "margin-top": "12px",
              padding: "12px",
              border: "1px solid #e5e7eb",
              "border-radius": "6px",
              "background-color": "#f9fafb",
            }}
          >
            <Show
              when={!blobViewerLoading() && !blobViewerError()}
              fallback={
                <div>
                  <Show when={blobViewerLoading()}>
                    <div
                      style={{
                        "text-align": "center",
                        padding: "20px",
                        color: "#6b7280",
                      }}
                    >
                      Loading blob content...
                    </div>
                  </Show>
                  <Show when={blobViewerError()}>
                    <div
                      style={{
                        padding: "12px",
                        "background-color": "#fef2f2",
                        color: "#dc2626",
                        "border-radius": "4px",
                        border: "1px solid #fecaca",
                      }}
                    >
                      {blobViewerError()}
                    </div>
                  </Show>
                </div>
              }
            >
              {/* Inline Blob Viewer */}
              <blob-viewer
                blobId={props.blob.id}
                baseUrl={props.baseUrl}
                maxWidth="100%"
                maxHeight="300px"
                showMetadata={false}
                enableDownload={false}
                autoLoad={true}
              />
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}

customElement(
  "media-blob-feed-item",
  {
    blob: {} as MediaBlob,
    showThumbnail: true,
    showMetadata: true,
    showTimestamps: true,
    compact: false,
    clickable: true,
    className: "",
    thumbnailSize: 120,
    showLoadingPlaceholder: true,
    baseUrl: undefined,
    enableInlineViewer: true,
  },
  MediaBlobFeedItemComponent
);

export default MediaBlobFeedItemComponent;
