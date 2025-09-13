# State Management Refactor & Phase 4 Tag Filtering Plan

**Phase 1 Complete** ✅ - [View completed Phase 1 details](./state-management-refactor-and-phase-4-plan-completed.md)

## 🚨 CRITICAL RULES - NEVER FORGET 🚨

1. **NO EMOJIS**: Keep code comments, logs, and ui display text lowercase (proper nouns and acronyms can be uppercase)
2. **File Size Limit**: Maximum ~500 lines per file
3. **Dark Theme Design**: UI must use dark theme with primary colors black, white, and magenta accents. Use other colors sparingly. Avoid borders and no rounded corner border radius (border-radius: 0)
4. **Modular Architecture**: Use solidjs hooks for reactive logic, leverage createResource/produce/mutate for optimal reactivity, keep components presentational, central context providers for state, avoid prop drilling
5. **Data Validation**: Use zod for all json api data parsing and validation (existing pattern)
6. **Code Reuse**: Leverage existing lib code and hooks where possible, build new generic utilities in `client/js/src/lib/`
7. **Domain Separation**: Keep admin logic generic in views/admin/, music-specific code in lib/music/ and hooks/music/
8. **Generic Library Focus**: Build reusable patterns in `client/js/src/lib/`
9. **LEGACY CODE MARKING**: When implementing new better patterns, clearly mark old code as `@deprecated`, `// LEGACY:`, or `// TODO: migrate to X` so we know which system to use and can clean up later. This prevents confusion between "this is broken and needs debugging now" vs "this works but should be migrated as part of the plan"

## Progress Tracking

**Current Status**: Phase 2 - Tag Context Menu Fix

**Phase 1**: ✅ **COMPLETED** - Core Reactive Store Foundation

- [View Phase 1 detailed implementation](./state-management-refactor-and-phase-4-plan-completed.md)
- SearchContext removed, consolidated into reactive store
- Components migrated to new store hooks
- Clean TypeScript compilation achieved
- All functionality preserved

**Phase 2**: ⚠️ **BLOCKED** - Tag Context Menu Fix (Week 2) - REACTIVE ARCHITECTURE ISSUES

- **Goal**: Fix reactive patterns for tag management
- **Progress**: 80% complete - API and schemas working, but reactive patterns broken
- **Status**: BLOCKED by fundamental Solid.js reactive architecture issues
- **Critical Issues**: Tag loading stuck, tag selection not working, store/resource lifecycle problems

**Phase 2.5**: 🚨 **URGENT** - Fix Reactive Architecture (Week 3)

- **Goal**: Resolve fundamental Solid.js reactive store issues before proceeding
- **Scope**: Store/resource lifecycle, reactive dependencies, component integration
- **Blocker**: Must be resolved before Phase 3 backend work

**Next Steps** (URGENT - Architecture Fix Required):

- Debug and fix Solid.js reactive store architecture issues
- Resolve resource loading on initial page load vs hot reload
- Fix tag selection/filtering functionality
- Establish proper reactive patterns before continuing with backend work
- Consider store architecture refactor if needed

## Overview

This document outlines the remaining phases of the state management refactor and implementation of Phase 4 tag filtering for artists and albums views.

**Phase 1 Complete**: Successfully consolidated fragmented state management - [see detailed implementation](./state-management-refactor-and-phase-4-plan-completed.md)

**Current Focus**: Fix tag context menu reactivity and extend tag filtering to artists/albums views.

**Remaining Goals:**

1. ✅ ~~Consolidate to single, clean FreqholeStore context provider~~
2. Fix tag context menu reactive patterns
3. Extend tag filtering to artists and albums views
4. Add backend API support for artists/albums tag filtering
5. Implement infinite grid virtualization (later phases)
6. Establish cross-view data synchronization patterns
7. Leverage solid-js reactive primitives for optimal performance

**Architecture Foundation**: Clean reactive store patterns established, ready for advanced features.

## Current Architecture Analysis

### Context Providers Stack

```
client/js/src/views/freqhole/index.tsx:
AuthProvider → StoreProvider → SearchProvider → FreqholeContext (stub)
```

### State Management Files

- `store/index.tsx`: Comprehensive FreqholeStore with filters.tags stub
- `context/SearchContext.tsx`: Wraps useFreqholeSearch hook
- `context/FreqholeContext.tsx`: Unused stub with TODOs
- `hooks/useGlobalEvents.ts`: Event bus system
- `hooks/useFreqholeSearch.ts`: Search logic with tag filtering

### Current Tag Filtering Implementation

- **TagFilterControls**: Uses useFilters() + manual event emissions
- **Songs views**: Integrated with TagFilterControls
- **Artists/Albums views**: No tag filtering support

### Backend API Status

- **Songs**: POST `/api/music/search` with tag filtering ✅ (no changes needed)
- **Artists**: GET `/api/music/artists` (existing) + POST variant needed for tag filtering
- **Albums**: GET `/api/music/albums` (existing) + POST variant needed for tag filtering

## Future Multi-Server Context

**Distant Future Goal:** Support multiple API servers with ability to switch entire app context between servers.

**Implications for Current Plan:**

- Store should be designed as "per-server" context
- API client should be injected, not global
- Auth should be per-server, not global
- Pattern should support creating multiple store instances

**Current Plan Adjustments:** Design for server-agnostic patterns, leverage solid-js reactive primitives, but keep view management in the router where it belongs. Avoid embedding view-specific logic in the store.

## Complex Requirements Analysis

### Infinite Grid Virtualization & Scroll Restoration

