# Music Metadata Admin Interface - Development Plan

**Project**: Admin interface for music metadata review and management
**Goal**: Build a comprehensive admin interface for editing existing music records with advanced search, filtering, bulk operations, and musicbrainz integration

---

## Document Management & Progress Tracking

### How This Document Works

This document serves as the living development plan across multiple conversation threads. It will be updated as we complete work and make progress through the phases.

### Progress Tracking Rules

- **Status Updates**: Each phase has a status: `not started`, `in progress`, `completed`, `archived`
- **Completion Marking**: When a phase or major section is completed, mark it as `[COMPLETED]` and move detailed implementation notes to `music-metadata-review-system-completed-phases.md`
- **Current Work**: Always update the "Current Status" section to reflect what's being worked on
- **Thread Continuity**: Start each new conversation thread by reading the "Current Status" and "Code Style Guidelines" sections

### Completion Workflow

1. **During Development**: Update phase status to `in progress` and add implementation notes
2. **Phase Completion**: Mark phase as `completed` and create summary in current status
3. **Archive Detailed Work**: Move detailed implementation notes to `docs/cmusic-metadata-review-system-completed-phases.md`
4. **Update Current Status**: Reflect current state of all phases

---

## Current Status (Updated Each Thread)

### Overall Progress

- **Last Updated**: [Initial plan creation]
- **Active Phase**: None (plan just created)
- **Next Phase**: Phase 1 - Music Admin Data Grid Foundation

### Phase Status Summary

- **Phase 1**: `not started` - Music Admin Data Grid Foundation
- **Phase 2**: `not started` - Search Integration and Header
- **Phase 3**: `not started` - Thumbnail and Artwork Management
- **Phase 4**: `not started` - MusicBrainz Integration
- **Phase 5**: `not started` - Bulk Operations and Advanced Features

### Recent Completions

- Initial architecture plan completed
- No implementation work started yet

### Immediate Next Steps

1. Start Phase 1: Create basic admin view structure
2. Implement core zod schemas extending existing music schemas
3. Build useMusicAdminData hook leveraging existing music hooks

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

---

## Architecture Foundation

### Existing Components to Leverage

- **infinite-data-grid** (`client/js/src/web-components/infinite-data-grid.tsx`): Has virtual scrolling, selection, and action menus but works on media_blobs
- **search components** (`client/js/src/components/search/`): Has searchcontext, searchbox, searchfilters, and searchsuggestions
- **music search hooks** (`client/js/src/hooks/search/music/`): Generic music filtering and search functionality
- **music schemas** (`client/js/src/lib/music/schemas/`): Existing zod schemas for song, playlist, artist, album
- **music validation** (`client/js/src/lib/music/validation.ts`): Music-specific validation utilities
- **search lib** (`client/js/src/lib/search/`): Generic search types and validation patterns
- **api client** (`client/js/src/lib/api-client.ts`): Uses zod for request/response validation
- **database schema** (`migrations/007_music_tables.sql`): Songs table with comprehensive metadata fields including `tags TEXT[]`

### Web Component Architecture

**Target Component**: `freqhole-music-admin`

- **File**: `client/js/src/web-components/freqhole-music-admin.tsx`
- **Element Name**: `freqhole-music-admin`
- **Build Integration**: Auto-discovered by `client/js/build-components.js`
- **Demo URL**: `dist/freqhole-music-admin.html`

**Component Properties**:

```typescript
"freqhole-music-admin": {
  "api-base-url"?: string;        // default: "http://localhost:8080"
  "auto-connect"?: boolean;       // default: true
  "theme"?: "light" | "dark";     // default: "dark"
  "page-size"?: number;           // default: 50
  "enable-musicbrainz"?: boolean; // default: false
  "debug"?: boolean;              // default: false
}
```

**Custom Events**:

- `music-songs-loaded`: When song data loads
- `music-selection-changed`: When selection changes
- `music-bulk-operation`: When bulk operation executed
- `music-error`: When errors occur

---

## Phase 1: Music Admin Data Grid Foundation

### Investigation Checklist (Complete First)

- [ ] **API Analysis**: Test existing `GET /api/music/songs` endpoint capabilities and `SongQueryParams` filtering
- [ ] **Response Validation**: Verify `SongListResponse` schema matches `client/js/src/lib/music/schemas/song.ts`
- [ ] **Pagination**: Confirm `total`, `has_next`, `has_prev` fields work correctly with large datasets
- [ ] **Thumbnail System**: Test `/api/blobs/{id}/thumbnail` endpoint and `thumbnail_blob_ids` array handling
- [ ] **Existing Filters**: Review `client/js/src/lib/search/music/filter-client.ts` reusability for admin interface
- [ ] **Music Hooks**: Examine `client/js/src/hooks/search/music/useMusicFilters.ts` for extension patterns
- [ ] **Selection Patterns**: Study infinite-data-grid multi-select implementation for reusable patterns
- [ ] **Column Management**: Analyze infinite-data-grid column visibility and sizing architecture
- [ ] **Event Handling**: Review infinite-data-grid keyboard/mouse event patterns for adaptation
- [ ] **Default Sorting**: Understand server-side default `ORDER BY album, track_number, title` behavior
- [ ] **Schema Drift**: Validate client-side music schemas against current server responses

### Goal

Create new admin interface that displays existing music records (not media_blobs) with infinite scroll, multi-select, and search integration.

### New File Structure

```
# Web Component Entry Point
client/js/src/web-components/
└── freqhole-music-admin.tsx        (~200 lines) - web component wrapper

# Generic Admin Framework
client/js/src/views/admin/
├── AdminView.tsx                    (~200 lines) - main generic admin view component
├── hooks/
│   ├── useAdminData.ts              (~200 lines) - generic data loading/pagination
│   ├── useAdminBulkOps.ts           (~150 lines) - generic bulk operations
│   ├── useAdminPlugins.ts           (~150 lines) - generic plugin integration
│   └── useAdminInlineEdit.ts        (~150 lines) - generic inline editing
├── components/
│   ├── AdminDataGrid.tsx            (~300 lines) - generic grid component
│   ├── AdminGridRow.tsx             (~150 lines) - generic row component
│   ├── AdminGridHeader.tsx          (~100 lines) - generic column headers
│   ├── AdminSearchHeader.tsx        (~200 lines) - generic search interface
│   ├── BulkActionPanel.tsx          (~200 lines) - generic bulk operations ui
│   ├── EditableCell.tsx             (~100 lines) - generic inline editing
│   └── MediaModal.tsx               (~200 lines) - generic media management
├── schemas/
│   └── admin-api.ts                 (~150 lines) - generic admin api schemas
└── utils/
    └── admin-helpers.ts             (~100 lines) - generic admin utilities

client/js/src/lib/admin/
├── types.ts                         (~150 lines) - generic admin interface types
├── selection.ts                     (~150 lines) - generic multi-select logic
├── plugins/
│   ├── plugin-interface.ts          (~100 lines) - generic plugin interface
│   └── plugin-manager.ts            (~150 lines) - plugin lifecycle management
└── schemas.ts                       (~100 lines) - shared admin api schemas

# Music Domain Configuration
client/js/src/lib/music/admin/
├── music-admin-config.ts            (~200 lines) - music grid and field configuration
├── music-bulk-operations.ts         (~200 lines) - music-specific bulk ops
├── music-validation.ts              (~150 lines) - music field validation and rules
├── music-formatters.ts              (~100 lines) - music display formatting
└── music-media-config.ts            (~150 lines) - music media/artwork configuration

client/js/src/hooks/music/admin/
├── useMusicAdminData.ts             (~150 lines) - bridge to generic admin data hooks
├── useMusicSearch.ts                (~150 lines) - music search configuration
└── useMusicBrainzPlugin.ts          (~200 lines) - musicbrainz plugin (phase 4)

# Generic Admin Library (Phase 1 Foundation)
client/js/src/lib/admin/
├── types.ts                         (~100 lines) - generic admin interface types
├── selection.ts                     (~150 lines) - generic multi-select logic
└── schemas.ts                       (~100 lines) - shared admin api schemas

# Phase 4 Only - MusicBrainz Plugin
client/js/src/lib/musicbrainz/       (phase 4)
├── client.ts                        (~200 lines) - musicbrainz api client
├── types.ts                         (~150 lines) - musicbrainz type definitions
└── cache.ts                         (~100 lines) - response caching logic
```

