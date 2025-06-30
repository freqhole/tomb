import {
  createSignal,
  createMemo,
  onMount,
  onCleanup,
  For,
  Show,
} from "solid-js";
import type { GridProps, GridColumn } from "./types";
import { DARK_THEME } from "./types";
import { useInfiniteGrid } from "./hooks/useInfiniteGrid";

interface VirtualizedRowProps<T> {
  item: T;
  index: number;
  columns: GridColumn<T>[];
  isSelected: boolean;
  onRowClick?: (item: T, index: number, event: MouseEvent) => void;
  onRowDoubleClick?: (item: T, index: number, event: MouseEvent) => void;
  onRowMouseDown?: (item: T, index: number, event: MouseEvent) => void;
  onRowMount?: (item: T) => void;
  onContextMenu?: (item: T, index: number, event: MouseEvent) => void;

  rowHeight: number;
  focusedIndex?: number;
  showFocusIndicator?: boolean;
}

function VirtualizedRow<T>(props: VirtualizedRowProps<T>) {
  let rowRef: HTMLDivElement | undefined;

  onMount(() => {
    if (props.onRowMount) {
      props.onRowMount(props.item);
    }
  });

  const isFocused = () =>
    props.focusedIndex === props.index && props.showFocusIndicator;

  return (
    <div
      ref={rowRef}
      class={`grid-row ${props.isSelected ? "selected" : ""} ${isFocused() ? "focused" : ""}`}
      style={`
        height: ${props.rowHeight}px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid ${DARK_THEME.colors.border};
        background: ${props.isSelected ? DARK_THEME.colors.selected : "transparent"};
        transition: background-color 0.15s ease, filter 0.15s ease, box-shadow 0.15s ease;
        outline: ${isFocused() ? "2px solid #0070f3" : "none"};
        outline-offset: -2px;
        position: relative;
      `}
      onClick={(e) => props.onRowClick?.(props.item, props.index, e)}
      onDblClick={(e) => props.onRowDoubleClick?.(props.item, props.index, e)}
      onMouseDown={(e) => props.onRowMouseDown?.(props.item, props.index, e)}
      onContextMenu={(e) => props.onContextMenu?.(props.item, props.index, e)}
    >
      <For each={props.columns}>
        {(column) => (
          <div
            class="grid-cell"
            style={`
              flex: ${column.width ? "0 0 " + column.width + "px" : "1"};
              padding: 8px 12px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              position: ${column.className === "sticky-actions-column" ? "sticky" : "relative"};
              right: ${column.className === "sticky-actions-column" ? "0" : "auto"};
              background: ${column.className === "sticky-actions-column" ? (props.isSelected ? "#2a1a2a" : DARK_THEME.colors.background) : "transparent"};
              ${column.className === "sticky-actions-column" ? "border-left: 1px solid " + DARK_THEME.colors.border + ";" : ""}
              box-shadow: ${column.className === "sticky-actions-column" ? "-2px 0 4px rgba(0, 0, 0, 0.1)" : "none"};
              z-index: ${column.className === "sticky-actions-column" ? "5" : "1"};
            `}
          >
            {column.render
              ? column.render(props.item, props.index)
              : String((props.item as any)[column.key] || "")}
          </div>
        )}
      </For>
    </div>
  );
}

