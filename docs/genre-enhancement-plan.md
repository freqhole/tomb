# Genre Enhancement Implementation Plan

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
10. **MAXIMUM CODE REUSE**: Reuse existing song edit forms, bulk operations, filtering APIs, and modal systems. Build MusicBrainz as modular extensions to existing functionality.

## Progress Tracker

### Phase 1: Database & Config

- [x] create migration for sub_genres field
- [x] update config.jsonc with predefined genres
- [x] run migration

### Phase 2: Backend API

- [x] update song schema with sub_genres
- [x] create genre models, repository, and service in grimoire
- [ ] implement GET /api/music/genres endpoint
- [ ] implement POST /api/music/genres endpoint
- [ ] add comma-separated input parsing

### Phase 3: Form Components

- [ ] create SubGenresInput component
- [ ] update SongFormField.tsx with genre select and sub_genres input
- [ ] add getGenres() API client method

### Phase 4: Genre Views Core

- [ ] create genre store and state management
- [ ] implement DesktopGenresView component
- [ ] create GenreList and GenreDetailPanel components

### Phase 5: Genre Views Details

- [ ] implement artist row expansion
- [ ] add mobile genre view
- [ ] integrate routing and navigation

## Overview

This document outlines the implementation plan for adding a `sub_genres` array field to the songs table and implementing a new genre-focused layout view similar to the existing artists views.

## Goals

1. **Sub-genres Field**: Add a flexible `sub_genres` array field to songs for user-defined genre tags
2. **Config-based Genres**: Use a curated list from `config.jsonc` for genre selection in forms
3. **Genre Layout View**: Implement a new split-panel view for browsing music by genre with infinite scrolling and expandable artist/album sections

## Important Notes

- **Existing genres**: Songs with existing genre values that don't match predefined config genres will be preserved but won't appear in the new browse UI
- **Null/non-matching genres**: Songs with NULL genres or genres not in the predefined list won't show in genre browse views
- **Sub-genres scope**: Focus on basic implementation and form editing; search integration can be added later
- **Input handling**: Sub-genres input will be case-insensitive, trim whitespace, filter empty values, and genres cannot contain commas

## Database Changes

### Phase 1: Database Schema Updates

#### Migration: Add sub_genres field

- **File**: `tomb/migrations/XXX_add_sub_genres_to_songs.sql`
- **Changes**:

  ```sql
  -- Add sub_genres array field to songs table
  ALTER TABLE songs ADD COLUMN sub_genres TEXT[] DEFAULT '{}';

  -- Add GIN index for sub_genres array searches
  CREATE INDEX idx_songs_sub_genres ON songs USING GIN(sub_genres) WHERE deleted_at IS NULL;

  -- Add comment
  COMMENT ON COLUMN songs.sub_genres IS 'User-defined sub-genre tags (flexible array of strings)';
  ```

## Configuration Updates

### Phase 2: Genre Configuration System

#### Update config.jsonc

- **File**: `tomb/assets/config/config.jsonc`
- **Changes**: Add new `music.genres` section:
  ```jsonc
  "music": {
    "genres": [
      "rock",
      "pop",
      "jazz",
      "classical",
      "electronic",
      "hip-hop",
      "country",
      "folk",
      "blues",
      "reggae",
      "metal",
      "punk",
      "indie",
      "alternative",
      "experimental",
      "ambient",
      "techno",
      "house",
      "trance",
      "drum-and-bass",
      "dubstep",
      "r-n-b",
      "soul",
      "funk",
      "gospel",
      "world",
      "soundtrack",
      "instrumental"
    ]
  }
  ```

#### Configuration Schema Updates

- **Files**: Server-side config validation
- **Changes**: Add validation for the new `music.genres` configuration section

## Backend API Updates

### Phase 3: API Enhancements

#### Update Song Schema and Validation

- **Files**:
  - `tomb/server/src/music/schemas.rs` (or equivalent)
  - Song serialization/deserialization code
- **Changes**:
  - Add `sub_genres: Vec<String>` field to song structures
  - Update validation to handle comma-separated input parsing (case-insensitive, trim whitespace, filter empty values)
  - Genre field validation remains unchanged (existing genres preserved, new selections from config list)

#### New Genre API Endpoints

- **File**: New genre controller/routes
- **Endpoints**:
  ```
  GET /api/music/genres
  POST /api/music/genres
  ```

#### GET /api/music/genres

- **Purpose**: Return all predefined genres from config with statistics (including zero counts for unused genres)
- **Response**:
  ```json
  {
    "genres": [
      {
        "name": "rock",
        "song_count": 150,
        "album_count": 45,
        "artist_count": 23,
        "total_duration": 38400 // seconds
      },
      {
        "name": "jazz",
        "song_count": 0,
        "album_count": 0,
        "artist_count": 0,
        "total_duration": 0
      }
    ],
    "total": 29
  }
  ```

