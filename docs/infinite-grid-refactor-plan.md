# Infinite Grid Refactor Plan

## CRITICAL RULES - NEVER FORGET

1. **NO EMOJIS**: Keep code comments, logs, and ui display text lowercase (proper nouns and acronyms can be uppercase)
2. **File Size Limit**: Maximum ~500 lines per file
3. **Dark Theme Design**: UI must use dark theme with primary colors black, white, and magenta accents. Use other colors sparingly. Avoid borders and no rounded corner border radius (border-radius: 0)
4. **Modular Architecture**:
   - Use solidjs hooks for reactive logic
   - Keep components presentational (jsx + tailwind)
   - Central context providers for state
   - Avoid prop drilling - use hooks to access data
   - Lean into composition over large monolithic components
5. **Data Validation**: Use zod for all json api data parsing and validation (existing pattern)
6. **Code Reuse**: Leverage existing lib code and hooks where possible, build new generic utilities in `client/js/src/lib/`
7. **Domain Separation**: Keep admin logic generic in views/admin/, music-specific code in lib/music/ and hooks/music/ for reusability across domains
8. **Generic Library Focus**: Build reusable patterns in `client/js/src/lib/` especially for server data fetching and zod validation

## Overview

This document outlines the technical plan for refactoring the infinite data grid component system to consolidate two implementations, fix scrolling issues, and establish proper architectural patterns.

## Current State Analysis

### Existing Implementations

1. **`web-components/generic-infinite-grid.tsx`** (487 lines)
   - Used by music admin view
   - Has virtual scrolling with complex viewport calculations
   - Fixed height container approach causing scrolling issues
   - Contains both logic and styling in one file
   - Uses custom CSS styling instead of tailwind

2. **`components/infinite-data-grid/`** (existing structure)
   - Has proper type definitions (`types.ts`)
   - Modular hook architecture (`hooks/useInfiniteGrid.ts`)
   - Presentation component (`index.tsx`)
   - Used by freqhole view (different implementation)
   - Better separation of concerns

### Key Issues to Solve

1. **Scrolling Problems**: Can't scroll to see last rows due to viewport height miscalculations
2. **Flex Layout**: Grid container needs to adapt to dynamic header height (filters open/close)
3. **Code Organization**: Mixing presentation, logic, and styling
4. **Import Dependencies**: Admin view importing from web-components (wrong pattern)
5. **Code Duplication**: Two different infinite grid implementations

## Refactor Strategy

### Phase 1: Architecture Design

#### File Structure (Final State)

```
components/infinite-data-grid/
├── index.ts                          # public exports
├── InfiniteGrid.tsx                  # main presentation component (~150 lines)
├── VirtualizedRow.tsx                # row component (~80 lines)
├── GridHeader.tsx                    # header component (~100 lines)
├── GridStatusBar.tsx                 # status bar with infinite loading (~60 lines)
├── types.ts                          # type definitions (existing, enhanced)
├── hooks/
│   ├── useInfiniteGrid.ts           # core grid logic (existing, enhanced)
│   ├── useVirtualization.ts         # virtual scrolling logic (~100 lines)
│   ├── useGridLayout.ts             # layout and sizing logic (~80 lines)
│   ├── useInfiniteLoading.ts        # infinite scroll detection (~80 lines)
│   ├── useRowSelection.ts           # selection logic with keyboard support (~100 lines)
│   ├── useKeyboardNavigation.ts     # keyboard and focus management (~80 lines)
│   └── useEventPropagation.ts       # event delegation patterns (~60 lines)
├── styles/
│   └── grid-styles.ts               # tailwind class utilities (~50 lines)
└── utils/
    └── grid-calculations.ts         # pure calculation functions (~60 lines)
```

#### Core Principles

- **Separation of Concerns**: Logic in hooks, presentation in components
- **Composition Over Configuration**: Small, focused components that compose together
- **CSS-First Layout**: use flexbox for natural height adaptation
- **Type Safety**: comprehensive typescript interfaces
- **Performance**: efficient virtual scrolling without over-engineering

### Phase 2: Implementation Plan

#### Step 1: Create New Hook Architecture

**`hooks/useVirtualization.ts`**

