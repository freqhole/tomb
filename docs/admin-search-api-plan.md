# Admin Search API Infrastructure Plan

**Project**: Enhanced search API for admin interfaces across all domains
**Goal**: Build a robust, domain-agnostic search and filtering system that supports music admin UI and future domains (photos, videos, docs)

---

## Executive Summary

The current search API (`/api/music/search`, `/api/music/filter`) has dual endpoints with inconsistent behavior and limited admin capabilities. This plan outlines replacing it with a single, powerful search API that:

1. **Single endpoint approach** - One `/api/music/search` that handles all query types (text search, filters only, show all)
2. **Complete admin capabilities** - Full metadata access, complex filtering, comprehensive sorting
3. **Domain-agnostic design** - Music implementation that extends naturally to photos/videos/docs
4. **Evolves existing code** - Improves search-demo.tsx and replaces current search infrastructure

**No Backwards Compatibility**: We will replace the existing search API entirely to avoid code complexity and technical debt.

---

## Code Style Guidelines (Critical - Read Every Thread)

### 🚨 CRITICAL RULES - NEVER FORGET 🚨

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

## Current State Analysis

### Current Search Infrastructure Analysis

**Server-side (`tomb/server/src/media/search.rs`)**:

- `/api/music/search` - Requires `q` parameter, returns `SearchResultResponse` objects
- `/api/music/filter` - Requires at least one filter, returns same `SearchResultResponse` format
- **Problem**: Two endpoints doing similar things with different constraints
- **Problem**: `SearchResultResponse` is search-focused, lacks full song metadata for admin editing
- **Problem**: `FilterParams` missing critical admin filters (tags, duration, file format, date ranges)

**Current FilterParams limitations**:

```rust
pub struct FilterParams {
    pub page: u32,
    pub page_size: u32,
    pub sort_by: Option<String>,        // Limited sort options
    pub sort_direction: Option<String>,
    pub q: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i32>,              // Only exact year, no ranges
    pub rating_min: Option<i32>,        // Only minimum, no maximum or exact
    pub favorites_only: bool,           // Boolean only, not tri-state
    pub songs_only: bool,
}
```

**Client-side (`tomb/client/js/src/web-components/search-demo.tsx`) problems**:

```typescript
// Current complex endpoint switching logic
if (searchMode() === "filters") {
  results = await context.apiClient.filterMusic(filterParams);
} else {
  await context.performSearch();
  results = context.search.results();
}
```

- **Problem**: Dual endpoint logic creates complexity and inconsistency
- **Problem**: Limited filter UI - missing many admin-needed filters
- **Problem**: Poor error handling across different code paths
- **Problem**: No "show all" capability (both endpoints require some input)

### Critical Missing Admin Features

1. **Comprehensive Filtering**: No support for tags, duration ranges, file formats, date ranges, exact ratings
2. **Full Metadata Access**: `SearchResultResponse` doesn't include editable fields like bpm, key_signature, file_size
3. **Show All Capability**: No way to load all songs without filters (critical for admin initial state)
4. **Advanced Sorting**: Limited sort fields, no multi-field sorting
5. **Bulk Operation Support**: No way to get IDs for bulk operations on filtered results

## Proposed Solution: Single Unified Search API

### Replacing Dual Endpoints with Single Powerful Endpoint

**Current**: `/api/music/search` + `/api/music/filter` (complex client logic)
**New**: `/api/music/search` (handles all use cases)

### Single Endpoint Capabilities

The new `/api/music/search` will handle ALL query types:

1. **Text Search**: `?q=jazz+rock` (traditional search)
2. **Filter Only**: `?artist=Miles+Davis&year_min=1960` (no text query)
3. **Show All**: No parameters (admin initial load)
4. **Combined**: `?q=blue&genre=jazz&rating_min=4` (search + filters)

**Technical Implementation**:

```rust
// Single endpoint that handles everything
pub async fn search_music(
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<UnifiedSearchParams>,
) -> Result<Json<UnifiedSearchResponse>, StatusCode> {
    // No requirements - works with any combination of parameters
    // Returns full Song objects when requested
    // Supports all admin filtering needs
}
```

### Domain Structure

```
/api/music/search           - Main search endpoint (replaces both current endpoints)
/api/music/filter-options   - Filter dropdown data
/api/music/suggestions      - Real-time search suggestions
```

**Benefits of Single Endpoint**:

- **Simplified Client Logic**: One API call for all search scenarios
- **Consistent Response Format**: Same structure for all query types
- **Better Performance**: Single optimized query path
- **Easier Testing**: One endpoint to test thoroughly
- **Future-Proof**: Easy to extend without breaking changes

---

## Server-Side Implementation Plan

### 1. Unified Search Parameters (Replacing FilterParams + SearchParams)

**Complete UnifiedSearchParams structure**:

```rust
#[derive(Debug, Deserialize, Clone)]
pub struct UnifiedSearchParams {
    // === TEXT SEARCH ===
    pub q: Option<String>,                    // Optional text query
    pub search_type: Option<SearchType>,      // websearch, plainto, phrase
    pub search_fields: Option<Vec<String>>,   // title, artist, album, lyrics

    // === PAGINATION ===
    pub page: Option<u32>,                    // 1-based page number
    pub page_size: Option<u32>,               // items per page (max 1000)
    pub offset: Option<u64>,                  // Alternative to page-based
    pub limit: Option<u32>,                   // Alternative to page_size

    // === SORTING ===
    pub sort_by: Option<String>,              // Any song field
    pub sort_direction: Option<SortDirection>, // Asc, Desc
    pub secondary_sort: Option<String>,        // Tie-breaker sort field

    // === BASIC FILTERS ===
    pub artist: Option<String>,               // Exact or partial match
    pub artist_exact: Option<bool>,           // Force exact artist matching
    pub album: Option<String>,                // Exact or partial match
    pub album_exact: Option<bool>,            // Force exact album matching
    pub genre: Option<String>,                // Exact genre match
    pub title: Option<String>,                // Title search (separate from q)

    // === NUMERIC RANGE FILTERS ===
    pub year: Option<i32>,                    // Exact year
    pub year_min: Option<i32>,                // Year range minimum
    pub year_max: Option<i32>,                // Year range maximum
    pub rating: Option<i32>,                  // Exact rating (0-5)
    pub rating_min: Option<i32>,              // Rating minimum (0-5)
    pub rating_max: Option<i32>,              // Rating maximum (0-5)
    pub bpm: Option<i32>,                     // Exact BPM
    pub bpm_min: Option<i32>,                 // BPM range minimum
    pub bpm_max: Option<i32>,                 // BPM range maximum
    pub duration_seconds: Option<i64>,        // Exact duration
    pub duration_min: Option<i64>,            // Duration minimum (seconds)
    pub duration_max: Option<i64>,            // Duration maximum (seconds)
    pub track_number: Option<i32>,            // Exact track number
    pub disc_number: Option<i32>,             // Exact disc number

    // === BOOLEAN FILTERS ===
    pub is_favorite: Option<bool>,            // Favorite status
    pub has_thumbnail: Option<bool>,          // Has artwork
    pub has_lyrics: Option<bool>,             // Has lyrics data
    pub has_waveform: Option<bool>,           // Has waveform data
    pub is_compilation: Option<bool>,         // Album compilation flag

    // === ARRAY/MULTI-VALUE FILTERS ===
    pub tags: Option<Vec<String>>,            // Must have ALL these tags
    pub tags_any: Option<Vec<String>>,        // Must have ANY of these tags
    pub tags_exclude: Option<Vec<String>>,    // Must NOT have these tags
    pub genres: Option<Vec<String>>,          // Multiple genre matching
    pub artists: Option<Vec<String>>,         // Multiple artist matching
    pub albums: Option<Vec<String>>,          // Multiple album matching

    // === FILE/TECHNICAL FILTERS ===
    pub file_format: Option<String>,          // mp3, flac, wav, etc.
    pub file_formats: Option<Vec<String>>,    // Multiple format matching
    pub bitrate_min: Option<i32>,             // Minimum bitrate (kbps)
    pub bitrate_max: Option<i32>,             // Maximum bitrate (kbps)
    pub sample_rate_min: Option<i32>,         // Minimum sample rate (Hz)
    pub sample_rate_max: Option<i32>,         // Maximum sample rate (Hz)
    pub file_size_min: Option<i64>,           // Minimum file size (bytes)
    pub file_size_max: Option<i64>,           // Maximum file size (bytes)

    // === DATE FILTERS ===
    pub created_after: Option<String>,        // ISO datetime string
    pub created_before: Option<String>,       // ISO datetime string
    pub updated_after: Option<String>,        // ISO datetime string
    pub updated_before: Option<String>,       // ISO datetime string
    pub added_after: Option<String>,          // When added to library
    pub added_before: Option<String>,         // When added to library

    // === ADVANCED ADMIN FILTERS ===
    pub key_signature: Option<String>,        // Musical key (C, D#, etc.)
    pub key_signatures: Option<Vec<String>>,  // Multiple key matching
    pub mood: Option<String>,                 // Mood classification
    pub energy_level_min: Option<f32>,        // Energy level 0.0-1.0
    pub energy_level_max: Option<f32>,        // Energy level 0.0-1.0
    pub tempo_category: Option<String>,       // slow, medium, fast

    // === LIBRARY MANAGEMENT ===
    pub playlist_id: Option<String>,          // Songs in specific playlist
    pub not_in_playlist: Option<String>,      // Exclude playlist songs
    pub duplicate_check: Option<String>,      // title, artist_title, fingerprint
    pub missing_metadata: Option<Vec<String>>, // Fields with missing data
    pub has_errors: Option<bool>,             // Has processing errors
    pub needs_review: Option<bool>,           // Flagged for manual review

    // === RESPONSE OPTIONS ===
    pub include_deleted: Option<bool>,        // Include soft-deleted songs
    pub include_hidden: Option<bool>,         // Include hidden songs
    pub full_metadata: Option<bool>,          // Return complete Song vs summary
    pub include_file_info: Option<bool>,      // Include file size, bitrate, etc.
    pub include_statistics: Option<bool>,     // Include play counts, etc.
    pub include_related: Option<bool>,        // Include related songs

    // === PERFORMANCE OPTIONS ===
    pub skip_total_count: Option<bool>,       // Skip expensive COUNT query
    pub explain_query: Option<bool>,          // Return query execution plan (debug)
}

#[derive(Debug, Deserialize, Clone)]
pub enum SearchType {
    #[serde(rename = "websearch")]
    WebSearch,      // Google-style search with operators
    #[serde(rename = "plainto")]
    PlainText,      // Simple text matching
    #[serde(rename = "phrase")]
    Phrase,         // Exact phrase matching
    #[serde(rename = "fuzzy")]
    Fuzzy,          // Fuzzy text matching
}

#[derive(Debug, Deserialize, Clone)]
pub enum SortDirection {
    #[serde(rename = "asc")]
    Asc,
    #[serde(rename = "desc")]
    Desc,
}
```

**Key Design Decisions**:

1. **Optional Everything**: Every parameter is `Option<T>` - no required fields
2. **Range Support**: Min/max for all numeric fields (year, rating, duration, etc.)
3. **Multiple Match Types**: Exact vs partial matching for text fields
4. **Array Filters**: Support for multiple values and exclusion patterns
5. **Technical Metadata**: File format, bitrate, sample rate for admin needs
6. **Library Management**: Advanced admin features like duplicate detection
7. **Performance Controls**: Options to optimize queries for different use cases

