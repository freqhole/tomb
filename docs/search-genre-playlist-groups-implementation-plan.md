# Search Genre and Playlist Groups Implementation Plan

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
10. **MAXIMUM CODE REUSE**: Reuse existing song edit forms, bulk operations, filtering APIs, and modal systems.

## Work Progress Tracking

### Phase 1: Backend API Extensions

- [ ] 1.1 Extend PostSearchRequest to Support Result Grouping
- [ ] 1.2 Extend Database Search Function
- [ ] 1.3 Update search_music_post Handler
- [ ] **Status**: Not Started
- [ ] **Ready for Review**: No

### Phase 2: Frontend Store Extensions

- [ ] 2.1 Update Global Store Interface
- [ ] 2.2 Create Enhanced Search Store Actions
- [ ] **Status**: Not Started
- [ ] **Ready for Review**: No

### Phase 3: Zod Schema Extensions

- [ ] 3.1 Create Enhanced Search Schemas
- [ ] **Status**: Not Started
- [ ] **Ready for Review**: No

### Phase 4: UI Components

- [ ] 4.1 Create Genre Results Component
- [ ] 4.2 Create Playlist Results Component
- [ ] 4.3 Update SearchResultsView
- [ ] **Status**: Not Started
- [ ] **Ready for Review**: No

## Overview

This document outlines the technical implementation plan for adding **genre** and **playlist** groups to the existing FTS (Full-Text Search) system. Currently, search returns songs with artists/albums filtered and re-rendered. We need to extend this to include genre and playlist groupings using the existing POST `/api/media/search` endpoint and global store.

## Current Architecture Analysis

### Backend Structure

- **Existing POST API**: `/api/media/search` - Comprehensive search with filters, pagination, sorting
- **Database Functions**: `search_songs()` with full metadata and user preferences
- **Data Models**: `PostSearchRequest`, `PostSearchFilters`, `SongListResponse`
- **Genre Support**: Songs have `genre` field + `sub_genres` array, config groups genres for UI

### Frontend Structure

- **Global Store**: `client/js/src/views/freqhole/store/index.tsx` with search state management
- **Search State**: `search.results` currently has `songs`, `artists`, `albums` arrays
- **Navigation**: `currentView` supports "songs", "artists", "albums", "playlists", "genres"
- **Existing Flow**: Data flows through store actions, components reactively render

## Implementation Plan

### Phase 1: Backend API Extensions

#### 1.1 Extend PostSearchRequest to Support Result Grouping

Update `server/src/media/search.rs`:

```rust
// Add to PostSearchRequest
#[derive(Debug, Deserialize, Clone, Default)]
pub struct PostSearchRequest {
    // ... existing fields ...

    // New grouping options
    pub include_genres: Option<bool>,
    pub include_playlists: Option<bool>,
    pub group_by: Option<String>, // "all", "genres", "playlists"
}

// Extend PostSearchResponse to include grouped results
#[derive(Debug, Serialize)]
pub struct PostSearchResponse {
    pub songs: Vec<SongResponse>,

    // New grouped result sections
    pub genres: Option<Vec<GenreGroupResult>>,
    pub playlists: Option<Vec<PlaylistGroupResult>>,

    // Existing pagination/metadata
    pub total_count: u64,
    pub page: u32,
    pub page_size: u32,
    pub total_pages: u32,
    pub has_next: bool,
    pub has_prev: bool,
    pub query_time_ms: Option<u64>,
    pub applied_filters: Option<AppliedFiltersInfo>,
    pub sort_applied: Option<SortAppliedInfo>,
}

#[derive(Debug, Serialize)]
pub struct GenreGroupResult {
    pub genre: String,
    pub song_count: u32,
    pub artist_count: u32,
    pub representative_song_id: Option<String>,
    pub representative_thumbnail: Option<String>,
    pub avg_rating: Option<f32>,
    pub search_rank: f32,
}

#[derive(Debug, Serialize)]
pub struct PlaylistGroupResult {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub song_count: u32,
    pub is_public: bool,
    pub thumbnail_blob_id: Option<String>,
    pub created_at: String,
    pub search_rank: f32,
}
```

#### 1.2 Extend Database Search Function

Update the database search to support genre and playlist aggregation. Extend the existing `search_songs()` function or create wrapper queries:

```sql
-- Add genre aggregation support to existing search
-- This supplements the existing search_songs() function
CREATE OR REPLACE FUNCTION get_genre_aggregations(
    p_user_id UUID DEFAULT NULL,
    p_search_query TEXT DEFAULT NULL,
    p_search_type TEXT DEFAULT 'websearch',
    p_genre_filter TEXT DEFAULT NULL,
    p_include_sub_genres BOOLEAN DEFAULT TRUE,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
) RETURNS TABLE (
    genre TEXT,
    song_count BIGINT,
    artist_count BIGINT,
    representative_song_id UUID,
    representative_thumbnail TEXT,
    avg_rating DECIMAL,
    search_rank REAL
) AS $$
BEGIN
    RETURN QUERY
    WITH genre_search AS (
        SELECT
            CASE
                WHEN p_include_sub_genres THEN
                    UNNEST(ARRAY[s.genre] || COALESCE(s.sub_genres, ARRAY[]::TEXT[]))
                ELSE s.genre
            END as genre_name,
            s.id,
            s.artist,
            s.thumbnail_blob_id,
            p.rating,
            CASE
                WHEN p_search_query IS NOT NULL THEN
                    ts_rank(
                        to_tsvector('english', s.genre || ' ' || array_to_string(COALESCE(s.sub_genres, ARRAY[]::TEXT[]), ' ')),
                        plainto_tsquery('english', p_search_query)
                    )
                ELSE 1.0
            END as rank,
            s.created_at
        FROM songs s
        LEFT JOIN user_song_preferences p ON s.id = p.song_id AND p.user_id = p_user_id
        WHERE (p_search_query IS NULL OR
               to_tsvector('english', s.genre || ' ' || array_to_string(COALESCE(s.sub_genres, ARRAY[]::TEXT[]), ' ')) @@
               plainto_tsquery('english', p_search_query))
        AND (p_genre_filter IS NULL OR
             s.genre ILIKE '%' || p_genre_filter || '%' OR
             EXISTS(SELECT 1 FROM unnest(s.sub_genres) sg WHERE sg ILIKE '%' || p_genre_filter || '%'))
    ),
    genre_stats AS (
        SELECT
            genre_name,
            COUNT(DISTINCT id) as song_count,
            COUNT(DISTINCT artist) as artist_count,
            (ARRAY_AGG(id ORDER BY created_at DESC))[1] as representative_song_id,
            (ARRAY_AGG(thumbnail_blob_id ORDER BY created_at DESC))[1] as representative_thumbnail,
            AVG(rating) as avg_rating,
            MAX(rank) as search_rank
        FROM genre_search
        WHERE genre_name IS NOT NULL
        GROUP BY genre_name
        ORDER BY search_rank DESC, song_count DESC
        LIMIT p_limit OFFSET p_offset
    )
    SELECT
        gs.genre_name,
        gs.song_count,
        gs.artist_count,
        gs.representative_song_id,
        gs.representative_thumbnail,
        gs.avg_rating,
        gs.search_rank
    FROM genre_stats gs;
END;
$$ LANGUAGE plpgsql;

-- Add playlist search with FTS support
CREATE OR REPLACE FUNCTION get_playlist_search_results(
    p_user_id UUID DEFAULT NULL,
    p_search_query TEXT DEFAULT NULL,
    p_search_type TEXT DEFAULT 'websearch',
    p_include_private BOOLEAN DEFAULT FALSE,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
) RETURNS TABLE (
    id UUID,
    title TEXT,
    description TEXT,
    song_count INTEGER,
    is_public BOOLEAN,
    thumbnail_blob_id TEXT,
    created_at TIMESTAMPTZ,
    search_rank REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.title,
        p.description,
        COALESCE((SELECT COUNT(*)::integer FROM playlist_songs ps WHERE ps.playlist_id = p.id), 0) as song_count,
        p.is_public,
        p.thumbnail_blob_id,
        p.created_at,
        CASE
            WHEN p_search_query IS NOT NULL THEN
                ts_rank(
                    to_tsvector('english', p.title || ' ' || COALESCE(p.description, '')),
                    plainto_tsquery('english', p_search_query)
                )
            ELSE 1.0
        END as search_rank
    FROM playlists p
    WHERE (p.is_public = true OR (p_include_private = true AND p.user_id = p_user_id))
    AND (p_search_query IS NULL OR
         to_tsvector('english', p.title || ' ' || COALESCE(p.description, '')) @@
         plainto_tsquery('english', p_search_query))
    ORDER BY search_rank DESC, p.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;
```

