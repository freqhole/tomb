# Infinite Data Grid Component System

A modern, performant infinite scrolling data grid built for dark theme UIs with SolidJS.

## Overview

This component system replaces the old `generic-infinite-grid` with a clean, modular architecture that follows these principles:

- **CSS-First Layout**: Uses flexbox for natural height adaptation instead of complex viewport calculations
- **Hook-Based Architecture**: Separates logic from presentation with composable hooks
- **Dark Theme Design**: Built for black/white/magenta color scheme with no borders or rounded corners
- **Type Safety**: Comprehensive TypeScript interfaces for all components
- **Performance**: Efficient virtual scrolling without over-engineering

## Components

### Core Components

- **`InfiniteGrid`** - Main grid component with virtualization and selection
- **`VirtualizedRow`** - Individual row component with editing support
- **`GridHeader`** - Sortable header with selection controls
- **`GridStatusBar`** - Status display with loading indicators

### Specialized Components

- **`SongRow`** - Music-optimized row renderer with variants (compact, detailed, album-header)

## Hooks

### Layout & Virtualization
- **`useGridLayout`** - Container sizing with ResizeObserver
- **`useVirtualization`** - Virtual scrolling calculations
- **`useInfiniteLoading`** - Scroll-to-load detection

### Interaction
- **`useRowSelection`** - Multi-select with keyboard support (shift/ctrl)
- **`useKeyboardNavigation`** - Arrow keys, enter, escape, page up/down
- **`useEventPropagation`** - Proper event delegation for editing vs grid shortcuts

### Data Management
- **`useInfiniteGrid`** - Core grid state and sorting logic

## Usage

### Basic Grid

```tsx
import { InfiniteGrid } from '../components/infinite-data-grid';

<InfiniteGrid
  data={items}
  columns={columns}
  virtualization={{ rowHeight: 50 }}
  layout={{ stickyHeader: true, showStatusBar: true }}
  onRowClick={handleRowClick}
  onScrollNearBottom={loadMore}
  getRowId={(item) => item.id}
/>
```

### Column Configuration

```tsx
const columns: GridColumn<Song>[] = [
  {
    key: "title",
    title: "song title",
    width: 250,
    sortable: true,
    editable: true,
    render: (song) => <div class="font-medium">{song.title}</div>
  },
  {
    key: "rating",
    title: "rating",
    width: 100,
    render: (song) => "★".repeat(song.rating || 0)
  }
];
```

### Advanced Features

```tsx
<InfiniteGrid
  data={songs}
  columns={columns}
  // Selection
  selectedRowIds={selectedIds}
  onSelectionChange={setSelectedIds}
  // Sorting
  sortField="created_at"
  sortDirection="desc"
  onSort={handleSort}
  // Infinite loading
  hasMore={hasMore}
  loading={loading}
  onScrollNearBottom={loadMore}
  // Cell editing
  enableCellEditing={true}
  onCellEdit={handleCellEdit}
  // Custom rendering
  renderRow={(item, index, defaultRender) =>
    item.isAlbumHeader ? <AlbumHeader /> : defaultRender()
  }
/>
```

## Architecture

### File Structure

```
components/infinite-data-grid/
├── index.ts                  # Public exports
├── InfiniteGrid.tsx         # Main component (~240 lines)
├── VirtualizedRow.tsx       # Row component (~270 lines)
├── GridHeader.tsx           # Header component (~120 lines)
├── GridStatusBar.tsx        # Status bar (~46 lines)
├── SongRow.tsx             # Music-specific row (~190 lines)
├── types.ts                # Type definitions (~160 lines)
├── hooks/
│   ├── useInfiniteGrid.ts  # Core logic (~100 lines)
│   ├── useVirtualization.ts # Virtual scrolling (~60 lines)
│   ├── useGridLayout.ts    # Layout management (~35 lines)
│   ├── useRowSelection.ts  # Selection logic (~80 lines)
│   ├── useKeyboardNavigation.ts # Keyboard support (~70 lines)
│   ├── useEventPropagation.ts # Event handling (~60 lines)
│   └── useInfiniteLoading.ts # Infinite scroll (~40 lines)
├── styles/
│   └── grid-styles.ts      # Tailwind utilities (~140 lines)
└── utils/
    └── grid-calculations.ts # Pure functions (~115 lines)
```

### Key Design Decisions

1. **Flexbox Layout**: Parent containers use `flex-1` instead of fixed heights
2. **Natural Scrolling**: Browser handles scroll container without complex calculations
3. **ResizeObserver**: Tracks actual container dimensions for accurate virtualization
4. **Event Delegation**: Focused inputs naturally get events first, grid shortcuts only when not editing
5. **Composition**: Small focused components that compose together

## Migration from GenericInfiniteGrid

### Interface Changes

```tsx
// Old
<GenericInfiniteGrid
  rowHeight={64}
  headerHeight={40}
  theme="dark"
  selectedRowIds={selected}
/>

// New
<InfiniteGrid
  virtualization={{ rowHeight: 64, headerHeight: 40 }}
  layout={{ stickyHeader: true }}
  selectedRowIds={selected}
/>
```

### Column Changes

```tsx
// Old
{
  key: "title",
  getValue: (song) => song.title || "",
  render: (song) => <div>{song.title}</div>
}

// New
{
  key: "title",
  sortable: true,
  editable: true,
  render: (song) => <div>{song.title}</div>
}
```

## Performance

- Smooth scrolling with 1000+ rows
- Memory efficient virtual window (only renders visible + buffer)
- No layout thrashing on resize
- Minimal re-renders during scroll

## Accessibility

- Proper ARIA roles (`grid`, `row`, `columnheader`, `gridcell`)
- Keyboard navigation (arrows, enter, escape, home, end, page up/down)
- Screen reader support with row selection announcements
- Focus management that respects edit mode

## Dark Theme

Uses consistent dark theme with tailwind classes:

```typescript
const DARK_THEME = {
  background: "bg-black",
  text: "text-white",
  accent: "text-magenta-500",
  selected: "bg-magenta-500 bg-opacity-30",
  selectedBorder: "shadow-[inset_0_0_0_2px_rgb(217,70,239)]",
  // No borders, no rounded corners
}
```

## Example: Music Admin Grid

See `views/freqhole-music-admin/components/AdminDataGrid.tsx` for a complete implementation showing:

- Song-specific column rendering (thumbnail, title/artist, duration, rating, favorite)
- Star rating component with hover states
- Keyboard shortcuts (ctrl+a, delete, f for favorite, 1-5 for rating)
- Selection info bar with bulk actions
- Infinite loading with server pagination
- Custom date formatting and sorting logic