### 2. Unified Search Response (Replacing SearchResponse)

**Complete UnifiedSearchResponse structure**:

```rust
#[derive(Debug, Serialize, Clone)]
pub struct UnifiedSearchResponse {
    // === CORE RESULTS ===
    pub songs: Vec<Song>,                     // Full Song objects (not SearchResultResponse)
    pub total_count: u64,                     // Total matching results

    // === PAGINATION ===
    pub page: u32,                            // Current page number
    pub page_size: u32,                       // Items per page
    pub total_pages: u32,                     // Total pages available
    pub has_next: bool,                       // Has next page
    pub has_prev: bool,                       // Has previous page
    pub offset: u64,                          // Current offset

    // === SEARCH METADATA ===
    pub query_time_ms: u64,                   // Query execution time
    pub search_query: Option<String>,         // Original search query
    pub filters_applied: AppliedFilters,      // Summary of active filters
    pub sort_applied: SortInfo,               // Current sort configuration

    // === SUGGESTIONS & RECOMMENDATIONS ===
    pub suggestions: Vec<SearchSuggestion>,   // Search query suggestions
    pub filter_suggestions: Vec<FilterSuggestion>, // Suggested filters
    pub related_searches: Vec<String>,        // Related search queries

    // === AGGREGATIONS (for admin insights) ===
    pub aggregations: Option<SearchAggregations>, // When requested

    // === DEBUG INFO (admin only) ===
    pub debug: Option<SearchDebugInfo>,       // Query execution details
}

#[derive(Debug, Serialize, Clone)]
pub struct AppliedFilters {
    pub text_search: Option<String>,
    pub artist_filters: Vec<String>,
    pub album_filters: Vec<String>,
    pub genre_filters: Vec<String>,
    pub year_range: Option<(i32, i32)>,
    pub rating_range: Option<(i32, i32)>,
    pub duration_range: Option<(i64, i64)>,
    pub boolean_filters: HashMap<String, bool>,
    pub tag_filters: TagFilters,
    pub date_filters: DateRangeFilters,
    pub file_filters: FileFilters,
    pub total_filter_count: u32,
}

#[derive(Debug, Serialize, Clone)]
pub struct TagFilters {
    pub required_tags: Vec<String>,           // Must have ALL
    pub optional_tags: Vec<String>,           // Must have ANY
    pub excluded_tags: Vec<String>,           // Must NOT have
}

#[derive(Debug, Serialize, Clone)]
pub struct DateRangeFilters {
    pub created_after: Option<String>,
    pub created_before: Option<String>,
    pub updated_after: Option<String>,
    pub updated_before: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct FileFilters {
    pub formats: Vec<String>,
    pub bitrate_range: Option<(i32, i32)>,
    pub size_range: Option<(i64, i64)>,
}

#[derive(Debug, Serialize, Clone)]
pub struct SortInfo {
    pub primary_field: String,
    pub primary_direction: SortDirection,
    pub secondary_field: Option<String>,
    pub secondary_direction: Option<SortDirection>,
}

#[derive(Debug, Serialize, Clone)]
pub struct SearchSuggestion {
    pub query: String,
    pub highlight: String,                    // HTML highlighted version
    pub result_count: u32,                    // Estimated result count
    pub suggestion_type: SuggestionType,
}

#[derive(Debug, Serialize, Clone)]
pub enum SuggestionType {
    #[serde(rename = "completion")]
    Completion,         // Complete the current query
    #[serde(rename = "correction")]
    Correction,         // Spell correction
    #[serde(rename = "related")]
    Related,            // Related search terms
}

#[derive(Debug, Serialize, Clone)]
pub struct FilterSuggestion {
    pub filter_type: String,                  // "artist", "genre", etc.
    pub filter_value: String,                 // Suggested filter value
    pub result_count: u32,                    // Results if applied
    pub confidence: f32,                      // Suggestion confidence 0.0-1.0
}

#[derive(Debug, Serialize, Clone)]
pub struct SearchAggregations {
    pub artists: Vec<AggregationBucket>,      // Top artists in results
    pub albums: Vec<AggregationBucket>,       // Top albums in results
    pub genres: Vec<AggregationBucket>,       // Top genres in results
    pub years: Vec<AggregationBucket>,        // Year distribution
    pub ratings: Vec<AggregationBucket>,      // Rating distribution
    pub formats: Vec<AggregationBucket>,      // File format distribution
    pub duration_ranges: Vec<DurationBucket>, // Duration distribution
}

#[derive(Debug, Serialize, Clone)]
pub struct AggregationBucket {
    pub value: String,                        // Bucket value
    pub count: u32,                           // Item count in bucket
    pub percentage: f32,                      // Percentage of total
}

#[derive(Debug, Serialize, Clone)]
pub struct DurationBucket {
    pub min_seconds: i64,
    pub max_seconds: i64,
    pub label: String,                        // "0-3 min", "3-5 min", etc.
    pub count: u32,
}

#[derive(Debug, Serialize, Clone)]
pub struct SearchDebugInfo {
    pub sql_query: String,                    // Generated SQL (sanitized)
    pub index_usage: Vec<String>,             // Which indexes were used
    pub query_plan: serde_json::Value,        // Database query plan
    pub cache_hit: bool,                      // Was result cached
    pub processing_steps: Vec<ProcessingStep>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ProcessingStep {
    pub step_name: String,
    pub duration_ms: u64,
    pub details: Option<serde_json::Value>,
}
```

**Key Response Features**:

1. **Full Song Objects**: Returns complete `Song` structs, not simplified search results
2. **Rich Metadata**: Detailed information about applied filters and sort
3. **Admin Insights**: Aggregations and debug info for admin users
4. **Smart Suggestions**: Context-aware search and filter suggestions
5. **Performance Tracking**: Detailed timing and optimization information

