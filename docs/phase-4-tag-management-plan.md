# Phase 4: Tag Management Plan

## 🚨 CRITICAL RULES - NEVER FORGET 🚨

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

## Overview

This document outlines the implementation plan for Phase 4 tag management features in the Freqhole music app. Based on investigation of the existing codebase, we have discovered that most infrastructure already exists, but some key pieces need to be implemented.

**Implementation Priority:** Tag Management → Tag Filtering → Extensions

## Current Infrastructure Analysis

### ✅ What Already Exists

**Database Schema:**

- `songs` table has `tags TEXT[] DEFAULT '{}'` column
- GIN index on tags: `CREATE INDEX idx_songs_tags ON songs USING GIN(tags)`
- Full-text search includes tags in search vector

**Backend API:**

- `/api/music/search` endpoint supports `tags`, `tags_any`, `tags_exclude` parameters
- `/api/music/filter-options` endpoint exists but returns empty tags (marked as "require special handling due to jsonb array")
- Search functions in SQL already handle tag filtering
- `PUT /api/media/songs/{id}` endpoint for single song updates (currently supports `is_favorite`, `rating`)
- `PUT /api/media/songs/preferences/bulk` endpoint for bulk user preference updates (favorites/ratings only)

**Frontend:**

- `FreqholeSearchFilters` interface includes `tags?: string[]`
- `useFreqholeSearch` hook supports tag filtering
- `FilterTags` component exists in `FilterComponents.tsx` with full tag selection/removal UI
- `isMobile()` utility function available

### ❌ What Needs to be Implemented

**Backend Missing:**

- Extension of `PUT /api/media/songs/{id}` to support tags (admin-only)
- New bulk song metadata update endpoint for multiple songs (admin-only)
- Implementation of tags in `/api/music/filter-options` endpoint

**Frontend Missing:**

- Tag management context menu integration
- Tag management modal/UI components
- Admin permission checking for tag modification
- Compact `TagFilterControls` component for song view headers
- Integration into desktop and mobile song view headers

## Implementation Plan

### Phase 1: Tag Management API

**Goal:** Enable server-side tag management with admin restrictions

#### 1.1: Create Bulk Song Metadata Update API

**Investigation Result:** Current bulk API (`PUT /api/media/songs/preferences/bulk`) only handles user preferences (favorites/ratings). We need a new endpoint for song metadata.

**New endpoint:** `PUT /api/media/songs/bulk`

**New request schema:**

```rust
#[derive(Debug, Deserialize)]
pub struct BulkUpdateSongsRequest {
    pub song_ids: Vec<Uuid>,
    pub updates: BulkSongUpdates,
}

#[derive(Debug, Deserialize)]
pub struct BulkSongUpdates {
    pub tags: Option<BulkTagOperation>,
    // Future: pub genre: Option<String>,
    // Future: pub year: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub enum BulkTagOperation {
    Replace(Vec<String>),  // Replace all tags
    Add(Vec<String>),      // Add these tags
    Remove(Vec<String>),   // Remove these tags
}
```

**Route Addition:**

```rust
// In create_routes() function
.route("/songs/bulk", put(bulk_update_songs).layer(axum_middleware::from_fn(require_admin)))
```

**Implementation Features:**

- Admin-only endpoint using existing `require_admin` middleware
- Support for different tag operations (add, remove, replace)
- Return summary of changes made
- Transaction support for consistency
- Single songs handled as 1-item bulk requests

#### 1.2: Update JavaScript API Client

**File to modify:** `client/js/src/lib/music/api-methods.ts`

**New methods to add:**