```typescript
interface VirtualizationConfig {
  containerHeight: number;
  rowHeight: number;
  totalItems: number;
  bufferSize?: number;
  scrollTop: number;
}

export function useVirtualization(config: VirtualizationConfig) {
  // simple virtual window calculation
  const startIndex = createMemo(() =>
    Math.max(
      0,
      Math.floor(config.scrollTop / config.rowHeight) -
        (config.bufferSize || 5),
    ),
  );

  const endIndex = createMemo(() =>
    Math.min(
      config.totalItems,
      startIndex() +
        Math.ceil(config.containerHeight / config.rowHeight) +
        (config.bufferSize || 5) * 2,
    ),
  );

  const visibleRange = createMemo(() => ({
    start: startIndex(),
    end: endIndex(),
  }));
  const totalContentHeight = createMemo(
    () => config.totalItems * config.rowHeight,
  );

  return { visibleRange, totalContentHeight, startIndex, endIndex };
}
```

**`hooks/useGridLayout.ts`**

```typescript
export function useGridLayout() {
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();
  const [scrollTop, setScrollTop] = createSignal(0);
  const [containerHeight, setContainerHeight] = createSignal(0);

  // use ResizeObserver for dynamic height tracking
  createEffect(() => {
    const container = containerRef();
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    resizeObserver.observe(container);

    onCleanup(() => resizeObserver.disconnect());
  });

  const handleScroll = (e: Event) => {
    const target = e.target as HTMLDivElement;
    setScrollTop(target.scrollTop);
  };

  return {
    containerRef: setContainerRef,
    scrollTop,
    containerHeight,
    handleScroll,
  };
}

// row selection with keyboard support
export function useRowSelection<T>(props: {
  data: T[];
  getItemId: (item: T) => string;
  onSelectionChange?: (selectedIds: Set<string>) => void;
}) {
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = createSignal<number>(-1);
  const [focusedIndex, setFocusedIndex] = createSignal<number>(0);

  const handleRowClick = (item: T, index: number, event: MouseEvent) => {
    const itemId = props.getItemId(item);
    const current = new Set(selectedIds());

    if (event.shiftKey && lastSelectedIndex() >= 0) {
      // range selection
      const start = Math.min(lastSelectedIndex(), index);
      const end = Math.max(lastSelectedIndex(), index);
      for (let i = start; i <= end; i++) {
        if (i < props.data.length) {
          current.add(props.getItemId(props.data[i]));
        }
      }
    } else if (event.ctrlKey || event.metaKey) {
      // toggle selection
      if (current.has(itemId)) {
        current.delete(itemId);
      } else {
        current.add(itemId);
      }
    } else {
      // single selection
      current.clear();
      current.add(itemId);
    }

    setSelectedIds(current);
    setLastSelectedIndex(index);
    setFocusedIndex(index);
    props.onSelectionChange?.(current);
  };

  const selectAll = () => {
    const allIds = new Set(props.data.map(props.getItemId));
    setSelectedIds(allIds);
    props.onSelectionChange?.(allIds);
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setLastSelectedIndex(-1);
    props.onSelectionChange?.(new Set());
  };

  return {
    selectedIds,
    focusedIndex,
    handleRowClick,
    selectAll,
    clearSelection,
    isSelected: (itemId: string) => selectedIds().has(itemId),
  };
}

// keyboard navigation
export function useKeyboardNavigation(props: {
  totalItems: number;
  focusedIndex: () => number;
  setFocusedIndex: (index: number) => void;
  onEnter?: (index: number) => void;
  onEscape?: () => void;
}) {
  const handleKeyDown = (event: KeyboardEvent) => {
    const current = props.focusedIndex();

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (current < props.totalItems - 1) {
          props.setFocusedIndex(current + 1);
        }
        break;
      case "ArrowUp":
        event.preventDefault();
        if (current > 0) {
          props.setFocusedIndex(current - 1);
        }
        break;
      case "Enter":
        event.preventDefault();
        props.onEnter?.(current);
        break;
      case "Escape":
        event.preventDefault();
        props.onEscape?.();
        break;
      case "Home":
        event.preventDefault();
        props.setFocusedIndex(0);
        break;
      case "End":
        event.preventDefault();
        props.setFocusedIndex(props.totalItems - 1);
        break;
    }
  };

  return { handleKeyDown };
}

// event propagation patterns
export function useEventPropagation(props: {
  containerRef: () => HTMLDivElement | undefined;
  isEditMode: () => boolean;
  onGlobalKeyDown?: (event: KeyboardEvent) => void;
}) {
  // global keyboard handler at container level
  const handleContainerKeyDown = (event: KeyboardEvent) => {
    // if any input/textarea is focused, let browser handle it
    const activeElement = document.activeElement;
    if (
      activeElement?.tagName === "INPUT" ||
      activeElement?.tagName === "TEXTAREA" ||
      activeElement?.hasAttribute("contenteditable")
    ) {
      return; // browser handles input events naturally
    }

    // if in edit mode, let edit component handle keys
    if (props.isEditMode()) {
      return;
    }

    // only handle grid-level shortcuts when not editing
    props.onGlobalKeyDown?.(event);
  };

  // attach event listener to container
  createEffect(() => {
    const container = props.containerRef();
    if (!container) return;

    container.addEventListener("keydown", handleContainerKeyDown);

    onCleanup(() => {
      container.removeEventListener("keydown", handleContainerKeyDown);
    });
  });

  return {
    // helper to stop propagation for cell-level events
    stopPropagation: (event: Event) => {
      event.stopPropagation();
    },
    // helper to prevent default browser behavior
    preventDefault: (event: Event) => {
      event.preventDefault();
    },
  };
}

// infinite loading detection hook
export function useInfiniteLoading(props: {
  scrollTop: () => number;
  containerHeight: () => number;
  totalContentHeight: () => number;
  onScrollNearBottom?: () => void;
  threshold?: number;
}) {
  const threshold = props.threshold || 200; // pixels from bottom

  createEffect(() => {
    const scrollTop = props.scrollTop();
    const containerHeight = props.containerHeight();
    const totalHeight = props.totalContentHeight();

    const scrollBottom = scrollTop + containerHeight;
    const distanceFromBottom = totalHeight - scrollBottom;

    if (distanceFromBottom <= threshold && props.onScrollNearBottom) {
      props.onScrollNearBottom();
    }
  });
}
```

