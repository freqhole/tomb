# Infinite Scroll Refactoring Plan

## Current Problem Analysis

### What's Broken
1. **Complex State Management**: Single `useMusicState` hook managing 4 different views with repetitive switch statements
2. **Reactivity Issues**: Multiple signals/memos not triggering UI updates properly
3. **Verbose Code**: Same switch statement pattern repeated 5+ times across codebase
4. **Poor Separation**: Data fetching, pagination, and UI logic all tangled together
5. **Hard to Debug**: Complex signal dependencies making it unclear why UI doesn't update

### Root Cause
We tried to create a "unified" infinite scroll system that handles all views in one place, but this created more complexity than it solved. The abstraction is fighting against SolidJS's reactive patterns.

## Proposed Solutions

### Option 1: View-Specific Hooks Pattern

**Concept**: Create dedicated hooks for each data type instead of one mega-hook.

```typescript
// Each view gets its own focused hook
const useSongsData = () => {
  const [items, setItems] = createSignal<Song[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [pagination, setPagination] = createSignal(null);

  const hasMore = () => pagination()?.has_next ?? true;

  const loadMore = async () => {
    if (loading() || !hasMore()) return;
    setLoading(true);
    const result = await apiClient.getSongs({ page: getNextPage() });
    setItems(prev => [...prev, ...result.songs]);
    setPagination(result.pagination);
    setLoading(false);
  };

  const reset = () => {
    setItems([]);
    setPagination(null);
  };

  return { items, loading, hasMore, loadMore, reset };
};

// Similar hooks for albums, artists, playlists
const useAlbumsData = () => { /* same pattern */ };
const useArtistsData = () => { /* same pattern */ };
const usePlaylistsData = () => { /* same pattern */ };

// Main hook just coordinates between views
const useMusicState = () => {
  const [currentView, setCurrentView] = createSignal("music");

  const songsData = useSongsData();
  const albumsData = useAlbumsData();
  const artistsData = useArtistsData();
  const playlistsData = usePlaylistsData();

  const changeView = (view) => {
    setCurrentView(view);
    // Trigger load if needed
    const dataHook = getDataHookForView(view);
    if (dataHook.items().length === 0) {
      dataHook.loadMore();
    }
  };

  const getCurrentData = () => {
    switch (currentView()) {
      case "music": return songsData;
      case "albums": return albumsData;
      case "artists": return artistsData;
      case "playlists": return playlistsData;
    }
  };

  return { currentView, changeView, getCurrentData };
};
```

**UI Usage**:
```tsx
const FreqholeContent = () => {
  const music = useMusicState();
  const currentData = music.getCurrentData();

  return (
    <div>
      <For each={currentData.items()}>{item => <Item item={item} />}</For>

      <Show when={currentData.loading()}>
        <div>loading more...</div>
      </Show>

      <Show when={currentData.hasMore() && !currentData.loading()}>
        <button onClick={currentData.loadMore}>load more</button>
      </Show>
    </div>
  );
};
```

**Pros**:
- Simple, focused hooks
- Clear separation of concerns
- Easy to debug individual views
- No complex switch statements

**Cons**:
- Some code duplication between hooks
- Still one switch statement in UI
- Need to manually coordinate between hooks

**Complexity**: Low
**Migration Effort**: Medium - can migrate one view at a time

---

### Option 2: Generic Data Hook Pattern

**Concept**: Create a reusable infinite data hook that works with any data type.