```typescript
async bulkUpdateSongs(request: BulkUpdateSongsRequest): Promise<BulkUpdateSongsResponse> {
  // Implementation calls PUT /api/media/songs/bulk
}

// Convenience methods for single songs
async updateSongTags(songId: string, tags: string[]): Promise<BulkUpdateSongsResponse> {
  return this.bulkUpdateSongs({
    song_ids: [songId],
    updates: { tags: { type: "Replace", tags } }
  });
}

async addTagsToSongs(songIds: string[], tags: string[]): Promise<BulkUpdateSongsResponse> {
  return this.bulkUpdateSongs({
    song_ids: songIds,
    updates: { tags: { type: "Add", tags } }
  });
}

async removeTagsFromSongs(songIds: string[], tags: string[]): Promise<BulkUpdateSongsResponse> {
  return this.bulkUpdateSongs({
    song_ids: songIds,
    updates: { tags: { type: "Remove", tags } }
  });
}

async replaceTagsForSongs(songIds: string[], tags: string[]): Promise<BulkUpdateSongsResponse> {
  return this.bulkUpdateSongs({
    song_ids: songIds,
    updates: { tags: { type: "Replace", tags } }
  });
}
```

#### 1.3: Add Zod Schemas

**File to create:** `client/js/src/lib/music/schemas/song-updates.ts`

```typescript
import { z } from "zod";

export const BulkTagOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Replace"), tags: z.array(z.string()) }),
  z.object({ type: z.literal("Add"), tags: z.array(z.string()) }),
  z.object({ type: z.literal("Remove"), tags: z.array(z.string()) }),
]);

export const BulkSongUpdatesSchema = z.object({
  tags: BulkTagOperationSchema.optional(),
});

export const BulkUpdateSongsRequestSchema = z.object({
  song_ids: z.array(z.string().uuid()),
  updates: BulkSongUpdatesSchema,
});

export type BulkTagOperation = z.infer<typeof BulkTagOperationSchema>;
export type BulkSongUpdates = z.infer<typeof BulkSongUpdatesSchema>;
export type BulkUpdateSongsRequest = z.infer<
  typeof BulkUpdateSongsRequestSchema
>;
```

### Phase 2: Tag Management UI

**Goal:** Add tag management through context menus and modals

#### 2.1: Add Admin Permission Utility

**Investigation Result:** Auth system already exists with role support!

**Existing auth hook:** `client/js/src/hooks/auth/index.ts`

- Already includes `role` field in auth state
- Used in `UserMenu.tsx` with `auth.role === "admin"` pattern

**File to create:** `client/js/src/lib/auth-utils.ts`

```typescript
import { useAuth } from "../hooks/auth";

export function useIsAdmin(): boolean {
  const auth = useAuth();
  return auth.role === "admin";
}

export function requireAdmin<T>(adminValue: T, fallback: T): T {
  const isAdmin = useIsAdmin();
  return isAdmin ? adminValue : fallback;
}
```

**Pattern already in use:** `UserMenu.tsx` shows this exact pattern works

#### 2.2: Extend Context Menu Actions

**File to modify:** `client/js/src/views/freqhole/services/songInteractions.ts`

**New actions to add:**

```typescript
// In createContextMenuActions function
const tagActions: MenuAction[] = [
  {
    label: "view tags",
    icon: "tag",
    action: () => {
      events.emit("modal:open", {
        modal: "tagInfoModal",
        data: { song, readOnly: true },
      });
    },
  },
];

// Admin-only actions
if (useIsAdmin()) {
  tagActions.push({
    label: "manage tags...",
    icon: "tag-edit",
    action: () => {
      events.emit("modal:open", {
        modal: "tagManagementModal",
        data: { songs: [song] },
      });
    },
  });
}

// Add to main actions array with separator
actions.push({ type: "separator" } as SeparatorAction);
actions.push(...tagActions);
```

**Bulk context menu extension:**

```typescript
// In createBulkContextMenuActions function
if (useIsAdmin()) {
  actions.push({ type: "separator" });
  actions.push({
    label: `manage tags for ${songCount} songs`,
    icon: "tag-edit",
    action: () => {
      events.emit("modal:open", {
        modal: "tagManagementModal",
        data: { songs },
      });
    },
  });
}
```

#### 2.3: Create Tag Management Components

**File to create:** `client/js/src/components/tags/TagManagementModal.tsx`

**Features:**

- View current tags for single or multiple songs
- Add/remove tags with autocomplete from existing tags
- Create new tags inline
- Show tag usage statistics
- Bulk operations for multiple songs
- Admin-only functionality (read-only for non-admins)

