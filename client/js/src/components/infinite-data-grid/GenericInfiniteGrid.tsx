/* @jsxImportSource solid-js */
import { render } from "solid-js/web";
import {
  createSignal,
  createMemo,
  onMount,
  onCleanup,
  For,
  Show,
  JSX,
} from "solid-js";

console.log("🚀 Generic Infinite Grid script loading");

// Generic interfaces
export interface GridColumn<T = any> {
  key: string;
  title: string;
  width?: number;
  sortable?: boolean;
  render?: (item: T, value: any) => JSX.Element;
  getValue?: (item: T) => any;
  renderHeader?: () => JSX.Element;
}

interface GridProps<T = any> {
  data: T[];
  columns: GridColumn<T>[];
  rowHeight?: number;
  headerHeight?: number;
  onSort?: (field: string, direction: "asc" | "desc" | null) => void;
  onRowDoubleClick?: (item: T) => void;
  onRowMount?: (item: T) => void;
  onRowClick?: (item: T, index: number, event: MouseEvent) => void;
  onRowMouseDown?: (item: T, index: number, event: MouseEvent) => void;
  onContextMenu?: (item: T, index: number, event: MouseEvent) => void;
  onScrollNearBottom?: () => void;
  selectedRowIds?: Set<string>;
  getRowId?: (item: T) => string;
  isDragSelecting?: boolean;
  sortField?: string;
  sortDirection?: "asc" | "desc" | null;

  className?: string;
  theme?: "light" | "dark";
  loading?: boolean;
  serverTotal?: number;
}

type SortDirection = "asc" | "desc" | null;

