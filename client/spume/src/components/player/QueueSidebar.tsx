import { createVirtualizer } from "@tanstack/solid-virtual";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Song } from "../../music/data/types";
import type { QueueHistoryEntry } from "../../app/services/storage/types";
import { isMobile } from "../../utils/isMobile";
import { formatDuration } from "../../utils/formatDuration";
import { getSongDisplayImages, getWaveformImage } from "../../utils/images";
import { isCharnelMode } from "../../app/services/charnel";
import {
  getAutoDownloadEnabled,
  setAutoDownloadEnabled,
  getSyncQueueToLocal,
} from "../../app/services/storage/db";
import { onAutoDownloadEnabled } from "../../music/services/autoDownload";

import { Icon, type IconName } from "../icons/registry";
import { MediaThumbnail } from "../media/MediaThumbnail";
import { ContextMenu, type MenuAction } from "../overlays/ContextMenu";
import { MarqueeText } from "../text/MarqueeText";
import { isSongCachedReactive } from "../../music/services/cache/blobCache";
import { isSongSyncedLocally, getLoadingProgress } from "../../music/services/download";
import { isPlayingDirectURLReactive } from "../../music/services/storage/audioAccess";
import { useResolvedP2PImageUrl } from "../../music/services/storage/blobResolver";
import { getCachedBlobObjectURL } from "../../music/services/storage/blobs";
import { getBackgroundConfig } from "../../app/services/backgroundImage";

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
  /** current playback time in seconds (for progress fill) */
  currentTime?: number;
  /** current song duration in seconds (for progress fill) */
  duration?: number;
  /** max progress per queue_entry_id for played songs (reactive signal) */
  progressMap?: Map<string, number>;
  /** set of song sha256s currently being loaded/preloaded */
  loadingSongIds?: Set<string>;
  /** index of the song that is pending "up next" (loading to play next) */
  upNextIndex?: number;
  /** callback when resume downloads button is clicked */
  onResumeDownloads?: () => void;
  /** number of songs pending download (for resume button count) */
  pendingDownloadCount?: number;
}

