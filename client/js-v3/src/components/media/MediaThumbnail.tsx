// reusable media thumbnail with index overlay and play icon hover
import { onMount, createSignal, Show, type JSX } from "solid-js";
import { getBlobObjectURL } from "../../music/services/storage/blobs";
import { Icon } from "../icons/registry";
import type { ImageMetadata } from "../../music/services/storage/types";

/**
 * pick the best image from an array of ImageMetadata
 * priority: primary thumbnail → first thumbnail → first available → null
 */
function pickBestImage(images?: ImageMetadata[]): ImageMetadata | null {
  if (!images || images.length === 0) return null;
  
  // find primary thumbnail
  const primary = images.find(img => img.is_primary && img.blob_type === 'thumbnail');
  if (primary) return primary;
  
  // find any thumbnail
  const thumbnail = images.find(img => img.blob_type === 'thumbnail');
  if (thumbnail) return thumbnail;
  
  // fallback to first image
  return images[0];
}

export interface MediaThumbnailProps {
  /** structured image metadata array (preferred) */
  images?: ImageMetadata[];
  /** thumbnail blob ID to resolve (legacy, for backward compatibility) */
  thumbnailBlobId?: string | null;
  /** thumbnail image url (legacy, for backward compatibility or remote images) */
  thumbnailUrl?: string | null;
  /** index number to display (will be zero-padded to 3 digits) */
  index?: number;
  /** custom text to display instead of formatted index (e.g. track numbers like "1", "2-5") */
  indexText?: string;
  /** whether to hide the index overlay (e.g. on parent row hover) */
  hideIndex?: boolean;
  /** callback when thumbnail/play icon is clicked */
  onPlayClick?: () => void;
  /** whether to enable click handling (disable for draggable contexts) */
  enablePlayClick?: boolean;
  /** whether to show play icon on hover (default: true) */
  showPlayIcon?: boolean;
  /** size of the thumbnail in pixels (default: 48) */
  size?: number;
  /** additional classes */
  class?: string;
}

/**
 * media thumbnail component with index overlay and play icon
 *
 * features:
 * - displays artwork for songs, albums, artists, or playlists
 * - shows zero-padded index number (e.g. "001") on thumbnail
 * - index fades out when hideIndex is true (controlled by parent row hover)
 * - play icon appears on thumbnail hover with dark overlay
 * - clicking thumbnail triggers onPlayClick callback
 *
 * used in: queue sidebar, playlist rows, song rows, search results
 */
export function MediaThumbnail(props: MediaThumbnailProps): JSX.Element {
  const [resolvedUrl, setResolvedUrl] = createSignal<string | null>(null);
  
  // resolve blob URL on mount - create object URL once per component instance
  onMount(async () => {
    // priority: images array → legacy thumbnailBlobId
    const bestImage = pickBestImage(props.images);
    
    if (bestImage?.local_blob_id) {
      // local image: create blob URL
      const blob = await getBlobObjectURL(bestImage.local_blob_id);
      if (blob) {
        const url = URL.createObjectURL(blob);
        setResolvedUrl(url);
      }
    } else if (bestImage?.remote_url) {
      // remote image: use directly
      setResolvedUrl(bestImage.remote_url);
    } else if (props.thumbnailBlobId) {
      // legacy path: use thumbnailBlobId prop
      const blob = await getBlobObjectURL(props.thumbnailBlobId);
      if (blob) {
        const url = URL.createObjectURL(blob);
        setResolvedUrl(url);
      }
    }
  });
  
  // use resolved blob URL or fallback to legacy thumbnailUrl prop
  const imageUrl = () => resolvedUrl() || props.thumbnailUrl;
  
  const size = () => props.size ?? 48;
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
      class={`group flex-shrink-0 relative ${props.enablePlayClick !== false ? "cursor-pointer" : ""} ${props.class || ""}`}
      style={{ width: `${size()}px`, height: `${size()}px` }}
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
            <Icon name="music" size={size() > 40 ? 32 : 24} color="var(--color-text-disabled)" />
          }
        >
          <img
            src={imageUrl()!}
            alt=""
            class="w-full h-full object-cover"
            loading="lazy"
          />
        </Show>
      </div>

      {/* index number overlay - hidden when hideIndex is true or on group hover */}
      <div
        class="absolute inset-0 flex items-center justify-center transition-opacity duration-200 pointer-events-none"
        classList={{
          "group-hover:opacity-0": showPlayIcon(),
        }}
        style={{ opacity: props.hideIndex ? 0 : 1 }}
      >
        <span class="bg-black/70 text-white text-xs font-medium leading-none px-1">
          {displayText()}
        </span>
      </div>

      {/* play icon - shown on group hover */}
      <Show when={showPlayIcon()}>
        <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 pointer-events-none">
          <Icon name="play" size={24} color="white" />
        </div>
      </Show>
    </div>
  );
}