- **Virtualized rendering**: Only render visible items for performance
- **Scroll restoration**: Router tracks scroll position and current page
- **Arbitrary page loading**: Must load page N directly (not just sequential)
- **Bidirectional infinite scroll**: Load more pages up or down from current position
- **State synchronization**: Grid state must sync with router state and data resources

### Tag Context Menu Complexity

- **Global tag state**: Needs to update available tags list when creating new tags
- **Individual song state**: Update specific song(s) with new/removed tags
- **Multi-selection support**: Handle bulk tag operations across selected songs
- **Reactive conflicts**: Current implementation fights reactive patterns

### Cross-View Data Synchronization

- **Currently playing indicators**: Show across all views where song appears
- **Playlist updates**: Nav sidebar must reflect changes made in playlist view
- **Tag filter state**: Preserve filter state when switching between views

## Solid-JS Reactive Patterns Integration

**Key Reactive Primitives to Leverage:**

- **createResource**: For API data fetching with automatic loading/error states
- **produce**: For immutable store updates with complex nested changes
- **mutate**: For optimistic updates and immediate UI feedback
- **createMemo**: For derived state and computed values
- **batch**: For coordinating multiple state updates

**Synchronization Patterns Needed:**

- Tag filter changes trigger reloads across songs/artists/albums views
- Selection state synchronized between context menus and bulk actions
- Search state synchronized with URL params and filter state
- Player state synchronized with queue and current song displays

## Remaining Implementation Plan

**Strategy**: Build on established reactive foundation. Each phase must result in a working app.

### ✅ Phase 1: Core Reactive Store Foundation - COMPLETED

**[View detailed implementation](./state-management-refactor-and-phase-4-plan-completed.md)**

### Phase 2: Tag Context Menu Fix (Week 2) - ⚠️ BLOCKED BY REACTIVE ARCHITECTURE ISSUES

#### 🔄 2.1: Tag Context Menu Reactive Pattern Fix - 80% COMPLETE, BLOCKED

**Goal**: Fix current reactive conflicts in tag context menus and make tag lifecycle fully reactive

**Completed Work:**

- ✅ Fixed `availableTags` resource to call real `/api/music/filter-options` API
- ✅ Added proper `getFilterOptions()` method to ApiClient with Zod validation
- ✅ Created comprehensive `FilterOptionsResponseSchema` matching actual API response
- ✅ Refactored `TagSelectorMenu` to use `useTagManagement()` hook instead of direct API calls
- ✅ Enabled `tagListVersion` increments to trigger reactive updates
- ✅ Removed ugly type guards with proper `FilterOption[]` typing
- ✅ Added utility for handling optional arrays (`createOptionalArraySchema`)
- ✅ Eliminated dynamic imports in favor of standard top-level imports

**🚨 CRITICAL ISSUES DISCOVERED:**

**Issue #1: Resource Loading Failure on Initial Load**

- **Symptom**: TagFilterControls shows "loading tags..." forever on initial page load
- **Debug Info**: `{loading: true, availableTags: undefined, unselectedTags: Array(0)}`
- **But Works After Hot Reload**: `{loading: false, availableTags: Array(10), unselectedTags: Array(10)}`
- **Root Cause**: Reactive dependency issue with `createResource(() => store.ui.tagListVersion, ...)`

**Issue #2: Tag Selection Not Working**

- **Symptom**: Selecting tags doesn't show selected tags, songs list doesn't filter
- **Root Cause**: Store actions calling wrong actions or reactive updates not propagating

**Issue #3: Store Architecture Problems**

- **Problem**: `reactiveActions` created at module level, outside reactive context
- **Problem**: `createResource` dependencies not properly reactive to store changes
- **Problem**: Multiple store action patterns (basic vs reactive) causing confusion

**DEEPER ARCHITECTURAL CONCERNS:**

1. **Module-Level Store Creation**: `reactiveActions = createStoreActions(store, setStore, apiClient)` happens outside component tree
2. **Reactive Context Issues**: Store accessed in resource dependencies may not be reactive
3. **Multiple Action Patterns**: Both `storeActions` and `reactiveActions` exist, unclear which to use when
4. **Resource Lifecycle**: Resources not properly triggering on initial app load

**TECHNICAL DEBT IDENTIFIED:**

- Legacy `AllFiltersResponseSchema` (low priority)
- Mixed action patterns need consolidation (high priority)
- ESLint rule needed for dynamic imports (medium priority)

**BLOCKING PHASE 3**: Cannot proceed with backend API extensions until reactive store foundation is solid

### Phase 3: Backend API Extensions (Week 3)

**Scope:** Artists and albums APIs with tag filtering support

#### 3.1: Artists API Tag Filtering

**File:** `server/src/media/songs.rs`

**Strategy:** Keep existing GET endpoint, add POST variant for filtering

**New Endpoint:** `POST /api/music/artists`