#### Step 2: CSS-First Layout Solution

**Container Structure:**

```tsx
// parent container (AdminView)
<div class="h-screen flex flex-col bg-black text-white">
  <AdminHeader class="flex-shrink-0" /> {/* dynamic height based on filters */}
  <InfiniteGrid class="flex-1" />        {/* takes remaining space */}
</div>

// grid internal structure
<div class="h-full flex flex-col bg-black">
  <GridHeader class="flex-shrink-0 bg-black bg-opacity-90" />   {/* fixed header height */}
  <div class="flex-1 overflow-auto">     {/* scrollable content area */}
    <div style={`height: ${totalHeight}px`}>  {/* virtual content height */}
      {/* rendered rows */}
    </div>
  </div>
</div>
```

**Key Layout Principles:**

- use `flex: 1` instead of fixed heights
- let browser handle scroll container naturally
- use ResizeObserver to track actual container dimensions
- eliminate complex viewport calculations

#### Step 3: Enhanced Type System

**Enhanced `types.ts`:**

```typescript
// extend existing types with new features
export interface GridColumn<T = any> {
  key: string;
  title: string | JSX.Element;
  width?: number | string; // support both px and %
  minWidth?: number;
  maxWidth?: number;
  sortable?: boolean;
  resizable?: boolean;
  editable?: boolean; // double-click to edit
  render?: (item: T, index: number) => JSX.Element;
  renderHeader?: () => JSX.Element;
  renderEditCell?: (
    item: T,
    value: any,
    onSave: (newValue: any) => void,
    onCancel: () => void,
  ) => JSX.Element;
  className?: string;
  headerClassName?: string;
  cellClassName?: string;
}

export interface VirtualizationOptions {
  enabled?: boolean;
  threshold?: number;
  bufferSize?: number;
  rowHeight?: number;
  headerHeight?: number;
}

export interface GridLayoutOptions {
  stickyHeader?: boolean;
  showRowNumbers?: boolean;
  showStatusBar?: boolean;
  allowColumnResize?: boolean;
  allowRowSelection?: boolean;
}

export interface InfiniteGridProps<T = any> {
  data: T[];
  columns: GridColumn<T>[];

  // Layout
  className?: string;
  virtualization?: VirtualizationOptions;
  layout?: GridLayoutOptions;

  // Events
  onSort?: (field: string, direction: SortDirection | null) => void;
  onRowClick?: (item: T, index: number, event: MouseEvent) => void;
  onRowDoubleClick?: (item: T, index: number) => void;
  onContextMenu?: (
    item: T,
    index: number,
    event: MouseEvent,
    cellContext?: {
      column: GridColumn<T>;
      value: any;
      canEdit: boolean;
      cellActions?: string[];
    },
  ) => void;
  onSelectionChange?: (selectedIds: Set<string>) => void;
  onLoadMore?: () => void;
  onScrollNearBottom?: () => void;

  // State
  sortField?: string;
  sortDirection?: SortDirection | null;
  selectedRowIds?: Set<string>;
  loading?: boolean;
  hasMore?: boolean;
  serverTotal?: number;

  // Song-focused rendering (specific to music domain)
  songRowRenderer?: "default" | "compact" | "detailed" | "album-header";
  enableCellEditing?: boolean;
  onCellEdit?: (item: T, field: string, newValue: any) => Promise<void>;
  onContextMenu?: (item: T, event: MouseEvent) => void;

  // Generic fallback for non-song data
  renderRow?: (
    item: T,
    index: number,
    defaultRender: () => JSX.Element,
  ) => JSX.Element;

  // Accessibility
  getRowId?: (item: T) => string;
  getRowLabel?: (item: T) => string;
}
```

