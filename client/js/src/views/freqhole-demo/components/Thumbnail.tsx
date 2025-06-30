import { Show } from "solid-js";
import type { MediaBlob } from "../../../lib/websocket-types";
import { useThumbnail } from "../../../hooks/useThumbnail";

export interface ThumbnailProps {
  item: MediaBlob;
  size?: number;
  apiBaseUrl?: string;
  onRequestThumbnails?: (itemId: string) => void;
  showIndicators?: boolean;
  className?: string;
  borderRadius?: string;
  requestedThumbnails?: Set<string>;
}

export function Thumbnail(props: ThumbnailProps) {
  const size = () => props.size || 40;
  const borderRadius = () => props.borderRadius || "4px";

  // Use the shared thumbnail hook with the proven working pattern
  const thumbnail = useThumbnail({
    item: props.item,
    onRequestThumbnails: props.onRequestThumbnails,
    requestedThumbnails: props.requestedThumbnails,
    autoRequest: true,
  });

  return (
    <div
      class={`thumbnail ${props.className || ""}`}
      style={`
        width: ${size()}px;
        height: ${size()}px;
        border-radius: ${borderRadius()};
        overflow: hidden;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: ${Math.max(12, size() * 0.3)}px;
        position: relative;
        flex-shrink: 0;
      `}
      title={`${props.item.mime || "unknown"} - ${props.item.id.slice(0, 8)}`}
    >
      {thumbnail.url ? (
        <img
          src={thumbnail.url}
          alt={`Thumbnail for ${props.item.id.slice(0, 8)}`}
          style="width: 100%; height: 100%; object-fit: cover;"
          loading="lazy"
          onError={thumbnail.onImageError}
        />
      ) : (
        <span style="color: #94a3b8;">{thumbnail.fallbackIcon}</span>
      )}

      {/* Status indicators */}
      <Show when={props.showIndicators !== false}>
        {thumbnail.hasThumbnails ? (
          <div
            style={`
              position: absolute;
              bottom: 2px;
              right: 2px;
              width: ${Math.max(6, size() * 0.15)}px;
              height: ${Math.max(6, size() * 0.15)}px;
              background: #10b981;
              border-radius: 50%;
              border: 1px solid #ffffff;
              box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
            `}
            title="Has thumbnails"
          />
        ) : thumbnail.isRequested ? (
          <div
            style={`
              position: absolute;
              bottom: 2px;
              right: 2px;
              width: ${Math.max(6, size() * 0.15)}px;
              height: ${Math.max(6, size() * 0.15)}px;
              background: #f59e0b;
              border-radius: 50%;
              border: 1px solid #ffffff;
              box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
              animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
            `}
            title="Generating thumbnails..."
          />
        ) : null}
      </Show>

      <style>{`
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `}</style>
    </div>
  );
}

export default Thumbnail;
