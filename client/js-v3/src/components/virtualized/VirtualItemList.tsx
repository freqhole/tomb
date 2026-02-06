import { createVirtualizer } from "@tanstack/solid-virtual";
import { createMemo, createSignal, Index, JSX, onMount, onCleanup, Show } from "solid-js";
import { useScrollRestore } from "../../utils/scrollRestore";
import { Icon } from "../icons/registry";
import { ContextMenu, type MenuAction } from "../overlays/ContextMenu";
import { MarqueeText } from "../text/MarqueeText";
import { MediaImage } from "../media/MediaImage";

export interface ListItem {
  id: string;
  title: string;
  subtitle?: string;
  metadata?: string;
  images?: import("../../music/services/storage/types").ImageMetadata[];
  thumbnailUrl?: string | null;
  /** domain type for appropriate fallback icon */
  domainType?: "song" | "album" | "artist" | "genre" | "playlist";
  /** custom fallback text when no image (e.g., artist abbreviation) */
  fallbackText?: string;
}

export interface VirtualItemListProps {
  /** array of items to display */
  items: ListItem[];
  /** currently selected item id */
  selectedId?: string | null;
  /** callback when an item is clicked */
  onItemClick?: (item: ListItem) => void;
  /** callback when user scrolls near end (for infinite scroll) */
  onEndReached?: () => void;
  /** callback when virtualizer is ready, provides scrollToIndex function */
  onVirtualizerReady?: (scrollToIndex: (index: number) => void) => void;
  /** callback to get context menu actions for an item */
  getContextMenuActions?: (item: ListItem, index: number) => MenuAction[];
  /** height of the container in pixels (defaults to 100% of parent) */
  height?: number;
  /** hide image/thumbnail for all items */
  hideImage?: boolean;
  /** additional CSS classes */
  class?: string;
  /** unique key for scroll restoration (e.g., 'artists', 'genres-list') */
  scrollRestoreKey?: string;
}

/**
 * virtualized list component for artists, genres, playlists
 *
 * - displays items in a scrollable list with virtualization
 * - supports selection highlighting
 * - shows title, subtitle, and optional metadata
 * - efficient rendering for large lists
 */
