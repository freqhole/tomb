# MusicBrainz Integration Plan - Frontend Implementation

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

## Current Status

**✅ COMPLETED**: CLI implementation with comprehensive scanning, album-first processing, and metadata management. See `musicbrainz-integration-plan-completed.md` for full details.

**🎯 NEXT**: Simplified server API layer and Web UI implementation that extends existing song management functionality.

## Phase 0: Cleanup Rust Warnings 🔄 FIRST

**Priority**: High - clean codebase before frontend work
**Estimated Time**: 1-2 hours

clean up all rust compiler warnings by removing unused code, fixing mutable variables, and removing dead imports. delete code that was experimental but never used rather than keeping it around.

**Tasks**:

- [ ] remove unused variables, imports, and dead code
- [ ] fix unnecessary mutable variable declarations
- [ ] run `cargo check --workspace` and fix all warnings
- [ ] keep only code that's actually used in the cli implementation

## Implementation Overview

### Core Concept

- **Integration via existing song edit modal**: add musicbrainz context menu option alongside "song info"
- **Reuse existing bulk edit forms**: leverage current song editing ui components and workflows
- **Extend existing filtering**: add "reviewed" tag filtering to existing song filter system
- **Fix album sorting**: ensure songs always sort by disc_number then track_number
- **Admin-only feature**: only available when user is admin and server has musicbrainz enabled

## Phase 1: Server API Improvements 🔄 NEXT

### 1.1 Fix Album Sorting in Search API

**Problem**: songs should always be grouped by album and sorted by disc_number then track_number.

**Solution**: modify existing `/api/media/search` post endpoint to include proper album sorting.

```rust
// In server/src/media/search.rs
// Modify the ORDER BY clause to always include album sorting as secondary sort
let order_clause = match sort_by.as_deref() {
    Some("title") => format!("s.title {}, s.album {}, s.disc_number ASC, s.track_number ASC", direction, direction),
    Some("artist") => format!("s.artist {}, s.album {}, s.disc_number ASC, s.track_number ASC", direction, direction),
    Some("album") => format!("s.album {}, s.disc_number ASC, s.track_number ASC", direction),
    Some("year") => format!("s.year {}, s.album {}, s.disc_number ASC, s.track_number ASC", direction, direction),
    _ => "s.album ASC, s.disc_number ASC, s.track_number ASC".to_string(),
};
```

### 1.2 Add Album Tracks POST API

**Problem**: current album fetching in `albumUtils.ts` line 131 fetches 1000 songs and filters in js.

**Solution**: create new post endpoint `/api/media/albums/tracks` that accepts album name and optional artist in request body.

```rust
// In server/src/media/songs.rs - add new endpoint
#[derive(Debug, Deserialize)]
pub struct AlbumTracksRequest {
    pub album: String,
    pub artist: Option<String>,
}

pub async fn get_album_tracks_post(
    Extension(db): Extension<DatabaseConnection>,
    Json(request): Json<AlbumTracksRequest>,
) -> Result<Json<AlbumTracksResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let tracks = service
        .get_album_tracks(&request.album, request.artist.as_deref())
        .await
        .map_err(|e| WebauthnError::UnknownWebauthnError(format!("Failed to get album tracks: {}", e)))?;

    Ok(Json(AlbumTracksResponse {
        tracks,
        album: request.album,
        artist: request.artist,
    }))
}

// Add route in create_routes()
.route("/albums/tracks", post(get_album_tracks_post))
```

### 1.3 Add Song Deletion API

**add admin-only soft delete functionality for songs.**

```rust
// In server/src/media/songs.rs - add delete endpoints
#[derive(Debug, Deserialize)]
pub struct DeleteSongsRequest {
    pub song_ids: Vec<String>,
}

pub async fn delete_songs(
    Extension(user): Extension<AuthenticatedUser>,
    Extension(db): Extension<DatabaseConnection>,
    Json(request): Json<DeleteSongsRequest>,
) -> Result<Json<HashMap<String, serde_json::Value>>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());

    let mut deleted_count = 0;
    for song_id in request.song_ids {
        let uuid = Uuid::parse_str(&song_id)
            .map_err(|_| WebauthnError::UnknownWebauthnError("invalid song id".to_string()))?;

        if repository.delete_song(uuid, Some(user.id)).await? {
            deleted_count += 1;
        }
    }

    Ok(Json(HashMap::from([
        ("deleted_count".to_string(), serde_json::Value::Number(deleted_count.into())),
    ])))
}

// Add admin-only route
.route("/songs/delete", post(delete_songs))
.layer(middleware::from_fn(require_admin))
```

