# Scroll Restoration with Virtualized Rendering Plan

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

## overview

**problem**: Current scroll restoration tries to load all previous pages of data, which defeats the purpose of virtualization and creates poor user experience with loading delays.

**solution**: Build a smart virtualized scroll restoration system that restores scroll position with minimal data loading and leverages virtualization for seamless experience.

## current system problems

### over-engineered grid complexity

1. **duplicate grid systems**:
   - `components/infinite-data-grid/` - proper generic system
   - `web-components/generic-infinite-grid.tsx` - misplaced legacy system
   - `views/freqhole/components/grid/FreqholeInfiniteGrid.tsx` - wrapper layer

2. **complex scroll restoration**:
   - multiple hooks: `useScrollRestoration`, `useGridScrollRestoration`
   - manual pagination loops in view components
   - timing issues between search hook initialization and restoration
   - saves/restores page counts instead of leveraging virtualization

3. **architectural issues**:
   - `useFreqholeSearch` always resets to page 1 on mount
   - auto-save overwrites good saved state during initialization
   - no separation between data fetching and scroll position
   - missing virtualization awareness

## solution architecture

### core principle: minimal data, maximum virtualization

**key insight**: virtualized grids don't need all previous data loaded. they need:

1. total count for scrollbar sizing
2. current viewport data
3. smart loading as user scrolls

### step 1: consolidate grid systems

**remove legacy system**:

- move `web-components/generic-infinite-grid.tsx` to `components/infinite-data-grid/GenericInfiniteGrid.tsx`
- audit for missing features vs main `InfiniteGrid.tsx`
- consolidate into single, comprehensive grid system

**simplify freqhole wrapper**:

- `FreqholeInfiniteGrid` becomes thin wrapper, not complex middleware
- remove scroll restoration logic from grid wrapper
- grid focuses on rendering, not data management

**analyze existing freqhole views**:

- **songs view**: uses `FreqholeInfiniteGrid` + `useFreqholeSearch` (row-based table)
- **artists view**: uses custom `useInfiniteScroll` hook (row-based list)
- **albums view**: uses custom `useInfiniteScroll` hook (grid-based cards)
- **search results view**: uses `SearchContext` for results (mixed row/card rendering)
- **playlist detail view**: uses simple `For` loop (no virtualization yet)
- **queue view**: not implemented yet (future requirement)

### step 2: virtualization-aware scroll restoration

**new approach**: save scroll position + estimated item index, not page counts

```typescript
interface ScrollState {
  scrollTop: number;
  estimatedIndex: number; // which item was at top of viewport
  totalCount: number; // for scrollbar sizing
  itemHeight: number; // for position calculations
  timestamp: number;
}
```

**restoration flow**:

1. restore scroll position immediately using estimated index
2. load current viewport data (1 page around estimated position)
3. user scrolls naturally, virtualization handles loading

### step 3: smart data loading integration

**modify useFreqholeSearch**:

- add `loadAroundIndex(estimatedIndex)` method
- calculate which page contains that index
- load that page + buffer pages (prev/next)
- update total count for virtualization

**example**:

```typescript
// user was at item 127 (page 3 of 50-item pages)
// load page 3 + buffers (pages 2,3,4) = items 100-199
const targetPage = Math.floor(estimatedIndex / pageSize) + 1;
await loadPages([targetPage - 1, targetPage, targetPage + 1]);
```

### step 4: seamless virtualization integration

**enhanced infinite grid**:

- accepts `estimatedStartIndex` prop for restoration
- positions virtual window at estimated index
- loads data on-demand as user scrolls
- no difference between restored and fresh loads

**scroll position calculation**:

```typescript
// restore scroll based on item position, not pixel position
const estimatedScrollTop = estimatedIndex * itemHeight;
scrollElement.scrollTop = estimatedScrollTop;
```

## implementation plan

### phase 1: consolidate and simplify (week 1)

**1.1 audit and consolidate grid systems**

- [ ] move `web-components/generic-infinite-grid.tsx` to `components/infinite-data-grid/`
- [ ] compare features between `GenericInfiniteGrid` vs `InfiniteGrid`
- [ ] consolidate best features into single system
- [ ] update all imports across freqhole views