### Core Schemas (admin-api.ts)

```typescript
import { z } from "zod";
import { SongSchema } from "../../../lib/music/schemas/song.js";

// extend existing song schema with admin-specific fields
export const AdminSongSchema = SongSchema.extend({
  media_blob: z
    .object({
      id: z.string(),
      name: z.string(),
      mime: z.string(),
      size: z.number(),
      local_path: z.string().nullable(),
    })
    .optional(),
  file_path: z.string().optional(),
  file_size: z.number().optional(),
});

export type AdminSong = z.infer<typeof AdminSongSchema>;

// extend existing filter types for admin context
export const AdminMusicFiltersSchema = z.object({
  query: z.string().optional(),
  artist: z.string().optional(),
  album: z.string().optional(),
  genre: z.string().optional(),
  year_min: z.number().optional(),
  year_max: z.number().optional(),
  rating_min: z.number().min(1).max(5).optional(),
  rating_max: z.number().min(1).max(5).optional(),
  is_favorite: z.boolean().optional(),
  has_thumbnail: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  file_format: z.string().optional(),
  duration_min: z.number().optional(),
  duration_max: z.number().optional(),
  created_after: z.string().datetime().optional(),
  created_before: z.string().datetime().optional(),
});

export type AdminMusicFilters = z.infer<typeof AdminMusicFiltersSchema>;

// pagination with total count (critical for bulk operations)
export const AdminPaginationSchema = z.object({
  page: z.number(),
  page_size: z.number(),
  total_count: z.number(), // critical for bulk operations
  total_pages: z.number(),
  has_next: z.boolean(),
  has_previous: z.boolean(),
});

export type AdminPagination = z.infer<typeof AdminPaginationSchema>;

// music list response
export const MusicListResponseSchema = z.object({
  songs: z.array(AdminSongSchema),
  pagination: AdminPaginationSchema,
  filters_applied: AdminMusicFiltersSchema,
  sort_applied: z.object({
    field: z.string(),
    direction: z.enum(["asc", "desc"]),
  }),
});

export type MusicListResponse = z.infer<typeof MusicListResponseSchema>;

// bulk operations (reuse generic patterns from lib/admin/)
export const BulkOperationTypeSchema = z.enum([
  "update_metadata",
  "add_tags",
  "remove_tags",
  "set_rating",
  "set_favorite",
  "apply_musicbrainz",
  "generate_thumbnails",
  "generate_waveforms",
]);

export const BulkOperationSchema = z.object({
  type: BulkOperationTypeSchema,
  song_ids: z.array(z.string().uuid()).optional(),
  filters: AdminMusicFiltersSchema.optional(), // for "all filtered results"
  parameters: z.record(z.any()).optional(),
  preview_only: z.boolean().optional(),
});

export type BulkOperation = z.infer<typeof BulkOperationSchema>;
```

### Phase 1 Deliverables

#### 1.1 Server-Side API Analysis and Reuse

**Existing API Endpoints (To Leverage)**:

- `GET /api/music/songs` - Returns `SongListResponse` with pagination (`list_songs` handler)
- `GET /api/music/songs/{id}` - Single song retrieval (`get_song` handler)
- `PUT /api/music/songs/{id}` - Song updates with `UpdateSongRequest` (`update_song` handler)
- `GET /api/music/artists/{artist}/songs` - Songs by artist with filtering (`get_artist_songs`)

**Existing Response Types (To Reuse)**:

- `SongResponse`: Complete song data with `duration_seconds`, `display_title`, `thumbnail_blob_ids`
- `SongListResponse`: Includes `total`, `has_next`, `has_prev` for pagination
- `SongQueryParams`: Filtering by `favorites`, `artist`, `album`, `genre`, `year`, `rating_min`, `title_search`

**Critical Missing Features for Admin**:

- Column sorting beyond default `ORDER BY album, track_number, title`
- Advanced filtering (tags array, file format, duration ranges, creation dates)
- Total count for filtered results (not just overall song count)
- Bulk operation endpoints
- Admin-specific field updates (tags, metadata modifications)

**New API Requirements**:

```
GET /api/admin/music/songs
- Extend SongQueryParams with: tags[], file_format, duration_min/max, created_after/before
- Add sortable_fields and sort_direction parameters
- Return total_filtered_count for bulk operations context
- Include media_blob metadata (file_path, file_size) in response

PATCH /api/admin/music/songs/bulk
- Bulk metadata updates, tag operations, rating changes
- Scope: selected song_ids OR filtered query results
- Background job support for large operations
```

#### 1.2 Advanced Data Grid Architecture (`AdminDataGrid.tsx`)

**Column Management System** (Building on infinite-data-grid patterns):

- **Column Visibility**: Show/hide columns with localStorage persistence like infinite-data-grid
- **Column Resizing**: Draggable column borders with min/max width constraints
- **Column Reordering**: Drag columns to reorder with persistence
- **Auto-sizing**: Smart column width calculation based on content
- **Horizontal Scroll**: Fixed table layout with horizontal scrollbar for wide datasets
- **Sortable Indicators**: Visual sort direction indicators, some columns non-sortable (thumbnails, actions)

**Grid State Management** (Enhanced from infinite-data-grid):

```typescript
interface AdminGridState {
  columnVisibility: Record<string, boolean>;
  columnWidths: Record<string, number>;
  columnOrder: string[];
  sortConfig: { field: string; direction: "asc" | "desc" } | null;
  defaultSort: { field: string; direction: "asc" | "desc" }; // server-side default
  selectedItems: Set<string>;
  viewMode: "compact" | "default" | "detailed";
}
```

**Virtual Scrolling Performance** (From infinite-data-grid):

- Fixed row heights for consistent virtual scrolling
- Intersection observer for thumbnail lazy loading
- Efficient re-rendering with SolidJS fine-grained reactivity
- Memory management for large datasets (10,000+ songs)

#### 1.3 Input Event Handling Architecture

**Input Event Handling Architecture**

**Minimal Event Registry System** (Works with natural DOM bubbling/propagation):

```typescript
// Simple event listener registry
interface EventListener {
  element: HTMLElement | Document;
  type: string;
  handler: (event: Event) => void;
  options?: AddEventListenerOptions | boolean;
  enabled: boolean;
}

// Central event registry for easy management
class EventRegistry {
  private listeners: Map<string, EventListener> = new Map();

  register(
    id: string,
    element: HTMLElement | Document,
    type: string,
    handler: (event: Event) => void,
    options?: AddEventListenerOptions | boolean,
  ) {
    // Remove existing listener if present
    this.unregister(id);

    const listener: EventListener = {
      element,
      type,
      handler,
      options,
      enabled: true,
    };

    element.addEventListener(type, handler, options);
    this.listeners.set(id, listener);
  }

  enable(id: string) {
    const listener = this.listeners.get(id);
    if (listener && !listener.enabled) {
      listener.element.addEventListener(
        listener.type,
        listener.handler,
        listener.options,
      );
      listener.enabled = true;
    }
  }

  disable(id: string) {
    const listener = this.listeners.get(id);
    if (listener && listener.enabled) {
      listener.element.removeEventListener(
        listener.type,
        listener.handler,
        listener.options,
      );
      listener.enabled = false;
    }
  }

  unregister(id: string) {
    const listener = this.listeners.get(id);
    if (listener && listener.enabled) {
      listener.element.removeEventListener(
        listener.type,
        listener.handler,
        listener.options,
      );
    }
    this.listeners.delete(id);
  }

  // Disable multiple listeners by pattern
  disableGroup(pattern: RegExp) {
    for (const [id] of this.listeners) {
      if (pattern.test(id)) {
        this.disable(id);
      }
    }
  }

  enableGroup(pattern: RegExp) {
    for (const [id] of this.listeners) {
      if (pattern.test(id)) {
        this.enable(id);
      }
    }
  }

  cleanup() {
    for (const [id] of this.listeners) {
      this.unregister(id);
    }
  }
}

// Global registry for the admin interface
const eventRegistry = new EventRegistry();

// Helper for common keyboard shortcut patterns
const createKeyboardHandler =
  (shortcuts: Record<string, (event: KeyboardEvent) => void>) =>
  (event: KeyboardEvent) => {
    const key = `${event.ctrlKey ? "ctrl+" : ""}${event.shiftKey ? "shift+" : ""}${event.key.toLowerCase()}`;
    const handler = shortcuts[key];
    if (handler) {
      handler(event);
    }
  };
```