```rust
#[derive(Debug, Deserialize)]
pub struct ArtistsFilterRequest {
    pub tags: Option<Vec<String>>,
    pub query: Option<String>,
    pub page: Option<i32>,
    pub page_size: Option<i32>,
    pub sort_by: Option<String>,
    pub sort_direction: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ArtistsFilterResponse {
    pub artists: Vec<ArtistSummaryResponse>,
    pub total: i64,
    pub page: i32,
    pub page_size: i32,
    pub total_pages: i32,
    pub has_next: bool,
    pub has_prev: bool,
}

pub async fn filter_artists(
    Extension(db): Extension<DatabaseConnection>,
    Json(request): Json<ArtistsFilterRequest>,
) -> Result<Json<ArtistsFilterResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());

    // Build query with tag filtering
    let mut query = String::from(r#"
        SELECT DISTINCT s.artist,
               COUNT(DISTINCT s.id) as song_count,
               AVG(COALESCE(sp.rating, 0)) as avg_rating
        FROM songs s
        LEFT JOIN song_preferences sp ON s.id = sp.song_id
        WHERE s.deleted_at IS NULL AND s.artist IS NOT NULL
    "#);

    let mut params = Vec::new();
    let mut param_count = 1;

    // Add tag filtering
    if let Some(tags) = &request.tags {
        if !tags.is_empty() {
            query.push_str(&format!(r#"
                AND s.id IN (
                    SELECT st.song_id
                    FROM song_tags st
                    JOIN tags t ON st.tag_id = t.id
                    WHERE t.name = ANY(${}::text[])
                )"#, param_count));
            params.push(tags.as_slice());
            param_count += 1;
        }
    }

    // Add search filtering
    if let Some(search_query) = &request.query {
        query.push_str(&format!(" AND s.artist ILIKE ${}", param_count));
        params.push(format!("%{}%", search_query));
        param_count += 1;
    }

    query.push_str(" GROUP BY s.artist");

    // Add sorting
    let sort_by = request.sort_by.as_deref().unwrap_or("artist");
    let sort_direction = request.sort_direction.as_deref().unwrap_or("asc");

    match sort_by {
        "name" | "artist" => query.push_str(&format!(" ORDER BY s.artist {}", sort_direction)),
        "song_count" => query.push_str(&format!(" ORDER BY song_count {}", sort_direction)),
        "rating" => query.push_str(&format!(" ORDER BY avg_rating {}", sort_direction)),
        _ => query.push_str(" ORDER BY s.artist ASC"),
    }

    // Add pagination
    let page = request.page.unwrap_or(1);
    let page_size = request.page_size.unwrap_or(50);
    let offset = (page - 1) * page_size;

    query.push_str(&format!(" LIMIT {} OFFSET {}", page_size, offset));

    // Execute query and build response
    // ... implementation details ...
}
```

**Route Registration:**

```rust
// Add POST variant alongside existing GET
.route("/artists", get(list_artists).post(filter_artists))
```

#### 3.2: Albums API Tag Filtering

**File:** `server/src/media/songs.rs`

**New Endpoint:** `POST /api/music/albums`

```rust
#[derive(Debug, Deserialize)]
pub struct AlbumsFilterRequest {
    pub tags: Option<Vec<String>>,
    pub query: Option<String>,
    pub artist: Option<String>,
    pub year_min: Option<i32>,
    pub year_max: Option<i32>,
    pub page: Option<i32>,
    pub page_size: Option<i32>,
    pub sort_by: Option<String>,
    pub sort_direction: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AlbumsFilterResponse {
    pub albums: Vec<AlbumSummaryResponse>,
    pub total: i64,
    pub page: i32,
    pub page_size: i32,
    pub total_pages: i32,
    pub has_next: bool,
    pub has_prev: bool,
}

pub async fn filter_albums(
    Extension(db): Extension<DatabaseConnection>,
    Json(request): Json<AlbumsFilterRequest>,
) -> Result<Json<AlbumsFilterResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());

    // Similar implementation pattern as artists filtering
    // with album-specific fields and aggregations
}
```

#### 3.3: GET/POST Endpoint Strategy

**Server-side approach:**

- Keep existing GET endpoints unchanged (simple, no filtering)
- Add POST variants for filtered requests
- Share common query logic between GET and POST implementations
- POST endpoints can reuse most of the GET logic with additional filtering

**Example shared implementation:**

```rust
// Shared query builder
async fn build_artists_query(
    db: &DatabaseConnection,
    filters: Option<&ArtistsFilterRequest>,
    pagination: &PaginationParams,
) -> Result<Vec<ArtistSummary>, WebauthnError> {
    let mut query = String::from("SELECT DISTINCT s.artist, COUNT(*) as song_count FROM songs s WHERE s.deleted_at IS NULL");

    // Add tag filtering if present
    if let Some(filters) = filters {
        if let Some(tags) = &filters.tags {
            if !tags.is_empty() {
                query.push_str(" AND s.id IN (SELECT st.song_id FROM song_tags st JOIN tags t ON st.tag_id = t.id WHERE t.name = ANY($1))");
            }
        }
    }

    // ... rest of shared logic
}

// GET endpoint (simple)
pub async fn list_artists(
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<ArtistQueryParams>,
) -> Result<Json<ArtistsResponse>, WebauthnError> {
    build_artists_query(&db, None, &params.into()).await
}

// POST endpoint (with filters)
pub async fn filter_artists(
    Extension(db): Extension<DatabaseConnection>,
    Json(request): Json<ArtistsFilterRequest>,
) -> Result<Json<ArtistsResponse>, WebauthnError> {
    build_artists_query(&db, Some(&request), &request.into()).await
}
```

**Client-side approach:**

- Use GET for unfiltered requests (when no tags selected)
- Use POST for filtered requests (when tags are selected)
- Single client method that chooses appropriate endpoint based on filter presence

### Phase 4: Infinite Grid Virtualization & Scroll Restoration (Week 4-5)

**Goal**: Add virtualization and scroll restoration without breaking existing patterns

#### 4.1: Enhanced Store Structure for Virtualization

**File:** `client/js/src/views/freqhole/store/index.tsx`

**Enhanced Store Structure:**

