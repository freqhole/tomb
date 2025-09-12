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

**main goal**: Build a simple, performant virtualized grid with automatic scroll restoration that works across all freqhole views without verbose boilerplate.

**key insight learned**: Complex router-based scroll restoration creates infinite navigation loops. Simple in-memory state with centralized grid logic is the right approach.

## progress made in previous session

### ✅ completed improvements

1. **grid system consolidation**
   - moved `web-components/generic-infinite-grid.tsx` to proper location
   - identified three duplicate grid implementations that need unification

2. **eliminated settimeout-based scroll debouncing**
   - replaced with immediate scroll handling using passive listeners
   - removed unnecessary `debounceMs` options across codebase

3. **massive debug log cleanup**
   - removed excessive emoji-based console logging
   - preserved meaningful error logging without emojis
   - eliminated debug noise that was flooding logs

4. **router integration attempts**
   - initially tried sessionStorage approach (too complex)
   - attempted router history state (created infinite navigation loops)
   - learned: calling `navigate()` from scroll handlers = bad

### 🚨 critical lessons learned

**avoid over-engineering**: Every attempt to make scroll restoration "perfect" added complexity that broke things. The system needs to be simple and centralized.

**freqhole view complexity**: 8 different view types with different data loading patterns, rendering modes, and interaction requirements. Any solution must work for all without requiring view-specific code.

**existing grid systems inventory**:

- `components/infinite-data-grid/InfiniteGrid.tsx` - main generic system
- `views/freqhole/components/grid/FreqholeInfiniteGrid.tsx` - freqhole wrapper
- `web-components/generic-infinite-grid.tsx` - misplaced legacy system (moved)

## current status

### ✅ what works now

- basic virtualized rendering with absolute positioning
- centralized scroll restoration logic in InfiniteGrid
- simplified view components (removed verbose scroll restoration code)
- no infinite navigation loops

### ⚠️ needs fixes

- typescript compilation errors building up
- hook initialization order issues in InfiniteGrid
- scroll restoration not fully functional
- virtualization implementation incomplete

### 🎯 next priorities (address immediately)

1. **fix typescript compilation**
   - configure type-check script to ignore `src/web-components/`
   - resolve all tsc errors that have accumulated
   - ensure clean build before continuing development

2. **fix infinitegrid hook ordering**
   - resolve "cannot access 'layout' before initialization" error
   - ensure proper solidjs reactive patterns
   - stabilize grid rendering

3. **complete virtualization implementation**
   - finish visible range calculations
   - implement smart data loading based on viewport
   - test with large datasets

## simplified architecture goals

### core principle: centralization over abstraction

**problem**: Every view currently needs verbose scroll restoration code, multiple hook imports, and complex state management.

**solution**: Move ALL scroll restoration logic into the grid component itself. Views should just use the grid normally with no special scroll props.

### unified grid system requirements

**freqhole view inventory (8 total)**:

1. **songs views** (desktop/mobile) - table mode with sortable columns
2. **artists views** (desktop/mobile) - list mode with artist details
3. **albums views** (desktop/mobile) - card grid mode with album artwork
4. **search results view** - mixed mode with tabbed sections
5. **playlist detail view** - table mode with drag/drop reordering
6. **artist detail view** - complex layout with albums + songs
7. **album detail view** - album header + track listing
8. **queue view** - minimal list with current song highlighting

**data loading patterns**:

- `useFreqholeSearch` hook (songs view)
- custom `useInfiniteScroll` implementations (artists/albums)
- simple api calls (detail views)
- real-time state updates (queue view)

### target api simplicity

**views should look like this**:

```typescript
export function DesktopSongsView() {
  const searchHook = useFreqholeSearch(apiClient);

  return (
    <InfiniteGrid
      data={searchHook.songs()}
      totalCount={searchHook.totalCount()}
      onLoadMore={searchHook.loadMore}
      renderMode="songs-table"
      // that's it - no scroll restoration props needed
    />
  );
}
```

**grid handles everything internally**:

- automatic scroll restoration (no view configuration)
- virtualized rendering for performance
- smart data loading based on viewport
- consistent behavior across all view types

## implementation approach

### phase 1: stabilize foundation (week 1)

**1.1 fix typescript compilation**

- [ ] configure type-check script to ignore `src/web-components/`
- [ ] resolve all accumulated tsc errors
- [ ] ensure clean build state

**1.2 fix infinitegrid stability**

- [ ] resolve hook initialization order issues
- [ ] fix "cannot access 'layout' before initialization" error
- [ ] stabilize basic grid rendering

**1.3 audit existing grid usage**

