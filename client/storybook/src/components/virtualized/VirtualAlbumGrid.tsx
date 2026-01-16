import { createVirtualizer } from "@tanstack/solid-virtual";
import { createSignal, For, JSX } from "solid-js";
import { CollectionCard, CollectionCardData } from "../cards/CollectionCard";

export interface VirtualAlbumGridProps {
  /** array of albums to display */
  albums: CollectionCardData[];
  /** number of columns in the grid */
  columns?: number;
  /** callback when an album is clicked */
  onAlbumClick?: (album: CollectionCardData) => void;
  /** callback when play button is clicked */
  onAlbumPlay?: (album: CollectionCardData) => void;
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
  const columns = () => props.columns || 4;
  const height = () => props.height || 600;
  const cardSize = () => props.cardSize || "medium";

  // calculate card height based on size
  const getCardHeight = () => {
    switch (cardSize()) {
      case "small":
        return 200;
      case "large":
        return 320;
      default: // medium
        return 260;
    }
  };

  // calculate gap size
  const gap = 16;

  // calculate number of rows needed
  const getRowCount = () => {
    return Math.ceil(props.albums.length / columns());
  };

  // create virtualizer for rows
  const rowVirtualizer = createVirtualizer({
    get count() {
      return getRowCount();
    },
    getScrollElement: () => parentRef,
    estimateSize: () => getCardHeight() + gap,
    overscan: 2,
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
      class={`overflow-auto bg-dark-900 ${props.class || ""}`}
      style={{ height: `${height()}px` }}
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
                    {(album) => (
                      <CollectionCard
                        collection={album}
                        size={cardSize()}
                        showYear={props.showYear}
                        showGenres={props.showGenres}
                        onClick={props.onAlbumClick}
                        onPlay={props.onAlbumPlay}
                      />
                    )}
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