**Event Management Patterns**:

```typescript
// Grid-level event registration (always active when component mounted)
eventRegistry.register(
  "grid.shortcuts",
  document,
  "keydown",
  createKeyboardHandler({
    "ctrl+a": (event) => {
      // Only handle if not in text input
      if (
        event.target?.tagName !== "INPUT" &&
        event.target?.tagName !== "TEXTAREA"
      ) {
        selectAllFilteredItems();
        event.preventDefault();
      }
    },
    escape: (event) => {
      clearSelection();
      event.preventDefault();
    },
    delete: (event) => {
      if (
        event.target?.tagName !== "INPUT" &&
        event.target?.tagName !== "TEXTAREA"
      ) {
        deleteSelectedItems();
        event.preventDefault();
      }
    },
    "ctrl+f": (event) => {
      focusSearchBox();
      event.preventDefault();
    },
  }),
);

// Inline editing - register when edit starts, unregister when edit ends
const startInlineEdit = (cellElement: HTMLElement) => {
  // Disable grid shortcuts during editing
  eventRegistry.disable("grid.shortcuts");

  // Register edit-specific handlers
  eventRegistry.register(
    "edit.keyboard",
    cellElement,
    "keydown",
    (event: KeyboardEvent) => {
      switch (event.key) {
        case "Enter":
          saveEdit();
          endInlineEdit();
          event.preventDefault();
          break;
        case "Escape":
          cancelEdit();
          endInlineEdit();
          event.preventDefault();
          break;
        case "Tab":
          saveEdit();
          moveToNextEditableField();
          event.preventDefault();
          break;
      }
    },
  );

  eventRegistry.register("edit.blur", cellElement, "blur", () => {
    saveEdit();
    endInlineEdit();
  });
};

const endInlineEdit = () => {
  // Clean up edit-specific handlers
  eventRegistry.unregister("edit.keyboard");
  eventRegistry.unregister("edit.blur");

  // Re-enable grid shortcuts
  eventRegistry.enable("grid.shortcuts");
};
```

**Selection Event Patterns** (Using natural DOM events):

- **Grid Selection**: Standard event listeners on grid container
  - Click: Select item, clear others unless Ctrl held
  - Ctrl+Click: Toggle individual item selection
  - Shift+Click: Select range from last selected to current
  - Keyboard shortcuts: Registered on document, check target to avoid conflicts

- **Text Input**: Native browser behavior takes precedence
  - Inline edit disables grid shortcuts temporarily
  - Input elements use natural focus/blur/keydown events
  - No fighting between grid and input event handlers

- **Search Input**: Standard input field behavior
  - Focus search disables conflicting grid shortcuts
  - Blur search re-enables grid shortcuts
  - Enter executes search, Escape clears

**Event Registration Examples**:

```typescript
// Component mount - register main handlers
onMount(() => {
  eventRegistry.register(
    "grid.shortcuts",
    document,
    "keydown",
    gridKeyboardHandler,
  );
  eventRegistry.register(
    "grid.selection",
    gridElement,
    "click",
    gridClickHandler,
  );
  eventRegistry.register(
    "grid.context",
    gridElement,
    "contextmenu",
    gridContextHandler,
  );
});

// Component cleanup - remove all handlers
onCleanup(() => {
  eventRegistry.cleanup();
});

// Modal open - disable grid shortcuts
const openModal = () => {
  eventRegistry.disable("grid.shortcuts");
  eventRegistry.register(
    "modal.keyboard",
    document,
    "keydown",
    modalKeyboardHandler,
  );
};

// Modal close - restore grid shortcuts
const closeModal = () => {
  eventRegistry.unregister("modal.keyboard");
  eventRegistry.enable("grid.shortcuts");
};
```

#### 1.4 Web Component Wrapper (`freqhole-music-admin.tsx`)

- **Purpose**: Custom element that wraps the generic admin interface configured for music
- **Integration**: Follows existing web component patterns from infinite-data-grid
- **Properties**: api-base-url, auto-connect, theme, page-size, debug
- **Registration**: Auto-discovered by build system, generates freqhole-music-admin.html
- **Configuration**: Passes music domain configuration to generic AdminView
- **Event Handling**: Registers global keyboard shortcuts and manages event delegation

#### 1.5 Generic Admin Foundation (`AdminView.tsx`, `useAdminData.ts`)

- **Purpose**: Domain-agnostic admin interface that works for any entity type
- **Configuration**: Accepts domain-specific configuration (music, photos, videos, docs)
- **API Integration**: Configurable endpoint patterns with zod validation
- **Critical Feature**: Returns total_count for bulk operations on all filtered results
- **Reusability**: Same components work for music, photos, videos, docs with different configs
- **Event System**: Generic event handling that works across all domain types

#### 1.6 Music Domain Configuration (`lib/music/admin/music-admin-config.ts`)

- **Purpose**: Music-specific configuration for the generic admin interface
- **Column Definitions**:
  ```typescript
  {
    id: { type: 'text', sortable: false, visible: false, width: 80 },
    thumbnail: { type: 'media', sortable: false, visible: true, width: 60, resizable: false },
    title: { type: 'text', sortable: true, visible: true, width: 200, minWidth: 100, maxWidth: 400 },
    artist: { type: 'text', sortable: true, visible: true, width: 150, minWidth: 80, maxWidth: 300 },
    album: { type: 'text', sortable: true, visible: true, width: 150, minWidth: 80, maxWidth: 300 },
    year: { type: 'number', sortable: true, visible: true, width: 60, minWidth: 50, maxWidth: 80 },
    rating: { type: 'rating', sortable: true, visible: true, width: 100, resizable: false },
    tags: { type: 'tags', sortable: false, visible: true, width: 120, minWidth: 80 },
    duration: { type: 'duration', sortable: true, visible: true, width: 80, minWidth: 60 },
    actions: { type: 'actions', sortable: false, visible: true, width: 100, resizable: false }
  }
  ```
- **Field Types**: Define field types for validation and editing (text, number, rating, tags)
- **Display Formatters**: Music-specific formatting for duration, file size, ratings
- **Validation Rules**: Music-specific validation (year ranges, rating bounds, etc.)
- **Default Sort**: `{ field: 'album,track_number,title', direction: 'asc' }` (matches server default)

#### 1.7 Generic Selection System (`lib/admin/selection.ts`)

- **Purpose**: Multi-select functionality with keyboard support (reusable for all domains)
- **Features**: Ctrl+click, Shift+click, Ctrl+A, selection persistence during pagination
- **Generic Design**: Works with any entity type (songs, photos, videos, docs)
- **Domain Agnostic**: No music-specific logic, purely generic selection behavior
- **Event Integration**: Composable with domain-specific event handlers

#### 1.8 Music Integration Hooks (`hooks/music/admin/useMusicAdminData.ts`)

