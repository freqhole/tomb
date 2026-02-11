import { createVirtualizer } from "@tanstack/solid-virtual";
import { createSignal, For, Show, type JSX } from "solid-js";
import type { Song } from "../../music/data/types";
import { isMobile } from "../../utils/isMobile";
import { formatDuration } from "../../utils/formatDuration";
import { Badge } from "../badges/Badge";
import { Icon } from "../icons/registry";
import { MediaThumbnail } from "../media/MediaThumbnail";
import { ContextMenu, type MenuAction } from "../overlays/ContextMenu";
import { MarqueeText } from "../text/MarqueeText";

export interface QueueSidebarProps {
  /** list of songs in queue */
  songs: Song[];
  /** currently playing song index */
  currentIndex: number;
  /** whether sidebar is open */
  isOpen: boolean;
  /** callback when close button clicked */
  onClose: () => void;
  /** callback when song is clicked */
  onSongClick: (index: number) => void;
  /** callback when song is double-clicked */
  onSongDoubleClick?: (index: number) => void;
  /** callback when remove button clicked */
  onRemoveSong: (index: number) => void;
  /** callback when clear all clicked */
  onClearAll: () => void;
  /** callback to get context menu actions for a song */
  getContextMenuActions?: (index: number, song: Song) => MenuAction[];
  /** layout variant: overlay (fixed position) or inline (in layout flow) */
  variant?: "overlay" | "inline";
  /** callback when queue is reordered */
  onReorder?: (fromIndex: number, toIndex: number) => void;
  /** additional classes */
  class?: string;
}

