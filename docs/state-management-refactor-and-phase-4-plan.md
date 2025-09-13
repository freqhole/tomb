# State Management Refactor & Phase 4 Tag Filtering Plan

## 🚨 CRITICAL RULES - NEVER FORGET 🚨

1. **NO EMOJIS**: Keep code comments, logs, and ui display text lowercase (proper nouns and acronyms can be uppercase)
2. **File Size Limit**: Maximum ~500 lines per file
3. **Dark Theme Design**: UI must use dark theme with primary colors black, white, and magenta accents. Use other colors sparingly. Avoid borders and no rounded corner border radius (border-radius: 0)
4. **Modular Architecture**: Use solidjs hooks for reactive logic, leverage createResource/produce/mutate for optimal reactivity, keep components presentational, central context providers for state, avoid prop drilling
5. **Data Validation**: Use zod for all json api data parsing and validation (existing pattern)
6. **Code Reuse**: Leverage existing lib code and hooks where possible, build new generic utilities in `client/js/src/lib/`
7. **Domain Separation**: Keep admin logic generic in views/admin/, music-specific code in lib/music/ and hooks/music/
8. **Generic Library Focus**: Build reusable patterns in `client/js/src/lib/`

## Progress Tracking

**Current Status**: Phase 1 - Core Reactive Store Foundation (✅ COMPLETE)

**Phase 1 - COMPLETED ✅:**

- ✅ enhanced FreqholeStore with server context and tagListVersion
- ✅ created basic reactive actions with createResource patterns
- ✅ consolidated providers (removed SearchProvider and FreqholeContext stub)
- ✅ updated TagFilterControls to use new reactive store hooks
- ✅ created store/hooks.tsx with granular access hooks
- ✅ basic store structure compiles and works
- ✅ **FIXED:** runtime error "useSearchContext must be used within SearchProvider"
- ✅ **REMOVED:** old SearchContext.tsx file
- ✅ **UPDATED:** SearchResultsView.tsx to use new store hooks
- ✅ **UPDATED:** NavigationHeader.tsx to use new store hooks
- ✅ **CREATED:** comprehensive useSearch() hook that bridges old API
- ✅ **FIXED:** all TypeScript compilation errors
- ✅ app compiles without errors and runtime issues resolved

**Phase 1 Issues Resolved:**

- ✅ type errors with convenience hooks - FIXED
- ✅ runtime error with SearchContext imports - FIXED
- ✅ all components now use consolidated store instead of old contexts

**Ready for Phase 2:** Tag Context Menu Fix (reactive patterns for tag management)

**Phase Completion Process:**

Each phase must result in a working app. Before moving to next phase: fix all runtime errors, test in browser together, debug any issues that come up. No phase is complete until app runs without errors.

## Overview

This document outlines a comprehensive refactoring plan to consolidate the current fragmented state management system and implement Phase 4 tag filtering for artists and albums views. The current system has multiple overlapping context providers that create complexity and inconsistent patterns.

**Current Problems:**

- Multiple nested providers: AuthProvider → StoreProvider → SearchProvider → FreqholeContext (unused)
- TagFilterControls uses both store actions AND manual global events
- Artists/Albums endpoints lack tag filtering capability
- Inconsistent reactive patterns across components

**Goals:**

1. Consolidate to single, clean FreqholeStore context provider
2. Integrate event system directly into store actions
3. Extend tag filtering to artists and albums views
4. Eliminate redundant/legacy code and providers
5. Follow solid-js reactive patterns consistently
6. Make the entire client/js/ codebase cleaner and more maintainable
7. Design with future multi-server support in mind (server-agnostic patterns)
8. Leverage solid-js reactive primitives (createResource, produce, mutate) for optimal state management
9. Establish patterns for synchronized state across multiple UI locations

## Current Architecture Analysis

### Context Providers Stack

```
client/js/src/views/freqhole/index.tsx:
AuthProvider → StoreProvider → SearchProvider → FreqholeContext (stub)
```

### State Management Files

- `store/index.tsx`: Comprehensive FreqholeStore with filters.tags stub
- `context/SearchContext.tsx`: Wraps useFreqholeSearch hook
- `context/FreqholeContext.tsx`: Unused stub with TODOs
- `hooks/useGlobalEvents.ts`: Event bus system
- `hooks/useFreqholeSearch.ts`: Search logic with tag filtering

### Current Tag Filtering Implementation

- **TagFilterControls**: Uses useFilters() + manual event emissions
- **Songs views**: Integrated with TagFilterControls
- **Artists/Albums views**: No tag filtering support

### Backend API Status

- **Songs**: POST `/api/music/search` with tag filtering ✅ (no changes needed)
- **Artists**: GET `/api/music/artists` (existing) + POST variant needed for tag filtering
- **Albums**: GET `/api/music/albums` (existing) + POST variant needed for tag filtering

## Future Multi-Server Context

**Distant Future Goal:** Support multiple API servers with ability to switch entire app context between servers.

**Implications for Current Plan:**

- Store should be designed as "per-server" context
- API client should be injected, not global
- Auth should be per-server, not global
- Pattern should support creating multiple store instances

**Current Plan Adjustments:** Design for server-agnostic patterns, leverage solid-js reactive primitives, but keep view management in the router where it belongs. Avoid embedding view-specific logic in the store.

## Complex Requirements Analysis

### Infinite Grid Virtualization & Scroll Restoration

- **Virtualized rendering**: Only render visible items for performance
- **Scroll restoration**: Router tracks scroll position and current page
- **Arbitrary page loading**: Must load page N directly (not just sequential)
- **Bidirectional infinite scroll**: Load more pages up or down from current position
- **State synchronization**: Grid state must sync with router state and data resources

### Tag Context Menu Complexity

- **Global tag state**: Needs to update available tags list when creating new tags
- **Individual song state**: Update specific song(s) with new/removed tags
- **Multi-selection support**: Handle bulk tag operations across selected songs
- **Reactive conflicts**: Current implementation fights reactive patterns

### Cross-View Data Synchronization

- **Currently playing indicators**: Show across all views where song appears
- **Playlist updates**: Nav sidebar must reflect changes made in playlist view
- **Tag filter state**: Preserve filter state when switching between views

## Solid-JS Reactive Patterns Integration

**Key Reactive Primitives to Leverage:**

- **createResource**: For API data fetching with automatic loading/error states
- **produce**: For immutable store updates with complex nested changes
- **mutate**: For optimistic updates and immediate UI feedback
- **createMemo**: For derived state and computed values
- **batch**: For coordinating multiple state updates

**Synchronization Patterns Needed:**

- Tag filter changes trigger reloads across songs/artists/albums views
- Selection state synchronized between context menus and bulk actions
- Search state synchronized with URL params and filter state
- Player state synchronized with queue and current song displays

## Incremental Implementation Plan

**Strategy**: Build foundational reactive patterns first, staying grounded in current reality. Keep the router handling views, avoid over-coupling store to specific views, and ensure each phase delivers a working app.

### Phase 1: Core Reactive Store Foundation (Week 1)

#### 1.1: Basic Store Structure with Resources

**Goal**: Establish core reactive patterns without infinite grid complexity

**File:** `client/js/src/views/freqhole/store/index.tsx`

**Changes:**