- **Purpose**: Bridge between generic admin components and music domain logic
- **Base**: Leverages existing `client/js/src/hooks/search/music/useMusicFilters.ts`
- **API Adaptation**: Maps existing `/api/music/songs` to generic admin interface
- **Schema Validation**: Uses existing music schemas with admin extensions
- **Domain Logic**: Handles music-specific data transformations and business rules
- **Error Handling**: Music-specific error interpretation and user messaging

### Phase 1 Demo

**Demo Goal**: Professional music admin grid with advanced column management and input handling
**Demo Actions**:

1. **Basic Functionality**:
   - Open `dist/freqhole-music-admin.html` in browser
   - Verify songs load from existing `/api/music/songs` with proper pagination
   - Check dark theme with black/white/magenta color scheme, no borders/rounded corners

2. **Column Management**:
   - Test column resizing by dragging column borders
   - Show/hide columns using column visibility controls
   - Verify horizontal scrolling when columns exceed viewport width
   - Test column auto-sizing and min/max width constraints
   - Check localStorage persistence of column settings

3. **Selection System**:
   - Single click selection (clears others)
   - Ctrl+click individual toggle
   - Shift+click range selection
   - Ctrl+A select all functionality
   - Selection persistence during virtual scrolling

4. **Keyboard Shortcuts**:
   - Ctrl+A: select all
   - Escape: clear selection
   - Arrow keys: navigation
   - Space: toggle (when implemented)

5. **Performance**:
   - Virtual scrolling with 1000+ songs
   - Smooth thumbnail lazy loading
   - No memory leaks during extended scrolling

6. **Sorting**:
   - Click column headers to sort (where enabled)
   - Visual sort indicators (up/down arrows)
   - Reset to default server-side sort option

**Demo Success Criteria**: Professional grid behavior matching infinite-data-grid quality, all input patterns work smoothly, column management feels polished

---

## Phase 2: Search Integration and Header

### Goal

Add comprehensive search and filtering capabilities with horizontal header design.

### Phase 2 Deliverables

#### 2.1 Search Header Component (`MusicSearchHeader.tsx`)

```
┌─────────────────────────────────────────────────────────────────┐
│ [search icon] Search music...  [Advanced ▼] [Bulk Actions]     │
├─────────────────────────────────────────────────────────────────┤
│ ┌─ Advanced Search (expandable) ──────────────────────────────┐ │
│ │ Artist: [____] Album: [____] Genre: [____] Year: [__]-[__] │ │
│ │ Rating: [star selectors] favorites only: [toggle]         │ │
│ │ Tags: [tag input] Has Artwork: [toggle] Format: [select]  │ │
│ │ [Clear All] [Apply Filters] [Save as Preset]              │ │
│ └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 2 Deliverables

#### 2.1 Server-Side Search Extension Analysis

**Existing Search Infrastructure (To Extend)**:

- `/api/media/search/songs` - Existing music search endpoint with basic filtering
- `SongQueryParams` struct - Basic filtering (favorites, artist, album, genre, year, rating_min, title_search)
- Pagination support with `limit`/`offset` and `page`/`page_size` patterns

**Critical API Extensions Needed**:

```rust
// Enhanced SongQueryParams for admin interface
#[derive(Debug, Deserialize, Clone)]
pub struct AdminSongQueryParams {
    // Existing fields (reuse)
    pub favorites: Option<bool>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub rating_min: Option<i32>,
    pub title_search: Option<String>,

    // New admin-specific filters
    pub rating_max: Option<i32>,
    pub tags: Option<Vec<String>>,
    pub has_thumbnail: Option<bool>,
    pub file_format: Option<String>,
    pub duration_min: Option<i64>, // seconds
    pub duration_max: Option<i64>,
    pub created_after: Option<String>, // ISO date
    pub created_before: Option<String>,

    // Enhanced sorting
    pub sort_field: Option<String>,
    pub sort_direction: Option<String>, // asc/desc

    // Pagination
    pub page: Option<i32>,
    pub page_size: Option<i32>,
}
```

**New API Endpoints Required**:

```
GET /api/admin/music/filter-options
- Response: { artists: [], albums: [], genres: [], tags: [], years: [], formats: [] }
- Provides dropdown/autocomplete data for all filter fields

GET /api/admin/music/suggestions/{field}?partial={query}
- Real-time suggestions for autocomplete as user types
- Fields: artist, album, genre, tags
```

#### 2.2 Generic Search Integration (`AdminSearchHeader.tsx`)

**Search Event Integration**:

```typescript
// Search input focus/blur management
const setupSearchEvents = (searchInput: HTMLInputElement) => {
  eventRegistry.register("search.focus", searchInput, "focus", () => {
    // Disable conflicting grid shortcuts while searching
    eventRegistry.disable("grid.shortcuts");
  });

  eventRegistry.register("search.blur", searchInput, "blur", () => {
    // Re-enable grid shortcuts when search loses focus
    eventRegistry.enable("grid.shortcuts");
  });

  eventRegistry.register(
    "search.keyboard",
    searchInput,
    "keydown",
    (event: KeyboardEvent) => {
      switch (event.key) {
        case "Enter":
          executeSearch();
          break;
        case "Escape":
          if (isAdvancedSearchExpanded()) {
            collapseAdvancedSearch();
          } else {
            clearSearch();
            searchInput.blur(); // This will re-enable grid shortcuts
          }
          break;
        // ctrl+a and other text shortcuts work naturally
      }
    },
  );
};

// Advanced search panel management
const openAdvancedSearch = () => {
  eventRegistry.register(
    "advanced-search.keyboard",
    document,
    "keydown",
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        collapseAdvancedSearch();
        event.preventDefault();
      }
    },
  );
};