### 3. New Admin Endpoints

### 3. Updated Endpoint Specifications

#### `/api/music/search` (Replaces both `/api/music/search` and `/api/music/filter`)

- **Method**: GET
- **Purpose**: Unified search endpoint handling all query types
- **Params**: `UnifiedSearchParams` (all optional)
- **Response**: `UnifiedSearchResponse`
- **Query Examples**:
  ```
  GET /api/music/search                                    # Show all songs
  GET /api/music/search?q=jazz                            # Text search
  GET /api/music/search?artist=Miles+Davis                # Filter only
  GET /api/music/search?q=blue&genre=jazz&rating_min=4    # Combined
  GET /api/music/search?page=2&page_size=50&sort_by=year&sort_direction=desc
  ```

**Technical Implementation Details**:

```rust
pub async fn search_music(
    Extension(_user): Extension<AuthenticatedUser>,
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<UnifiedSearchParams>,
) -> Result<Json<UnifiedSearchResponse>, StatusCode> {
    let start_time = Instant::now();

    // Build search query - handles all parameter combinations
    let mut query_builder = QueryBuilder::new()
        .with_base_table("songs")
        .with_default_sort("created_at", SortDirection::Desc);

    // Add text search if provided
    if let Some(search_text) = &params.q {
        query_builder = query_builder.with_fulltext_search(
            search_text,
            params.search_type.unwrap_or(SearchType::WebSearch),
            params.search_fields.as_ref()
        );
    }

    // Add all filters (extensive filter building logic)
    query_builder = apply_filters(query_builder, &params)?;

    // Add sorting
    query_builder = apply_sorting(query_builder, &params)?;

    // Add pagination
    query_builder = apply_pagination(query_builder, &params)?;

    // Execute query with performance monitoring
    let (songs, total_count) = execute_search_query(query_builder, &db).await?;

    // Build response with metadata
    let response = UnifiedSearchResponse {
        songs,
        total_count,
        query_time_ms: start_time.elapsed().as_millis() as u64,
        // ... build complete response
    };

    Ok(Json(response))
}
```

#### `/api/music/filter-options`

- **Method**: GET
- **Purpose**: Provide comprehensive filter dropdown/autocomplete data
- **Params**: `page` (optional, 1-based), `page_size` (optional, default 50), `filter_type` (optional: artists, albums, genres, tags, years, formats)
- **Response**: `FilterOptionsResponse`

```rust
#[derive(Debug, Serialize)]
pub struct FilterOptionsResponse {
    // === PAGINATED FILTER OPTIONS ===
    pub artists: PaginatedFilterOptions,      // Artists with pagination
    pub albums: PaginatedFilterOptions,       // Albums with pagination
    pub genres: PaginatedFilterOptions,       // Genres with pagination
    pub tags: PaginatedFilterOptions,         // Tags with pagination

    // === YEAR OPTIONS ===
    pub years: Vec<FilterOption>,             // Available years (small set, no pagination)
    pub year_ranges: Vec<YearRange>,          // Predefined year ranges

    // === RATING INFO ===
    pub rating_distribution: Vec<u32>,        // Count for each rating 0-5
    pub avg_rating: f32,                      // Overall average rating

    // === FILE FORMAT OPTIONS ===
    pub file_formats: Vec<FilterOption>,      // Available formats (small set, no pagination)
    pub bitrate_ranges: Vec<BitrateRange>,    // Common bitrate ranges

    // === DURATION RANGES ===
    pub duration_ranges: Vec<DurationRange>,  // Predefined duration ranges

    // === MUSICAL METADATA ===
    pub key_signatures: Vec<FilterOption>,    // Available keys (small set, no pagination)
    pub bpm_ranges: Vec<BpmRange>,            // BPM ranges
    pub mood_categories: Vec<FilterOption>,   // Mood classifications

    // === BOOLEAN FILTER COUNTS ===
    pub favorites_count: u32,                 // Number of favorites
    pub has_thumbnail_count: u32,             // Songs with artwork
    pub has_lyrics_count: u32,                // Songs with lyrics
    pub compilation_count: u32,               // Compilation albums

    // === STATISTICS ===
    pub statistics: LibraryStatistics,
}

#[derive(Debug, Serialize)]
pub struct PaginatedFilterOptions {
    pub items: Vec<FilterOption>,             // Filter options for current page
    pub total_count: u32,                     // Total available options
    pub page: u32,                            // Current page (1-based)
    pub page_size: u32,                       // Items per page
    pub total_pages: u32,                     // Total pages available
    pub has_next: bool,                       // Has next page
    pub has_prev: bool,                       // Has previous page
}

#[derive(Debug, Serialize)]
pub struct FilterOption {
    pub value: String,                        // Filter value
    pub label: String,                        // Human readable label
    pub count: u32,                           // Number of songs
    pub percentage: f32,                      // Percentage of library
}

#[derive(Debug, Serialize)]
pub struct YearRange {
    pub min_year: i32,
    pub max_year: i32,
    pub label: String,                        // "1960s", "2020-present", etc.
    pub count: u32,
}

#[derive(Debug, Serialize)]
pub struct LibraryStatistics {
    pub total_songs: u64,
    pub total_artists: u32,
    pub total_albums: u32,
    pub total_genres: u32,
    pub total_tags: u32,
    pub total_playtime_seconds: u64,
    pub avg_song_duration: f32,
    pub total_file_size_bytes: u64,
    pub last_updated: String,
}
```

#### `/api/music/suggestions`

- **Method**: GET
- **Purpose**: Real-time search suggestions for autocomplete
- **Params**: `field` (artist, album, genre, title), `partial` (partial input), `page` (optional, 1-based), `page_size` (optional, default 10, max 50)
- **Response**: `SuggestionResponse`

