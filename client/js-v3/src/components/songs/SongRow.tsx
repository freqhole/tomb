// reusable song row component for displaying a single song in a list
import { Show, type JSX } from "solid-js";
import { MediaThumbnail } from "../media/MediaThumbnail";
import { ContextMenu, type MenuAction } from "../overlays/ContextMenu";
import { MarqueeText } from "../text/MarqueeText";

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
  /** thumbnail url */
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
}

export function SongRow(props: SongRowProps): JSX.Element {
  const rowContent = (
    <div
      onClick={() => props.onClick?.()}
      onDblClick={() => props.onDoubleClick?.()}
      class={`flex items-center gap-3 p-2 rounded transition-colors cursor-pointer group ${
        props.isSelected
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
                <span class="group-hover:hidden">
                  {props.trackNumber ?? ""}
                </span>
                <svg
                  class="hidden group-hover:inline w-4 h-4 mx-auto"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </>
            ) : props.isPlaying ? (
              <svg
                class="w-4 h-4 mx-auto text-[var(--color-accent)]"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <span>{props.trackNumber ?? ""}</span>
            )}
          </div>
        }
      >
        <MediaThumbnail
          thumbnailUrl={props.thumbnailUrl}
          indexText={props.trackNumber?.toString()}
          hideIndex={false}
          onPlayClick={props.onPlayClick}
          size={40}
        />
      </Show>

      {/* song title */}
      <div class="flex-1 min-w-0">
        <div
          class={`${
            props.isPlaying
              ? "text-[var(--color-accent)]"
              : "text-[var(--color-text-primary)]"
          }`}
        >
          <MarqueeText text={props.title} hoverOnly={true} />
        </div>
      </div>

      {/* duration */}
      <div class="text-sm text-[var(--color-text-tertiary)] flex-shrink-0">
        {props.duration}
      </div>
    </div>
  );

  return props.contextMenuActions ? (
    <ContextMenu actions={props.contextMenuActions}>{rowContent}</ContextMenu>
  ) : (
    rowContent
  );
}