#### 1.3 Update search_music_post Handler

Extend the existing `search_music_post` function:

```rust
pub async fn search_music_post(
    Extension(user): Extension<AuthenticatedUser>,
    Extension(db): Extension<DatabaseConnection>,
    Json(request): Json<PostSearchRequest>,
) -> Result<Json<PostSearchResponse>, StatusCode> {
    let start_time = std::time::Instant::now();

    // Get existing song search results (reuse existing logic)
    let song_results = get_existing_song_search_logic(&request, &user, &db).await?;

    // Get genre aggregations if requested
    let genres = if request.include_genres.unwrap_or(false) || request.group_by.as_deref() == Some("all") {
        get_genre_aggregations(&request, &user, &db).await.ok()
    } else {
        None
    };

    // Get playlist results if requested
    let playlists = if request.include_playlists.unwrap_or(false) || request.group_by.as_deref() == Some("all") {
        get_playlist_search_results(&request, &user, &db).await.ok()
    } else {
        None
    };

    let query_time_ms = start_time.elapsed().as_millis() as u64;

    let response = PostSearchResponse {
        songs: song_results.songs,
        genres,
        playlists,
        total_count: song_results.total_count,
        page: request.page,
        page_size: request.page_size,
        total_pages: song_results.total_pages,
        has_next: song_results.has_next,
        has_prev: song_results.has_prev,
        query_time_ms: Some(query_time_ms),
        applied_filters: song_results.applied_filters,
        sort_applied: song_results.sort_applied,
    };

    Ok(Json(response))
}

// Helper functions for genre and playlist aggregation
async fn get_genre_aggregations(
    request: &PostSearchRequest,
    user: &AuthenticatedUser,
    db: &DatabaseConnection,
) -> Result<Vec<GenreGroupResult>, StatusCode> {
    let rows = sqlx::query!(
        r#"
        SELECT genre, song_count, artist_count, representative_song_id,
               representative_thumbnail, avg_rating, search_rank
        FROM get_genre_aggregations($1, $2, $3, $4, $5, $6, $7)
        "#,
        Some(user.user_id),
        request.query.as_ref(),
        request.search_type.as_ref().unwrap_or(&"websearch".to_string()),
        request.filters.as_ref().and_then(|f| f.genre.as_ref()),
        true, // include_sub_genres
        10i32, // limit for "all" view
        0i32  // offset
    )
    .fetch_all(&db.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let results = rows.into_iter().map(|row| GenreGroupResult {
        genre: row.genre.unwrap_or_default(),
        song_count: row.song_count.unwrap_or(0) as u32,
        artist_count: row.artist_count.unwrap_or(0) as u32,
        representative_song_id: row.representative_song_id.map(|id| id.to_string()),
        representative_thumbnail: row.representative_thumbnail,
        avg_rating: row.avg_rating.map(|r| r.to_string().parse().unwrap_or(0.0)),
        search_rank: row.search_rank.unwrap_or(0.0),
    }).collect();

    Ok(results)
}

async fn get_playlist_search_results(
    request: &PostSearchRequest,
    user: &AuthenticatedUser,
    db: &DatabaseConnection,
) -> Result<Vec<PlaylistGroupResult>, StatusCode> {
    let is_admin = user.role == "admin"; // TODO: check actual admin role logic

    let rows = sqlx::query!(
        r#"
        SELECT id, title, description, song_count, is_public,
               thumbnail_blob_id, created_at, search_rank
        FROM get_playlist_search_results($1, $2, $3, $4, $5, $6)
        "#,
        Some(user.user_id),
        request.query.as_ref(),
        request.search_type.as_ref().unwrap_or(&"websearch".to_string()),
        is_admin, // include_private
        10i32, // limit for "all" view
        0i32  // offset
    )
    .fetch_all(&db.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let results = rows.into_iter().map(|row| PlaylistGroupResult {
        id: row.id.unwrap().to_string(),
        title: row.title.unwrap_or_default(),
        description: row.description,
        song_count: row.song_count.unwrap_or(0) as u32,
        is_public: row.is_public.unwrap_or(false),
        thumbnail_blob_id: row.thumbnail_blob_id,
        created_at: row.created_at.unwrap().to_string(),
        search_rank: row.search_rank.unwrap_or(0.0),
    }).collect();

    Ok(results)
}
```

### Phase 2: Frontend Store Extensions

#### 2.1 Update Global Store Interface