### 1.4 Add "Reviewed" Tag Configuration

**server config**: add optional reviewed tag configuration.

```rust
// In grimoire/src/config.rs
pub struct MusicBrainzConfig {
    pub enabled: bool,
    pub user_agent: String,
    pub rate_limit_ms: u64,
    pub reviewed_tag: Option<String>, // Default: "reviewed"
}

impl Default for MusicBrainzConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            user_agent: "tomb/1.0".to_string(),
            rate_limit_ms: 1000,
            reviewed_tag: Some("reviewed".to_string()),
        }
    }
}
```

### 1.4 Simplified MusicBrainz API Routes

**consolidate to minimal required endpoints**:

```rust
// In server/src/musicbrainz/routes.rs (new file)
pub fn create_musicbrainz_routes() -> Router {
    Router::new()
        // Generic search endpoint for songs, albums, artists
        .route("/api/musicbrainz/search", post(musicbrainz_search))
        // Get MusicBrainz data for specific songs
        .route("/api/musicbrainz/songs/matches", post(get_song_matches))
        // Get server configuration
        .route("/api/musicbrainz/config", get(get_musicbrainz_config))
        .layer(middleware::from_fn(require_admin))
        .layer(middleware::from_fn(require_musicbrainz_enabled))
}

#[derive(Debug, Deserialize)]
pub struct MusicBrainzSearchRequest {
    pub search_type: String, // "song", "album", "artist"
    pub query: String,
    pub artist: Option<String>, // For album/song searches
    pub album: Option<String>,  // For song searches
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct SongMatchesRequest {
    pub song_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct SongMatchesResponse {
    pub songs: Vec<SongWithMatches>,
}

#[derive(Debug, Serialize)]
pub struct SongWithMatches {
    pub song_id: String,
    pub current_metadata: SongMetadata,
    pub musicbrainz_data: Option<serde_json::Value>, // From JSONB storage
    pub enrichment_status: String,
    pub available_matches: Vec<MusicBrainzMatch>,
}
```

## Phase 2: Frontend Integration 🔄 NEXT

### 2.1 Extend Existing Song Context Menu

**File**: `client/js/src/views/freqhole/services/songInteractions.ts`

add musicbrainz option to existing context menu:

```typescript
// add to existing context menu actions
if (isAdmin && musicBrainzEnabled) {
  actions.push({ type: "separator" });
  actions.push({
    label: "musicbrainz lookup",
    icon: "brain", // 🧠 brain icon as simple svg
    action: () => {
      events.emit("modal:open", {
        modal: "musicbrainzModal",
        data: { songs: [song] },
      });
    },
  });
}

// add delete option for admin users (works for single or multiple selected songs)
if (isAdmin) {
  const selectedSongs = getSelectedSongs(); // or however selection is accessed
  const songCount = selectedSongs.length;
  const label = songCount === 1 ? "delete song" : `delete ${songCount} songs`;
  const confirmMessage =
    songCount === 1
      ? "are you sure you want to delete this song?"
      : `are you sure you want to delete ${songCount} songs?`;

  actions.push({
    label,
    icon: "trash",
    destructive: true,
    action: async () => {
      if (confirm(confirmMessage)) {
        await apiClient.deleteSongs(selectedSongs.map((s) => s.id));
        // refresh song list or emit event to update ui
      }
    },
  });
}
```

### 2.2 Create MusicBrainz Modal Component

**File**: `client/js/src/views/freqhole/components/modals/MusicBrainzModal.tsx`

reuse existing song edit modal patterns:

```typescript
interface MusicBrainzModalProps {
  songs: Song[];
  onClose: () => void;
}

export function MusicBrainzModal(props: MusicBrainzModalProps) {
  const [activeTab, setActiveTab] = createSignal<"matches" | "search" | "edit">("matches");

  // reuse existing song form store
  const songForm = useSongFormStore(props.songs, {
    onSubmit: async (changes) => {
      // apply changes using existing bulk update api
      await apiClient.bulkUpdateSongsFromChanges({
        song_ids: props.songs.map(s => s.id),
        updates: {
          ...changes,
          // add reviewed tag if user opts to mark as reviewed
          tags: markAsReviewed() ? [...(existingTags || []), reviewedTag] : existingTags,
        },
      });

      props.onClose();
    },
  });

  return (
    <Modal>
      <div class="musicbrainz-modal">
        <TabBar>
          <Tab active={activeTab() === "matches"} onClick={() => setActiveTab("matches")}>
            available matches
          </Tab>
          <Tab active={activeTab() === "search"} onClick={() => setActiveTab("search")}>
            search musicbrainz
          </Tab>
          <Tab active={activeTab() === "edit"} onClick={() => setActiveTab("edit")}>
            edit metadata
          </Tab>
        </TabBar>

        <Show when={activeTab() === "matches"}>
          <MusicBrainzMatches songs={props.songs} onSelectMatch={handleMatchSelect} />
        </Show>

        <Show when={activeTab() === "search"}>
          <MusicBrainzSearch onSelectMatch={handleSearchResult} />
        </Show>

        <Show when={activeTab() === "edit"}>
          {/* Reuse existing song edit form components */}
          <SongEditForm
            formStore={songForm}
            showReviewedCheckbox={true}
            onMarkReviewed={setMarkAsReviewed}
          />
        </Show>
      </div>
    </Modal>
  );
}
```

### 2.3 Add Bulk Song Deletion in Edit Mode

**extend existing bulk edit functionality to support marking songs for deletion.**

```typescript
// in existing bulk edit form, add delete functionality
const bulkEditForm = useSongFormStore(selectedSongs, {
  onSubmit: async (changes) => {
    // handle normal metadata updates
    if (Object.keys(changes).length > 0) {
      await apiClient.bulkUpdateSongsFromChanges({
        song_ids: selectedSongs.map((s) => s.id),
        updates: changes,
      });
    }

    // handle songs marked for deletion
    const songsToDelete = markedForDeletion();
    if (songsToDelete.length > 0) {
      await apiClient.deleteSongs(songsToDelete.map((s) => s.id));
    }
  },
});

// add delete/undelete functionality
const [markedForDeletion, setMarkedForDeletion] = createSignal<Song[]>([]);

const markForDeletion = (song: Song) => {
  setMarkedForDeletion((prev) => [...prev, song]);
};

const unmarkForDeletion = (song: Song) => {
  setMarkedForDeletion((prev) => prev.filter((s) => s.id !== song.id));
};
```

### 2.4 Reuse Existing Song Edit Forms

**Extend**: `client/js/src/hooks/forms/useFormStore.ts`

Add MusicBrainz-specific helpers:

```typescript
// Add to existing useSongFormStore
export function useSongFormStore(
  initialSong: Song | Song[],
  options: FormStoreOptions = {},
) {
  // ... existing code ...

  // Add MusicBrainz-specific methods
  const applyMusicBrainzMatch = (match: MusicBrainzMatch) => {
    // Apply match data to form fields
    batch(() => {
      if (match.title !== currentData().title) {
        updateField("title", match.title);
      }
      if (match.artist !== currentData().artist) {
        updateField("artist", match.artist);
      }
      if (match.album !== currentData().album) {
        updateField("album", match.album);
      }
      // ... other fields
    });
  };

  const getMusicBrainzChanges = (): MusicBrainzChange[] => {
    const changes = getChanges();
    return Object.entries(changes).map(([field, newValue]) => ({
      field: field as keyof EditableSongFields,
      oldValue: originalData()[field],
      newValue,
      source: "musicbrainz",
    }));
  };

  return {
    // ... existing return object ...
    applyMusicBrainzMatch,
    getMusicBrainzChanges,
  };
}
```

## Phase 3: API Client Integration 🔄 NEXT

### 3.1 Add MusicBrainz API Methods

**File**: `client/js/src/lib/api-client.ts`