#### POST /api/music/genres

- **Purpose**: Get filtered artists/albums within genres with search, pagination, and sorting
- **Request Body**:
  ```json
  {
    "genre": "rock", // optional - filter to specific genre
    "artist": "The Beatles", // optional - filter to specific artist within genre
    "q": "search term", // optional - query term (integrates with global search)
    "tags": ["favorite"], // optional - tag filters
    "sort_by": "songs", // "genre", "songs", "albums", "rating"
    "sort_direction": "desc", // "asc" or "desc"
    "page": 1,
    "page_size": 50
  }
  ```
- **Response** (when no artist specified):
  ```json
  {
    "artists": [
      {
        "artist": "The Beatles",
        "song_count": 25,
        "album_count": 8,
        "total_duration": 5400,
        "genres": ["rock", "pop"],
        "avg_rating": 4.2,
        "favorite_count": 12
      }
    ],
    "total": 150,
    "page": 1,
    "page_size": 50,
    "total_pages": 3,
    "has_next": true,
    "has_prev": false
  }
  ```
- **Response** (when artist specified):
  ```json
  {
    "albums": [
      {
        "album": "Abbey Road",
        "artist": "The Beatles",
        "year": 1969,
        "track_count": 17,
        "disc_count": 1,
        "total_duration": "47:23",
        "genres": "rock",
        "avg_rating": 4.8,
        "favorite_count": 8,
        "album_thumbnail_id": "abc123"
      }
    ],
    "total": 8,
    "page": 1,
    "page_size": 50,
    "total_pages": 1,
    "has_next": false,
    "has_prev": false
  }
  ```

#### Integration with Existing Systems

- **Search Integration**: The `q` parameter plugs into the existing global search system
- **Sort Integration**: Reuses existing sort infrastructure for consistency
- **Tag Integration**: Uses same tag filtering system as songs/artists/albums
- **Pagination**: Follows same pagination pattern as other collection endpoints

#### Song Update API

- **Changes**: Update song CRUD operations to handle `sub_genres` array
- **Form Processing**: Add utility to parse comma-separated sub_genres input like "rock, pop, heavy metal" → `["rock", "pop", "heavy metal"]`

## Frontend Updates

### Phase 4: Form and Input Handling

#### Sub-genres Input Component

- **File**: `tomb/client/js/src/components/forms/SubGenresInput.tsx`
- **Features**:
  - Text input that accepts comma-separated values
  - Visual tag display of parsed genres
  - Case-insensitive input processing
  - Validation: trim whitespace, filter empty values, no commas in genre names
  - Simple implementation (auto-suggestions can be added later)

#### Update Song Edit Forms

- **File**: `tomb/client/js/src/views/freqhole/components/forms/SongFormField.tsx`
- **Changes**:
  - Add sub_genres input field using `SubGenresInput` component
  - Convert existing genre field to select dropdown using predefined genres from config (shows all predefined genres regardless of usage)
  - Handle form submission with both main genre and sub_genres
  - Support both single song edit and bulk edit modes

#### Genre Select Implementation

- **Technical Details**:

  ```tsx
  // In SongFormField.tsx
  const [genreOptions, setGenreOptions] = createSignal<string[]>([]);

  // Load genres from API/config
  const loadGenres = async () => {
    try {
      const response = await apiClient.getGenreConfig(); // New API endpoint
      setGenreOptions(response.genres || []);
    } catch (error) {
      console.error('failed to load genres:', error);
      // fallback to hardcoded list or show error
    }
  };

  // Genre select component
  <select
    name="genre"
    value={formData.genre || ""}
    onChange={handleGenreChange}
    class="genre-select"
  >
    <option value="">select genre...</option>
    {genreOptions().map(genre => (
      <option value={genre}>{genre}</option>
    ))}
    {/* shows all predefined genres from config, regardless of current usage */}
  </select>

  // Sub-genres input
  <SubGenresInput
    value={formData.sub_genres || []}
    onChange={handleSubGenresChange}
    placeholder="enter sub-genres (comma separated): rock, alternative, indie"
  />
  ```

#### API Usage

- **`GET /api/music/genres`**: Used by both genre browse ui and song edit forms
  - Browse ui can filter out genres with zero counts
  - Song edit forms can show all genres regardless of counts

### Phase 5: Genre Layout Views

#### Genre API Client Methods

- **File**: `tomb/client/js/src/lib/music/api-methods.ts`
- **New Methods**:

  ```typescript
  // Get all predefined genres with statistics (including zero counts)
  async getGenres(): Promise<GenreStatsResponse>

  // Search within genres with full filtering
  async searchGenres(params: GenreSearchParams): Promise<GenreSearchResponse>
  ```