Extend `client/js/src/views/freqhole/store/index.tsx`:

```typescript
// Update FreqholeStore interface
export interface FreqholeStore {
  // ... existing fields ...
  search: {
    query: string;
    results: {
      songs: any[];
      artists: any[];
      albums: any[];
      // Add new result types
      genres: GenreSummary[];
      playlists: PlaylistSummary[];
    };
    // Add active tab state
    activeTab: "all" | "songs" | "artists" | "albums" | "genres" | "playlists";
    isActive: boolean;
    loading: boolean;
  };
  // ... rest unchanged ...
}

// Update initial state
const initialState: FreqholeStore = {
  // ... existing fields ...
  search: {
    query: "",
    results: {
      songs: [],
      artists: [],
      albums: [],
      genres: [],
      playlists: [],
    },
    activeTab: "all",
    isActive: false,
    loading: false,
  },
  // ... rest unchanged ...
};

// Add to storeActions
export const storeActions = {
  // ... existing actions ...

  // Enhanced search actions
  setSearchResults: (results: {
    songs?: any[];
    artists?: any[];
    albums?: any[];
    genres?: GenreSummary[];
    playlists?: PlaylistSummary[];
  }) => {
    setStore("search", "results", (prev) => ({ ...prev, ...results }));
  },

  setActiveSearchTab: (tab: FreqholeStore["search"]["activeTab"]) =>
    setStore("search", "activeTab", tab),

  clearSearchResults: () => {
    setStore("search", {
      query: "",
      isActive: false,
      activeTab: "all",
      results: {
        songs: [],
        artists: [],
        albums: [],
        genres: [],
        playlists: [],
      },
    });
  },

  // ... rest unchanged ...
};
```

#### 2.2 Create Enhanced Search Store Actions

Create `client/js/src/views/freqhole/store/search-actions.ts`:

```typescript
import { SetStoreFunction } from "solid-js/store";
import { FreqholeStore } from "./index";
import { apiClient } from "../../../lib/api-client";

export interface SearchParams {
  query?: string;
  include_genres?: boolean;
  include_playlists?: boolean;
  group_by?: "all" | "genres" | "playlists";
  page?: number;
  page_size?: number;
  filters?: {
    genre?: string;
    artist?: string;
    album?: string;
    is_favorite?: boolean;
    tags?: string[];
  };
}

export function createSearchActions(
  store: FreqholeStore,
  setStore: SetStoreFunction<FreqholeStore>,
) {
  const executeEnhancedSearch = async (params: SearchParams) => {
    setStore("search", "loading", true);

    try {
      // Call existing POST /api/media/search endpoint with enhanced params
      const response = await apiClient.makeRequest(
        "POST",
        "/api/media/search",
        {
          data: {
            query: params.query,
            include_genres: params.include_genres ?? true,
            include_playlists: params.include_playlists ?? true,
            group_by: params.group_by,
            page: params.page ?? 1,
            page_size: params.page_size ?? 20,
            filters: params.filters,
          },
        },
      );

      // Parse and validate response
      const searchResults = EnhancedSearchResponseSchema.parse(response);

      // Update store with all result types
      setStore("search", "results", {
        songs: searchResults.songs || [],
        artists: extractArtistsFromSongs(searchResults.songs || []),
        albums: extractAlbumsFromSongs(searchResults.songs || []),
        genres: searchResults.genres || [],
        playlists: searchResults.playlists || [],
      });

      setStore("search", {
        query: params.query || "",
        isActive: true,
        loading: false,
      });
    } catch (error) {
      console.error("Enhanced search failed:", error);
      setStore("search", "loading", false);
      // TODO: handle error state
    }
  };

  const searchByGenre = async (genreName: string) => {
    await executeEnhancedSearch({
      filters: { genre: genreName },
      group_by: "all",
    });
    setStore("search", "activeTab", "songs");
  };

  const searchWithQuery = async (query: string) => {
    await executeEnhancedSearch({
      query,
      group_by: "all",
    });
  };

  return {
    executeEnhancedSearch,
    searchByGenre,
    searchWithQuery,
  };
}

// Helper function to extract artists from songs (existing pattern)
function extractArtistsFromSongs(songs: any[]) {
  const artistMap = new Map();
  songs.forEach((song) => {
    if (song.artist && !artistMap.has(song.artist)) {
      artistMap.set(song.artist, {
        artist: song.artist,
        song_count: 0,
      });
    }
    if (song.artist) {
      artistMap.get(song.artist).song_count++;
    }
  });
  return Array.from(artistMap.values());
}

// Helper function to extract albums from songs (existing pattern)
function extractAlbumsFromSongs(songs: any[]) {
  const albumMap = new Map();
  songs.forEach((song) => {
    const key = `${song.album}-${song.artist}`;
    if (song.album && !albumMap.has(key)) {
      albumMap.set(key, {
        album: song.album,
        artist: song.artist,
        song_count: 0,
      });
    }
    if (song.album) {
      albumMap.get(key).song_count++;
    }
  });
  return Array.from(albumMap.values());
}
```

