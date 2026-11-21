// station-owned current and pending items, separate from the local playback queue.
import { createSignal, Show } from "solid-js";
import type { RadioRequestRow as RadioRequestRowData } from "../radio/useRadioRequestQueue";
import { MediaThumbnail } from "../media/MediaThumbnail";
import { MarqueeText } from "../text/MarqueeText";
import { Icon } from "../icons/registry";
import { formatDuration } from "../../utils/formatDuration";
import { isTouchDevice } from "../../utils/isMobile";

export interface RadioRequestQueueRowProps {
  row: RadioRequestRowData;
  index: number;
  thumbnailUrl: string | null;
  isDragging: boolean;
  isDropTarget: boolean;
  isCurrentlyPlaying?: boolean;
  onRemove: (e: MouseEvent) => void;
  onDragStart?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: () => void;
  onDragEnd?: () => void;
  onDrop?: () => void;
  onPointerDown?: (e: PointerEvent) => void;
  draggableEnabled: boolean;
}

export function RadioRequestQueueRow(props: RadioRequestQueueRowProps) {
  const [isRowHovered, setIsRowHovered] = createSignal(false);

  return (
    <div
      draggable={props.draggableEnabled}
      class={`h-[68px] w-full flex items-center py-2 pl-2 group transition-colors overflow-hidden ${
        props.isDropTarget
          ? "bg-[var(--color-accent-500)]/20 border-t-2 border-[var(--color-accent-500)] scale-[1.02]"
          : props.isDragging
            ? "opacity-40 bg-[var(--color-accent-500)]/5 scale-95"
            : "rounded-lg hover:bg-[var(--color-accent-500)]/10"
      }`}
      classList={{ "cursor-move": props.draggableEnabled }}
      onMouseEnter={() => setIsRowHovered(true)}
      onMouseLeave={() => setIsRowHovered(false)}
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
        <Show when={props.isCurrentlyPlaying}>
          <p class="text-xs text-[var(--color-accent-500)] m-0">now playing</p>
        </Show>
        <h4 class="text-sm font-medium text-[var(--color-text-primary)] truncate m-0">
          <MarqueeText text={props.row.title} isHovering={isRowHovered} />
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
        type="button"
        class={`flex-shrink-0 p-2 text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/20 rounded transition-colors relative z-10 ${isTouchDevice() ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
        onClick={props.onRemove}
        onPointerDown={(e) => e.stopPropagation()}
        title={props.isCurrentlyPlaying ? "skip station track" : "remove from queue"}
        aria-label={props.isCurrentlyPlaying ? "skip station track" : "remove from queue"}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