const closeAdvancedSearch = () => {
  eventRegistry.unregister("advanced-search.keyboard");
};
```

- **Purpose**: Domain-agnostic search interface with keyboard navigation
- **Configuration**: Accepts domain-specific search field definitions from music config
- **Integration**: Connects existing SearchBox/SearchFilters to generic admin grid
- **Features**: Real-time filtering, debounced updates, suggestion integration
- **Input Handling**: Focused keyboard shortcuts for power users

#### 2.3 Music Search Configuration (`hooks/music/admin/useMusicSearch.ts`)

- **Purpose**: Music-specific search logic bridging existing music hooks to admin
- **Base**: Extends `client/js/src/hooks/search/music/useMusicFilters.ts` patterns
- **API Integration**: Maps existing music search APIs to admin interface expectations
- **Filter Definitions**: Music-specific filter configurations:
  ```typescript
  {
    rating: { type: 'range', min: 1, max: 5, component: 'StarRating' },
    tags: { type: 'multi-select', source: '/api/admin/music/filter-options' },
    year: { type: 'range', min: 1900, max: new Date().getFullYear() + 1 },
    genre: { type: 'select', source: '/api/admin/music/filter-options' },
    duration: { type: 'range', format: 'duration' }
  }
  ```
- **Validation**: Music field validation and suggestion logic
- **Schema Sync**: Ensures client filters match server `AdminSongQueryParams`

#### 2.4 Advanced Filter Components (Generic with Music Config)

**Input Event Patterns**:

```typescript
// Generic filter event handling
const filterEventHandlers = {
  click: handleFilterToggle,
  keydown: createKeyboardHandler({
    enter: applyFilter,
    escape: cancelFilter,
    tab: navigateFilters,
  }),
  input: debounce(handleFilterChange, 300),
};
```

- **FilterPresets**: Music presets (favorites, recent, unrated, high-quality, no-artwork)
- **TagInput**: Multi-tag selection with autocomplete from `/api/admin/music/filter-options`
- **RatingSelector**: Star-based rating with click/keyboard interaction
- **DateRangeSelector**: Creation date filtering with calendar picker
- **FormatFilter**: Audio format filtering (mp3, flac, wav, m4a, etc.)
- **DurationFilter**: Time range filtering with human-readable display

#### 2.5 Search State Integration (Generic)

- **URL Persistence**: All filter state in URL parameters for bookmarking/sharing
- **Filter Summary**: Human-readable active filter display ("favorites only, rock genre, 2020-2024")
- **Clear Actions**: Individual filter clear buttons and clear-all functionality
- **Preset Management**: Save/load common filter combinations to localStorage
- **Performance**: Debounced API calls, efficient re-rendering with SolidJS reactivity

### API Performance Considerations

```sql
-- New indexes required for admin filtering performance
CREATE INDEX idx_songs_duration_seconds ON songs(duration_seconds) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_file_format ON songs((metadata->>'format')) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_created_at_range ON songs(created_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_multi_filter ON songs(artist, album, year, genre) WHERE deleted_at IS NULL;

-- Complex filter query optimization
SELECT s.*, mb.name as file_name, mb.size as file_size
FROM songs s
LEFT JOIN media_blobs mb ON s.media_blob_id = mb.id
WHERE ($1::boolean IS NULL OR s.is_favorite = $1)
  AND ($2::text IS NULL OR s.artist ILIKE '%' || $2 || '%')
  AND ($3::text IS NULL OR s.genre = $3)
  AND ($4::int IS NULL OR s.year >= $4)
  AND ($5::int IS NULL OR s.year <= $5)
  AND ($6::text[] IS NULL OR s.tags && $6)
  AND s.deleted_at IS NULL
ORDER BY
  CASE WHEN $7 = 'album' AND $8 = 'asc' THEN s.album END ASC,
  CASE WHEN $7 = 'artist' AND $8 = 'asc' THEN s.artist END ASC,
  CASE WHEN $7 = 'year' AND $8 = 'desc' THEN s.year END DESC,
  -- Default server sort
  s.album, s.track_number, s.title
LIMIT $9 OFFSET $10;
```

### Phase 2 Demo

**Demo Goal**: Full search and filtering functionality working seamlessly
**Demo Actions**:

1. Test basic search: type in search box, verify real-time filtering
2. Expand advanced search: test all filter types (artist, album, genre, year, rating, tags)
3. Use filter presets: favorites only, recent additions, no artwork, high rated
4. Test filter combinations: multiple filters active simultaneously
5. Verify filter persistence: refresh page, filters remain active
6. Test clear actions: individual filter clear and clear-all
7. Check search suggestions: autocomplete for artist/album fields
   **Demo Success Criteria**: All search/filter combinations work smoothly, no performance issues

---

## Phase 3: Enhanced Editing and Thumbnail Management

### Goal

Add inline editing capabilities and dramatically improve thumbnail display and artwork management.

### Phase 3 Deliverables

#### 3.1 Server-Side Update API Analysis

**Existing Update Infrastructure**:

- `PUT /api/music/songs/{id}` - Existing endpoint with `UpdateSongRequest` (is_favorite, rating only)
- Song validation in Rust with bounds checking (rating 1-5, etc.)
- Database triggers for updated_at timestamps

**Required API Extensions**:

```rust
// Enhanced update request for admin interface
#[derive(Debug, Deserialize)]
pub struct AdminUpdateSongRequest {
    // Existing fields
    pub is_favorite: Option<bool>,
    pub rating: Option<i32>,

    // New admin editable fields
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub bpm: Option<i32>,
    pub key_signature: Option<String>,
    pub tags: Option<Vec<String>>,
}

// Bulk update endpoint
#[derive(Debug, Deserialize)]
pub struct BulkUpdateRequest {
    pub song_ids: Option<Vec<Uuid>>,
    pub filters: Option<AdminSongQueryParams>, // for "all filtered results"
    pub updates: AdminUpdateSongRequest,
    pub preview_only: Option<bool>,
}
```

**New Endpoints Required**:

```
PATCH /api/admin/music/songs/{id} - Enhanced single song updates
POST /api/admin/music/songs/bulk-update - Bulk update operations
POST /api/admin/music/songs/validate - Field validation before save
```

#### 3.2 Generic Inline Editing System (`EditableCell.tsx`)

**Inline Edit Event Handling**:

```typescript
// Inline editing with natural event flow
const startInlineEdit = (
  cellElement: HTMLElement,
  songId: string,
  field: string,
) => {
  // Disable grid shortcuts that could interfere
  eventRegistry.disable("grid.shortcuts");

  // Create input element
  const input = createInputElement(field, getCurrentValue(songId, field));
  cellElement.appendChild(input);
  input.focus();

  // Register edit-specific events on the input element
  eventRegistry.register(
    "edit.keyboard",
    input,
    "keydown",
    (event: KeyboardEvent) => {
      switch (event.key) {
        case "Enter":
          saveEdit(songId, field, input.value);
          endInlineEdit(cellElement, input);
          event.preventDefault();
          break;
        case "Escape":
          cancelEdit();
          endInlineEdit(cellElement, input);
          event.preventDefault();
          break;
        case "Tab":
          saveEdit(songId, field, input.value);
          endInlineEdit(cellElement, input);
          moveToNextEditableField(songId, field);
          event.preventDefault();
          break;
        // All other keys (including ctrl+a) work naturally for text input
      }
    },
  );

  eventRegistry.register("edit.blur", input, "blur", () => {
    saveEdit(songId, field, input.value);
    endInlineEdit(cellElement, input);
  });
};

const endInlineEdit = (cellElement: HTMLElement, input: HTMLInputElement) => {
  // Clean up edit-specific handlers
  eventRegistry.unregister("edit.keyboard");
  eventRegistry.unregister("edit.blur");

  // Remove input and restore cell content
  cellElement.removeChild(input);
  restoreCellContent(cellElement);

  // Re-enable grid shortcuts
  eventRegistry.enable("grid.shortcuts");
};

// Cell click handlers
const setupCellEvents = (
  cellElement: HTMLElement,
  songId: string,
  field: string,
) => {
  eventRegistry.register(
    `cell.${songId}.${field}.click`,
    cellElement,
    "click",
    (event: MouseEvent) => {
      if (event.detail === 2) {
        // Double click
        startInlineEdit(cellElement, songId, field);
      }
    },
  );

  eventRegistry.register(
    `cell.${songId}.${field}.context`,
    cellElement,
    "contextmenu",
    (event: MouseEvent) => {
      showCellContextMenu(event.clientX, event.clientY, songId, field);
      event.preventDefault();
    },
  );
};
```

- **Purpose**: Domain-agnostic click-to-edit with advanced keyboard navigation
- **Configuration**: Accepts music field definitions and validation rules
- **Trigger**: Click, double-click, or keyboard activation
- **Validation**: Real-time validation with server-side validation endpoint
- **Save Actions**: Auto-save on blur/enter, manual save, escape to cancel
- **Bulk Edit**: Edit one cell, apply to multiple selected items
- **Field Types**: text, number, rating (stars), tags (chips), boolean (toggle)

#### 3.2 Generic Thumbnail System (`ThumbnailCell.tsx`, `MediaModal.tsx`)

- **Better Display**: Replace "wonky" infinite-data-grid thumbnails with domain-agnostic system
- **Smart Loading**: Intersection observer lazy loading, error fallbacks for any media type
- **Placeholder System**: Configurable placeholder generation (initials, icons, etc.)
- **Click Interaction**: Click thumbnail to open domain-specific media management modal
- **Multiple Sizes**: Configurable sizes for different use cases (grid, modal, preview)
- **Domain Support**: Works for album art, photos, video thumbnails, document previews

#### 3.3 Music-Specific Media Management (`lib/music/admin/music-media-config.ts`)

- **Configuration**: Music-specific media management configuration for generic system
- **Artwork Sources**: Embedded art extraction, online search APIs (last.fm/musicbrainz)
- **Upload Handling**: Music-specific upload validation and processing
- **Bulk Operations**: Album-aware bulk artwork application logic
- **Format Support**: Audio-specific format handling (jpg, png, webp) with optimization
- **Integration**: Configures generic media management for music domain needs

#### 3.4 Music Metadata Editing Configuration (`lib/music/admin/music-validation.ts`)

**Music-Specific Validation Rules**:

```typescript
export const musicValidationRules = {
  title: { required: true, maxLength: 500, pattern: /^.+$/ },
  artist: {
    maxLength: 200,
    suggestions: "/api/admin/music/suggestions/artist",
  },
  album: { maxLength: 200, suggestions: "/api/admin/music/suggestions/album" },
  year: { min: 1000, max: new Date().getFullYear() + 10, type: "number" },
  rating: { min: 1, max: 5, type: "number", required: false },
  bpm: { min: 20, max: 300, type: "number", required: false },
  tags: {
    maxItems: 20,
    maxLength: 50,
    suggestions: "/api/admin/music/suggestions/tags",
  },
  genre: { maxLength: 100, suggestions: "/api/admin/music/suggestions/genre" },
};
```

- **Tag Management**: Autocomplete from existing tags, validation for tag format
- **Rating System**: 1-5 star validation with visual star selector component
- **Favorite Toggle**: Boolean field with immediate visual feedback
- **Validation Rules**: Music domain validation (year: 1000-current+10, BPM: 20-300, etc.)
- **Change Tracking**: Optimistic updates with rollback on server error
- **Batch Validation**: Validate all selected items before bulk save operation

### Advanced Thumbnail and Context Menu System

**Context Menu Event Integration**:

```typescript
// Right-click context menu for different contexts
const contextMenuHandlers = {
  thumbnail: {
    contextmenu: (event: MouseEvent, context: EventContext) => {
      showThumbnailMenu(
        [
          {
            label: "change artwork",
            action: () => openArtworkModal(context.itemId),
          },
          {
            label: "extract embedded art",
            action: () => extractEmbeddedArt(context.itemId),
          },
          {
            label: "search online artwork",
            action: () => searchArtwork(context.itemId),
          },
          {
            label: "remove artwork",
            action: () => removeArtwork(context.itemId),
          },
        ],
        event.clientX,
        event.clientY,
      );
      return true;
    },
  },

  cell: {
    contextmenu: (event: MouseEvent, context: EventContext) => {
      const actions =
        context.isSelected && getSelectedCount() > 1
          ? getBulkEditActions()
          : getSingleEditActions();
      showCellMenu(actions, event.clientX, event.clientY);
      return true;
    },
  },
};
```

**Required API Extensions**:

```
PATCH /api/admin/music/songs/{id} - Enhanced metadata updates
POST /api/admin/music/songs/validate - Real-time field validation
POST /api/admin/artwork/search - Online artwork search (last.fm, musicbrainz)
POST /api/admin/artwork/upload - Custom artwork upload with optimization
POST /api/admin/music/extract-artwork - Extract from audio file metadata
GET /api/admin/artwork/candidates/{song_id} - Get all artwork options for song
```

### Phase 3 Demo

**Demo Goal**: Seamless inline editing and professional artwork management
**Demo Actions**:

1. Click-to-edit testing: edit title, artist, album, year on various songs
2. Inline validation: test invalid years, ratings, observe real-time feedback
3. Bulk inline editing: select multiple songs, edit one field, apply to all
4. Thumbnail improvements: verify better loading, error handling, placeholders
5. Artwork modal: click thumbnail, test artwork search, upload custom art
6. Tag management: add/remove tags with autocomplete functionality
7. Rating system: test star-based rating interaction
8. Change tracking: verify unsaved change indicators work properly
   **Demo Success Criteria**: All editing feels smooth and professional, artwork system works reliably

---

## Phase 4: MusicBrainz Plugin Integration

### Goal

Add optional MusicBrainz integration as a cleanly separable plugin for metadata enrichment.

### Phase 4 Deliverables

#### 4.1 Generic Plugin Architecture (`lib/admin/plugins/`, `useAdminPlugins.ts`)

- **Plugin Framework**: Generic plugin system that works for any domain
- **Feature Flags**: Configurable environment variable toggles for any plugin
- **Plugin Interface**: Standard interface for domain-specific plugins
- **Lifecycle Management**: Generic plugin registration, initialization, cleanup
- **UI Integration**: Generic plugin UI integration points in admin interface

#### 4.2 MusicBrainz Plugin Implementation (`lib/musicbrainz/`)

- **Plugin Compliance**: Implements generic plugin interface for music domain
- **Isolated Design**: All MusicBrainz code in separate modules for clean toggling
- **API Client**: Dedicated MusicBrainz web service client with rate limiting
- **Response Caching**: Cache search results to minimize API calls
- **Zod Validation**: Complete schema validation for all MusicBrainz data

#### 4.3 Search and Match System (`MusicBrainzModal.tsx`)

```
┌─ MusicBrainz Integration ────────────────────────────────────────┐
│ Search: [Artist + Album] [search icon] Search                   │
├──────────────────────────────────────────────────────────────────┤
│ Results: (sorted by confidence)                                  │
│ [confidence bars] Album Name - Artist (1995) [12 tracks] 89%    │
│ [confidence bars] Similar Album - Artist (1996) [11 tracks] 67% │
├──────────────────────────────────────────────────────────────────┤
│ Preview Changes:                                                 │
│ [checkboxes] Album: "Album Name" (current: "album name")        │
│ [checkboxes] Artist: "Artist" (current: "artist")              │
│ [checkboxes] Year: 1995 (current: empty)                       │
│ [Apply Selected] [Apply All] [Cancel]                           │
└──────────────────────────────────────────────────────────────────┘
```

#### 4.4 Smart Metadata Application

- **Multiple Search Strategies**: Album+artist, individual tracks, MBID lookup
- **Confidence Scoring**: Algorithmic scoring based on text similarity and metadata overlap
- **Selective Application**: User chooses exactly which fields to import/overwrite
- **Bulk Processing**: Apply MusicBrainz data to multiple selected songs efficiently
- **Change Preview**: Show exact changes before applying with current vs new comparison
- **Conflict Resolution**: Handle cases where existing data conflicts with MusicBrainz

#### 4.5 Generic Plugin Integration Patterns

- **Conditional UI**: Plugin buttons only shown if plugin enabled via generic system
- **Graceful Degradation**: Admin interface works perfectly without any plugins
- **Error Handling**: Generic plugin error handling with domain-specific error types
- **Performance**: Generic background processing that doesn't block UI interactions
- **Rollback Support**: Generic change tracking for plugin-applied modifications

### Plugin Toggle and Event Integration

```typescript
// Plugin event handling with natural event flow
const setupMusicBrainzEvents = () => {
  if (!MUSICBRAINZ_ENABLED) return;

  // Register MusicBrainz shortcut
  eventRegistry.register(
    "musicbrainz.shortcut",
    document,
    "keydown",
    (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "m") {
        // Only handle if not in text input
        if (
          event.target?.tagName !== "INPUT" &&
          event.target?.tagName !== "TEXTAREA"
        ) {
          openMusicBrainzModal();
          event.preventDefault();
        }
      }
    },
  );
};

