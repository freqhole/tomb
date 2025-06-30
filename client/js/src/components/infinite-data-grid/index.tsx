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
}

function VirtualizedRow<T>(props: VirtualizedRowProps<T>) {
  let rowRef: HTMLDivElement | undefined;

  onMount(() => {
    if (props.onRowMount) {
      props.onRowMount(props.item);
    }
  });

  return (
    <div
      ref={rowRef}
      class={`grid-row ${props.isSelected ? "selected" : ""}`}
      style={`
        height: ${props.rowHeight}px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid ${DARK_THEME.colors.border};
        background: ${props.isSelected ? DARK_THEME.colors.selected : "transparent"};
        transition: background-color 0.15s ease, filter 0.15s ease;
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

  const grid = useInfiniteGrid({
    data: props.data,
    getItemId: props.getItemId,
    initialSort: props.sortField
      ? { field: props.sortField, direction: props.sortDirection || "asc" }
      : undefined,
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
      {/* Header */}
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
        `}
      >
        <For each={props.columns}>
          {(column) => (
            <div
              class={`grid-header-cell ${column.sortable ? "sortable" : ""}`}
              style={`
                flex: ${column.width ? "0 0 " + column.width + "px" : "1"};
                padding: 8px 12px;
                cursor: ${column.sortable ? "pointer" : "default"};
                user-select: none;
                display: flex;
                align-items: center;
                gap: 8px;
              `}
              onClick={() => column.sortable && handleSort(column.key)}
            >
              <span>{column.title}</span>
              <Show
                when={column.sortable && grid.sortConfig().field === column.key}
              >
                <span style="font-size: 12px;">
                  {grid.sortConfig().direction === "asc" ? "↑" : "↓"}
                </span>
              </Show>
            </div>
          )}
        </For>
      </div>

      {/* Body */}
      <div
        ref={setContainerRef}
        class="grid-body"
        style={`
          flex: 1;
          overflow-y: auto;
          position: relative;
        `}
        onScroll={handleScroll}
      >
        <Show
          when={shouldVirtualize()}
          fallback={
            <div class="grid-content">
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
                  />
                )}
              </For>
            </div>
          }
        >
          <div
            class="grid-content"
            style={`height: ${totalHeight()}px; position: relative;`}
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

        .grid-header-cell.sortable:hover {
          background: rgba(255, 255, 255, 0.1);
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