```rust
#[derive(Debug, Serialize)]
pub struct SuggestionResponse {
    pub suggestions: Vec<Suggestion>,
    pub query_time_ms: u64,
    pub total_count: u32,                  // Total matches found
    pub page: u32,                         // Current page (1-based)
    pub page_size: u32,                    // Items per page
    pub total_pages: u32,                  // Total pages available
    pub has_next: bool,                    // Has next page
    pub has_prev: bool,                    // Has previous page
}

#[derive(Debug, Serialize)]
pub struct Suggestion {
    pub value: String,                     // Suggested value
    pub display: String,                   // Formatted for display
    pub highlight: String,                 // HTML with <mark> tags
    pub count: u32,                        // Number of songs with this value
    pub suggestion_type: SuggestionType,
    pub confidence: f32,                   // Relevance score 0.0-1.0
}

// Query examples:
// GET /api/music/suggestions?field=artist&partial=mile&page_size=10
// GET /api/music/suggestions?field=title&partial=blue+no&page=2&page_size=5
```

### 4. Domain-Agnostic Framework

**Generic Traits for Domain Extension**:

```rust
pub trait AdminSearchDomain {
    type Item: Serialize + DeserializeOwned;
    type Params: DeserializeOwned;

    fn search(params: Self::Params) -> Result<AdminSearchResponse<Self::Item>>;
    fn filter_options() -> Result<FilterOptionsResponse>;
    fn suggestions(field: &str, partial: &str) -> Result<Vec<String>>;
}

// Music domain implementation
impl AdminSearchDomain for MusicDomain {
    type Item = Song;
    type Params = AdminSearchParams;
    // Implementation...
}
```

---

## Client-Side Implementation Plan

### 1. Unified Search Hook (Replacing Dual Endpoint Logic)

**`client/js/src/hooks/search/useUnifiedSearch.ts`**:

```typescript
export interface UnifiedSearchConfig {
  domain: string; // 'music', 'photos', 'videos'
  searchEndpoint: string; // '/api/music/search'
  filterOptionsEndpoint: string; // '/api/music/filter-options'
  suggestionsEndpoint: string; // '/api/music/suggestions'
  responseSchema: z.ZodSchema<any>; // Validation schema
  defaultParams: UnifiedSearchParams; // Default search parameters
  debounceMs: number; // Search input debounce
  defaultPageSize: number; // Default page size for filter options
}

export interface UnifiedSearchParams {
  // Direct mapping to server UnifiedSearchParams
  q?: string;
  search_type?: "websearch" | "plainto" | "phrase" | "fuzzy";
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_direction?: "asc" | "desc";

  // All filter parameters (extensive list)
  artist?: string;
  album?: string;
  genre?: string;
  year?: number;
  year_min?: number;
  year_max?: number;
  rating?: number;
  rating_min?: number;
  rating_max?: number;
  duration_min?: number;
  duration_max?: number;
  is_favorite?: boolean;
  has_thumbnail?: boolean;
  tags?: string[];
  tags_any?: string[];
  tags_exclude?: string[];
  file_format?: string;
  file_formats?: string[];
  // ... all other parameters from server
}

export interface UnifiedSearchReturn {
  // === CORE SEARCH STATE ===
  searchParams: () => UnifiedSearchParams;
  setSearchParams: (params: Partial<UnifiedSearchParams>) => void;
  updateParam: (key: keyof UnifiedSearchParams, value: any) => void;
  clearParams: () => void;

  // === RESULTS ===
  results: () => Song[];
  totalCount: () => number;
  hasResults: () => boolean;
  isEmpty: () => boolean;

  // === PAGINATION ===
  currentPage: () => number;
  totalPages: () => number;
  pageSize: () => number;
  hasNext: () => boolean;
  hasPrev: () => boolean;
  nextPage: () => void;
  prevPage: () => void;
  goToPage: (page: number) => void;

  // === LOADING STATES ===
  loading: () => boolean;
  loadingMore: () => boolean; // For infinite scroll
  searching: () => boolean; // For search input
  error: () => string | null;

  // === SEARCH ACTIONS ===
  search: (immediate?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>; // For infinite scroll
  clearSearch: () => void;

  // === TEXT SEARCH ===
  searchQuery: () => string;
  setSearchQuery: (query: string) => void;
  searchSuggestions: () => string[];

  // === FILTERS ===
  activeFilters: () => Record<string, any>;
  hasActiveFilters: () => boolean;
  addFilter: (key: string, value: any) => void;
  removeFilter: (key: string) => void;
  clearFilters: () => void;
  filterOptions: () => FilterOptionsResponse | null;
  refreshFilterOptions: () => Promise<void>;

  // === SORTING ===
  sortBy: () => string | null;
  sortDirection: () => "asc" | "desc";
  setSorting: (field: string, direction?: "asc" | "desc") => void;
  toggleSort: (field: string) => void;
  clearSort: () => void;

  // === ADVANCED FEATURES ===
  aggregations: () => SearchAggregations | null;
  searchMetadata: () => SearchMetadata;
  appliedFilters: () => AppliedFilters;
  debugInfo: () => SearchDebugInfo | null;

  // === URL SYNCHRONIZATION ===
  syncWithUrl: () => void;
  getShareableUrl: () => string;
  loadFromUrl: () => void;
}

export interface SearchMetadata {
  queryTimeMs: number;
  totalResults: number;
  searchQuery?: string;
  filtersApplied: number;
  sortApplied?: string;
  lastUpdated: Date;
}

// Implementation highlights:
export function useUnifiedSearch(
  config: UnifiedSearchConfig,
): UnifiedSearchReturn {
  // === STATE MANAGEMENT ===
  const [searchParams, setSearchParams] = createSignal<UnifiedSearchParams>(
    config.defaultParams,
  );
  const [results, setResults] = createSignal<Song[]>([]);
  const [totalCount, setTotalCount] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [filterOptions, setFilterOptions] =
    createSignal<FilterOptionsResponse | null>(null);

  // === DEBOUNCED SEARCH ===
  const debouncedSearch = debounce(async () => {
    await performSearch();
  }, config.debounceMs);

  // === CORE SEARCH FUNCTION ===
  const performSearch = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = searchParams();
      const url = buildSearchUrl(config.searchEndpoint, params);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }

      const data = await response.json();
      const validated = config.responseSchema.parse(data);

      setResults(validated.songs);
      setTotalCount(validated.total_count);

      // Store additional metadata
      setSearchMetadata({
        queryTimeMs: validated.query_time_ms,
        totalResults: validated.total_count,
        searchQuery: validated.search_query,
        filtersApplied: validated.filters_applied.total_filter_count,
        lastUpdated: new Date(),
      });
    } catch (err) {
      console.error("Search error:", err);
      setError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  };

  // === REACTIVE SEARCH TRIGGERING ===
  createEffect(() => {
    const params = searchParams();
    if (shouldTriggerSearch(params)) {
      debouncedSearch();
    }
  });

  // === FILTER OPTIONS LOADING ===
  onMount(async () => {
    await refreshFilterOptions();
  });

  // Return complete API...
}

// Helper functions for URL building, parameter validation, etc.
function buildSearchUrl(endpoint: string, params: UnifiedSearchParams): string {
  const url = new URL(endpoint, window.location.origin);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      if (Array.isArray(value)) {
        value.forEach((v) => url.searchParams.append(key, String(v)));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  });

  return url.toString();
}
```

