# Search Filter Debugging Context

## Current Status & Problem

We've been working on implementing search filter functionality for the music domain. The main issue is that filter-only searches (without text queries) are returning empty results even though the filters are being passed correctly through the entire chain.

## Architecture Overview

### Current Setup
- **Frontend**: SolidJS components with search toggle (Search Box mode vs Filters Only mode)
- **Client API**: TypeScript ApiClient with dedicated `filterMusic()` method
- **Server API**: Rust Axum with new `/api/music/filter` endpoint
- **Search Service**: Grimoire crate with SearchService that handles database queries

### Key Files Modified
- `server/src/media/search.rs` - Added `filter_music()` endpoint and `FilterParams` struct
- `client/js/src/lib/api-client.ts` - Added `filterMusic()` method
- `client/js/src/web-components/search-demo.tsx` - Toggle between search/filter modes
- Added debug logging throughout the chain

## Debug Investigation Results

### What's Working ✅
1. **Frontend filter UI**: Correctly captures filter selections (e.g., `genre: 'easy listening'`)
2. **Client API call**: `filterMusic()` sends correct parameters to server
3. **Server endpoint**: Receives filters correctly and applies them to SearchQuery
4. **Filter application**: SearchQuery shows `genre: Some("easy listening")` in final state

### What's Broken ❌
1. **SearchService returns empty results**: Always returns `total_count: 0, query_time_ms: 0`
2. **No actual database query execution**: The `query_time_ms: 0` suggests no DB work was done

### Server Debug Logs
```
🎛️ filter_music called with params: FilterParams { genre: Some("easy listening"), ... }
🎛️ has_filters: true
🎛️ Final search query with filters: SearchQuery {
    query: None,
    filters: SearchFilters { genre: Some("easy listening"), ... }
}
🎛️ search_music returned: SearchResult { total_count: 0, results: [], query_time_ms: 0 }
```

## Root Cause Analysis

The issue is in `grimoire/src/search/fts.rs` in the `search_music()` method:

```rust
pub async fn search_music(&self, query: &SearchQuery) -> Result<SearchResult, SearchError> {
    let start_time = Instant::now();

    if query.query.is_none() && query.structured_search.is_none() {
        return Ok(SearchResult {
            total_count: 0,
            results: vec![],
            // ... empty result
        });
    }
    // ... rest of method never reached for filter-only searches
}
```

**The problem**: `search_music()` immediately returns empty results when there's no text query, completely ignoring any filters that might be present.

## Comparison with CLI Implementation

The CLI search in `cli/src/music/search.rs` might handle this correctly. Need to investigate:
1. How does CLI handle filter-only searches?
2. Does it use a different code path or database function?
3. What's the difference between `music_search()` vs `search_songs()` database functions?

## Next Steps

1. **Investigate CLI implementation**: Check `cli/src/music/search.rs` to see how it handles filters
2. **Database function analysis**: Compare `music_search()` vs `search_songs()` SQL functions
3. **Fix options**:
   - Option A: Modify `search_music()` to allow filter-only queries
   - Option B: Use `search_songs()` for filter-only searches (it might already support this)
   - Option C: Create dedicated filter-only database function

## Technical Context

### API Endpoints
- `/api/music/search` - Requires text query, supports filters
- `/api/music/filter` - New endpoint for filter-only browsing
- `/api/music/search/songs` - Songs-only search

### Database Functions (Postgres)
- `music_search()` - Used by `search_music()`, seems to require text query
- `search_songs()` - Used by `search_songs()`, might support filter-only

### Key Code Locations
- `grimoire/src/search/fts.rs:187` - The problematic early return
- `server/src/media/search.rs:540` - New `filter_music()` endpoint
- `cli/src/music/search.rs` - CLI implementation for comparison

## Architecture Decision

We chose to create a separate `/api/music/filter` endpoint rather than modify the existing search endpoint to:
1. Keep search and browse use cases cleanly separated
2. Avoid complex conditional logic in existing search
3. Allow for filter-specific optimizations
4. Match user mental models (searching vs browsing)

## Current Filter Support
- ✅ genre, artist, album, year
- ✅ rating_min, rating_max
- ✅ favorites_only
- ✅ Pagination and sorting
- ✅ Frontend UI with proper state management

## Testing Data
The logs show we're testing with `genre: "easy listening"` which should exist in the database since the regular search found results for "piano".