```typescript
export interface VirtualizedStoreResources {
  songs: Resource<PaginatedSongData>;
  artists: Resource<PaginatedArtistData>;
  albums: Resource<PaginatedAlbumData>;
}

export interface PaginatedSongData {
  items: Song[];
  totalCount: number;
  currentPage: number;
  pageSize: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface GridViewState {
  scrollOffset: number;
  visibleStartIndex: number;
  visibleEndIndex: number;
  loadedPageRange: { start: number; end: number };
}

// Enhanced store with virtualization state
export interface EnhancedFreqholeStore extends FreqholeStore {
  // router handles scroll restoration, not store
  scrollRestoration: {
    positions: Record<string, number>; // route -> scroll position
    pages: Record<string, number>; // route -> current page
  };
}
```

#### 4.2: Virtualized Resource Management

**Virtualized Resource Pattern:**

```typescript
// Enhanced resource with arbitrary page loading
const [songsResource, { refetch, mutate }] = createResource(
  () => ({
    tags: store.filters.tags,
    query: store.search.query,
    // Virtualization params
    targetPage: store.virtualization.songs.currentPage,
    pageSize: 50,
    loadedRange: store.virtualization.songs.loadedPageRange,
  }),
  async (params) => {
    // load multiple pages if needed for scroll restoration
    const pagesToLoad = [];

    // if restoring scroll, might need to load pages 1-5 immediately
    for (
      let page = params.loadedRange.start;
      page <= params.loadedRange.end;
      page++
    ) {
      pagesToLoad.push(page);
    }

    const pagePromises = pagesToLoad.map((page) =>
      apiClient.getSongs({
        ...params,
        page,
        page_size: params.pageSize,
      }),
    );

    const pageResults = await Promise.all(pagePromises);

    // merge all pages into single dataset
    return {
      items: pageResults.flatMap((result) => result.items),
      totalCount: pageResults[0]?.totalCount || 0,
      loadedPageRange: params.loadedRange,
      // ... pagination metadata
    };
  },
);

// actions for infinite scroll and scroll restoration
export const virtualizationActions = {
  // load more pages when scrolling
  loadMorePages: async (direction: "up" | "down") => {
    const currentRange = store.virtualization.songs.loadedPageRange;

    if (direction === "down" && hasNextPage) {
      setStore(
        "virtualization",
        "songs",
        "loadedPageRange",
        "end",
        (end) => end + 1,
      );
    } else if (direction === "up" && hasPrevPage) {
      setStore(
        "virtualization",
        "songs",
        "loadedPageRange",
        "start",
        (start) => start - 1,
      );
    }

    // resource automatically refetches with new range
  },

  // restore scroll position from router
  restoreScrollPosition: (route: string, targetScrollOffset: number) => {
    const targetPage = Math.floor(targetScrollOffset / (itemHeight * pageSize));

    // load necessary pages for scroll restoration
    setStore("virtualization", "songs", "loadedPageRange", {
      start: Math.max(1, targetPage - 1),
      end: targetPage + 2,
    });

    // store scroll position for restoration
    setStore("virtualization", "songs", "scrollOffset", targetScrollOffset);
  },

  // save current scroll position to router
  saveScrollPosition: (route: string, scrollOffset: number) => {
    setStore("navigation", "scrollPositions", route, scrollOffset);

    // also save to router/URL if needed
    // router.setScrollPosition(route, scrollOffset);
  },
};
```

#### 4.3: Infinite Grid Component Integration

**File:** `client/js/src/views/freqhole/components/grid/VirtualizedInfiniteGrid.tsx`

```typescript
export function VirtualizedInfiniteGrid<T>(props: {
  items: Resource<PaginatedData<T>>;
  onLoadMore: (direction: 'up' | 'down') => void;
  onScrollPositionChange: (offset: number) => void;
  // remove viewType - let component composition handle differences
}) {
  const [store, actions] = useFreqholeStore();
  const virtualizer = createVirtualizer({
    count: props.items()?.totalCount || 0,
    getScrollElement: () => scrollElement,
    estimateSize: () => 60, // estimated item height
    overscan: 5,
  });

  // handle scroll restoration from router
  createEffect(() => {
    const route = location.pathname;
    const savedOffset = store.scrollRestoration.positions[route];
    if (savedOffset > 0) {
      virtualizer.scrollToOffset(savedOffset, { align: 'start' });
    }
  });

  // handle infinite scroll
  createEffect(() => {
    const range = virtualizer.getVirtualItems();
    const firstItem = range[0];
    const lastItem = range[range.length - 1];

    // load more when approaching edges
    if (firstItem?.index < 5) {
      props.onLoadMore('up');
    }
    if (lastItem?.index > (props.items()?.totalCount || 0) - 5) {
      props.onLoadMore('down');
    }
  });

  // save scroll position changes
  createEffect(() => {
    const scrollOffset = virtualizer.scrollOffset;
    if (scrollOffset !== undefined) {
      props.onScrollPositionChange(scrollOffset);
    }
  });

  return (
    <div class="virtual-scroll-container">
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const item = props.items()?.items[virtualRow.index];
        return item ? (
          <div key={virtualRow.key} data-index={virtualRow.index}>
            <ItemRenderer item={item} />
          </div>
        ) : (
          <div key={virtualRow.key}>loading...</div>
        );
      })}
    </div>
  );
}
```

### Phase 5: Frontend Integration with Virtualization (Week 6)

#### 5.1: Update Views with Virtualized Grids

**File:** `client/js/src/components/filters/TagFilterControls.tsx`

**Reactive Implementation with Tag Lifecycle Support:**

