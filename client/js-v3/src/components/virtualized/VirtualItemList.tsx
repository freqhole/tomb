import { createVirtualizer } from "@tanstack/solid-virtual";
import { createMemo, For, JSX } from "solid-js";

export interface ListItem {
  id: string;
  title: string;
  subtitle?: string;
  metadata?: string;
}

export interface VirtualItemListProps {
  /** array of items to display */
  items: ListItem[];
  /** currently selected item id */
  selectedId?: string | null;
  /** callback when an item is clicked */
  onItemClick?: (item: ListItem) => void;
  /** height of the container in pixels */
  height?: number;
  /** additional CSS classes */
  class?: string;
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

  const height = () => props.height || 600;

  // create virtualizer instance - wrap in memo to recreate when items change
  const rowVirtualizer = createMemo(() => {
    props.items.length; // track items for reactivity
    props.selectedId; // track selection for reactivity
    return createVirtualizer({
      count: props.items.length,
      getScrollElement: () => parentRef,
      estimateSize: () => 64,
      overscan: 5,
    });
  });

  const handleItemClick = (item: ListItem) => {
    props.onItemClick?.(item);
  };

  return (
    <div
      ref={parentRef!}
      class={`overflow-auto bg-[var(--color-bg-primary)] ${props.class || ""}`}
      style={{ height: `${height()}px` }}
    >
      {/* virtual list container */}
      <div
        style={{
          height: `${rowVirtualizer().getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        <For each={rowVirtualizer().getVirtualItems()}>
          {(virtualRow) => {
            const item = props.items[virtualRow.index];
            const isSelected = props.selectedId === item.id;

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
                }}
              >
                <button
                  class={`
                    w-full h-full px-6 py-3 text-left transition-colors border-l-2
                    ${
                      isSelected
                        ? "bg-[var(--color-accent-500)]/20 text-[var(--color-text-primary)] border-[var(--color-accent-500)]"
                        : "hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border-transparent"
                    }
                  `}
                  onClick={() => handleItemClick(item)}
                >
                  <div class="font-medium text-base">{item.title}</div>
                  {item.subtitle && (
                    <div class="text-xs text-[var(--color-text-tertiary)] mt-1">
                      {item.subtitle}
                    </div>
                  )}
                  {item.metadata && (
                    <div class="text-xs text-[var(--color-text-muted)] mt-0.5">
                      {item.metadata}
                    </div>
                  )}
                </button>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}

export default VirtualItemList;