#### TypeScript Interfaces

- **File**: `tomb/client/js/src/lib/music/schemas/genre.ts`
- **New Types**:

  ```typescript
  export interface GenreStat {
    name: string;
    song_count: number;
    album_count: number;
    artist_count: number;
    total_duration: number;
  }

  export interface GenreStatsResponse {
    genres: GenreStat[];
    total: number;
  }

  export interface GenreSearchParams {
    genre?: string;
    artist?: string;
    q?: string;
    tags?: string[];
    sort_by?: "genre" | "songs" | "albums" | "rating";
    sort_direction?: "asc" | "desc";
    page?: number;
    page_size?: number;
  }

  export interface GenreSearchResponse {
    artists?: ArtistSummary[];
    albums?: Album[];
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
    has_next: boolean;
    has_prev: boolean;
  }

  // GenreConfigResponse removed - use GenreStatsResponse for all genre data
  ```

#### Desktop Genre View

- **File**: `tomb/client/js/src/views/freqhole/components/content/views/genres/DesktopGenresView.tsx`
- **Structure**:
  ```
  ┌─────────────────┬───────────────────────────────────┐
  │ Genre List      │ Genre Detail Panel                │
  │                 │                                   │
  │ • ambient       │ ambient                           │
  │ • alt           │ ├─ some artist [▶]                │
  │ • blues         │ ├─ another artist [▶]             │
  │ • industrial    │ └─ expanded artist [▼]            │
  │ • rock          │    ├─ [Album 1] [Album 2]         │
  │ • pop           │    └─ [Album 3] [Album 4]         │
  │ • techno        │                                   │
  │ ...             │                                   │
  └─────────────────┴───────────────────────────────────┘
  ```

#### Mobile Genre View

- **File**: `tomb/client/js/src/views/freqhole/components/content/views/genres/MobileGenresView.tsx`
- **Structure**: Single column with expandable sections

#### Genre Split View

- **File**: `tomb/client/js/src/views/freqhole/components/content/views/GenreSplitView.tsx`
- **Features**: Responsive wrapper that shows desktop/mobile view based on breakpoint

#### Supporting Components

##### Genre List Component

- **File**: `tomb/client/js/src/views/freqhole/components/content/views/genres/GenreList.tsx`
- **Features**:
  - Infinite scroll through all genres
  - No A-Z navigation (as requested)
  - Click to select genre

##### Genre Detail Panel

- **File**: `tomb/client/js/src/views/freqhole/components/content/views/genres/GenreDetailPanel.tsx`
- **Features**:
  - Show selected genre info
  - List of artists with song/album counts
  - Accordion-style artist expansion
  - Album grid when artist expanded

##### Genre Artist Row

- **File**: `tomb/client/js/src/views/freqhole/components/content/views/genres/GenreArtistRow.tsx`
- **Features**:
  - Artist name with toggle button
  - Song count and album count display
  - Expandable to show albums

##### Genre Album Grid

- **File**: `tomb/client/js/src/views/freqhole/components/content/views/genres/GenreAlbumGrid.tsx`
- **Features**:
  - Reuse existing album grid components
  - Album image, title, artist, year, tracks, length
  - Hover to play functionality
  - Context menu support

## Data Flow and State Management

### Phase 6: Store Updates

#### Genre Store

- **File**: `tomb/client/js/src/views/freqhole/store/genres.ts`
- **State**:
  ```typescript
  interface GenreState {
    genres: Genre[];
    selectedGenre: string | null;
    genreArtists: Record<string, ArtistSummary[]>;
    expandedArtists: Set<string>;
    albumsByGenreArtist: Record<string, Album[]>; // key: "genre:artist"
    loading: boolean;
    error: string | null;
  }
  ```

#### Store Actions

- **Actions**:
  - `loadGenres()` - Load genre statistics for left panel
  - `selectGenre(genre: string)` - Select genre and load its artists
  - `searchWithinGenre(params: GenreSearchParams)` - Search/filter within selected genre
  - `toggleArtistExpansion(artist: string)` - Expand/collapse artist albums
  - `updateSearch(query: string)` - Update search term (integrates with global search)
  - `updateSort(field: string, direction: string)` - Update sort parameters
  - `updateTags(tags: string[])` - Update tag filters

#### Integration with Existing Store Systems

- **Global Search**: Genre store subscribes to global search state changes
- **Sort State**: Reuses existing sort store (`useSort()`) for consistency
- **Tag Filters**: Integrates with existing tag filter system
- **Data Sections**: Follows same pattern as `useDataSections()` for songs/artists/albums

## Routing and Navigation

### Phase 7: Route Configuration

#### New Routes