**Key Hook Features**:

1. **Single API**: Only calls `/api/music/search` - no dual endpoint logic
2. **Reactive Updates**: Automatically searches when parameters change
3. **Debounced Input**: Prevents excessive API calls during typing
4. **URL Synchronization**: Keeps URL in sync with search state for bookmarking
5. **Comprehensive State**: Manages all aspects of search, filtering, pagination, sorting
6. **Type Safety**: Full TypeScript support with Zod validation
7. **Performance Optimized**: Caching, debouncing, and efficient state updates

### 2. Complete search-demo.tsx Refactoring

**Current Problems in search-demo.tsx**:

```typescript
// CURRENT: Complex dual-endpoint logic (lines ~170-190)
if (searchMode() === "filters") {
  console.log("🎛️ Using filterMusic API for filters-only search");
  const filterOptions = context.state.getMusicSearchOptions();
  const { q, ...filterParams } = filterOptions;
  results = await context.apiClient.filterMusic(filterParams);
} else {
  console.log("🔍 Using regular search API");
  await context.performSearch();
  results = context.search.results();
}
```

**NEW: Simplified single-endpoint approach**:

```typescript
// NEW: Single endpoint handles everything
const searchParams = {
  q: searchQuery(),
  ...activeFilters(),
  page: currentPage(),
  sort_by: sortField(),
  sort_direction: sortDirection(),
};

const search = useUnifiedSearch({
  domain: "music",
  searchEndpoint: "/api/music/search",
  filterOptionsEndpoint: "/api/music/filter-options",
  suggestionsEndpoint: "/api/music/suggestions",
  responseSchema: UnifiedSearchResponseSchema,
  defaultParams: {
    page_size: 20,
    sort_by: "created_at",
    sort_direction: "desc",
  },
  debounceMs: 300,
  cacheTimeout: 60000,
});
```

**Detailed Component Structure**:

```typescript
function SearchDemoContent() {
  // === UNIFIED SEARCH HOOK ===
  const search = useUnifiedSearch(musicSearchConfig);

  // === UI STATE ===
  const [selectedView, setSelectedView] = createSignal<'grid' | 'list'>('grid');
  const [showAdvancedFilters, setShowAdvancedFilters] = createSignal(false);
  const [selectedSongs, setSelectedSongs] = createSignal<Set<string>>(new Set());

  // === SEARCH INPUT HANDLING ===
  const handleSearchInput = (value: string) => {
    search.setSearchQuery(value);
    // Automatically triggers search via hook reactivity
  };

  // === FILTER MANAGEMENT ===
  const handleFilterChange = (filterKey: string, value: any) => {
    if (value === null || value === undefined || value === '') {
      search.removeFilter(filterKey);
    } else {
      search.addFilter(filterKey, value);
    }
    // Automatically triggers search via hook reactivity
  };

  // === SORTING ===
  const handleSort = (field: string) => {
    search.toggleSort(field);
    // Automatically triggers search via hook reactivity
  };

  // === PAGINATION ===
  const handlePageChange = (page: number) => {
    search.goToPage(page);
    // Automatically triggers search via hook reactivity
  };

  // === COMPONENT RENDER ===
  return (
    <div class="search-demo">
      {/* === SEARCH HEADER === */}
      <SearchHeader
        searchQuery={search.searchQuery()}
        onSearchChange={handleSearchInput}
        suggestions={search.searchSuggestions()}
        loading={search.searching()}
        onAdvancedToggle={() => setShowAdvancedFilters(!showAdvancedFilters())}
        showAdvanced={showAdvancedFilters()}
      />

      {/* === ADVANCED FILTERS === */}
      <Show when={showAdvancedFilters()}>
        <AdvancedFilters
          filterOptions={search.filterOptions()}
          activeFilters={search.activeFilters()}
          onFilterChange={handleFilterChange}
          onClearAll={search.clearFilters}
        />
      </Show>

      {/* === SEARCH RESULTS === */}
      <SearchResults
        results={search.results()}
        totalCount={search.totalCount()}
        loading={search.loading()}
        error={search.error()}
        sortBy={search.sortBy()}
        sortDirection={search.sortDirection()}
        onSort={handleSort}
        selectedView={selectedView()}
        onViewChange={setSelectedView}
        selectedSongs={selectedSongs()}
        onSelectionChange={setSelectedSongs}
      />

      {/* === PAGINATION === */}
      <Pagination
        currentPage={search.currentPage()}
        totalPages={search.totalPages()}
        hasNext={search.hasNext()}
        hasPrev={search.hasPrev()}
        onPageChange={handlePageChange}
        onNext={search.nextPage}
        onPrev={search.prevPage}
        loading={search.loading()}
      />

      {/* === DEBUG INFO === */}
      <Show when={search.debugInfo()}>
        <SearchDebug
          metadata={search.searchMetadata()}
          debugInfo={search.debugInfo()}
          appliedFilters={search.appliedFilters()}
        />
      </Show>
    </div>
  );
}
```