#### Step 4: Component Implementation

**`InfiniteGrid.tsx` (Main Component)**

```tsx
export function InfiniteGrid<T>(props: InfiniteGridProps<T>) {
  const layout = useGridLayout();
  const grid = useInfiniteGrid({
    data: props.data,
    getItemId: props.getRowId,
    initialSort: props.sortField
      ? {
          field: props.sortField,
          direction: props.sortDirection || "asc",
        }
      : undefined,
  });

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
  });

  // custom row renderer with fallback to default
  const renderRow = (item: T, index: number) => {
    const defaultRender = () => (
      <VirtualizedRow
        item={item}
        index={index}
        columns={props.columns}
        rowHeight={props.virtualization?.rowHeight || 50}
        isSelected={grid.isSelected(grid.getItemId(item))}
        onClick={props.onRowClick}
        onDoubleClick={props.onRowDoubleClick}
        renderCell={props.renderCell}
        class="bg-black bg-opacity-90 hover:bg-opacity-70"
      />
    );

    return props.renderRow
      ? props.renderRow(item, index, defaultRender)
      : defaultRender();
  };

  // simple, clean JSX structure
  return (
    <div
      class={`h-full flex flex-col bg-black text-white ${props.className || ""}`}
    >
      <GridHeader
        columns={props.columns}
        sortField={grid.sortConfig().field}
        sortDirection={grid.sortConfig().direction}
        onSort={grid.handleSort}
        class="bg-black bg-opacity-90"
      />

      <div
        ref={layout.containerRef}
        class="flex-1 overflow-auto"
        onScroll={layout.handleScroll}
      >
        <div
          style={`height: ${virtualization.totalContentHeight()}px; position: relative;`}
        >
          <For each={visibleItems()}>
            {(item, index) => (
              <VirtualizedRow
                item={item.data}
                index={item.index}
                columns={props.columns}
                rowHeight={props.virtualization?.rowHeight || 50}
                isSelected={grid.isSelected(grid.getItemId(item.data))}
                onClick={props.onRowClick}
                onDoubleClick={props.onRowDoubleClick}
                onContextMenu={props.onContextMenu}
                renderCell={props.renderCell}
                class="bg-black bg-opacity-90 hover:bg-opacity-70"
              />
            )}
          </For>
        </div>
      </div>

      <Show when={props.layout?.showStatusBar}>
        <GridStatusBar
          totalItems={props.serverTotal || props.data.length}
          visibleItems={props.data.length}
          selectedCount={grid.selectedItems().size}
          loading={props.loading}
          hasMore={props.hasMore}
          class="text-gray-400"
        />
      </Show>
    </div>
  );
}
```

#### Step 5: Song-Focused Row Rendering Design

**Core Philosophy:**

- optimize for song data display (covers 90% of use cases)
- provide escape hatch for custom rendering (covers edge cases)
- support inline editing for admin workflows
- maintain performance with virtual scrolling

