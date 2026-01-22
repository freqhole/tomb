# cache mutation architecture

## overview

this document describes the centralized cache mutation system for handling entity updates (favorites, ratings, edits, etc.) across the app.

## problem statement

in a solid-router app, components don't unmount on navigation, so traditional react-style lifecycle management doesn't work well. when a song is favorited, rated, or edited, we need to:

1. **update the UI instantly** (optimistic updates)
2. **update all places showing that entity** (songs table, queue, player bar, album details, etc.)
3. **avoid unnecessary network requests** (don't refetch everything)
4. **handle errors gracefully** (rollback on failure)

## architecture

### 1. centralized query keys (`queries/queryKeys.ts`)

all tanstack query keys are defined in one place using factory functions:

```typescript
export const queryKeys = {
  songs: {
    all: ["songs"] as const,
    infinite: (params) => [...queryKeys.songs.all, "infinite", ...params],
    detail: (id) => [...queryKeys.songs.all, id],
  },
  // ... more entities
}
```

**benefits:**
- no string typos
- type-safe
- easy to refactor
- hierarchical invalidation (invalidate all songs queries at once)

### 2. centralized cache updates (`queries/cacheUpdates.ts`)

helper functions that update an entity across ALL query caches where it might appear:

```typescript
updateSongInCache(queryClient, songId, sha256, { is_favorite: true });
updateAlbumInCache(queryClient, albumId, { is_favorite: true });
// etc.
```

these functions:
- search all relevant queries (infinite lists, detail views, nested song lists, etc.)
- update the entity in place using `setQueryData`
- preserve other query state (pagination, etc.)

**benefits:**
- one function call updates everything
- consistent update logic
- easy to add new cacheable fields

### 3. optimistic mutations (`queries/favorites.ts`)

mutations use tanstack query's optimistic update pattern:

```typescript
createMutation(() => ({
  mutationFn: async (params) => {
    // API call
  },
  onMutate: async (variables) => {
    // cancel outgoing refetches
    // update cache optimistically
    // return rollback context
  },
  onError: (error, variables, context) => {
    // invalidate to rollback
  },
  onSuccess: () => {
    // no invalidation needed - already updated!
  },
}))
```

**benefits:**
- instant UI updates
- no loading spinners for simple mutations
- automatic rollback on error
- minimal network traffic

### 4. live entity hooks (`hooks/useEnrichedSong.ts`)

components rendering entities use reactive hooks that automatically track cache changes:

```typescript
const liveSong = useLiveSong(() => someSong);
const liveSongs = useLiveSongs(() => queueSongs);
```

these hooks:
- search the query cache for the latest version of the entity
- merge cached fields (`is_favorite`, `user_rating`, etc.) with the provided object
- return a reactive accessor that updates when the cache changes

**benefits:**
- queue songs always show latest favorite status
- player bar always shows latest metadata
- no manual subscriptions needed
- works with persisted/stale data (queue from indexeddb)

## data flow

### example: toggling a favorite

1. **user clicks heart icon** in songs table
2. **mutation is called** with `{ targetType: "song", targetId, sha256, isFavorite: true }`
3. **`onMutate` runs immediately:**
   - cancels any in-flight song queries
   - calls `updateSongInCache()` to update everywhere
   - UI updates instantly (heart fills in)
4. **`mutationFn` sends API request** in background
5. **on success:**
   - shows success toast
   - no query invalidation needed (already updated!)
6. **on error:**
   - shows error toast
   - invalidates song queries (refetches to rollback)
   - heart unfills

### entity appears in multiple places

when a song is rendered in:
- **songs table**: uses `songsQuery.data` → automatically reactive via tanstack query
- **queue sidebar**: uses `useLiveSongs(queue)` → searches cache for each song
- **player bar**: uses `useLiveSong(currentSong)` → searches cache
- **album detail view**: uses `albumSongsQuery.data` → automatically reactive

**all update instantly** when `updateSongInCache()` runs during `onMutate`.

## adding new mutations

### for simple field updates (favorites, ratings):

1. **update the entity type** to include the field (e.g., `is_favorite?: boolean`)
2. **update cache helper** if needed (usually already covered)
3. **create mutation hook** using the optimistic pattern:
   ```typescript
   onMutate: async (variables) => {
     await queryClient.cancelQueries({ queryKey: [entityType + "s"] });
     updateEntityInCache(queryClient, id, updates);
   }
   ```
4. **call mutation** from context menus/buttons with required params

### for complex edits (song metadata, images):

same pattern, but:
- update more fields in `onMutate`
- may need to invalidate specific queries if computed fields change
- may need to update thumbnails/images separately

## performance considerations

### what we avoid:
- ❌ invalidating all queries on every mutation (causes unnecessary refetches)
- ❌ fetching songs from API when rendering queue (uses persisted data + live enrichment)
- ❌ re-rendering entire lists when one item changes (solid's fine-grained reactivity)
- ❌ multiple queries for the same song (query cache deduplication)

### what we do:
- ✅ optimistic updates (instant UI, no loading states)
- ✅ surgical cache updates (only touch affected entities)
- ✅ query deduplication (tanstack query handles this)
- ✅ stale-while-revalidate (queries have `staleTime` set)
- ✅ lazy cache lookups (only search cache when rendering entity)

### query lifecycle in solid-router:

- components **don't unmount** on navigation
- queries **stay active** as long as component is mounted
- use `staleTime` and `gcTime` to control refetch behavior:
  ```typescript
  staleTime: 5 * 60 * 1000,  // don't refetch for 5 min
  gcTime: 10 * 60 * 1000,     // keep in cache for 10 min
  refetchOnMount: false,      // don't refetch on remount
  refetchOnWindowFocus: false // don't refetch on focus
  ```

## debugging

### check if cache is updating:

```typescript
// in browser console
window.$app.queryClient.getQueryData(["songs", "infinite", ...]);
```

### check if mutation ran:

- look for success/error toast
- check network tab for API call
- check console for mutation logs

### check if component is using live data:

- add `console.log(liveSong())` in component
- toggle favorite and see if log updates

## future extensions

### planned mutation types:
- **ratings** - similar to favorites, uses `user_rating` field
- **song edits** - title, artist, album, year, etc.
- **album art changes** - update `thumbnail_blob_id` + invalidate blob cache
- **bulk operations** - multiple entities at once
- **tags** - add/remove tags from songs/albums

### architectural notes:
- all follow the same pattern (optimistic + cache update)
- tag mutations might need a separate cache for tag lists
- bulk operations should show progress/partial success
- image updates might need special handling for blob URLs

## code style

all comments, docstrings, and user-facing strings use lowercase, conversational prose:

```typescript
// ✅ good
// updates a song across all query caches where it might appear
const updateSong = () => { /* ... */ }

// ❌ bad
// Updates A Song Across All Query Caches Where It Might Appear
const updateSong = () => { /* ... */ }
```

exceptions: acronyms (API, HTTP, JSON), proper nouns (SolidJS, TypeScript), code identifiers, special markers (TODO, FIXME).
