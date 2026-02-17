// reusable media thumbnail with index overlay and play icon hover
import { createEffect, createSignal, Show, type JSX } from "solid-js";
import { getBlobObjectURL, getCachedBlobObjectURL } from "../../music/services/storage/blobs";
import { Icon } from "../icons/registry";
import type { ImageMetadata } from "../../music/services/storage/types";

// extended type to handle IDB data that may have 'type' instead of 'blob_type'
type ImageData = ImageMetadata & { type?: string };

/**
 * pick the best image from an array of images
 * handles both ImageMetadata (blob_type) and raw IDB data (type)
 */
function pickBestImage(images?: ImageData[]): ImageData | null {
  if (!images || images.length === 0) return null;

  // spread to unwrap SolidJS store proxies
  const arr = [...images];
  if (arr.length === 0) return null;

  const getType = (img: ImageData) => img.blob_type || img.type;

  // priority: primary thumbnail → any thumbnail → any primary → first non-waveform → waveform (last resort)
  const primaryThumb = arr.find((img) => img.is_primary && getType(img) === "thumbnail");
  if (primaryThumb) return primaryThumb;

  const anyThumb = arr.find((img) => getType(img) === "thumbnail");
  if (anyThumb) return anyThumb;

  const primary = arr.find((img) => img.is_primary && getType(img) !== "waveform");
  if (primary) return primary;

  const nonWaveform = arr.find((img) => getType(img) !== "waveform");
  if (nonWaveform) return nonWaveform;

  return arr[0] || null;
}

/**
 * get the URL for an image - handles local_blob_id, remote_url, or legacy thumbnailUrl
 */
async function resolveImageUrl(
  image: ImageData | null,
  legacyBlobId?: string | null,
  legacyUrl?: string | null
): Promise<string | null> {
  // try remote_url first (already a usable URL)
  if (image?.remote_url) return image.remote_url;
  if (legacyUrl) return legacyUrl;

  // try local_blob_id (needs OPFS lookup)
  const blobId = image?.local_blob_id || legacyBlobId;
  if (blobId) {
    return await getBlobObjectURL(blobId);
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
    const image = pickBestImage(props.images as ImageData[]);
    if (image?.remote_url) return image.remote_url;
    if (props.thumbnailUrl) return props.thumbnailUrl;
    const blobId = image?.local_blob_id || props.thumbnailBlobId;
    if (blobId) return getCachedBlobObjectURL(blobId);
    return null;
  };

  const [imageUrl, setImageUrl] = createSignal<string | null>(getInitialUrl());

  // resolve image URL when props change (handles async blob lookups)
  createEffect(() => {
    const image = pickBestImage(props.images as ImageData[]);
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

      {/* index number overlay - hidden when hideIndex is true or on thumbnail hover */}
      <div
        class="absolute inset-0 flex items-center justify-center transition-opacity duration-200 pointer-events-none"
        classList={{
          "group-hover/thumbnail:opacity-0": showPlayIcon(),
        }}
        style={{ opacity: props.hideIndex ? 0 : 1 }}
      >
        <span class="bg-black/70 text-white text-xs font-medium leading-none px-1">
          {displayText()}
        </span>
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
