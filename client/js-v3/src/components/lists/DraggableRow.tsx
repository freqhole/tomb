import { createSignal, Show, splitProps, type JSX } from "solid-js";
import { Icon } from "../icons/registry";

export interface DraggableRowProps {
  /** unique identifier for the row */
  id: string;
  /** track number or position */
  index: number;
  /** whether row is currently being dragged */
  isDragging?: boolean;
  /** whether row is the current drop target */
  isDropTarget?: boolean;
  /** whether row is selected */
  isSelected?: boolean;
  /** whether dragging is disabled */
  disabled?: boolean;
  /** callback when drag starts */
  onDragStart?: (e: DragEvent) => void;
  /** callback when dragging over this row */
  onDragOver?: (e: DragEvent) => void;
  /** callback when drag leaves this row */
  onDragLeave?: (e: DragEvent) => void;
  /** callback when dropped on this row */
  onDrop?: (e: DragEvent) => void;
  /** callback when row is clicked */
  onClick?: (e: MouseEvent) => void;
  /** callback when row is double-clicked */
  onDoubleClick?: (e: MouseEvent) => void;
  /** callback when row is right-clicked */
  onContextMenu?: (e: MouseEvent) => void;
  /** whether to show drag handle instead of index */
  showDragHandle?: boolean;
  /** additional classes */
  class?: string;
  /** row content */
  children: JSX.Element;
}

// draggable row for playlists with reorder support
export function DraggableRow(props: DraggableRowProps) {
  const [local, others] = splitProps(props, [
    "id",
    "index",
    "isDragging",
    "isDropTarget",
    "isSelected",
    "disabled",
    "onDragStart",
    "onDragOver",
    "onDragLeave",
    "onDrop",
    "onClick",
    "onDoubleClick",
    "onContextMenu",
    "showDragHandle",
    "class",
    "children",
  ]);

  const [isHovered, setIsHovered] = createSignal(false);

  const rowClasses = () => {
    const base =
      "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 cursor-pointer group";
    const states = [];

    if (local.isDropTarget) {
      states.push(
        "bg-[var(--color-accent-500)]/20 border-t-2 border-[var(--color-accent-500)] scale-[1.02]",
      );
    } else if (local.isDragging) {
      states.push("opacity-40 bg-[var(--color-accent-500)]/5 scale-95");
    } else if (local.isSelected) {
      states.push(
        "bg-[var(--color-accent-500)]/15 border border-[var(--color-accent-500)]/30",
      );
    } else {
      states.push(
        "hover:bg-[var(--color-accent-500)]/20 border border-transparent",
      );
    }

    return `${base} ${states.join(" ")} ${local.class || ""}`;
  };

  return (
    <div
      class={rowClasses()}
      draggable={!local.disabled}
      onDragStart={(e) => local.onDragStart?.(e)}
      onDragOver={(e) => local.onDragOver?.(e)}
      onDragLeave={(e) => local.onDragLeave?.(e)}
      onDrop={(e) => local.onDrop?.(e)}
      onClick={(e) => local.onClick?.(e)}
      onDblClick={(e) => local.onDoubleClick?.(e)}
      onContextMenu={(e) => local.onContextMenu?.(e)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-row-id={local.id}
      {...others}
    >
      {/* track number / drag handle */}
      <div class="w-8 flex-shrink-0 flex items-center justify-center text-[var(--color-accent-500)] text-sm relative">
        {/* show index number by default, hide on hover if draggable */}
        <Show
          when={local.disabled}
          fallback={
            <>
              <span
                class="font-mono absolute inset-0 flex items-center justify-center transition-opacity duration-200"
                style={{ opacity: isHovered() ? 0 : 1 }}
              >
                {local.index + 1}
              </span>
              <div
                class="absolute inset-0 flex items-center justify-center transition-opacity duration-200 cursor-grab active:cursor-grabbing"
                style={{ opacity: isHovered() ? 1 : 0 }}
                title="drag to reorder"
              >
                <Icon name="drag" size={16} color="var(--color-accent-500)" />
              </div>
            </>
          }
        >
          <span class="font-mono">{local.index + 1}</span>
        </Show>
      </div>

      {/* content */}
      <div class="flex-1 min-w-0">{local.children}</div>
    </div>
  );
}

// draggable row content for songs
export interface DraggableRowSongContentProps {
  /** song title */
  title: string;
  /** artist name */
  artist: string;
  /** album name */
  album?: string;
  /** duration in seconds */
  durationSeconds?: number;
  /** additional actions (buttons, icons, etc) */
  actions?: JSX.Element;
  /** additional classes */
  class?: string;
}

// format seconds to mm:ss
function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// song content for draggable rows
export function DraggableRowSongContent(props: DraggableRowSongContentProps) {
  return (
    <div class={`flex items-center gap-4 ${props.class || ""}`}>
      {/* song info */}
      <div class="flex-1 min-w-0">
        <div class="text-[var(--color-text-primary)] font-medium text-sm truncate group-hover:text-[var(--color-accent-400)] transition-colors">
          {props.title}
        </div>
        <div class="text-[var(--color-text-secondary)] text-xs truncate">
          {props.artist}
          <Show when={props.album}>
            <span class="opacity-70"> • {props.album}</span>
          </Show>
        </div>
      </div>

      {/* duration */}
      <Show when={props.durationSeconds !== undefined}>
        <div class="text-[var(--color-accent-500)] text-xs font-mono flex-shrink-0 min-w-[2.5rem] text-right">
          {formatDuration(props.durationSeconds!)}
        </div>
      </Show>

      {/* actions */}
      <Show when={props.actions}>
        <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {props.actions}
        </div>
      </Show>
    </div>
  );
}
