import { createVirtualizer } from "@tanstack/solid-virtual";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { MediaItem } from "../../app/services/storage/mediaItem";
import { mediaItemKey } from "../../app/services/storage/mediaItem";
import { QueueSongRow } from "./QueueSongRow";
import { VideoQueueRow } from "./VideoQueueRow";
import { RemoteQueueRow } from "./RemoteQueueRow";
import { QueuePlayerTargetRow } from "./QueuePlayerTargetRow";
import type { QueueHistoryEntry, RadioStationRef } from "../../app/services/storage/types";
import type { ImageMetadata } from "../../music/services/storage/types";
import { isMobile } from "../../utils/isMobile";
import { isCharnelMode } from "../../app/services/charnel";
import {
  getAutoDownloadEnabled,
  setAutoDownloadEnabled,
  getSyncQueueToLocal,
} from "../../app/services/storage/db";
import { onAutoDownloadEnabled } from "../../music/services/autoDownload";
import { isRemoteTargetActive } from "../../app/services/players/activeTarget";
import { optimisticRemoteQueue } from "../../app/services/players/remoteQueueMirror";
import {
  remoteAutoDownloadEnabled,
  remoteSetAutoDownloadEnabled,
  remoteQueue,
  remotePositionMs,
  remoteOptimisticCurrentIndex,
  remoteReorderQueue,
  remoteRemoveFromQueue,
  remoteStatusKnown,
} from "../../app/services/players/remotePlaybackControl";

import { Icon, type IconName } from "../icons/registry";
import { MediaThumbnail } from "../media/MediaThumbnail";
import { ContextMenu, type MenuAction } from "../overlays/ContextMenu";
import { MarqueeText } from "../text/MarqueeText";
import { getBackgroundConfig } from "../../app/services/backgroundImage";

type QueueTab = "queue" | "history";

// fixed row height for the remote-queue block (phase 14a) - no
// virtualizer there yet, see the render block's comment for why; matches
// the local list's virtualizer `estimateSize`.
const ROW_HEIGHT = 68;

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
    case "radio_station":
      return "headphones";
    default:
      return "queue";
  }
}

export interface QueueSidebarProps {
  /** unified, ordered song+video queue (a single interleaved list, per
   * phase 4b — replaces the old separate `songs`/`videos` props, which
   * always rendered videos as one non-virtualized block above the songs
   * regardless of their real position in the queue). */
  items: MediaItem[];
  /** currently playing index into `items` */
  currentIndex: number;
  /** whether sidebar is open */
  isOpen: boolean;
  /** callback when close button clicked */
  onClose: () => void;
  /** callback when an item row is clicked (mobile tap) */
  onItemClick: (index: number) => void;
  /** callback when an item row is double-clicked (desktop) */
  onItemDoubleClick?: (index: number) => void;
  /** callback when an item's remove button is clicked */
  onRemoveItem: (index: number) => void;
  /** callback when clear all clicked */
  onClearAll: () => void;
  /** callback to get context menu actions for an item */
  getContextMenuActions?: (index: number, item: MediaItem) => MenuAction[];
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
  /** currently tuned radio station (if any) */
  currentRadioStation?: RadioStationRef | null;
  /** resolved name for the radio station source remote */
  currentRadioRemoteName?: string;
  /** resolved remote/server image for radio fallback */
  currentRadioRemoteImage?: ImageMetadata;
  /** callback when radio queue entry is clicked */
  onRadioQueueEntryClick?: (station: RadioStationRef) => void;
  /** callback to get context menu actions for the radio queue entry */
  getRadioQueueContextMenuActions?: (station: RadioStationRef) => MenuAction[];
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
  /** ids (song sha256s or video ids) currently being loaded/preloaded */
  loadingIds?: Set<string>;
  /** index of the item that is pending "up next" (loading to play next) */
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

  // track which item we've scrolled to (plain var, not reactive)
  let lastScrolledItemKey: string | null = null;