// queue sidebar component
export function QueueSidebar(props: QueueSidebarProps) {
  let scrollElementRef: HTMLDivElement | undefined;

  const [draggedIndex, setDraggedIndex] = createSignal<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = createSignal<number | null>(null);

  const virtualizer = createVirtualizer({
    get count() {
      return props.songs.length;
    },
    getScrollElement: () => scrollElementRef,
    estimateSize: () => 60, // estimated height of each queue item
    overscan: 5,
  });

  const handleSongClick = (index: number) => {
    props.onSongClick(index);
  };

  const handleSongDoubleClick = (index: number) => {
    if (props.onSongDoubleClick) {
      props.onSongDoubleClick(index);
    }
  };

  const handleRemove = (e: MouseEvent, index: number) => {
    e.stopPropagation();
    props.onRemoveSong(index);
  };

  const handleDragStart = (index: number) => (e: DragEvent) => {
    setDraggedIndex(index);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
    }
  };

  const handleDragOver = (index: number) => (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
    setDropTargetIndex(index);
  };

  const handleDragLeave = () => {
    setDropTargetIndex(null);
  };

  const handleDrop = (targetIndex: number) => {
    const fromIndex = draggedIndex();
    if (fromIndex === null || fromIndex === targetIndex) {
      setDraggedIndex(null);
      setDropTargetIndex(null);
      return;
    }

    if (props.onReorder) {
      props.onReorder(fromIndex, targetIndex);
    }

    setDraggedIndex(null);
    setDropTargetIndex(null);
  };

  const isOverlay = () => props.variant !== "inline";

  // responsive: bottom sheet on narrow, sidebar on wide
  // narrow (<768px): full-width bottom sheet that slides up
  // wide (>=768px): right sidebar

  return (
    <>
      {/* backdrop for overlay mode */}
      <Show when={isOverlay() && props.isOpen}>
        <div
          class="fixed inset-0 bg-black/50 z-1130 md:hidden"
          style={{ "touch-action": "none" }}
          onClick={() => props.onClose()}
        />
      </Show>

      <div
        class={`bg-[var(--color-bg-primary)]/95 backdrop-blur-xl flex flex-col ${
          isOverlay()
            ? /* narrow: bottom sheet above player bar */
              `fixed z-1140 transition-transform duration-300 ease-out
               inset-x-0 bottom-[var(--player-height)] top-0
               md:inset-x-auto md:top-0 md:right-0 md:bottom-0 md:h-auto md:w-96
               ${
                 props.isOpen
                   ? "translate-y-0 md:translate-y-0 md:translate-x-0"
                   : "invisible translate-y-full md:visible md:translate-y-0 md:translate-x-full"
               }`
            : props.isOpen
              ? "w-96 flex-shrink-0"
              : "hidden"
        } ${props.class || ""}`}
      >
        {/* drag handle for bottom sheet (narrow only) #TODO: enable swipe gesture for this or yank. */}
        {/* <Show when={isOverlay()}>
          <div class="md:hidden flex justify-center py-2">
            <div class="w-12 h-1 bg-[var(--color-border-strong)] rounded-full" />
          </div>
        </Show> */}

        {/* header */}
        <div class="flex items-center justify-between p-4">
          <div class="flex items-center gap-3">
            <Icon name="queue" size={20} color="var(--color-accent-500)" />
            <h2 class="text-lg font-medium text-[var(--color-text-primary)] m-0">queue</h2>
            <Badge variant="default" size="sm">
              {props.songs.length} {props.songs.length === 1 ? "song" : "songs"}
            </Badge>
          </div>

          <div class="flex items-center gap-2">
            <Show when={props.songs.length > 0}>
              <button
                class="px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-accent-500)]/10 rounded transition-colors"
                onClick={() => props.onClearAll()}
                title="clear all"
              >
                clear all
              </button>
            </Show>

            <button
              class="p-2 hover:bg-[var(--color-accent-500)]/20 transition-colors"
              onClick={() => props.onClose()}
              title="close queue"
              aria-label="close queue"
            >
              <Icon name="close" size={20} color="var(--color-accent-500)" />
            </button>
          </div>
        </div>

        {/* queue list */}
        <div
          ref={scrollElementRef}
          class="flex-1 overflow-y-auto"
          style={{ "overflow-anchor": "none", "overscroll-behavior": "contain" }}
        >
          <Show
            when={props.songs.length > 0}
            fallback={
              <div class="flex flex-col items-center justify-center h-full text-center px-8">
                <div class="w-16 h-16 mb-4 bg-[var(--color-accent-500)]/10 flex items-center justify-center">
                  <Icon name="queue" size={32} color="var(--color-accent-500)" />
                </div>
                <p class="text-[var(--color-text-secondary)] text-sm m-0 mb-2">queue is empty</p>
                <p class="text-[var(--color-text-muted)] text-xs m-0">add songs to see them here</p>
              </div>
            }
          >
            <div
              class="relative p-2"
              style={{
                height: `${virtualizer.getTotalSize()}px`,
              }}
            >
              <For each={virtualizer.getVirtualItems()} fallback={null}>
                {(virtualItem) => {
                  const itemIndex = virtualItem.index;
                  const song = () => props.songs[itemIndex];
                  const isCurrentlyPlaying = () => itemIndex === props.currentIndex;

                  const isDragging = () => draggedIndex() === itemIndex;
                  const isDropTarget = () => dropTargetIndex() === itemIndex;
                  const [isRowHovered, setIsRowHovered] = createSignal(false);

                  const songRow = (
                    <div
                      draggable={true}
                      class={`absolute top-0 left-0 w-full flex items-center my-3 group transition-all duration-200 cursor-move ${
                        isDropTarget()
                          ? "bg-[var(--color-accent-500)]/20 border-t-2 border-[var(--color-accent-500)] scale-[1.02]"
                          : isDragging()
                            ? "opacity-40 bg-[var(--color-accent-500)]/5 scale-95"
                            : isCurrentlyPlaying()
                              ? "bg-[#66003b]/20 rounded-lg border-l-2 border-l-[var(--color-accent-500)]"
                              : "hover:bg-[var(--color-accent-500)]/10"
                      }`}
                      style={{
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                      onMouseEnter={() => setIsRowHovered(true)}
                      onMouseLeave={() => setIsRowHovered(false)}
                      onDragStart={handleDragStart(itemIndex)}
                      onDragOver={handleDragOver(itemIndex)}
                      onDragLeave={handleDragLeave}
                      onDrop={() => handleDrop(itemIndex)}
                      onClick={() => {
                        if (isMobile()) {
                          // on mobile, single tap plays
                          handleSongDoubleClick(itemIndex);
                        }
                        // on desktop, single click does nothing - only double-click plays
                      }}
                      onDblClick={() => {
                        // on desktop, double-click plays
                        if (!isMobile()) {
                          handleSongDoubleClick(itemIndex);
                        }
                      }}
                      title={
                        isCurrentlyPlaying()
                          ? "currently playing"
                          : isMobile()
                            ? "tap to play"
                            : "double-click to play"
                      }
                    >
                      {/* thumbnail with index overlay */}
                      <MediaThumbnail
                        images={song()?.images}
                        index={itemIndex}
                        hideIndex={isRowHovered()}
                        onPlayClick={() => handleSongDoubleClick(itemIndex)}
                        size={48}
                        class="mr-3"
                      />

                      {/* song info */}
                      <div class="flex-1 min-w-0">
                        <h4
                          class={`text-sm font-medium m-0 ${
                            isCurrentlyPlaying()
                              ? "text-[var(--color-accent-500)]"
                              : "text-[var(--color-text-primary)]"
                          }`}
                        >
                          <MarqueeText
                            text={song()?.title || ""}
                            isHovering={() => isRowHovered() || isCurrentlyPlaying()}
                          />
                        </h4>
                        <p class="text-xs text-[var(--color-text-secondary)] m-0">
                          <MarqueeText
                            text={song()?.artist_name || ""}
                            isHovering={() => isRowHovered() || isCurrentlyPlaying()}
                          />
                        </p>
                        <Show when={song()?.album_title}>
                          <p class="text-xs text-[var(--color-text-tertiary)] m-0">
                            <MarqueeText
                              text={song()?.album_title || ""}
                              isHovering={() => isRowHovered() || isCurrentlyPlaying()}
                            />
                          </p>
                        </Show>
                      </div>

                      {/* duration and favorite indicator */}
                      <div class="flex items-center gap-2 ml-3 flex-shrink-0">
                        <div class="text-xs text-[var(--color-text-muted)]">
                          {formatDuration(song()?.duration_seconds)}
                        </div>
                        <Show when={song()?.is_favorite}>
                          <div title="favorited">
                            <Icon name="favorite" size={12} color="var(--color-accent-500)" />
                          </div>
                        </Show>
                      </div>

                      {/* remove button */}
                      <button
                        class={`${isMobile() ? "" : "opacity-0 group-hover:opacity-100 "}p-2 ml-2 text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/20 transition-all duration-200 flex-shrink-0`}
                        onClick={(e) => handleRemove(e, itemIndex)}
                        title="remove from queue"
                        aria-label="remove from queue"
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  );

                  return props.getContextMenuActions && song() ? (
                    <ContextMenu actions={props.getContextMenuActions(itemIndex, song()!)}>
                      {songRow}
                    </ContextMenu>
                  ) : (
                    songRow
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </>
  );
}
