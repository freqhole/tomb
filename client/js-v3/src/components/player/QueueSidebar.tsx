import { createVirtualizer } from "@tanstack/solid-virtual";
import { For, Show, type JSX } from "solid-js";
import { isMobile } from "../../utils/isMobile";
import { Badge } from "../badges/Badge";
import { Icon } from "../icons/registry";
import { ContextMenu, type MenuAction } from "../overlays/ContextMenu";
import { MarqueeText } from "../text/MarqueeText";

export interface QueueSong {
  /** song id */
  id: string;
  /** song title */
  title: string;
  /** artist name */
  artist: string;
  /** duration in seconds */
  duration?: number;
  /** thumbnail url */
  thumbnailUrl?: string;
}

export interface QueueSidebarProps {
  /** list of songs in queue */
  songs: QueueSong[];
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
  getContextMenuActions?: (index: number, song: QueueSong) => MenuAction[];
  /** layout variant: overlay (fixed position) or inline (in layout flow) */
  variant?: "overlay" | "inline";
  /** additional classes */
  class?: string;
}

// format seconds to MM:SS
function formatDuration(seconds: number | undefined): string {
  if (!seconds || !isFinite(seconds) || seconds < 0) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// queue sidebar component
export function QueueSidebar(props: QueueSidebarProps) {
  let scrollElementRef: HTMLDivElement | undefined;

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
    console.log(
      "handleRemove called with index:",
      index,
      "song:",
      props.songs[index]?.title,
    );
    props.onRemoveSong(index);
  };

  const isOverlay = () => props.variant !== "inline";

  return (
    <div
      class={`w-96 bg-[var(--color-bg-primary)]/95 backdrop-blur-xl border-l border-[var(--color-accent-500)]/30 flex flex-col ${
        isOverlay()
          ? `fixed top-0 right-0 bottom-0 z-40 transition-transform duration-300 ${
              props.isOpen ? "translate-x-0" : "translate-x-full"
            }`
          : props.isOpen
            ? "flex-shrink-0"
            : "hidden"
      } ${props.class || ""}`}
    >
      {/* header */}
      <div class="flex items-center justify-between p-4 border-b border-[var(--color-accent-500)]/30">
        <div class="flex items-center gap-3">
          <Icon name="queue" size={20} color="var(--color-accent-500)" />
          <h2 class="text-lg font-medium text-[var(--color-text-primary)] m-0">
            queue
          </h2>
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
            class="p-2 rounded-full hover:bg-[var(--color-accent-500)]/20 transition-colors"
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
        style={{ "overflow-anchor": "none" }}
      >
        <Show
          when={props.songs.length > 0}
          fallback={
            <div class="flex flex-col items-center justify-center h-full text-center px-8">
              <div class="w-16 h-16 mb-4 bg-[var(--color-accent-500)]/10 rounded-full flex items-center justify-center">
                <Icon name="queue" size={32} color="var(--color-accent-500)" />
              </div>
              <p class="text-[var(--color-text-secondary)] text-sm m-0 mb-2">
                queue is empty
              </p>
              <p class="text-[var(--color-text-muted)] text-xs m-0">
                add songs to see them here
              </p>
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
                const isCurrentlyPlaying = () =>
                  itemIndex === props.currentIndex;

                const songRow = (
                  <div
                    class={`absolute top-0 left-0 w-full px-2 flex items-center p-3 rounded-lg group transition-all duration-200 cursor-pointer ${
                      isCurrentlyPlaying()
                        ? "bg-[var(--color-accent-500)]/20 border border-[var(--color-accent-500)]/50"
                        : "hover:bg-[var(--color-accent-500)]/10 border border-transparent"
                    }`}
                    style={{
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
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
                    {/* index number */}
                    <div
                      class={`w-6 text-center text-xs flex-shrink-0 ${
                        isCurrentlyPlaying()
                          ? "text-[var(--color-accent-500)] font-medium"
                          : "text-[var(--color-text-muted)]"
                      }`}
                    >
                      {isCurrentlyPlaying() ? (
                        <Icon
                          name="play"
                          size={14}
                          color="var(--color-accent-500)"
                        />
                      ) : (
                        itemIndex + 1
                      )}
                    </div>

                    {/* thumbnail */}
                    <div class="w-10 h-10 flex-shrink-0 ml-2 mr-3">
                      <Show
                        when={song()?.thumbnailUrl}
                        fallback={
                          <div class="w-full h-full bg-gradient-to-br from-[var(--color-accent-500)]/20 to-[var(--color-accent-500)]/40 rounded flex items-center justify-center">
                            <Icon
                              name="music"
                              size={16}
                              color="var(--color-accent-500)"
                            />
                          </div>
                        }
                      >
                        <img
                          src={song()!.thumbnailUrl}
                          alt={song()!.title}
                          class="w-full h-full rounded object-cover"
                          loading="lazy"
                        />
                      </Show>
                    </div>

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
                          hoverOnly={!isCurrentlyPlaying()}
                        />
                      </h4>
                      <p class="text-xs text-[var(--color-text-secondary)] m-0">
                        <MarqueeText
                          text={song()?.artist || ""}
                          hoverOnly={!isCurrentlyPlaying()}
                        />
                      </p>
                    </div>

                    {/* duration */}
                    <div class="text-xs text-[var(--color-text-muted)] ml-3 flex-shrink-0">
                      {formatDuration(song()?.duration)}
                    </div>

                    {/* remove button */}
                    <button
                      class={`${isMobile() ? "" : "opacity-0 group-hover:opacity-100 "}p-2 ml-2 text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/20 rounded-lg transition-all duration-200 flex-shrink-0`}
                      onClick={(e) => handleRemove(e, itemIndex)}
                      title="remove from queue"
                      aria-label="remove from queue"
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                );

                return props.getContextMenuActions && song() ? (
                  <ContextMenu
                    actions={props.getContextMenuActions(itemIndex, song()!)}
                  >
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
  );
}
