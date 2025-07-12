# Multi-Column Data Architecture Analysis

## Vision: Three-Column Interface

```
┌─────────────┬──────────────────┬────────────────────────┐
│ Navigation  │ Collection View  │ Detail/Action View     │
├─────────────┼──────────────────┼────────────────────────┤
│ • artists   │ ┌──────────────┐ │ ┌──────────────────────┐│
│ • albums    │ │ Artist Name  │ │ │ ♪ Song Title         ││
│ • playlists │ │ 45 songs     │ │ │   Artist • Album     ││
│ • genres    │ └──────────────┘ │ │   [▶] [+] [⋯]       ││
│ • years     │ ┌──────────────┐ │ └──────────────────────┘│
│             │ │ Artist Name  │ │ ┌──────────────────────┐│
│             │ │ 23 songs     │ │ │ ♪ Song Title         ││
│             │ └──────────────┘ │ │   Artist • Album     ││
│             │      ...         │ │   [▶] [+] [⋯]       ││
│             │ [load more]      │ └──────────────────────┘│
└─────────────┴──────────────────┴────────────────────────┘
```

## Current Problems with Multi-Column Approach

### 1. Data Relationship Complexity

- Column 2 depends on Column 1 selection
- Column 3 depends on Column 2 selection
- Each column needs its own infinite scroll
- Data invalidation cascades across columns

### 2. State Management Explosion

- 3 independent infinite scroll states
- Selection state for each column
- Loading states for each column
- Error states for each column
- Cache invalidation between columns

### 3. Current API Limitations

```typescript
// Current: Each column requires separate API calls
const artists = await apiClient.getArtists({ page: 1 });
const artistSongs = await apiClient.getArtistSongs(selectedArtist, { page: 1 });
const songDetails = await apiClient.getSong(selectedSong);
```

## Alternative Architectures

### Option A: Unified Data Stream API

**Concept**: Single API endpoint that returns all related data in one request.

```typescript
// New API Design
GET /api/music/browse?type=artists&page=1&include=songs,albums

Response:
{
  "primary": {
    "items": [
      {
        "id": "artist-1",
        "name": "Pink Floyd",
        "type": "artist",
        "song_count": 147,
        "album_count": 15,
        // Embedded related data
        "songs": [
          { "id": "song-1", "title": "Comfortably Numb", ... },
          { "id": "song-2", "title": "Time", ... }
          // ... top 10 songs
        ],
        "albums": [
          { "id": "album-1", "title": "Dark Side of the Moon", ... }
          // ... top 5 albums
        ]
      }
    ],
    "pagination": { "page": 1, "has_next": true, ... }
  },
  "related": {
    "songs": {
      "items": [...], // All songs for visible artists
      "pagination": { ... }
    },
    "albums": {
      "items": [...], // All albums for visible artists
      "pagination": { ... }
    }
  }
}
```

**Client Usage**:

```typescript
const useBrowseData = (type: string) => {
  const [data, setData] = createSignal(null);

  const loadMore = async (page = 1) => {
    const result = await apiClient.browse({
      type,
      page,
      include: ["songs", "albums"],
    });

    if (page === 1) {
      setData(result);
    } else {
      // Merge pagination data
      setData((prev) => ({
        primary: {
          items: [...prev.primary.items, ...result.primary.items],
          pagination: result.primary.pagination,
        },
        related: result.related,
      }));
    }
  };

  return { data, loadMore };
};
```

**Pros**:

- Single API call for all column data
- Reduced network requests
- Consistent data relationships
- No cascade loading delays

**Cons**:

- Large response payloads
- Over-fetching unused data
- Complex server-side joins
- Cache invalidation complexity

---

### Option B: Reactive Data Subscriptions

**Concept**: WebSocket-based reactive data streams that push updates.

```typescript
// API Design
const musicStream = new MusicDataStream();

// Subscribe to data changes
musicStream.subscribe('artists', { page: 1 }, (data) => {
  // Automatically receive paginated artists
});

musicStream.subscribe('artist:123:songs', { page: 1 }, (data) => {
  // Automatically receive songs when artist selected
});

// Client automatically receives:
{
  "type": "artists",
  "operation": "append", // or "replace", "update", "delete"
  "data": [...],
  "pagination": {...}
}
```

**Client Usage**:

```typescript
const useReactiveData = (subscription: string) => {
  const [items, setItems] = createSignal([]);
  const [loading, setLoading] = createSignal(false);

  onMount(() => {
    const stream = musicStream.subscribe(subscription, {
      onData: (data) => {
        if (data.operation === "append") {
          setItems((prev) => [...prev, ...data.items]);
        } else if (data.operation === "replace") {
          setItems(data.items);
        }
      },
      onLoading: (state) => setLoading(state),
    });

    onCleanup(() => stream.unsubscribe());
  });

  return { items, loading };
};
```

**Pros**:

- Real-time updates
- Automatic data synchronization
- Efficient network usage
- Natural reactive patterns

**Cons**:

- Complex infrastructure
- WebSocket connection management
- Offline handling complexity
- Higher server resource usage

---

### Option C: Virtual Data Grid API

**Concept**: API that treats all music data as a virtual 2D grid.

```typescript
// API Design - Virtual Grid Approach
GET /api/music/grid?
  rows=artists&
  cols=songs&
  row_range=0-50&
  col_range=0-20&
  row_filter=genre:rock&
  col_filter=year:2020

Response:
{
  "grid": {
    "rows": [
      {
        "id": "artist-1",
        "data": { "name": "Pink Floyd", ... },
        "cells": [
          { "col_id": "song-1", "data": {...} },
          { "col_id": "song-2", "data": {...} }
        ]
      }
    ],
    "columns": [
      { "id": "song-1", "data": { "title": "Time", ... } },
      { "id": "song-2", "data": { "title": "Money", ... } }
    ]
  },
  "pagination": {
    "rows": { "start": 0, "end": 50, "total": 1200, "has_next": true },
    "cols": { "start": 0, "end": 20, "total": 50000, "has_next": true }
  }
}
```

**Client Usage**:

```typescript
const useVirtualGrid = (rowType: string, colType: string) => {
  const [grid, setGrid] = createSignal({ rows: [], columns: [] });

  const loadMoreRows = async () => {
    const result = await apiClient.getGrid({
      rows: rowType,
      cols: colType,
      row_range: `${grid().rows.length}-${grid().rows.length + 50}`,
    });

    setGrid((prev) => ({
      rows: [...prev.rows, ...result.grid.rows],
      columns: result.grid.columns, // Replace columns
    }));
  };

  const loadMoreCols = async () => {
    // Similar for columns
  };

  return { grid, loadMoreRows, loadMoreCols };
};
```

**Pros**:

- Unified data model
- Efficient pagination in 2D
- Flexible filtering/sorting
- Natural fit for column layouts

**Cons**:

- Complex mental model
- API complexity
- Potential over-engineering
- Harder to optimize queries

---

### Option D: Declarative Data Dependencies

**Concept**: Client declares what data it needs, server optimizes delivery.

```typescript
// Client declares data requirements
const dataSpec = {
  primary: {
    type: "artists",
    pagination: { page: 1, size: 50 },
    include: ["song_count", "album_count"],
  },
  dependencies: {
    "artist.selected": {
      type: "songs",
      filter: { artist_id: "${primary.selected.id}" },
      pagination: { page: 1, size: 20 },
      include: ["duration", "album", "year"],
    },
    "song.selected": {
      type: "song_details",
      filter: { song_id: "${dependencies.artist.selected.selected.id}" },
      include: ["waveform", "lyrics", "similar_songs"],
    },
  },
};

// Single API call
const result = await apiClient.getData(dataSpec);
```

**Server Response**:

```typescript
{
  "primary": {
    "items": [...], // Artists
    "pagination": {...},
    "selected": null // No selection yet
  },
  "dependencies": {
    "artist.selected": {
      "items": [], // Empty until artist selected
      "pagination": {...},
      "selected": null
    },
    "song.selected": {
      "items": [], // Empty until song selected
      "pagination": {...}
    }
  },
  "mutations": [
    {
      "trigger": "primary.selected",
      "action": "load",
      "target": "dependencies.artist.selected"
    }
  ]
}
```

**Client Usage**:

```typescript
const useDeclarativeData = (spec) => {
  const [data, setData] = createSignal(null);
  const [selections, setSelections] = createSignal({});

  const select = async (path: string, item: any) => {
    setSelections((prev) => ({ ...prev, [path]: item }));

    // Automatically trigger dependent data loads
    const mutations = data().mutations.filter((m) => m.trigger === path);
    for (const mutation of mutations) {
      await loadDependentData(mutation.target, item);
    }
  };

  return { data, selections, select };
};
```

