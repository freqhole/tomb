// reusable song row component for displaying a single song in a list
import { Show, type JSX } from "solid-js";
import { PlayIcon, PauseIcon } from "../icons/registry";
import { hasBackgroundImage } from "../../app/services/backgroundImage";
import { getPlayingIndicatorClasses, getPlayingTextClasses } from "../../design-system/colors";
import { MediaThumbnail } from "../media/MediaThumbnail";
import { ContextMenu, type MenuAction } from "../overlays/ContextMenu";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { Rating } from "../ratings/Rating";
import { MarqueeText } from "../text/MarqueeText";
import { OfflineBadge } from "../badges/OfflineBadge";
import { tapOrDblClick } from "../../utils/tapOrDblClick";
import type { ImageMetadata } from "../../music/services/storage/types";

export interface SongRowProps {
  isOffline?: boolean;
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
  /** artist name - shown before title (for compilation albums) */
  artist?: string;
  /** total play count to display next to duration (omit or null to hide) */
  playCount?: number | null;
}

/** style for a song list container: sizes every row's track number cell to
 *  the longest label in the list (e.g. "9" -> 1ch, "2-15" -> 4ch), so the
 *  column stays aligned without reserving room for numbers that never appear. */
export function trackNumberColumnStyle(
  labels: Array<string | number | null | undefined>
): JSX.CSSProperties {
  const longest = labels.reduce<number>(
    (max, label) => Math.max(max, String(label ?? "").length),
    1
  );
  return { "--track-num-width": `${longest}ch` };
}

export function SongRow(props: SongRowProps): JSX.Element {
  const hasPlayCount = () => props.playCount != null && props.playCount > 0;
  // over a background image the theme's gray meta text disappears into light
  // art, so lift it toward white (but keep it a step below the title)
  const metaTextClass = () =>
    hasBackgroundImage() ? "text-white/75" : "text-[var(--color-text-tertiary)]";
  const playCountTextClass = () =>
    hasBackgroundImage() ? "text-white/65" : "text-[var(--color-text-muted)]";

  // narrow layout: everything is top-aligned to a shared 24px first line so
  // the title can wrap onto a second line, and the play count tucks under
  // the duration (which never moves, with or without plays). wide layout:
  // unchanged single-line row.
  const rowContent = (
    <div
      {...tapOrDblClick(() => props.onDoubleClick?.())}
      class={`flex items-start wide:items-center gap-2 wide:gap-3 px-1 py-1.5 wide:p-2 rounded transition-colors cursor-pointer group ${
        props.isHighlighted
          ? "bg-[var(--color-accent-primary)]/15 ring-1 ring-[var(--color-accent-primary)]/30"
          : props.isPlaying
            ? getPlayingIndicatorClasses(true)
            : props.isSelected
              ? hasBackgroundImage()
                ? "bg-black/50"
                : "bg-[var(--color-bg-elevated)]"
              : hasBackgroundImage()
                ? "hover:bg-black/40"
                : "hover:bg-[var(--color-bg-elevated)]"
      } ${props.class || ""}`}
    >
      {/* thumbnail with track number overlay or simple track number */}
      <Show
        when={props.thumbnailUrl !== undefined}
        fallback={
          // narrow: width comes from the list's --track-num-width (see
          // trackNumberColumnStyle), never under 1rem so the play/pause icon fits
          <div
            class={`w-[max(var(--track-num-width,2ch),1rem)] wide:w-8 tabular-nums text-sm leading-6 wide:leading-normal ${metaTextClass()} text-right flex-shrink-0`}
          >
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

      {/* song title (with optional artist prefix for compilations) */}
      <div class="flex-1 min-w-0">
        <div class={getPlayingTextClasses(!!props.isPlaying)}>
          <span class="wide:hidden text-sm leading-6 line-clamp-2 break-words">{props.title}</span>
          <MarqueeText text={props.title} hoverOnly={true} class="hidden wide:block" />
        </div>
        <Show when={props.artist}>
          <MarqueeText
            text={props.artist}
            hoverOnly={true}
            class="text-xs text-[var(--color-text-tertiary)]"
          />
        </Show>
      </div>

      <OfflineBadge isOffline={props.isOffline} />

      {/* wide: play count inline before the action buttons */}
      <Show when={hasPlayCount()}>
        <div
          class={`hidden wide:block text-xs ${playCountTextClass()} flex-shrink-0 w-10 text-right`}
          title={`${props.playCount} plays`}
        >
          {props.playCount}×
        </div>
      </Show>

      {/* favorite indicator/toggle */}
      <Show when={props.isFavorite !== undefined && props.songId}>
        <div class="flex-shrink-0 h-6 wide:h-auto flex items-center">
          <FavoriteHeart
            isFavorite={props.isFavorite ?? false}
            onToggle={props.onFavoriteToggle}
            size="sm"
            readonly={!props.songId}
          />
        </div>
      </Show>

      {/* rating (wide only, narrow rows give the room to the title) */}
      <Show when={props.onRatingChange && props.songId}>
        <div class="hidden wide:block flex-shrink-0">
          <Rating rating={props.rating ?? 0} size="sm" onRatingChange={props.onRatingChange} />
        </div>
      </Show>

      {/* duration, with the narrow-layout play count stacked underneath */}
      <div class="flex flex-col items-end min-w-[2.5rem] wide:min-w-0 flex-shrink-0">
        <div class={`text-sm leading-6 wide:leading-normal ${metaTextClass()}`}>
          {props.duration}
        </div>
        <Show when={hasPlayCount()}>
          <div
            class={`wide:hidden text-xs leading-4 ${playCountTextClass()}`}
            title={`${props.playCount} plays`}
          >
            {props.playCount}×
          </div>
        </Show>
      </div>
    </div>
  );

  return props.contextMenuActions ? (
    <ContextMenu actions={props.contextMenuActions}>{rowContent}</ContextMenu>
  ) : (
    rowContent
  );
}