**Key Improvements**:

1. **Eliminated Dual Endpoint Logic**: Single `search` hook handles everything
2. **Reactive State Management**: Changes automatically trigger searches
3. **Comprehensive Filter UI**: All server filters available in UI
4. **Real-time Suggestions**: Built into search input
5. **Better Error Handling**: Centralized error management
6. **Performance Optimized**: Debouncing, caching, efficient updates
7. **URL Synchronization**: Bookmarkable search states
8. **Debug Information**: Admin-friendly debugging tools

### 3. Generic Filter Components

**Domain-configurable filter components**:

- `FilterDropdown` - For artist, album, genre selection
- `FilterRange` - For year, rating, duration ranges
- `FilterTags` - Multi-tag selection with autocomplete
- `FilterDateRange` - Date range picker for created/updated
- `FilterToggle` - Boolean filters (favorites, has_thumbnail)

### 4. Updated Library Code

**`client/js/src/lib/search/admin/`**:

- `AdminSearchClient.ts` - Generic admin search API client
- `admin-search-schemas.ts` - Zod schemas for admin search responses
- `admin-filter-types.ts` - TypeScript types for filter configurations

**`client/js/src/lib/music/admin/`**:

- `music-admin-search.ts` - Music-specific search configuration
- `music-filter-config.ts` - Music filter field definitions
- `music-search-validation.ts` - Music-specific validation rules

---

## Implementation Phases

### Phase 1: Server Infrastructure Replacement (Priority 1)

**Week 1: Core Search API Replacement**

1. **Replace `search_music` function** in `tomb/server/src/media/search.rs`:
   - Implement `UnifiedSearchParams` structure
   - Build comprehensive filter application logic
   - Replace `SearchResponse` with `UnifiedSearchResponse`
   - Handle all query types (text, filter-only, show-all)

2. **Database Query Optimization**:
   - Create optimized SQL generation for complex filter combinations
   - Add proper indexing for new filter fields (tags, duration, file_format)
   - Implement efficient pagination for large result sets
   - Add query performance monitoring and logging

3. **Remove `filter_music` endpoint**:
   - Consolidate all logic into single `search_music` endpoint
   - Update routing to remove `/api/music/filter` route
   - Ensure no dependencies on old filter endpoint

**Week 2: Enhanced Filter Infrastructure**

1. **Implement `/api/music/filter-options` endpoint**:
   - Build comprehensive filter option queries
   - Add result caching for performance
   - Include statistical data and distributions
   - Optimize for large music libraries (100k+ songs)

2. **Implement `/api/music/suggestions` endpoint**:
   - Real-time autocomplete for artist, album, genre, title fields
   - Fuzzy matching and typo correction
   - Performance optimization for sub-100ms response times
   - Result ranking by relevance and popularity

3. **Database Schema Updates**:
   - Add missing indexes for new filter fields
   - Optimize existing indexes for compound queries
   - Add full-text search indexes for better text search performance

### Phase 2: Client-Side Unification (Priority 1)

**Week 3: Unified Search Hook Implementation**

1. **Create `useUnifiedSearch` hook**:
   - Implement complete state management for all search scenarios
   - Add debounced search with configurable timing
   - Include URL synchronization for bookmarkable searches
   - Build comprehensive TypeScript types and Zod schemas

2. **Search Client Infrastructure**:
   - Create unified API client class replacing dual endpoint logic
   - Implement response validation and error handling
   - Add request deduplication for performance
   - Build retry logic with exponential backoff
   - Handle pagination for all endpoints (search, filter-options, suggestions)
     // Handle pagination for filter options and suggestions

**Week 4: search-demo.tsx Complete Refactoring**

1. **Remove Dual Endpoint Logic**:
   - Replace complex endpoint switching with single search call
   - Simplify state management and data flow
   - Remove unnecessary mode switching logic
   - Clean up error handling across different code paths

2. **Enhanced Filter UI**:
   - Implement all new filter options in user interface
   - Add real-time suggestions and autocomplete
     // Add filter preset system for common searches
     // Add filter clear/reset functionality
     // Implement pagination for filter options UI

3. **Performance and UX Improvements**:
   - Add loading states and skeleton UI
   - Implement infinite scroll pagination
   - Add search result highlighting
   - Improve mobile responsiveness

### Phase 3: Music Admin UI Integration (Priority 2)

**Week 5: Admin Grid Integration**

1. **Update Music Admin Configuration**:
   - Replace `musicAdminConfig.apiEndpoint` to use new search endpoint
   - Update schema validation to use `UnifiedSearchResponse`
   - Integrate with existing admin data hooks
   - Ensure compatibility with selection and bulk operations

2. **Enhanced Admin Filtering**:
   - Connect admin search header to unified search API
   - Implement advanced filter panel with all options
   - Add admin-specific features (show deleted, include hidden)
   - Build filter preset management for admin workflows

### Phase 4: Testing and Performance (Priority 2)