- [ ] document all current freqhole view implementations
- [ ] identify common patterns and differences
- [ ] create migration plan for each view type

### phase 2: complete virtualization (week 1)

**2.1 finish virtualization implementation**

- [ ] complete visible range calculations with proper buffering
- [ ] implement smart data loading based on scroll position
- [ ] test with large datasets (1000+ items)

**2.2 centralize scroll restoration**

- [ ] implement simple in-memory scroll state storage
- [ ] automatic save/restore on navigation without router interference
- [ ] test across all view transitions

**2.3 unify grid systems**

- [ ] consolidate three different grid implementations
- [ ] migrate all views to unified system
- [ ] preserve existing functionality during migration

### phase 3: simplify view integration (week 1)

**3.1 eliminate view boilerplate**

- [ ] remove verbose scroll restoration code from all views
- [ ] standardize grid usage patterns
- [ ] create clear migration guide

**3.2 handle special cases**

- [ ] drag/drop for playlists and queue
- [ ] complex layouts for artist/album detail
- [ ] real-time updates for queue and ratings

**3.3 performance optimization**

- [ ] benchmark virtualization performance
- [ ] optimize render cycles and memory usage
- [ ] ensure smooth scrolling with large datasets

## technical implementation details

### virtualization strategy

**core concept**: only render visible items + small buffer, use absolute positioning

```typescript
// calculate visible range based on scroll position
const visibleRange = createMemo(() => {
  const scrollTop = layout.scrollTop();
  const containerHeight = layout.containerHeight();
  const itemHeight = props.virtualization?.rowHeight || 64;

  const startIndex = Math.floor(scrollTop / itemHeight);
  const visibleCount = Math.ceil(containerHeight / itemHeight);
  const bufferSize = Math.max(20, visibleCount);

  return {
    start: Math.max(0, startIndex - bufferSize),
    end: Math.min(totalItems, startIndex + visibleCount + bufferSize),
  };
});

// only render items in visible range
const visibleItems = createMemo(() => {
  const range = visibleRange();
  const items = [];
  for (let i = range.start; i < range.end; i++) {
    items.push({ data: data[i], index: i });
  }
  return items;
});
```

### scroll restoration strategy

**approach**: simple in-memory state with route-based keys

```typescript
// store scroll state per route in memory
const scrollStateMap = new Map<string, { scrollTop: number }>();

// save before navigation
useBeforeLeave(() => {
  const element = scrollElement();
  if (element && element.scrollTop > 0) {
    scrollStateMap.set(location.pathname, {
      scrollTop: element.scrollTop,
    });
  }
  return true;
});

// restore after navigation
createEffect(() => {
  const savedState = scrollStateMap.get(location.pathname);
  if (savedState && element) {
    element.scrollTop = savedState.scrollTop;
  }
});
```

### data loading integration

**smart loading based on viewport**:

```typescript
// trigger loading when scrolling near missing data
createEffect(() => {
  const range = visibleRange();
  const needsMore =
    range.end > props.data.length && props.data.length < props.totalCount;

  if (needsMore && !props.loading) {
    props.onLoadMore?.();
  }
});
```

## success criteria

### functional requirements

- [ ] all 8 freqhole views use unified grid system
- [ ] scroll restoration works instantly without loading delays
- [ ] handles datasets of 1000+ items with smooth performance
- [ ] view components have minimal grid-related code (< 10 lines)
- [ ] no typescript compilation errors

### performance requirements

- [ ] renders max 100 dom elements regardless of dataset size
- [ ] scroll restoration < 100ms
- [ ] smooth 60fps scrolling with large datasets
- [ ] memory usage scales with viewport size, not dataset size

### maintainability requirements

- [ ] single grid implementation supports all use cases
- [ ] view components focus on business logic, not scroll management
- [ ] clear upgrade path from current implementations
- [ ] comprehensive documentation and examples

## architectural principles for continued work

### simplicity over perfection

- prefer working simple solutions over complex perfect ones
- eliminate abstractions that don't solve real problems
- focus on the 8 concrete freqhole use cases, not theoretical flexibility

### centralization over configuration

- move complexity into reusable components, not view-specific code
- provide good defaults that work for 90% of cases
- make common things easy, complex things possible

### performance over features

- virtualization must work well with 1000+ items
- scroll restoration must be instant
- memory usage must be predictable and bounded

### existing code integration

- work with existing data loading patterns (`useFreqholeSearch`, `useInfiniteScroll`)
- preserve existing interactions (selection, sorting, context menus)
- migrate incrementally without breaking current functionality

the goal is not to build a perfect abstract grid system, but to make the 8 freqhole views simple, fast, and maintainable while providing excellent user experience with scroll restoration and virtualization.
