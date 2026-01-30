import { createVirtualizer } from "@tanstack/solid-virtual";
import {
  createMemo,
  createSignal,
  For,
  JSX,
  onCleanup,
  onMount,
} from "solid-js";
import { useScrollRestore } from "../../utils/scrollRestore";
import { CollectionCard, CollectionCardData } from "../cards/CollectionCard";
import { ContextMenu, type MenuAction } from "../overlays/ContextMenu";

export interface VirtualAlbumGridProps {
  /** array of albums to display */
  albums: CollectionCardData[];
  /** number of columns in the grid */
  columns?: number;
  /** callback when an album is clicked */
  onAlbumClick?: (album: CollectionCardData) => void;
  /** callback when play button is clicked */
  onAlbumPlay?: (album: CollectionCardData) => void;
  /** callback when favorite is toggled */
  onFavoriteToggle?: (album: CollectionCardData, isFavorite: boolean) => void;
  /** callback to get context menu actions for an album */
  getContextMenuActions?: (album: CollectionCardData) => MenuAction[];
  /** callback when user scrolls near end (for infinite scroll) */
  onNearEnd?: () => void;
  /** height of the container */
  height?: number;
  /** card size variant */
  cardSize?: "small" | "medium" | "large";
  /** show additional metadata */
  showYear?: boolean;
  showGenres?: boolean;
  /** additional css classes */
  class?: string;
  /** unique key for scroll restoration (e.g., 'albums', 'albums-rock') */
  scrollRestoreKey?: string;
}

export function VirtualAlbumGrid(props: VirtualAlbumGridProps): JSX.Element {
  let parentRef: HTMLDivElement | undefined;
  const [containerWidth, setContainerWidth] = createSignal(0);
  const [savedScrollOffset, setSavedScrollOffset] = createSignal(0);
  const gap = 16;

  // scroll restoration using browser history state
  const { restoreScroll, saveScroll } = useScrollRestore(
    props.scrollRestoreKey || "album-grid",
  );

  // calculate responsive columns from width
  const getColumnsForWidth = (width: number): number => {
    if (props.columns) return props.columns;
    // responsive column counts
    if (width < 480) return 2;   // very narrow phones
    if (width < 640) return 2;   // phones
    if (width < 768) return 3;   // large phones / small tablets
    if (width < 1024) return 3;  // tablets
    if (width < 1280) return 4;  // small desktops
    return 5;                    // large desktops
  };

  const columns = () => getColumnsForWidth(containerWidth());

  // estimate text height based on card size
  const getTextHeight = () => {
    const size = props.cardSize || "medium";
    return size === "small" ? 80 : size === "large" ? 120 : 100;
  };

  // calculate card height: column width + text height
  const getCardHeight = () => {
    const width = containerWidth();
    if (width === 0) {
      // initial estimate before measurement
      const size = props.cardSize || "medium";
      return size === "small" ? 240 : size === "large" ? 420 : 340;
    }
    const cols = getColumnsForWidth(width);
    const effectiveWidth = width - gap * 2;
    const columnWidth = (effectiveWidth - gap * (cols - 1)) / cols;
    return columnWidth + getTextHeight();
  };

  // measure container with debounced ResizeObserver
  onMount(() => {
    if (!parentRef) return;

    // set initial width immediately
    setContainerWidth(parentRef.clientWidth);

    // restore scroll position from history state (use double RAF to ensure virtualizer is ready)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (parentRef) {
          restoreScroll(parentRef);
        }
      });
    });

    let timeoutId: number;
    const observer = new ResizeObserver((entries) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const width = entries[0]?.contentRect.width;
        if (width) setContainerWidth(width);
      }, 16) as unknown as number; // ~60fps debounce
    });

    observer.observe(parentRef);
    
    // save scroll position periodically while scrolling and check for near end
    const handleScroll = (e: Event) => {
      if (parentRef) {
        saveScroll(parentRef);
        
        // check for infinite scroll trigger
        if (props.onNearEnd) {
          const target = e.target as HTMLDivElement;
          const scrollTop = target.scrollTop;
          const scrollHeight = target.scrollHeight;
          const clientHeight = target.clientHeight;

          // trigger when scrolled to within 300px of bottom
          if (scrollHeight - scrollTop - clientHeight < 300) {
            props.onNearEnd();
          }
        }
      }
    };
    parentRef.addEventListener("scroll", handleScroll, { passive: true });

    onCleanup(() => {
      clearTimeout(timeoutId);
      observer.disconnect();
      if (parentRef) {
        parentRef.removeEventListener("scroll", handleScroll);
      }
    });
  });

  // calculate number of rows needed
  const getRowCount = () => {
    return Math.ceil(props.albums.length / columns());
  };

  // recreate virtualizer when columns change for clean layout updates
  const rowVirtualizer = createMemo((prev) => {
    // save scroll position before recreating virtualizer
    if (prev && parentRef) {
      setSavedScrollOffset(parentRef.scrollTop);
    }
    
    columns(); // track columns for reactivity
    const virtualizer = createVirtualizer({
      count: getRowCount(),
      getScrollElement: () => parentRef,
      estimateSize: () => getCardHeight() + gap,
      overscan: 2,
    });
    
    // restore scroll position after virtualizer is created
    if (savedScrollOffset() > 0 && parentRef) {
      queueMicrotask(() => {
        if (parentRef) {
          parentRef.scrollTop = savedScrollOffset();
        }
      });
    }
    
    return virtualizer;
  });

  // get albums for a specific row
  const getAlbumsForRow = (rowIndex: number): CollectionCardData[] => {
    const startIndex = rowIndex * columns();
    const endIndex = startIndex + columns();
    return props.albums.slice(startIndex, endIndex);
  };

  return (
    <div
      ref={parentRef!}
      class={`overflow-auto bg-[var(--color-bg-primary)] ${props.class || ""}`}
      style={{ height: `${props.height || 600}px` }}
    >
      {/* virtual grid container */}
      <div
        style={{
          height: `${rowVirtualizer().getTotalSize()}px`,
          width: "100%",
          position: "relative",
          padding: `${gap}px`,
        }}
      >
        <For each={rowVirtualizer().getVirtualItems()}>
          {(virtualRow) => {
            const rowAlbums = getAlbumsForRow(virtualRow.index);

            return (
              <div
                data-index={virtualRow.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                  padding: `0 ${gap}px`,
                }}
              >
                <div
                  class="grid gap-4"
                  style={{
                    "grid-template-columns": `repeat(${columns()}, minmax(0, 1fr))`,
                  }}
                >
                  <For each={rowAlbums}>
                    {(album) => {
                      const card = (
                        <CollectionCard
                          collection={album}
                          size={props.cardSize}
                          showYear={props.showYear}
                          showGenres={props.showGenres}
                          onClick={props.onAlbumClick}
                          onPlay={props.onAlbumPlay}
                          onFavoriteToggle={props.onFavoriteToggle}
                        />
                      );

                      return props.getContextMenuActions ? (
                        <ContextMenu
                          actions={props.getContextMenuActions(album)}
                        >
                          {card}
                        </ContextMenu>
                      ) : (
                        card
                      );
                    }}
                  </For>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}

export default VirtualAlbumGrid;
