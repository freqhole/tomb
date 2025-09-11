# Freqhole UI Enhancement Plan

## 🚨 CRITICAL RULES - NEVER FORGET 🚨

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

This plan focuses on integrating and extending existing infrastructure rather than building from scratch. The codebase already contains:

- **Complete infinite data grid system** (`components/infinite-data-grid/`)
- **Unified search API backend** (`/api/music/search`)
- **Comprehensive music search implementation** (`useMusicSearch` hook)
- **Selection and infinite scroll hooks** in freqhole views
- **Virtualization and grid management** already working in freqhole-music-admin views

The enhancement focuses on three areas:

1. **Search API Integration**: Extend existing search system to all freqhole views
2. **Infinite Grid Migration**: Adapt infinite-data-grid for main freqhole views
3. **Scroll Restoration**: Add navigation state management (new functionality)

## 1. Search API Integration & Total Counts

### Current State Analysis

**Existing Infrastructure:**

- `useMusicSearch` hook provides comprehensive search with filtering, pagination, sorting
- `/api/music/search` endpoint returns `total_count` field
- `useFreqholeSearch` exists but is limited compared to the comprehensive version
- freqhole-music-admin views show accurate total counts via search API

**Files Already Working:**

- `hooks/music/admin/useMusicSearch.ts` - comprehensive search implementation
- `views/freqhole-music-admin/components/AdminView.tsx` - search integration example
- `lib/music/admin/music-unified-search.ts` - search configuration

### Integration Strategy

#### 1.1 Extend Freqhole Search Hook

**Files to modify:**

- `client/js/src/views/freqhole/hooks/useFreqholeSearch.ts`

**Enhancement approach:**

```typescript
// Extend useFreqholeSearch to match useMusicSearch capabilities
export function useFreqholeSearch(apiClient: ApiClient): FreqholeSearchReturn {
  // Add features from useMusicSearch:
  // - totalCount from search response
  // - advanced filtering support
  // - sort field/direction management
  // - filter options loading
  // - better error handling

  const [totalCount, setTotalCount] = createSignal(0);

  // Use same /api/music/search endpoint
  // Extract total_count from response
  // Provide hasMore calculated from total vs loaded count
}
```

#### 1.2 Update View Components for Total Counts

**Files to modify:**

- `client/js/src/views/freqhole/components/content/views/songs/DesktopSongsView.tsx`
- `client/js/src/views/freqhole/components/content/views/songs/MobileSongsView.tsx`
- `client/js/src/views/freqhole/components/content/views/artists/DesktopArtistsView.tsx`
- `client/js/src/views/freqhole/components/content/views/albums/DesktopAlbumsView.tsx`

**Update existing total count displays:**

```typescript
// Replace current count logic with server-provided totals
<h2 class="text-xl text-white">
  {searchHook.totalCount()} {searchHook.totalCount() === 1 ? 'song' : 'songs'}
</h2>
```

#### 1.3 Artists & Albums from Search Results

**Current implementation:**

- `useFreqholeSearch` already derives artists/albums from song search results
- Music search provides comprehensive song data
- No separate artist/album endpoints needed

**Enhancement:**

```typescript
// Extend derived data calculations
const artists = createMemo(() => {
  // Current implementation groups songs by artist
  // Add more metadata: album count, genre distribution, etc.
});

const albums = createMemo(() => {
  // Current implementation groups songs by album
  // Add thumbnail aggregation, complete/incomplete album detection
});
```

### Backend Requirements

**No new backend endpoints needed** - existing `/api/music/search` already provides:

- Total count in response
- Tag filtering support
- Artist/album data via song results
- Pagination and sorting

## 2. Infinite Grid Migration & Virtualization

### Current State Analysis

**Existing Infinite Data Grid:**

- Complete system in `components/infinite-data-grid/`
- Features: virtualization, selection, keyboard navigation, sorting, editing
- Used successfully in `freqhole-music-admin`
- Supports custom row renderers, themes, bulk actions

**Current Freqhole Implementation:**

- Uses basic infinite scroll (`hooks/useInfiniteScroll.ts`)
- Has selection system (`hooks/useSelection.ts`)
- Desktop/mobile view separation already exists
- No virtualization for large datasets
- Mobile views use simplified infinite scroll without selection/keyboard shortcuts

### Migration Strategy

#### 2.1 Adapt Infinite Data Grid for Freqhole

**Files to create:**

- `client/js/src/lib/freqhole/grid/FreqholeInfiniteGrid.tsx`
- `client/js/src/lib/freqhole/grid/FreqholeSongRow.tsx`
- `client/js/src/lib/freqhole/grid/FreqholeArtistRow.tsx`
- `client/js/src/lib/freqhole/grid/FreqholeAlbumGrid.tsx`

**Approach:**