const openMusicBrainzModal = () => {
  // Disable grid shortcuts while modal is open
  eventRegistry.disable("grid.shortcuts");
  eventRegistry.disable("musicbrainz.shortcut");

  // Register modal-specific events
  eventRegistry.register(
    "musicbrainz.modal.keyboard",
    document,
    "keydown",
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMusicBrainzModal();
        event.preventDefault();
      }
    },
  );

  // Register modal overlay click to close
  eventRegistry.register(
    "musicbrainz.modal.overlay",
    modalOverlay,
    "click",
    (event: MouseEvent) => {
      if (event.target === modalOverlay) {
        closeMusicBrainzModal();
      }
    },
  );
};

const closeMusicBrainzModal = () => {
  // Clean up modal events
  eventRegistry.unregister("musicbrainz.modal.keyboard");
  eventRegistry.unregister("musicbrainz.modal.overlay");

  // Re-enable grid shortcuts
  eventRegistry.enable("grid.shortcuts");
  eventRegistry.enable("musicbrainz.shortcut");
};

// Feature flag check (simple, not over-engineered)
const MUSICBRAINZ_ENABLED = import.meta.env.VITE_MUSICBRAINZ_ENABLED === "true";

// Plugin initialization
if (MUSICBRAINZ_ENABLED) {
  setupMusicBrainzEvents();
}
```

### API Requirements (Conditional)

```
# Only available if MusicBrainz plugin enabled server-side
POST /api/admin/musicbrainz/search
- Body: { query: string, type: 'album'|'track', song_ids: string[] }
- Response: { results: MusicBrainzResult[] } with confidence scores