**1.2 simplify freqhole grid wrapper**

- [ ] remove scroll restoration from `FreqholeInfiniteGrid`
- [ ] make it pure column configuration wrapper
- [ ] move data loading concerns to view components

**1.3 enhance base infinite grid for all view types**

- [ ] support **row mode** (songs, artists, search results)
- [ ] support **card grid mode** (albums)
- [ ] support **mixed mode** (search results with sections)
- [ ] add `estimatedStartIndex` prop for restoration
- [ ] add `totalEstimatedCount` for scrollbar sizing
- [ ] remove setTimeout-based scroll debouncing (use native scroll throttling)

### phase 2: smart scroll restoration (week 1)

**2.1 new scroll state management**

```typescript
interface VirtualizedScrollState {
  scrollTop: number;
  estimatedIndex: number;
  totalCount: number;
  itemHeight: number;
  viewportStartIndex: number;
  viewportEndIndex: number;
  timestamp: number;
}
```

**2.2 enhanced scroll restoration hook**

```typescript
export function useVirtualizedScrollRestoration(options: {
  key: string;
  itemHeight: number;
  enabled?: boolean;
}) {
  // save scroll position + estimated item index
  // restore by positioning virtual window at estimated index
  // return estimated index for data loading
}
```

**2.3 integration with infinite grid**

- [ ] grid accepts restoration state
- [ ] positions virtual window correctly
- [ ] triggers data loading for current viewport

### phase 3: data loading integration (week 1)

**3.1 enhance useFreqholeSearch**

- [ ] add `loadAroundIndex(index, bufferPages?)` method
- [ ] prevent auto-load in `onMount` if restoration happening
- [ ] calculate target pages from estimated index

**3.2 view component integration**

```typescript
export function DesktopSongsView() {
  const scrollRestoration = useVirtualizedScrollRestoration({
    key: "desktop-songs",
    itemHeight: 64,
  });

  const searchHook = useFreqholeSearch(apiClient);

  onMount(async () => {
    if (scrollRestoration.hasSavedState()) {
      const estimatedIndex = scrollRestoration.estimatedIndex();
      await searchHook.loadAroundIndex(estimatedIndex, 1); // +/- 1 page buffer
    } else {
      await searchHook.performSearch(1, false); // normal initial load
    }
  });

  return (
    <FreqholeInfiniteGrid
      data={searchHook.songs()}
      estimatedStartIndex={scrollRestoration.estimatedIndex()}
      totalEstimatedCount={scrollRestoration.totalCount() || searchHook.totalCount()}
      onScroll={scrollRestoration.trackScroll}
      // ... other props
    />
  );
}
```

### phase 4: testing and polish (week 1)

**4.1 user experience testing**

- [ ] test deep scroll → navigate → return flow
- [ ] verify no loading delays on restoration
- [ ] ensure smooth scrolling with partial data

**4.2 edge case handling**

- [ ] handle totalCount changes between sessions
- [ ] handle item height changes (mobile/desktop)
- [ ] handle empty states and errors

**4.3 apply to all freqhole views**

- [ ] **songs views**: `DesktopSongsView`, `MobileSongsView` (row table mode)
- [ ] **artists views**: `DesktopArtistsView`, `MobileArtistsView` (row list mode)
- [ ] **albums views**: `DesktopAlbumsView`, `MobileAlbumsView` (card grid mode)
- [ ] **search results view**: `SearchResultsView` (mixed row/card sections)
- [ ] **playlist detail view**: `PlaylistDetailView` (row table mode with drag/drop)
- [ ] **queue view**: future implementation (row table mode with reordering)

**freqhole architecture analysis**

### complete view inventory

**primary content views** (routed via `HashRouter`):

