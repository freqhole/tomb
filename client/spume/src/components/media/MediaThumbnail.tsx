// reusable media thumbnail with index overlay and play icon hover
import { createEffect, createSignal, Show, type JSX } from "solid-js";
import { getBlobObjectURL, getCachedBlobObjectURL } from "../../music/services/storage/blobs";
import {
  resolveBlobUrl,
  usesBlobResolver,
  isP2PRemoteSync,
  getCachedP2PBlobUrl,
  type ThumbnailSize,
} from "../../music/services/storage/blobResolver";
import { isCharnelAvailable } from "../../app/api/client";
import { Icon } from "../icons/registry";
import type { ImageMetadata } from "../../music/services/storage/types";
import { pickBestImage } from "../../utils/images";

/**
 * determine thumbnail size to request based on display size
 * returns undefined for sizes > 200 (use original)
 */
function getThumbnailSizeForDisplay(displaySize: number | undefined): ThumbnailSize | undefined {
  if (!displaySize) return 50; // default to small
  if (displaySize <= 50) return 50;
  if (displaySize <= 200) return 200;
  return undefined; // use original for large displays
}

/**
 * append `/thumb/{size}` to a remote url, but skip for known external image
 * services (placeholder hosts, unsplash) that don't support our path convention.
 */
function withThumbSuffix(url: string, size?: ThumbnailSize): string {
  if (!size) return url;
  const lower = url.toLowerCase();
  if (
    lower.includes("picsum.photos") ||
    lower.includes("placehold.co") ||
    lower.includes("placekitten.com") ||
    lower.includes("images.unsplash.com")
  ) {
    return url;
  }
  return `${url}/thumb/${size}`;
}

/**
 * get the URL for an image - handles local_blob_id, remote_url, P2P remotes, or legacy
 * @param thumbnailSize - optional thumbnail size for remote URLs (50 or 200)
 */
async function resolveImageUrl(
  image: ImageMetadata | null,
  legacyBlobId?: string | null,
  legacyUrl?: string | null,
  thumbnailSize?: ThumbnailSize
): Promise<string | null> {
  // priority 1: local blob ID (OPFS lookup) - thumbnails not supported locally yet
  const blobId = image?.local_blob_id || legacyBlobId;
  if (blobId) {
    return await getBlobObjectURL(blobId);
  }

  // priority 2: remote with server ID - check transport type
  if (image?.remote_blob_id && image?.remote_server_id) {
    try {
      const needsBlobResolver = await usesBlobResolver(image.remote_server_id);
      if (needsBlobResolver) {
        // P2P or tauri-managed remote - use blob resolution
        return await resolveBlobUrl(
          image.remote_blob_id,
          image.remote_server_id,
          "image",
          undefined,
          thumbnailSize
        );
      } else {
        // standard HTTP remote - use URL directly
        if (image.remote_url) {
          return withThumbSuffix(image.remote_url, thumbnailSize);
        }
      }
    } catch (err) {
      console.error("failed to resolve remote image:", err);
    }
  }

  // priority 3: just remote URL (no server ID)
  // SAFEGUARD: in charnel mode, don't use localhost URLs (stale sidecar refs)
  if (image?.remote_url) {
    if (isCharnelAvailable() && image.remote_url.includes("localhost")) {
      console.warn(
        "MediaThumbnail: skipping stale localhost URL in charnel mode:",
        image.remote_url.slice(0, 50)
      );
      return null;
    }
    return withThumbSuffix(image.remote_url, thumbnailSize);
  }

  if (legacyUrl) {
    // legacy URL - can't easily append thumbnail suffix
    return legacyUrl;
  }

  return null;
}

export interface MediaThumbnailProps {
  /** structured image metadata array (preferred) */
  images?: ImageMetadata[];
  /** thumbnail blob ID to resolve (legacy) */
  thumbnailBlobId?: string | null;
  /** thumbnail image url (legacy) */
  thumbnailUrl?: string | null;
  /** index number to display */
  index?: number;
  /** custom text to display instead of formatted index */
  indexText?: string;
  /** whether to hide the index overlay */
  hideIndex?: boolean;
  /** whether this song is the pending "up next" song (shows loading spinner instead of index) */
  isUpNext?: boolean;
  /** callback when thumbnail/play icon is clicked */
  onPlayClick?: () => void;
  /** whether to enable click handling */
  enablePlayClick?: boolean;
  /** whether to show play icon on hover (default: true) */
  showPlayIcon?: boolean;
  /** size of the thumbnail in pixels (default: 48) */
  size?: number;
  /** additional classes */
  class?: string;
}

