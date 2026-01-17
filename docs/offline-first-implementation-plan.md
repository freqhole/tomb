# offline-first implementation plan

## goals

build a hybrid offline/remote music app where:
- users browse remote servers (ephemeral, no local storage)
- users download content for offline (stored in indexeddb + OPFS)
- users add local files (read directly from disk, no copy needed)
- app works offline with downloaded/local content

## phase 1: real app skeleton (current focus)

### 1.1 empty state & onboarding

**goal:** user opens app for first time, sees helpful empty state

files to create:
- `tomb/client/js-v2/src/App.tsx` - main app entry
- `tomb/client/js-v2/src/components/EmptyState.tsx` - friendly "get started" screen
- `tomb/client/js-v2/src/components/AddServerForm.tsx` - text input + validate + auth flow

app states:
- **no servers configured** → show "add your first server" empty state
- **server configured** → show library (like SuperStory)
- **no internet + no downloads** → show "you're offline, download music to listen"

### 1.2 basic routing

use solid-router for navigation:
- `/` - home (empty state or library)
- `/settings` - manage servers, preferences
- `/downloads` - view offline content
- `/local` - local files added by user

keep it simple - defer complex nested routes for now

### 1.3 vite build setup

ensure tomb/client/js-v2 has proper vite config:
- dev server with HMR
- production build
- use same storybook design system/components
- import components from `tomb/client/storybook/src/components/`

## phase 2: indexeddb schema & store

### 2.1 minimal idb schema

three stores (keep it simple):

```typescript
// store 1: app_state (single row)
{
  id: "singleton",
  current_song_id: string | null,
  queue: string[],
  volume: number,
  active_server_id: string | null,
}

// store 2: servers
{
  id: string,
  name: string,
  url: string,
  auth_token: string,
  is_home: boolean,
}

// store 3: offline_songs (downloaded content)
{
  id: string, // composite: server_id:song_id
  song: Song, // full song metadata
  file_path: string, // OPFS path
  downloaded_at: number,
  file_size: number,
}
```

use simple wrapper lib (dexie.js or idb-keyval) - don't hand-roll indexeddb

### 2.2 OPFS for audio files

store actual audio blobs in OPFS (origin private file system):
- path structure: `/audio/{server_id}/{song_id}.{ext}`
- indexeddb stores metadata + path reference
- when playing downloaded song, read from OPFS

why OPFS not cache api:
- cache api can be evicted by browser
- OPFS is more persistent
- better for large files

## phase 3: tanstack query integration

### 3.1 query setup

wrap remote api calls with tanstack query:
- automatic caching (in-memory, session-scoped)
- request deduplication
- background refetch
- loading/error states

example query:
```typescript
const albumQuery = createQuery(() => ({
  queryKey: ["albums", albumId],
  queryFn: () => apiClient.getAlbum(albumId),
  staleTime: 5 * 60 * 1000, // 5 min
}));
```

### 3.2 infinite scroll with tanstack query

use `createInfiniteQuery` for paginated lists:
- songs list (50 items per page)
- albums grid (20 items per page)
- artists list (30 items per page)

hook into VirtualSongList/VirtualAlbumGrid:
- fetch next page when user scrolls near end
- append to virtual list seamlessly

### 3.3 offline query fallback

when offline + content downloaded:
- query key remains same: `["albums", albumId]`
- queryFn checks: is server reachable?
  - yes → fetch from server
  - no → check indexeddb for downloaded copy
- component doesn't care about source

## phase 4: download flow

### 4.1 download button/action

add download UI to:
- song rows (download single)
- album cards (download all songs)
- playlist views (download all songs)

download flow:
1. user clicks download
2. queue download(s) in indexeddb
3. background worker fetches audio + metadata
4. save blob to OPFS
5. save metadata to indexeddb
6. update UI (show "downloaded" badge)

### 4.2 download manager

simple component to show:
- current downloads (progress bar)
- queued downloads
- cancel/pause options

defer: retry logic, resume failed downloads (add later)

## phase 5: local files

### 5.1 file picker

use native file input:
- user picks .mp3, .flac, .m4a files
- read file metadata (id3 tags)
- add to local library (no copy - keep file handle)

### 5.2 local library store

separate indexeddb store:
```typescript
{
  id: string,
  file_handle: FileSystemFileHandle, // native api
  song: Song, // parsed metadata
  added_at: number,
}
```

when playing local file:
- use file handle to read blob
- create object URL
- pass to audio element

## non-goals (defer for later)

- **sync pending changes** - no editing metadata offline then syncing back
- **multi-server sync** - each server is independent
- **playlists offline** - just songs/albums for now
- **lyrics storage** - fetch on-demand only
- **smart download** - no auto-download based on listening habits (yet)
- **storage management UI** - basic delete only, no quotas/limits shown

## next immediate steps

1. create tomb/client/js-v2/src/App.tsx with empty state
2. add AddServerForm component (text input + validate button)
3. setup basic indexeddb wrapper (dexie or idb-keyval)
4. wire up tanstack query provider
5. create simple "connected to server" view that reuses SuperStory components

keep iterating - this plan will evolve as we build!