```typescript
// Generic reusable hook
const useInfiniteData = <T>(
  fetcher: (page: number) => Promise<{items: T[], pagination: any}>,
  options: {
    enabled?: () => boolean;
    pageSize?: number;
    onError?: (error: Error) => void;
  } = {}
) => {
  const [items, setItems] = createSignal<T[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [pagination, setPagination] = createSignal(null);

  const hasMore = () => pagination()?.has_next ?? true;
  const enabled = options.enabled ?? (() => true);

  const loadMore = async () => {
    if (loading() || !hasMore() || !enabled()) return;

    try {
      setLoading(true);
      setError(null);
      const nextPage = pagination()?.page + 1 ?? 1;
      const result = await fetcher(nextPage);
      setItems(prev => [...prev, ...result.items]);
      setPagination(result.pagination);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Load failed';
      setError(errorMsg);
      options.onError?.(err);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setItems([]);
    setPagination(null);
    setError(null);
  };

  // Auto-load first page
  createEffect(() => {
    if (enabled() && items().length === 0 && !loading()) {
      loadMore();
    }
  });

  return { items, loading, error, hasMore, loadMore, reset };
};

// Create fetcher functions
const songsFetcher = (page: number) =>
  apiClient.getSongs({ page, page_size: 50 }).then(result => ({
    items: result.songs.map(transformSong),
    pagination: result.pagination
  }));

const albumsFetcher = (page: number) =>
  apiClient.getAlbums({ page, page_size: 50 }).then(result => ({
    items: result.albums.map(transformAlbum),
    pagination: result.pagination
  }));

// Usage in main hook
const useMusicState = () => {
  const [currentView, setCurrentView] = createSignal("music");

  const songsData = useInfiniteData(songsFetcher, {
    enabled: () => currentView() === "music"
  });

  const albumsData = useInfiniteData(albumsFetcher, {
    enabled: () => currentView() === "albums"
  });

  const artistsData = useInfiniteData(artistsFetcher, {
    enabled: () => currentView() === "artists"
  });

  const playlistsData = useInfiniteData(playlistsFetcher, {
    enabled: () => currentView() === "playlists"
  });

  const changeView = (newView) => {
    setCurrentView(newView);
  };

  // Simple accessors - no switch statements!
  const currentItems = () => {
    if (currentView() === "music") return songsData.items();
    if (currentView() === "albums") return albumsData.items();
    if (currentView() === "artists") return artistsData.items();
    if (currentView() === "playlists") return playlistsData.items();
    return [];
  };

  const currentLoading = () => {
    if (currentView() === "music") return songsData.loading();
    if (currentView() === "albums") return albumsData.loading();
    if (currentView() === "artists") return artistsData.loading();
    if (currentView() === "playlists") return playlistsData.loading();
    return false;
  };

  const currentHasMore = () => {
    if (currentView() === "music") return songsData.hasMore();
    if (currentView() === "albums") return albumsData.hasMore();
    if (currentView() === "artists") return artistsData.hasMore();
    if (currentView() === "playlists") return playlistsData.hasMore();
    return false;
  };

  const loadMore = () => {
    if (currentView() === "music") return songsData.loadMore();
    if (currentView() === "albums") return albumsData.loadMore();
    if (currentView() === "artists") return artistsData.loadMore();
    if (currentView() === "playlists") return playlistsData.loadMore();
  };

  return {
    currentView,
    changeView,
    currentItems,
    currentLoading,
    currentHasMore,
    loadMore
  };
};
```

**UI Usage**:
```tsx
const FreqholeContent = () => {
  const music = useMusicState();

  return (
    <div>
      <For each={music.currentItems()}>{item => <Item item={item} />}</For>

      <Show when={music.currentLoading()}>
        <div>loading more...</div>
      </Show>

      <Show when={music.currentHasMore() && !music.currentLoading()}>
        <button onClick={music.loadMore}>load more</button>
      </Show>
    </div>
  );
};
```

**Pros**:
- Reusable infinite data pattern
- Each data source is independent
- Clean separation of concerns
- UI is very simple
- Easy to add new data types

**Cons**:
- Still some conditional logic for current view
- Generic hook might be overkill for simple cases

**Complexity**: Medium
**Migration Effort**: Medium - replace existing hook

---

### Option 3: State Machine Pattern

**Concept**: Use SolidJS Store with a state machine approach.