**Pros**:

- Declarative data requirements
- Automatic dependency resolution
- Optimized server queries
- Clear data relationships

**Cons**:

- Complex specification format
- Server-side complexity
- Learning curve
- Debugging difficulty

---

## Recommended Approach: Hybrid Declarative + Simple Pagination

**Best of both worlds**: Combine simple pagination with declarative dependencies.

### API Design

```typescript
// Primary data endpoint (simple)
GET /api/music/artists?page=1&size=50
Response: { items: [...], pagination: {...} }

// Dependent data endpoint (declarative)
GET /api/music/related?
  primary=artist:123&
  include=songs,albums&
  songs.page=1&
  songs.size=20&
  albums.page=1&
  albums.size=10

Response: {
  "songs": {
    "items": [...],
    "pagination": {...}
  },
  "albums": {
    "items": [...],
    "pagination": {...}
  }
}
```

### Client Implementation

```typescript
// Column 1: Simple infinite scroll
const useColumn1Data = (type: string) => {
  const [items, setItems] = createSignal([]);
  const [pagination, setPagination] = createSignal(null);
  const [selected, setSelected] = createSignal(null);

  const loadMore = async () => {
    const result = await apiClient.getItems(type, {
      page: pagination()?.page + 1 ?? 1
    });
    setItems(prev => [...prev, ...result.items]);
    setPagination(result.pagination);
  };

  return { items, loadMore, selected, setSelected };
};

// Columns 2+3: Related data
const useRelatedData = (primaryItem, includes) => {
  const [data, setData] = createSignal({});

  const loadRelated = async () => {
    if (!primaryItem()) return;

    const result = await apiClient.getRelated(primaryItem().id, {
      include: includes,
      'songs.page': 1,
      'albums.page': 1
    });

    setData(result);
  };

  // Auto-load when primary changes
  createEffect(() => {
    if (primaryItem()) loadRelated();
  });

  const loadMoreRelated = async (type: string) => {
    const currentPagination = data()[type]?.pagination;
    const nextPage = currentPagination?.page + 1;

    const result = await apiClient.getRelated(primaryItem().id, {
      include: [type],
      [`${type}.page`]: nextPage
    });

    setData(prev => ({
      ...prev,
      [type]: {
        items: [...prev[type].items, ...result[type].items],
        pagination: result[type].pagination
      }
    }));
  };

  return { data, loadMoreRelated };
};

// Main component
const MultiColumnView = () => {
  const column1 = useColumn1Data('artists');
  const related = useRelatedData(column1.selected, ['songs', 'albums']);

  return (
    <div class="grid grid-cols-3">
      {/* Column 1 */}
      <div>
        <For each={column1.items()}>
          {item => (
            <div
              onClick={() => column1.setSelected(item)}
              class={column1.selected()?.id === item.id ? 'selected' : ''}
            >
              {item.name}
            </div>
          )}
        </For>
        <Show when={column1.hasMore()}>
          <button onClick={column1.loadMore}>load more</button>
        </Show>
      </div>

      {/* Column 2 */}
      <div>
        <For each={related.data().songs?.items ?? []}>
          {song => <SongItem song={song} />}
        </For>
        <Show when={related.data().songs?.pagination?.has_next}>
          <button onClick={() => related.loadMoreRelated('songs')}>
            load more songs
          </button>
        </Show>
      </div>

      {/* Column 3 - Future: song details, similar songs, etc. */}
      <div>
        {/* Song details, actions, etc. */}
      </div>
    </div>
  );
};
```

## Benefits of Hybrid Approach

1. **Simple Mental Model**: Each column is independent infinite scroll
2. **Efficient Network**: Related data loaded together, but not over-fetched
3. **Easy to Implement**: Builds on existing patterns
4. **Scalable**: Easy to add new columns/relationships
5. **Debuggable**: Clear data flow and state management
6. **Performance**: Optimized queries, minimal round trips

## Implementation Strategy

### Phase 1: API Updates

1. Add `/api/music/related` endpoint
2. Support multiple data types in one request
3. Individual pagination for each data type

### Phase 2: Client Refactoring

1. Create `useColumn1Data` hook (simple infinite scroll)
2. Create `useRelatedData` hook (dependent data loading)
3. Replace current UI with multi-column layout

### Phase 3: Enhancements

