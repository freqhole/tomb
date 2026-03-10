// reusable media thumbnail with index overlay and play icon hover
import { createEffect, createSignal, Show, type JSX } from "solid-js";
import { getBlobObjectURL, getCachedBlobObjectURL } from "../../music/services/storage/blobs";
import {
  resolveBlobUrl,
  isP2PRemote,
  getCachedP2PBlobUrl,
} from "../../music/services/storage/blobResolver";
import { Icon } from "../icons/registry";
import type { ImageMetadata } from "../../music/services/storage/types";
import { pickBestImage } from "../../utils/images";

/**
 * get the URL for an image - handles local_blob_id, remote_url, P2P remotes, or legacy
 */
async function resolveImageUrl(
  image: ImageMetadata | null,
  legacyBlobId?: string | null,
  legacyUrl?: string | null
): Promise<string | null> {
  // priority 1: local blob ID (OPFS lookup)
  const blobId = image?.local_blob_id || legacyBlobId;
  if (blobId) {
    return await getBlobObjectURL(blobId);
  }

  // priority 2: P2P remote (has remote_server_id)
  if (image?.remote_blob_id && image?.remote_server_id) {
    try {
      const isP2P = await isP2PRemote(image.remote_server_id);
      if (isP2P) {
        return await resolveBlobUrl(image.remote_blob_id, image.remote_server_id);
      }
    } catch (err) {
      console.error("failed to resolve P2P thumbnail:", err);
    }
  }

  // priority 3: HTTP remote URL
  if (image?.remote_url) return image.remote_url;
  if (legacyUrl) return legacyUrl;

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
  // compute initial image URL synchronously to avoid first-render flicker
  const getInitialUrl = (): string | null => {
    const image = pickBestImage(props.images);
    // priority 1: local blob (OPFS)
    const blobId = image?.local_blob_id || props.thumbnailBlobId;
    if (blobId) return getCachedBlobObjectURL(blobId);
    // priority 2: P2P remote - check sync cache (instant if previously resolved)
    if (image?.remote_blob_id && image?.remote_server_id) {
      const cached = getCachedP2PBlobUrl(image.remote_blob_id, image.remote_server_id);
      if (cached) return cached;
      // not cached yet - will resolve async, return null for now
      return null;
    }
    // priority 3: HTTP remote URL
    if (image?.remote_url) return image.remote_url;
    if (props.thumbnailUrl) return props.thumbnailUrl;
    return null;
  };

  const [imageUrl, setImageUrl] = createSignal<string | null>(getInitialUrl());

  // resolve image URL when props change (handles async blob lookups)
  createEffect(() => {
    const image = pickBestImage(props.images);
    resolveImageUrl(image, props.thumbnailBlobId, props.thumbnailUrl).then((url) => {
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