**`SongRow.tsx` (Song-Specific Component):**

```tsx
export interface SongRowProps {
  song: Song;
  index: number;
  columns: GridColumn<Song>[];
  variant: "default" | "compact" | "detailed" | "album-header";
  isSelected: boolean;
  isFocused: boolean;
  editingCell?: string;
  onCellEdit?: (field: string, value: any) => void;
  onEditStart?: (field: string) => void;
  onEditCancel?: () => void;
  onClick?: (event: MouseEvent) => void;
  onDoubleClick?: () => void;
  onContextMenu?: (event: MouseEvent) => void;
}

export function SongRow(props: SongRowProps) {
  // variant-specific column filtering
  const visibleColumns = createMemo(() => {
    switch (props.variant) {
      case "compact":
        return props.columns.filter((col) =>
          ["thumbnail", "title", "artist", "duration"].includes(col.key),
        );
      case "detailed":
        return props.columns; // show all columns
      case "album-header":
        return [{ key: "album", title: "album", render: renderAlbumHeader }];
      default:
        return props.columns.filter(
          (col) => !["bpm", "key_signature", "file_format"].includes(col.key),
        );
    }
  });

  // render individual cell with edit support
  const renderCell = (column: GridColumn<Song>) => {
    const value = (props.song as any)[column.key];
    const isEditing = props.editingCell === column.key;

    if (isEditing && column.editable) {
      return (
        column.renderEditCell?.(
          props.song,
          value,
          (newValue) => props.onCellEdit?.(column.key, newValue),
          () => props.onEditCancel?.(),
        ) || (
          <input
            class="bg-black text-white px-2 py-1 text-sm border border-magenta-500"
            value={value || ""}
            onBlur={() => props.onEditCancel?.()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                props.onCellEdit?.(column.key, e.currentTarget.value);
              } else if (e.key === "Escape") {
                props.onEditCancel?.();
              }
            }}
            autofocus
          />
        )
      );
    }

    // use custom renderer if provided
    if (column.render) {
      return column.render(props.song, props.index);
    }

    // default cell content
    return (
      <div
        class={`px-3 py-2 text-sm ${column.editable ? "cursor-pointer" : ""}`}
        onDblClick={() => column.editable && props.onEditStart?.(column.key)}
      >
        {formatCellValue(column.key, value)}
      </div>
    );
  };

  return (
    <div
      class={`absolute inset-x-0 flex items-center transition-colors ${
        props.isSelected
          ? "bg-magenta-500 bg-opacity-30 shadow-[inset_0_0_0_2px_rgb(217,70,239)]"
          : "bg-black bg-opacity-90 hover:bg-opacity-70"
      } ${props.isFocused ? "shadow-[inset_0_0_0_1px_white]" : ""}`}
      style={{
        height: "64px",
        transform: `translateY(${props.index * 64}px)`,
      }}
      onClick={props.onClick}
      onDblClick={props.onDoubleClick}
      onContextMenu={props.onContextMenu}
      tabIndex={0}
    >
      <For each={visibleColumns()}>{(column) => renderCell(column)}</For>
    </div>
  );
}

// utility for formatting cell values
function formatCellValue(key: string, value: any): string {
  switch (key) {
    case "duration_seconds":
      return formatDuration(value);
    case "created_at":
      return formatDate(value);
    case "file_size":
      return formatFileSize(value);
    case "rating":
      return "★".repeat(value || 0);
    default:
      return value?.toString() || "";
  }
}
```

#### Step 6: VirtualizedRow Implementation

**`VirtualizedRow.tsx`:**