  const [activeTab, setActiveTab] = createSignal<QueueTab>("queue");
  const [draggedIndex, setDraggedIndex] = createSignal<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = createSignal<number | null>(null);
  // phase 14c: separate, independent drag state for the remote-queue
  // block - kept isolated from the local queue's drag state above (which
  // is more involved: HTML5 drag-image cloning, Tauri pointer-drag) to
  // avoid risking a regression there for a feature only active while a
  // remote target is active anyway (the two blocks are mutually
  // exclusive, see the render's outer `<Show when={!isRemoteTargetActive()}>`).
  const [remoteDraggedIndex, setRemoteDraggedIndex] = createSignal<number | null>(null);
  const [remoteDropTargetIndex, setRemoteDropTargetIndex] = createSignal<number | null>(null);
  const hasRadioQueueEntry = () => !!props.currentRadioStation;
  const queueEntryCount = () => props.items.length + (hasRadioQueueEntry() ? 1 : 0);

  // history doesn't make sense once the queue is shared with a remote
  // player - bounce back to the queue tab if it was open when that starts.
  createEffect(() => {
    if (isRemoteTargetActive() && activeTab() === "history") setActiveTab("queue");
  });

  // auto-download toggle state - while a remote target is active, this
  // reflects/propagates the *shared* setting (see remotePlaybackControl.ts's
  // remoteAutoDownloadEnabled/remoteSetAutoDownloadEnabled) instead of this
  // device's own local preference, so every client watching the same
  // player shows and controls the same toggle.
  const [autoDownloadOn, setAutoDownloadOn] = createSignal(getAutoDownloadEnabled());
  const effectiveAutoDownloadOn = () =>
    isRemoteTargetActive() ? remoteAutoDownloadEnabled() : autoDownloadOn();

  const toggleAutoDownload = () => {
    const newValue = !effectiveAutoDownloadOn();
    if (isRemoteTargetActive()) {
      void remoteSetAutoDownloadEnabled(newValue);
      return;
    }
    setAutoDownloadOn(newValue);
    setAutoDownloadEnabled(newValue);
    // when toggling ON, clear failed downloads to allow retry
    if (newValue) {
      onAutoDownloadEnabled();
    }
  };