export function InfiniteDataGrid<T = any>(props: GridProps<T>) {
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();
  const [scrollTop, setScrollTop] = createSignal(0);
  const [containerHeight, setContainerHeight] = createSignal(0);

  const rowHeight = props.rowHeight || 50;
  const headerHeight = props.headerHeight || 60;
  const virtualizeThreshold = props.virtualizeThreshold || 100;

  // Calculate minimum width needed for all columns
  const minContentWidth = createMemo(() => {
    return props.columns.reduce((total, column) => {
      return total + (column.width || 200); // Default 200px for flex columns
    }, 0);
  });

  const grid = useInfiniteGrid({
    data: props.data,
    getItemId: props.getItemId,
    initialSort: props.sortField
      ? { field: props.sortField, direction: props.sortDirection || "asc" }
      : undefined,
    defaultSort: props.defaultSort,
  });

  // Event handlers - delegate to parent handlers
  const handleRowClick = (item: T, index: number, event: MouseEvent) => {
    props.onRowClick?.(item, index, event);
  };

  const handleRowDoubleClick = (item: T, index: number, event: MouseEvent) => {
    props.onRowDoubleClick?.(item, index, event);
  };

  const handleRowMouseDown = (item: T, index: number, event: MouseEvent) => {
    props.onRowMouseDown?.(item, index, event);
  };

  // Virtualization calculations
  const shouldVirtualize = createMemo(
    () => props.data.length > virtualizeThreshold
  );

  const visibleItems = createMemo(() => {
    if (!shouldVirtualize()) {
      return props.data.map((item, index) => ({ item, index }));
    }

    const container = containerRef();
    if (!container) return [];

    const itemHeight = rowHeight;
    const scrollPosition = scrollTop();
    const containerH = containerHeight();

    const startIndex = Math.floor(scrollPosition / itemHeight);
    const endIndex = Math.min(
      props.data.length - 1,
      Math.ceil((scrollPosition + containerH) / itemHeight) + 5 // Buffer
    );

    const items = [];
    for (let i = Math.max(0, startIndex - 5); i <= endIndex; i++) {
      if (i < props.data.length && props.data[i] != null) {
        items.push({ item: props.data[i]!, index: i });
      }
    }

    return items;
  });

  // Calculate actual visible range (what user sees on screen)
  const actualVisibleStartRow = createMemo(() => {
    if (props.data.length === 0) return 0;
    const container = containerRef();
    if (!container) return 1;
    return Math.floor(scrollTop() / rowHeight) + 1; // +1 for 1-based indexing
  });

  const actualVisibleEndRow = createMemo(() => {
    if (props.data.length === 0) return 0;
    const container = containerRef();
    if (!container) return Math.min(1, props.data.length);

    const viewportHeight = containerHeight() - headerHeight;
    const rowsInViewport = Math.floor(viewportHeight / rowHeight);
    const endRow = Math.floor(scrollTop() / rowHeight) + rowsInViewport;
    return Math.min(endRow, props.data.length);
  });

  const totalRows = createMemo(() => props.data.length);

  const totalHeight = createMemo(() => props.data.length * rowHeight);

  // Event handlers
  const handleScroll = (e: Event) => {
    const target = e.target as HTMLDivElement;
    setScrollTop(target.scrollTop);

    // No need for manual header sync - they're in the same scroll container now!

    // Infinite scroll detection
    if (props.onLoadMore && props.hasMore && !props.isLoadingMore) {
      const scrollHeight = target.scrollHeight;
      const scrollTop = target.scrollTop;
      const clientHeight = target.clientHeight;

      // Trigger load more when within 200px of bottom
      if (scrollHeight - scrollTop - clientHeight < 200) {
        props.onLoadMore();
      }
    }
  };

  const handleSort = (field: string) => {
    grid.handleSort(field);
    if (props.onSort) {
      const config = grid.sortConfig();
      props.onSort(config.field, config.direction);
    }
  };

  // Resize observer
  onMount(() => {
    const container = containerRef();
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    resizeObserver.observe(container);

    onCleanup(() => {
      resizeObserver.disconnect();
    });
  });

  return (
    <div
      class={`infinite-data-grid ${props.className || ""}`}
      style={`
        height: 100%;
        display: flex;
        flex-direction: column;
        background: ${DARK_THEME.colors.background};
        color: ${DARK_THEME.colors.text};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      `}
    >
      {/* Body - now contains header inside for natural scrolling */}
      <div
        ref={setContainerRef}
        class="grid-body"
        style={`
          flex: 1;
          overflow-y: auto;
          overflow-x: auto;
          position: relative;
        `}
        onScroll={handleScroll}
      >
        {/* Header inside scroll container */}
        <div
          class="grid-header"
          style={`
            height: ${headerHeight}px;
            display: flex;
            align-items: center;
            background: ${DARK_THEME.colors.header};
            border-bottom: 2px solid ${DARK_THEME.colors.border};
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 10;
            min-width: ${minContentWidth()}px;
          `}
        >
          <For each={props.columns}>
            {(column) => (
              <div
                class={`grid-header-cell ${column.sortable ? "sortable" : ""} ${
                  column.sortable && grid.sortConfig().field === column.key
                    ? "active-sort"
                    : ""
                }`}
                style={`
                  flex: ${column.width ? "0 0 " + column.width + "px" : "1"};
                  padding: 8px 12px;
                  cursor: ${column.sortable ? "pointer" : "default"};
                  user-select: none;
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  transition: all 0.15s ease;
                  border-radius: 4px;
                  margin: 4px 2px;
                  position: ${column.className === "sticky-actions-column" ? "sticky" : "relative"};
                  right: ${column.className === "sticky-actions-column" ? "0" : "auto"};
                  background: ${column.className === "sticky-actions-column" ? DARK_THEME.colors.header : "transparent"};
                  ${column.className === "sticky-actions-column" ? "border-left: 1px solid " + DARK_THEME.colors.border + ";" : ""}
                  box-shadow: ${column.className === "sticky-actions-column" ? "-2px 0 4px rgba(0, 0, 0, 0.2)" : "none"};
                  z-index: ${column.className === "sticky-actions-column" ? "5" : "1"};
                  opacity: ${grid.isSorting() && grid.sortConfig().field === column.key ? "0.7" : "1"};
                `}
                onClick={() =>
                  column.sortable && !grid.isSorting() && handleSort(column.key)
                }
              >
                <div style="font-weight: 500; flex: 1;">
                  {typeof column.title === "string" ? (
                    <span>{column.title}</span>
                  ) : (
                    column.title
                  )}
                </div>
                <Show
                  when={
                    grid.isSorting() && grid.sortConfig().field === column.key
                  }
                >
                  <div
                    style={`
                      position: absolute;
                      right: 40px;
                      top: 50%;
                      transform: translateY(-50%);
                      color: #00ff88;
                      font-size: 12px;
                      animation: spin 1s linear infinite;
                    `}
                  >
                    ⟳
                  </div>
                </Show>
                <Show when={column.sortable}>
                  <div
                    class="sort-indicator"
                    style={`
                      display: flex;
                      flex-direction: column;
                      align-items: center;
                      gap: 1px;
                      opacity: ${grid.sortConfig().field === column.key ? "1" : "0.4"};
                      transition: opacity 0.15s ease;
                    `}
                  >
                    <div
                      class="sort-arrow sort-arrow-up"
                      style={`
                        width: 0;
                        height: 0;
                        border-left: 4px solid transparent;
                        border-right: 4px solid transparent;
                        border-bottom: 5px solid ${
                          grid.sortConfig().field === column.key &&
                          grid.sortConfig().direction === "asc"
                            ? "#ff00ff"
                            : "#666"
                        };
                        transition: border-bottom-color 0.15s ease;
                      `}
                    ></div>
                    <div
                      class="sort-arrow sort-arrow-down"
                      style={`
                        width: 0;
                        height: 0;
                        border-left: 4px solid transparent;
                        border-right: 4px solid transparent;
                        border-top: 5px solid ${
                          grid.sortConfig().field === column.key &&
                          grid.sortConfig().direction === "desc"
                            ? "#ff00ff"
                            : "#666"
                        };
                        transition: border-top-color 0.15s ease;
                      `}
                    ></div>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
        <Show
          when={shouldVirtualize()}
          fallback={
            <div
              class="grid-content"
              style={`min-width: ${minContentWidth()}px;`}
            >
              <For each={props.data}>
                {(item, index) => (
                  <VirtualizedRow
                    item={item}
                    index={index()}
                    columns={props.columns}
                    isSelected={
                      props.selectedItems?.has(
                        props.getItemId?.(item) || (item as any).id
                      ) || false
                    }
                    onRowClick={handleRowClick}
                    onRowDoubleClick={handleRowDoubleClick}
                    onRowMouseDown={handleRowMouseDown}
                    onRowMount={props.onRowMount}
                    onContextMenu={props.onContextMenu}
                    rowHeight={rowHeight}
                    focusedIndex={props.focusedIndex}
                    showFocusIndicator={props.showFocusIndicator}
                  />
                )}
              </For>
            </div>
          }
        >
          <div
            class="grid-content"
            style={`height: ${totalHeight()}px; position: relative; min-width: ${minContentWidth()}px;`}
          >
            <For each={visibleItems()}>
              {(virtualItem) => (
                <div
                  style={`
                    position: absolute;
                    top: ${virtualItem.index * rowHeight}px;
                    left: 0;
                    right: 0;
                  `}
                >
                  <VirtualizedRow
                    item={virtualItem.item!}
                    index={virtualItem.index}
                    columns={props.columns}
                    isSelected={
                      props.selectedItems?.has(
                        props.getItemId?.(virtualItem.item!) ||
                          (virtualItem.item! as any).id
                      ) || false
                    }
                    onRowClick={handleRowClick}
                    onRowDoubleClick={handleRowDoubleClick}
                    onRowMouseDown={handleRowMouseDown}
                    onRowMount={props.onRowMount}
                    onContextMenu={props.onContextMenu}
                    rowHeight={rowHeight}
                    focusedIndex={props.focusedIndex}
                    showFocusIndicator={props.showFocusIndicator}
                  />
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* Pagination Status */}
      <Show when={props.showPaginationStatus !== false}>
        <div
          class="grid-stats"
          style={`
            position: absolute;
            bottom: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            color: #ffffff;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            border: 1px solid ${DARK_THEME.colors.border};
            backdrop-filter: blur(10px);
            pointer-events: none;
            z-index: 100;
          `}
        >
          Showing rows {actualVisibleStartRow()}-{actualVisibleEndRow()} of{" "}
          {totalRows()}
          <Show when={props.isLoadingMore}>
            <span style="margin-left: 8px; color: #ff00ff;">Loading...</span>
          </Show>
        </div>
      </Show>

      <style>{`
        .grid-row:hover:not(.selected) {
          background: ${DARK_THEME.colors.hover};
        }

        .grid-row.selected {
          background: ${DARK_THEME.colors.selected} !important;
        }

        .grid-row.selected:hover {
          background: ${DARK_THEME.colors.selected} !important;
          filter: brightness(1.1);
        }

        .grid-row.focused {
          box-shadow: inset 0 0 0 2px #0070f3;
        }

        .grid-row.focused.selected {
          box-shadow: inset 0 0 0 2px #0070f3, inset 0 0 0 4px ${DARK_THEME.colors.selected};
        }

        .grid-header-cell.sortable:hover {
          background: rgba(255, 255, 255, 0.08);
          transform: translateY(-1px);
        }

        .grid-header-cell.sortable:active {
          transform: translateY(0px);
          background: rgba(255, 255, 255, 0.12);
        }

        .grid-header-cell.active-sort {
          background: rgba(255, 0, 255, 0.1);
          border: 1px solid rgba(255, 0, 255, 0.3);
        }

        .grid-header-cell.sortable:hover .sort-indicator {
          opacity: 0.8 !important;
        }

        @keyframes spin {
          from { transform: translateY(-50%) rotate(0deg); }
          to { transform: translateY(-50%) rotate(360deg); }
        }

        .grid-body::-webkit-scrollbar {
          width: 8px;
        }

        .grid-body::-webkit-scrollbar-track {
          background: ${DARK_THEME.colors.background};
        }

        .grid-body::-webkit-scrollbar-thumb {
          background: ${DARK_THEME.colors.border};
          border-radius: 4px;
        }

        .grid-body::-webkit-scrollbar-thumb:hover {
          background: ${DARK_THEME.colors.text};
        }

        /* Drag selection styling */
        body.drag-selecting {
          user-select: none;
          cursor: crosshair;
        }

        body.drag-selecting * {
          user-select: none;
        }

        .grid-stats {
          transition: opacity 0.2s ease;
        }

        .grid-stats:hover {
          opacity: 0.7;
        }
      `}</style>
    </div>
  );
}

export default InfiniteDataGrid;