```typescript
// add to existing apiClient class
class ApiClient {
  // ... existing methods ...

  async getMusicBrainzConfig(): Promise<MusicBrainzConfig> {
    const response = await this.fetch("/api/musicbrainz/config");
    return MusicBrainzConfigSchema.parse(await response.json());
  }

  async searchMusicBrainz(
    request: MusicBrainzSearchRequest,
  ): Promise<MusicBrainzSearchResponse> {
    const response = await this.fetch("/api/musicbrainz/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    return MusicBrainzSearchResponseSchema.parse(await response.json());
  }

  async getSongMatches(songIds: string[]): Promise<SongMatchesResponse> {
    const response = await this.fetch("/api/musicbrainz/songs/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song_ids: songIds }),
    });
    return SongMatchesResponseSchema.parse(await response.json());
  }
}
```

### 3.2 Zod Schemas

**File**: `client/js/src/lib/music/schemas/musicbrainz-schemas.ts`

```typescript
import { z } from "zod";

export const MusicBrainzConfigSchema = z.object({
  enabled: z.boolean(),
  reviewed_tag: z.string().optional(),
});

export const MusicBrainzMatchSchema = z.object({
  recording_id: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string().optional(),
  year: z.number().optional(),
  track_number: z.number().optional(),
  disc_number: z.number().optional(),
  confidence_score: z.number(),
  match_reasons: z.array(z.string()),
});

export const SongWithMatchesSchema = z.object({
  song_id: z.string(),
  current_metadata: z.object({
    title: z.string(),
    artist: z.string(),
    album: z.string().optional(),
    year: z.number().optional(),
    track_number: z.number().optional(),
    disc_number: z.number().optional(),
  }),
  musicbrainz_data: z.any().optional(),
  enrichment_status: z.string(),
  available_matches: z.array(MusicBrainzMatchSchema),
});

export const SongMatchesResponseSchema = z.object({
  songs: z.array(SongWithMatchesSchema),
});

export const MusicBrainzSearchRequestSchema = z.object({
  search_type: z.enum(["song", "album", "artist"]),
  query: z.string(),
  artist: z.string().optional(),
  album: z.string().optional(),
  limit: z.number().optional(),
});

export type MusicBrainzConfig = z.infer<typeof MusicBrainzConfigSchema>;
export type MusicBrainzMatch = z.infer<typeof MusicBrainzMatchSchema>;
export type SongWithMatches = z.infer<typeof SongWithMatchesSchema>;
export type SongMatchesResponse = z.infer<typeof SongMatchesResponseSchema>;
export type MusicBrainzSearchRequest = z.infer<
  typeof MusicBrainzSearchRequestSchema
>;
```

## Phase 4: Reactive Hooks 🔄 NEXT

### 4.1 MusicBrainz Configuration Hook

**File**: `client/js/src/hooks/music/admin/useMusicBrainzConfig.ts`

```typescript
import { createResource } from "solid-js";
import { apiClient } from "../../../lib/api-client.js";

export function useMusicBrainzConfig() {
  const [config] = createResource(async () => {
    try {
      return await apiClient.getMusicBrainzConfig();
    } catch (error) {
      // musicbrainz not enabled or user not admin
      return { enabled: false };
    }
  });

  return {
    config,
    isEnabled: () => config()?.enabled || false,
    reviewedTag: () => config()?.reviewed_tag || "reviewed",
  };
}
```

### 4.2 Song Matches Hook

**File**: `client/js/src/hooks/music/admin/useSongMatches.ts`

```typescript
import { createResource, createSignal } from "solid-js";
import { apiClient } from "../../../lib/api-client.js";

export function useSongMatches(songIds: () => string[]) {
  const [matches, { refetch }] = createResource(songIds, async (ids) => {
    if (ids.length === 0) return { songs: [] };
    return await apiClient.getSongMatches(ids);
  });

  const [searchResults, setSearchResults] = createSignal<MusicBrainzMatch[]>(
    [],
  );

  const searchMusicBrainz = async (request: MusicBrainzSearchRequest) => {
    const results = await apiClient.searchMusicBrainz(request);
    setSearchResults(results.matches || []);
    return results;
  };

  return {
    matches,
    searchResults,
    searchMusicBrainz,
    refetch,
    isLoading: matches.loading,
  };
}
```