POST /api/admin/musicbrainz/apply
- Body: { song_ids: string[], mbid: string, selected_fields: string[] }
- Response: { updated_count: number, errors: any[] }

GET /api/admin/musicbrainz/status
- Response: { enabled: boolean, rate_limit_remaining: number }
```

### Phase 4 Demo

**Demo Goal**: MusicBrainz integration working smoothly when enabled, gracefully hidden when disabled
**Demo Actions**:

1. Plugin disabled: verify no MusicBrainz UI elements appear, app works normally
2. Plugin enabled: verify MusicBrainz button appears in search header
3. Search functionality: test album+artist search, individual track search
4. Results display: verify confidence scoring, multiple results handling
5. Preview system: test selective field application, change preview accuracy
6. Bulk application: apply MusicBrainz data to multiple selected songs
7. Error handling: test API failures, rate limiting, network issues
   **Demo Success Criteria**: Plugin cleanly toggleable, MusicBrainz searches work accurately, selective application functions properly

---

## Phase 5: Advanced Bulk Operations and Polish

### Goal

Complete the admin interface with comprehensive bulk operations, performance optimization, and production polish.

### Phase 5 Deliverables

#### 5.1 Generic Advanced Bulk Operations (`BulkActionPanel.tsx`, `useAdminBulkOps.ts`)

```
┌─ Bulk Actions (234 songs selected, 1,247 in filtered results) ──┐
│ Selection Scope: ○ Selected Songs (234)  ● All Filtered (1,247) │
├──────────────────────────────────────────────────────────────────┤
│ Metadata Operations:                                             │
│ ☐ Set Rating: [★★★☆☆]  ☐ Toggle Favorite  ☐ Set Genre: [___]  │
│ ☐ Add Tags: [rock, 2024] ☐ Remove Tags: [old-tag]             │
│ ☐ Update Artist: [____] ☐ Update Album: [____]                │
│                                                                 │
│ Content Operations:                                             │
│ ☐ Generate Missing Thumbnails  ☐ Generate Waveforms           │
│ ☐ Re-extract Metadata  ☐ Validate File Integrity             │
│                                                                 │
│ Advanced: (if MusicBrainz enabled)                             │
│ ☐ Auto-match with MusicBrainz  ☐ Apply Release: [MBID____]    │
│                                                                 │
│ [Preview Changes] [Execute Operation] [Cancel]                 │
└─────────────────────────────────────────────────────────────────┘
```

#### 5.2 Performance and Scalability (Domain-Agnostic)

- **Virtual Scrolling Optimization**: Handle 10,000+ items smoothly for any domain
- **Lazy Loading**: Load media/metadata on demand for any content type
- **Background Processing**: Queue heavy operations (thumbnail generation, media processing)
- **Progress Tracking**: Real-time progress for long-running bulk operations
- **Memory Management**: Efficient handling of large selections without memory leaks

#### 5.3 Production Polish (Generic)

- **Error Handling**: Comprehensive error boundaries and user-friendly error messages
- **Loading States**: Skeleton loading for all data fetching operations
- **Keyboard Shortcuts**: Configurable power-user keyboard navigation and shortcuts
- **Responsive Design**: Mobile-friendly layout and touch interactions for any domain
- **Accessibility**: Full ARIA support, screen reader compatibility
- **Performance Monitoring**: Track and optimize critical performance metrics

#### 5.4 Advanced Features (Generic)

- **Undo/Redo System**: Generic change tracking and revert system for any domain
- **Change Preview**: Show exactly what will change before bulk operations
- **Operation Queuing**: Queue multiple bulk operations with priority handling
- **Export/Import**: Configurable export/import for any domain data
- **Audit Trail**: Generic change tracking for accountability and debugging

#### 5.5 Critical Bulk Operation Features

**Selection Scope Intelligence**:

- Operate on selected songs OR all filtered results (critical for large collections)
- Clear indication of operation scope with counts
- Preview exactly which songs will be affected

**Chunked Processing**:

- Process large operations in batches to prevent timeouts
- Real-time progress updates with remaining time estimates
- Graceful handling of partial failures with detailed error reporting

**Operation Types** (Domain-Configurable):

1. **Metadata**: rating, favorite, tags, genre, year, artist, album updates
2. **Content**: thumbnail generation, waveform creation, metadata re-extraction
3. **Validation**: file integrity checks, duplicate detection, metadata validation
4. **Organization**: playlist operations, album grouping, folder organization
5. **Plugins**: MusicBrainz matching (if enabled), other domain plugins

**Bulk Operation Event Handling**:

```typescript
// Bulk operation shortcuts using natural event flow
const setupBulkOperationEvents = () => {
  eventRegistry.register(
    "bulk.shortcuts",
    document,
    "keydown",
    (event: KeyboardEvent) => {
      // Only handle if not in text input and have selection
      if (
        event.target?.tagName === "INPUT" ||
        event.target?.tagName === "TEXTAREA"
      ) {
        return; // Let text input handle naturally
      }

      const selectedCount = getSelectedCount();
      if (selectedCount === 0) return;

      switch (true) {
        case event.ctrlKey && event.key === "b":
          openBulkPanel();
          event.preventDefault();
          break;
        case event.key >= "1" && event.key <= "5":
          setBulkRating(parseInt(event.key));
          event.preventDefault();
          break;
        case event.key === "Delete":
          confirmBulkDelete();
          event.preventDefault();
          break;
        case event.ctrlKey && event.key === "t":
          openBulkTagEditor();
          event.preventDefault();
          break;
        case event.key === " ":
          toggleBulkFavorite();
          event.preventDefault();
          break;
      }
    },
  );
};

// Bulk tag editor modal
const openBulkTagEditor = () => {
  // Disable bulk shortcuts while tag editor is open
  eventRegistry.disable("bulk.shortcuts");
  eventRegistry.disable("grid.shortcuts");

  const tagInput = createTagInput();

  eventRegistry.register(
    "bulk-tags.keyboard",
    tagInput,
    "keydown",
    (event: KeyboardEvent) => {
      switch (event.key) {
        case "Enter":
          applyBulkTags(tagInput.value);
          closeBulkTagEditor();
          event.preventDefault();
          break;
        case "Escape":
          closeBulkTagEditor();
          event.preventDefault();
          break;
        // ctrl+a and other text shortcuts work naturally in tag input
      }
    },
  );
};

