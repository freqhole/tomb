# Music Metadata Admin Interface - Architecture Plan

**Project**: Admin interface for music metadata review and management
**Goal**: Build a comprehensive admin interface for editing existing music records with advanced search, filtering, bulk operations, and musicbrainz integration

## Code Style Guidelines (Critical)

1. **File Size Limit**: Maximum ~500 lines per file
2. **NO EMOJIS**: Keep code comments, logs, and ui display text lowercase (proper nouns and acronyms can be uppercase)
3. **Modular Architecture**:
   - Use solidjs hooks for reactive logic
   - Keep components presentational (jsx + tailwind)
   - Central context providers for state
   - Avoid prop drilling - use hooks to access data
   - Lean into composition over large monolithic components

---

## Current Architecture Analysis

### Existing Components to Leverage

- **infinite-data-grid** (`client/js/src/web-components/infinite-data-grid.tsx`): Has virtual scrolling, selection, and action menus but works on media_blobs
- **search components** (`client/js/src/components/search/`): Has searchcontext, searchbox, searchfilters, and searchsuggestions
- **database schema** (`migrations/007_music_tables.sql`): Songs table with comprehensive metadata fields including `tags TEXT[]`

### What Needs Investigation

1. **API endpoints**: Check if `GET /api/music/songs` exists with pagination and filtering
2. **Thumbnail system**: How thumbnails are currently generated and served from thumbnail_blob_id
3. **Search integration**: How to adapt existing search components for music domain
4. **Bulk operation patterns**: Check existing patterns in codebase for batch operations

---

## Phase 1: Music Admin Data Grid Foundation

### Goal

Create new admin interface that displays existing music records (not media_blobs) with infinite scroll, multi-select, and search integration.

### New File Structure

```
client/js/src/views/admin/
├── music/
│   ├── MusicAdminView.tsx           (~300 lines) - main view component
│   ├── hooks/
│   │   ├── useMusicData.ts          (~200 lines) - data loading/pagination
│   │   ├── useMusicSelection.ts     (~150 lines) - multi-select with ctrl/shift
│   │   ├── useMusicSearch.ts        (~200 lines) - search/filter integration
│   │   └── useMusicBulkOps.ts       (~150 lines) - bulk operations
│   ├── components/
│   │   ├── MusicDataGrid.tsx        (~400 lines) - main grid component
│   │   ├── MusicSearchHeader.tsx    (~300 lines) - horizontal search bar
│   │   ├── MusicGridRow.tsx         (~200 lines) - individual row component
│   │   ├── MusicGridHeader.tsx      (~100 lines) - column headers
│   │   ├── BulkActionPanel.tsx      (~250 lines) - bulk operations ui
│   │   └── MusicBrainzModal.tsx     (~400 lines) - musicbrainz integration
│   ├── types/
│   │   └── music-admin.ts           (~200 lines) - typescript interfaces
│   └── utils/
│       ├── music-helpers.ts         (~150 lines) - formatting utilities
│       └── thumbnail-utils.ts       (~100 lines) - artwork handling
```

### Core Types (music-admin.ts)

```typescript
// extend existing song type with admin-specific fields
interface AdminSong extends Song {
  media_blob?: MediaBlob;
  thumbnail_url?: string;
  file_path?: string;
  file_size?: number;
  duration_seconds?: number;
}

// search and filtering
interface MusicSearchFilters {
  query?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year_min?: number;
  year_max?: number;
  rating_min?: number;
  rating_max?: number;
  is_favorite?: boolean;
  has_thumbnail?: boolean;
  tags?: string[];
  // ... more filters
}

// pagination with total count (important for bulk ops)
interface MusicPagination {
  page: number;
  page_size: number;
  total_count: number; // critical for bulk operations
  total_pages: number;
  has_next: boolean;
}

// bulk operations
type BulkOperationType =
  | "update_metadata"
  | "add_tags"
  | "remove_tags"
  | "set_rating"
  | "apply_musicbrainz"
  | "generate_thumbnails";

interface BulkOperation {
  type: BulkOperationType;
  song_ids: string[];
  parameters?: any;
}
```

### Key Implementation Details

#### useMusicData Hook

- **Purpose**: Load music records with pagination and filtering
- **API Integration**: `GET /api/admin/music/songs` with query params
- **Features**:
  - Infinite scroll pagination
  - Total count for bulk operations
  - Filter/sort state management
  - Debounced filter updates
  - Loading states and error handling