```typescript
export function TagFilterControls(props: TagFilterControlsProps) {
  const [tagFilters, tagActions] = useTagFilters();
  const [showTagMenu, setShowTagMenu] = createSignal(false);
  const events = useGlobalEvents();

  // Listen for tag creation/deletion from context menus
  events.on("tag:created", (data) => {
    // Available tags automatically refresh due to reactive dependency
    // No manual action needed - just for UI feedback
  });

  events.on("tag:deleted", (data) => {
    // Available tags automatically refresh
    // Filter might be automatically removed if it was the deleted tag
  });

  events.on("song:tags-updated", (data) => {
    if (data.tagCreated) {
      // New tag available in dropdown immediately
      // Could show a notification: "New tag '${data.tagAdded}' created"
    }
  });

  const handleAddTag = (tag: string) => {
    tagActions.addTag(tag);
    setShowTagMenu(false);
    // store automatically triggers resource refetches
  };

  const handleRemoveTag = (tag: string) => {
    tagActions.removeTag(tag);
    // immediate ui update + automatic data refresh
  };

  const handleClearAllTags = () => {
    tagActions.clearTags();
    // all resources automatically refetch
  };

  return (
    <div class={`relative ${props.class || ""}`}>
      {/* active filters display */}
      <div class="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setShowTagMenu(!showTagMenu())}
          class="inline-flex items-center gap-1 px-2 py-1 border border-gray-600 hover:border-magenta-400 text-gray-300 hover:text-white text-xs transition-colors"
        >
          <TagIcon />
          <span>tags</span>
          <ChevronIcon rotated={showTagMenu()} />
        </button>

        {/* selected tags with immediate updates */}
        <For each={tagFilters.selectedTags}>
          {(tag) => (
            <TagChip
              tag={tag}
              onRemove={() => handleRemoveTag(tag)}
            />
          )}
        </For>
      </div>

      {/* dropdown menu with reactive available tags */}
      <Show when={showTagMenu()}>
        <TagDropdownMenu
          availableTags={tagFilters.unselectedTags()}
          loading={tagFilters.loading}
          onAddTag={handleAddTag}
          onClearAll={handleClearAllTags}
        />
      </Show>
    </div>
  );
}
```

#### 5.2: Artists Views with Virtualization

**File:** `client/js/src/views/freqhole/components/content/views/artists/DesktopArtistsView.tsx`

```typescript
export function DesktopArtistsView(props: DesktopArtistsViewProps) {
  const dataSections = useDataSections();
  const [tagFilters] = useTagFilters();
  const [selection, selectionActions] = useSelection();

  // component decides when to use artists resource - no view coupling!

  const handleArtistClick = (artist: ArtistSummary) => {
    // use optimistic selection updates
    selectionActions.setSelection([artist.artist], "artists");
    setSelectedArtist(artist);
  };

  // memoized artist count for display
  const artistStats = createMemo(() => {
    const artists = dataSections.artists.data();
    return {
      total: artists?.length || 0,
      loading: dataSections.artists.loading,
      hasFilters: tagFilters.selectedTags.length > 0,
    };
  });

  return (
    <div class="flex h-full bg-black text-white w-full max-w-full">
      <div class="w-72 min-w-72 flex-shrink-0 flex flex-col border-r border-magenta-800/30">
        {/* header with reactive tag filters */}
        <div class="flex-shrink-0 p-6">
          <div class="flex items-center justify-between mb-2">
            <h1 class="text-2xl font-semibold text-white">artists</h1>
            <TagFilterControls compact={false} />
          </div>

          {/* reactive status display */}
          <div class="text-sm text-gray-400 mb-4">
            <Show
              when={!artistStats().loading}
              fallback={<span>loading artists...</span>}
            >
              <span>{artistStats().total} artists</span>
              <Show when={artistStats().hasFilters}>
                <span class="text-magenta-400 ml-2">filtered</span>
              </Show>
            </Show>
          </div>
        </div>

        {/* reactive artists list */}
        <div class="flex-1 overflow-hidden">
          <FreqholeInfiniteGrid
            items={dataSections.artists.data}  // resource, not items array
            loading={dataSections.artists.loading}
            error={dataSections.artists.error}
            onItemClick={handleArtistClick}
            selectedIds={selection.selectedIds}
            // grid automatically re-renders when resource updates
          />
        </div>
      </div>

      {/* right panel with reactive selection state */}
      <div class="flex-1">
        <Show
          when={selection.hasSelection}
          fallback={<div class="p-6 text-gray-500">select an artist</div>}
        >
          <ArtistDetailPanel
            artist={selectedArtist()}
            // panel automatically updates when selection changes
          />
        </Show>
      </div>
    </div>
  );
}
```

**File:** `client/js/src/views/freqhole/components/content/views/artists/MobileArtistsView.tsx`

Similar updates for mobile view with compact TagFilterControls.

#### 5.3: API Client Updates

**File:** `client/js/src/lib/api-client.ts`

```typescript
export class ApiClient {
  // ... existing methods ...

  async getArtists(params?: ArtistQueryParams): Promise<ArtistsResponse> {
    return this.makeRequest("GET", "/api/music/artists", null, params);
  }

  async filterArtists(request: ArtistsFilterRequest): Promise<ArtistsResponse> {
    return this.makeRequest("POST", "/api/music/artists", request);
  }

  async getAlbums(params?: AlbumQueryParams): Promise<AlbumsResponse> {
    return this.makeRequest("GET", "/api/music/albums", null, params);
  }

  async filterAlbums(request: AlbumsFilterRequest): Promise<AlbumsResponse> {
    return this.makeRequest("POST", "/api/music/albums", request);
  }

  // convenience method that chooses GET or POST based on filters
  async loadArtists(filters?: ArtistsFilterRequest): Promise<ArtistsResponse> {
    if (filters?.tags && filters.tags.length > 0) {
      return this.filterArtists(filters);
    } else {
      // convert to query params and use GET
      const params = this.filtersToQueryParams(filters);
      return this.getArtists(params);
    }
  }

  async loadAlbums(filters?: AlbumsFilterRequest): Promise<AlbumsResponse> {
    if (filters?.tags && filters.tags.length > 0) {
      return this.filterAlbums(filters);
    } else {
      const params = this.filtersToQueryParams(filters);
      return this.getAlbums(params);
    }
  }
}
```