function GenericInfiniteGrid<T = any>(props: GridProps<T>) {
  console.log("📦 GenericInfiniteGrid component created");

  // Constants
  const ROW_HEIGHT = () => props.rowHeight || 50;
  const HEADER_HEIGHT = () => props.headerHeight || 60;
  const BUFFER_SIZE = 5; // Extra rows to render outside visible area

  // State
  const [scrollTop, setScrollTop] = createSignal(0);
  const [containerHeight, setContainerHeight] = createSignal(500);

  let scrollContainer: HTMLDivElement | undefined;

  // Virtual scrolling calculations
  // Much simpler virtual scrolling
  const totalRows = createMemo(() => props.data.length);
  // Use container height from state
  const estimatedContainerHeight = containerHeight();
  const visibleRowCount =
    Math.ceil(estimatedContainerHeight / ROW_HEIGHT()) + BUFFER_SIZE;

  const startIndex = createMemo(() => {
    const index = Math.floor(scrollTop() / ROW_HEIGHT());
    return Math.max(0, index - BUFFER_SIZE);
  });

  const endIndex = createMemo(() => {
    return Math.min(totalRows(), startIndex() + visibleRowCount);
  });

  const visibleData = createMemo(() => {
    return props.data.slice(startIndex(), endIndex());
  });

  const visibleDataWithSelection = createMemo(() => {
    return visibleData().map((item, index) => {
      const actualIndex = startIndex() + index;
      const itemId = (item as any).id;
      const isSelected = props.selectedRowIds?.has(itemId) || false;
      return { item, actualIndex, itemId, isSelected };
    });
  });

  // Simple stats calculation
  const actualVisibleStartRow = createMemo(() => {
    return Math.floor(scrollTop() / ROW_HEIGHT()) + 1;
  });

  const actualVisibleEndRow = createMemo(() => {
    // Use actual container height from the DOM element
    const containerEl = scrollContainer;
    const actualHeight = containerEl
      ? containerEl.clientHeight
      : estimatedContainerHeight;
    const maxRow = Math.floor((scrollTop() + actualHeight) / ROW_HEIGHT());
    return Math.min(maxRow, totalRows());
  });

  const totalContentHeight = createMemo(() => {
    return totalRows() * ROW_HEIGHT();
  });

  // Event handlers
  const handleScroll = (e: Event) => {
    const target = e.target as HTMLDivElement;
    const scrollTop = target.scrollTop;
    const scrollHeight = target.scrollHeight;
    const clientHeight = target.clientHeight;

    setScrollTop(scrollTop);

    // Check if we're near the bottom (within 200px)
    if (
      props.onScrollNearBottom &&
      scrollTop + clientHeight >= scrollHeight - 200
    ) {
      props.onScrollNearBottom();
    }
  };

  const handleSort = (field: string) => {
    if (!props.onSort) return;

    const currentField = props.sortField;
    const currentDirection = props.sortDirection;

    console.log("SORT DEBUG: handleSort called", {
      clickedField: field,
      currentField: currentField,
      currentDirection: currentDirection,
      fieldsMatch: currentField === field,
      directionType: typeof currentDirection,
    });

    let newDirection: SortDirection | null;

    if (currentField !== field) {
      // First click on a new field - start with ascending
      newDirection = "asc";
      console.log("SORT DEBUG: Different field, setting to asc");
    } else {
      // Simple cycling: asc -> desc -> null -> asc
      console.log("SORT DEBUG: Same field, cycling from:", currentDirection);
      if (currentDirection === "asc") {
        newDirection = "desc";
        console.log("SORT DEBUG: asc -> desc");
      } else if (currentDirection === "desc") {
        newDirection = null;
        console.log("SORT DEBUG: desc -> null");
      } else {
        newDirection = "asc";
        console.log("SORT DEBUG: null/other -> asc");
      }
    }

    console.log("SORT DEBUG: About to call onSort with", {
      field: field,
      newDirection: newDirection,
      willSendNull: newDirection === null,
    });
    props.onSort(field, newDirection);
  };

  const handleResize = () => {
    if (scrollContainer) {
      setContainerHeight(scrollContainer.clientHeight);
    }
  };

  onMount(() => {
    window.addEventListener("resize", handleResize);
  });

  onCleanup(() => {
    window.removeEventListener("resize", handleResize);
  });

  const getSortIcon = (field: string) => {
    if (props.sortField !== field) return "⋮⋮";
    if (!props.sortDirection) return "○";
    return props.sortDirection === "asc" ? "↑" : "↓";
  };

  const getSortClass = (field: string) => {
    if (props.sortField !== field) return "";
    if (!props.sortDirection) return "sort-none";
    return props.sortDirection === "asc" ? "sort-asc" : "sort-desc";
  };

  const renderCell = (column: GridColumn<T>, item: T) => {
    const value = column.getValue
      ? column.getValue(item)
      : (item as any)[column.key];

    if (column.render) {
      return column.render(item, value);
    }

    return <span>{String(value)}</span>;
  };

  return (
    <div class={`generic-infinite-grid ${props.className || ""}`}>
      <style>{`
        .generic-infinite-grid {
          height: 100%;
          background: #171717;
          color: #e0e0e0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .generic-infinite-grid.light {
          background: #ffffff;
          color: #1a1a1a;
        }

        .grid-header {
          height: ${HEADER_HEIGHT()}px;
          background: rgba(0, 0, 0, 0.9);
          border-bottom: none;
          display: flex;
          align-items: center;
          position: sticky;
          top: 0;
          z-index: 50;
        }

        .light .grid-header {
          background: #f8f9fa;
          border-bottom-color: #dee2e6;
        }

        .header-cell {
          flex: 1;
          padding: 0 12px;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          user-select: none;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-right: none;
          transition: background-color 0.2s;
          min-width: 0;
          height: 100%;
          position: relative;
        }

        .light .header-cell {
          border-right-color: #dee2e6;
        }

        .header-cell:hover {
          background: rgba(0, 0, 0, 0.7);
        }

        .light .header-cell:hover {
          background: #e9ecef;
        }

        .header-cell:last-child {
          border-right: none;
        }

        .header-cell.sort-asc .sort-indicator,
        .header-cell.sort-desc .sort-indicator {
          color: #ff00ff;
          font-weight: bold;
        }

        .header-cell.sort-asc,
        .header-cell.sort-desc {
          background: rgba(0, 0, 0, 0.8);
        }

        .header-cell.sort-asc .sort-indicator:after {
          content: " ↑";
          color: #ff00ff;
          margin-left: 4px;
        }

        .header-cell.sort-desc .sort-indicator:after {
          content: " ↓";
          color: #ff00ff;
          margin-left: 4px;
        }

        .sort-icon {
          display: none;
        }

        .light .header-cell.sort-asc,
        .light .header-cell.sort-desc {
          background: #e2e8f0;
        }

        .header-cell.not-sortable {
          cursor: default;
        }

        .header-cell.not-sortable:hover {
          background: transparent;
        }

        .header-title {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .sort-icon {
          margin-left: 8px;
          opacity: 0.6;
          font-size: 12px;
          flex-shrink: 0;
        }

        .grid-viewport {
          flex: 1;
          overflow: auto;
          position: relative;
          scroll-behavior: smooth;
        }

        .grid-content {
          position: relative;
        }

        .grid-row {
          height: ${ROW_HEIGHT()}px;
          display: flex;
          align-items: center;
          border-bottom: none;
          background: rgba(0, 0, 0, 0.9);
          will-change: transform;
        }

        .light .grid-row {
          border-bottom-color: #dee2e6;
          background: #ffffff;
        }

        .grid-row:hover {
          background: rgba(0, 0, 0, 0.7);
        }

        .light .grid-row:hover {
          background: #f8f9fa;
        }

        .grid-row.selected {
          background: rgba(217, 70, 239, 0.3) !important;
          box-shadow: inset 0 0 0 2px rgb(217, 70, 239) !important;
          transition: all 0.15s ease !important;
        }

        .grid-row.selected:hover {
          background: rgba(217, 70, 239, 0.4) !important;
          box-shadow: inset 0 0 0 2px rgb(217, 70, 239) !important;
        }

        .light .grid-row.selected {
          background: rgba(217, 70, 239, 0.1) !important;
          box-shadow: inset 0 0 0 2px rgba(217, 70, 239, 0.6) !important;
        }

        .light .grid-row.selected:hover {
          background: rgba(217, 70, 239, 0.2) !important;
          box-shadow: inset 0 0 0 2px rgb(217, 70, 239) !important;
        }

        .grid-cell {
          flex: 1;
          padding: 0 12px;
          font-size: 14px;
          border-right: none;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }

        .light .grid-cell {
          border-right-color: #dee2e6;
        }

        .grid-cell:last-child {
          border-right: none;
        }

        .grid-stats {
          position: absolute;
          bottom: 20px;
          right: 20px;
          background: #2a2a2a;
          padding: 8px 12px;
          border-radius: 4px;
          font-size: 12px;
          color: #b0b0b0;
          border: 1px solid #3a3a3a;
          z-index: 10;
        }

        .light .grid-stats {
          background: #f8f9fa;
          color: #6c757d;
          border-color: #dee2e6;
        }
      `}</style>

      <div class="grid-header">
        <For each={props.columns}>
          {(column) => (
            <div
              class={`header-cell ${!column.sortable ? "not-sortable" : ""} ${
                column.sortable ? getSortClass(column.key) : ""
              }`}
              style={
                column.width
                  ? {
                      "flex-basis": `${column.width}px`,
                      "flex-grow": "0",
                      "flex-shrink": "0",
                    }
                  : {}
              }
              onClick={() => column.sortable && handleSort(column.key)}
            >
              <Show
                when={column.renderHeader}
                fallback={
                  <span class="header-title">
                    {column.title}
                    <span class="sort-indicator"></span>
                  </span>
                }
              >
                {column.renderHeader!()}
              </Show>
              <Show when={column.sortable}>
                <span class="sort-icon">{getSortIcon(column.key)}</span>
              </Show>
            </div>
          )}
        </For>
      </div>

      <div class="grid-viewport" ref={scrollContainer!} onScroll={handleScroll}>
        <div
          class="grid-content"
          style={{ height: `${totalContentHeight()}px` }}
        >
          <For each={visibleDataWithSelection()}>
            {(rowData) => {
              const { item, actualIndex, isSelected } = rowData;

              // Call onRowMount when the row is rendered
              if (props.onRowMount) {
                props.onRowMount(item);
              }

              return (
                <div
                  class={`grid-row ${isSelected ? "selected" : ""}`}
                  style={{
                    transform: `translateY(${actualIndex * ROW_HEIGHT()}px)`,
                    position: "absolute",
                    top: "0px",
                    left: "0px",
                    right: "0px",
                  }}
                  onDblClick={() => props.onRowDoubleClick?.(item)}
                  onClick={(e) => props.onRowClick?.(item, actualIndex, e)}
                  onMouseDown={(e) =>
                    props.onRowMouseDown?.(item, actualIndex, e)
                  }
                  onContextMenu={(e) =>
                    props.onContextMenu?.(item, actualIndex, e)
                  }
                >
                  <For each={props.columns}>
                    {(column) => (
                      <div
                        class="grid-cell"
                        style={
                          column.width
                            ? {
                                "flex-basis": `${column.width}px`,
                                "flex-grow": "0",
                                "flex-shrink": "0",
                              }
                            : {}
                        }
                      >
                        {renderCell(column, item)}
                      </div>
                    )}
                  </For>
                </div>
              );
            }}
          </For>
        </div>
      </div>

      <div class="grid-stats">
        <Show
          when={props.loading}
          fallback={
            <>
              Showing rows {actualVisibleStartRow()}-{actualVisibleEndRow()} of{" "}
              {props.serverTotal || totalRows()}
            </>
          }
        >
          <div class="flex items-center space-x-2">
            <div class="animate-spin h-3 w-3 border border-magenta-500 border-t-transparent"></div>
            <span>Loading more...</span>
          </div>
        </Show>
      </div>
    </div>
  );
}