export function VirtualItemList(props: VirtualItemListProps): JSX.Element {
  let parentRef: HTMLDivElement | undefined;
  const [savedScrollOffset, setSavedScrollOffset] = createSignal(0);

  const heightStyle = () => (props.height ? `${props.height}px` : "100%");

  // scroll restoration using browser history state
  const { restoreScroll, saveScroll } = useScrollRestore(props.scrollRestoreKey || "item-list");

  // create virtualizer instance - wrap in memo to recreate when items change
  const rowVirtualizer = createMemo((prev) => {
    // save scroll position before recreating virtualizer
    if (prev && parentRef) {
      setSavedScrollOffset(parentRef.scrollTop);
    }

    props.items.length; // track items for reactivity
    const virtualizer = createVirtualizer({
      count: props.items.length,
      getScrollElement: () => parentRef,
      estimateSize: () => 80,
      overscan: 5,
    });

    // restore scroll position after virtualizer is created
    if (savedScrollOffset() > 0 && parentRef) {
      queueMicrotask(() => {
        if (parentRef) {
          parentRef.scrollTop = savedScrollOffset();
        }
      });
    }

    // expose scrollToIndex via callback
    if (props.onVirtualizerReady) {
      props.onVirtualizerReady((index: number) => {
        virtualizer.scrollToIndex(index, { align: "start" });
      });
    }

    return virtualizer;
  });

  // detect when container becomes visible again (for mobile back navigation)
  // and force virtualizer to remeasure using ResizeObserver
  onMount(() => {
    if (!parentRef) return;

    let lastWidth = parentRef.offsetWidth;
    let lastHeight = parentRef.offsetHeight;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const newWidth = entry.contentRect.width;
      const newHeight = entry.contentRect.height;

      // if container is going from visible to hidden, save scroll position
      const becomingHidden = lastWidth > 0 && lastHeight > 0 && (newWidth === 0 || newHeight === 0);
      if (becomingHidden && parentRef) {
        setSavedScrollOffset(parentRef.scrollTop);
      }

      // if container went from 0 to non-zero dimensions, it just became visible
      const becameVisible = (lastWidth === 0 || lastHeight === 0) && newWidth > 0 && newHeight > 0;

      if (becameVisible) {
        // force virtualizer to remeasure and restore scroll position
        queueMicrotask(() => {
          // restore saved scroll position first
          if (savedScrollOffset() > 0 && parentRef) {
            parentRef.scrollTop = savedScrollOffset();
          }
          // then remeasure
          rowVirtualizer().measure();
          // dispatch scroll event to trigger virtualizer recalculation
          if (parentRef) {
            parentRef.dispatchEvent(new Event("scroll"));
          }
        });
      } else if (newWidth > 0 && newHeight > 0) {
        // for any other size change while visible, also remeasure
        rowVirtualizer().measure();
      }

      lastWidth = newWidth;
      lastHeight = newHeight;
    });

    resizeObserver.observe(parentRef);

    onCleanup(() => {
      resizeObserver.disconnect();
    });

    // restore scroll position (use double RAF to ensure virtualizer has calculated sizes)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (parentRef) {
          restoreScroll(parentRef);
        }
      });
    });
  });

  const handleItemClick = (item: ListItem) => {
    props.onItemClick?.(item);
  };

  const handleScroll = (e: Event) => {
    if (!parentRef) return;

    // save scroll position to history state
    saveScroll(parentRef);

    // check for infinite scroll trigger
    if (!props.onEndReached) return;

    const target = e.target as HTMLDivElement;
    const scrollTop = target.scrollTop;
    const scrollHeight = target.scrollHeight;
    const clientHeight = target.clientHeight;

    // trigger when scrolled to within 200px of bottom
    if (scrollHeight - scrollTop - clientHeight < 200) {
      props.onEndReached();
    }
  };

  return (
    <div
      ref={parentRef!}
      class={`overflow-auto bg-[var(--color-bg-primary)] ${props.class || ""}`}
      style={{ height: heightStyle() }}
      onScroll={handleScroll}
    >
      {/* virtual list container */}
      <div
        style={{
          height: `${rowVirtualizer().getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        <Index each={rowVirtualizer().getVirtualItems()}>
          {(virtualRow) => {
            const item = () => props.items[virtualRow().index];

            const itemButton = (
              <button
                class={`
                  w-full h-full px-6 py-3 text-left transition-colors border-l-2 flex items-center gap-3
                  ${
                    props.selectedId === item().id
                      ? "bg-[var(--color-bg-primary)]/20 text-[var(--color-text-primary)] border-[var(--color-accent-500)]"
                      : "hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border-transparent"
                  }
                `}
                onClick={() => handleItemClick(item())}
              >
                <Show when={!props.hideImage}>
                  <Show
                    when={item().images?.length || item().thumbnailUrl || !item().fallbackText}
                    fallback={
                      <div class="w-12 h-12 rounded-full flex-shrink-0 bg-[var(--color-bg-elevated)] flex items-center justify-center">
                        <span class="text-sm font-bold text-[var(--color-text-tertiary)]">
                          {item().fallbackText}
                        </span>
                      </div>
                    }
                  >
                    <MediaImage
                      images={item().images}
                      imageUrl={item().thumbnailUrl || null}
                      alt={item().title}
                      class={`w-12 h-12 object-cover flex-shrink-0 ${item().domainType === "artist" ? "rounded-full" : "rounded"}`}
                      domainType={item().domainType || "playlist"}
                    />
                  </Show>
                </Show>
                <div class="flex-1 min-w-0">
                  <div class="font-medium text-base">
                    <MarqueeText text={item().title} hoverOnly={true} />
                  </div>
                  {item().subtitle && (
                    <div class="text-xs text-[var(--color-text-tertiary)] mt-1">
                      {item().subtitle}
                    </div>
                  )}
                  {item().metadata && (
                    <div class="text-xs text-[var(--color-text-muted)] mt-0.5">
                      {item().metadata}
                    </div>
                  )}
                </div>
              </button>
            );

            return (
              <div
                data-index={virtualRow().index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow().size}px`,
                  transform: `translateY(${virtualRow().start}px)`,
                }}
              >
                {props.getContextMenuActions ? (
                  <ContextMenu actions={props.getContextMenuActions(item(), virtualRow().index)}>
                    {itemButton}
                  </ContextMenu>
                ) : (
                  itemButton
                )}
              </div>
            );
          }}
        </Index>
      </div>
    </div>
  );
}

export default VirtualItemList;