1. **songs view**: `/songs` or `/` → `SongTableView` → `DesktopSongsView`/`MobileSongsView`
2. **artists view**: `/artists` → `ArtistSplitView` → `DesktopArtistsView`/`MobileArtistsView`
3. **albums view**: `/albums` → `AlbumGridView` → `DesktopAlbumsView`/`MobileAlbumsView`
4. **search results**: `/search` → `SearchResultsView` (unified desktop/mobile)
5. **playlist detail**: `/playlist/:id` → `PlaylistDetailView` (unified desktop/mobile)
6. **artist detail**: `/artist/:id` → `ArtistDetailView` (unified desktop/mobile)
7. **album detail**: `/album/:id` → `AlbumDetailView` (unified desktop/mobile)

**secondary views** (non-routed components):

8. **queue view**: `Queue` component in sidebar (not routed, state-driven)

### router configuration deep dive

**routing setup**:

- uses `HashRouter` from `@solidjs/router`
- routes defined in `routes/index.tsx`
- layout: `ThreeColumnLayout` wraps all content views
- navigation: hash-based (`#/songs`, `#/artists`, etc.)

**navigation integration**:

- `Navigation.tsx` listens for `nav:change` events from `useGlobalEvents`
- manual hash manipulation in some views: `window.location.hash = "#/albums"`
- `useLocation()`, `useNavigate()`, `useParams()` used throughout views
- current path tracked via `location.pathname` for active states

**scroll restoration router implications**:

- `useScrollRestoration` currently uses `location.pathname + location.search` for storage keys
- hash router means path changes trigger component remounts
- `useBeforeLeave` hook available but not fully utilized
- route parameters (`:id`) create dynamic storage keys

### view-specific technical analysis

**songs views** (`DesktopSongsView`, `MobileSongsView`):

- **mode**: row-based table with columns (title, artist, album, rating, etc.)
- **data source**: `useFreqholeSearch` hook with pagination
- **grid system**: uses `FreqholeInfiniteGrid` wrapper around `InfiniteGrid`
- **current features**: sorting, selection, rating, favorites, infinite scroll
- **scroll restoration**: partially implemented with `useScrollRestoration`
- **navigation**: routes to artist/album detail views
- **mobile differences**: simplified column layout, touch interactions

**artists views** (`DesktopArtistsView`, `MobileArtistsView`):

- **mode**: row-based list with artist name + song count
- **data source**: custom `useInfiniteScroll` hook calling `apiClient.getArtists()`
- **grid system**: custom implementation, no virtualization
- **current features**: selection, infinite scroll, navigation to artist detail
- **scroll restoration**: not implemented
- **navigation**: complex hash-based navigation to artist detail view
- **special behavior**: artist detail loads in same view, manages back navigation

**albums views** (`DesktopAlbumsView`, `MobileAlbumsView`):

- **mode**: card-based grid layout (responsive columns)
- **data source**: custom `useInfiniteScroll` hook calling `apiClient.getAlbums()`
- **grid system**: custom implementation with CSS grid, no virtualization
- **current features**: infinite scroll, album playback, navigation to detail
- **scroll restoration**: custom `useAlbumScrollPosition` utility
- **navigation**: uses `useNavigate()` for album detail, saves/restores scroll position

**search results view** (`SearchResultsView`):

- **mode**: mixed sections with tabs (all/songs/artists/albums)
- **data source**: `SearchContext` providing `useFreqholeSearch` results
- **grid system**: simple `For` loops, no virtualization
- **current features**: tabbed interface, different rendering per section
- **scroll restoration**: not implemented
- **navigation**: integrates with URL search params (`?q=query`)
- **special behavior**: single unified view for desktop/mobile

**playlist detail view** (`PlaylistDetailView`):

- **mode**: row-based table with drag/drop reordering
- **data source**: playlist-specific API calls
- **grid system**: simple `For` loop with manual drag/drop
- **current features**: drag/drop reordering, selection, song playback, editing
- **scroll restoration**: not implemented
- **navigation**: handles both existing playlists and new playlist creation
- **special behavior**: complex edit modes, file upload integration

**queue view** (`Queue`):

- **mode**: row-based list with current song highlighting
- **data source**: global queue state from `useQueue()` store
- **grid system**: simple `For` loop, no virtualization
- **current features**: remove from queue, current song indication
- **scroll restoration**: not implemented (sidebar component)
- **navigation**: not routed, managed by layout state
- **special behavior**: real-time updates, integrates with player events