**File to create:** `client/js/src/components/tags/TagSelector.tsx`

**Features:**

- Input field with autocomplete dropdown
- Tag chips showing current selection
- Add/remove individual tags
- Support for bulk operations
- Integration with existing `FilterTags` component styling

**File to create:** `client/js/src/components/tags/TagInfoModal.tsx`

**Features:**

- Read-only display of song tags
- Available to all users
- Clean, simple list view

#### 2.4: Modal Event Handling

**Investigation needed:** How are modals handled in the current app? Need to integrate with existing modal system.

**Files to check:**

- Modal context/provider
- Event system integration
- Existing modal examples

### Phase 3: Tag Filtering UI

**Goal:** Add global tag filter UI to songs list views

#### 3.1: Implement Tags in filter-options Endpoint

**File to modify:** `server/src/media/search.rs`

**Current status:** Returns empty tags with TODO comment

**Implementation needed:**

```sql
-- Query to get tag frequency
SELECT
  unnest(tags) as tag,
  COUNT(*) as song_count
FROM songs
WHERE tags != '{}' AND deleted_at IS NULL
GROUP BY tag
ORDER BY song_count DESC, tag ASC
LIMIT $1 OFFSET $2
```

**Function modification:** Replace empty tags array in `get_filter_options` function

#### 3.2: Create TagFilterControls Component

**File to create:** `client/js/src/components/tags/TagFilterControls.tsx`

```typescript
interface TagFilterControlsProps {
  selectedTags?: string[];
  availableTags?: FilterOption[];
  onTagsChange: (tags: string[] | undefined) => void;
  compact?: boolean;
  class?: string;
}

// Wraps FilterTags with compact styling for header placement
```

**Features:**

- Compact design similar to `SearchSortControls`
- Mobile-responsive (collapsed/expanded states)
- Integrates with existing `FilterTags` component
- Dark theme styling consistent with app

#### 3.3: Integrate into Song Views

**Files to modify:**

- `client/js/src/views/freqhole/components/content/views/songs/DesktopSongsView.tsx`
- `client/js/src/views/freqhole/components/content/views/songs/MobileSongsView.tsx`

**Integration points:**

- Desktop: Add to header section alongside song count
- Mobile: Add to header section alongside `SearchSortControls`

**Layout examples:**

```
Desktop Header:
[songs (1,234)] ............... [tag filter ui] [sort controls]

Mobile Header:
[songs (1,234)]
[tag filter ui] [sort controls]
```

### Phase 4: Artists & Albums Tag Filtering (Optional Extension)

**Goal:** Extend tag filtering to artists and albums views

#### 4.1: Backend Implementation

**Files to modify:**

- `server/src/media/songs.rs` - `list_artists` and `get_album_summaries` functions

**Implementation:** Add tag filtering to artist and album queries that aggregate from songs table

#### 4.2: Frontend Integration

**Files to modify:**

- Artist and album view components (following same pattern as songs)

## Technical Details

### Database Schema

**Songs table (already exists):**

```sql
CREATE TABLE songs (
    -- ... other fields
    tags TEXT[] DEFAULT '{}',
    -- ... other fields
);

-- Index (already exists)
CREATE INDEX idx_songs_tags ON songs USING GIN(tags) WHERE deleted_at IS NULL;
```

**No schema changes required** - everything needed already exists!

### API Endpoints Summary

**Existing endpoints:**

- `GET /api/music/search` - supports tag filtering ✅
- `GET /api/music/filter-options` - needs tags implementation ❌
- `PUT /api/media/songs/{id}` - needs tags support ❌
- `PUT /api/media/songs/preferences/bulk` - user preferences only ✅

**New endpoints needed:**

- `PUT /api/media/songs/bulk` - bulk song metadata updates (admin-only)

### Permission Model

**Tag Viewing:** All authenticated users
**Tag Modification:** Admin users only (`UserRole::Admin`)

**Implementation pattern:**

