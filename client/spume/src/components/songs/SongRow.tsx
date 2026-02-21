// reusable song row component for displaying a single song in a list
import { Show, type JSX } from "solid-js";
import { PlayIcon, PauseIcon } from "../icons/registry";
import type { FavoriteTarget } from "../../music/queries/favorites";
import { getPlayingIndicatorClasses, getPlayingTextClasses } from "../../design-system/colors";
import { MediaThumbnail } from "../media/MediaThumbnail";
import { ContextMenu, type MenuAction } from "../overlays/ContextMenu";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { Rating } from "../ratings/Rating";
import { MarqueeText } from "../text/MarqueeText";
import type { ImageMetadata } from "../../music/services/storage/types";

export interface SongRowProps {
  /** song title */
  title: string;
  /** track number (can include disc like "2-5") */
  trackNumber?: string | number;
  /** song duration formatted as "3:45" */
  duration: string;
  /** whether this row is currently selected */
  isSelected?: boolean;
  /** whether this song is currently playing */
  isPlaying?: boolean;
  /** click handler */
  onClick?: () => void;
  /** double click handler for play action */
  onDoubleClick?: () => void;
  /** structured image metadata array (preferred) */
  images?: ImageMetadata[];
  /** thumbnail url (legacy, for backward compatibility) */
  thumbnailUrl?: string;
  /** index number for display (will be zero-padded to 3 digits) */
  index?: number;
  /** callback when thumbnail/play button is clicked */
  onPlayClick?: () => void;
  /** additional css classes */
  class?: string;
  /** show play icon on hover */
  showPlayOnHover?: boolean;
  /** context menu actions */
  contextMenuActions?: MenuAction[];
  /** whether song is favorited */
  isFavorite?: boolean;
  /** song rating (0-5) */
  rating?: number;
  /** song id for favorite toggle */
  songId?: string;
  /** sha256 for favorite toggle (for queue updates) */
  sha256?: string;
  /** callback after favorite toggle */
  onFavoriteToggle?: (isFavorite: boolean) => void;
  /** callback after rating change */
  onRatingChange?: (rating: number) => void;
  /** whether this row is highlighted (e.g. from search navigation) — more prominent than isSelected */
  isHighlighted?: boolean;
}

export function SongRow(props: SongRowProps): JSX.Element {
  const rowContent = (
    <div
      onClick={() => props.onClick?.()}
      onDblClick={() => props.onDoubleClick?.()}
      class={`flex items-center gap-3 p-2 rounded transition-colors cursor-pointer group ${
        props.isHighlighted
          ? "bg-[var(--color-accent-primary)]/15 ring-1 ring-[var(--color-accent-primary)]/30"
          : props.isPlaying
            ? getPlayingIndicatorClasses(true)
            : props.isSelected
              ? "bg-[var(--color-bg-elevated)]"
              : "hover:bg-[var(--color-bg-elevated)]"
      } ${props.class || ""}`}
    >
      {/* thumbnail with track number overlay or simple track number */}
      <Show
        when={props.thumbnailUrl !== undefined}
        fallback={
          <div class="w-8 text-sm text-[var(--color-text-tertiary)] text-right flex-shrink-0">
            {props.showPlayOnHover && !props.isPlaying ? (
              <>
                <span class="group-hover:hidden">{props.trackNumber ?? ""}</span>
                <span class="hidden group-hover:inline">
                  <PlayIcon size={16} className="mx-auto" />
                </span>
              </>
            ) : props.isPlaying ? (
              <PauseIcon size={16} className="mx-auto text-[var(--color-accent)]" />
            ) : (
              <span>{props.trackNumber ?? ""}</span>
            )}
          </div>
        }
      >
        <MediaThumbnail
          images={props.images}
          thumbnailUrl={props.thumbnailUrl}
          indexText={props.trackNumber?.toString()}
          hideIndex={false}
          onPlayClick={props.onPlayClick}
          size={40}
        />
      </Show>

      {/* song title */}
      <div class="flex-1 min-w-0">
        <div class={getPlayingTextClasses(!!props.isPlaying)}>
          <MarqueeText text={props.title} hoverOnly={true} />
        </div>
      </div>

      {/* favorite indicator/toggle */}
      <Show when={props.isFavorite !== undefined && props.songId}>
        <div class="flex-shrink-0">
          <FavoriteHeart
            isFavorite={props.isFavorite ?? false}
            onToggle={props.onFavoriteToggle}
            size="sm"
            readonly={!props.songId}
          />
        </div>
      </Show>

      {/* rating */}
      <Show when={props.onRatingChange && props.songId}>
        <div class="flex-shrink-0">
          <Rating rating={props.rating ?? 0} size="sm" onRatingChange={props.onRatingChange} />
        </div>
      </Show>

      {/* duration */}
      <div class="text-sm text-[var(--color-text-tertiary)] flex-shrink-0">{props.duration}</div>
    </div>
  );

  return props.contextMenuActions ? (
    <ContextMenu actions={props.contextMenuActions}>{rowContent}</ContextMenu>
  ) : (
    rowContent
  );
}