**artist detail view** (`ArtistDetailView`):

- **mode**: complex layout with albums grid + songs table
- **data source**: artist-specific API calls based on URL params
- **grid system**: custom implementation, no virtualization
- **current features**: album navigation, song playback, selection
- **scroll restoration**: not implemented
- **navigation**: uses `useParams()` for artist identification

**album detail view** (`AlbumDetailView`):

- **mode**: album header + track listing table
- **data source**: album-specific API calls based on URL params
- **grid system**: simple track listing
- **current features**: track playback, album actions
- **scroll restoration**: not implemented
- **navigation**: custom back button with hash manipulation

### global event system integration

**event-driven architecture**:

- `useGlobalEvents` provides app-wide communication
- events: navigation (`nav:change`), player actions, queue management
- scroll restoration needs integration with navigation events
- route changes emit events that can trigger save/restore

**key events for scroll restoration**:

- `nav:change`: fired before route navigation
- `data:reload`: when view data refreshes
- player events: may affect queue view scroll position
- selection events: may need state preservation

### unified generic grid requirements

**rendering modes** (based on current implementations):

1. **table mode**: fixed columns, sortable headers
   - **uses**: songs view, playlist detail, queue view
   - **features**: sorting, selection, rating widgets, context menus
   - **columns**: configurable via `FreqholeInfiniteGrid` column system

2. **list mode**: flexible single column with metadata
   - **uses**: artists view
   - **features**: selection, navigation to detail
   - **layout**: artist name + song count, responsive

3. **card grid mode**: responsive CSS grid layout
   - **uses**: albums view, search album results
   - **features**: album artwork, metadata overlay, play actions
   - **layout**: responsive grid with aspect ratio preservation

4. **mixed mode**: tabbed sections with different rendering modes
   - **uses**: search results view
   - **features**: tab switching, unified search context
   - **sections**: songs (table), artists (list), albums (cards)

5. **specialized modes**: unique layout requirements
   - **artist detail**: albums grid + songs table combination
   - **album detail**: header + track listing
   - **queue**: minimalist list with current song highlighting

**interaction features** (comprehensive audit):

- **selection**: multi-select with shift/ctrl (songs, artists, playlists)
- **context menus**: right-click actions via `useGlobalEvents`
- **drag and drop**: playlist reordering, queue management
- **keyboard navigation**: arrows, enter, space for play/select
- **sorting**: column headers in table modes
- **rating**: star rating widgets with real-time updates
- **favorites**: heart toggle with immediate feedback

**data loading patterns** (current implementations):

- **infinite scroll**: `useInfiniteScroll` hook with pagination
- **search integration**: `useFreqholeSearch` with unified backend
- **real-time updates**: event-driven rating/favorite changes
- **bulk operations**: playlist management, queue operations
- **lazy loading**: detail views load on navigation

## router integration improvements

### current router issues

**hash router limitations**:

- hash changes trigger full component remounts
- `useBeforeLeave` not fully utilized for scroll state saving
- manual hash manipulation in some components creates inconsistency
- route parameter changes create different storage keys

**navigation event integration**:

- global events (`nav:change`) fired manually, not integrated with router
- scroll restoration storage keys depend on `location.pathname + location.search`
- no centralized navigation state management

**proposed router enhancements**:

**1. centralized navigation context**:

```typescript
interface NavigationState {
  currentView: string;
  previousView: string;
  navigationTimestamp: number;
  scrollStates: Map<string, ScrollState>;
}

export function NavigationProvider() {
  const location = useLocation();
  const navigate = useNavigate();

  // integrate with global events
  // manage scroll state automatically
  // provide unified navigation API
}
```

**2. router-aware scroll restoration**:

```typescript
export function useRouterScrollRestoration() {
  const location = useLocation();

  useBeforeLeave(() => {
    // save scroll state for current route
    saveScrollState(location.pathname, getCurrentScrollState());
    return true;
  });

  createEffect(() => {
    // restore scroll state for new route
    const savedState = loadScrollState(location.pathname);
    if (savedState) {
      restoreScrollState(savedState);
    }
  });
}
```

