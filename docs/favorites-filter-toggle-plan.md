# Favorites Filter Toggle Implementation Plan

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

## Overview

Transform the `is_favorite` column from a sortable column to a toggle filter button that filters the dataset to show only favorited items when active. This filter should work independently of other column sorting, allowing users to sort favorites by any other column.

## Current Architecture Analysis

### API Support

- **Search API**: `/api/music/search/songs` supports `favorites_only: boolean` parameter
- **Data Validation**: `MusicSearchOptionsSchema` already includes `favorites_only` field
- **Existing Hooks**: `useMusicUserData.ts` has `showFavoritesOnly()` signal and filtering logic
- **Admin Hooks**: `useMusicAdminData.ts` has `filterFavorites(favoritesOnly: boolean)` method

### Current Grid Implementation

- **FreqholeInfiniteGrid**: Has `is_favorite` column with sorting capability
- **Grid Header**: Uses `GridHeader.tsx` with standard sort indicators
- **Sort Handling**: Column clicks trigger `onSort` callback with field/direction
- **Data Flow**: Sort changes → store actions → API calls → data reload

## Technical Implementation Plan

### 1. Create Filter Toggle Component

**File**: `client/js/src/components/filters/FavoriteToggle.tsx`

```typescript
interface FavoriteToggleProps {
  active: boolean;
  onToggle: (active: boolean) => void;
  class?: string;
}

export function FavoriteToggle(props: FavoriteToggleProps) {
  return (
    <button
      class={`
        flex items-center justify-center w-full h-full transition-colors
        ${props.active
          ? 'text-white'
          : 'text-gray-400 hover:text-white'
        }
        ${props.class || ''}
      `}
      onClick={() => props.onToggle(!props.active)}
      title={props.active ? 'show all songs' : 'show favorites only'}
    >
      {props.active ? (
        // Filled heart when active
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      ) : (
        // Outlined heart when inactive
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      )}
    </button>
  );
}
```

### 2. Extend Store State for Filtering

**File**: `client/js/src/views/freqhole/store/index.ts` (modifications)

Add to existing state:

```typescript
interface FreqholeState {
  // ... existing state
  filters: {
    favoritesOnly: boolean;
    // future filters can be added here
  };
}
```

Add to actions:

```typescript
interface FreqholeActions {
  // ... existing actions
  toggleFavoritesFilter: () => void;
  setFavoritesFilter: (enabled: boolean) => void;
}
```

### 3. Modify Song View Column Configuration (Keep Grid Generic)

**File**: `client/js/src/views/freqhole/components/content/views/songs/DesktopSongsView.tsx`

Instead of modifying the grid's internal column definitions, update the song view to customize the `is_favorite` column:

```typescript
import { FavoriteToggle } from "../../../../../../components/filters/FavoriteToggle";

// In DesktopSongsView component:
const { state, actions } = useStore();

const handleFavoritesToggle = (enabled: boolean) => {
  actions.setFavoritesFilter(enabled);
  actions.reloadSongs();
};

// The FreqholeInfiniteGrid's getSongColumns() should be modified to:
{
  key: "is_favorite",
  title: "", // Empty, renderHeader provides custom header
  width: 40,
  sortable: false,
  renderHeader: () => (
    <FavoriteToggle
      active={state.filters.favoritesOnly}
      onToggle={handleFavoritesToggle}
    />
  ),
  render: (song: Song) => (
    <div class="flex justify-center">
      <SongFavoriteHeart song={song} size="sm" />
    </div>
  ),
}
```

This approach keeps the infinite grid completely generic while allowing song-specific logic in the renderHeader function.

### 4. Access Store State in Grid Column Definitions

**File**: `client/js/src/views/freqhole/components/grid/FreqholeInfiniteGrid.tsx`

Since we're using renderHeader approach, no new props are needed. The renderHeader function will have access to the store context:

```typescript
import { useStore } from "../../../store";
import { FavoriteToggle } from "../../../../components/filters/FavoriteToggle";

// Inside getSongColumns():
const { state, actions } = useStore(); // Access store in column definition context

{
  key: "is_favorite",
  renderHeader: () => (
    <FavoriteToggle
      active={state.filters.favoritesOnly}
      onToggle={(enabled) => {
        actions.setFavoritesFilter(enabled);
        actions.reloadSongs();
      }}
    />
  ),
  // ... rest of column config
}
```

### 5. No Changes Needed to Song Views