- **File**: `tomb/client/js/src/views/freqhole/routes/index.tsx`
- **Routes**:
  ```tsx
  <Route path="/genres" component={GenreSplitView} />
  <Route path="/genre/:genre" component={GenreSplitView} />
  <Route path="/genre/:genre/artist/:artist" component={ArtistDetailView} />
  ```

#### Navigation Updates

- **Files**: Update main navigation to include genres section

## Implementation Timeline

### Phase 1: Database & Config (Day 1-2)

1. Create migration for `sub_genres` field
2. Update `config.jsonc` with predefined genres
3. Add config validation

### Phase 2: Backend API (Day 3-4)

1. Update song schema with `sub_genres`
2. Implement `GET /api/music/genres` endpoint (all predefined genres with statistics, including zero counts)
3. Implement `POST /api/music/genres` endpoint (search/filter within genres)
4. Add form processing for comma-separated input parsing
5. Update song CRUD operations to handle sub_genres array
6. Integrate with existing search, sort, and pagination infrastructure

### Phase 3: Form Components (Day 5)

1. Create `SubGenresInput` component with comma-separated parsing:
   - Case-insensitive processing
   - Trim whitespace and filter empty values
   - Simple text input with tag display (no auto-suggestions initially)
2. Update `SongFormField.tsx` to include:
   - Genre select dropdown showing all predefined genres from config
   - Sub-genres input field with validation
   - Form submission handling for both fields
   - Support for both single and bulk edit modes
3. Add `getGenres()` API client method (used by both browse ui and forms)
4. Create TypeScript interfaces for genre-related data structures

### Phase 4: Genre Views Core (Day 6-8)

1. Create genre store with integration to existing search/sort/tag systems
2. Implement `DesktopGenresView` component with split-panel layout
3. Create supporting components:
   - `GenreList` - infinite scroll, no A-Z navigation, filters out genres with zero counts
   - `GenreDetailPanel` - shows selected genre with artist list
   - Integration with existing `SearchSortControls` and `TagFilterControls`
4. Add `getGenres()` and `searchGenres()` API client methods
5. Implement TypeScript schemas for genre data structures

### Phase 5: Genre Views Details (Day 9-10)

1. Implement artist row expansion using `searchGenres()` with artist parameter
2. Reuse existing album grid components for expanded artist albums
3. Add mobile genre view with single-column accordion layout
4. Implement infinite scrolling for genre list (left panel)
5. Add pagination for artist list (right panel) with search/sort/filter integration
6. Ensure hover-to-play and context menu functionality works in genre context

### Phase 6: Integration & Testing (Day 11-12)

1. Add routing and navigation
2. Integration testing
3. UI polish and responsive design
4. Performance optimization

## Technical Considerations

### Performance

- Use infinite scrolling for large genre lists
- Lazy load artist albums only when expanded
- Consider virtualization for very large artist lists within genres

### UX Design

- Clear visual hierarchy: genres → artists → albums
- Smooth accordion animations
- Consistent with existing album grid styling
- Responsive breakpoints matching current design

### Data Consistency

- Validate sub_genres input on both client and server
- Handle edge cases for comma parsing (extra spaces, empty values)
- Ensure main genre validation against config

### Error Handling

- Graceful degradation when genre config is unavailable
- Handle API failures for genre-specific data
- Loading states for each expansion level

## Future Enhancements

### Potential Follow-ups

1. **Genre Statistics**: Add genre-based analytics and insights
2. **Smart Playlists**: Create playlists based on genre combinations
3. **Genre Trends**: Track genre popularity over time
4. **Advanced Filtering**: Combine main genre + sub_genres in search
5. **Genre Tagging**: Bulk operations for genre management

### Configuration Flexibility

- Allow admin users to modify predefined genres
- Genre synonyms and aliases
- Genre hierarchies (rock → alternative rock → indie rock)
- Sub-genres search integration with global search
- Auto-suggestions for sub-genres input based on existing data

### Acceptance Criteria

### sub-genres field

- songs table has `sub_genres` TEXT[] field
- form accepts comma-separated input: "rock, pop, heavy metal"
- displays as comma-separated values in ui
- validates input: case-insensitive, trims whitespace, filters empty values
- works in both single song edit and bulk edit modes

### genre configuration

- song edit form shows genre select dropdown with all predefined genres from config
- existing songs with non-predefined genres are preserved but won't appear in browse ui
- api endpoints only return genre stats for genres that exist in songs and are predefined
- config validation ensures genres list is present

### genre layout view

- desktop split-panel view matches artist view pattern
- no a-z navigation for genres
- infinite scrolling genre list (only shows genres with existing songs)
- artist rows show song/album counts
- accordion expansion for artist albums
- album grid matches existing album view design
- responsive mobile view
- hover and context menu functionality

### integration

- routing works correctly
- navigation includes genre section
- performance is acceptable for large datasets
- error handling is robust