**3. improved navigation consistency**:

- eliminate manual hash manipulation
- standardize navigation through `useNavigate()`
- integrate global events with router hooks
- provide typed route parameters

## technical details - setTimeout/RAF minimization

### current setTimeout/RAF usage audit

**comprehensive inventory**:

1. **UI positioning** (legitimate - keep):
   - `ContextMenu.tsx`: RAF for position constraints after DOM render
   - `Modal.tsx` (`Popover`): RAF for position calculations
   - **justification**: browser needs one frame for layout calculations

2. **user interaction delays** (legitimate - keep):
   - `NavigationHeader.tsx`: 300ms delay to hide search suggestions (allows clicks)
   - `PlaylistSelectorMenu.tsx`: setTimeout for input focus after render
   - **justification**: user experience requires these delays

3. **player controls** (legitimate - keep):
   - `Player.tsx`: 300ms auto-hide timeout for volume controls
   - **justification**: UI behavior specification

4. **scroll debouncing** (target for elimination):
   - `useInfiniteScroll.ts`: setTimeout-based scroll event debouncing
   - **problem**: unnecessary when passive listeners + immediate checks work better

**elimination strategy**:

**replace scroll debouncing with native throttling**:

```typescript
// OLD: setTimeout-based debouncing
const handleScroll = () => {
  if (scrollTimeout) clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(checkLoadMore, debounceMs);
};

// NEW: native scroll throttling with passive listeners
const handleScroll = () => {
  if (!checkInProgress) {
    checkInProgress = true;
    checkLoadMore();
    checkInProgress = false;
  }
};
element.addEventListener("scroll", handleScroll, { passive: true });
```

**replace layout RAF with ResizeObserver + computed styles**:

```typescript
// OLD: RAF for position calculations
requestAnimationFrame(() => {
  const constrainedPos = calculateConstrainedPosition();
  setPosition(constrainedPos);
});

// NEW: ResizeObserver + CSS custom properties
const resizeObserver = new ResizeObserver(() => {
  const constrainedPos = calculateConstrainedPosition();
  setPosition(constrainedPos);
});
```

**use SolidJS reactivity instead of timers**:

```typescript
// OLD: setTimeout for focus management
setTimeout(() => {
  const input = document.querySelector(".input") as HTMLInputElement;
  input?.focus();
}, 0);

// NEW: createEffect with DOM reactivity
createEffect(() => {
  const input = inputRef();
  if (input && shouldFocus()) {
    input.focus();
  }
});
```

**principles for setTimeout/RAF usage**:

1. **avoid for scroll handling**: use passive listeners + immediate checks
2. **avoid for focus management**: use SolidJS refs + effects
3. **avoid for layout**: use ResizeObserver + CSS
4. **keep for true async delays**: user interaction timeouts, auto-hide behaviors
5. **keep for forced reflow**: legitimate cases where DOM needs one frame to update

### virtual window management

**current viewport calculation**:

```typescript
const estimatedIndex = Math.floor(scrollTop / itemHeight);
const viewportStart = Math.max(0, estimatedIndex - bufferSize);
const viewportEnd = Math.min(
  totalCount,
  estimatedIndex + visibleCount + bufferSize,
);
```

**data loading strategy**:

```typescript
// only load data for current virtual window
const neededPages = calculatePagesForRange(viewportStart, viewportEnd);
const missingPages = neededPages.filter((page) => !loadedPages.has(page));
if (missingPages.length > 0) {
  await loadPages(missingPages);
}
```

### scroll restoration flow

**save state (on navigation away)**:

```typescript
const scrollTop = scrollElement.scrollTop;
const estimatedIndex = Math.floor(scrollTop / itemHeight);
const viewportStart = Math.max(0, estimatedIndex - bufferSize);
const viewportEnd = Math.min(
  totalCount,
  estimatedIndex + visibleCount + bufferSize,
);

saveScrollState({
  scrollTop,
  estimatedIndex,
  totalCount,
  itemHeight,
  viewportStartIndex: viewportStart,
  viewportEndIndex: viewportEnd,
  timestamp: Date.now(),
});
```

**restore state (on navigation back)**:

