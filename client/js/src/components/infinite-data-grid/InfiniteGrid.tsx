import { createSignal, createMemo, For, Show } from "solid-js";
import type { InfiniteGridProps, GridColumn } from "./types";
import { GRID_STYLES, getRowClasses } from "./styles/grid-styles";
import { useGridLayout } from "./hooks/useGridLayout";
import { useVirtualization } from "./hooks/useVirtualization";
import { useRowSelection } from "./hooks/useRowSelection";
import { useKeyboardNavigation } from "./hooks/useKeyboardNavigation";
import { useEventPropagation } from "./hooks/useEventPropagation";
import { useInfiniteLoading } from "./hooks/useInfiniteLoading";
import { useInfiniteGrid } from "./hooks/useInfiniteGrid";
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

  // core grid logic
  const grid = useInfiniteGrid({
    data: props.data,
    getItemId: props.getRowId || ((item: any) => item.id || String(item)),
    initialSort: props.sortField
      ? {
          field: props.sortField,
          direction: props.sortDirection || "asc",
        }
      : undefined,
  });

  // layout management
  const layout = useGridLayout();

  // row selection with keyboard support
  const selection = useRowSelection({
    data: props.data,
    getItemId: grid.getItemId,
    onSelectionChange: props.onSelectionChange,
  });

  // virtualization - simplified to handle initial load better
  const virtualization = useVirtualization({
    containerHeight: layout.containerHeight(),
    rowHeight: props.virtualization?.rowHeight || 50,
    totalItems: props.data.length,
    bufferSize: props.virtualization?.bufferSize || 5,
    scrollTop: layout.scrollTop(),
  });

  // infinite loading detection
  useInfiniteLoading({
    scrollTop: layout.scrollTop,
    containerHeight: layout.containerHeight,
    totalContentHeight: virtualization.totalContentHeight,
    onScrollNearBottom: props.onScrollNearBottom,
    threshold: props.virtualization?.threshold || 200,
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

  // get visible items - force re-render when data changes
  const visibleItems = createMemo(() => {
    const sortedData = grid.sortedData();
    const range = virtualization.visibleRange();
    const items: Array<{ data: T; index: number }> = [];

    console.log(
      "visible items memo firing - data length:",
      props.data.length,
      "sorted length:",
      sortedData.length
    );

    // if no data yet, return empty array
    if (sortedData.length === 0) {
      console.log("no data yet, returning empty array");
      return items;
    }

    // if container height is 0 (initial load), render first 20 items
    if (layout.containerHeight() <= 0) {
      console.log("container height is 0, rendering first 20 items");
      return sortedData.slice(0, 20).map((data, index) => ({ data, index }));
    }

    // normal virtualization
    for (let i = range.start; i < range.end; i++) {
      if (i >= 0 && i < sortedData.length) {
        const itemData = sortedData[i];
        if (itemData) {
          items.push({
            data: itemData,
            index: i,
          });
        }
      }
    }

    console.log("returning", items.length, "virtualized items");
    return items;
  });

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
        isSelected={selection.isSelected(grid.getItemId(item))}
        isFocused={selection.focusedIndex() === index}
        onClick={handleRowClick}
        onDoubleClick={handleRowDoubleClick}
        onContextMenu={handleContextMenu}
        editingCell={editingCell()}
        onCellEdit={handleCellEdit}
        onEditStart={handleEditStart}
        onEditCancel={handleEditCancel}
        class={getRowClasses(
          selection.isSelected(grid.getItemId(item)),
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
          sortField={grid.sortConfig().field}
          sortDirection={grid.sortConfig().direction}
          onSort={(field: string) => {
            grid.handleSort(field);
            props.onSort?.(field, grid.sortConfig().direction);
          }}
          selectedCount={selection.selectedIds().size}
          totalCount={props.data.length}
          onSelectAll={selection.selectAll}
          onClearSelection={selection.clearSelection}
          class={GRID_STYLES.header}
        />
      </Show>

      <div
        ref={layout.containerRef}
        class={GRID_STYLES.scrollContainer}
        onScroll={layout.handleScroll}
        style={{
          "scrollbar-width": "thin",
          "scrollbar-color": "#4a4a4a #1a1a1a",
        }}
      >
        <div
          class={GRID_STYLES.contentContainer}
          style={`height: ${virtualization.totalContentHeight()}px`}
        >
          <For each={visibleItems()}>
            {(item) => renderRow(item.data, item.index)}
          </For>
        </div>
      </div>

      <Show when={props.layout?.showStatusBar}>
        <GridStatusBar
          totalItems={props.serverTotal || props.data.length}
          visibleItems={props.data.length}
          selectedCount={selection.selectedIds().size}
          loading={props.loading}
          hasMore={props.hasMore}
          class={GRID_STYLES.statusBar}
        />
      </Show>
    </div>
  );
}