### Phase 3: Zod Schema Extensions

#### 3.1 Create Enhanced Search Schemas

Create `client/js/src/lib/music/enhanced-search-schemas.ts`:

```typescript
import { z } from "zod";

// Genre result schema
export const GenreSummarySchema = z.object({
  genre: z.string(),
  song_count: z.number().int().min(0),
  artist_count: z.number().int().min(0),
  representative_song_id: z.string().nullable().optional(),
  representative_thumbnail: z.string().nullable().optional(),
  avg_rating: z.number().min(0).max(5).nullable().optional(),
  search_rank: z.number(),
});

// Playlist result schema
export const PlaylistSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable().optional(),
  song_count: z.number().int().min(0),
  is_public: z.boolean(),
  thumbnail_blob_id: z.string().nullable().optional(),
  created_at: z.string(),
  search_rank: z.number(),
});

// Enhanced search response schema (extends existing)
export const EnhancedSearchResponseSchema = z.object({
  songs: z.array(z.unknown()), // Use existing SongSchema
  genres: z.array(GenreSummarySchema).optional(),
  playlists: z.array(PlaylistSummarySchema).optional(),
  total_count: z.number().int().min(0),
  page: z.number().int().min(1),
  page_size: z.number().int().min(1),
  total_pages: z.number().int().min(0),
  has_next: z.boolean(),
  has_prev: z.boolean(),
  query_time_ms: z.number().int().min(0).optional(),
  applied_filters: z.unknown().optional(),
  sort_applied: z.unknown().optional(),
});

export type GenreSummary = z.infer<typeof GenreSummarySchema>;
export type PlaylistSummary = z.infer<typeof PlaylistSummarySchema>;
export type EnhancedSearchResponse = z.infer<
  typeof EnhancedSearchResponseSchema
>;
```

### Phase 4: UI Components

#### 4.1 Create Genre Results Component

Create `client/js/src/components/music/GenreResultsSection.tsx`:

```typescript
import { For, Show } from "solid-js";
import { GenreSummary } from "../../lib/music/enhanced-search-schemas";

interface GenreResultsSectionProps {
  genres: GenreSummary[];
  onGenreClick: (genre: string) => void;
  showAll?: boolean;
  class?: string;
}

export function GenreResultsSection(props: GenreResultsSectionProps) {
  const displayGenres = () =>
    props.showAll ? props.genres : props.genres.slice(0, 10);

  const formatRating = (rating: number | null | undefined) => {
    if (!rating) return "";
    return "★".repeat(Math.round(rating));
  };

  return (
    <div class={props.class}>
      <h2 class="text-xl font-semibold text-white mb-4">
        genres ({props.genres.length})
      </h2>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <For each={displayGenres()}>
          {(genre) => (
            <div
              class="p-4 bg-gray-900 hover:bg-gray-800 transition-colors cursor-pointer"
              onClick={() => props.onGenreClick(genre.genre)}
            >
              <div class="flex items-center gap-3">
                <Show when={genre.representative_thumbnail}>
                  <img
                    src={`/api/blob/${genre.representative_thumbnail}`}
                    class="w-12 h-12 object-cover"
                    alt={`${genre.genre} genre`}
                  />
                </Show>
                <div class="flex-1">
                  <div class="text-white font-medium capitalize">
                    {genre.genre}
                  </div>
                  <div class="text-magenta-400 text-sm">
                    {genre.song_count} songs • {genre.artist_count} artists
                  </div>
                  <Show when={genre.avg_rating}>
                    <div class="text-white text-xs">
                      {formatRating(genre.avg_rating)}
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          )}
        </For>
      </div>
      <Show when={!props.showAll && props.genres.length > 10}>
        <button
          class="w-full py-2 mt-4 text-magenta-400 hover:text-magenta-300 transition-colors"
          onClick={() => {/* TODO: handle show all */}}
        >
          view all {props.genres.length} genres
        </button>
      </Show>
    </div>
  );
}
```