```typescript
const savedState = loadScrollState();
if (savedState && !isExpired(savedState)) {
  // 1. load data for saved viewport
  await loadAroundIndex(savedState.estimatedIndex);

  // 2. position virtual window
  grid.setEstimatedStartIndex(savedState.estimatedIndex);

  // 3. restore scroll position
  scrollElement.scrollTop = savedState.scrollTop;
}
```

## benefits

### user experience

- **instant restoration**: no loading delays when returning to views
- **smooth scrolling**: virtualization handles all scroll ranges seamlessly
- **memory efficient**: only loads data for current viewport
- **consistent behavior**: works same for restored and fresh loads

### developer experience

- **simplified architecture**: clear separation of concerns
- **maintainable code**: fewer moving parts and edge cases
- **reusable patterns**: works for any virtualized grid
- **better debugging**: clearer data flow and state management

### performance

- **minimal data loading**: only loads what user needs to see
- **fast navigation**: restoration happens immediately
- **efficient memory**: leverages virtualization for all scenarios
- **scalable**: works with thousands of items without performance degradation

## migration strategy

### backward compatibility

- [ ] keep existing scroll restoration working during transition
- [ ] gradually migrate views one at a time
- [ ] maintain debug logging for comparison

### rollback plan

- [ ] feature flag for new vs old system
- [ ] ability to disable new system per view
- [ ] preserve old implementation until new system proven

## success criteria

### functional requirements

- [ ] scroll position restores instantly (< 100ms) across all 8 freqhole views
- [ ] works with deep scroll positions (page 10+) for songs/artists/albums views
- [ ] handles viewport size changes (mobile ↔ desktop) with responsive grid modes
- [ ] maintains smooth scrolling in all grid modes (table/list/card/mixed/specialized)
- [ ] supports all current views: songs, artists, albums, search, playlists, artist detail, album detail, queue
- [ ] preserves view-specific state: sort, selection, active tabs, search queries, edit modes
- [ ] integrates with router navigation and global event system
- [ ] handles route parameter changes (artist/:id, album/:id, playlist/:id)

### performance requirements

- [ ] restoration loads max 150 items (3 pages × 50 items) regardless of previous position
- [ ] scroll restoration < 100ms with no loading spinners
- [ ] memory usage comparable to fresh page load
- [ ] no visual jank during restoration or grid mode switches
- [ ] eliminated 90%+ setTimeout/RAF usage (keep only legitimate async cases)

### maintainability requirements

- [ ] single virtualized scroll restoration system for all view types
- [ ] unified generic grid supporting table/list/card/mixed modes
- [ ] max 300 lines per file (increased for generic grid complexity)
- [ ] clear separation: data loading vs scroll positioning vs virtualization vs view rendering
- [ ] comprehensive test coverage for all freqhole view types and edge cases

### migration requirements

- [ ] seamless migration from three different data loading patterns:
  - `useFreqholeSearch` (songs view)
  - custom `useInfiniteScroll` (artists/albums views)
  - simple API calls (detail views)
- [ ] preserved existing complex features:
  - drag/drop playlist reordering
  - real-time rating/favorite updates
  - multi-view selection state
  - custom scroll position utilities (albums view)
- [ ] maintained responsive design patterns (desktop/mobile view switching)
- [ ] preserved global event system integration
- [ ] no regression in router navigation or hash-based deep linking
- [ ] consolidated three grid implementations (`InfiniteGrid`, `FreqholeInfiniteGrid`, `generic-infinite-grid`)

## implementation starting point

**Phase 1 Priority**: Consolidate grid systems and eliminate setTimeout-based scroll debouncing

**Starting with**:

1. Move `web-components/generic-infinite-grid.tsx` to `components/infinite-data-grid/`
2. Replace setTimeout scroll debouncing in `useInfiniteScroll.ts` with passive listeners
3. Enhance `InfiniteGrid` with router-aware scroll restoration hooks
4. Integrate `useBeforeLeave` for proper scroll state saving before navigation

**Why this order**: Router integration is fundamental - fixing navigation timing prevents the pagination restoration race conditions we observed in the logs.