1. Add caching for primary selections
2. Add prefetching for likely selections
3. Add optimistic updates

This approach gives you clean separation between independent data (column 1) and dependent data (columns 2+), while keeping the implementation simple and the API efficient.

## Search Integration & Responsive Design

### Search Results in Multi-Column Layout

When search is active, the interface adapts to show grouped results across columns:

```
Desktop (3-column):
┌─────────────┬──────────────────┬────────────────────────┐
│ Navigation  │ Search Groups    │ Selected Group Results │
├─────────────┼──────────────────┼────────────────────────┤
│ • search    │ ┌──────────────┐ │ ┌──────────────────────┐│
│ • artists   │ │ Songs (47)   │ │ │ ♪ Song Title         ││
│ • albums    │ │              │ │ │   Artist • Album     ││
│ • playlists │ └──────────────┘ │ │   [▶] [+] [⋯]       ││
│ • genres    │ ┌──────────────┐ │ └──────────────────────┘│
│             │ │ Artists (12) │ │ ┌──────────────────────┐│
│             │ │              │ │ │ ♪ Song Title         ││
│             │ └──────────────┘ │ │   Artist • Album     ││
│             │ ┌──────────────┐ │ │   [▶] [+] [⋯]       ││
│             │ │ Albums (8)   │ │ └──────────────────────┘│
│             │ └──────────────┘ │      [load more]        │
└─────────────┴──────────────────┴────────────────────────┘

Mobile/Narrow (single column):
┌────────────────────────────────────────┐
│ Search: "pink floyd"                   │
├────────────────────────────────────────┤
│ Songs (47)                             │
│ ┌────────────────────────────────────┐ │
│ │ ♪ Comfortably Numb                │ │
│ │   Pink Floyd • The Wall           │ │
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │
│ │ ♪ Time                             │ │
│ │   Pink Floyd • Dark Side of Moon  │ │
│ └────────────────────────────────────┘ │
│      [load more songs]                 │
│                                        │
│ Artists (12)                           │
│ ┌────────────────────────────────────┐ │
│ │ Pink Floyd                         │ │
│ │ 147 songs • 15 albums              │ │
│ └────────────────────────────────────┘ │
│      [load more artists]               │
│                                        │
│ Albums (8)                             │
│ ┌────────────────────────────────────┐ │
│ │ Dark Side of the Moon              │ │
│ │ Pink Floyd • 1973                  │ │
│ └────────────────────────────────────┘ │
│      [load more albums]                │
└────────────────────────────────────────┘
```

### Search API Design

```typescript
// Search endpoint returns grouped results
GET /api/music/search?q=pink%20floyd&page=1&group=songs,artists,albums

Response: {
  "query": "pink floyd",
  "groups": {
    "songs": {
      "items": [...],
      "total": 47,
      "pagination": { "page": 1, "has_next": true, ... }
    },
    "artists": {
      "items": [...],
      "total": 12,
      "pagination": { "page": 1, "has_next": true, ... }
    },
    "albums": {
      "items": [...],
      "total": 8,
      "pagination": { "page": 1, "has_next": true, ... }
    }
  },
  "suggestions": ["pink", "floyd", "dark side of the moon"]
}

// Load more from specific group
GET /api/music/search?q=pink%20floyd&group=songs&page=2

Response: {
  "query": "pink floyd",
  "group": "songs",
  "items": [...],
  "pagination": { "page": 2, "has_next": true, ... }
}
```

### Search Implementation