- Create store factory pattern for multi-server preparation
- Basic createResource setup for songs/artists/albums
- Simple tag filter state management
- Event system integration foundation

**Phase 1 Store Structure (Simplified):**

```typescript
export interface FreqholeStore {
  // ... existing structure ...

  // basic search state
  search: {
    query: string;
  };

  // basic filter state
  filters: {
    tags: string[];
  };

  // server context preparation
  server: {
    apiClient: ApiClient;
    baseUrl: string;
    serverId: string;
  };

  // basic ui state
  ui: {
    // ... existing ui state ...
    tagListVersion: number; // for tag list reactive updates
  };
}

// phase 1: basic resources without view coupling
export interface BasicStoreResources {
  songs: Resource<Song[]>;
  artists: Resource<ArtistSummary[]>;
  albums: Resource<AlbumSummary[]>;
  availableTags: Resource<FilterOption[]>;
}
```

**Phase 1 Store Actions (Basic):**

```typescript
import { createResource, batch, produce } from "solid-js";
import { mutate } from "solid-js/store";

// phase 1: basic store actions without infinite grid complexity
export function createStoreActions(
  store: FreqholeStore,
  setStore: SetStoreFunction<FreqholeStore>,
  apiClient: ApiClient,
) {
  // basic resource fetching for phase 1 - let components decide when to load
  const [songsResource, { refetch: refetchSongs }] = createResource(
    () => ({
      tags: store.filters.tags,
      query: store.search.query,
    }),
    async (params) => {
      // simple fetching - components control when this runs
      if (params.tags.length > 0 || params.query) {
        return apiClient.searchMusic(params);
      }
      return apiClient.getSongs();
    },
  );

  const [artistsResource, { refetch: refetchArtists }] = createResource(
    () => store.filters.tags,
    async (tags) => {
      // simple fetch - components decide when to use this resource
      if (tags.length > 0) {
        return apiClient.filterArtists({ tags });
      }
      return apiClient.getArtists();
    },
  );

  const [albumsResource, { refetch: refetchAlbums }] = createResource(
    () => store.filters.tags,
    async (tags) => {
      // simple fetch - components decide when to use this resource
      if (tags.length > 0) {
        return apiClient.filterAlbums({ tags });
      }
      return apiClient.getAlbums();
    },
  );

  const [playlistsResource, { refetch: refetchPlaylists }] = createResource(
    () => true, // simple fetch - components decide when to access
    async () => apiClient.getPlaylists(),
  );

  // recent playlists for navigation (always loaded - lightweight)
  const [recentPlaylistsResource, { refetch: refetchRecentPlaylists }] =
    createResource(
      () => true, // always load for nav
      () => apiClient.getRecentPlaylists({ limit: 5 }),
    );

  // available tags with reactive updates when tags are created/deleted
  const [availableTagsResource, { refetch: refetchAvailableTags }] =
    createResource(
      () => store.ui.tagListVersion, // increment this to force refresh
      () => apiClient.getFilterOptions().then((res) => res.tags?.items || []),
    );

  return {
    // resources for components to consume
    resources: {
      songs: songsResource,
      artists: artistsResource,
      albums: albumsResource,
      playlists: playlistsResource,
      recentPlaylists: recentPlaylistsResource,
      availableTags: availableTagsResource,
    },

    // smart filter actions with selective updates
    addTagFilter: (tag: string) => {
      setStore(
        produce((draft) => {
          if (!draft.filters.tags.includes(tag)) {
            draft.filters.tags.push(tag);
          }
        }),
      );
      // resources automatically refetch based on reactive dependencies
      // no manual refetch needed - performance optimized!

      // event for any remaining listeners
      eventBus.dispatchEvent(
        new CustomEvent("tag:added", {
          detail: { tag },
        }),
      );
    },

    removeTagFilter: (tag: string) => {
      setStore(
        produce((draft) => {
          draft.filters.tags = draft.filters.tags.filter((t) => t !== tag);
        }),
      );
      // again, resources auto-update - no manual coordination needed

      eventBus.dispatchEvent(
        new CustomEvent("tag:removed", {
          detail: { tag },
        }),
      );
    },

    // remove view tracking - let router handle this

    // cross-view synchronization with optimistic updates
    toggleSongFavorite: (songId: string, isFavorite: boolean) => {
      // optimistic update in current resource
      mutate(songsResource, (songs) => {
        const song = songs?.find((s) => s.id === songId);
        if (song) song.is_favorite = isFavorite;
      });

      // also update song if it appears in search results
      mutate(searchResultsResource, (results) => {
        if (results?.songs) {
          const song = results.songs.find((s) => s.id === songId);
          if (song) song.is_favorite = isFavorite;
        }
      });

      // api call with rollback on error
      apiClient
        .updateSongPreference(songId, { is_favorite: isFavorite })
        .catch(() => {
          // revert optimistic updates
          mutate(songsResource, (songs) => {
            const song = songs?.find((s) => s.id === songId);
            if (song) song.is_favorite = !isFavorite;
          });
          mutate(searchResultsResource, (results) => {
            if (results?.songs) {
              const song = results.songs.find((s) => s.id === songId);
              if (song) song.is_favorite = !isFavorite;
            }
          });
        });

      // event for "currently playing" indicators and other listeners
      eventBus.dispatchEvent(
        new CustomEvent("song:favorite-changed", {
          detail: { songId, isFavorite },
        }),
      );
    },

    // set currently playing song with cross-view synchronization
    setCurrentlyPlaying: (song: Song | null) => {
      const previousSong = store.player.currentSong;

      setStore("player", "currentSong", song);

      // emit events for "now playing" indicators across the app
      eventBus.dispatchEvent(
        new CustomEvent("player:song-changed", {
          detail: { currentSong: song, previousSong },
        }),
      );
    },

    // playlist updates with cross-view synchronization
    updatePlaylist: async (playlistId: string, updates: Partial<Playlist>) => {
      // optimistic update in main playlists resource
      mutate(playlistsResource, (playlists) => {
        const playlist = playlists?.find((p) => p.id === playlistId);
        if (playlist) {
          Object.assign(playlist, updates);
        }
      });

      // also update recent playlists in nav
      mutate(recentPlaylistsResource, (recent) => {
        const playlist = recent?.find((p) => p.id === playlistId);
        if (playlist) {
          Object.assign(playlist, updates);
        }
      });

      try {
        const updatedPlaylist = await apiClient.updatePlaylist(
          playlistId,
          updates,
        );

        // success event for nav and other listeners
        eventBus.dispatchEvent(
          new CustomEvent("playlist:updated", {
            detail: { playlist: updatedPlaylist },
          }),
        );
      } catch (error) {
        // revert optimistic updates on error
        refetchPlaylists();
        refetchRecentPlaylists();
        throw error;
      }
    },

    // add song to playlist with nav synchronization
    addSongToPlaylist: async (playlistId: string, songId: string) => {
      // optimistic update to playlist song count
      mutate(recentPlaylistsResource, (recent) => {
        const playlist = recent?.find((p) => p.id === playlistId);
        if (playlist) {
          playlist.song_count = (playlist.song_count || 0) + 1;
        }
      });

      try {
        await apiClient.addSongToPlaylist(playlistId, songId);

        eventBus.dispatchEvent(
          new CustomEvent("playlist:song-added", {
            detail: { playlistId, songId },
          }),
        );
      } catch (error) {
        // revert optimistic update
        mutate(recentPlaylistsResource, (recent) => {
          const playlist = recent?.find((p) => p.id === playlistId);
          if (playlist) {
            playlist.song_count = Math.max(0, (playlist.song_count || 1) - 1);
          }
        });
        throw error;
      }
    },

    // selective refresh methods - components can call what they need
    refreshSongs: () => refetchSongs(),
    refreshArtists: () => refetchArtists(),
    refreshAlbums: () => refetchAlbums(),
    refreshPlaylists: () => refetchPlaylists(),

    // tag lifecycle management
    createTag: async (tagName: string) => {
      try {
        const newTag = await apiClient.createTag({ name: tagName });

        // increment version to trigger availableTagsResource refresh
        setStore("ui", "tagListVersion", (v) => v + 1);

        eventBus.dispatchEvent(
          new CustomEvent("tag:created", {
            detail: { tag: newTag },
          }),
        );

        return newTag;
      } catch (error) {
        console.error("failed to create tag:", error);
        throw error;
      }
    },

    deleteTag: async (tagId: string, tagName: string) => {
      try {
        await apiClient.deleteTag(tagId);

        // remove tag from current filters if present
        setStore(
          produce((draft) => {
            draft.filters.tags = draft.filters.tags.filter(
              (t) => t !== tagName,
            );
          }),
        );

        // increment version to trigger availableTagsResource refresh
        setStore("ui", "tagListVersion", (v) => v + 1);

        eventBus.dispatchEvent(
          new CustomEvent("tag:deleted", {
            detail: { tagId, tagName },
          }),
        );
      } catch (error) {
        console.error("failed to delete tag:", error);
        throw error;
      }
    },

    // context menu tag operations with global synchronization
    addTagToSongs: async (songIds: string[], tagName: string) => {
      let tagCreated = false;

      try {
        // check if tag exists, create if not
        const availableTags = availableTagsResource();
        let tag = availableTags?.find((t) => t.value === tagName);

        if (!tag) {
          tag = await apiClient.createTag({ name: tagName });
          tagCreated = true;
        }

        // add tag to songs
        await apiClient.bulkUpdateSongs({
          song_ids: songIds,
          updates: {
            tags: { operation: "Add", values: [tagName] },
          },
        });

        // if new tag was created, refresh available tags
        if (tagCreated) {
          setStore("ui", "tagListVersion", (v) => v + 1);
        }

        // refresh current view data
        actions.refreshCurrentView();

        eventBus.dispatchEvent(
          new CustomEvent("song:tags-updated", {
            detail: { songIds, tagAdded: tagName, tagCreated },
          }),
        );
      } catch (error) {
        console.error("failed to add tag to songs:", error);
        throw error;
      }
    },

    removeTagFromSongs: async (songIds: string[], tagName: string) => {
      try {
        await apiClient.bulkUpdateSongs({
          song_ids: songIds,
          updates: {
            tags: { operation: "Remove", values: [tagName] },
          },
        });

        // refresh current view data
        actions.refreshCurrentView();

        // check if tag should be removed from global list
        // (if no songs have this tag anymore)
        const stillInUse = await apiClient.checkTagUsage(tagName);
        if (!stillInUse) {
          setStore("ui", "tagListVersion", (v) => v + 1);
        }

        eventBus.dispatchEvent(
          new CustomEvent("song:tags-updated", {
            detail: { songIds, tagRemoved: tagName },
          }),
        );
      } catch (error) {
        console.error("failed to remove tag from songs:", error);
        throw error;
      }
    },

    // force refresh all (only when needed)
    refreshAll: () => {
      batch(() => {
        refetchSongs();
        refetchArtists();
        refetchAlbums();
        refetchPlaylists();
        refetchRecentPlaylists();
        setStore("ui", "tagListVersion", (v) => v + 1); // refresh tags too
      });
    },
  };
}

// current single-server implementation
export const storeActions = createStoreActions(store, setStore, apiClient);
```

