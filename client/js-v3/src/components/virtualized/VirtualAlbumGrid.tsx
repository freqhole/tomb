import { createVirtualizer } from "@tanstack/solid-virtual";
import {
  createMemo,
  createSignal,
  For,
  JSX,
  onCleanup,
  onMount,
} from "solid-js";
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
  /** callback to get context menu actions for an album */
  getContextMenuActions?: (album: CollectionCardData) => MenuAction[];
  /** height of the container */
  height?: number;
  /** card size variant */
  cardSize?: "small" | "medium" | "large";
  /** show additional metadata */
  showYear?: boolean;
  showGenres?: boolean;
  /** additional css classes */
  class?: string;
}

export function VirtualAlbumGrid(props: VirtualAlbumGridProps): JSX.Element {
  let parentRef: HTMLDivElement | undefined;
  const [containerWidth, setContainerWidth] = createSignal(0);
  const gap = 16;

  // calculate responsive columns from width
  const getColumnsForWidth = (width: number): number => {
    if (props.columns) return props.columns;
    if (width < 1024) return 3;
    if (width < 1280) return 4;
    return 5;
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

    let timeoutId: number;
    const observer = new ResizeObserver((entries) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const width = entries[0]?.contentRect.width;
        if (width) setContainerWidth(width);
      }, 16) as unknown as number; // ~60fps debounce
    });

    observer.observe(parentRef);
    onCleanup(() => {
      clearTimeout(timeoutId);
      observer.disconnect();
    });
  });

  // calculate number of rows needed
  const getRowCount = () => {
    return Math.ceil(props.albums.length / columns());
  };

  // recreate virtualizer when columns change for clean layout updates
  const rowVirtualizer = createMemo(() => {
    columns(); // track columns for reactivity
    return createVirtualizer({
      count: getRowCount(),
      getScrollElement: () => parentRef,
      estimateSize: () => getCardHeight() + gap,
      overscan: 2,
    });
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