  // pointer-based drag state for Tauri (HTML5 drag doesn't work in WKWebView)
  const [pointerDragIndex, setPointerDragIndex] = createSignal<number | null>(null);
  // same, for the remote queue's own row list (see phase 14c comment above
  // draggedIndex/dropTargetIndex) - kept as a separate signal so remote-
  // queue pointer-dragging can't interfere with a local-queue drag still
  // mid-flight, even though the two lists are mutually exclusive in the UI.
  const [remotePointerDragIndex, setRemotePointerDragIndex] = createSignal<number | null>(null);
  // pending pointer drag - waiting for movement threshold before activating.
  // `list` picks which signals/reorder-callback activation targets once the
  // threshold is crossed (see handlePointerMove/handlePointerUp below).
  let pendingPointerDrag: {
    index: number;
    startY: number;
    pointerId: number;
    target: HTMLElement;
    list: "local" | "remote";
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
          // activate drag - which signal depends on which list this pending
          // drag started on (see onPointerDown handlers below).
          if (pendingPointerDrag.list === "remote") {
            setRemotePointerDragIndex(pendingPointerDrag.index);
          } else {
            setPointerDragIndex(pendingPointerDrag.index);
          }
          pendingPointerDrag.target.setPointerCapture(pendingPointerDrag.pointerId);
          pendingPointerDrag = null;
        }
        return;
      }

      const remoteIdx = remotePointerDragIndex();
      const idx = remoteIdx !== null ? null : pointerDragIndex();
      if (remoteIdx === null && idx === null) return;

      // find which row we're over based on Y position
      const scrollEl = scrollElementRef;
      if (!scrollEl) return;

      const rect = scrollEl.getBoundingClientRect();
      const scrollTop = scrollEl.scrollTop;
      const relativeY = e.clientY - rect.top + scrollTop;

      // calculate target index based on position (68px per row)
      const targetIndex = Math.floor(relativeY / 68);

      if (remoteIdx !== null) {
        const clampedTarget = Math.max(0, Math.min(targetIndex, remoteQueue().length - 1));
        setRemoteDropTargetIndex(clampedTarget !== remoteIdx ? clampedTarget : null);
        return;
      }

      const clampedTarget = Math.max(0, Math.min(targetIndex, props.items.length - 1));
      setDropTargetIndex(clampedTarget !== idx ? clampedTarget : null);
    };

    const handlePointerUp = () => {
      // cancel pending drag if not yet activated
      pendingPointerDrag = null;

      const remoteFromIndex = remotePointerDragIndex();
      if (remoteFromIndex !== null) {
        const toIndex = remoteDropTargetIndex();
        if (toIndex !== null && remoteFromIndex !== toIndex) {
          void remoteReorderQueue(remoteFromIndex, toIndex);
        }
        setRemotePointerDragIndex(null);
        setRemoteDropTargetIndex(null);
        return;
      }

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
  const effectiveRemoteDraggedIndex = () =>
    isCharnelMode() ? remotePointerDragIndex() : remoteDraggedIndex();

  const virtualizer = createVirtualizer({
    get count() {
      return props.items.length;
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

  // scroll to current item when it changes (once per item change)
  createEffect(() => {
    const currentItem = props.items[props.currentIndex];
    const currentKey = currentItem ? mediaItemKey(currentItem) : undefined;

    // only scroll if item changed and we have a valid item
    if (currentKey && currentKey !== lastScrolledItemKey) {
      lastScrolledItemKey = currentKey;

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

  const handleItemDoubleClick = (index: number) => {
    props.onItemDoubleClick?.(index);
  };

  const handleRemove = (e: MouseEvent, index: number) => {
    e.stopPropagation();
    props.onRemoveItem(index);
  };

  // shared HTML5-drag setup for both the local queue's rows and the
  // remote queue's rows - factored out because the remote queue's own
  // `onDragStart` previously skipped this entirely (see phase 15's "can't
  // drag remote queue rows" fix): without `effectAllowed`/`setData`, some
  // browsers refuse the drop outright, and without the Safari drag-image
  // workaround below, dragging a `transform`-positioned row (both lists
  // use `transform: translateY(...)` for row placement) can produce a
  // broken/invisible drag in Safari.
  const setupDragImage = (e: DragEvent, index: number) => {
    if (!e.dataTransfer) return;
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
  };

  const handleDragStart = (index: number) => (e: DragEvent) => {
    setDraggedIndex(index);
    setupDragImage(e, index);
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
            ? /* narrow: bottom sheet above player bar, clears system status bar
                 (or the chromeless title-bar strip on macOS, if active - both
                 flow through --safe-area-top, see theme.css / TitleBarStrip) */
              `fixed z-1140 transition-transform duration-300 ease-out
               inset-x-0 bottom-[var(--player-height)] top-[var(--safe-area-top,0px)]
               wide:inset-x-auto wide:top-0 wide:right-0 wide:bottom-0 wide:h-auto wide:w-72 lg:w-80 xl:w-96
               ${
                 props.isOpen
                   ? "translate-y-0 wide:translate-y-0 wide:translate-x-0"
                   : "invisible translate-y-full wide:visible wide:translate-y-0 wide:translate-x-full"
               }`
            : props.isOpen
              ? "relative z-[110] w-72 lg:w-80 xl:w-96 flex-shrink-0"
              : "hidden"
        } ${props.class || ""}`}
      >
        {/* drag handle for bottom sheet (narrow only) #TODO: enable swipe gesture for this or yank. */}
        {/* <Show when={isOverlay()}>
          <div class="wide:hidden flex justify-center py-2">
            <div class="w-12 h-1 bg-[var(--color-border-strong)] rounded-full" />
          </div>
        </Show> */}

        {/* header — tabs + clear + close.
            relative + z-[110]: in inline/wide mode this header (and its
            z-[110] parent above) sits at the very top of the sidebar,
            which can overlap the chromeless title-bar drag strip (see
            App.tsx / TitleBarStrip, z-[100]) - queue controls must win
            that overlap so they stay clickable. no-op in overlay/narrow
            mode (the whole drawer is already z-1140). */}
        <div class="relative z-[110] flex items-center justify-between px-4 pt-3 pb-2">
          <div class="flex items-center gap-1">
            <button
              class={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                activeTab() === "queue"
                  ? "text-[var(--color-accent-500)] bg-[var(--color-accent-500)]/10"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-accent-500)]/5"
              }`}
              onClick={() => setActiveTab("queue")}
            >
              queue{queueEntryCount() > 0 ? ` (${queueEntryCount()})` : ""}
            </button>
            <Show when={!isRemoteTargetActive()}>
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
            </Show>
          </div>

          <div class="flex items-center gap-1">
            <Show when={activeTab() === "queue"}>
              <button
                class={`px-1.5 py-1.5 rounded transition-colors ${
                  effectiveAutoDownloadOn()
                    ? "text-[var(--color-accent-500)] bg-[var(--color-accent-500)]/20"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-500)]/10"
                }`}
                onClick={toggleAutoDownload}
                title={
                  effectiveAutoDownloadOn()
                    ? "turn off auto download for all songs in the queue"
                    : "turn on auto download for all songs in the queue"
                }
                aria-label={
                  effectiveAutoDownloadOn() ? "disable auto download" : "enable auto download"
                }
              >
                <Icon name="autoDownload" size={14} />
              </button>
            </Show>

            <Show
              when={
                (activeTab() === "queue" && (props.items.length > 0 || hasRadioQueueEntry())) ||
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

        {/* current radio station display */}
        <Show when={activeTab() === "queue" && props.currentRadioStation}>
          <div class="px-3 py-2">
            {(() => {
              const station = props.currentRadioStation!;
              const radioCard = (
                <button
                  class="w-full text-left flex items-center gap-2 px-2 py-2 rounded-lg bg-[var(--color-accent-500)]/10 hover:bg-[var(--color-accent-500)]/20 transition-colors"
                  onClick={() => props.onRadioQueueEntryClick?.(station)}
                  title="resume radio station"
                >
                  <Show
                    when={station.art_thumb_b64}
                    fallback={
                      <MediaThumbnail
                        images={
                          props.currentRadioRemoteImage
                            ? [props.currentRadioRemoteImage]
                            : undefined
                        }
                        size={40}
                        showPlayIcon={false}
                        enablePlayClick={false}
                        hideIndex
                        class="mr-1"
                      />
                    }
                  >
                    {(b64) => (
                      <div class="w-10 h-10 rounded overflow-hidden bg-gray-800/50 flex-shrink-0 mr-1">
                        <img
                          src={`data:${station.art_thumb_mime ?? "image/jpeg"};base64,${b64()}`}
                          alt=""
                          class="w-full h-full object-cover"
                        />
                      </div>
                    )}
                  </Show>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium text-[var(--color-text-primary)] truncate">
                      {station.station_name}
                    </div>
                    <div class="text-xs text-[var(--color-text-secondary)] truncate">
                      {props.currentRadioRemoteName ?? (station.is_local ? "local" : "remote")}
                    </div>
                  </div>
                </button>
              );

              const actions = props.getRadioQueueContextMenuActions?.(station);
              return actions && actions.length > 0 ? (
                <ContextMenu actions={actions}>{radioCard}</ContextMenu>
              ) : (
                radioCard
              );
            })()}
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
            // stay on the LOCAL queue view (still showing whatever this
            // device had queued pre-switch) until the player's own status
            // actually arrives - avoids a jarring "queue is empty" flash
            // the instant a remote target is selected (see
            // selectPlaybackTarget.ts's resetRemoteStatus() call, which
            // intentionally clears remoteStatus right away so a PREVIOUS
            // target's stale status never shows through). once the real
            // status lands, this swaps to the confirmed remote queue.
            when={!isRemoteTargetActive() || !remoteStatusKnown()}
            fallback={
              <Show
                when={optimisticRemoteQueue().length > 0}
                fallback={
                  <div class="flex flex-col items-center justify-center h-full text-center px-8">
                    <div class="w-16 h-16 mb-4 bg-[var(--color-accent-500)]/10 flex items-center justify-center">
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
                {/* phase 14a/14c: remote target's shared queue - any
                    connected client can reorder/remove (14c), current
                    entry (index 0, "current item first" per the player's
                    status protocol) is highlighted and ticks its own
                    progress from the local clock (14d), and the current
                    index optimistically advances a single step once the
                    ticking clock predicts the item has finished (14e) -
                    all purely display-layer, self-correcting once the
                    next real status lands. no virtualizer yet (remote
                    queues are expected to stay modest-sized) - revisit if
                    that becomes a real limitation.
                    phase 18: rows beyond confirmedCount() are this
                    device's own optimistic, not-yet-acked additions (see
                    remoteQueueMirror.ts's optimisticRemoteQueue) - shown
                    right away instead of waiting for the player's ack,
                    but not yet draggable/removable since they don't have
                    a real remote index yet. */}
                <div
                  class="relative p-2"
                  style={{ height: `${optimisticRemoteQueue().length * ROW_HEIGHT}px` }}
                >
                  <For each={optimisticRemoteQueue()} fallback={null}>
                    {(ref, i) => {
                      const confirmedCount = () => remoteQueue().length;
                      const isPending = () => i() >= confirmedCount();
                      const isCurrentlyPlaying = () => i() === remoteOptimisticCurrentIndex();
                      const isDragging = () => effectiveRemoteDraggedIndex() === i();
                      const isDropTarget = () => remoteDropTargetIndex() === i();

                      return (
                        <RemoteQueueRow
                          item={ref}
                          index={i()}
                          isCurrentlyPlaying={isCurrentlyPlaying()}
                          isPending={isPending()}
                          positionMs={isCurrentlyPlaying() ? remotePositionMs() : undefined}
                          isDragging={isDragging()}
                          isDropTarget={isDropTarget()}
                          top={i() * ROW_HEIGHT}
                          onClick={() => {}}
                          onDoubleClick={() => {}}
                          onRemove={(e) => {
                            e.stopPropagation();
                            if (isPending()) return;
                            void remoteRemoveFromQueue(i());
                          }}
                          onDragStart={(e) => {
                            if (isPending()) return;
                            setRemoteDraggedIndex(i());
                            setupDragImage(e, i());
                          }}
                          onDragOver={(e) => {
                            if (isPending()) return;
                            e.preventDefault();
                            if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                            setRemoteDropTargetIndex(i());
                          }}
                          onDragLeave={() => setRemoteDropTargetIndex(null)}
                          onDragEnd={() => {
                            setRemoteDraggedIndex(null);
                            setRemoteDropTargetIndex(null);
                          }}
                          onDrop={() => {
                            if (isPending()) return;
                            const fromIndex = remoteDraggedIndex();
                            const toIndex = i();
                            setRemoteDraggedIndex(null);
                            setRemoteDropTargetIndex(null);
                            if (fromIndex === null || fromIndex === toIndex) return;
                            void remoteReorderQueue(fromIndex, toIndex);
                          }}
                          onPointerDown={(e) => {
                            // pointer-based drag for Tauri only (native HTML5
                            // drag doesn't work in WKWebView) - see the local
                            // queue's identical pattern above.
                            if (isPending()) return;
                            if (isCharnelMode() && e.button === 0) {
                              pendingPointerDrag = {
                                index: i(),
                                startY: e.clientY,
                                pointerId: e.pointerId,
                                target: e.currentTarget as HTMLElement,
                                list: "remote",
                              };
                            }
                          }}
                        />
                      );
                    }}
                  </For>
                </div>
              </Show>
            }
          >
            <Show when={props.items.length === 0}>
              <Show
                when={!hasRadioQueueEntry()}
                fallback={
                  <div class="flex flex-col items-center justify-center h-full text-center px-8">
                    <p class="text-[var(--color-text-secondary)] text-sm m-0 mb-2">
                      no songs queued
                    </p>
                    <p class="text-[var(--color-text-muted)] text-xs m-0">
                      radio is saved above as a queue entry
                    </p>
                  </div>
                }
              >
                <div class="flex flex-col items-center justify-center h-full text-center px-8">
                  <div class="w-16 h-16 mb-4 bg-[var(--color-accent-500)]/10 flex items-center justify-center">
                    <Icon name="queue" size={32} color="var(--color-accent-500)" />
                  </div>
                  <p class="text-[var(--color-text-secondary)] text-sm m-0 mb-2">queue is empty</p>
                  <p class="text-[var(--color-text-muted)] text-xs m-0">
                    add songs to see them here
                  </p>
                </div>
              </Show>
            </Show>

            {/* unified, virtualized song+video queue list (phase 4b) - one
                virtualizer/reconciliation pass for the whole interleaved
                queue instead of a separate non-virtualized video block,
                which also fixes video rows losing their identity (and
                re-mounting/flickering their thumbnail) on every queue
                change since they were rebuilt as brand-new wrapper objects
                on each render. */}
            <Show when={props.items.length > 0}>
              <div
                class="relative p-2"
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                }}
              >
                <For each={virtualizer.getVirtualItems()} fallback={null}>
                  {(virtualItem) => {
                    const itemIndex = virtualItem.index;
                    // memoized: `createMemo`'s default `===` equality bails
                    // out downstream recomputation whenever `props.items`
                    // re-derives (e.g. every periodic `saveProgressToIDB`
                    // flush during playback) but the object reference at
                    // THIS index is unchanged - without this, every row
                    // (including untouched video rows) would tear down and
                    // rebuild its whole child component on every flush,
                    // which is what caused the video-thumbnail flicker.
                    const item = createMemo(() => props.items[itemIndex]);
                    const isCurrentlyPlaying = () => itemIndex === props.currentIndex;
                    const isUpNext = () => itemIndex === props.upNextIndex;
                    const isDragging = () => effectiveDraggedIndex() === itemIndex;
                    const isDropTarget = () => dropTargetIndex() === itemIndex;

                    // calculate progress for currently-relevant rows. songs
                    // have a stored per-queue-entry max progress; videos
                    // don't (yet) - only their live currently-playing
                    // progress is shown.
                    const progress = (): number => {
                      const it = item();
                      if (!it) return 0;
                      if (isCurrentlyPlaying()) {
                        const dur = props.duration ?? 0;
                        const ct = props.currentTime ?? 0;
                        return dur > 0 ? ct / dur : 0;
                      }
                      if (it.kind === "song") {
                        const queueEntryId = it.song.queue_entry_id;
                        if (queueEntryId && props.progressMap) {
                          return props.progressMap.get(queueEntryId) ?? 0;
                        }
                      }
                      return 0;
                    };

                    const dragHandlers = {
                      onDragStart: handleDragStart(itemIndex),
                      onDragOver: handleDragOver(itemIndex),
                      onDragLeave: handleDragLeave,
                      onDragEnd: handleDragEnd,
                      onDrop: () => handleDrop(itemIndex),
                      onPointerDown: (e: PointerEvent) => {
                        // pointer-based drag for Tauri only - set up pending drag
                        if (isCharnelMode() && e.button === 0) {
                          pendingPointerDrag = {
                            index: itemIndex,
                            startY: e.clientY,
                            pointerId: e.pointerId,
                            target: e.currentTarget as HTMLElement,
                            list: "local",
                          };
                        }
                      },
                    };

                    return (
                      // `keyed`: the children callback below only re-runs
                      // (and thus only reconstructs `<QueueSongRow>`/
                      // `<VideoQueueRow>`) when `item()`'s memoized value
                      // actually changes reference - individual props
                      // (isCurrentlyPlaying, progress, etc.) still update
                      // live via Solid's per-attribute getter reactivity,
                      // since those are read fresh on each JSX prop access
                      // regardless of how often this outer callback reruns.
                      <Show when={item()} keyed>
                        {(it) => {
                          const row =
                            it.kind === "song" ? (
                              <QueueSongRow
                                song={it.song}
                                index={itemIndex}
                                isCurrentlyPlaying={isCurrentlyPlaying()}
                                isUpNext={isUpNext()}
                                isDragging={isDragging()}
                                isDropTarget={isDropTarget()}
                                top={virtualItem.start}
                                progress={progress()}
                                loadingIds={props.loadingIds}
                                onClick={() => handleItemDoubleClick(itemIndex)}
                                onDoubleClick={() => handleItemDoubleClick(itemIndex)}
                                onRemove={(e) => handleRemove(e, itemIndex)}
                                {...dragHandlers}
                              />
                            ) : (
                              <VideoQueueRow
                                video={it.video}
                                index={itemIndex}
                                isCurrentlyPlaying={isCurrentlyPlaying()}
                                isUpNext={isUpNext()}
                                isDragging={isDragging()}
                                isDropTarget={isDropTarget()}
                                top={virtualItem.start}
                                progress={progress()}
                                loadingIds={props.loadingIds}
                                onClick={() => handleItemDoubleClick(itemIndex)}
                                onDoubleClick={() => handleItemDoubleClick(itemIndex)}
                                onRemove={(e) => handleRemove(e, itemIndex)}
                                {...dragHandlers}
                              />
                            );

                          const actions = () => props.getContextMenuActions?.(itemIndex, it);

                          return (
                            <Show when={actions()} fallback={row}>
                              {(menuActions) => (
                                <ContextMenu actions={menuActions()}>{row}</ContextMenu>
                              )}
                            </Show>
                          );
                        }}
                      </Show>
                    );
                  }}
                </For>
              </div>
            </Show>
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
                  const isRadio = () => entry().type === "radio_station";
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
                        isRadio()
                          ? isMobile()
                            ? "tap to tune in"
                            : "double-click to tune in"
                          : isMobile()
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
                          when={isRadio() && entry().radio_station_ref?.art_thumb_b64}
                          fallback={
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
                          }
                        >
                          {(_b64) => {
                            const ref = entry().radio_station_ref!;
                            return (
                              <img
                                src={`data:${ref.art_thumb_mime ?? "image/jpeg"};base64,${ref.art_thumb_b64}`}
                                alt=""
                                class="w-full h-full object-cover"
                              />
                            );
                          }}
                        </Show>
                      </div>

                      {/* label + song count + progress */}
                      <div class="flex-1 min-w-0">
                        <h4 class="text-sm font-medium text-[var(--color-text-primary)] m-0">
                          <MarqueeText text={entry().label} hoverOnly isHovering={isRowHovered} />
                        </h4>
                        <p class="text-xs text-[var(--color-text-secondary)] m-0">
                          <Show
                            when={isRadio()}
                            fallback={
                              <>
                                {entry().type} &middot;{" "}
                                <Show
                                  when={hasProgress()}
                                  fallback={
                                    <>
                                      {entry().song_count}{" "}
                                      {entry().song_count === 1 ? "song" : "songs"}
                                    </>
                                  }
                                >
                                  {entry().songs_completed}/{entry().song_count}{" "}
                                  {entry().song_count === 1 ? "song" : "songs"} &middot;{" "}
                                  {Math.round(progressPercent())}%
                                </Show>
                              </>
                            }
                          >
                            radio station
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

        <QueuePlayerTargetRow />
      </div>
    </>
  );
}