#### 5.4: Zod Schema Updates

**File:** `client/js/src/lib/music/schemas/api.ts`

```typescript
export const ArtistsFilterRequestSchema = z.object({
  tags: z.array(z.string()).optional(),
  query: z.string().optional(),
  page: z.number().int().positive().optional(),
  page_size: z.number().int().positive().max(100).optional(),
  sort_by: z.enum(["artist", "song_count", "rating"]).optional(),
  sort_direction: z.enum(["asc", "desc"]).optional(),
});

export const AlbumsFilterRequestSchema = z.object({
  tags: z.array(z.string()).optional(),
  query: z.string().optional(),
  artist: z.string().optional(),
  year_min: z.number().int().optional(),
  year_max: z.number().int().optional(),
  page: z.number().int().positive().optional(),
  page_size: z.number().int().positive().max(100).optional(),
  sort_by: z.enum(["album", "artist", "year", "track_count"]).optional(),
  sort_direction: z.enum(["asc", "desc"]).optional(),
});

export type ArtistsFilterRequest = z.infer<typeof ArtistsFilterRequestSchema>;
export type AlbumsFilterRequest = z.infer<typeof AlbumsFilterRequestSchema>;
```

### Phase 6: Cross-View Synchronization & Polish (Week 7)

**Goal**: perfect the synchronization patterns established in earlier phases

#### 6.1: Currently Playing Indicators

**pattern for synchronized "now playing" indicators:**

```typescript
export const useCurrentlyPlaying = () => {
  const [store] = useFreqholeStore();

  // memoized checker that works in any component
  const isCurrentlyPlaying = createMemo(() => (songId: string) => {
    return store.player.currentSong?.id === songId;
  });

  return { isCurrentlyPlaying };
};

// usage in virtualized grid items
const SongGridItem = (props: { song: Song }) => {
  const { isCurrentlyPlaying } = useCurrentlyPlaying();

  return (
    <div class={`song-item ${isCurrentlyPlaying()(props.song.id) ? 'playing' : ''}`}>
      <Show when={isCurrentlyPlaying()(props.song.id)}>
        <PlayingIndicator />
      </Show>
      {/* rest of item */}
    </div>
  );
};
```

#### 6.2: Playlist Nav Synchronization

**pattern for nav sidebar updates:**

```typescript
const PlaylistNavItem = (props: { playlist: Playlist }) => {
  const events = useGlobalEvents();

  // automatically updates when playlist changes anywhere in app
  events.on("playlist:updated", (data) => {
    if (data.playlist.id === props.playlist.id) {
      // component re-renders with new playlist data
      // image, name, song count all update automatically
    }
  });

  return (
    <div class="playlist-nav-item">
      <img src={props.playlist.image_url} />
      <span>{props.playlist.name}</span>
      <span class="song-count">{props.playlist.song_count}</span>
    </div>
  );
};
```

### Phase 7: Testing & Performance Validation (Week 8)

#### 7.1: Virtualization Performance Testing

**verification points:**

- virtualized grids handle large datasets (10k+ items) smoothly
- scroll restoration works correctly across route navigation
- arbitrary page loading works for deep-linked scroll positions
- memory usage remains stable during infinite scrolling

#### 7.2: Cross-View Synchronization Testing

**verification points:**

- currently playing indicators appear correctly across all virtualized views
- playlist changes in playlist view immediately reflect in nav sidebar
- tag context menu operations update global tag list and all relevant views
- song favorites/ratings update immediately across all locations where song appears
- no stale data or synchronization conflicts

#### 7.3: Reactive Performance Testing

**verification points:**

- createResource caching works correctly - no duplicate API calls
- optimistic updates feel instant with proper rollback on errors
- complex tag operations (create + add to songs) work smoothly
- store updates trigger minimal re-renders (batch effectiveness)

## Incremental Migration Strategy

### ✅ Phase 1: Basic Store Foundation - COMPLETED

- **outcome**: successful - zero runtime errors, clean compilation
- **scope**: replaced SearchProvider and FreqholeContext with reactive store
- **validation**: ✅ tag filtering works, no regressions detected
- **migration**: seamless - full API compatibility maintained
- **benefit**: significantly reduced complexity, eliminated provider stack

### ⚠️ Phase 2: Tag Context Menu Fix - BLOCKED

- **outcome**: blocked - 80% complete but reactive architecture issues discovered
- **scope**: fixed API/schemas but revealed fundamental Solid.js store problems
- **validation**: ❌ tag loading fails on initial load, tag selection broken
- **benefit**: proper API integration and type safety achieved, but UX broken
- **rollback**: may need significant store architecture refactor
- **reality check**: deeper problems than expected, need architecture review

### Phase 2.5: Fix Reactive Architecture - URGENT

- **risk**: high - fundamental architecture changes needed
- **scope**: debug and fix Solid.js reactive store patterns
- **validation**: tags load on initial page load, tag selection works correctly
- **rollback**: may need to revert to old patterns temporarily
- **reality check**: client foundation not solid, must fix before backend work

### Phase 3: Backend API Extensions - ON HOLD