// queue sidebar component
export function QueueSidebar(props: QueueSidebarProps) {
  let scrollElementRef: HTMLDivElement | undefined;
  let historyScrollRef: HTMLDivElement | undefined;

  // track which song we've scrolled to (plain var, not reactive)
  let lastScrolledSongId: string | null = null;

  const [activeTab, setActiveTab] = createSignal<QueueTab>("queue");
  const [draggedIndex, setDraggedIndex] = createSignal<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = createSignal<number | null>(null);

  // auto-download toggle state
  const [autoDownloadOn, setAutoDownloadOn] = createSignal(getAutoDownloadEnabled());

  const toggleAutoDownload = () => {
    const newValue = !autoDownloadOn();
    setAutoDownloadOn(newValue);
    setAutoDownloadEnabled(newValue);
    // when toggling ON, clear failed downloads to allow retry
    if (newValue) {
      onAutoDownloadEnabled();
    }
  };

  // pointer-based drag state for Tauri (HTML5 drag doesn't work in WKWebView)
  const [pointerDragIndex, setPointerDragIndex] = createSignal<number | null>(null);
  // pending pointer drag - waiting for movement threshold before activating
  let pendingPointerDrag: {
    index: number;
    startY: number;
    pointerId: number;
    target: HTMLElement;
  } | null = null;
  const DRAG_THRESHOLD = 8; // pixels of movement before drag activates

  // global dragend cleanup to prevent stuck drag state
  onMount(() => {
    const handleGlobalDragEnd = () => {
      setDraggedIndex(null);
      setDropTargetIndex(null);
    };
    document.addEventListener("dragend", handleGlobalDragEnd);
    onCleanup(() => {
      document.removeEventListener("dragend", handleGlobalDragEnd);
    });
  });

  // pointer-based drag for Tauri (HTML5 drag API doesn't work in WKWebView)
  onMount(() => {
    if (!isCharnelMode()) return;

    const handlePointerMove = (e: PointerEvent) => {
      // check if we have a pending drag that should activate
      if (pendingPointerDrag !== null) {
        const deltaY = Math.abs(e.clientY - pendingPointerDrag.startY);
        if (deltaY >= DRAG_THRESHOLD) {
          // activate drag
          setPointerDragIndex(pendingPointerDrag.index);
          pendingPointerDrag.target.setPointerCapture(pendingPointerDrag.pointerId);
          pendingPointerDrag = null;
        }
        return;
      }

      const idx = pointerDragIndex();
      if (idx === null) return;

      // find which row we're over based on Y position
      const scrollEl = scrollElementRef;
      if (!scrollEl) return;

      const rect = scrollEl.getBoundingClientRect();
      const scrollTop = scrollEl.scrollTop;
      const relativeY = e.clientY - rect.top + scrollTop;

      // calculate target index based on position (68px per row)
      const targetIndex = Math.floor(relativeY / 68);
      const clampedTarget = Math.max(0, Math.min(targetIndex, props.songs.length - 1));

      if (clampedTarget !== idx) {
        setDropTargetIndex(clampedTarget);
      } else {
        setDropTargetIndex(null);
      }
    };

    const handlePointerUp = () => {
      // cancel pending drag if not yet activated
      pendingPointerDrag = null;

      const fromIndex = pointerDragIndex();
      const toIndex = dropTargetIndex();

      if (fromIndex !== null && toIndex !== null && fromIndex !== toIndex) {
        props.onReorder?.(fromIndex, toIndex);
      }

      setPointerDragIndex(null);
      setDropTargetIndex(null);
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    onCleanup(() => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    });
  });

  // combined dragged index (works for both HTML5 drag and pointer drag)
  const effectiveDraggedIndex = () => (isCharnelMode() ? pointerDragIndex() : draggedIndex());

  const virtualizer = createVirtualizer({
    get count() {
      return props.songs.length;
    },
    getScrollElement: () => scrollElementRef ?? null,
    estimateSize: () => 68,
    overscan: 5,
  });

  const historyVirtualizer = createVirtualizer({
    get count() {
      return props.historyEntries.length;
    },
    getScrollElement: () => historyScrollRef ?? null,
    estimateSize: () => 56,
    overscan: 5,
  });

  // scroll to current song when it changes (once per song change)
  createEffect(() => {
    const currentSong = props.songs[props.currentIndex];
    const currentSongId = currentSong?.id;

    // only scroll if song changed and we have a valid song
    if (currentSongId && currentSongId !== lastScrolledSongId) {
      lastScrolledSongId = currentSongId;

      // check visibility before scrolling (subtract overscan to get actual viewport)
      const visibleItems = virtualizer.getVirtualItems();
      const visibleIndices = visibleItems.map((item) => item.index);
      const minVisible = Math.min(...visibleIndices) + 5; // account for overscan
      const maxVisible = Math.max(...visibleIndices) - 6;
      const isActuallyVisible =
        props.currentIndex >= minVisible && props.currentIndex <= maxVisible;

      // only scroll if not actually in viewport (excluding overscan buffer)
      if (!isActuallyVisible) {
        virtualizer.scrollToIndex(props.currentIndex, { align: "auto", behavior: "smooth" });
      }
    }
  });

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
      e.dataTransfer.setData("text/plain", String(index));
      // Safari has issues with drag images on transformed elements
      // Create a temporary clone positioned at 0,0 for the drag image
      const target = e.currentTarget as HTMLElement;
      const clone = target.cloneNode(true) as HTMLElement;
      clone.style.position = "absolute";
      clone.style.top = "-9999px";
      clone.style.left = "-9999px";
      clone.style.transform = "none";
      clone.style.width = `${target.offsetWidth}px`;
      document.body.appendChild(clone);
      e.dataTransfer.setDragImage(
        clone,
        e.clientX - target.getBoundingClientRect().left,
        e.clientY - target.getBoundingClientRect().top
      );
      // Clean up clone after drag starts
      requestAnimationFrame(() => clone.remove());
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

  const handleDragEnd = () => {
    setDraggedIndex(null);
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
  // narrow (<=800px): full-width bottom sheet that slides up
  // wide (>=801px): right sidebar

  return (
    <>
      {/* backdrop for overlay mode */}
      <Show when={isOverlay() && props.isOpen}>
        <div
          class="fixed inset-0 bg-black/50 z-1130 wide:hidden"
          style={{ "touch-action": "none" }}
          onClick={() => props.onClose()}
        />
      </Show>

      <div
        class={`${getBackgroundConfig() ? "bg-[var(--color-bg-primary)]/60" : "bg-[var(--color-bg-primary)]/95 backdrop-blur-xl"} flex flex-col ${
          isOverlay()
            ? /* narrow: bottom sheet above player bar, clears system status bar */
              `fixed z-1140 transition-transform duration-300 ease-out
               inset-x-0 bottom-[var(--player-height)] top-[env(safe-area-inset-top,0px)]
               wide:inset-x-auto wide:top-0 wide:right-0 wide:bottom-0 wide:h-auto wide:w-72 lg:w-80 xl:w-96
               ${
                 props.isOpen
                   ? "translate-y-0 wide:translate-y-0 wide:translate-x-0"
                   : "invisible translate-y-full wide:visible wide:translate-y-0 wide:translate-x-full"
               }`
            : props.isOpen
              ? "w-72 lg:w-80 xl:w-96 flex-shrink-0"
              : "hidden"
        } ${props.class || ""}`}
      >
        {/* drag handle for bottom sheet (narrow only) #TODO: enable swipe gesture for this or yank. */}
        {/* <Show when={isOverlay()}>
          <div class="wide:hidden flex justify-center py-2">
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

          <div class="flex items-center gap-1">
            <Show when={activeTab() === "queue"}>
              <button
                class={`px-1.5 py-1.5 rounded transition-colors ${
                  autoDownloadOn()
                    ? "text-[var(--color-accent-500)] bg-[var(--color-accent-500)]/20"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-500)]/10"
                }`}
                onClick={toggleAutoDownload}
                title={
                  autoDownloadOn()
                    ? "turn off auto download for all songs in the queue"
                    : "turn on auto download for all songs in the queue"
                }
                aria-label={autoDownloadOn() ? "disable auto download" : "enable auto download"}
              >
                <Icon name="autoDownload" size={14} />
              </button>
            </Show>

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
        </div>

        {/* resume downloads row - shows when sync_queue_to_local is enabled and there are pending downloads */}
        <Show
          when={
            activeTab() === "queue" &&
            getSyncQueueToLocal() &&
            props.pendingDownloadCount &&
            props.pendingDownloadCount > 0
          }
        >
          <div class="px-4 py-1.5">
            <button
              class="w-full px-3 py-1 text-xs text-[var(--color-accent-500)] hover:text-[var(--color-accent-400)] hover:bg-[var(--color-accent-500)]/10 rounded transition-colors text-center"
              onClick={() => props.onResumeDownloads?.()}
            >
              resume downloads ({props.pendingDownloadCount} pending)
            </button>
          </div>
        </Show>

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
                  const isUpNext = () => itemIndex === props.upNextIndex;

                  const isDragging = () => effectiveDraggedIndex() === itemIndex;
                  const isDropTarget = () => dropTargetIndex() === itemIndex;
                  const [isRowHovered, setIsRowHovered] = createSignal(false);

                  // calculate progress for this song row
                  const progress = (): number => {
                    const s = song();
                    if (!s) return 0;

                    if (isCurrentlyPlaying()) {
                      // currently playing: use live progress
                      const dur = props.duration ?? 0;
                      const ct = props.currentTime ?? 0;
                      return dur > 0 ? ct / dur : 0;
                    } else {
                      // not playing: use stored max progress from signal
                      const queueEntryId = s.queue_entry_id;
                      if (queueEntryId && props.progressMap) {
                        return props.progressMap.get(queueEntryId) ?? 0;
                      }
                      return 0;
                    }
                  };

                  // get waveform URL - check local blob first, then P2P/remote
                  const waveformUrl = () => {
                    const s = song();
                    if (!s?.images) return undefined;

                    const waveformImg = getWaveformImage(s.images);
                    if (!waveformImg) return undefined;

                    // local blob takes priority
                    if (waveformImg.local_blob_id) {
                      return getCachedBlobObjectURL(waveformImg.local_blob_id);
                    }

                    // fall back to remote/P2P resolution
                    return resolvedP2PWaveformUrl();
                  };

                  // P2P waveform resolver (only used for remote songs)
                  const resolvedP2PWaveformUrl = useResolvedP2PImageUrl(() => {
                    const s = song();
                    if (!s?.images) return undefined;

                    const waveformImg = getWaveformImage(s.images);
                    if (!waveformImg || waveformImg.local_blob_id) return undefined;

                    return {
                      blobId: waveformImg.remote_blob_id ?? undefined,
                      remoteId: waveformImg.remote_server_id ?? undefined,
                      httpFallback: waveformImg.remote_url,
                    };
                  });

                  const songRow = (
                    <div
                      draggable={!isCharnelMode()}
                      class={`absolute top-0 left-0 w-full flex items-center py-2 pl-2 group transition-all duration-200 cursor-move overflow-hidden ${
                        isDropTarget()
                          ? "bg-[var(--color-accent-500)]/20 border-t-2 border-[var(--color-accent-500)] scale-[1.02]"
                          : isDragging()
                            ? "opacity-40 bg-[var(--color-accent-500)]/5 scale-95"
                            : isCurrentlyPlaying()
                              ? "rounded-lg"
                              : progress() > 0
                                ? "rounded-lg"
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
                      onDragEnd={handleDragEnd}
                      onDrop={() => handleDrop(itemIndex)}
                      onPointerDown={(e) => {
                        // pointer-based drag for Tauri only - set up pending drag
                        if (isCharnelMode() && e.button === 0) {
                          pendingPointerDrag = {
                            index: itemIndex,
                            startY: e.clientY,
                            pointerId: e.pointerId,
                            target: e.currentTarget as HTMLElement,
                          };
                        }
                      }}
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
                      {/* progress fill background - behind all content */}
                      <Show when={progress() > 0}>
                        {/* static background behind thumbnail */}
                        <div
                          class="absolute inset-y-0 left-0 pointer-events-none z-0"
                          style={{
                            width: "60px",
                            "background-color": isCurrentlyPlaying()
                              ? "rgba(102, 0, 59, 0.55)"
                              : "rgba(102, 0, 59, 0.22)",
                          }}
                        />
                        {/* progress fill layer (starts after thumbnail, reveals progressively) */}
                        <div
                          class="absolute inset-y-0 pointer-events-none z-0"
                          style={{
                            left: "60px",
                            right: "0",
                            "background-color": isCurrentlyPlaying()
                              ? "rgba(102, 0, 59, 0.55)"
                              : "rgba(102, 0, 59, 0.22)",
                            "clip-path": `inset(0 ${100 - Math.min(progress() * 100, 100)}% 0 0)`,
                          }}
                        />
                        {/* waveform overlay layer (starts after thumbnail, reveals progressively, scaled 2x height) */}
                        <Show when={waveformUrl()}>
                          <div
                            class="absolute inset-y-0 pointer-events-none z-0 overflow-hidden"
                            style={{
                              left: "60px",
                              right: "0",
                              "clip-path": `inset(0 ${100 - Math.min(progress() * 100, 100)}% 0 0)`,
                            }}
                          >
                            <div
                              class="w-full h-full"
                              style={{
                                "background-image": `url(${waveformUrl()})`,
                                "background-position": "left center",
                                "background-size": "100% 100%",
                                "background-repeat": "no-repeat",
                                opacity: isCurrentlyPlaying() ? 0.5 : 0.15,
                                "mix-blend-mode": "screen",
                                transform: "scaleY(2)",
                              }}
                            />
                          </div>
                        </Show>
                      </Show>

                      {/* thumbnail with index overlay */}
                      <MediaThumbnail
                        images={song() ? getSongDisplayImages(song()!) : undefined}
                        index={itemIndex}
                        hideIndex={isRowHovered()}
                        isUpNext={isUpNext()}
                        onPlayClick={() => handleSongDoubleClick(itemIndex)}
                        showPlayIcon={!isCurrentlyPlaying()}
                        enablePlayClick={!isCurrentlyPlaying()}
                        size={48}
                        class="mr-3 relative z-10"
                      />

                      {/* song info */}
                      <div class="flex-1 min-w-0 relative z-10">
                        <h4
                          class={`text-sm font-medium m-0 text-shadow-glow ${
                            isCurrentlyPlaying()
                              ? "text-[var(--color-accent-500)] font-semibold"
                              : "text-[var(--color-text-primary)]"
                          }`}
                        >
                          <MarqueeText
                            text={song()?.title || ""}
                            isHovering={() => isRowHovered() || isCurrentlyPlaying()}
                          />
                        </h4>
                        <p
                          class={`text-xs m-0 text-shadow-glow ${
                            isCurrentlyPlaying()
                              ? "text-[var(--color-text-primary)] font-semibold"
                              : "text-[var(--color-text-secondary)]"
                          }`}
                        >
                          <MarqueeText
                            text={
                              song()?.album_type === "compilation" && song()?.track_artist?.trim()
                                ? song()!.track_artist!
                                : song()?.artist_name || ""
                            }
                            isHovering={() => isRowHovered() || isCurrentlyPlaying()}
                          />
                        </p>
                        <Show when={song()?.album_title}>
                          <p
                            class={`text-xs m-0 text-shadow-glow ${
                              isCurrentlyPlaying()
                                ? "text-[var(--color-text-secondary)] font-semibold"
                                : "text-[var(--color-text-tertiary)]"
                            }`}
                          >
                            <MarqueeText
                              text={song()?.album_title || ""}
                              isHovering={() => isRowHovered() || isCurrentlyPlaying()}
                            />
                          </p>
                        </Show>
                      </div>

                      {/* duration and favorite indicator */}
                      <div class="flex flex-col items-center ml-3 flex-shrink-0 relative z-10">
                        {/* favorite icon above duration */}
                        <div class="h-3 flex items-center -mt-2 mb-1.5">
                          <Show when={song()?.is_favorite}>
                            <Icon name="favorite" size={10} color="var(--color-accent-500)" />
                          </Show>
                        </div>
                        {/* duration with loading underline */}
                        <div class="relative inline-flex flex-col items-center">
                          <span
                            class="text-xs text-shadow-glow px-1"
                            style={{
                              color: (() => {
                                const isLoading = props.loadingSongIds?.has(song()?.sha256 ?? "");
                                // if loading, let animation handle color
                                if (isLoading) {
                                  return undefined;
                                }
                                return "var(--color-text-secondary)";
                              })(),
                              animation: props.loadingSongIds?.has(song()?.sha256 ?? "")
                                ? "pulse-text 4s ease-in-out infinite"
                                : undefined,
                              "text-decoration": (() => {
                                const isLoading = props.loadingSongIds?.has(song()?.sha256 ?? "");
                                // don't underline if currently loading
                                if (isLoading) return undefined;

                                // local/downloaded/synced songs are always available offline
                                const sourceType = song()?.source_type;
                                if (
                                  sourceType === "local" ||
                                  sourceType === "downloaded" ||
                                  sourceType === "synced"
                                ) {
                                  return "underline";
                                }

                                // check if remote song has been synced to local storage
                                const sha256 = song()?.sha256;
                                if (sha256 && isSongSyncedLocally(sha256)) {
                                  return "underline";
                                }

                                // for remote songs, underline only when cached (not when playing direct URL)
                                const isCached = isSongCachedReactive(
                                  song()?.remote_server_id,
                                  song()?.sha256
                                );
                                const isPlayingDirect =
                                  isCurrentlyPlaying() &&
                                  isPlayingDirectURLReactive(song()?.sha256);
                                return isCached && !isPlayingDirect ? "underline" : undefined;
                              })(),
                            }}
                          >
                            {formatDuration(song()?.duration_seconds)}
                          </span>
                          {/* loading underline - shows progress or bouncing bar */}
                          <Show when={props.loadingSongIds?.has(song()?.sha256 ?? "")}>
                            {(() => {
                              const sha256 = song()?.sha256;
                              const progress = sha256 ? getLoadingProgress(sha256) : undefined;
                              const hasProgress = typeof progress === "number" && progress >= 0;

                              return (
                                <div
                                  class="w-full h-0.5 overflow-hidden rounded-full"
                                  style={{
                                    "margin-top": "-2px",
                                    background: "rgba(168, 85, 247, 0.2)",
                                  }}
                                >
                                  <div
                                    style={{
                                      width: hasProgress
                                        ? `${Math.min(progress * 100, 100)}%`
                                        : "100%",
                                      height: "100%",
                                      background:
                                        "linear-gradient(90deg, #a855f7 0%, #d946ef 50%, #ec4899 100%)",
                                      animation: hasProgress
                                        ? undefined
                                        : "bounce-bar 2s ease-in-out infinite",
                                      "border-radius": "9999px",
                                      transition: hasProgress ? "width 150ms ease-out" : undefined,
                                    }}
                                  />
                                </div>
                              );
                            })()}
                          </Show>
                        </div>
                      </div>

                      {/* remove button */}
                      <button
                        class={`relative z-10 ${isMobile() ? "" : "opacity-0 group-hover:opacity-100 "}p-2 ml-2 text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/20 transition-all duration-200 flex-shrink-0`}
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
                  const progressPercent = () => {
                    const total = entry().total_seconds || 0;
                    if (total === 0) return 0;
                    return Math.min(100, ((entry().listened_seconds || 0) / total) * 100);
                  };
                  const hasProgress = () =>
                    (entry().listened_seconds || 0) > 0 && progressPercent() < 100;

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
                        <h4 class="text-sm font-medium text-[var(--color-text-primary)] m-0">
                          <MarqueeText text={entry().label} hoverOnly isHovering={isRowHovered} />
                        </h4>
                        <p class="text-xs text-[var(--color-text-secondary)] m-0">
                          {entry().type} &middot;{" "}
                          <Show
                            when={hasProgress()}
                            fallback={
                              <>
                                {entry().song_count} {entry().song_count === 1 ? "song" : "songs"}
                              </>
                            }
                          >
                            {entry().songs_completed}/{entry().song_count}{" "}
                            {entry().song_count === 1 ? "song" : "songs"} &middot;{" "}
                            {Math.round(progressPercent())}%
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

                      {/* timestamp + source name */}
                      <div class="text-xs text-[var(--color-text-muted)] ml-2 flex-shrink-0 text-right min-w-0 max-w-[5rem]">
                        <div>{timeAgo(entry().queued_at)}</div>
                        <div class="truncate" title={entry().remote_name || "local"}>
                          <MarqueeText
                            text={entry().remote_name || "local"}
                            isHovering={() => isRowHovered()}
                          />
                        </div>
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