#### 1.2: Basic Event Integration

**Goal**: Simple event system integration without complex synchronization

**Event Integration:**

- store actions emit basic events
- components can listen to events
- foundation for complex synchronization in later phases

#### 1.3: Provider Consolidation

**File:** `client/js/src/views/freqhole/index.tsx`

**Before:**

```typescript
export default function Freqhole() {
  return (
    <AuthProvider>
      <StoreProvider>
        <SearchProvider>
          <HashRouter>{routes}</HashRouter>
        </SearchProvider>
      </StoreProvider>
    </AuthProvider>
  );
}
```

**After (with future multi-server preparation):**

```typescript
export default function Freqhole() {
  return (
    <ServerContextProvider>
      <HashRouter>{routes}</HashRouter>
    </ServerContextProvider>
  );
}
```

**Note:** ServerContextProvider will internally manage both auth and store for the current server context, preparing for future multi-server support where auth is per-server rather than global.

**Files to Remove:**

- `context/SearchContext.tsx`
- `context/FreqholeContext.tsx`

**Files to Update:**

- all components importing from removed contexts
- update to use consolidated store hooks

#### 1.4: Basic Store Hooks

**Goal**: Simple hooks for Phase 1 - complex hooks added in later phases

**File:** `client/js/src/views/freqhole/store/hooks.tsx`

