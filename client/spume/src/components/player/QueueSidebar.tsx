import { createVirtualizer } from "@tanstack/solid-virtual";
import { createSignal, For, Show, type JSX } from "solid-js";
import type { Song } from "../../music/data/types";
import type { QueueHistoryEntry } from "../../app/services/storage/types";
import { isMobile } from "../../utils/isMobile";
import { formatDuration } from "../../utils/formatDuration";
import { getSongDisplayImages } from "../../utils/images";

import { Icon, type IconName } from "../icons/registry";
import { MediaThumbnail } from "../media/MediaThumbnail";
import { ContextMenu, type MenuAction } from "../overlays/ContextMenu";
import { MarqueeText } from "../text/MarqueeText";
import { isBlobCachedReactive } from "../../music/services/cache/blobCache";
import { isPlayingDirectURLReactive } from "../../music/services/storage/audioAccess";

type QueueTab = "queue" | "history";

// relative time formatting
function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

// icon name for history entry type
function historyTypeIcon(type: QueueHistoryEntry["type"]): IconName {
  switch (type) {
    case "song":
      return "music";
    case "album":
      return "album";
    case "artist":
      return "artist";
    case "genre":
      return "genre";
    case "playlist":
      return "playlist";
    case "shuffle":
      return "shuffle";
    default:
      return "queue";
  }
}

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
  /** history entries */
  historyEntries: QueueHistoryEntry[];
  /** callback to replay a history entry */
  onReplayHistoryEntry?: (entry: QueueHistoryEntry) => void;
  /** callback to remove a history entry */
  onRemoveHistoryEntry?: (id: string) => void;
  /** callback to clear all history */
  onClearHistory?: () => void;
  /** callback to get context menu actions for a history entry */
  getHistoryContextMenuActions?: (entry: QueueHistoryEntry) => MenuAction[];
  /** additional classes */
  class?: string;
}

