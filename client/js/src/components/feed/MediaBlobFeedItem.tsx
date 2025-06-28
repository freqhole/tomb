/**
 * Media Blob Feed Item Component
 *
 * A reusable component that displays a single media blob item in the feed.
 * Supports different display modes, handles media preview, and displays thumbnails.
 */

/* @jsxImportSource solid-js */
import { Show, createMemo, createSignal, onMount } from "solid-js";
import type { MediaBlob } from "../../lib/websocket-types.js";
import { BlobClient } from "../../lib/index.js";

// Helper function to convert binary data to data URL
const createDataUrl = (data: number[], mimeType: string): string => {
  const uint8Array = new Uint8Array(data);
  const blob = new Blob([uint8Array], { type: mimeType });
  return URL.createObjectURL(blob);
};

// Extended interface for display properties
export interface DisplayMediaBlob extends MediaBlob {
  filename?: string;
  mime_type?: string;
  description?: string;
  tags?: string[];
}

export interface MediaBlobFeedItemProps {
  item: DisplayMediaBlob;
  mode?: "default" | "compact" | "detailed";
  showPreview?: boolean;
  showMetadata?: boolean;
  showThumbnails?: boolean;
  onItemClick?: (item: MediaBlob) => void;
  onGetThumbnails?: (mediaBlobId: string) => void;
  className?: string;
  requestedThumbnails?: Set<string>;
  enableInlineViewer?: boolean;
  baseUrl?: string;
}

