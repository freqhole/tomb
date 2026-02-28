import { createVirtualizer } from "@tanstack/solid-virtual";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
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
  /** top padding inside the scroll container (px) - content scrolls under this space */
  scrollPaddingTop?: number;
}

export function VirtualAlbumGrid(props: VirtualAlbumGridProps): JSX.Element {
  let parentRef: HTMLDivElement | undefined;
  const [containerWidth, setContainerWidth] = createSignal(0);
  const gap = 16;

  // scroll restoration using browser history state
  const { restoreScroll, saveScroll } = useScrollRestore(props.scrollRestoreKey || "album-grid");

  // calculate responsive columns from width
  const getColumnsForWidth = (width: number): number => {
    if (props.columns) return props.columns;
    // responsive column counts
    if (width < 480) return 2; // very narrow phones
    if (width < 640) return 3; // phones
    if (width < 768) return 4; // large phones / small tablets
    if (width < 1024) return 5; // tablets
    if (width < 1280) return 6; // small desktops
    return 7; // large desktops
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

  // calculate number of rows needed - reactive accessor
  const rowCount = createMemo(() => Math.ceil(props.albums.length / columns()));

  // single stable virtualizer instance - uses reactive getters for count/size
  const rowVirtualizer = createVirtualizer({
    get count() {
      return rowCount();
    },
    getScrollElement: () => parentRef ?? null,
    estimateSize: () => getCardHeight() + gap,
    overscan: 2,
  });

  // remeasure virtualizer when columns change
  createEffect(() => {
    columns(); // track
    rowVirtualizer.measure();
  });

  // only apply scroll padding on wide viewports (narrow has its own fixed nav)
  const scrollPad = () =>
    props.scrollPaddingTop && window.matchMedia("(min-width: 768px)").matches
      ? props.scrollPaddingTop
      : 0;

  return (
    <div
      ref={parentRef!}
      class={`overflow-auto bg-[var(--color-bg-primary)] ${props.class || ""}`}
      style={{
        height: `${props.height || 600}px`,
        "padding-top": scrollPad() ? `${scrollPad()}px` : undefined,
      }}
    >
      {/* virtual grid container */}
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
          padding: `${gap}px`,
        }}
      >
        <For each={rowVirtualizer.getVirtualItems()}>
          {(virtualRow) => {
            // use memo for column indices so they don't recreate on every render
            const columnIndices = createMemo(() => {
              const startIndex = virtualRow.index * columns();
              return Array.from({ length: columns() }, (_, i) => startIndex + i);
            });

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
                  <Index each={columnIndices()}>
                    {(albumIndexAccessor) => {
                      // use accessor function to get album reactively
                      const album = () => props.albums[albumIndexAccessor()];

                      // early return for empty slots (end of grid)
                      // need to handle this reactively with Show or conditional
                      const hasAlbum = () => albumIndexAccessor() < props.albums.length;

                      return (
                        <div class={hasAlbum() ? "" : "invisible"}>
                          {hasAlbum() &&
                            (() => {
                              const card = (
                                <CollectionCard
                                  collection={album()!}
                                  size={props.cardSize}
                                  showYear={props.showYear}
                                  showGenres={props.showGenres}
                                  onClick={props.onAlbumClick}
                                  onPlay={props.onAlbumPlay}
                                  onFavoriteToggle={props.onFavoriteToggle}
                                />
                              );

                              return props.getContextMenuActions ? (
                                <ContextMenu actions={props.getContextMenuActions(album()!)}>
                                  {card}
                                </ContextMenu>
                              ) : (
                                card
                              );
                            })()}
                        </div>
                      );
                    }}
                  </Index>
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