## Integration Points

### admin interface integration

- **admin-only feature**: use existing admin middleware patterns
- **settings integration**: add musicbrainz config to existing admin settings
- **bulk operations**: extend existing bulk song edit operations

### existing song management integration

- **context menu**: add musicbrainz option alongside existing "song info"
- **modal system**: use existing modal event system and patterns
- **form reuse**: leverage existing song edit forms and validation
- **filtering**: extend existing song filter system with reviewed tag option

### database integration

- **tag system**: use existing tag system for "reviewed" functionality
- **jsonb storage**: musicbrainz data already stored in `songs.metadata.musicbrainz`
- **bulk updates**: use existing bulk song update api endpoints

## Success Criteria

### functional requirements

- ✅ admin users can access musicbrainz lookup via context menu
- ✅ modal shows existing musicbrainz matches from cli scan results
- ✅ users can search musicbrainz api for additional matches
- ✅ metadata changes clearly highlighted in existing song edit form
- ✅ users can apply changes using existing bulk update system
- ✅ optional "mark as reviewed" functionality using tag system
- ✅ songs always sorted by album position (disc_number, track_number)
- ✅ new post album tracks api eliminates js filtering of 1000 records
- ✅ admin users can delete songs via context menu (immediate) or bulk edit (on save)
- ✅ soft delete functionality preserves data integrity

### performance requirements

- ✅ modal loads quickly using cached musicbrainz data
- ✅ album sorting doesn't impact search performance
- ✅ new album api reduces client-side data processing
- ✅ reuse of existing components minimizes bundle size

### user experience requirements

- ✅ seamless integration with existing song management workflow
- ✅ familiar ui patterns and interactions
- ✅ clear indication of changed fields using existing form highlighting
- ✅ consistent with existing admin interface design patterns
- ✅ feature only visible when appropriate (admin + musicbrainz enabled)

## File Organization

### server files (rust)

- `server/src/musicbrainz/mod.rs` - module setup and exports
- `server/src/musicbrainz/routes.rs` - simplified api routes
- `server/src/musicbrainz/handlers.rs` - request handlers
- `server/src/musicbrainz/middleware.rs` - admin and feature gate middleware

### client files (typescript)

- `client/js/src/lib/music/schemas/musicbrainz-schemas.ts` - zod schemas
- `client/js/src/hooks/music/admin/useMusicBrainzConfig.ts` - config hook
- `client/js/src/hooks/music/admin/useSongMatches.ts` - matches hook
- `client/js/src/views/freqhole/components/modals/MusicBrainzModal.tsx` - main modal
- `client/js/src/views/freqhole/components/musicbrainz/` - musicbrainz-specific components

### modified files

- `client/js/src/views/freqhole/services/songInteractions.ts` - add context menu option
- `server/src/media/search.rs` - fix album sorting in search api
- `server/src/media/songs.rs` - add post album tracks api and song deletion endpoints
- `client/js/src/views/freqhole/components/content/views/albums/albumUtils.ts` - use new post album api

## Technical Architecture

### code reuse strategy

- **maximum reuse**: leverage existing song edit forms, bulk operations, modal system
- **minimal new code**: only add musicbrainz-specific search and match selection
- **extension pattern**: extend existing functionality rather than replacing
- **admin integration**: use existing admin middleware and permission patterns

### data flow

1. **context menu**: user selects musicbrainz option from existing song context menu
2. **modal opens**: reuse existing modal system and event patterns
3. **load matches**: display cached musicbrainz data from cli scan results
4. **search option**: allow additional searches using musicbrainz api
5. **edit form**: use existing song edit form with change highlighting
6. **apply changes**: use existing bulk song update api with optional reviewed tag
7. **ui updates**: existing reactive patterns update song displays

### state management

- **reactive hooks**: use existing patterns with createResource and signals
- **form state**: reuse existing useSongFormStore patterns
- **modal state**: use existing modal event system
- **admin state**: integrate with existing admin permission checks

this plan maximizes code reuse, integrates seamlessly with existing functionality, and provides a streamlined user experience for musicbrainz metadata management.