```rust
// Check admin permission before tag modifications
if request.tags.is_some() && !user.is_admin() {
    return Err(StatusCode::FORBIDDEN);
}
```

### Component Architecture

```
TagFilterControls (new)
├── FilterTags (existing, reused)
│   ├── Tag chips with remove buttons
│   └── Dropdown with available tags
└── Compact wrapper with mobile responsiveness

TagManagementModal (new)
├── TagSelector (new)
│   ├── Current tags display
│   └── Add/remove interface
├── Bulk operations UI
└── Admin permission gating

TagInfoModal (new)
├── Read-only tag display
└── Available to all users
```

### Testing Strategy

**Phase 1 Testing:**

- Create admin user via CLI: `./tomb users create-admin`
- Test single song tag update API with admin user
- Test bulk song tag update API
- Verify non-admin users get 403 for tag modifications

**Phase 2 Testing:**

- Test context menu shows appropriate options based on user role
- Test tag management modal functionality
- Test bulk tag operations from UI

**Phase 3 Testing:**

- Add some test tags to database via API
- Verify filter UI appears and functions
- Test tag filtering works through search API

## File Structure

```
client/js/src/components/tags/
├── TagFilterControls.tsx          (new)
├── TagManagementModal.tsx         (new)
├── TagSelector.tsx                (new)
└── TagInfoModal.tsx               (new)

client/js/src/lib/
├── auth-utils.ts                  (new)
└── music/schemas/song-updates.ts  (new)

server/src/media/
├── songs.rs                       (modify - add tag support)
└── search.rs                      (modify - implement tags in filter-options)
```

## Implementation Progress

### ✅ **Phase 1: Tag Management API - COMPLETE**

**What was built:**

- **Server-side (Rust):** Added bulk song metadata update functionality in grimoire package
  - New models: `BulkUpdateSongsRequest`, `BulkTagOperation`, `BulkSongUpdates` in `grimoire/src/music/models.rs`
  - Repository methods: `bulk_update_songs()`, `apply_tag_operation()` in `grimoire/src/music/repository/mod.rs`
  - Service methods: `bulk_update_songs()` in `grimoire/src/music/playlist_service.rs`
  - Server endpoint: `PUT /api/media/songs/bulk` with `require_admin` middleware
  - SQL operations: Replace, Add (with deduplication), Remove tag operations
- **Client-side (TypeScript):** Added admin API methods
  - Zod schemas in `client/js/src/lib/music/schemas/song-updates.ts`
  - Admin API methods in `client/js/src/lib/music/api-admin-methods.ts`
  - ApiClient integration: `bulkUpdateSongs()`, `updateSongTags()`, `addTagsToSongs()`, etc.
- **Auth utilities:** Added to `useAuth()` hook: `isAdmin`, `requireAdmin()`, `adminOnly()`

**Key technical decisions:**

- Used grimoire package for all SQL operations (no inline SQL in server)
- Admin-only protection via middleware and client-side checks
- Bulk API handles 1 or many songs with 1 or many tags
- Three tag operations: Replace (set all), Add (append with dedup), Remove (subtract)

### 🚧 **Phase 2: Tag Management UI - IN PROGRESS**

**What was built:**

- **Context menu integration:** Added "tags" option to song context menus (admin-only)
- **Event system:** Added `tag-selector:open/close` events to global events
- **TagSelectorMenu component:** Created menu following playlist selector pattern
  - Read current tags from selected songs
  - Add new tags (with API integration)
  - Remove existing tags (with API integration)
  - Fetch available tags for autocomplete
  - Emit data reload events after changes
- **ContextMenuManager updates:** Added tag selector support alongside playlist selector

**Current issue - NEEDS DEBUGGING:**
The tag selector menu is not visible when clicking "tags" in context menu, despite:

- Events are being emitted correctly (`tag-selector:open` logs show)
- ContextMenuManager receives events correctly
- TagSelectorMenu is rendering (console logs show)
- Menu might be rendering off-screen or with wrong z-index
- Tag icon is not showing in context menu (need to investigate icon system)

**Console logs when testing:**