const closeBulkTagEditor = () => {
  eventRegistry.unregister("bulk-tags.keyboard");
  eventRegistry.enable("bulk.shortcuts");
  eventRegistry.enable("grid.shortcuts");
};
```

### Critical API Requirements

```rust
// Bulk operation with background job support
#[derive(Debug, Deserialize)]
pub struct BulkOperationRequest {
    pub operation_type: BulkOperationType,
    pub scope: BulkOperationScope, // Selected | Filtered
    pub song_ids: Option<Vec<Uuid>>,
    pub filters: Option<AdminSongQueryParams>,
    pub parameters: serde_json::Value,
    pub preview_only: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct BulkOperationResponse {
    pub operation_id: Uuid,
    pub total_songs: i64,
    pub preview: Option<Vec<ChangePreview>>,
    pub estimated_duration_seconds: Option<i64>,
    pub warnings: Vec<String>,
}
```

**Required Endpoints**:

```
POST /api/admin/music/bulk-operation - Create bulk operation (background job)
GET /api/admin/music/bulk-operation/{id}/status - Real-time status polling
POST /api/admin/music/bulk-operation/{id}/cancel - Cancel gracefully
GET /api/admin/music/bulk-operation/{id}/preview - Preview changes before execute
POST /api/admin/music/bulk-operation/{id}/rollback - Undo completed operation
```

**Background Job Integration**:

- Use existing Rust async job queue patterns
- Real-time progress updates via polling (no WebSocket requirement)
- Graceful cancellation with cleanup
- Operation history and rollback capability

---

## Technical Requirements Summary

### Backend API Endpoints Needed

```
# Core admin endpoints (always available)
GET /api/admin/music/songs              # list with pagination/filtering
PATCH /api/admin/music/songs/{id}       # update single song
POST /api/admin/music/bulk-operation    # bulk operations
GET /api/admin/music/suggestions        # search suggestions
GET /api/admin/artwork/search           # artwork search
POST /api/admin/artwork/upload          # upload artwork

# MusicBrainz plugin endpoints (conditional)
POST /api/admin/musicbrainz/search      # musicbrainz search (if enabled)
POST /api/admin/musicbrainz/apply       # apply musicbrainz data (if enabled)
GET /api/admin/musicbrainz/status       # plugin status check

# All endpoints use zod schemas for request/response validation
```

### Database Considerations

- **No schema changes**: Work with existing songs table
- **Indexing**: Ensure proper indexes for filtering (artist, album, year, genre, tags gin index)
- **Performance**: Pagination queries must be efficient even with complex filters

### Frontend Architecture

```
# Admin view structure (music-specific)
views/admin/music/
├── MusicAdminView.tsx              # main container
├── hooks/
│   ├── useMusicAdminData.ts       # data loading (extends existing music hooks)
│   ├── useMusicSelection.ts       # selection management (will move to lib/admin/)
│   ├── useMusicAdminSearch.ts     # admin search integration
│   ├── useMusicBulkOps.ts         # bulk operations
│   └── useMusicBrainzPlugin.ts    # musicbrainz plugin (conditional)
├── components/
│   ├── MusicDataGrid.tsx          # main grid
│   ├── MusicSearchHeader.tsx      # search interface
│   ├── MusicGridRow.tsx           # table rows
│   ├── BulkActionPanel.tsx        # bulk operations
│   ├── ArtworkModal.tsx           # artwork management
│   ├── EditableCell.tsx           # inline editing
│   └── musicbrainz/               # plugin components (conditional)
│       ├── MusicBrainzModal.tsx
│       ├── MusicBrainzResults.tsx
│       └── MusicBrainzPreview.tsx
├── schemas/
│   ├── admin-api.ts               # admin api schemas (extends lib/music/schemas/)
│   └── musicbrainz.ts             # musicbrainz schemas (if enabled)
└── utils/
    ├── admin-helpers.ts           # admin utilities
    └── musicbrainz-helpers.ts     # musicbrainz utilities (if enabled)

# Generic admin utilities (reusable for photos/videos/docs)
lib/admin/
├── types.ts                       # generic admin interface types
├── selection.ts                   # multi-select logic (generic)
├── bulk-operations.ts             # bulk operation patterns
├── schemas.ts                     # shared admin schemas
└── artwork.ts                     # generic artwork utilities

# MusicBrainz plugin (isolated)
lib/musicbrainz/
├── client.ts                      # musicbrainz api client
├── types.ts                       # musicbrainz data types
├── cache.ts                       # response caching
└── schemas.ts                     # zod schemas for musicbrainz
```

### Integration Points

1. **Existing search components**: Reuse searchbox, searchfilters, searchsuggestions from `client/js/src/components/search/`
2. **Existing music hooks**: Extend `client/js/src/hooks/search/music/` for admin functionality
3. **Existing music schemas**: Build on `client/js/src/lib/music/schemas/` with admin extensions
4. **Infinite scroll pattern**: Leverage virtual scrolling patterns from infinite-data-grid
5. **Multi-select pattern**: Create generic selection logic in `lib/admin/` for reuse across domains
6. **API client**: Extend existing zod-validated api client with admin endpoints
7. **Thumbnail system**: Integrate with existing `client/js/src/lib/thumbnail-utils.ts`
8. **Music validation**: Reuse existing `client/js/src/lib/music/validation.ts` patterns
9. **Search lib**: Build on existing `client/js/src/lib/search/` infrastructure

### Phase 5 Demo

**Demo Goal**: Complete professional music admin interface ready for production use
**Demo Actions**:

1. Large dataset testing: load 5,000+ songs, verify smooth virtual scrolling
2. Complex bulk operations: select 500+ songs, test metadata updates with progress tracking
3. Scope testing: test "selected songs" vs "all filtered results" bulk operations
4. Performance validation: verify no memory leaks, smooth interactions under load
5. Error recovery: test partial failure handling in bulk operations
6. Mobile responsiveness: verify touch interactions and responsive layout
7. Keyboard shortcuts: test power-user keyboard navigation
8. Accessibility: verify screen reader compatibility and ARIA support
   **Demo Success Criteria**: Professional-grade interface that handles large music collections efficiently with excellent user experience

---

## Development Priority and Phase Balance

### Phase Workload Balance

- **Phase 1** (Foundation): ~35% of total work - Core infrastructure and data loading
- **Phase 2** (Search): ~20% of total work - Search integration leveraging existing components
- **Phase 3** (Editing): ~25% of total work - Inline editing and artwork management
- **Phase 4** (MusicBrainz): ~10% of total work - Optional plugin integration
- **Phase 5** (Polish): ~10% of total work - Bulk operations and production polish

### Implementation Order

1. **Phase 1**: Foundation with working demos at each step
2. **Phase 2**: Search integration building on Phase 1
3. **Phase 3**: Editing capabilities building on Phases 1-2
4. **Phase 4**: Optional MusicBrainz plugin (can be skipped if not needed)
5. **Phase 5**: Advanced features and production polish

### Demo-Driven Development

Each phase ends with a working demo that can be evaluated and refined before moving to the next phase. This ensures continuous progress validation and allows for adjustments based on real usage feedback.

### Key Architectural Decisions

1. **Zod everywhere**: All api data uses zod schemas for validation (following existing patterns)
2. **Reuse existing**: Leverage `client/js/src/lib/music/`, `client/js/src/hooks/search/music/`, and search components
3. **Generic utilities**: Build reusable admin patterns in `client/js/src/lib/admin/` for future domains
4. **Plugin pattern**: MusicBrainz as isolated, toggleable functionality (simple feature flag, not complex plugin system)
5. **Domain Separation**: Generic admin framework in views/admin/, domain-specific code in lib/{domain}/admin/
6. **Configuration-Driven**: Generic admin components configured by domain-specific configuration objects
7. **No new database**: Work entirely with existing songs table and music infrastructure

---

## Implementation Notes

### Completed Work Log

- None yet - track completed work here during development

### Architecture Decisions Made

- Zod everywhere for API data validation (following existing patterns)
- Reuse existing music hooks and search components
- Generic utilities in `client/js/src/lib/admin/` for future domains
- MusicBrainz as isolated, toggleable functionality
- Music-specific code in admin view, generic utilities in lib
- No database changes - work entirely with existing songs table

### Key Integration Points Identified

1. Existing search components for reuse
2. Existing music hooks for extension
3. Existing music schemas for building upon
4. Infinite scroll patterns from existing grid
5. Multi-select patterns for generic admin use
6. Zod-validated API client patterns
7. Existing thumbnail infrastructure

This plan focuses on building a comprehensive music metadata management interface that maximally leverages existing infrastructure while providing powerful new capabilities for music collection curation.
