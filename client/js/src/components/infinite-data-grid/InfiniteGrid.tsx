import { createSignal, createMemo, createEffect, For, Show } from "solid-js";
import type { InfiniteGridProps, GridColumn } from "./types";
import { GRID_STYLES, getRowClasses } from "./styles/grid-styles";
import { useGridLayout } from "./hooks/useGridLayout";
import { saveScrollStateSecurely } from "../../lib/navigation";

import { useRowSelection } from "./hooks/useRowSelection";
import { useKeyboardNavigation } from "./hooks/useKeyboardNavigation";
import { useEventPropagation } from "./hooks/useEventPropagation";
import { useInfiniteLoading } from "./hooks/useInfiniteLoading";

import { VirtualizedRow } from "./VirtualizedRow";
import { GridHeader } from "./GridHeader";
import { GridStatusBar } from "./GridStatusBar";

export function InfiniteGrid<T>(props: InfiniteGridProps<T>) {
  // state for edit mode tracking
  const [isEditMode, setIsEditMode] = createSignal(false);
  const [editingCell, setEditingCell] = createSignal<{
    rowIndex: number;
    columnKey: string;
  } | null>(null);

  // core grid state - use external sort state if provided, otherwise internal
  const isServerSideSorting = () =>
    props.sortField !== undefined && props.onSort !== undefined;

  const [internalSortConfig, setInternalSortConfig] = createSignal({
    field: "created_at",
    direction: "desc" as "asc" | "desc",
  });

  const sortConfig = () => {
    if (isServerSideSorting()) {
      return {
        field: props.sortField || "created_at",
        direction: props.sortDirection || "desc",
      };
    }
    return internalSortConfig();
  };

  const getItemId = props.getRowId || ((item: any) => item.id || String(item));

  // simplified scroll restoration using browser history state
  const [scrollElement, setScrollElement] = createSignal<HTMLElement | null>(
    null
  );

  // get scroll state from browser history
  const getSavedScrollTop = (): number => {
    const state = history.state;
    return (state && state.scrollTop) || 0;
  };

  // save scroll state to browser history
  const saveScrollState = () => {
    const element = scrollElement();
    if (element && element.scrollTop > 0) {
      // Use safe scroll state saving to prevent hash router issues
      saveScrollStateSecurely("scrollTop", element.scrollTop);
    }
  };

  // simple sort logic directly in component
  const sortedData = createMemo(() => {
    const data = [...props.data];
    const config = sortConfig();

    if (data.length === 0) return [];

    return data.sort((a, b) => {
      const aValue = (a as any)[config.field];
      const bValue = (b as any)[config.field];

      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;

      let comparison = 0;
      if (typeof aValue === "string" && typeof bValue === "string") {
        comparison = aValue.localeCompare(bValue);
      } else {
        comparison = aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      }

      return config.direction === "desc" ? -comparison : comparison;
    });
  });

  // layout management
  const layout = useGridLayout();

  // virtualization-aware data management (after layout is defined)
  const rowHeight = props.virtualization?.rowHeight || 64;

  // calculate visible range
  const visibleRange = createMemo(() => {
    const scrollTop = layout.scrollTop();
    const containerHeight = layout.containerHeight();
    const totalItems = props.serverTotal || props.data.length;

    if (totalItems === 0 || containerHeight === 0) {
      return {
        start: 0,
        end: Math.min(50, props.data.length),
        needsMore: false,
      };
    }

    const startIndex = Math.floor(scrollTop / rowHeight);
    const visibleCount = Math.ceil(containerHeight / rowHeight);
    const bufferSize = Math.max(20, visibleCount);

    const start = Math.max(0, startIndex - bufferSize);
    const end = Math.min(totalItems, startIndex + visibleCount + bufferSize);
    const needsMore = end > props.data.length && props.data.length < totalItems;

    return { start, end, needsMore };
  });

  // trigger loading when we need more data
  createEffect(() => {
    const range = visibleRange();
    if (range.needsMore && !props.loading && props.onScrollNearBottom) {
      props.onScrollNearBottom();
    }
  });

  // row selection with keyboard support
  const selection = useRowSelection({
    data: props.data,
    getItemId: getItemId,
    onSelectionChange: props.onSelectionChange,
  });

  // infinite loading
  const infiniteLoading = useInfiniteLoading(props.onScrollNearBottom);

  // restore scroll position when data loads
  createEffect(() => {
    const element = scrollElement();
    const savedScrollTop = getSavedScrollTop();

    if (element && savedScrollTop > 0 && props.data.length > 0) {
      // restore after data is loaded
      requestAnimationFrame(() => {
        element.scrollTop = savedScrollTop;
      });
    }
  });

  // keyboard navigation
  useKeyboardNavigation({
    totalItems: props.data.length,
    focusedIndex: selection.focusedIndex,
    setFocusedIndex: selection.setFocusedIndex,
    containerRef: layout.containerRef,
    onEnter: (index) => {
      const item = props.data[index];
      if (item) {
        props.onRowDoubleClick?.(item, index);
      }
    },
    onEscape: () => {
      selection.clearSelection();
      setEditingCell(null);
      setIsEditMode(false);
    },
  });

  // event propagation management
  useEventPropagation({
    containerRef: layout.containerRef,
    isEditMode,
    onGlobalKeyDown: (event) => {
      if (event.key === "a" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        selection.selectAll();
      }
    },
  });

  // render only visible items for performance
  const visibleItems = createMemo(() => {
    const data = sortedData();
    const range = visibleRange();

    if (data.length === 0) {
      return [];
    }

    // only render items in visible range
    const items = [];
    for (let i = range.start; i < Math.min(range.end, data.length); i++) {
      items.push({ data: data[i], index: i });
    }

    return items;
  });

  // calculate display range for status bar
  const displayRange = createMemo(() => {
    const range = visibleRange();
    const totalItems = props.serverTotal || props.data.length;

    if (totalItems === 0) {
      return { start: 0, end: 0 };
    }

    return {
      start: Math.max(1, range.start + 1),
      end: Math.min(range.end, totalItems),
    };
  });

  // handle sorting
  const handleSort = (field: string) => {
    const current = sortConfig();
    let newDirection: "asc" | "desc";

    if (current.field === field) {
      // cycle through: asc -> desc (for server-side) or asc -> desc -> null (for client-side)
      if (current.direction === "asc") {
        newDirection = "desc";
      } else if (current.direction === "desc") {
        newDirection = isServerSideSorting() ? "asc" : "desc";
      } else {
        newDirection = "asc";
      }
    } else {
      newDirection = "asc";
    }

    if (isServerSideSorting()) {
      // Server-side sorting: just call the external handler
      props.onSort?.(field, newDirection);
    } else {
      // Client-side sorting: update internal state and call handler
      setInternalSortConfig({ field, direction: newDirection });
      props.onSort?.(field, newDirection);
    }
  };

  // handle row clicks with selection logic
  const handleRowClick = (item: T, index: number, event: MouseEvent) => {
    selection.handleRowClick(item, index, event);
    props.onRowClick?.(item, index, event);
  };

  // handle row double clicks
  const handleRowDoubleClick = (item: T, index: number) => {
    props.onRowDoubleClick?.(item, index);
  };

  // handle context menu with cell context
  const handleContextMenu = (
    item: T,
    index: number,
    event: MouseEvent,
    cellContext?: {
      column: GridColumn<T>;
      value: any;
      canEdit: boolean;
      cellActions?: string[];
    }
  ) => {
    event.preventDefault();
    props.onContextMenu?.(item, index, event, cellContext);
  };

  // handle cell editing
  const handleCellEdit = async (item: T, field: string, newValue: any) => {
    if (props.onCellEdit) {
      try {
        await props.onCellEdit(item, field, newValue);
        setEditingCell(null);
        setIsEditMode(false);
      } catch (error) {
        console.error("cell edit failed:", error);
      }
    }
  };

  const handleEditStart = (rowIndex: number, columnKey: string) => {
    setEditingCell({ rowIndex, columnKey });
    setIsEditMode(true);
  };

  const handleEditCancel = () => {
    setEditingCell(null);
    setIsEditMode(false);
  };

  // custom row renderer with fallback to default
  const renderRow = (item: T, index: number) => {
    const defaultRender = () => (
      <VirtualizedRow
        item={item}
        index={index}
        columns={props.columns}
        rowHeight={props.virtualization?.rowHeight || 50}
        isSelected={selection.isSelected(getItemId(item))}
        isFocused={selection.focusedIndex() === index}
        onClick={handleRowClick}
        onDoubleClick={handleRowDoubleClick}
        onContextMenu={handleContextMenu}
        editingCell={editingCell()}
        onCellEdit={handleCellEdit}
        onEditStart={handleEditStart}
        onEditCancel={handleEditCancel}
        class={getRowClasses(
          selection.isSelected(getItemId(item)),
          selection.focusedIndex() === index
        )}
      />
    );

    return props.renderRow
      ? props.renderRow(item, index, defaultRender)
      : defaultRender();
  };

  return (
    <div
      class={`${GRID_STYLES.container} ${props.className || ""}`}
      tabIndex={0}
    >
      <Show when={props.layout?.stickyHeader !== false}>
        <GridHeader
          columns={props.columns}
          sortField={sortConfig().field}
          sortDirection={sortConfig().direction}
          onSort={handleSort}
          selectedCount={selection.selectedIds().size}
          totalCount={props.data.length}
          onSelectAll={selection.selectAll}
          onClearSelection={selection.clearSelection}
          class={GRID_STYLES.header}
        />
      </Show>

      <div
        ref={(el) => {
          layout.containerRef(el);
          props.scrollElementRef?.(el);
          setScrollElement(el);
        }}
        class={GRID_STYLES.scrollContainer}
        onScroll={(e) => {
          layout.handleScroll(e);
          infiniteLoading.handleScroll(e);

          // debounced save of scroll state
          let saveTimer: ReturnType<typeof setTimeout> | undefined;
          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = setTimeout(saveScrollState, 300);
        }}
        style={{
          "scrollbar-width": "thin",
          "scrollbar-color": "#4a4a4a #1a1a1a",
        }}
      >
        <div
          class={GRID_STYLES.contentContainer}
          style={{
            height: `${(props.serverTotal || props.data.length) * rowHeight}px`,
            position: "relative",
          }}
        >
          <For each={visibleItems()}>
            {(item) => (
              <div
                style={{
                  position: "absolute",
                  top: `${item.index * rowHeight}px`,
                  left: "0",
                  right: "0",
                  height: `${rowHeight}px`,
                }}
              >
                {item.data && renderRow(item.data, item.index)}
              </div>
            )}
          </For>
        </div>
      </div>

      {/* floating status bar */}
      <Show when={props.layout?.showStatusBar}>
        <div class="fixed bottom-4 right-4 z-20">
          {(() => {
            const range = displayRange();
            const statusBarProps = {
              totalItems: props.serverTotal || props.data.length,
              visibleItems: props.data.length,
              selectedCount: selection.selectedIds().size,
              loading: props.loading,
              hasMore: props.hasMore,
              startRow: range.start,
              endRow: range.end,
            };

            return (
              <GridStatusBar
                totalItems={statusBarProps.totalItems}
                visibleItems={statusBarProps.visibleItems}
                selectedCount={statusBarProps.selectedCount}
                loading={statusBarProps.loading}
                hasMore={statusBarProps.hasMore}
                startRow={statusBarProps.startRow}
                endRow={statusBarProps.endRow}
                class="bg-black bg-opacity-90 border border-gray-700 px-3 py-2 text-xs backdrop-blur-sm"
              />
            );
          })()}
        </div>
      </Show>
    </div>
  );
}