- **Return**: songs array, pagination info, loading/error states, actions

#### useMusicSelection Hook

- **Purpose**: Multi-select functionality with keyboard support
- **Features**:
  - Ctrl+click for individual toggle
  - Shift+click for range selection
  - Ctrl+A for select all
  - Track last selected index
  - Selection persistence during pagination
- **Critical**: Must work with total_count for bulk ops on all filtered results

#### MusicDataGrid Component

- **Purpose**: Main grid display similar to infinite-data-grid but for music
- **Features**:
  - Virtual scrolling for performance
  - No left/right panels (unlike infinite-data-grid)
  - Inline cell editing for metadata
  - Column sorting
  - Row selection with visual feedback
  - Click-to-edit functionality
- **Layout**: Full width table with horizontal search header

---

## Phase 2: Search Integration and Header

### Goal

Integrate existing search components into horizontal header bar with expandable advanced filtering.

### MusicSearchHeader Component

```
┌─────────────────────────────────────────────────────────────────┐
│ [🔍] Search music...  [Advanced ▼] [Bulk Actions] [MusicBrainz] │
├─────────────────────────────────────────────────────────────────┤
│ ┌─ Advanced Search (expandable) ──────────────────────────────┐ │
│ │ Artist: [____] Album: [____] Genre: [____] Year: [__]-[__] │ │
│ │ Rating: [__]-[__] ☐ Favorites ☐ Has Artwork Tags: [____] │ │
│ │ [Clear All] [Apply Filters] [Save as Preset]              │ │
│ └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

#### Implementation Strategy

1. **Adapt existing SearchBox**: Modify to work with music domain instead of generic search
2. **Extend SearchFilters**: Add music-specific filter fields (rating, year ranges, tags)
3. **SearchSuggestions integration**: Use existing suggestion system for artist/album autocomplete
4. **SearchContext adaptation**: Create MusicSearchContext that wraps existing search functionality

#### Key Features

- **Quick search**: Main text input for title/artist/album search
- **Advanced toggle**: Expand/collapse advanced filter panel
- **Filter presets**: Common filter combinations (favorites, recent, unrated, etc.)
- **Active filter display**: Show applied filters with clear buttons
- **Real-time suggestions**: Autocomplete for artist/album/genre fields

### API Requirements

```
GET /api/admin/music/songs
- Query params: page, page_size, filters (json), sort
- Response: { songs: [], pagination: { total_count: number }, filters_applied: {} }

GET /api/admin/music/suggestions
- Query params: field, partial, limit
- Response: { suggestions: string[] }
```

---

## Phase 3: Thumbnail and Artwork Management

### Goal

Better thumbnail display and artwork selection system to replace the "wonky" thumbnail display from infinite-data-grid.

### Current Thumbnail Issues to Investigate

1. **How thumbnails are generated**: Check existing thumbnail generation from thumbnail_blob_id
2. **Thumbnail serving**: Understand `/api/blobs/{id}/thumbnail` endpoint
3. **Missing thumbnail handling**: How to display placeholder when no thumbnail exists
4. **Performance**: Lazy loading and caching strategies

### New Thumbnail System Architecture

#### ThumbnailComponent (~100 lines)

```typescript
interface ThumbnailProps {
  song: AdminSong;
  size: "small" | "medium" | "large";
  onClick?: () => void;
  showPlaceholder?: boolean;
}
```

- **Features**:
  - Lazy loading with intersection observer
  - Fallback to placeholder when no thumbnail
  - Error handling for failed loads
  - Click to open artwork modal
  - Hover effects and loading states

#### ArtworkModal Component (~300 lines)

- **Purpose**: Select/manage artwork for songs
- **Features**:
  - Display current thumbnail (if any)
  - Search for online artwork (album + artist)
  - Upload custom artwork
  - Generate thumbnail from audio file metadata
  - Preview multiple candidates
  - Apply to single song or bulk selection

#### Artwork Management Strategy

1. **Existing thumbnails**: Use thumbnail_blob_id when available
2. **Missing thumbnails**:
   - Check for embedded album art in audio file
   - Search online databases (last.fm, musicbrainz artwork)
   - Allow manual upload
   - Generate placeholder based on album/artist initials
3. **Bulk thumbnail generation**: Background job to process multiple songs

### Implementation Files

```
components/
├── ThumbnailComponent.tsx      (~100 lines)
├── ArtworkModal.tsx           (~300 lines)
├── ArtworkSearch.tsx          (~200 lines)
└── ArtworkUpload.tsx          (~150 lines)