```typescript
import { createStore } from "solid-js/store";

const useMusicState = () => {
  const [currentView, setCurrentView] = createSignal("music");

  const [viewData, setViewData] = createStore({
    music: { items: [], loading: false, pagination: null, error: null },
    albums: { items: [], loading: false, pagination: null, error: null },
    artists: { items: [], loading: false, pagination: null, error: null },
    playlists: { items: [], loading: false, pagination: null, error: null }
  });

  const hasMore = (view: string) => viewData[view].pagination?.has_next ?? true;

  const loadMore = async (view: string) => {
    if (viewData[view].loading || !hasMore(view)) return;

    setViewData(view, "loading", true);
    setViewData(view, "error", null);

    try {
      const nextPage = viewData[view].pagination?.page + 1 ?? 1;
      const result = await fetchDataForView(view, nextPage);

      setViewData(view, "items", prev => [...prev, ...result.items]);
      setViewData(view, "pagination", result.pagination);
    } catch (err) {
      setViewData(view, "error", err.message);
    } finally {
      setViewData(view, "loading", false);
    }
  };

  const changeView = (newView) => {
    setCurrentView(newView);
    // Auto-load if empty
    if (viewData[newView].items.length === 0) {
      loadMore(newView);
    }
  };

  const currentData = () => viewData[currentView()];

  return {
    currentView,
    changeView,
    currentData,
    loadMore: () => loadMore(currentView()),
    hasMore: () => hasMore(currentView())
  };
};

const fetchDataForView = async (view: string, page: number) => {
  switch (view) {
    case "music": return apiClient.getSongs({ page, page_size: 50 });
    case "albums": return apiClient.getAlbums({ page, page_size: 50 });
    case "artists": return apiClient.getArtists({ page, page_size: 50 });
    case "playlists": return apiClient.getPlaylists({ page, page_size: 50 });
  }
};
```

**UI Usage**:
```tsx
const FreqholeContent = () => {
  const music = useMusicState();
  const data = music.currentData();

  return (
    <div>
      <For each={data.items}>{item => <Item item={item} />}</For>

      <Show when={data.loading}>
        <div>loading more...</div>
      </Show>

      <Show when={music.hasMore() && !data.loading}>
        <button onClick={music.loadMore}>load more</button>
      </Show>
    </div>
  );
};
```

**Pros**:
- Single source of truth
- SolidJS Store handles reactivity well
- Centralized state management
- Simple UI logic

**Cons**:
- All data lives in one store (memory usage)
- Less modular than separate hooks
- Still some switch statements

**Complexity**: Medium
**Migration Effort**: High - complete rewrite

---

## Recommendation: Option 2 (Generic Data Hook)

**Why Option 2 is Best**:

1. **Fixes Current Issues**:
   - Eliminates complex switch statements in UI
   - Each data source is independent (no signal conflicts)
   - Clear reactive dependencies
   - Simple to debug

2. **Scalability**:
   - Easy to add new views (just create new fetcher)
   - Reusable pattern for future features
   - Can easily add features like caching, prefetching, etc.

3. **Maintainability**:
   - Each infinite data hook is isolated
   - Generic hook can be improved once, benefits all views
   - Clear separation between data fetching and UI logic

4. **Migration Path**:
   - Can implement incrementally
   - Replace existing `useMusicState` with new version
   - Keep same API for UI components

## Implementation Plan

### Phase 1: Create Generic Hook
1. Create `useInfiniteData` hook in new file
2. Create fetcher functions for each data type
3. Add comprehensive testing

### Phase 2: Replace Music State
1. Rewrite `useMusicState` using generic hooks
2. Simplify state accessors (remove switch statements)
3. Keep same public API for backward compatibility

### Phase 3: Simplify UI
1. Update UI to use simplified accessors
2. Remove complex Show component logic
3. Add proper scroll detection

### Phase 4: Add Enhancements
1. Add automatic scroll-to-load
2. Add caching between view switches
3. Add error handling and retry logic

## Expected Benefits

- **Bug Fix**: Load more buttons will properly hide
- **Performance**: Only active view loads data
- **Developer Experience**: Much easier to add new views
- **Code Quality**: ~50% reduction in complexity
- **Maintainability**: Clear, focused responsibilities

## Migration Effort

- **Time Estimate**: 2-3 hours
- **Risk Level**: Low (can implement alongside existing code)
- **Testing**: Each hook can be tested independently
- **Rollback**: Easy to revert if issues arise

## Next Steps

1. Create `useInfiniteData` hook
2. Create fetcher functions
3. Replace `useMusicState` implementation
4. Update UI components
5. Remove old debugging code
6. Add scroll detection

This approach will solve the current reactivity issues while creating a much cleaner, more maintainable codebase.