export function MediaBlobFeedItemComponent(props: MediaBlobFeedItemProps) {
  const mode = () => props.mode || "default";
  const isCompact = () => mode() === "compact";
  const isDetailed = () => mode() === "detailed";

  // Thumbnail state
  const [showThumbnailPlaceholder, setShowThumbnailPlaceholder] =
    createSignal(false);

  // Blob viewer state
  const [expanded, setExpanded] = createSignal(false);
  const [blobViewerLoading, setBlobViewerLoading] = createSignal(false);
  const [blobViewerError, setBlobViewerError] = createSignal<string | null>(
    null
  );

  const blobClient = new BlobClient({
    baseUrl: props.baseUrl || window.location.origin,
  });

  const enableInlineViewer = () => props.enableInlineViewer !== false;

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString();
    } catch {
      return dateString;
    }
  };

  const getFileTypeIcon = (mimeType?: string): string => {
    if (!mimeType) return "📎";
    if (mimeType.startsWith("image/")) return "🖼️";
    if (mimeType.startsWith("video/")) return "🎥";
    if (mimeType.startsWith("audio/")) return "🎵";
    if (mimeType.startsWith("text/")) return "📝";
    if (mimeType.includes("pdf")) return "📄";
    return "📎";
  };

  const previewUrl = createMemo(() => {
    const mimeType = props.item.mime_type || props.item.mime || "";
    if (!props.showPreview || !mimeType.startsWith("image/")) {
      return null;
    }
    // Check if we have binary data for the original image
    if (props.item.data && props.item.data.length > 0) {
      return createDataUrl(props.item.data, mimeType);
    }
    // Fallback to HTTP endpoint if no binary data
    return `/api/media-blobs/${props.item.id}/download`;
  });

  // Thumbnail helpers
  const thumbnails = createMemo(() => {
    return (props.item.metadata?.thumbnails as MediaBlob[]) || [];
  });

  const hasThumbnails = createMemo(() => {
    return (
      props.item.metadata?.has_thumbnails === true || thumbnails().length > 0
    );
  });

  const shouldShowThumbnails = createMemo(() => {
    return props.showThumbnails !== false && !isCompact();
  });

  const handleItemClick = () => {
    if (enableInlineViewer()) {
      toggleExpanded();
    } else if (props.onItemClick) {
      props.onItemClick(props.item);
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
      window.open(`/api/blobs/${props.item.id}`, "_blank");
      return;
    }

    setBlobViewerLoading(true);
    setBlobViewerError(null);
    setExpanded(true);

    try {
      await blobClient.getBlobMetadata(props.item.id);
    } catch (error) {
      setBlobViewerError(`Failed to load blob: ${error}`);
    } finally {
      setBlobViewerLoading(false);
    }
  };

  const handleDownloadBlob = async (e: Event) => {
    e.stopPropagation();
    try {
      const filename = props.item.filename || `blob-${props.item.id}`;
      await blobClient.downloadBlob(props.item.id, filename);
    } catch (error) {
      console.error("Download failed:", error);
    }
  };

  const copyBlobId = async (e: Event) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(props.item.id);
    } catch (error) {
      console.error("Failed to copy blob ID:", error);
    }
  };

  const thumbnailPreviewUrl = createMemo(() => {
    const thumbs = thumbnails();
    const mimeType = props.item.mime_type || props.item.mime || "";
    console.log(
      `[MediaBlobFeedItem] Thumbnails for ${props.item.id.slice(0, 8)} (${mimeType}):`,
      {
        count: thumbs.length,
        hasMetadata: !!props.item.metadata,
        metadata: props.item.metadata,
        thumbnails: thumbs.map((t) => ({
          id: t.id.slice(0, 8),
          type: t.blob_type,
          mime: t.mime,
        })),
      }
    );

    if (thumbs.length > 0 && thumbs[0]) {
      const thumbnail = thumbs[0];
      console.log(`[MediaBlobFeedItem] First thumbnail:`, {
        id: thumbnail.id,
        hasData: !!thumbnail.data,
        dataLength: thumbnail.data?.length || 0,
        mime: thumbnail.mime,
        keys: Object.keys(thumbnail),
      });

      // Check if we have binary data for the thumbnail
      if (thumbnail.data && thumbnail.data.length > 0) {
        const mimeType = thumbnail.mime || "image/webp";
        const dataUrl = createDataUrl(thumbnail.data, mimeType);
        console.log(
          `[MediaBlobFeedItem] Using data URL for thumbnail ${thumbnail.id.slice(0, 8)}`
        );
        return dataUrl;
      }
      // Fallback to HTTP endpoint if no binary data
      console.log(
        `[MediaBlobFeedItem] No binary data, using API endpoint for thumbnail ${thumbnail.id.slice(0, 8)}`
      );
      return `/api/media-blobs/${thumbnail.id}/download`;
    }
    return null;
  });

  // Auto-request thumbnails for supported media types
  onMount(() => {
    const alreadyRequested =
      props.requestedThumbnails?.has(props.item.id) ||
      props.item.metadata?.thumbnails_requested;

    // Always try to get thumbnails if we don't have them yet
    // The backend will determine if thumbnails can be generated for this file type
    if (shouldShowThumbnails() && !hasThumbnails() && !alreadyRequested) {
      if (props.onGetThumbnails) {
        setShowThumbnailPlaceholder(true);
        props.onGetThumbnails(props.item.id);

        // Hide placeholder after 10 seconds if no thumbnails received
        setTimeout(() => {
          if (!hasThumbnails()) {
            setShowThumbnailPlaceholder(false);
          }
        }, 10000);
      }
    }
  });

  const itemStyles = () => ({
    display: "flex",
    gap: isCompact() ? "8px" : "12px",
    padding: isCompact() ? "8px" : "12px",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    backgroundColor: "#ffffff",
    cursor: props.onItemClick ? "pointer" : "default",
    transition: "all 0.2s ease",
    alignItems: isCompact() ? "center" : "flex-start",
  });

  const getDisplayFilename = () => {
    // Check metadata for original filename first
    if (props.item.metadata && typeof props.item.metadata === "object") {
      const meta = props.item.metadata as any;
      if (
        meta.originalName ||
        meta.filename ||
        meta.original_filename ||
        meta.file_name ||
        meta.name
      ) {
        return (
          meta.originalName ||
          meta.filename ||
          meta.original_filename ||
          meta.file_name ||
          meta.name
        );
      }
    }

    // Fallback to existing logic
    return (
      props.item.filename ||
      props.item.local_path?.split("/").pop() ||
      `${props.item.sha256.slice(0, 8)}...${props.item.sha256.slice(-4)}`
    );
  };

  const getMimeType = () => {
    return (
      props.item.mime_type || props.item.mime || "application/octet-stream"
    );
  };

  const getFileSize = () => {
    return props.item.size || 0;
  };

  const handleClick = () => {
    if (enableInlineViewer()) {
      handleItemClick();
    } else if (props.onItemClick) {
      props.onItemClick(props.item);
    }
  };

  return (
    <div style={{ display: "flex", "flex-direction": "column" }}>
      <div
        class={props.className}
        style={itemStyles()}
        onClick={handleClick}
        title={props.onItemClick ? "Click to view details" : undefined}
      >
        {/* Preview/Icon Section */}
        <div
          style={{
            "flex-shrink": 0,
            width: isCompact() ? "32px" : "48px",
            height: isCompact() ? "32px" : "48px",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "border-radius": "6px",
            "background-color": "#f8fafc",
            border: "1px solid #e2e8f0",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <Show
            when={thumbnailPreviewUrl()}
            fallback={
              <Show
                when={previewUrl()}
                fallback={
                  <Show
                    when={showThumbnailPlaceholder() && !isCompact()}
                    fallback={
                      <span
                        style={{ "font-size": isCompact() ? "16px" : "20px" }}
                      >
                        {getFileTypeIcon(props.item.mime_type)}
                      </span>
                    }
                  >
                    <div
                      style={{
                        display: "flex",
                        "align-items": "center",
                        "justify-content": "center",
                        "flex-direction": "column",
                        gap: "2px",
                        color: "#94a3b8",
                        "font-size": "10px",
                        "text-align": "center",
                      }}
                    >
                      <span
                        style={{ "font-size": isCompact() ? "12px" : "16px" }}
                      >
                        ⏳
                      </span>
                      <span>Generating...</span>
                    </div>
                  </Show>
                }
              >
                <img
                  src={previewUrl()!}
                  alt={getDisplayFilename()}
                  style={{
                    width: "100%",
                    height: "100%",
                    "object-fit": "cover",
                  }}
                  loading="lazy"
                />
              </Show>
            }
          >
            <img
              src={thumbnailPreviewUrl()!}
              alt={`Thumbnail for ${getDisplayFilename()}`}
              style={{
                width: "100%",
                height: "100%",
                "object-fit": "cover",
              }}
              loading="lazy"
            />
          </Show>

          {/* Thumbnail indicator */}
          <Show when={hasThumbnails() && !isCompact()}>
            <div
              style={{
                position: "absolute",
                top: "2px",
                right: "2px",
                width: "8px",
                height: "8px",
                "background-color": "#10b981",
                "border-radius": "50%",
                "box-shadow": "0 0 0 1px #ffffff",
              }}
              title="Has thumbnails"
            />
          </Show>

          {/* Thumbnail loading indicator */}
          <Show
            when={
              showThumbnailPlaceholder() && !hasThumbnails() && !isCompact()
            }
          >
            <div
              style={{
                position: "absolute",
                top: "2px",
                right: "2px",
                width: "8px",
                height: "8px",
                "background-color": "#f59e0b",
                "border-radius": "50%",
                "box-shadow": "0 0 0 1px #ffffff",
                animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
              }}
              title="Generating thumbnails..."
            />
          </Show>
        </div>

        {/* Content Section */}
        <div
          style={{
            flex: 1,
            "min-width": 0,
            display: "flex",
            "flex-direction": "column",
            gap: isCompact() ? "2px" : "4px",
          }}
        >
          {/* Main content and action buttons container */}
          <div
            style={{
              display: "flex",
              "justify-content": "space-between",
              "align-items": "flex-start",
              gap: "8px",
            }}
          >
            {/* File info section */}
            <div
              style={{
                flex: 1,
                "min-width": 0,
                display: "flex",
                "flex-direction": "column",
                gap: isCompact() ? "2px" : "4px",
              }}
            >
              {/* Filename */}
              <div
                style={{
                  "font-size": isCompact() ? "14px" : "16px",
                  "font-weight": "500",
                  color: "#1e293b",
                  overflow: "hidden",
                  "text-overflow": "ellipsis",
                  "white-space": isCompact() ? "nowrap" : "normal",
                  "word-break": "break-word",
                }}
                title={getDisplayFilename()}
              >
                {getDisplayFilename()}
              </div>

              {/* Metadata */}
              <Show when={!isCompact() || props.showMetadata}>
                <div
                  style={{
                    display: "flex",
                    gap: "12px",
                    "font-size": "12px",
                    color: "#64748b",
                    "flex-wrap": isCompact() ? "nowrap" : "wrap",
                  }}
                >
                  <span title="File size">{formatFileSize(getFileSize())}</span>
                  <span title="MIME type">{getMimeType()}</span>
                  <Show when={isDetailed()}>
                    <span title="Created">
                      {formatDate(props.item.created_at)}
                    </span>
                  </Show>
                </div>
              </Show>
            </div>

            {/* Action Buttons */}
            <Show when={!isCompact()}>
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
            </Show>
          </div>

          {/* Description (detailed mode only) */}
          <Show when={isDetailed() && props.item.description}>
            <div
              style={{
                "font-size": "13px",
                color: "#475569",
                "margin-top": "4px",
                "line-height": "1.4",
              }}
            >
              {props.item.description}
            </div>
          </Show>

          {/* Tags (detailed mode only) */}
          <Show
            when={isDetailed() && props.item.tags && props.item.tags.length > 0}
          >
            <div
              style={{
                display: "flex",
                gap: "4px",
                "margin-top": "4px",
                "flex-wrap": "wrap",
              }}
            >
              {props.item.tags!.map((tag) => (
                <span
                  style={{
                    "font-size": "11px",
                    padding: "2px 6px",
                    "background-color": "#e2e8f0",
                    color: "#475569",
                    "border-radius": "4px",
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </Show>

          {/* Thumbnail Gallery (detailed mode only) */}
          <Show
            when={
              isDetailed() && shouldShowThumbnails() && thumbnails().length > 0
            }
          >
            <div
              style={{
                display: "flex",
                gap: "4px",
                "margin-top": "8px",
                "flex-wrap": "wrap",
              }}
            >
              <div
                style={{
                  "font-size": "11px",
                  color: "#64748b",
                  "margin-bottom": "4px",
                  width: "100%",
                }}
              >
                Thumbnails ({thumbnails().length}):
              </div>
              {thumbnails().map((thumbnail) => {
                const thumbnailUrl =
                  thumbnail.data && thumbnail.data.length > 0
                    ? createDataUrl(
                        thumbnail.data,
                        thumbnail.mime || "image/webp"
                      )
                    : `/api/media-blobs/${thumbnail.id}/download`;

                return (
                  <div
                    style={{
                      width: "32px",
                      height: "32px",
                      "border-radius": "4px",
                      overflow: "hidden",
                      border: "1px solid #e2e8f0",
                      cursor: "pointer",
                    }}
                    title={`Thumbnail: ${thumbnail.blob_type || "thumbnail"}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      // Could open thumbnail in modal or full size
                    }}
                  >
                    <img
                      src={thumbnailUrl}
                      alt="Thumbnail"
                      style={{
                        width: "100%",
                        height: "100%",
                        "object-fit": "cover",
                      }}
                      loading="lazy"
                    />
                  </div>
                );
              })}
            </div>
          </Show>
        </div>

        {/* ID (compact mode, right-aligned) */}
        <Show when={isCompact()}>
          <div
            style={{
              "font-size": "10px",
              color: "#94a3b8",
              "font-family": "monospace",
              "flex-shrink": 0,
            }}
            title={`ID: ${props.item.id}`}
          >
            {props.item.id.slice(0, 8)}...
          </div>
        </Show>
      </div>
      DEAL WITH THIS BUT NEEDZ FLEX COLUMN
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
            {/* Inline Media Viewer */}
            <Show
              when={getMimeType().startsWith("image/")}
              fallback={
                <Show
                  when={getMimeType().startsWith("video/")}
                  fallback={
                    <Show
                      when={getMimeType().startsWith("audio/")}
                      fallback={
                        <div
                          style={{
                            padding: "20px",
                            "text-align": "center",
                            border: "2px dashed #ccc",
                            "border-radius": "8px",
                            "background-color": "#f9f9f9",
                          }}
                        >
                          <div
                            style={{
                              "font-size": "3rem",
                              "margin-bottom": "1rem",
                            }}
                          >
                            📄
                          </div>
                          <div
                            style={{
                              "font-weight": "bold",
                              "margin-bottom": "0.5rem",
                            }}
                          >
                            {getDisplayFilename()}
                          </div>
                          <div style={{ color: "#666", "font-size": "0.9rem" }}>
                            {getMimeType()} • {formatFileSize(getFileSize())}
                          </div>
                          <div style={{ "margin-top": "1rem" }}>
                            <a
                              href={`/api/blobs/${props.item.id}`}
                              target="_blank"
                              style={{
                                padding: "8px 16px",
                                "background-color": "#007bff",
                                color: "white",
                                "text-decoration": "none",
                                "border-radius": "4px",
                                "font-size": "14px",
                              }}
                            >
                              View in New Tab
                            </a>
                          </div>
                        </div>
                      }
                    >
                      {/* Audio Player */}
                      <div style={{ "text-align": "center" }}>
                        <audio
                          controls
                          style={{ width: "100%", "max-width": "400px" }}
                          preload="metadata"
                        >
                          <source
                            src={`/api/blobs/${props.item.id}`}
                            type={getMimeType()}
                          />
                          Your browser does not support audio playback.
                        </audio>
                        <div
                          style={{
                            "margin-top": "8px",
                            "font-size": "14px",
                            color: "#666",
                          }}
                        >
                          {getDisplayFilename()}
                        </div>
                      </div>
                    </Show>
                  }
                >
                  {/* Video Player */}
                  <video
                    controls
                    style={{
                      width: "100%",
                      "max-width": "100%",
                      "max-height": "300px",
                      "border-radius": "4px",
                    }}
                    preload="metadata"
                  >
                    <source
                      src={`/api/blobs/${props.item.id}`}
                      type={getMimeType()}
                    />
                    Your browser does not support video playback.
                  </video>
                </Show>
              }
            >
              {/* Image Display */}
              <img
                src={`/api/blobs/${props.item.id}`}
                alt={getDisplayFilename()}
                style={{
                  "max-width": "100%",
                  "max-height": "300px",
                  "object-fit": "contain",
                  "border-radius": "4px",
                  display: "block",
                  margin: "0 auto",
                }}
                onError={(e) => {
                  // Fallback to download link on error
                  const target = e.target as HTMLImageElement;
                  target.style.display = "none";
                  const fallback = document.createElement("div");
                  fallback.innerHTML = `
                    <div style="padding: 20px; text-align: center; border: 2px dashed #ccc; border-radius: 8px; background-color: #f9f9f9;">
                      <div style="font-size: 2rem; margin-bottom: 1rem;">❌</div>
                      <div>Failed to load image</div>
                      <div style="margin-top: 1rem;">
                        <a href="/api/blobs/${props.item.id}" target="_blank" style="padding: 8px 16px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px;">View in New Tab</a>
                      </div>
                    </div>
                  `;
                  target.parentNode?.appendChild(fallback);
                }}
              />
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
}

export default MediaBlobFeedItemComponent;