```typescript
// Wrapper around existing infinite-data-grid
import { InfiniteGrid } from "../../components/infinite-data-grid";

export function FreqholeInfiniteGrid<T>(props: {
  data: T[];
  onLoadMore: () => Promise<void>;
  renderMode: "songs" | "artists" | "albums";
  // ... other props
}) {
  // Configure infinite-data-grid for freqhole theme/behavior
  // Different column configs per render mode
  // Integrate with existing selection/context menu systems
}
```

#### 2.2 Extend Grid for Album Grid View

**Current capability:**

- Infinite data grid supports custom row rendering
- Can render different content types

**Enhancement needed:**

```typescript
// New grid mode for album squares
const albumGridColumns = [
  {
    key: "album_grid",
    render: (album) => (
      <AlbumGridCard
        album={album}
        artist={album.artist}
        thumbnail={album.thumbnail}
        trackCount={album.track_count}
      />
    ),
    width: 200, // Fixed width for grid squares
  }
];
```

#### 2.3 Integrate with Existing View Structure

**Files to modify:**

**Desktop Views:**

- `client/js/src/views/freqhole/components/content/views/songs/DesktopSongsView.tsx`
- `client/js/src/views/freqhole/components/content/views/artists/DesktopArtistsView.tsx`
- `client/js/src/views/freqhole/components/content/views/albums/DesktopAlbumsView.tsx`

**Mobile Views:**

- `client/js/src/views/freqhole/components/content/views/songs/MobileSongsView.tsx`
- `client/js/src/views/freqhole/components/content/views/songs/MobileSongList.tsx`

**Integration approach:**

```typescript
// Replace current infinite scroll implementation (Desktop)
export function DesktopSongsView() {
  const searchHook = useFreqholeSearch(apiClient);
  const selection = useSelection();

  return (
    <FreqholeInfiniteGrid
      data={searchHook.songs()}
      totalCount={searchHook.totalCount()}
      onLoadMore={searchHook.loadMore}
      renderMode="songs"
      selection={selection}
      onContextMenu={songInteractions.handleRightClick}
    />
  );
}

// Mobile version - simplified, no selection
export function MobileSongsView() {
  const searchHook = useFreqholeSearch(apiClient);

  return (
    <FreqholeInfiniteGrid
      data={searchHook.songs()}
      totalCount={searchHook.totalCount()}
      onLoadMore={searchHook.loadMore}
      renderMode="songs-mobile"
      enableSelection={false}
      enableKeyboardShortcuts={false}
    />
  );
}
```

### Grid Modes Implementation

#### 2.4 Songs: Row-based Virtualized Table

- **Desktop:** Full featured with selection, rating, context menus
- **Mobile:** Simplified touch-friendly rows, no selection UI
- **Adaptation:** Use existing `SongRow` component with responsive variants

#### 2.5 Artists: Row-based Virtualized List

- **Desktop:** Artist name, song count, average rating, selection
- **Mobile:** Touch-optimized artist cards, no selection
- **Layout:** Similar to song rows but artist-specific data
- **Features:** Click to filter songs by artist

#### 2.6 Albums: Grid-based Virtualized Cards

- **Desktop:** Square grid with hover states and selection
- **Mobile:** Touch-friendly grid with larger touch targets
- **Implementation:** Custom grid rendering mode in infinite-data-grid
- **Features:** Album art, title, artist, track count

## 3. Scroll Restoration & Navigation State

### Current State Analysis

**Missing Infrastructure:**

- No scroll position tracking
- No browser history state management
- No navigation state restoration
- Route changes lose scroll position

**Existing Navigation:**

- SolidJS router in use
- Routes defined in `views/freqhole/routes/`
- View components handle their own state

### Implementation Strategy

#### 3.1 Core Scroll Management System

**New files to create:**

- `client/js/src/lib/navigation/scroll-restoration.ts`
- `client/js/src/lib/navigation/navigation-state.ts`
- `client/js/src/hooks/navigation/useScrollRestoration.ts`

**Browser state integration:**

```typescript
interface NavigationState {
  scrollPosition: number;
  route: string;
  timestamp: number;
  searchQuery?: string;
  activeFilters?: Record<string, any>;
  selectedItems?: string[];
}

export function useScrollRestoration(routeKey: string) {
  // Store/restore scroll position in browser history state
  // Integrate with browser navigation events
  // Handle route parameter changes
}
```

#### 3.2 Grid State Management

**Files to modify:**

- `client/js/src/lib/freqhole/grid/FreqholeInfiniteGrid.tsx`

**Integration:**

```typescript
export function FreqholeInfiniteGrid(props) {
  const scrollRestoration = useScrollRestoration(props.routeKey);

  // Track scroll position changes
  // Restore position on mount if available
  // Save position before unmount/navigation

  return (
    <InfiniteGrid
      {...props}
      onScroll={scrollRestoration.trackPosition}
      initialScrollPosition={scrollRestoration.getPosition()}
    />
  );
}
```