// Custom element wrapper for the generic grid
export interface GenericInfiniteGridElementProps {
  data?: string; // JSON string
  columns?: string; // JSON string
  "row-height"?: string;
  "header-height"?: string;
  theme?: "light" | "dark";
}

class GenericInfiniteGridElement extends HTMLElement {
  private dispose?: () => void;

  connectedCallback() {
    console.log("🔌 GenericInfiniteGridElement connected");
    try {
      const dataAttr = this.getAttribute("data");
      const columnsAttr = this.getAttribute("columns");
      const rowHeight = parseInt(this.getAttribute("row-height") || "50");
      const headerHeight = parseInt(this.getAttribute("header-height") || "60");
      const theme = (this.getAttribute("theme") as "light" | "dark") || "dark";

      let data = [];
      let columns = [];

      try {
        data = dataAttr ? JSON.parse(dataAttr) : [];
        columns = columnsAttr ? JSON.parse(columnsAttr) : [];
      } catch (e) {
        console.error("Failed to parse data or columns attributes:", e);
      }

      this.dispose = render(
        () => (
          <GenericInfiniteGrid
            data={data}
            columns={columns}
            rowHeight={rowHeight}
            headerHeight={headerHeight}
            theme={theme}
            className={theme}
          />
        ),
        this
      );
      console.log("✅ Generic Infinite Grid render successful");
    } catch (error) {
      console.error("❌ Generic Infinite Grid render failed:", error);
    }
  }

  disconnectedCallback() {
    console.log("🔌 GenericInfiniteGridElement disconnected");
    if (this.dispose) {
      this.dispose();
    }
  }
}

console.log("📝 About to register generic-infinite-grid custom element");

try {
  customElements.define("generic-infinite-grid", GenericInfiniteGridElement);
  console.log(
    "✅ Generic Infinite Grid custom element registered successfully"
  );
} catch (error) {
  console.error(
    "❌ Failed to register generic-infinite-grid custom element:",
    error
  );
}

export { GenericInfiniteGrid, GenericInfiniteGridElement };