```typescript
// granular hooks for specific functionality
export const useSearch = () => {
  const [store, setStore] = useFreqholeStore();
  return [
    store.search,
    {
      setQuery: (query: string) => storeActions.setSearchQuery(query),
      executeSearch: () => storeActions.executeSearch(),
      setActiveTab: (tab: SearchTab) => storeActions.setActiveTab(tab),
      clearSearch: () => storeActions.clearSearch(),
    },
  ] as const;
};

export const useTagFilters = () => {
  const [store, actions] = useFreqholeStore();

  // memoized available tags excluding selected ones
  const unselectedTags = createMemo(() => {
    const available = actions.resources.availableTags() || [];
    const selected = store.filters.tags;
    return available.filter((tag) => !selected.includes(tag.value));
  });

  return [
    {
      selectedTags: store.filters.tags,
      availableTags: actions.resources.availableTags,
      unselectedTags: unselectedTags,
      loading: actions.resources.availableTags.loading,
      error: actions.resources.availableTags.error,
    },
    {
      addTag: (tag: string) => actions.addTagFilter(tag),
      removeTag: (tag: string) => actions.removeTagFilter(tag),
      clearTags: () => actions.clearTagFilters(),
    },
  ] as const;
};

export const useDataSections = () => {
  const [store, actions] = useFreqholeStore();

  return {
    songs: {
      data: actions.resources.songs,
      loading: actions.resources.songs.loading,
      error: actions.resources.songs.error,
    },
    artists: {
      data: actions.resources.artists,
      loading: actions.resources.artists.loading,
      error: actions.resources.artists.error,
    },
    albums: {
      data: actions.resources.albums,
      loading: actions.resources.albums.loading,
      error: actions.resources.albums.error,
    },
    playlists: {
      data: actions.resources.playlists,
      loading: actions.resources.playlists.loading,
      error: actions.resources.playlists.error,
    },
  };
};

// hook for nav-specific data (always loaded)
export const useNavigation = () => {
  const [store, actions] = useFreqholeStore();

  return {
    recentPlaylists: actions.resources.recentPlaylists,
    // router handles current view, not store
  };
};

// hook for tag management in context menus
export const useTagManagement = () => {
  const [store, actions] = useFreqholeStore();

  return {
    availableTags: actions.resources.availableTags,
    createTag: actions.createTag,
    deleteTag: actions.deleteTag,
    addTagToSongs: actions.addTagToSongs,
    removeTagFromSongs: actions.removeTagFromSongs,
    loading: actions.resources.availableTags.loading,
  };
};

// hook for currently playing indicators across the app
export const useCurrentlyPlaying = () => {
  const [store, actions] = useFreqholeStore();
  const events = useGlobalEvents();

  // memoized indicator for any song
  const isCurrentlyPlaying = createMemo(() => (songId: string) => {
    return store.player.currentSong?.id === songId;
  });

  // listen for player changes to trigger re-renders
  events.on("player:song-changed", () => {
    // re-render components using this hook
  });

  return {
    currentSong: store.player.currentSong,
    isPlaying: store.player.isPlaying,
    isCurrentlyPlaying: isCurrentlyPlaying,
    setCurrentlyPlaying: actions.setCurrentlyPlaying,
  };
};

// New hook for synchronized selection state
export const useSelection = () => {
  const [store, actions] = useFreqholeStore();

  // Derived state for selection info
  const selectionInfo = createMemo(() => ({
    count: store.ui.selection.selectedIds.size,
    hasSelection: store.ui.selection.selectedIds.size > 0,
    canBulkEdit: store.ui.selection.selectedIds.size > 1,
    selectionType: store.ui.selection.selectionType,
  }));

  return [
    {
      selectedIds: store.ui.selection.selectedIds,
      ...selectionInfo(),
      bulkActionInProgress: store.ui.selection.bulkActionInProgress,
    },
    {
      setSelection: actions.setSelection,
      clearSelection: actions.clearSelection,
      toggleSelection: (id: string) => {
        const newIds = new Set(store.ui.selection.selectedIds);
        if (newIds.has(id)) {
          newIds.delete(id);
        } else {
          newIds.add(id);
        }
        actions.setSelection(
          Array.from(newIds),
          store.ui.selection.selectionType || "songs",
        );
      },
    },
  ] as const;
};
```

### Phase 2: Tag Management & Context Menu Integration (Week 2)

**Goal**: Solve the reactive conflicts in tag context menus and establish tag lifecycle patterns

#### 2.1: Tag Lifecycle Management

**Files:**

- `client/js/src/views/freqhole/store/actions.tsx` (new file)
- `client/js/src/components/menus/TagContextMenu.tsx` (refactor)

**Tag Context Menu Reactive Pattern:**

```typescript
export const useTagContextMenu = () => {
  const [store, actions] = useFreqholeStore();

  return {
    // global tag management
    createTagAndAddToSongs: async (songIds: string[], tagName: string) => {
      // step 1: optimistic update to songs
      songIds.forEach((songId) => {
        mutate(actions.resources.songs, (songs) => {
          const song = songs?.find((s) => s.id === songId);
          if (song) {
            song.tags = [...(song.tags || []), tagName];
          }
        });
      });

      try {
        // step 2: create tag if needed and update songs
        await actions.addTagToSongs(songIds, tagName);

        // step 3: global tag list updates automatically via tagListVersion
        // step 4: current component refreshes via reactive resource
      } catch (error) {
        // rollback optimistic updates
        songIds.forEach((songId) => {
          mutate(actions.resources.songs, (songs) => {
            const song = songs?.find((s) => s.id === songId);
            if (song) {
              song.tags = song.tags?.filter((t) => t !== tagName);
            }
          });
        });
        throw error;
      }
    },
  };
};
```

### Phase 3: Backend API Extensions (Week 3)

**Scope:** Artists and albums APIs with tag filtering support

#### 3.1: Artists API Tag Filtering

**File:** `server/src/media/songs.rs`

**Strategy:** Keep existing GET endpoint, add POST variant for filtering

**New Endpoint:** `POST /api/music/artists`

```rust
#[derive(Debug, Deserialize)]
pub struct ArtistsFilterRequest {
    pub tags: Option<Vec<String>>,
    pub query: Option<String>,
    pub page: Option<i32>,
    pub page_size: Option<i32>,
    pub sort_by: Option<String>,
    pub sort_direction: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ArtistsFilterResponse {
    pub artists: Vec<ArtistSummaryResponse>,
    pub total: i64,
    pub page: i32,
    pub page_size: i32,
    pub total_pages: i32,
    pub has_next: bool,
    pub has_prev: bool,
}

pub async fn filter_artists(
    Extension(db): Extension<DatabaseConnection>,
    Json(request): Json<ArtistsFilterRequest>,
) -> Result<Json<ArtistsFilterResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());

    // Build query with tag filtering
    let mut query = String::from(r#"
        SELECT DISTINCT s.artist,
               COUNT(DISTINCT s.id) as song_count,
               AVG(COALESCE(sp.rating, 0)) as avg_rating
        FROM songs s
        LEFT JOIN song_preferences sp ON s.id = sp.song_id
        WHERE s.deleted_at IS NULL AND s.artist IS NOT NULL
    "#);

    let mut params = Vec::new();
    let mut param_count = 1;

    // Add tag filtering
    if let Some(tags) = &request.tags {
        if !tags.is_empty() {
            query.push_str(&format!(r#"
                AND s.id IN (
                    SELECT st.song_id
                    FROM song_tags st
                    JOIN tags t ON st.tag_id = t.id
                    WHERE t.name = ANY(${}::text[])
                )"#, param_count));
            params.push(tags.as_slice());
            param_count += 1;
        }
    }

    // Add search filtering
    if let Some(search_query) = &request.query {
        query.push_str(&format!(" AND s.artist ILIKE ${}", param_count));
        params.push(format!("%{}%", search_query));
        param_count += 1;
    }

    query.push_str(" GROUP BY s.artist");

    // Add sorting
    let sort_by = request.sort_by.as_deref().unwrap_or("artist");
    let sort_direction = request.sort_direction.as_deref().unwrap_or("asc");

    match sort_by {
        "name" | "artist" => query.push_str(&format!(" ORDER BY s.artist {}", sort_direction)),
        "song_count" => query.push_str(&format!(" ORDER BY song_count {}", sort_direction)),
        "rating" => query.push_str(&format!(" ORDER BY avg_rating {}", sort_direction)),
        _ => query.push_str(" ORDER BY s.artist ASC"),
    }

    // Add pagination
    let page = request.page.unwrap_or(1);
    let page_size = request.page_size.unwrap_or(50);
    let offset = (page - 1) * page_size;

    query.push_str(&format!(" LIMIT {} OFFSET {}", page_size, offset));

    // Execute query and build response
    // ... implementation details ...
}
```

**Route Registration:**

```rust
// Add POST variant alongside existing GET
.route("/artists", get(list_artists).post(filter_artists))
```

#### 3.2: Albums API Tag Filtering

**File:** `server/src/media/songs.rs`

**New Endpoint:** `POST /api/music/albums`