#### 4.2 Create Playlist Results Component

Create `client/js/src/components/music/PlaylistResultsSection.tsx`:

```typescript
import { For, Show } from "solid-js";
import { PlaylistSummary } from "../../lib/music/enhanced-search-schemas";

interface PlaylistResultsSectionProps {
  playlists: PlaylistSummary[];
  onPlaylistClick: (playlistId: string) => void;
  showAll?: boolean;
  class?: string;
}

export function PlaylistResultsSection(props: PlaylistResultsSectionProps) {
  const displayPlaylists = () =>
    props.showAll ? props.playlists : props.playlists.slice(0, 10);

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString();
    } catch {
      return "unknown date";
    }
  };

  return (
    <div class={props.class}>
      <h2 class="text-xl font-semibold text-white mb-4">
        playlists ({props.playlists.length})
      </h2>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <For each={displayPlaylists()}>
          {(playlist) => (
            <div
              class="p-4 bg-gray-900 hover:bg-gray-800 transition-colors cursor-pointer"
              onClick={() => props.onPlaylistClick(playlist.id)}
            >
              <div class="flex items-center gap-3">
                <Show when={playlist.thumbnail_blob_id}>
                  <img
                    src={`/api/blob/${playlist.thumbnail_blob_id}`}
                    class="w-12 h-12 object-cover"
                    alt={`${playlist.title} playlist`}
                  />
                </Show>
                <div class="flex-1">
                  <div class="text-white font-medium truncate">
                    {playlist.title}
                  </div>
                  <div class="text-magenta-400 text-sm">
                    {playlist.song_count} songs
                  </div>
                  <div class="text-gray-400 text-xs">
                    {playlist.is_public ? "public" : "private"} • {formatDate(playlist.created_at)}
                  </div>
                </div>
              </div>
            </div>
          )}
        </For>
      </div>
      <Show when={!props.showAll && props.playlists.length > 10}>
        <button
          class="w-full py-2 mt-4 text-magenta-400 hover:text-magenta-300 transition-colors"
          onClick={() => {/* TODO: handle show all */}}
        >
          view all {props.playlists.length} playlists
        </button>
      </Show>
    </div>
  );
}
```

#### 4.3 Update SearchResultsView

Update `client/js/src/views/freqhole/components/content/views/SearchResultsView.tsx`:

```typescript
// TODO: migrate from useSearch to enhanced search store patterns
import { useStore, useReactiveActions } from "../../../store";
import { GenreResultsSection } from "../../../../../components/music/GenreResultsSection";
import { PlaylistResultsSection } from "../../../../../components/music/PlaylistResultsSection";

// Enhanced tab types
type ResultTab = "all" | "songs" | "artists" | "albums" | "genres" | "playlists";

export function SearchResultsView(props: SearchResultsViewProps) {
  const [store] = useStore();
  const actions = useReactiveActions();

  // Navigation handlers
  const handleGenreClick = (genreName: string) => {
    actions.searchByGenre(genreName);
    navigate(`/search?genre=${encodeURIComponent(genreName)}`);
  };

  const handlePlaylistClick = (playlistId: string) => {
    navigate(`/playlist/${playlistId}`);
  };

  const handleTabChange = (tab: ResultTab) => {
    actions.setActiveSearchTab(tab);
  };

  // Tab counts
  const getTabCount = (tab: ResultTab) => {
    switch (tab) {
      case "all":
        return store.search.results.songs.length +
               store.search.results.genres.length +
               store.search.results.playlists.length;
      case "songs":
        return store.search.results.songs.length;
      case "artists":
        return store.search.results.artists.length;
      case "albums":
        return store.search.results.albums.length;
      case "genres":
        return store.search.results.genres.length;
      case "playlists":
        return store.search.results.playlists.length;
      default:
        return 0;
    }
  };

  const tabConfigs = [
    { id: "all" as const, label: "all" },
    { id: "songs" as const, label: "songs" },
    { id: "artists" as const, label: "artists" },
    { id: "albums" as const, label: "albums" },
    { id: "genres" as const, label: "genres" },
    { id: "playlists" as const, label: "playlists" },
  ];

  return (
    <div class="flex flex-col h-full bg-black text-white w-full max-w-full">
      {/* Search Header - reuse existing header */}
      <div class="sticky top-0 z-10 bg-black backdrop-blur-sm p-6">
        <Show when={store.search.query}>
          <div class="mb-4">
            <h1 class="text-2xl font-bold text-white mb-2">
              search results for "{store.search.query}"
            </h1>
          </div>

          {/* Tab Navigation - updated with new tabs */}
          <div class="flex gap-1 overflow-x-auto scrollbar-none">
            <For each={tabConfigs}>
              {(tab) => (
                <button
                  class={`px-4 py-2 font-medium transition-all whitespace-nowrap ${
                    store.search.activeTab === tab.id
                      ? "bg-magenta-600 text-white"
                      : "bg-gray-900 text-gray-300 hover:bg-gray-800 hover:text-white"
                  }`}
                  onClick={() => handleTabChange(tab.id)}
                >
                  {tab.label}
                  {getTabCount(tab.id) > 0 ? ` (${getTabCount(tab.id)})` : ""}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* Search Results Content */}
      <div class="flex-1 overflow-y-auto p-6">
        <Show when={store.search.loading}>
          <div class="text-center py-8">
            <div class="animate-spin h-8 w-8 border-2 border-magenta-500 border-t-transparent mx-auto mb-4"></div>
            <div class="text-magenta-400">searching...</div>
          </div>
        </Show>

        <Show when={!store.search.loading && store.search.isActive}>
          {/* All Tab - Show everything */}
          <Show when={store.search.activeTab === "all"}>
            <div class="space-y-8">
              {/* Genres Section */}
              <Show when={store.search.results.genres.length > 0}>
                <GenreResultsSection
                  genres={store.search.results.genres}
                  onGenreClick={handleGenreClick}
                  showAll={false}
                />
              </Show>

              {/* Playlists Section */}
              <Show when={store.search.results.playlists.length > 0}>
                <PlaylistResultsSection
                  playlists={store.search.results.playlists}
                  onPlaylistClick={handlePlaylistClick}
                  showAll={false}
                />
              </Show>

              {/* Existing sections - Songs, Artists, Albums */}
              {/* TODO: keep existing song/artist/album rendering logic */}
            </div>
          </Show>

          {/* Individual Tab Views */}
          <Show when={store.search.activeTab === "genres"}>
            <GenreResultsSection
              genres={store.search.results.genres}
              onGenreClick={handleGenreClick}
              showAll={true}
            />
          </Show>

          <Show when={store.search.activeTab === "playlists"}>
            <PlaylistResultsSection
              playlists={store.search.results.playlists}
              onPlaylistClick={handlePlaylistClick}
              showAll={true}
            />
          </Show>

          {/* TODO: Keep existing song/artist/album tab implementations */}
        </Show>
      </div>
    </div>
  );
}
```

## Performance Optimizations

### Database Performance

- **Indexes**: Add GIN indexes on genre and sub_genres fields for FTS
- **Query Optimization**: Limit genre/playlist results to 10 for "all" view
- **Sub-genre Support**: Include sub_genres array in FTS ranking
- **Existing Optimization**: Leverage existing pagination and sorting

### Frontend Performance

- **Store Integration**: Use existing global store patterns for reactivity
- **Component Reuse**: Reuse existing song/artist/album display logic
- **Lazy Loading**: Load full results only when specific tabs are selected
- **Memory Management**: Clear old results when new searches execute

### Genre Configuration Integration

The plan accounts for existing genre grouping config in `assets/config/config.jsonc`. The database functions can:

- Include both `genre` and `sub_genres` in search ranking
- Allow frontend to apply config-based grouping for display
- Maintain raw genre data for accurate search results

## Migration Strategy

### Phase 1: Backend Foundation

1. Add database functions for genre/playlist aggregation
2. Extend POST `/api/media/search` endpoint with new response fields
3. Test with existing frontend to ensure no breaking changes

### Phase 2: Store Integration

1. Update global store interface with new result types
2. Create enhanced search actions using existing patterns
3. Add Zod schemas for response validation

### Phase 3: UI Components

1. Create genre and playlist result components
2. Update SearchResultsView with new tabs
3. Wire up navigation and filtering

### Phase 4: Testing and Refinement

1. Test complete user flow with real data
2. Optimize database queries based on usage patterns
3. Fine-tune UI responsiveness and result ranking

This plan extends the existing search architecture while maintaining all current functionality and follows established patterns for state management, API design, and component structure.