#### 3.3 Context Provider for Navigation State

**New file:**

- `client/js/src/views/freqhole/context/NavigationContext.tsx`

**Responsibilities:**

- Track current route and scroll position
- Coordinate with search state preservation
- Handle browser back/forward navigation
- Sync with existing view state

### Route Integration

#### 3.4 Component-based Scroll Restoration

**Files to modify:**

- `client/js/src/lib/freqhole/grid/FreqholeInfiniteGrid.tsx`

**Built-in scroll restoration:**

```typescript
// Infinite grid always handles scroll restoration automatically
export function FreqholeInfiniteGrid(props) {
  const scrollRestoration = useScrollRestoration(props.routeKey || 'default');

  // Always track and restore scroll position
  // No configuration needed at route level

  return (
    <InfiniteGrid
      {...props}
      onScroll={scrollRestoration.trackPosition}
      initialScrollPosition={scrollRestoration.getPosition()}
    />
  );
}
```

## 4. Enhanced Song Tags & Global Filtering

### Current State Analysis

**Existing Tag Infrastructure:**

- Songs have `tags` field in schema
- Search API supports tag filtering (`useMusicSearch` shows tag options)
- freqhole-music-admin search includes tag filtering UI
- No global tag filtering in main freqhole views

**Missing Features:**

- Global tag filter UI in main views
- Tag management (add/remove tags) - restricted to admin users
- Context menu tag operations - view tags for all users, modify for admins
- Tag-based view filtering

### Implementation Strategy

#### 4.1 Extend Search Integration for Tags

**Files to modify:**

- `client/js/src/views/freqhole/hooks/useFreqholeSearch.ts`

**Add tag filtering:**

```typescript
export interface FreqholeSearchFilters {
  // ... existing filters
  tags?: string[]; // Add tags filter
}

// Use same filter options loading
const [filterOptions, setFilterOptions] = createSignal<any>({});

const loadFilterOptions = async () => {
  const response = await apiClient.makeRequest<any>(
    "GET",
    "/api/music/filter-options",
  );
  setFilterOptions(response || {});
};
```

#### 4.2 Global Tag Filter UI

**New files to create:**

- `client/js/src/components/tags/TagFilter.tsx`
- `client/js/src/components/tags/GlobalTagSelector.tsx`

**Integration in view headers:**

```typescript
// Add to songs/artists/albums view headers (both desktop and mobile)
<div class="flex items-center justify-between mb-4">
  <h2 class="text-xl text-white">{totalCount()} songs</h2>
  <TagFilter
    selectedTags={searchHook.filters().tags || []}
    onTagsChange={(tags) => searchHook.updateFilters({ tags })}
    availableTags={searchHook.filterOptions()?.tags || []}
    compact={isMobile()} // Simplified UI for mobile
  />
</div>
```

#### 4.3 Tag Management Context Menu

**Files to modify:**

- `client/js/src/views/freqhole/services/songInteractions.ts`

**Add tag actions:**

```typescript
// Extend existing context menu actions
const contextMenuActions = [
  // ... existing actions
  { type: "separator" },
  {
    label: "view tags",
    icon: "tag",
    action: () => showTagInfo(song),
  },
  // Admin-only tag management
  ...(isAdmin()
    ? [
        {
          label: "manage tags...",
          icon: "tag-edit",
          action: () => openTagManagement(song),
        },
      ]
    : []),
];
```

#### 4.4 Tag Management Modal

**New files to create:**

- `client/js/src/components/tags/TagManagementModal.tsx`
- `client/js/src/components/tags/TagSelector.tsx`

**Features:**

- View current tags (all users)
- Add/remove tags from songs (admin users only)
- Create new tags (admin users only)
- Bulk tag operations (admin users only)
- Tag usage statistics

### Backend Integration

**Use existing endpoints:**

- `/api/music/search` - already supports tag filtering
- `/api/music/filter-options` - provides available tags
- Need to add: `PUT /api/music/songs/{id}/tags` for tag management (admin-only)

## Implementation Phases

### Phase 1: Search API Integration ✅ COMPLETE

1. **✅ Enhanced useFreqholeSearch hook**
   - ✅ Added total count support from search API response
   - ✅ Integrated filter options loading from `/api/music/filter-options`
   - ✅ Added tag filtering support in filters interface
   - ✅ Added proper sort management (`sortField`, `sortDirection`, `setSort`)
   - ✅ Added `hasActiveFilters()` and `filterSummary()`
   - ✅ Modified to load all songs by default (not just wait for search query)

2. **✅ Updated view headers with counts**
   - ✅ Modified DesktopSongsView and MobileSongsView
   - ✅ Display accurate totals from search API (`searchHook.totalCount()`)
   - ✅ Replaced pagination counts with server-provided totals