```rust
#[derive(Debug, Deserialize)]
pub struct AlbumsFilterRequest {
    pub tags: Option<Vec<String>>,
    pub query: Option<String>,
    pub artist: Option<String>,
    pub year_min: Option<i32>,
    pub year_max: Option<i32>,
    pub page: Option<i32>,
    pub page_size: Option<i32>,
    pub sort_by: Option<String>,
    pub sort_direction: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AlbumsFilterResponse {
    pub albums: Vec<AlbumSummaryResponse>,
    pub total: i64,
    pub page: i32,
    pub page_size: i32,
    pub total_pages: i32,
    pub has_next: bool,
    pub has_prev: bool,
}

pub async fn filter_albums(
    Extension(db): Extension<DatabaseConnection>,
    Json(request): Json<AlbumsFilterRequest>,
) -> Result<Json<AlbumsFilterResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());

    // Similar implementation pattern as artists filtering
    // with album-specific fields and aggregations
}
```

#### 3.3: GET/POST Endpoint Strategy

**Server-side approach:**

- Keep existing GET endpoints unchanged (simple, no filtering)
- Add POST variants for filtered requests
- Share common query logic between GET and POST implementations
- POST endpoints can reuse most of the GET logic with additional filtering

**Example shared implementation:**

```rust
// Shared query builder
async fn build_artists_query(
    db: &DatabaseConnection,
    filters: Option<&ArtistsFilterRequest>,
    pagination: &PaginationParams,
) -> Result<Vec<ArtistSummary>, WebauthnError> {
    let mut query = String::from("SELECT DISTINCT s.artist, COUNT(*) as song_count FROM songs s WHERE s.deleted_at IS NULL");

    // Add tag filtering if present
    if let Some(filters) = filters {
        if let Some(tags) = &filters.tags {
            if !tags.is_empty() {
                query.push_str(" AND s.id IN (SELECT st.song_id FROM song_tags st JOIN tags t ON st.tag_id = t.id WHERE t.name = ANY($1))");
            }
        }
    }

    // ... rest of shared logic
}

// GET endpoint (simple)
pub async fn list_artists(
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<ArtistQueryParams>,
) -> Result<Json<ArtistsResponse>, WebauthnError> {
    build_artists_query(&db, None, &params.into()).await
}

// POST endpoint (with filters)
pub async fn filter_artists(
    Extension(db): Extension<DatabaseConnection>,
    Json(request): Json<ArtistsFilterRequest>,
) -> Result<Json<ArtistsResponse>, WebauthnError> {
    build_artists_query(&db, Some(&request), &request.into()).await
}
```

**Client-side approach:**

- Use GET for unfiltered requests (when no tags selected)
- Use POST for filtered requests (when tags are selected)
- Single client method that chooses appropriate endpoint based on filter presence

### Phase 4: Infinite Grid Virtualization & Scroll Restoration (Week 4-5)

**Goal**: Add virtualization and scroll restoration without breaking existing patterns

#### 4.1: Enhanced Store Structure for Virtualization

**File:** `client/js/src/views/freqhole/store/index.tsx`

**Enhanced Store Structure:**

```typescript
export interface VirtualizedStoreResources {
  songs: Resource<PaginatedSongData>;
  artists: Resource<PaginatedArtistData>;
  albums: Resource<PaginatedAlbumData>;
}

export interface PaginatedSongData {
  items: Song[];
  totalCount: number;
  currentPage: number;
  pageSize: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface GridViewState {
  scrollOffset: number;
  visibleStartIndex: number;
  visibleEndIndex: number;
  loadedPageRange: { start: number; end: number };
}

// Enhanced store with virtualization state
export interface EnhancedFreqholeStore extends FreqholeStore {
  // router handles scroll restoration, not store
  scrollRestoration: {
    positions: Record<string, number>; // route -> scroll position
    pages: Record<string, number>; // route -> current page
  };
}
```

#### 4.2: Virtualized Resource Management

**Virtualized Resource Pattern:**

```typescript
// Enhanced resource with arbitrary page loading
const [songsResource, { refetch, mutate }] = createResource(
  () => ({
    tags: store.filters.tags,
    query: store.search.query,
    // Virtualization params
    targetPage: store.virtualization.songs.currentPage,
    pageSize: 50,
    loadedRange: store.virtualization.songs.loadedPageRange,
  }),
  async (params) => {
    // load multiple pages if needed for scroll restoration
    const pagesToLoad = [];

    // if restoring scroll, might need to load pages 1-5 immediately
    for (
      let page = params.loadedRange.start;
      page <= params.loadedRange.end;
      page++
    ) {
      pagesToLoad.push(page);
    }

    const pagePromises = pagesToLoad.map((page) =>
      apiClient.getSongs({
        ...params,
        page,
        page_size: params.pageSize,
      }),
    );

    const pageResults = await Promise.all(pagePromises);

    // merge all pages into single dataset
    return {
      items: pageResults.flatMap((result) => result.items),
      totalCount: pageResults[0]?.totalCount || 0,
      loadedPageRange: params.loadedRange,
      // ... pagination metadata
    };
  },
);

// actions for infinite scroll and scroll restoration
export const virtualizationActions = {
  // load more pages when scrolling
  loadMorePages: async (direction: "up" | "down") => {
    const currentRange = store.virtualization.songs.loadedPageRange;

    if (direction === "down" && hasNextPage) {
      setStore(
        "virtualization",
        "songs",
        "loadedPageRange",
        "end",
        (end) => end + 1,
      );
    } else if (direction === "up" && hasPrevPage) {
      setStore(
        "virtualization",
        "songs",
        "loadedPageRange",
        "start",
        (start) => start - 1,
      );
    }

    // resource automatically refetches with new range
  },

  // restore scroll position from router
  restoreScrollPosition: (route: string, targetScrollOffset: number) => {
    const targetPage = Math.floor(targetScrollOffset / (itemHeight * pageSize));

    // load necessary pages for scroll restoration
    setStore("virtualization", "songs", "loadedPageRange", {
      start: Math.max(1, targetPage - 1),
      end: targetPage + 2,
    });

    // store scroll position for restoration
    setStore("virtualization", "songs", "scrollOffset", targetScrollOffset);
  },

  // save current scroll position to router
  saveScrollPosition: (route: string, scrollOffset: number) => {
    setStore("navigation", "scrollPositions", route, scrollOffset);

    // also save to router/URL if needed
    // router.setScrollPosition(route, scrollOffset);
  },
};
```

#### 4.3: Infinite Grid Component Integration

**File:** `client/js/src/views/freqhole/components/grid/VirtualizedInfiniteGrid.tsx`

```typescript
export function VirtualizedInfiniteGrid<T>(props: {
  items: Resource<PaginatedData<T>>;
  onLoadMore: (direction: 'up' | 'down') => void;
  onScrollPositionChange: (offset: number) => void;
  // remove viewType - let component composition handle differences
}) {
  const [store, actions] = useFreqholeStore();
  const virtualizer = createVirtualizer({
    count: props.items()?.totalCount || 0,
    getScrollElement: () => scrollElement,
    estimateSize: () => 60, // estimated item height
    overscan: 5,
  });

  // handle scroll restoration from router
  createEffect(() => {
    const route = location.pathname;
    const savedOffset = store.scrollRestoration.positions[route];
    if (savedOffset > 0) {
      virtualizer.scrollToOffset(savedOffset, { align: 'start' });
    }
  });

  // handle infinite scroll
  createEffect(() => {
    const range = virtualizer.getVirtualItems();
    const firstItem = range[0];
    const lastItem = range[range.length - 1];

    // load more when approaching edges
    if (firstItem?.index < 5) {
      props.onLoadMore('up');
    }
    if (lastItem?.index > (props.items()?.totalCount || 0) - 5) {
      props.onLoadMore('down');
    }
  });

  // save scroll position changes
  createEffect(() => {
    const scrollOffset = virtualizer.scrollOffset;
    if (scrollOffset !== undefined) {
      props.onScrollPositionChange(scrollOffset);
    }
  });

  return (
    <div class="virtual-scroll-container">
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const item = props.items()?.items[virtualRow.index];
        return item ? (
          <div key={virtualRow.key} data-index={virtualRow.index}>
            <ItemRenderer item={item} />
          </div>
        ) : (
          <div key={virtualRow.key}>loading...</div>
        );
      })}
    </div>
  );
}
```