**Week 6: Comprehensive Testing**

1. **Performance Testing**:
   - Test with large music libraries (10k, 50k, 100k+ songs)
   - Benchmark search response times for complex queries
   - Test concurrent user scenarios
   - Optimize database queries based on results

2. **Integration Testing**:
   - Test all filter combinations and edge cases
   - Verify pagination works correctly for all scenarios
   - Test error handling and recovery
   - Validate search suggestions and autocomplete

3. **User Experience Testing**:
   - Test search-demo.tsx with real usage patterns
   - Verify admin UI workflows are smooth and intuitive
   - Test mobile and responsive behavior
   - Validate accessibility compliance

**Week 7: Documentation and Polish**

1. **API Documentation**:
   - Document all `UnifiedSearchParams` options
   - Provide comprehensive API examples
   - Create migration guide from old search system
   - Document performance characteristics and limitations

2. **Code Cleanup**:
   - Remove all old search/filter endpoint code
   - Clean up unused types and schemas
   - Update all related documentation
   - Prepare for domain extension patterns

### Phase 5: Future Domain Framework (Priority 3)

**Future Development: Domain Extension Preparation**

1. **Generic Search Traits**:
   - Extract domain-agnostic search patterns
   - Create reusable search infrastructure
   - Document domain extension guidelines
   - Prepare for photos/videos/docs domains

2. **Infrastructure Scaling**:
   - Design multi-domain search routing
   - Plan for domain-specific optimization needs
   - Create shared search components and hooks
   - Establish performance monitoring across domains

---

## Success Criteria

### Performance Targets

- **Large Collections**: Handle 100k+ songs smoothly
- **Search Speed**: < 200ms average response time for complex queries
- **Filter UI**: < 50ms filter option loading
- **Pagination**: Smooth infinite scroll with 100+ items per page

### User Experience Goals

- **Initial Load**: Works without any filters (show all)
- **Filter Discovery**: All available filter options clearly presented
- **Real-time Feedback**: Instant search suggestions and filter counts
- **Complex Queries**: Support multiple simultaneous filters with ranges
- **Admin Workflows**: Seamless integration with bulk operations and editing

### Technical Requirements

- **Domain Separation**: Music logic cleanly separated for future domain extension
- **Backwards Compatibility**: Existing search endpoints continue working unchanged
- **Type Safety**: Full TypeScript coverage with Zod validation
- **Error Handling**: Graceful degradation and clear error messages
- **Testing**: Comprehensive test coverage for all search scenarios

---

## Migration Strategy

### Code Replacement Impact

**Files Being Completely Replaced**:

1. **`tomb/server/src/media/search.rs`**:
   - Remove `filter_music` function entirely
   - Replace `search_music` with unified implementation
   - Replace `SearchParams`/`FilterParams` with `UnifiedSearchParams`
   - Replace `SearchResponse` with `UnifiedSearchResponse`

2. **`tomb/client/js/src/web-components/search-demo.tsx`**:
   - Remove dual endpoint switching logic (~200 lines)
   - Replace with single `useUnifiedSearch` hook
   - Simplify component structure significantly
   - Add comprehensive filter UI

3. **Search-related client libraries**:
   - Update existing search hooks to use unified API
   - Replace dual API clients with single search client
   - Update all search-related TypeScript types

**New Files Being Created**:

1. **`tomb/client/js/src/hooks/search/useUnifiedSearch.ts`** - Core search hook
2. **`tomb/client/js/src/lib/search/unified-search-schemas.ts`** - Zod validation
3. **`tomb/client/js/src/lib/search/search-client.ts`** - API client
4. **Enhanced filter components** - Comprehensive filter UI

### Deployment Strategy

**Single-Phase Replacement (No Backwards Compatibility)**:

1. **Deploy Server Changes**: Replace search endpoints with unified implementation
2. **Deploy Client Changes**: Update search-demo.tsx and admin UI simultaneously
3. **Remove Old Code**: Clean up all unused search/filter code immediately
4. **Monitor and Fix**: Address any issues discovered during rollout

**Risk Mitigation Without Backwards Compatibility**:

- **Comprehensive Testing**: Extensive testing before deployment
- **Staged Rollout**: Deploy to staging environment first
- **Quick Rollback**: Ability to quickly revert entire changeset
- **Monitoring**: Real-time performance and error monitoring
- **Fallback Plan**: Revert to previous git commit if critical issues arise

### Benefits of No Backwards Compatibility

1. **Cleaner Codebase**: No dual endpoint logic or compatibility layers
2. **Faster Development**: No need to maintain multiple API versions
3. **Better Performance**: Single optimized code path
4. **Easier Testing**: Single system to test thoroughly
5. **Simpler Documentation**: One API to document and understand

---

## Future Domain Extension

### Photos Domain Example

```rust
// Future photos admin search
pub struct PhotoAdminParams {
    pub q: Option<String>,
    pub tags: Option<Vec<String>>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub iso_min: Option<u32>,
    pub iso_max: Option<u32>,
    pub date_taken_after: Option<String>,
    pub date_taken_before: Option<String>,
    pub has_location: Option<bool>,
    pub has_faces: Option<bool>,
    pub file_format: Option<String>,
    // ... other photo-specific filters
}
```

### Videos Domain Example

```rust
// Future videos admin search
pub struct VideoAdminParams {
    pub q: Option<String>,
    pub duration_min: Option<u32>,
    pub duration_max: Option<u32>,
    pub resolution: Option<String>,
    pub codec: Option<String>,
    pub frame_rate_min: Option<f32>,
    pub has_subtitles: Option<bool>,
    pub has_thumbnail: Option<bool>,
    // ... other video-specific filters
}
```

The domain-agnostic framework will support all these use cases with minimal additional code, following the patterns established in the music domain implementation.