- **status**: blocked by Phase 2 reactive architecture issues
- **rationale**: no point adding backend features if frontend is broken
- **timeline**: will resume after Phase 2.5 completion

### Phase 3: Artists/Albums API (Week 2-3)

- **risk**: low - backend only, keeping GET endpoints
- **scope**: add POST variants for artists/albums with tag filtering
- **validation**: new endpoints work, old ones unchanged
- **rollback**: trivial - just don't use new endpoints
- **reality check**: straightforward server work, no client changes needed

### Phase 4: Frontend Tag Filtering (Week 4)

- **risk**: medium - connecting new APIs to existing views
- **scope**: add TagFilterControls to artists/albums views
- **validation**: tag filtering works in all views
- **rollback**: can disable TagFilterControls in new views
- **reality check**: building on existing working patterns

### Phase 5+: Future Improvements (Later)

- **virtualization**: only tackle after core functionality is solid
- **scroll restoration**: router-based approach when ready
- **complex synchronization**: build incrementally on proven patterns
- **reality check**: don't bite off more than we can chew

## File Structure Changes

### Files to Create:

```
client/js/src/views/freqhole/store/
├── hooks.tsx               (granular store hooks)
├── actions.tsx            (store actions with event integration)
├── types.ts               (enhanced store types)
└── factory.ts             (store factory for multi-server preparation)

client/js/src/views/freqhole/context/
└── ServerContextProvider.tsx (unified server context provider)

client/js/src/lib/music/schemas/
└── filters.ts            (filter request/response schemas)
```

### Files to Modify:

```
client/js/src/views/freqhole/
├── index.tsx             (remove redundant providers)
└── store/index.tsx       (enhance with search/data logic)

client/js/src/views/freqhole/components/content/views/
├── artists/DesktopArtistsView.tsx
├── artists/MobileArtistsView.tsx
├── albums/DesktopAlbumsView.tsx
└── albums/MobileAlbumsView.tsx

client/js/src/components/filters/
└── TagFilterControls.tsx (simplify, use only store)

server/src/media/
├── songs.rs              (refactor existing endpoints, clean up)
└── mod.rs               (clean up exports)
```

### Files to Remove:

```
client/js/src/views/freqhole/context/
├── SearchContext.tsx     (functionality moved to store)
└── FreqholeContext.tsx   (unused stub)
```

## Success Criteria

### Phase 1 Complete: ✅

- [x] single FreqholeStore provider with comprehensive state
- [x] event system integrated into store actions
- [x] redundant providers removed (SearchProvider eliminated)
- [x] TagFilterControls uses only store (no manual events)
- [x] all existing functionality preserved
- [x] clean TypeScript compilation achieved
- [x] runtime errors eliminated

### Phase 2 Complete: ❌ BLOCKED

**What's Working:**

- [x] API integration - getFilterOptions() calls real endpoint with Zod validation
- [x] Type safety - proper FilterOptionsResponse schema matching actual API
- [x] Code quality - eliminated dynamic imports, proper FilterOption[] types
- [x] Context menu refactor - TagSelectorMenu uses useTagManagement hook
- [x] Utility functions - createOptionalArraySchema for handling API quirks

**What's Broken (BLOCKING):**

- [ ] Resource loading - availableTags stuck loading on initial page load
- [ ] Tag selection - selecting tags doesn't work, UI doesn't update
- [ ] Reactive updates - tagListVersion changes not triggering resource refresh
- [ ] Store architecture - module-level reactive actions causing issues
- [ ] Component integration - hooks calling wrong action patterns

### Phase 3 Complete:

- [ ] artists POST endpoint with tag filtering (GET endpoint unchanged)
- [ ] albums POST endpoint with tag filtering (GET endpoint unchanged)
- [ ] shared query logic between GET and POST variants
- [ ] proper pagination and sorting with both filtered and unfiltered requests
- [ ] clean zod validation for all endpoints
- [ ] client automatically chooses GET vs POST based on filter presence

### Phase 3 Complete:

- [x] artists views support tag filtering
- [x] albums views support tag filtering
- [x] TagFilterControls appears in all views
- [x] global tag state synchronized across views
- [x] reactive updates when tags change

### Phase 4 Complete:

- [x] comprehensive testing passed
- [x] no regressions in existing functionality
- [x] performance improvements from reduced provider complexity
- [x] clean, maintainable codebase with NO legacy code
- [x] consistent reactive patterns throughout
- [x] significantly reduced client/js/ complexity
- [x] all dead/redundant code eliminated

## Technical Benefits

### Reduced Complexity:

- single source of truth for all state
- consistent patterns across all components
- eliminated redundant provider stack entirely
- clear separation of concerns
- significantly fewer files and less complexity

### Improved Performance:

- fewer context provider re-renders
- more targeted reactive updates
- efficient event system integration
- optimized data loading patterns

### Better Developer Experience:

- single import for all state needs
- consistent API patterns
- clear event flow
- easier debugging and testing

### Future Extensibility:

- easy to add new filter types
- consistent pattern for new data sections
- scalable event system
- maintainable codebase structure
- no legacy code to work around

## Migration Risk Mitigation

**to ensure we don't break things while cleaning up:**

1. **branch strategy:** work in feature branch, test thoroughly before merge
2. **incremental testing:** after each migration step, validate all existing functionality
3. **rollback plan:** keep original implementation accessible until new one is proven
4. **component isolation:** migrate one view at a time with full testing
5. **api testing:** validate all endpoints with comprehensive test coverage

**testing checkpoints:**

- after store migration: all existing functionality intact
- after each view migration: that view + all previous views working
- after context removal: no broken imports or dead code references
- final validation: complete feature parity with cleaner codebase