utils/
└── thumbnail-utils.ts         (~100 lines)
```

---

## Phase 4: MusicBrainz Integration

### Goal

Flexible musicbrainz integration allowing users to search, preview, and selectively apply metadata to songs.

### MusicBrainz Workflow

1. **Search**: Query musicbrainz with artist + album or track title
2. **Results**: Display multiple candidates with confidence scores
3. **Preview**: Show what metadata would be applied
4. **Select**: Choose which fields to apply from the musicbrainz data
5. **Apply**: Update songs with selected metadata

### MusicBrainzModal Component (~400 lines)

```
┌─ MusicBrainz Integration ────────────────────────────────────────┐
│ Search: [Artist + Album] [🔍 Search]                            │
├──────────────────────────────────────────────────────────────────┤
│ Results:                                                         │
│ ☐ [★★★★☆] Album Name - Artist (1995) [12 tracks] 89% match     │
│ ☐ [★★★☆☆] Similar Album - Artist (1996) [11 tracks] 67% match   │
│ ☐ [★★☆☆☆] Another Album - Different Artist (1995) 45% match     │
├──────────────────────────────────────────────────────────────────┤
│ Preview (for selected result):                                   │
│ ☑ Album: "Album Name" (current: "album name")                   │
│ ☑ Artist: "Artist" (current: "artist")                         │
│ ☑ Year: 1995 (current: empty)                                  │
│ ☐ Genre: "Rock" (current: "rock")                              │
│ ☑ Track Numbers: Auto-assign based on filename order           │
├──────────────────────────────────────────────────────────────────┤
│ [Cancel] [Apply Selected Fields] [Apply All]                    │
└──────────────────────────────────────────────────────────────────┘
```

#### Key Features

- **Multiple search strategies**:
  - By album + artist
  - By individual track title + artist
  - By musicbrainz id (if known)
- **Confidence scoring**: Rate matches based on similarity
- **Selective application**: Choose which metadata fields to update
- **Bulk application**: Apply to multiple selected songs
- **Preview mode**: Show exactly what would change before applying
- **Conflict resolution**: Handle cases where current data differs from musicbrainz

#### Implementation Strategy

1. **Search API**: Use musicbrainz web service API
2. **Caching**: Cache musicbrainz responses to avoid repeated queries
3. **Field mapping**: Map musicbrainz fields to database schema
4. **Validation**: Ensure data quality before applying
5. **Rollback**: Allow undoing musicbrainz applications

### API Design

```
POST /api/admin/musicbrainz/search
- Body: { query: string, type: 'album'|'track', songs: string[] }
- Response: { results: MusicBrainzResult[] }

POST /api/admin/musicbrainz/apply
- Body: { song_ids: string[], mbid: string, fields: string[], overrides: {} }
- Response: { updated_songs: number, errors: [] }
```

---

## Phase 5: Bulk Operations and Advanced Features

### Goal

Comprehensive bulk operation system for managing large music collections efficiently.

### Bulk Operations Panel

```
┌─ Bulk Actions (234 songs selected) ─────────────────────────────┐
│ Metadata:                                                       │
│ ☐ Set Rating: [★★★☆☆]  ☐ Mark as Favorite  ☐ Set Genre: [___] │
│ ☐ Add Tags: [rock, 2024] ☐ Remove Tags: [old-tag]             │
│                                                                 │
│ Content:                                                        │
│ ☐ Generate Thumbnails  ☐ Generate Waveforms  ☐ Refresh Metadata│
│                                                                 │
│ MusicBrainz:                                                   │
│ ☐ Auto-match with MusicBrainz  ☐ Apply Release: [MBID______]   │
│                                                                 │
│ [Preview Changes] [Execute] [Cancel]                           │
└─────────────────────────────────────────────────────────────────┘
```

#### Bulk Operation Types

1. **Metadata Updates**:
   - Set rating (1-5 stars)
   - Toggle favorite status
   - Add/remove tags
   - Update genre, year, etc.
   - Clear specific fields

2. **Content Operations**:
   - Generate missing thumbnails
   - Generate waveform visualizations
   - Re-extract metadata from files
   - Validate file integrity

3. **MusicBrainz Operations**:
   - Auto-match albums with musicbrainz
   - Apply specific musicbrainz release to album
   - Refresh existing musicbrainz data

4. **Organization**:
   - Move to playlists
   - Export metadata
   - Generate reports

#### Critical Implementation Details

##### Bulk Operation Context

- **Selection scope**: Operate on selected songs OR all filtered results
- **Progress tracking**: Show progress for long-running operations
- **Error handling**: Graceful handling of partial failures
- **Undo capability**: Allow reverting bulk changes
- **Preview mode**: Show what would change before executing

##### Performance Considerations

- **Chunked processing**: Process large selections in batches
- **Background jobs**: Queue heavy operations (thumbnail generation)
- **Progress updates**: Real-time progress via polling or websockets
- **Memory management**: Avoid loading all selected songs into memory

##### API Design

```
POST /api/admin/music/bulk-operation
- Body: {
    operation_type: string,
    song_ids?: string[],
    filters?: MusicSearchFilters, // for "all filtered results"
    parameters: any,
    preview_only?: boolean
  }