```typescript
// Search state management
const useSearchState = () => {
  const [query, setQuery] = createSignal('');
  const [isActive, setIsActive] = createSignal(false);
  const [results, setResults] = createSignal(null);
  const [selectedGroup, setSelectedGroup] = createSignal('songs');

  const search = async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setIsActive(false);
      setResults(null);
      return;
    }

    setQuery(searchQuery);
    setIsActive(true);

    const response = await apiClient.search({
      q: searchQuery,
      groups: ['songs', 'artists', 'albums'],
      page: 1
    });

    setResults(response);

    // Auto-select group with most results
    const groupCounts = Object.entries(response.groups)
      .map(([key, data]) => ({ key, count: data.total }))
      .sort((a, b) => b.count - a.count);

    if (groupCounts.length > 0) {
      setSelectedGroup(groupCounts[0].key);
    }
  };

  const loadMoreGroup = async (groupType: string) => {
    const currentGroup = results().groups[groupType];
    const nextPage = currentGroup.pagination.page + 1;

    const response = await apiClient.search({
      q: query(),
      group: groupType,
      page: nextPage
    });

    setResults(prev => ({
      ...prev,
      groups: {
        ...prev.groups,
        [groupType]: {
          items: [...currentGroup.items, ...response.items],
          total: currentGroup.total,
          pagination: response.pagination
        }
      }
    }));
  };

  return {
    query,
    isActive,
    results,
    selectedGroup,
    setSelectedGroup,
    search,
    loadMoreGroup
  };
};

// Responsive search component
const SearchResults = () => {
  const search = useSearchState();
  const [isWideScreen, setIsWideScreen] = createSignal(window.innerWidth >= 1024);

  // Responsive breakpoint detection
  createEffect(() => {
    const handleResize = () => setIsWideScreen(window.innerWidth >= 1024);
    window.addEventListener('resize', handleResize);
    onCleanup(() => window.removeEventListener('resize', handleResize));
  });

  return (
    <Show when={search.isActive()}>
      <Show
        when={isWideScreen()}
        fallback={<MobileSearchLayout search={search} />}
      >
        <DesktopSearchLayout search={search} />
      </Show>
    </Show>
  );
};

// Desktop: Groups in column 2, results in column 3
const DesktopSearchLayout = ({ search }) => (
  <div class="grid grid-cols-3">
    <div>
      {/* Navigation column stays the same */}
    </div>

    <div>
      {/* Search groups column */}
      <div class="text-sm text-gray-400 mb-4">
        Search: "{search.query()}"
      </div>

      <For each={Object.entries(search.results().groups)}>
        {([groupType, groupData]) => (
          <div
            class={`p-3 cursor-pointer border-l-4 ${
              search.selectedGroup() === groupType
                ? 'bg-primary-500/20 border-primary-500'
                : 'border-transparent hover:bg-dark-200'
            }`}
            onClick={() => search.setSelectedGroup(groupType)}
          >
            <div class="font-medium capitalize">{groupType}</div>
            <div class="text-sm text-gray-400">({groupData.total})</div>
          </div>
        )}
      </For>
    </div>

    <div>
      {/* Selected group results */}
      <SearchGroupResults
        group={search.selectedGroup()}
        data={search.results().groups[search.selectedGroup()]}
        onLoadMore={() => search.loadMoreGroup(search.selectedGroup())}
      />
    </div>
  </div>
);

// Mobile: Inline grouped results
const MobileSearchLayout = ({ search }) => (
  <div class="space-y-6">
    <div class="text-sm text-gray-400">
      Search: "{search.query()}"
    </div>

    <For each={Object.entries(search.results().groups)}>
      {([groupType, groupData]) => (
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="font-medium capitalize">{groupType} ({groupData.total})</h3>
          </div>

          <div class="space-y-2">
            <For each={groupData.items.slice(0, 5)}>
              {item => <SearchResultItem item={item} type={groupType} />}
            </For>
          </div>

          <Show when={groupData.pagination.has_next || groupData.items.length > 5}>
            <button
              class="text-primary-400 hover:text-primary-300 text-sm"
              onClick={() => {
                if (groupData.items.length > 5) {
                  // Show all loaded items first
                  expandGroup(groupType);
                } else {
                  // Load more from server
                  search.loadMoreGroup(groupType);
                }
              }}
            >
              {groupData.items.length > 5 ? 'show all' : 'load more'} {groupType}
            </button>
          </Show>
        </div>
      )}
    </For>
  </div>
);
```

### Responsive Design Strategy

#### Breakpoints

- **Desktop (≥1024px)**: 3-column layout with search groups in column 2
- **Tablet (768-1023px)**: 2-column layout with inline grouped results
- **Mobile (<768px)**: Single column with grouped sections

#### Search UX Patterns

1. **Desktop**: Group selection in sidebar, results in main area
2. **Mobile**: Grouped sections with "show more" expansion
3. **Empty states**: Show suggestions and recent searches
4. **Loading states**: Progressive loading per group type

#### Performance Considerations

- **Debounced search**: 300ms delay before API call
- **Result limits**: Show top 5 per group initially on mobile
- **Infinite scroll**: Only in selected group on desktop
- **Caching**: Cache search results for 5 minutes

This search integration maintains the clean column separation while providing a responsive experience that works well on all screen sizes.
