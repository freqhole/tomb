import { createSignal, createMemo, Show, onMount } from "solid-js";
import type { MediaBlob } from "../../../lib/websocket-types";
import {
  getThumbnailFallbackIcon,
  createDataUrl,
} from "../../../lib/media-utils";

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
  const [imageError, setImageError] = createSignal(false);
  const [autoRequested, setAutoRequested] = createSignal(false);

  const size = () => props.size || 40;
  const borderRadius = () => props.borderRadius || "4px";

  // Extract thumbnails from metadata using the exact working pattern
  const thumbnails = createMemo(() => {
    return (props.item.metadata?.thumbnails as MediaBlob[]) || [];
  });

  const hasThumbnails = createMemo(() => {
    return (
      props.item.metadata?.has_thumbnails === true || thumbnails().length > 0
    );
  });

  const isRequested = createMemo(() => {
    return (
      props.requestedThumbnails?.has(props.item.id) ||
      props.item.metadata?.thumbnails_requested ||
      autoRequested()
    );
  });

  // Get thumbnail URL using the exact working pattern from MediaBlobFeedItem
  const thumbnailUrl = createMemo(() => {
    if (imageError()) return null;

    const thumbs = thumbnails();
    if (thumbs.length > 0 && thumbs[0]) {
      const thumbnail = thumbs[0];
      // Use binary data to create data URL (primary approach)
      if (thumbnail.data && thumbnail.data.length > 0) {
        const mimeType = thumbnail.mime || "image/webp";
        return createDataUrl(thumbnail.data, mimeType);
      }
    }

    return null;
  });

  // Auto-request thumbnails for supported media types
  onMount(() => {
    const alreadyRequested =
      props.requestedThumbnails?.has(props.item.id) ||
      props.item.metadata?.thumbnails_requested;

    // Auto-request thumbnails if we don't have them yet
    if (!hasThumbnails() && !alreadyRequested && props.onRequestThumbnails) {
      setAutoRequested(true);
      props.onRequestThumbnails(props.item.id);
    }
  });

  const handleImageError = () => {
    setImageError(true);
  };

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
      {thumbnailUrl() && !imageError() ? (
        <img
          src={thumbnailUrl()!}
          alt={`Thumbnail for ${props.item.id.slice(0, 8)}`}
          style="width: 100%; height: 100%; object-fit: cover;"
          loading="lazy"
          onError={handleImageError}
        />
      ) : (
        <span style="color: #94a3b8;">
          {getThumbnailFallbackIcon(props.item.mime)}
        </span>
      )}

      {/* Status indicators */}
      <Show when={props.showIndicators !== false}>
        {hasThumbnails() ? (
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
        ) : isRequested() ? (
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