```tsx
export interface VirtualizedRowProps<T> {
  item: T;
  index: number;
  columns: GridColumn<T>[];
  rowHeight: number;
  isSelected: boolean;
  onClick?: (item: T, index: number, event: MouseEvent) => void;
  onDoubleClick?: (item: T, index: number) => void;
  onContextMenu?: (
    item: T,
    index: number,
    event: MouseEvent,
    cellContext?: {
      column: GridColumn<T>;
      value: any;
      canEdit: boolean;
      cellActions?: string[];
    },
  ) => void;
  renderCell?: (item: T, column: GridColumn<T>, value: any) => JSX.Element;
  class?: string;
}

export function VirtualizedRow<T>(props: VirtualizedRowProps<T>) {
  // handle context menu with cell context
  const handleContextMenu = (event: MouseEvent, column?: GridColumn<T>) => {
    if (!props.onContextMenu) return;

    let cellContext;
    if (column) {
      const value = (props.item as any)[column.key];
      cellContext = {
        column,
        value,
        canEdit: column.editable || false,
        cellActions: getCellActions(column.key, value),
      };
    }

    props.onContextMenu(props.item, props.index, event, cellContext);
  };

  // get cell-specific actions based on column type
  const getCellActions = (columnKey: string, value: any): string[] => {
    const actions: string[] = [];

    switch (columnKey) {
      case "thumbnail":
        actions.push("view artwork", "upload artwork");
        break;
      case "title":
        actions.push("edit title", "search lyrics");
        break;
      case "artist":
        actions.push("edit artist", "view artist page");
        break;
      case "rating":
        actions.push("rate 1", "rate 2", "rate 3", "rate 4", "rate 5");
        break;
      case "is_favorite":
        actions.push(value ? "remove favorite" : "add favorite");
        break;
    }

    return actions;
  };

  // default cell renderer
  const renderCell = (column: GridColumn<T>) => {
    const value = (props.item as any)[column.key];

    // use custom cell renderer if provided
    if (props.renderCell) {
      return props.renderCell(props.item, column, value);
    }

    // use column's custom renderer
    if (column.render) {
      return column.render(props.item, props.index);
    }

    // default text rendering with cell-specific context menu
    return (
      <div
        class={`${column.cellClassName || ""} px-3 py-2 text-sm overflow-hidden text-ellipsis whitespace-nowrap`}
        onContextMenu={(e) => handleContextMenu(e, column)}
        onClick={(e) => e.stopPropagation()} // prevent row click when clicking cell
      >
        {value?.toString() || ""}
      </div>
    );
  };

  return (
    <div
      class={`absolute inset-x-0 flex items-center ${
        props.isSelected
          ? "bg-magenta-500 bg-opacity-30 shadow-[inset_0_0_0_2px_rgb(217,70,239)]"
          : "bg-black bg-opacity-90 hover:bg-opacity-70"
      } ${props.class || ""}`}
      style={{
        height: `${props.rowHeight}px`,
        transform: `translateY(${props.index * props.rowHeight}px)`,
      }}
      onClick={(e) => props.onClick?.(props.item, props.index, e)}
      onDblClick={() => props.onDoubleClick?.(props.item, props.index)}
      onContextMenu={(e) => handleContextMenu(e)}
    >
      <For each={props.columns}>
        {(column) => (
          <div
            class="flex-shrink-0"
            style={{
              width:
                typeof column.width === "number"
                  ? `${column.width}px`
                  : column.width || "auto",
              minWidth: column.minWidth ? `${column.minWidth}px` : undefined,
              maxWidth: column.maxWidth ? `${column.maxWidth}px` : undefined,
            }}
          >
            {renderCell(column)}
          </div>
        )}
      </For>
    </div>
  );
}
```

#### Step 6: Event Propagation Patterns

**Core Philosophy:**

- use standard browser event propagation
- leverage event.stopPropagation() and event.preventDefault() strategically
- let focused inputs handle their own events naturally
- grid-level shortcuts only work when not editing

**Example Event Flow:**

```tsx
// EditableCell.tsx
export function EditableCell(props: EditableCellProps) {
  return (
    <input
      class="bg-black text-white px-2 py-1"
      value={props.value}
      onKeyDown={(e) => {
        // cell editing takes precedence - no stopPropagation needed
        // browser naturally focuses input, grid shortcuts won't fire
        if (e.key === "Enter") {
          props.onSave(e.currentTarget.value);
        } else if (e.key === "Escape") {
          props.onCancel();
        }
        // ctrl+a naturally selects text in input
      }}
      onBlur={() => props.onCancel()}
      autofocus
    />
  );
}

// Grid container handles global shortcuts
<div
  class="h-full flex flex-col"
  tabIndex={0}
  onKeyDown={(e) => {
    // only handle when no input is focused
    if (document.activeElement?.tagName === "INPUT") return;

    if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      selectAllRows();
    }
  }}
>
```

**Key Patterns:**

