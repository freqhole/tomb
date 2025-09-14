# Unified Search and Filtering Architecture Plan

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

This document outlines the plan to consolidate the search and filtering architecture into a unified system that eliminates the current complexity and regressions caused by multiple API endpoints and conflicting concerns.

## Current Problems

### 1. **Multiple Song API Patterns Creating Confusion**

- `getSongs()` - GET endpoint for basic song listing
- `searchMusic()` - Legacy GET search endpoint
- `searchPost()` - Modern POST search endpoint
- Different response formats causing type drift and pagination bugs

### 2. **Artist/Album API Inconsistency**

- `getArtists()` - Basic listing
- `getArtistsByTags()` - Tag filtering
- No unified search endpoint for artists/albums
- Complex conditional logic in reactive store

### 3. **Search vs Navigation Conflicts**

- Search functionality breaking main navigation state
- Tag filtering not working consistently across views
- Search suggestions only working on titles instead of full-text search
- Search results page missing global tag filtering

### 4. **Legacy Code Accumulation**

- Multiple deprecated search patterns still in use
- Type transformations and compatibility layers
- Inconsistent field naming across endpoints

## Proposed Solution: Unified POST API Pattern

### Core Principle

**One endpoint per resource type that handles all cases: search queries, tag filtering, and basic listing.**

### 1. **Unify Song Search** ✅ (Mostly Complete)

- Standardize on `POST /api/music/search` for all song operations
- Handles: empty queries (list all), text search, tag filtering, combined search+tags
- Already returning consistent `SongListResponse` format

### 2. **Create Unified Artists API**

- `POST /api/media/artists` (enhance existing endpoint)
- Support all scenarios:
  - Empty request → list all artists
  - `query` field → full-text search across artist names
  - `tags` filter → filter by tag associations
  - Combined query + tags → search within tagged content

### 3. **Create Unified Albums API**

- `POST /api/media/albums` (enhance existing endpoint)
- Support all scenarios:
  - Empty request → list all albums
  - `query` field → full-text search across album/artist names
  - `tags` filter → filter by tag associations
  - Combined query + tags → search within tagged content

## Technical Implementation Plan

### Phase 1: Server-Side API Consolidation

#### 1.1 Enhance Artists Endpoint

**File:** `server/src/media/songs.rs` (artists section)

Current: `POST /api/media/artists` (basic filtering only)
Enhanced: Support text search queries

```rust
// Update ArtistsFilterRequest to include query
pub struct ArtistsFilterRequest {
    pub query: Option<String>,        // NEW: Full-text search
    pub tags: Option<Vec<String>>,    // Existing
    pub page: Option<u32>,
    pub page_size: Option<u32>,
    pub sort_by: Option<String>,
    pub sort_direction: Option<String>,
}

// Add search logic to filter_artists function
async fn filter_artists(request: ArtistsFilterRequest) {
    if let Some(query) = request.query {
        // Add full-text search across artist names
        // Use similar pattern to songs search
    }
    // Existing tag filtering logic...
}
```

#### 1.2 Enhance Albums Endpoint

**File:** `server/src/media/songs.rs` (albums section)

Similar pattern as artists - add query support to existing filtering.

#### 1.3 Improve Suggestions Endpoint

**File:** `server/src/media/search.rs`

✅ Already supports `field: "all"` for broad search

- Fix client to use "all" instead of "title" ✅ **COMPLETE**
- Ensure suggestions don't include tag filtering (suggestions are global)

### Phase 2: Client-Side Reactive Store Simplification

#### 2.1 Consolidate to Single Resource Pattern

**File:** `client/js/src/views/freqhole/store/actions.tsx`

Replace the complex conditional logic:

```javascript
// BEFORE (complex)
if (params.query) {
  return await apiClient.searchMusic(params.query);
} else if (params.tags.length > 0) {
  return await apiClient.searchPost({...});
} else {
  return await apiClient.getSongs({...});
}

// AFTER (simple)
return await apiClient.searchPost({
  query: params.query || undefined,
  filters: params.tags.length > 0 ? { tags: params.tags } : undefined,
  sort_by: "created_at",
  sort_direction: "desc",
  page_size: 100,
});
```

Apply same pattern to artists and albums resources.

#### 2.2 Update Resource Dependencies

**File:** `client/js/src/views/freqhole/store/actions.tsx`

Make all resources respond to both search queries AND tag filters:

```javascript
const [songsResource] = createResource(
  () => ({
    tags: [...store.filters.tags],
    query: store.search.query?.trim() || "",
  }),
  async (params) => {
    return await apiClient.searchPost({
      query: params.query || undefined,
      filters: params.tags.length > 0 ? { tags: params.tags } : undefined,
      sort_by: "created_at",
      sort_direction: "desc",
      page_size: 100,
    });
  },
);

const [artistsResource] = createResource(
  () => ({
    tags: [...store.filters.tags],
    query: store.search.query?.trim() || "",
  }),
  async (params) => {
    return await apiClient.filterArtists({
      query: params.query || undefined,
      tags: params.tags.length > 0 ? params.tags : undefined,
      sort_by: "artist",
      sort_direction: "asc",
      page_size: 100,
    });
  },
);

// Similar pattern for albums
```

#### 2.3 Update API Client Methods

**File:** `client/js/src/lib/api-client.ts`

Enhance existing methods to accept query parameters:

```javascript
async filterArtists(request: {
  query?: string,           // NEW
  tags?: string[],         // Existing
  sort_by?: string,
  sort_direction?: string,
  page?: number,
  page_size?: number,
}) {
  // Call enhanced server endpoint
}
```

### Phase 3: UI Integration Improvements

#### 3.1 Add Tag Filtering to Search Results

**File:** `client/js/src/views/freqhole/components/content/views/SearchResultsView.tsx`

Add `TagFilterControls` component to search results page header, similar to songs view.

#### 3.2 Enhance Search Suggestions UI

**File:** `client/js/src/components/search/SearchSuggestions.tsx`

**Improvements:**

- **Smart Navigation**:
  - Artists → navigate to `/artist/{name}`
  - Albums → navigate to `/album/{album}?artist={artist}`
  - Songs → navigate to album page or play directly
- **Action Buttons**: Add play ▶️ and queue ➕ buttons for each result
- **Search Results Link**: Add "View all results" option that navigates to search results page

#### 3.3 Update Navigation Header

**File:** `client/js/src/views/freqhole/components/navigation/NavigationHeader.tsx`

Ensure suggestions don't include tag filtering (global suggestions only).

### Phase 4: Legacy Code Cleanup

#### 4.1 Remove Deprecated Methods

**Files to clean up:**

- `client/js/src/lib/api-client.ts` - Remove `searchMusic()`
- `client/js/src/hooks/search/` - Clean up legacy search hooks
- Various test files that reference old patterns

#### 4.2 Consolidate Type Definitions

**Files to update:**

- `client/js/src/lib/search/types.ts` - Remove duplicate schemas
- `client/js/src/lib/music/schemas/` - Ensure consistent types

## Success Criteria

### ✅ Functional Requirements

1. **Unified Search**: Single search box works across songs, artists, albums
2. **Tag Integration**: Global tag filtering works on all views including search results
3. **Smart Suggestions**: Suggestions show mixed results (artists/albums/songs) with smart navigation
4. **Performance**: No regressions in loading times or reactivity
5. **Consistency**: Same data/behavior whether accessed via main navigation or search

### ✅ Technical Requirements

1. **Single API Pattern**: One POST endpoint per resource type
2. **Type Safety**: Consistent schemas, no type transformations needed
3. **Reactive**: Changes to search query or tags update all relevant views
4. **Clean Code**: No legacy endpoints or compatibility layers

## Implementation Order

### 🚀 **Phase 1: Server API** (Week 1)

1. Enhance artists filtering endpoint with query support
2. Enhance albums filtering endpoint with query support
3. Test endpoints manually to ensure proper search functionality

### 🚀 **Phase 2: Client Store** (Week 1-2)

1. Update reactive store resources to use unified pattern
2. Update API client method signatures
3. Test tag filtering + search combinations work properly

### 🚀 **Phase 3: UI Polish** (Week 2)

1. Add tag filtering to search results page
2. Enhance search suggestions with actions and smart navigation
3. Test complete user workflows

### 🚀 **Phase 4: Cleanup** (Week 2-3)

1. Remove deprecated code paths
2. Update tests to match new patterns
3. Documentation updates

## Key Files to Modify

### Server

- `server/src/media/songs.rs` - Artists/albums filtering enhancement
- `server/src/media/search.rs` - Suggestions improvements

### Client - Core

- `client/js/src/views/freqhole/store/actions.tsx` - Resource simplification
- `client/js/src/lib/api-client.ts` - Method updates
- `client/js/src/lib/music/schemas/` - Type consolidation

### Client - UI

- `client/js/src/views/freqhole/components/content/views/SearchResultsView.tsx`
- `client/js/src/components/search/SearchSuggestions.tsx`
- `client/js/src/views/freqhole/components/navigation/NavigationHeader.tsx`

## Risk Mitigation

### 🛡️ **Backwards Compatibility**

- Keep old endpoints functional during transition
- Feature flag new behavior if needed
- Gradual migration path

### 🛡️ **Performance Monitoring**

- Monitor resource refetch frequency
- Ensure search queries don't cause excessive API calls
- Test with large datasets

### 🛡️ **User Experience**

- Preserve existing bookmarks and URLs
- Maintain search history functionality
- Ensure smooth transitions between views

## Context from Previous Discussion

### Recent Progress ✅

- **Schema Drift Fixed**: Eliminated `SongSearchResult` vs `Song` type mismatches
- **Pagination Fixed**: Resolved infinite scroll duplication bug with loading guards
- **Tag Filtering Restored**: Fixed reactive dependency tracking with `[...store.filters.tags]`
- **Suggestions Schema Fixed**: Updated to match server response format

### Current Status

- Songs view: ✅ Working with unified `searchPost` endpoint
- Tag filtering: ✅ Working in songs view
- Search suggestions: ✅ Fixed Zod validation, needs UI improvements
- Artists/Albums: ❌ Need unified search endpoints
- Search results page: ❌ Missing tag filtering, artists results broken

### Key Insights

- Standardizing on POST endpoints eliminates response format confusion
- Reactive store works well when dependencies are correctly tracked
- Legacy code patterns cause regressions - aggressive cleanup needed
- User experience requires search + tags to work together seamlessly

---

**Next Steps**: Begin with Phase 1 server-side API enhancements, focusing on artists endpoint first to validate the unified approach.
