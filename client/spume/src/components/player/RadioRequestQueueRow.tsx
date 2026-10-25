// one row in the sidebar's live radio request-queue section - a
// DIFFERENT, thinner data shape than QueueSongRow/VideoQueueRow (a
// `RadioRequestRow` from useRadioRequestQueue.ts, not a `MediaItem`): no
// playback state, no favorite/rating, no waveform - these aren't
// locally-playable queue entries, just a station's own pending request
// backlog that any listener can reorder/remove. deliberately simpler
// than RemoteQueueRow.tsx for the same reason - no progress fill, no
// "currently playing" concept (nothing in this list is "playing"; the
// station's own broadcaster decides what plays next, from the front of
// this same queue).
import { Show } from "solid-js";
import type { RadioRequestRow as RadioRequestRowData } from "../radio/useRadioRequestQueue";
import { MediaThumbnail } from "../media/MediaThumbnail";
import { MarqueeText } from "../text/MarqueeText";
import { Icon } from "../icons/registry";
import { formatDuration } from "../../utils/formatDuration";

export interface RadioRequestQueueRowProps {
  row: RadioRequestRowData;
  index: number;
  thumbnailUrl: string | null;
  isDragging: boolean;
  isDropTarget: boolean;
  /** fixed row height-based absolute positioning, same convention as
   *  RemoteQueueRow.tsx - no virtualizer for this list either (station
   *  request queues are expected to stay modest-sized). */
  top: number;
  onRemove: (e: MouseEvent) => void;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  /** pointer-based drag fallback for Tauri (native HTML5 `draggable`
   *  drag doesn't work in WKWebView) - only wired up when `isCharnelMode()`. */
  onPointerDown: (e: PointerEvent) => void;
  draggableEnabled: boolean;
}

export function RadioRequestQueueRow(props: RadioRequestQueueRowProps) {
  return (
    <div
      draggable={props.draggableEnabled}
      class={`absolute top-0 left-0 w-full flex items-center py-2 pl-2 group cursor-move transition-all duration-200 overflow-hidden ${
        props.isDropTarget
          ? "bg-[var(--color-accent-500)]/20 border-t-2 border-[var(--color-accent-500)] scale-[1.02]"
          : props.isDragging
            ? "opacity-40 bg-[var(--color-accent-500)]/5 scale-95"
            : "rounded-lg hover:bg-[var(--color-accent-500)]/10"
      }`}
      style={{ transform: `translateY(${props.top}px)` }}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDragEnd={props.onDragEnd}
      onDrop={props.onDrop}
      onPointerDown={props.onPointerDown}
      title={props.row.requestedByUsername ? `requested by ${props.row.requestedByUsername}` : undefined}
    >
      <MediaThumbnail
        thumbnailUrl={props.thumbnailUrl}
        index={props.index}
        showPlayIcon={false}
        enablePlayClick={false}
        cornerBadgeIcon={props.row.kind === "video" ? "video" : undefined}
        size={48}
        class="mr-3 relative z-10"
      />

      <div class="flex-1 min-w-0 relative z-10">
        <h4 class="text-sm font-medium text-[var(--color-text-primary)] truncate m-0">
          <MarqueeText text={props.row.title} />
        </h4>
        <p class="text-xs text-[var(--color-text-secondary)] truncate m-0">
          {props.row.artist ?? "unknown artist"}
          <Show when={props.row.album}> — {props.row.album}</Show>
        </p>
        <Show when={props.row.requestedByUsername}>
          <p class="text-xs text-[var(--color-text-muted)] truncate m-0">
            requested by {props.row.requestedByUsername}
          </p>
        </Show>
      </div>

      <div class="flex-shrink-0 text-xs text-[var(--color-text-muted)] text-right relative z-10 mr-1">
        <Show when={props.row.durationMs}>{(ms) => <div>{formatDuration(ms() / 1000)}</div>}</Show>
      </div>

      <button
        class="flex-shrink-0 p-1.5 text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/20 rounded transition-colors relative z-10 opacity-0 group-hover:opacity-100"
        onClick={props.onRemove}
        title="remove from queue"
        aria-label="remove from queue"
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