- **Natural Focus**: browser manages focus automatically
- **Input Priority**: focused inputs get events first
- **Strategic stopPropagation**: only use for cell clicks to prevent row selection
- **Grid-level Check**: check document.activeElement before handling shortcuts

#### Step 7: GridStatusBar Implementation

**`GridStatusBar.tsx`:**

```tsx
export interface GridStatusBarProps {
  totalItems: number;
  visibleItems: number;
  selectedCount: number;
  loading?: boolean;
  hasMore?: boolean;
  class?: string;
}

export function GridStatusBar(props: GridStatusBarProps) {
  return (
    <div
      class={`flex items-center justify-between px-3 py-2 text-xs bg-black bg-opacity-90 ${props.class || ""}`}
    >
      <div class="flex items-center space-x-4">
        <span>
          showing {props.visibleItems} of {props.totalItems} items
        </span>

        <Show when={props.selectedCount > 0}>
          <span class="text-magenta-400">{props.selectedCount} selected</span>
        </Show>
      </div>

      <div class="flex items-center space-x-2">
        <Show when={props.loading}>
          <div class="flex items-center space-x-2">
            <div class="w-3 h-3 border border-magenta-500 border-t-transparent animate-spin"></div>
            <span>loading more...</span>
          </div>
        </Show>

        <Show when={!props.loading && props.hasMore}>
          <span class="text-gray-500">scroll for more</span>
        </Show>

        <Show when={!props.loading && !props.hasMore}>
          <span class="text-gray-600">end of list</span>
        </Show>
      </div>
    </div>
  );
}
```

### Phase 3: Migration Strategy

#### Step 1: Create New Implementation

1. Implement new hook architecture in `components/infinite-data-grid/hooks/`
2. Create modular components (InfiniteGrid, GridHeader, VirtualizedRow)
3. Implement CSS-first layout with flexbox
4. Add comprehensive TypeScript types

#### Step 2: Update AdminDataGrid

1. Change import from `web-components/generic-infinite-grid` to `components/infinite-data-grid`
2. Update props interface to match new API
3. Test scrolling to ensure last rows are visible
4. Verify selection highlighting works correctly

#### Step 3: Remove Old Implementation

1. Delete `web-components/generic-infinite-grid.tsx`
2. Update any other imports (none expected)
3. Clean up unused types/utilities

#### Step 4: Future Freqhole Integration

1. Freqhole can adopt new grid when ready
2. Grid supports both admin use cases and player use cases
3. Extension points for domain-specific features

#### Step 5: Dark Theme Styling Guidelines

**Core Color Palette:**

```typescript
// colors/dark-theme.ts
export const DARK_THEME = {
  background: "bg-black",
  text: "text-white",
  textSecondary: "text-gray-400",
  textMuted: "text-gray-600",
  accent: "text-magenta-500",
  accentBg: "bg-magenta-500",
  transparent90: "bg-black bg-opacity-90",
  transparent70: "bg-black bg-opacity-70",
  hover: "hover:bg-black hover:bg-opacity-70",
  selected: "bg-magenta-500 bg-opacity-30",
  selectedBorder: "shadow-[inset_0_0_0_2px_rgb(217,70,239)]",
} as const;
```

**Tailwind Class Patterns:**

```typescript
// grid row styling
const rowClasses = "bg-black bg-opacity-90 hover:bg-opacity-70 text-white";
const selectedRowClasses =
  "bg-magenta-500 bg-opacity-30 shadow-[inset_0_0_0_2px_rgb(217,70,239)]";
const headerClasses = "bg-black bg-opacity-90 text-white sticky top-0";
const cellClasses =
  "px-3 py-2 text-sm overflow-hidden text-ellipsis whitespace-nowrap";
```

**Key Styling Rules:**

- no borders (`border-0` or omit border classes)
- no rounded corners (`rounded-none` or omit rounded classes)
- use only black, white, gray, and magenta colors
- prefer transparency over solid backgrounds
- use shadow for selection instead of borders

### Phase 4: Testing Strategy

#### Critical Test Cases

