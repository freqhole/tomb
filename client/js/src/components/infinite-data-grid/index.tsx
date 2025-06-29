import {
  createSignal,
  createMemo,
  onMount,
  onCleanup,
  For,
  Show,
} from "solid-js";
import type { GridProps, GridColumn, GridTheme } from "./types";
import { THEMES, DEFAULT_DARK_THEME } from "./types";
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
  theme: GridTheme;
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
      class="grid-row"
      style={`
        height: ${props.rowHeight}px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid ${props.theme.colors.border};
        background: ${props.isSelected ? props.theme.colors.selected : "transparent"};
        transition: background-color 0.15s ease;
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

  // Theme
  const theme = createMemo((): GridTheme => {
    if (typeof props.theme === "string") {
      const themeFromName = THEMES[props.theme];
      return themeFromName ? themeFromName : DEFAULT_DARK_THEME;
    }
    if (props.theme) {
      return props.theme;
    }
    return DEFAULT_DARK_THEME;
  });

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

  const totalHeight = createMemo(() => props.data.length * rowHeight);

  // Event handlers
  const handleScroll = (e: Event) => {
    const target = e.target as HTMLDivElement;
    setScrollTop(target.scrollTop);
  };

  const handleSort = (field: string) => {
    grid.handleSort(field);
    if (props.onSort) {
      const config = grid.sortConfig();
      props.onSort(config.field, config.direction);
    }
  };

  const handleRowClick = (item: T, index: number, event: MouseEvent) => {
    const itemId = grid.getItemId(item);

    if (event.ctrlKey || event.metaKey) {
      grid.toggleSelection(itemId);
    } else if (event.shiftKey && grid.selectedItems().size > 0) {
      // Find last selected item and select range
      const data = props.data;
      const lastSelectedId = Array.from(grid.selectedItems()).pop();
      if (lastSelectedId) {
        const lastIndex = data.findIndex(
          (item) => grid.getItemId(item) === lastSelectedId
        );
        if (lastIndex !== -1) {
          grid.selectRange(lastIndex, index);
        }
      }
    } else {
      grid.clearSelection();
      grid.toggleSelection(itemId);
    }

    props.onRowClick?.(item, index, event);
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
        background: ${theme().colors.background};
        color: ${theme().colors.text};
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
          background: ${theme().colors.header};
          border-bottom: 2px solid ${theme().colors.border};
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
                    isSelected={grid.isSelected(grid.getItemId(item))}
                    onRowClick={handleRowClick}
                    onRowDoubleClick={props.onRowDoubleClick}
                    onRowMouseDown={props.onRowMouseDown}
                    onRowMount={props.onRowMount}
                    onContextMenu={props.onContextMenu}
                    theme={theme()}
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
                    isSelected={grid.isSelected(
                      grid.getItemId(virtualItem.item!)
                    )}
                    onRowClick={handleRowClick}
                    onRowDoubleClick={props.onRowDoubleClick}
                    onRowMouseDown={props.onRowMouseDown}
                    onRowMount={props.onRowMount}
                    onContextMenu={props.onContextMenu}
                    theme={theme()}
                    rowHeight={rowHeight}
                  />
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      <style>{`
        .grid-row:hover {
          background: ${theme().colors.hover} !important;
        }

        .grid-header-cell.sortable:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .grid-body::-webkit-scrollbar {
          width: 8px;
        }

        .grid-body::-webkit-scrollbar-track {
          background: ${theme().colors.background};
        }

        .grid-body::-webkit-scrollbar-thumb {
          background: ${theme().colors.border};
          border-radius: 4px;
        }

        .grid-body::-webkit-scrollbar-thumb:hover {
          background: ${theme().colors.text};
        }
      `}</style>
    </div>
  );
}

export default InfiniteDataGrid;