```
songInteractions.ts:237 Emitting tag-selector:open for single song: 3b31937d-563f-4320-b1ed-5d4b677c0b82
ContextMenuManager.tsx:62 ContextMenuManager received tag-selector:open: {x: 785, y: 247, songsCount: 1, mode: 'manage'}
TagSelectorMenu.tsx:120 TagSelectorMenu rendering: {mode: 'manage', songCount: 1, currentTags: 0, isReadOnly: false}
```

### 🔄 **Next Steps - Immediate**

1. **Debug tag selector visibility:**
   - Compare with working "add to playlist..." menu behavior
   - Check z-index, positioning, overflow issues
   - Verify ContextMenu component children rendering
   - Fix tag icon not showing in context menu

2. **Remove debug logs** once working

3. **Continue Phase 2:** Test bulk operations, error handling

### 📋 **Success Criteria**

**Phase 1 Complete:** ✅

- [x] Admin users can bulk update tags for single or multiple songs
- [x] Non-admin users get 403 when attempting tag modifications
- [x] JavaScript API client supports all tag operations
- [x] Zod schemas validate tag update requests
- [x] Single song updates work through bulk endpoint
- [x] SQL operations moved to grimoire package

**Phase 2 Complete:** 🚧

- [x] Context menu shows tag options based on user role
- [ ] **Tag selector menu is visible and functional** ⚠️ DEBUGGING
- [ ] Tag icon shows in context menu ⚠️ DEBUGGING
- [x] Admin users can create new tags inline (code ready)
- [x] Bulk tag operations work from UI (code ready)
- [x] Data reload events trigger after tag changes

**Phase 3 Not Started:**

- [ ] Tag filter UI appears in songs list headers (desktop and mobile)
- [ ] Available tags are loaded from `/api/music/filter-options`
- [ ] Tag filtering works through search API
- [ ] UI is responsive and follows design system

**Phase 4 Not Started:**

- [ ] Artists view supports tag filtering
- [ ] Albums view supports tag filtering
- [ ] Tag filters work consistently across all views

## Files Modified/Created

**Server (Rust):**

- `grimoire/src/music/models.rs` - Added bulk update models
- `grimoire/src/music/repository/mod.rs` - Added bulk update methods
- `grimoire/src/music/playlist_service.rs` - Added service method
- `grimoire/src/music/mod.rs` - Added exports
- `server/src/media/songs.rs` - Added route and endpoint

**Client (TypeScript):**

- `client/js/src/lib/music/schemas/song-updates.ts` - New schemas
- `client/js/src/lib/music/api-admin-methods.ts` - New admin API methods
- `client/js/src/lib/api-client.ts` - Added method exports
- `client/js/src/hooks/auth/index.ts` - Added admin utilities
- `client/js/src/views/freqhole/hooks/useGlobalEvents.ts` - Added tag selector events
- `client/js/src/views/freqhole/services/songInteractions.ts` - Added context menu actions
- `client/js/src/views/freqhole/components/ui/ContextMenuManager.tsx` - Added tag selector support
- `client/js/src/components/tags/TagSelectorMenu.tsx` - New component

## Technical Context for Debugging

**Current issue:** Tag selector menu not visible despite proper event flow.

**Investigation approach:**

1. Compare with working `PlaylistSelectorMenu` behavior in same ContextMenuManager
2. Check CSS z-index, positioning, overflow properties
3. Look at how `ContextMenu` component renders children
4. Verify tag icon availability in icon system
5. Test with browser dev tools element inspector

**Debugging aids added (REMOVE AFTER FIXING):**

- Console logs in `songInteractions.ts`, `ContextMenuManager.tsx`, `TagSelectorMenu.tsx`

**Known working patterns to reference:**

- Playlist selector menu implementation
- Context menu positioning and visibility
- Icon usage in other context menu items

## Future Enhancements

- Tag categories/hierarchies
- Tag color coding
- Smart tag suggestions based on audio analysis
- Tag-based smart playlists
- Tag export/import functionality
- Tag usage analytics
- Tag synonyms/aliases
