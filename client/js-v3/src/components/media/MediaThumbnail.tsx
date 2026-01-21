// reusable media thumbnail with index overlay and play icon hover
import { Show, type JSX } from "solid-js";
import { Icon } from "../icons/registry";

export interface MediaThumbnailProps {
  /** thumbnail image url (optional) */
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
      {/* thumbnail image or transparent fallback */}
      <div class="w-full h-full rounded overflow-hidden">
        <Show
          when={props.thumbnailUrl}
          fallback={<div class="w-full h-full bg-transparent" />}
        >
          <img
            src={props.thumbnailUrl!}
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