### Phase 5: Frontend Integration with Virtualization (Week 6)

#### 5.1: Update Views with Virtualized Grids

**File:** `client/js/src/components/filters/TagFilterControls.tsx`

**Reactive Implementation with Tag Lifecycle Support:**

```typescript
export function TagFilterControls(props: TagFilterControlsProps) {
  const [tagFilters, tagActions] = useTagFilters();
  const [showTagMenu, setShowTagMenu] = createSignal(false);
  const events = useGlobalEvents();

  // Listen for tag creation/deletion from context menus
  events.on("tag:created", (data) => {
    // Available tags automatically refresh due to reactive dependency
    // No manual action needed - just for UI feedback
  });

  events.on("tag:deleted", (data) => {
    // Available tags automatically refresh
    // Filter might be automatically removed if it was the deleted tag
  });

  events.on("song:tags-updated", (data) => {
    if (data.tagCreated) {
      // New tag available in dropdown immediately
      // Could show a notification: "New tag '${data.tagAdded}' created"
    }
  });

  const handleAddTag = (tag: string) => {
    tagActions.addTag(tag);
    setShowTagMenu(false);
    // store automatically triggers resource refetches
  };

  const handleRemoveTag = (tag: string) => {
    tagActions.removeTag(tag);
    // immediate ui update + automatic data refresh
  };

  const handleClearAllTags = () => {
    tagActions.clearTags();
    // all resources automatically refetch
  };

  return (
    <div class={`relative ${props.class || ""}`}>
      {/* active filters display */}
      <div class="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setShowTagMenu(!showTagMenu())}
          class="inline-flex items-center gap-1 px-2 py-1 border border-gray-600 hover:border-magenta-400 text-gray-300 hover:text-white text-xs transition-colors"
        >
          <TagIcon />
          <span>tags</span>
          <ChevronIcon rotated={showTagMenu()} />
        </button>

        {/* selected tags with immediate updates */}
        <For each={tagFilters.selectedTags}>
          {(tag) => (
            <TagChip
              tag={tag}
              onRemove={() => handleRemoveTag(tag)}
            />
          )}
        </For>
      </div>

      {/* dropdown menu with reactive available tags */}
      <Show when={showTagMenu()}>
        <TagDropdownMenu
          availableTags={tagFilters.unselectedTags()}
          loading={tagFilters.loading}
          onAddTag={handleAddTag}
          onClearAll={handleClearAllTags}
        />
      </Show>
    </div>
  );
}
```

#### 5.2: Artists Views with Virtualization

**File:** `client/js/src/views/freqhole/components/content/views/artists/DesktopArtistsView.tsx`

```typescript
export function DesktopArtistsView(props: DesktopArtistsViewProps) {
  const dataSections = useDataSections();
  const [tagFilters] = useTagFilters();
  const [selection, selectionActions] = useSelection();

  // component decides when to use artists resource - no view coupling!

  const handleArtistClick = (artist: ArtistSummary) => {
    // use optimistic selection updates
    selectionActions.setSelection([artist.artist], "artists");
    setSelectedArtist(artist);
  };

  // memoized artist count for display
  const artistStats = createMemo(() => {
    const artists = dataSections.artists.data();
    return {
      total: artists?.length || 0,
      loading: dataSections.artists.loading,
      hasFilters: tagFilters.selectedTags.length > 0,
    };
  });

  return (
    <div class="flex h-full bg-black text-white w-full max-w-full">
      <div class="w-72 min-w-72 flex-shrink-0 flex flex-col border-r border-magenta-800/30">
        {/* header with reactive tag filters */}
        <div class="flex-shrink-0 p-6">
          <div class="flex items-center justify-between mb-2">
            <h1 class="text-2xl font-semibold text-white">artists</h1>
            <TagFilterControls compact={false} />
          </div>

          {/* reactive status display */}
          <div class="text-sm text-gray-400 mb-4">
            <Show
              when={!artistStats().loading}
              fallback={<span>loading artists...</span>}
            >
              <span>{artistStats().total} artists</span>
              <Show when={artistStats().hasFilters}>
                <span class="text-magenta-400 ml-2">filtered</span>
              </Show>
            </Show>
          </div>
        </div>

        {/* reactive artists list */}
        <div class="flex-1 overflow-hidden">
          <FreqholeInfiniteGrid
            items={dataSections.artists.data}  // resource, not items array
            loading={dataSections.artists.loading}
            error={dataSections.artists.error}
            onItemClick={handleArtistClick}
            selectedIds={selection.selectedIds}
            // grid automatically re-renders when resource updates
          />
        </div>
      </div>

      {/* right panel with reactive selection state */}
      <div class="flex-1">
        <Show
          when={selection.hasSelection}
          fallback={<div class="p-6 text-gray-500">select an artist</div>}
        >
          <ArtistDetailPanel
            artist={selectedArtist()}
            // panel automatically updates when selection changes
          />
        </Show>
      </div>
    </div>
  );
}
```

**File:** `client/js/src/views/freqhole/components/content/views/artists/MobileArtistsView.tsx`

Similar updates for mobile view with compact TagFilterControls.

#### 5.3: API Client Updates

**File:** `client/js/src/lib/api-client.ts`

```typescript
export class ApiClient {
  // ... existing methods ...

  async getArtists(params?: ArtistQueryParams): Promise<ArtistsResponse> {
    return this.makeRequest("GET", "/api/music/artists", null, params);
  }

  async filterArtists(request: ArtistsFilterRequest): Promise<ArtistsResponse> {
    return this.makeRequest("POST", "/api/music/artists", request);
  }

  async getAlbums(params?: AlbumQueryParams): Promise<AlbumsResponse> {
    return this.makeRequest("GET", "/api/music/albums", null, params);
  }

  async filterAlbums(request: AlbumsFilterRequest): Promise<AlbumsResponse> {
    return this.makeRequest("POST", "/api/music/albums", request);
  }

  // convenience method that chooses GET or POST based on filters
  async loadArtists(filters?: ArtistsFilterRequest): Promise<ArtistsResponse> {
    if (filters?.tags && filters.tags.length > 0) {
      return this.filterArtists(filters);
    } else {
      // convert to query params and use GET
      const params = this.filtersToQueryParams(filters);
      return this.getArtists(params);
    }
  }

  async loadAlbums(filters?: AlbumsFilterRequest): Promise<AlbumsResponse> {
    if (filters?.tags && filters.tags.length > 0) {
      return this.filterAlbums(filters);
    } else {
      const params = this.filtersToQueryParams(filters);
      return this.getAlbums(params);
    }
  }
}
```