// queue sidebar component
export function QueueSidebar(props: QueueSidebarProps) {
  let scrollElementRef: HTMLDivElement | undefined;
  let historyScrollRef: HTMLDivElement | undefined;

  const [activeTab, setActiveTab] = createSignal<QueueTab>("queue");
  const [draggedIndex, setDraggedIndex] = createSignal<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = createSignal<number | null>(null);

  const virtualizer = createVirtualizer({
    get count() {
      return props.songs.length;
    },
    getScrollElement: () => scrollElementRef,
    estimateSize: () => 60,
    overscan: 5,
  });

  const historyVirtualizer = createVirtualizer({
    get count() {
      return props.historyEntries.length;
    },
    getScrollElement: () => historyScrollRef,
    estimateSize: () => 56,
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

        {/* header — tabs + clear + close */}
        <div class="flex items-center justify-between px-4 pt-3 pb-2">
          <div class="flex items-center gap-1">
            <button
              class={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                activeTab() === "queue"
                  ? "text-[var(--color-accent-500)] bg-[var(--color-accent-500)]/10"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-accent-500)]/5"
              }`}
              onClick={() => setActiveTab("queue")}
            >
              queue{props.songs.length > 0 ? ` (${props.songs.length})` : ""}
            </button>
            <button
              class={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                activeTab() === "history"
                  ? "text-[var(--color-accent-500)] bg-[var(--color-accent-500)]/10"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-accent-500)]/5"
              }`}
              onClick={() => setActiveTab("history")}
            >
              history
              {/* {props.historyEntries.length > 0 ? ` (${props.historyEntries.length})` : ""} */}
            </button>
          </div>

          <Show
            when={
              (activeTab() === "queue" && props.songs.length > 0) ||
              (activeTab() === "history" && props.historyEntries.length > 0)
            }
          >
            <button
              class="px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-accent-500)]/10 rounded transition-colors"
              onClick={() => {
                if (activeTab() === "queue") {
                  props.onClearAll();
                } else {
                  props.onClearHistory?.();
                }
              }}
              title={
                activeTab() === "queue" ? "clear all songs from queue" : "clear all queue history"
              }
            >
              clear
            </button>
          </Show>

          <button
            class="p-2 hover:bg-[var(--color-accent-500)]/20 transition-colors"
            onClick={() => props.onClose()}
            title="close"
            aria-label="close"
          >
            <Icon name="close" size={20} color="var(--color-accent-500)" />
          </button>
        </div>

        {/* queue tab content */}
        <div
          ref={scrollElementRef}
          class="flex-1 overflow-y-auto"
          style={{
            "overflow-anchor": "none",
            "overscroll-behavior": "contain",
            display: activeTab() === "queue" ? undefined : "none",
          }}
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
                          handleSongDoubleClick(itemIndex);
                        }
                      }}
                      onDblClick={() => {
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
                        images={song() ? getSongDisplayImages(song()!) : undefined}
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
                        <div
                          class="text-xs"
                          style={{
                            color:
                              isBlobCachedReactive(song()?.source_url) &&
                              !(isCurrentlyPlaying() && isPlayingDirectURLReactive(song()?.sha256))
                                ? "var(--color-text-secondary)"
                                : "var(--color-text-muted)",
                          }}
                        >
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

        {/* history tab content */}
        <div
          ref={historyScrollRef}
          class="flex-1 overflow-y-auto"
          style={{
            "overflow-anchor": "none",
            "overscroll-behavior": "contain",
            display: activeTab() === "history" ? undefined : "none",
          }}
        >
          <Show
            when={props.historyEntries.length > 0}
            fallback={
              <div class="flex flex-col items-center justify-center h-full text-center px-8">
                <div class="w-16 h-16 mb-4 bg-[var(--color-accent-500)]/10 flex items-center justify-center">
                  <Icon name="recent" size={32} color="var(--color-accent-500)" />
                </div>
                <p class="text-[var(--color-text-secondary)] text-sm m-0 mb-2">no history yet</p>
                <p class="text-[var(--color-text-muted)] text-xs m-0">
                  songs you queue will appear here
                </p>
              </div>
            }
          >
            <div
              class="relative p-2"
              style={{
                height: `${historyVirtualizer.getTotalSize()}px`,
              }}
            >
              <For each={historyVirtualizer.getVirtualItems()} fallback={null}>
                {(virtualItem) => {
                  const entry = () => props.historyEntries[virtualItem.index];
                  const [isRowHovered, setIsRowHovered] = createSignal(false);
                  const isArtist = () => entry().type === "artist";
                  const hasProgress = () => (entry().listened_seconds || 0) > 0;
                  const progressPercent = () => {
                    const total = entry().total_seconds || 0;
                    if (total === 0) return 0;
                    return Math.min(100, ((entry().listened_seconds || 0) / total) * 100);
                  };

                  const historyRow = (
                    <div
                      class="absolute top-0 left-0 w-full flex items-center px-2 py-1.5 group transition-all duration-200 cursor-pointer hover:bg-[var(--color-accent-500)]/10"
                      style={{
                        transform: `translateY(${virtualItem.start}px)`,
                        height: `${virtualItem.size}px`,
                      }}
                      onMouseEnter={() => setIsRowHovered(true)}
                      onMouseLeave={() => setIsRowHovered(false)}
                      onClick={() => {
                        if (isMobile()) {
                          props.onReplayHistoryEntry?.(entry());
                        }
                      }}
                      onDblClick={() => {
                        if (!isMobile()) {
                          props.onReplayHistoryEntry?.(entry());
                        }
                      }}
                      title={
                        isMobile()
                          ? hasProgress()
                            ? "tap to resume"
                            : "tap to re-queue"
                          : hasProgress()
                            ? "double-click to resume"
                            : "double-click to re-queue"
                      }
                    >
                      {/* type icon / thumbnail */}
                      <div
                        class={`w-10 h-10 flex-shrink-0 mr-3 flex items-center justify-center ${isArtist() ? "rounded-full" : "rounded"} bg-[var(--color-accent-500)]/10 overflow-hidden relative`}
                      >
                        <Show
                          when={entry().image}
                          fallback={
                            <Icon
                              name={historyTypeIcon(entry().type)}
                              size={20}
                              color="var(--color-accent-500)"
                            />
                          }
                        >
                          <MediaThumbnail
                            images={entry().image ? [entry().image!] : undefined}
                            size={40}
                            class={isArtist() ? "rounded-full" : undefined}
                          />
                        </Show>
                      </div>

                      {/* label + song count + progress */}
                      <div class="flex-1 min-w-0">
                        <h4 class="text-sm font-medium text-[var(--color-text-primary)] m-0 truncate">
                          {entry().label}
                        </h4>
                        <p class="text-xs text-[var(--color-text-secondary)] m-0">
                          {entry().type} &middot; {entry().song_count}{" "}
                          {entry().song_count === 1 ? "song" : "songs"}
                          <Show when={hasProgress()}>
                            {" "}
                            &middot; {Math.round(progressPercent())}%
                          </Show>
                        </p>

                        {/* progress bar */}
                        <Show when={hasProgress()}>
                          <div class="mt-1 h-0.5 bg-[var(--color-accent-500)]/20 rounded-full overflow-hidden">
                            <div
                              class="h-full bg-[var(--color-accent-500)] rounded-full transition-all duration-300"
                              style={{ width: `${progressPercent()}%` }}
                            />
                          </div>
                        </Show>
                      </div>

                      {/* timestamp */}
                      <div class="text-xs text-[var(--color-text-muted)] ml-2 flex-shrink-0">
                        {timeAgo(entry().queued_at)}
                      </div>

                      {/* remove button */}
                      <button
                        class={`${isMobile() ? "" : "opacity-0 group-hover:opacity-100 "}p-1.5 ml-1 text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/20 transition-all duration-200 flex-shrink-0`}
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onRemoveHistoryEntry?.(entry().id);
                        }}
                        title="remove from history"
                        aria-label="remove from history"
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  );

                  return props.getHistoryContextMenuActions && entry() ? (
                    <ContextMenu actions={props.getHistoryContextMenuActions(entry()!)}>
                      {historyRow}
                    </ContextMenu>
                  ) : (
                    historyRow
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