- Response: {
    operation_id: string,
    total_songs: number,
    preview?: ChangePreview[]
  }

GET /api/admin/music/bulk-operation/{id}/status
- Response: {
    status: 'pending'|'running'|'completed'|'failed',
    progress: number,
    errors: [],
    completed_at?: string
  }
```

### Click-to-Edit Implementation

#### Inline Editing System

- **Trigger**: Click on editable cell
- **Fields**: title, artist, album, year, rating, tags
- **Validation**: Real-time validation with error display
- **Save**: Auto-save on blur or enter key
- **Cancel**: Escape key to cancel changes

#### EditableCell Component (~100 lines)

```typescript
interface EditableCellProps {
  value: any;
  field: keyof Song;
  songId: string;
  type: "text" | "number" | "rating" | "tags";
  onSave: (songId: string, field: string, value: any) => Promise<void>;
}
```

---

## Technical Requirements Summary

### Backend API Endpoints Needed

```
GET /api/admin/music/songs              # list with pagination/filtering
PATCH /api/admin/music/songs/{id}       # update single song
POST /api/admin/music/bulk-operation    # bulk operations
GET /api/admin/music/suggestions        # search suggestions
POST /api/admin/musicbrainz/search      # musicbrainz search
POST /api/admin/musicbrainz/apply       # apply musicbrainz data
GET /api/admin/artwork/search           # artwork search
POST /api/admin/artwork/upload          # upload artwork
```

### Database Considerations

- **No schema changes**: Work with existing songs table
- **Indexing**: Ensure proper indexes for filtering (artist, album, year, genre, tags gin index)
- **Performance**: Pagination queries must be efficient even with complex filters

### Frontend Architecture

```
views/admin/music/
├── MusicAdminView.tsx              # main container
├── hooks/
│   ├── useMusicData.ts            # data loading
│   ├── useMusicSelection.ts       # selection management
│   ├── useMusicSearch.ts          # search/filtering
│   └── useMusicBulkOps.ts         # bulk operations
├── components/
│   ├── MusicDataGrid.tsx          # main grid
│   ├── MusicSearchHeader.tsx      # search interface
│   ├── MusicGridRow.tsx           # table rows
│   ├── BulkActionPanel.tsx        # bulk operations
│   ├── MusicBrainzModal.tsx       # musicbrainz integration
│   ├── ArtworkModal.tsx           # artwork management
│   └── EditableCell.tsx           # inline editing
├── types/music-admin.ts           # typescript interfaces
└── utils/
    ├── music-helpers.ts           # formatting utilities
    └── thumbnail-utils.ts         # artwork handling
```

### Integration Points

1. **Existing search components**: Adapt searchbox, searchfilters, searchsuggestions for music domain
2. **Infinite scroll pattern**: Leverage virtual scrolling from infinite-data-grid
3. **Multi-select pattern**: Use existing selection logic but extend for keyboard shortcuts
4. **API client**: Extend existing api client with music admin endpoints
5. **Thumbnail system**: Integrate with existing blob/thumbnail infrastructure

### Development Priority

1. **Phase 1**: Basic grid display with existing music data
2. **Phase 2**: Search header and filtering integration
3. **Phase 3**: Improved thumbnail display and artwork management
4. **Phase 4**: MusicBrainz integration with flexible application
5. **Phase 5**: Bulk operations and advanced editing features

This plan focuses on building a comprehensive music metadata management interface that leverages existing infrastructure while providing powerful new capabilities for music collection curation.