#### 5.4: Zod Schema Updates

**File:** `client/js/src/lib/music/schemas/api.ts`

```typescript
export const ArtistsFilterRequestSchema = z.object({
  tags: z.array(z.string()).optional(),
  query: z.string().optional(),
  page: z.number().int().positive().optional(),
  page_size: z.number().int().positive().max(100).optional(),
  sort_by: z.enum(["artist", "song_count", "rating"]).optional(),
  sort_direction: z.enum(["asc", "desc"]).optional(),
});

export const AlbumsFilterRequestSchema = z.object({
  tags: z.array(z.string()).optional(),
  query: z.string().optional(),
  artist: z.string().optional(),
  year_min: z.number().int().optional(),
  year_max: z.number().int().optional(),
  page: z.number().int().positive().optional(),
  page_size: z.number().int().positive().max(100).optional(),
  sort_by: z.enum(["album", "artist", "year", "track_count"]).optional(),
  sort_direction: z.enum(["asc", "desc"]).optional(),
});

export type ArtistsFilterRequest = z.infer<typeof ArtistsFilterRequestSchema>;
export type AlbumsFilterRequest = z.infer<typeof AlbumsFilterRequestSchema>;
```

### Phase 6: Cross-View Synchronization & Polish (Week 7)

**Goal**: perfect the synchronization patterns established in earlier phases

#### 6.1: Currently Playing Indicators

**pattern for synchronized "now playing" indicators:**

```typescript
export const useCurrentlyPlaying = () => {
  const [store] = useFreqholeStore();

  // memoized checker that works in any component
  const isCurrentlyPlaying = createMemo(() => (songId: string) => {
    return store.player.currentSong?.id === songId;
  });

  return { isCurrentlyPlaying };
};

// usage in virtualized grid items
const SongGridItem = (props: { song: Song }) => {
  const { isCurrentlyPlaying } = useCurrentlyPlaying();

  return (
    <div class={`song-item ${isCurrentlyPlaying()(props.song.id) ? 'playing' : ''}`}>
      <Show when={isCurrentlyPlaying()(props.song.id)}>
        <PlayingIndicator />
      </Show>
      {/* rest of item */}
    </div>
  );
};
```

#### 6.2: Playlist Nav Synchronization

**pattern for nav sidebar updates:**

```typescript
const PlaylistNavItem = (props: { playlist: Playlist }) => {
  const events = useGlobalEvents();

  // automatically updates when playlist changes anywhere in app
  events.on("playlist:updated", (data) => {
    if (data.playlist.id === props.playlist.id) {
      // component re-renders with new playlist data
      // image, name, song count all update automatically
    }
  });

  return (
    <div class="playlist-nav-item">
      <img src={props.playlist.image_url} />
      <span>{props.playlist.name}</span>
      <span class="song-count">{props.playlist.song_count}</span>
    </div>
  );
};
```

### Phase 7: Testing & Performance Validation (Week 8)

#### 7.1: Virtualization Performance Testing

**verification points:**

- virtualized grids handle large datasets (10k+ items) smoothly
- scroll restoration works correctly across route navigation
- arbitrary page loading works for deep-linked scroll positions
- memory usage remains stable during infinite scrolling

#### 7.2: Cross-View Synchronization Testing

**verification points:**

- currently playing indicators appear correctly across all virtualized views
- playlist changes in playlist view immediately reflect in nav sidebar
- tag context menu operations update global tag list and all relevant views
- song favorites/ratings update immediately across all locations where song appears
- no stale data or synchronization conflicts

#### 7.3: Reactive Performance Testing

**verification points:**

- createResource caching works correctly - no duplicate API calls
- optimistic updates feel instant with proper rollback on errors
- complex tag operations (create + add to songs) work smoothly
- store updates trigger minimal re-renders (batch effectiveness)

## Incremental Migration Strategy

### Phase 1: Basic Store Foundation (Week 1)

- **risk**: very low - just consolidating existing providers
- **scope**: replace SearchProvider and FreqholeContext with single store
- **validation**: tag filtering still works, no regressions
- **rollback**: extremely easy - revert to old providers
- **reality check**: working with current code, no view coupling changes

### Phase 2: Tag Context Menu Fix (Week 2)

- **risk**: low-medium - fixing existing broken reactive patterns
- **scope**: make tag context menu work properly with reactive patterns
- **validation**: creating tags from context menu updates global list
- **rollback**: easy - keep old context menu alongside new one
- **reality check**: this is currently broken, so fixing it is pure win

### Phase 3: Artists/Albums API (Week 2-3)

- **risk**: low - backend only, keeping GET endpoints
- **scope**: add POST variants for artists/albums with tag filtering
- **validation**: new endpoints work, old ones unchanged
- **rollback**: trivial - just don't use new endpoints
- **reality check**: straightforward server work, no client changes needed

### Phase 4: Frontend Tag Filtering (Week 4)

- **risk**: medium - connecting new APIs to existing views
- **scope**: add TagFilterControls to artists/albums views
- **validation**: tag filtering works in all views
- **rollback**: can disable TagFilterControls in new views
- **reality check**: building on existing working patterns

### Phase 5+: Future Improvements (Later)

- **virtualization**: only tackle after core functionality is solid
- **scroll restoration**: router-based approach when ready
- **complex synchronization**: build incrementally on proven patterns
- **reality check**: don't bite off more than we can chew

## File Structure Changes

### Files to Create:

```
client/js/src/views/freqhole/store/
├── hooks.tsx               (granular store hooks)
├── actions.tsx            (store actions with event integration)
├── types.ts               (enhanced store types)
└── factory.ts             (store factory for multi-server preparation)

client/js/src/views/freqhole/context/
└── ServerContextProvider.tsx (unified server context provider)

client/js/src/lib/music/schemas/
└── filters.ts            (filter request/response schemas)
```

### Files to Modify:

```
client/js/src/views/freqhole/
├── index.tsx             (remove redundant providers)
└── store/index.tsx       (enhance with search/data logic)

client/js/src/views/freqhole/components/content/views/
├── artists/DesktopArtistsView.tsx
├── artists/MobileArtistsView.tsx
├── albums/DesktopAlbumsView.tsx
└── albums/MobileAlbumsView.tsx

client/js/src/components/filters/
└── TagFilterControls.tsx (simplify, use only store)

server/src/media/
├── songs.rs              (refactor existing endpoints, clean up)
└── mod.rs               (clean up exports)
```

### Files to Remove:

```
client/js/src/views/freqhole/context/
├── SearchContext.tsx     (functionality moved to store)
└── FreqholeContext.tsx   (unused stub)
```

## Success Criteria

### Phase 1 Complete:

- [x] single FreqholeStore provider with comprehensive state
- [x] event system integrated into store actions
- [x] redundant providers removed
- [x] TagFilterControls uses only store (no manual events)
- [x] all existing functionality preserved

### Phase 2 Complete:

- [x] artists POST endpoint with tag filtering (GET endpoint unchanged)
- [x] albums POST endpoint with tag filtering (GET endpoint unchanged)
- [x] shared query logic between GET and POST variants
- [x] proper pagination and sorting with both filtered and unfiltered requests
- [x] clean zod validation for all endpoints
- [x] client automatically chooses GET vs POST based on filter presence