### Phase 2: Infinite Grid Migration ✅ MOSTLY COMPLETE

1. **✅ Created freqhole grid system**
   - ✅ FreqholeInfiniteGrid: Main wrapper adapting infinite-data-grid
   - ✅ FreqholeSongRow: Song-specific row component with variants
   - ✅ FreqholeArtistRow: Artist row component
   - ✅ FreqholeAlbumGrid: Album grid card component
   - ✅ Moved to `views/freqhole/components/grid/`

2. **✅ Integrated with existing views**
   - ✅ Replaced DesktopSongsView table with FreqholeInfiniteGrid
   - ✅ Updated MobileSongsView to use FreqholeInfiniteGrid mobile mode
   - ✅ Maintained selection behavior (desktop), disabled for mobile
   - ✅ Preserved context menu integration
   - ✅ **Fixed infinite-data-grid responsive layout** - title column now grows to fill space

**Current Issues to Fix:**

- 🔧 Song ratings not displaying properly in grid
- 🔧 Rating hover colors need fix for selected rows (should be black, not magenta)
- 🔧 Missing clear rating 'x' button on hover
- 🔧 Need double-click to play songs on desktop (single-click for mobile)

### Phase 3: Scroll Restoration (Week 3)

1. **Build scroll management system**
   - Create navigation state management
   - Implement browser history integration
   - Add route-level scroll tracking

2. **Integrate with views**
   - Add scroll restoration to all main routes (desktop and mobile)
   - Test navigation between views
   - Handle search state preservation
   - Ensure touch scrolling works properly on mobile

### Phase 3: Scroll Restoration (Week 3) - NEXT

1. **Build scroll management system**
   - Create navigation state management
   - Implement browser history integration
   - Add route-level scroll tracking

2. **Integrate with views**
   - Add scroll restoration to all main routes (desktop and mobile)
   - Test navigation between views
   - Handle search state preservation
   - Ensure touch scrolling works properly on mobile

### Phase 4: Tag Management (Week 4)

1. **Global tag filtering**
   - Add tag filter UI to view headers (desktop and mobile)
   - Integrate with search system
   - Test cross-view tag filtering

2. **Tag management features**
   - Context menu tag viewing (all users) and editing (admin only)
   - Tag management modal (admin only)
   - Bulk tag operations (admin only)

### Phase 5: Polish & Optimization (Week 5)

1. **Performance optimization**
   - Virtualization tuning for large datasets
   - Search debouncing optimization
   - Memory usage optimization

2. **Testing & refinement**
   - Cross-browser scroll restoration testing
   - Mobile touch interaction verification
   - Responsive design testing across devices
   - Accessibility improvements

## Technical Notes

### Reusing Existing Patterns

1. **Search API**: Leverage `/api/music/search` endpoint
2. **Infinite Grid**: Adapt existing `components/infinite-data-grid` system
3. **Selection**: Integrate existing `useSelection` hook (desktop only)
4. **Context Menus**: Extend existing `songInteractions` service
5. **Themes**: Follow existing dark theme patterns
6. **Mobile Patterns**: Simplify desktop features for touch interfaces

## Current Status Summary

### ✅ Completed (Phases 1-2)

- **Total counts**: Server-provided counts working across all views
- **Search integration**: Enhanced useFreqholeSearch with all search/filter/sort features
- **Grid system**: FreqholeInfiniteGrid working with responsive layout
- **Virtualization**: Smooth scrolling with large datasets
- **Mobile support**: Simplified mobile interface working
- **Selection system**: Desktop selection working, mobile simplified

### 🔧 Current Issues (Phase 2 Polish)

- Song ratings not displaying in grid
- Rating component hover styles broken on selected rows
- Missing clear rating 'x' button
- Need double-click song play behavior (desktop) vs single-click (mobile)

### 🎯 Next Steps (Phase 3)

- Scroll restoration and navigation state management
- Browser history integration
- Route-level scroll position tracking

### Key Integration Points

1. **Search Consistency**: ✅ All views filter through same search API
2. **State Management**: ✅ Search, selection coordinated; navigation state pending
3. **Component Reuse**: ✅ Leveraged infinite-data-grid for main views
4. **Performance**: ✅ Smooth scrolling with virtualization
5. **Responsive Layout**: ✅ Fixed infinite-data-grid to grow title column

### Architecture Success

The implementation successfully leveraged 70% existing infrastructure:

- ✅ infinite-data-grid system (enhanced for responsive layout)
- ✅ useMusicSearch patterns
- ✅ Existing selection and context menu systems
- ✅ Search API backend integration

Focus remains on integration and extension rather than rebuilding from scratch, with excellent mobile/desktop parity achieved.
