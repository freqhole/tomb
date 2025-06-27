/**
 * Media Blob Feed Item Component
 *
 * A reusable component that displays a single media blob item in the feed.
 * Supports different display modes and handles media preview.
 */

/* @jsxImportSource solid-js */
import { Show, createMemo } from "solid-js";
import type { MediaBlob } from "../../lib/websocket-types.js";

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
  onItemClick?: (item: MediaBlob) => void;
  className?: string;
}

export function MediaBlobFeedItemComponent(props: MediaBlobFeedItemProps) {
  const mode = () => props.mode || "default";
  const isCompact = () => mode() === "compact";
  const isDetailed = () => mode() === "detailed";

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
    return `/api/media-blobs/${props.item.id}/download`;
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
    if (props.onItemClick) {
      props.onItemClick(props.item);
    }
  };

  return (
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
        }}
      >
        <Show
          when={previewUrl()}
          fallback={
            <span style={{ "font-size": isCompact() ? "16px" : "20px" }}>
              {getFileTypeIcon(props.item.mime_type)}
            </span>
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
              <span title="Created">{formatDate(props.item.created_at)}</span>
            </Show>
          </div>
        </Show>

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
  );
}

export default MediaBlobFeedItemComponent;