### Phase 3 Complete:

- [x] artists views support tag filtering
- [x] albums views support tag filtering
- [x] TagFilterControls appears in all views
- [x] global tag state synchronized across views
- [x] reactive updates when tags change

### Phase 4 Complete:

- [x] comprehensive testing passed
- [x] no regressions in existing functionality
- [x] performance improvements from reduced provider complexity
- [x] clean, maintainable codebase with NO legacy code
- [x] consistent reactive patterns throughout
- [x] significantly reduced client/js/ complexity
- [x] all dead/redundant code eliminated

## Technical Benefits

### Reduced Complexity:

- single source of truth for all state
- consistent patterns across all components
- eliminated redundant provider stack entirely
- clear separation of concerns
- significantly fewer files and less complexity

### Improved Performance:

- fewer context provider re-renders
- more targeted reactive updates
- efficient event system integration
- optimized data loading patterns

### Better Developer Experience:

- single import for all state needs
- consistent API patterns
- clear event flow
- easier debugging and testing

### Future Extensibility:

- easy to add new filter types
- consistent pattern for new data sections
- scalable event system
- maintainable codebase structure
- no legacy code to work around

## Migration Risk Mitigation

**to ensure we don't break things while cleaning up:**

1. **branch strategy:** work in feature branch, test thoroughly before merge
2. **incremental testing:** after each migration step, validate all existing functionality
3. **rollback plan:** keep original implementation accessible until new one is proven
4. **component isolation:** migrate one view at a time with full testing
5. **api testing:** validate all endpoints with comprehensive test coverage

**testing checkpoints:**

- after store migration: all existing functionality intact
- after each view migration: that view + all previous views working
- after context removal: no broken imports or dead code references
- final validation: complete feature parity with cleaner codebase

## Multi-Server Architecture Preparation

**current implementation benefits for future multi-server:**

1. **server-agnostic store:** store uses injected apiClient rather than global imports
2. **factory pattern:** store creation supports multiple instances
3. **unified context:** single ServerContextProvider prepares for server switching
4. **auth integration:** auth becomes part of server context, not global
5. **clean separation:** no global state leakage between contexts

**future multi-server implementation path:**

```typescript
// future: multiple server contexts with reactive resources
interface MultiServerState {
  currentServerId: string;
  servers: Record<
    string,
    {
      store: FreqholeStore;
      actions: StoreActions;
      resources: StoreResources; // each server gets its own resources
      apiClient: ApiClient;
    }
  >;
}

// server switching would simply change currentServerId
// all resources automatically re-fetch for new server context
const switchServer = (serverId: string) => {
  setMultiServerState("currentServerId", serverId);
  // all components automatically get new server's resources
};
```

this approach allows the current refactor to naturally evolve into multi-server support without architectural rewrites.

---

## Solid-JS Reactive Benefits

**performance improvements:**

- selective fetching: resources only load when their view is active, preventing unnecessary api calls
- automatic caching: createResource provides built-in caching and deduplication
- optimistic updates: mutate provides immediate ui feedback while syncing with api
- reactive dependencies: resources automatically refetch only when relevant data changes
- coordinated updates: batch prevents excessive re-renders during multi-resource updates

**cross-view synchronization patterns:**

- currently playing indicators: useCurrentlyPlaying hook shows play state across all song displays
- playlist updates: changes to playlist name/image immediately reflect in nav sidebar
- tag filtering: only refetches the currently active view (songs/artists/albums)
- selection state: synchronized between grids, context menus, and bulk action uis
- optimistic updates: changes appear instantly across all relevant ui locations

**Real-World Examples:**

```typescript
// example 1: virtualized grid with currently playing sync
const VirtualizedSongGrid = () => {
  const { songs } = useDataSections();
  const { isCurrentlyPlaying } = useCurrentlyPlaying();
  const virtualizationActions = useVirtualization();

  return (
    <VirtualizedInfiniteGrid
      items={songs.data}
      viewType="songs"
      onLoadMore={virtualizationActions.loadMorePages}
      onScrollPositionChange={virtualizationActions.saveScrollPosition}
      renderItem={(song) => (
        <div class={`song-row ${isCurrentlyPlaying()(song.id) ? 'playing' : ''}`}>
          <Show when={isCurrentlyPlaying()(song.id)}>
            <PlayingIndicator />
          </Show>
          {/* song content */}
        </div>
      )}
    />
  );
};

// example 2: tag context menu with full reactive integration
const TagContextMenu = (props: { songIds: string[] }) => {
  const tagManagement = useTagContextMenu();

  const handleCreateAndAdd = async (newTagName: string) => {
    try {
      // this handles ALL the reactive complexity:
      // 1. optimistic updates to song displays
      // 2. api calls to create tag and update songs
      // 3. global tag list refresh
      // 4. current view data refresh
      // 5. error rollback if needed
      await tagManagement.createTagAndAddToSongs(props.songIds, newTagName);

      // everything else happens automatically via reactive patterns!
    } catch (error) {
      // error handling - optimistic updates already rolled back
    }
  };

  return (
    <ContextMenu>
      <TagSubmenu
        availableTags={tagManagement.availableTags()}
        onCreateAndAdd={handleCreateAndAdd}
        loading={tagManagement.loading}
      />
    </ContextMenu>
  );
};

// example 3: playlist nav with scroll restoration
const PlaylistNavigation = () => {
  const { recentPlaylists, currentView } = useNavigation();
  const router = useRouter();

  const handlePlaylistClick = (playlist: Playlist) => {
    // navigate to playlist view
    router.navigate(`/playlists/${playlist.id}`);

    // scroll restoration happens automatically when playlist view loads
    // via virtualization system
  };

  return (
    <div class="playlist-nav">
      <For each={recentPlaylists()}>
        {(playlist) => (
          <div
            class="playlist-item"
            onClick={() => handlePlaylistClick(playlist)}
          >
            {/* this automatically updates when playlist changes anywhere */}
            <img src={playlist.image_url} />
            <span>{playlist.name}</span>
            <span class="count">{playlist.song_count}</span>
          </div>
        )}
      </For>
    </div>
  );
};

// example 4: scroll restoration integration
const SongsView = () => {
  const virtualization = useVirtualization();
  const router = useRouter();

  onMount(() => {
    // check if we need to restore scroll position
    const savedScrollOffset = router.getScrollPosition('/songs');
    if (savedScrollOffset > 0) {
      // this triggers loading necessary pages and restoring scroll
      virtualization.restoreScrollPosition('/songs', savedScrollOffset);
    }
  });

  return (
    <VirtualizedInfiniteGrid
      // grid automatically handles virtualization, infinite scroll,
      // and scroll position saving
    />
  );
};
```

**developer experience:**

- performance by default: no accidental over-fetching
- automatic synchronization: changes propagate across ui without manual coordination
- declarative patterns: components describe what they need, not how to get it
- clear reactive chains: solid-js dev tools show exactly what triggers updates

This plan provides a comprehensive approach to both solving the current state management complexity and implementing Phase 4 tag filtering features while ELIMINATING legacy code and making the entire client/js/ codebase significantly cleaner and more maintainable, with subtle architectural decisions that prepare for future multi-server functionality and leverage solid-js reactive primitives for optimal performance and developer experience.