Since the filter logic is now handled entirely within the column's `renderHeader` function, no changes are needed to the song view components that use `FreqholeInfiniteGrid`. The grid remains generic and the song-specific filtering logic is encapsulated in the column definition.

### 6. Modify API Integration

**File**: `client/js/src/views/freqhole/store/reactiveActions.ts`

Update data loading methods to include favorites filter:

```typescript
const loadSongs = async () => {
  const filters = state.filters;
  const searchOptions = {
    // ... existing options
    favorites_only: filters.favoritesOnly || undefined,
  };

  // Use existing search API with favorites_only parameter
  const response = await apiClient.music.searchSongs(searchOptions);
  // ... handle response
};
```

### 7. Grid Header Component Enhancement

**File**: `client/js/src/components/infinite-data-grid/GridHeader.tsx`

No changes needed - the existing `renderHeader` functionality already supports custom header rendering for columns.

### 8. Mobile View Considerations

For mobile views, the favorites toggle should be integrated into the main filter controls area rather than the column header, since mobile uses simplified column layouts.

**File**: `client/js/src/views/freqhole/components/content/views/songs/MobileSongsView.tsx`

Add favorites toggle to the filter controls section:

```typescript
import { FavoriteToggle } from "../../../../../../components/filters/FavoriteToggle";

// Inside component:
const { state, actions } = useStore();

<div class="flex items-center gap-2 mb-4">
  {/* existing search and sort controls */}
  <FavoriteToggle
    active={state.filters.favoritesOnly}
    onToggle={(enabled) => {
      actions.setFavoritesFilter(enabled);
      actions.reloadSongs();
    }}
  />
</div>
```

## Data Flow Architecture

### Current State (Column Sorting)

1. User clicks column header
2. `GridHeader` calls `onSort(field, direction)`
3. `FreqholeInfiniteGrid` passes to parent `onSort` handler
4. Parent updates sort state and triggers API reload
5. API returns sorted data

### New State (Favorites Filtering)

1. User clicks favorites toggle in column header
2. `FavoriteToggle` calls `onToggle(enabled)` from renderHeader
3. Column's renderHeader handler updates store filter state directly
4. Store actions trigger API reload with new filter
5. API returns filtered data (with existing sort applied)

### Combined Behavior

- Favorites filter: ON + Sort by "title" → API gets `{favorites_only: true, sort_by: "title"}`
- User changes sort to "artist" → API gets `{favorites_only: true, sort_by: "artist"}`
- User disables favorites filter → API gets `{favorites_only: false, sort_by: "artist"}`

## Implementation Phases

### Phase 1: Core Filter Infrastructure

1. Create `FavoriteToggle` component
2. Extend store state with `filters.favoritesOnly`
3. Add store actions for filter management
4. Update API integration to pass `favorites_only` parameter

### Phase 2: Grid Integration

1. Modify `FreqholeInfiniteGrid` column config to use `renderHeader`
2. Replace sortable favorites column with toggle header
3. No changes needed to song views (grid stays generic)

### Phase 3: Mobile Integration

1. Add favorites toggle to mobile filter controls
2. Ensure consistent behavior across mobile/desktop
3. Test responsive layout

### Phase 4: Polish and Testing

1. Add proper loading states during filter changes
2. Persist filter state in URL/localStorage if desired
3. Add accessibility attributes
4. Test with keyboard navigation
5. Ensure filter works with search queries

## Technical Considerations

### Performance

- Favorites filtering happens server-side via API, no client-side performance impact
- Filter state changes trigger full data reload (consistent with current search behavior)
- Consider adding loading indicators during filter transitions

### State Management

- Use existing reactive store pattern with `createStore`/`produce`/`mutate`
- Filter state independent of sort state (both can be active simultaneously)
- Clear separation between UI state and API parameters
- Store accessed directly in column renderHeader, keeping grid generic

### API Compatibility

- Existing `/api/music/search/songs` endpoint already supports `favorites_only`
- No backend changes required
- Maintains compatibility with existing search functionality

### User Experience

- Visual distinction between filter (persistent highlight) vs sort (temporary arrow indicators)
- Clear indication of active filter state
- Favorite count display provides context
- Works seamlessly with existing search and sort functionality

### Future Extensions

This architecture supports easy addition of other toggle filters:

- `explicit_only: boolean`
- `high_quality_only: boolean`
- `recently_added: boolean`

The filter state structure and toggle component pattern can be extended without breaking existing functionality.