1. **Scrolling to End**: must be able to scroll to see all rows
2. **Dynamic Height**: grid adapts when admin header expands/contracts
3. **Selection State**: row selection styling works correctly
4. **Virtual Performance**: smooth scrolling with large datasets
5. **Sort Cycling**: three-state sort (asc → desc → null) works correctly
6. **Infinite Loading**: scroll near bottom triggers onScrollNearBottom callback
7. **Song Row Variants**: different row styles (compact, detailed, album-header) work correctly
8. **Cell Editing**: double-click cells to edit values inline
9. **Keyboard Navigation**: arrow keys, enter, escape work correctly
10. **Row Selection**: shift-click ranges, ctrl-click toggle, focus indicators
11. **Event Propagation**: editing cells properly isolates keyboard events

#### Performance Requirements

- smooth scrolling with 1000+ rows
- no layout thrashing on resize
- minimal re-renders during scroll
- memory efficient virtual window

### Phase 5: Future Enhancements

#### Missing Core Features (Add to Implementation)

1. **Row Selection Logic**: multi-select with shift/ctrl, drag selection
2. **Keyboard Navigation**: arrow keys, enter, escape, tab navigation
3. **Context Menu Support**: right-click actions on rows and cells
4. **Cell Edit Mode**: double-click to edit cell values inline
5. **Focus Management**: proper focus indicators and tab order
6. **Event Delegation**: proper event propagation for editing vs grid shortcuts

#### Possible Extensions (Not in Initial Scope)

1. **Column Resizing**: drag column borders to resize
2. **Column Reordering**: drag & drop column headers
3. **Row Grouping**: hierarchical data display
4. **Accessibility**: full ARIA support

#### Extension Points

- custom row renderers
- custom header components
- plugin architecture for domain-specific features
- theme system for different visual styles

## Success Criteria

1. **Functional**: can scroll to see all rows without viewport issues
2. **Responsive**: grid height adapts to dynamic header changes
3. **Performant**: smooth scrolling with large datasets
4. **Maintainable**: clear separation of concerns, <500 lines per file
5. **Reusable**: both admin and freqhole can use the same grid
6. **Type Safe**: comprehensive typescript coverage
7. **Accessible**: proper keyboard and screen reader support

## TAILWIND CONFIGURATION BUG - CRITICAL ISSUE

### Problem Description

There is a critical bug where Tailwind CSS styles are inconsistent between the Vite dev server and the static web-component build. This causes major issues:

**Vite Dev Server Issues:**

- Basic Tailwind classes like `bg-red-500`, `border-yellow-400` don't work (fall back to browser defaults)
- Rows show white borders instead of styled borders
- Extra spacing between rows
- Overall styling appears broken

**Static Web-Component Build:**

- Tailwind classes work correctly
- Proper styling and spacing
- Rows render correctly on initial load

### Root Cause

The issue stems from Vite's `root: "src/views/freqhole-music-admin"` configuration conflicting with Tailwind's content detection paths. When Vite runs from a subdirectory, the Tailwind content paths in `tailwind.config.js` become incorrect relative to the new working directory.

### Attempted Solutions (ALL FAILED)

1. **Added relative paths to tailwind.config.js:** `"../../**/*.{js,jsx,ts,tsx}"`
2. **Added explicit component paths:** `"../../components/**/*.{js,jsx,ts,tsx}"`
3. **Created separate tailwind.config.js** in the Vite root directory
4. **Updated Vite config** to use explicit Tailwind config path
5. **Added current directory patterns:** `"./**/*.{js,jsx,ts,tsx}"`

None of these approaches resolved the issue. The Tailwind content detection is fundamentally broken when Vite uses a subdirectory as root.

### Other Issues Discovered and Fixed

- **Body overflow:hidden** in `styles.css` was preventing scrolling (FIXED)
- **Sorting reactivity bug** in useInfiniteGrid hook prevented rows from rendering on initial load (FIXED by moving sort logic directly into component)

### Current Status

- Initial row rendering: ✅ FIXED (both environments)
- Scrolling: ✅ FIXED (both environments)
- Tailwind styling: ❌ BROKEN (Vite dev server only)

The Tailwind bug is blocking development workflow as the dev server doesn't show proper styling.

## Implementation Timeline

- **Phase 1**: architecture design and planning (complete)
- **Phase 2**: hook implementation and core logic (2-3 hours)
- **Phase 3**: component implementation and styling (2-3 hours)
- **Phase 4**: integration with AdminDataGrid (1 hour)
- **Phase 5**: testing and bug fixes (1-2 hours)

total estimated effort: 6-9 hours of focused development time.