export function MediaThumbnail(props: MediaThumbnailProps): JSX.Element {
  // determine thumbnail size to request based on display size
  const thumbnailSize = () => getThumbnailSizeForDisplay(props.size);

  // compute initial image URL synchronously to avoid first-render flicker
  const getInitialUrl = (): string | null => {
    const image = pickBestImage(props.images);
    const thumbSize = thumbnailSize();
    // priority 1: local blob (OPFS) - thumbnails not supported locally yet
    const blobId = image?.local_blob_id || props.thumbnailBlobId;
    if (blobId) return getCachedBlobObjectURL(blobId);
    // priority 2: remote with server ID - check transport type
    if (image?.remote_blob_id && image?.remote_server_id) {
      const isP2P = isP2PRemoteSync(image.remote_server_id);
      if (isP2P === true) {
        // known P2P remote - check blob cache only
        return getCachedP2PBlobUrl(image.remote_blob_id, image.remote_server_id, thumbSize);
      } else if (isP2P === false) {
        // known HTTP remote - use URL directly
        if (image.remote_url) {
          return withThumbSuffix(image.remote_url, thumbSize);
        }
      }
      // unknown transport - try P2P cache, else use URL optimistically
      const cached = getCachedP2PBlobUrl(image.remote_blob_id, image.remote_server_id, thumbSize);
      if (cached) return cached;
      if (image.remote_url) {
        return withThumbSuffix(image.remote_url, thumbSize);
      }
      return null;
    }
    // priority 3: just remote URL (no server ID)
    if (image?.remote_url) {
      return withThumbSuffix(image.remote_url, thumbSize);
    }
    if (props.thumbnailUrl) return props.thumbnailUrl;
    return null;
  };

  const [imageUrl, setImageUrl] = createSignal<string | null>(getInitialUrl());

  // resolve image URL when props change (handles async blob lookups)
  createEffect(() => {
    const image = pickBestImage(props.images);
    const thumbSize = thumbnailSize();
    resolveImageUrl(image, props.thumbnailBlobId, props.thumbnailUrl, thumbSize).then((url) => {
      if (url !== imageUrl()) setImageUrl(url);
    });
  });

  const size = () => props.size ?? null;
  const hasDimensions = () => size() != null;
  const showPlayIcon = () => props.showPlayIcon !== false;
  const displayText = () => {
    if (props.indexText !== undefined) {
      return props.indexText;
    }
    if (props.index !== undefined) {
      return (props.index + 1).toString().padStart(3, "0");
    }
    return "";
  };

  return (
    <div
      class={`group/thumbnail flex-shrink-0 relative ${props.enablePlayClick !== false ? "cursor-pointer" : ""} ${props.class || ""}`}
      style={hasDimensions() ? { width: `${size()}px`, height: `${size()}px` } : undefined}
      draggable={false}
      data-thumbnail="true"
      onClick={(e) => {
        if (props.enablePlayClick !== false) {
          e.stopPropagation();
          e.preventDefault();
          props.onPlayClick?.();
        }
      }}
      onPointerDown={(e) => {
        if (props.enablePlayClick !== false) {
          e.stopPropagation();
        }
      }}
      onMouseDown={(e) => {
        if (props.enablePlayClick !== false) {
          e.stopPropagation();
        }
      }}
    >
      {/* thumbnail image or fallback icon */}
      <div class="w-full h-full rounded overflow-hidden bg-gray-800/50 flex items-center justify-center">
        <Show
          when={imageUrl()}
          fallback={
            <Icon
              name="music"
              size={(size() ?? 48) > 40 ? 32 : 24}
              color="var(--color-text-disabled)"
            />
          }
        >
          <img src={imageUrl()!} alt="" class="w-full h-full object-cover" decoding="async" />
        </Show>
      </div>

      {/* index number overlay OR up next spinner - hidden when hideIndex is true or on thumbnail hover (but up next spinner stays visible) */}
      <div
        class="absolute inset-0 flex items-center justify-center transition-opacity duration-200 pointer-events-none"
        classList={{
          "group-hover/thumbnail:opacity-0": showPlayIcon() && !props.isUpNext,
        }}
        style={{ opacity: props.hideIndex && !props.isUpNext ? 0 : 1 }}
      >
        <Show
          when={props.isUpNext}
          fallback={
            <span class="bg-black/70 text-white text-xs font-medium leading-none px-1">
              {displayText()}
            </span>
          }
        >
          {/* up next loading spinner */}
          <div class="relative w-7 h-7 bg-black/50 rounded-full flex items-center justify-center">
            <div
              class="absolute inset-0 rounded-full"
              style={{
                background:
                  "conic-gradient(from 0deg, transparent 0%, #ec489920 6%, #ec489940 12%, #ec489980 20%, #ec4899cc 28%, #ec4899 38%, #c026d3 55%, #a855f7 70%, #a855f7 86%, transparent 88%)",
                mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))",
                "-webkit-mask":
                  "radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))",
                animation: "spin 1.5s linear infinite",
              }}
            />
            <Icon name="next" size={12} color="var(--color-accent-500)" />
          </div>
        </Show>
      </div>

      {/* play icon - shown on thumbnail hover */}
      <Show when={showPlayIcon()}>
        <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover/thumbnail:opacity-100 transition-opacity bg-black/40 pointer-events-none">
          <Icon name="play" size={24} color="white" />
        </div>
      </Show>
    </div>
  );
}