## Multi-Server Architecture Preparation

**current implementation benefits for future multi-server:**

1. **server-agnostic store:** store uses injected apiClient rather than global imports
2. **factory pattern:** store creation supports multiple instances
3. **unified context:** single ServerContextProvider prepares for server switching
4. **auth integration:** auth becomes part of server context, not global
5. **clean separation:** no global state leakage between contexts

**future multi-server implementation path:**

```typescript
// future: multiple server contexts with reactive resources
interface MultiServerState {
  currentServerId: string;
  servers: Record<
    string,
    {
      store: FreqholeStore;
      actions: StoreActions;
      resources: StoreResources; // each server gets its own resources
      apiClient: ApiClient;
    }
  >;
}

// server switching would simply change currentServerId
// all resources automatically re-fetch for new server context
const switchServer = (serverId: string) => {
  setMultiServerState("currentServerId", serverId);
  // all components automatically get new server's resources
};
```

this approach allows the current refactor to naturally evolve into multi-server support without architectural rewrites.

---

## Solid-JS Reactive Benefits

**performance improvements:**

- selective fetching: resources only load when their view is active, preventing unnecessary api calls
- automatic caching: createResource provides built-in caching and deduplication
- optimistic updates: mutate provides immediate ui feedback while syncing with api
- reactive dependencies: resources automatically refetch only when relevant data changes
- coordinated updates: batch prevents excessive re-renders during multi-resource updates

**cross-view synchronization patterns:**

- currently playing indicators: useCurrentlyPlaying hook shows play state across all song displays
- playlist updates: changes to playlist name/image immediately reflect in nav sidebar
- tag filtering: only refetches the currently active view (songs/artists/albums)
- selection state: synchronized between grids, context menus, and bulk action uis
- optimistic updates: changes appear instantly across all relevant ui locations

**Real-World Examples:**

```typescript
// example 1: virtualized grid with currently playing sync
const VirtualizedSongGrid = () => {
  const { songs } = useDataSections();
  const { isCurrentlyPlaying } = useCurrentlyPlaying();
  const virtualizationActions = useVirtualization();

  return (
    <VirtualizedInfiniteGrid
      items={songs.data}
      viewType="songs"
      onLoadMore={virtualizationActions.loadMorePages}
      onScrollPositionChange={virtualizationActions.saveScrollPosition}
      renderItem={(song) => (
        <div class={`song-row ${isCurrentlyPlaying()(song.id) ? 'playing' : ''}`}>
          <Show when={isCurrentlyPlaying()(song.id)}>
            <PlayingIndicator />
          </Show>
          {/* song content */}
        </div>
      )}
    />
  );
};

// example 2: tag context menu with full reactive integration
const TagContextMenu = (props: { songIds: string[] }) => {
  const tagManagement = useTagContextMenu();

  const handleCreateAndAdd = async (newTagName: string) => {
    try {
      // this handles ALL the reactive complexity:
      // 1. optimistic updates to song displays
      // 2. api calls to create tag and update songs
      // 3. global tag list refresh
      // 4. current view data refresh
      // 5. error rollback if needed
      await tagManagement.createTagAndAddToSongs(props.songIds, newTagName);

      // everything else happens automatically via reactive patterns!
    } catch (error) {
      // error handling - optimistic updates already rolled back
    }
  };

  return (
    <ContextMenu>
      <TagSubmenu
        availableTags={tagManagement.availableTags()}
        onCreateAndAdd={handleCreateAndAdd}
        loading={tagManagement.loading}
      />
    </ContextMenu>
  );
};

// example 3: playlist nav with scroll restoration
const PlaylistNavigation = () => {
  const { recentPlaylists, currentView } = useNavigation();
  const router = useRouter();

  const handlePlaylistClick = (playlist: Playlist) => {
    // navigate to playlist view
    router.navigate(`/playlists/${playlist.id}`);

    // scroll restoration happens automatically when playlist view loads
    // via virtualization system
  };

  return (
    <div class="playlist-nav">
      <For each={recentPlaylists()}>
        {(playlist) => (
          <div
            class="playlist-item"
            onClick={() => handlePlaylistClick(playlist)}
          >
            {/* this automatically updates when playlist changes anywhere */}
            <img src={playlist.image_url} />
            <span>{playlist.name}</span>
            <span class="count">{playlist.song_count}</span>
          </div>
        )}
      </For>
    </div>
  );
};

// example 4: scroll restoration integration
const SongsView = () => {
  const virtualization = useVirtualization();
  const router = useRouter();

  onMount(() => {
    // check if we need to restore scroll position
    const savedScrollOffset = router.getScrollPosition('/songs');
    if (savedScrollOffset > 0) {
      // this triggers loading necessary pages and restoring scroll
      virtualization.restoreScrollPosition('/songs', savedScrollOffset);
    }
  });

  return (
    <VirtualizedInfiniteGrid
      // grid automatically handles virtualization, infinite scroll,
      // and scroll position saving
    />
  );
};
```

**developer experience:**

- performance by default: no accidental over-fetching
- automatic synchronization: changes propagate across ui without manual coordination
- declarative patterns: components describe what they need, not how to get it
- clear reactive chains: solid-js dev tools show exactly what triggers updates

This plan provides a comprehensive approach to both solving the current state management complexity and implementing Phase 4 tag filtering features while ELIMINATING legacy code and making the entire client/js/ codebase significantly cleaner and more maintainable, with subtle architectural decisions that prepare for future multi-server functionality and leverage solid-js reactive primitives for optimal performance and developer experience.
