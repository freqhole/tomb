# 📋 IndexedDB Persistence Planning

### Dexie.js Integration Strategy

**Core Requirements:**

- Persist queue state (current song, queue items, history)
- Persist player state (volume, shuffle, repeat, playback position)
- Real-time synchronization between tabs using liveQuery
- Graceful fallback when IndexedDB unavailable

**Database Schema Design:**

```typescript
// Dexie schema
interface PlayerState {
  id: "current"; // Single row
  currentSong: Song | null;
  isPlaying: boolean;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  currentTime: number;
  lastUpdated: Date;
}

interface QueueState {
  id: "current"; // Single row
  items: Song[];
  currentIndex: number;
  history: Song[];
  lastUpdated: Date;
}

interface AppSettings {
  id: string;
  value: any;
  lastUpdated: Date;
}
```

**Implementation Plan:**

1. **Setup Phase**: Install Dexie.js, create database schema, migration handling
2. **Store Integration**: Create `usePersistentStore()` hook that wraps Solid Store
3. **LiveQuery Integration**: Use `liveQuery()` to sync state between tabs automatically
4. **Selective Persistence**: Only persist essential state (not UI state like modals)
5. **Performance**: Debounce writes (especially currentTime updates)
6. **Error Handling**: Graceful degradation when IndexedDB unavailable

**Key Files to Create:**

- `client/js/src/views/freqhole/services/persistence.ts` - Database setup and operations
- `client/js/src/views/freqhole/hooks/usePersistentQueue.ts` - Queue persistence hook
- `client/js/src/views/freqhole/utils/queueStorage.ts` - Queue storage utilities and fallbacks
- `client/js/src/views/freqhole/components/QueueHistoryView.tsx` - Enhanced queue component with history

**Research Questions:**

- How to handle liveQuery with SolidJS reactivity system? (see example code below)
- Should we persist full queue or just queue metadata + rebuild from API?
- How to handle schema migrations for future updates?
- Performance impact of frequent currentTime updates?

## 🎵 Queue Persistence Implementation Plan

### Phase 1: Database Schema & Basic Persistence

**Enhanced Database Schema:**

```typescript
interface QueueState {
  id: "current"; // Single row
  currentItems: QueueItem[];
  currentIndex: number;
  historyItems: QueueItem[]; // Up to 100 historical songs
  lastUpdated: Date;
}

interface QueueItem {
  id: string;
  song: Song;
  addedAt: Date;
  playedAt?: Date; // When song finished playing
  source?: "search" | "album" | "artist" | "playlist"; // How it was added
}
```

**Implementation Steps:**

1. Update existing `store/index.tsx` to include history in queue state
2. Create `services/persistence.ts` with Dexie setup
3. Create `hooks/usePersistentQueue.ts` to wrap queue operations
4. Integrate with existing queue actions in store

### Phase 2: Queue History Management

**History Logic:**

- When song finishes playing naturally OR is skipped by user, move to history
- When queue is cleared, current items don't go to history
- When individual songs are manually removed/deleted, they don't go to history
- History maintains max 100 items (FIFO)
- History persists across browser sessions

**Queue State Management:**

```typescript
interface EnhancedQueueState {
  currentItems: QueueItem[];
  currentIndex: number;
  historyItems: QueueItem[]; // Most recent first
  maxHistorySize: number; // 100
}

// Actions to add:
const queueActions = {
  // Existing actions...
  moveCurrentToHistory: (item: QueueItem) => {
    /* Add to history, remove from current */
  },
  clearHistory: () => {
    /* Clear history only */
  },
  replayFromHistory: (item: QueueItem, position: "now" | "next" | "end") => {
    /* Keep in history, add to current queue at specified position */
  },

  // Enhanced clear - doesn't move to history
  clearCurrentQueue: () => {
    /* Clear current without history */
  },

  // Natural progression - moves completed/skipped songs to history
  advanceToNext: (reason: "finished" | "skipped") => {
    /* Move current to history, advance index */
  },
};
```

### Phase 3: Advanced UI - Reverse Scroll History

**UI Architecture:**

- Current queue shows normally (playing song at top, rest below)
- History shows above current queue when scrolling up
- Implement "reverse scroll" behavior using scroll position manipulation
- Use virtual scrolling for performance with large history

**Scroll Implementation Strategy:**

```typescript
// Custom scroll container that handles reverse direction
const QueueHistoryScroll = () => {
  const [scrollContainer, setScrollContainer] = createSignal<HTMLElement>();
  const [showHistory, setShowHistory] = createSignal(false);

  // Detect upward scroll to show history
  const handleScroll = (e: Event) => {
    const target = e.target as HTMLElement;
    const atTop = target.scrollTop === 0;
    const scrollingUp = target.scrollTop < lastScrollTop();

    if (atTop && scrollingUp) {
      setShowHistory(true);
      // Implement scroll magic here
    }
  };

  // Reverse scroll implementation
  const implementReverseScroll = () => {
    // When showing history, we need to:
    // 1. Render history items in reverse order (most recent first)
    // 2. Adjust scroll position to maintain visual continuity
    // 3. Handle scroll events to navigate through history
  };
};
```

**Visual Layout:**

```
[History Items] ← Revealed when scrolling up
[--- History Divider ---]
[Currently Playing] ← Fixed at container top
[Next in Queue]
[Queue Item 2]
[Queue Item 3]
...
```

### Phase 4: Drag & Drop Reordering

**Drag & Drop for Current Queue:**
Based on existing playlist drag/drop implementation, adapt for queue:

```typescript
// Reuse patterns from PlaylistDetailView.tsx
const QueueDragDrop = () => {
  const [draggedIndex, setDraggedIndex] = createSignal<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = createSignal<number | null>(null);

  const handleDragStart = (e: DragEvent, index: number) => {
    // Only allow dragging current queue items (not history)
    if (index < 0) return; // History items have negative indices
    setDraggedIndex(index);
    e.dataTransfer?.setData("text/plain", index.toString());
  };

  const handleDrop = async (e: DragEvent, dropIndex: number) => {
    e.preventDefault();
    const dragIndex = draggedIndex();

    if (dragIndex === null || dragIndex === dropIndex) return;

    // Reorder current queue items
    const currentItems = queue.currentItems;
    const reorderedItems = [...currentItems];
    const draggedItem = reorderedItems[dragIndex];

    reorderedItems.splice(dragIndex, 1);
    reorderedItems.splice(dropIndex, 0, draggedItem);

    // Update queue state and persist
    await updateQueueOrder(reorderedItems);
  };
};
```

**Drag & Drop Constraints:**

- Only current queue items can be dragged
- History items are read-only (can be replayed, not reordered)
- Currently playing song cannot be dragged
- Visual feedback shows valid drop zones

### Phase 5: Integration Points

**Store Integration:**

```typescript
// Enhanced store actions
const enhancedQueueActions = {
  // Existing actions...

  // History-aware actions
  playNextSong: async () => {
    const current = getCurrentSong();
    if (current) {
      await moveToHistory(current);
    }
    // Continue with normal next song logic
  },

  // Drag & drop support
  reorderQueue: async (newOrder: QueueItem[]) => {
    setStore("queue", "currentItems", newOrder);
    await persistQueue();
  },

  // History management
  clearHistoryOnly: async () => {
    setStore("queue", "historyItems", []);
    await persistQueue();
  },

  replayFromHistory: async (
    item: QueueItem,
    position: "now" | "next" | "end" = "end",
  ) => {
    // Keep in history, add to current queue at specified position
    let currentItems = [...store.queue.currentItems];

    switch (position) {
      case "now":
        // Play immediately, pause current song
        currentItems = [item, ...currentItems];
        setStore("queue", "currentIndex", 0);
        break;
      case "next":
        // Insert after currently playing song
        const nextIndex = store.queue.currentIndex + 1;
        currentItems.splice(nextIndex, 0, item);
        break;
      case "end":
        // Add to end of queue
        currentItems.push(item);
        break;
    }

    setStore("queue", { currentItems });
    await persistQueue();
  },
};
```

**Component Structure:**

```
QueuePanel/
├── QueueHeader.tsx (controls, clear buttons)
├── QueueHistoryView.tsx (history items, reverse scroll)
├── QueueCurrentView.tsx (current queue, drag/drop)
├── QueueItem.tsx (individual item component)
└── QueueScrollContainer.tsx (scroll magic implementation)
```

**Performance Considerations:**

- Virtual scrolling for large history (100+ items)
- Debounced persistence (don't persist every scroll)
- Efficient drag/drop with minimal re-renders
- History items lazy-loaded/virtualized

### Phase 6: Testing & Edge Cases

**Edge Cases to Handle:**

1. Browser refresh during drag operation
2. IndexedDB unavailable (fallback to memory)
3. Concurrent tab operations on queue
4. Very long history (performance)
5. Song metadata changes (update history items)
6. Network interruptions during persistence

**Testing Strategy:**

- Unit tests for queue logic
- Integration tests for persistence
- UI tests for drag/drop behavior
- Performance tests with large datasets
- Cross-browser compatibility testing

This implementation provides a robust foundation for queue persistence while maintaining the existing UI patterns and adding the advanced features you requested.

**liveQuery solid-js integration**

here's some working code for using dexie's liveQuery with solid-js

```ts
// mostly ripped from https://github.com/faassen/solid-dexie/blob/main/src/solid-dexie.ts
import {
  from,
  Accessor,
  createMemo,
  createEffect,
  on,
  onCleanup,
} from "solid-js";
import { createStore, reconcile, SetStoreFunction } from "solid-js/store";
import { liveQuery, PromiseExtended } from "dexie";

type ReconcileOptions = Parameters<typeof reconcile>[1];

type NotArray<T> = T extends any[] ? never : T;

export function createLiveQuery<T>(
  querier: () => NotArray<T> | PromiseExtended<NotArray<T>>,
): Accessor<T | undefined> {
  const get = createMemo(() => from<T>(liveQuery(querier)));
  return () => get()();
}

export function createArrayLiveQuery<T>(
  querier: () => T[] | Promise<T[]>,
): T[] {
  const [store, setStore] = createStore<T[]>([]);

  createEffect(
    on(querier, () => {
      fromReconcileStore<T[]>(liveQuery(querier), store, setStore);
    }),
  );

  return store;
}

function fromReconcileStore<T>(
  producer: {
    subscribe: (
      fn: (v: T) => void,
    ) => (() => void) | { unsubscribe: () => void };
  },
  store: T,
  setStore: SetStoreFunction<T>,
  options: ReconcileOptions = { key: "id" },
): T {
  const unsub = producer.subscribe((v) => setStore(reconcile(v, options)));
  onCleanup(() => ("unsubscribe" in unsub ? unsub.unsubscribe() : unsub()));
  return store;
}
```

then db repo like:

```ts
import Dexie, { type EntityTable, type Table } from "dexie";

interface Song {
  id: number;
  title: string;
  artist: string;
  album: string;
  date_added: string;
  seconds: number;
  base_path: string;
  path: string;
  url: string;
}

export interface Playlist {
  id: number;
  name: string;
  image_path?: string;
  image_blob?: Uint8Array;
  date_added?: string;
  description?: string;
}

interface Favorite {
  id: number;
  song_id: string;
}
interface PlaylistSongs {
  playlistId: string;
  songId: string;
  sortOrder: number;
}

interface QueryOptions {
  filter: string;
  search: string;
  sortKey: keyof Song;
  offset: number;
  limit: number;
  playlistId?: string | null;
}

const db = new Dexie("freqhole") as Dexie & {
  songs: EntityTable<Song, "id">;
  favorites: EntityTable<Favorite, "id">;
  playlists: EntityTable<Playlist, "id">;
  playlist_songs: Table<PlaylistSongs>;
};

// Schema declaration:
db.version(1).stores({
  songs: "id, title, artist, album, date_added, seconds, base_path, schema_key",
  // note: schema_key is a uniq key pointing to a static enum (somewhere)
  // that explains the shape (schema) of the rest of this object.
  favorites: "++id, song_id",
  playlists: "++id, name",
  playlist_songs: "[playlistId+songId]",
});

export type { Song };
export { db };

export async function addToNewPlaylist(song_ids: string[], name: string) {
  name = name ? name : `new playlist ${Date.now().toFixed(4)}`;
  const playlistId = await db.playlists.add({
    name,
    date_added: `${Date.now()}`,
  });
  return await addToPlaylist(song_ids, `${playlistId}`);
}

export async function addToPlaylist(song_ids: string[], playlistId: string) {
  await Promise.all(
    song_ids.map((sid) =>
      db.playlist_songs
        .put({
          playlistId: `${playlistId}`,
          songId: `${sid}`,
          sortOrder: 0,
        })
        .catch((e) => console.warn("playlist_songs.put error:", e)),
    ),
  );
}

export async function updatePlaylist(playlist: Partial<Playlist>) {
  if (!playlist.id) return;
  await db.playlists.update(playlist.id, playlist);
}
export async function toggleFavoriteSong(song_id: string) {
  const is_fav = await db.favorites.get({ song_id });
  if (is_fav) {
    return await db.favorites.delete(is_fav.id);
  }
  return await db.favorites.add({ song_id });
}

export async function getPlaylists() {
  return db.playlists.toArray();
}

export async function getFavoriteSongs() {
  return db.songs
    .where("id")
    .anyOf((await db.favorites.toArray()).map((f) => f.song_id))
    .toArray();
}

export async function getPlaylist(playlistId: string | null) {
  if (!playlistId) return null;
  const playlist = await db.playlists.get(parseInt(playlistId));
  return playlist;
}

export async function getPlaylistSongs(playlistId: string) {
  return db.songs
    .where("id")
    .anyOf(
      (await db.playlist_songs.where({ playlistId }).toArray()).map(
        (f) => f.songId,
      ),
    )
    .toArray();
}

export async function querySongs(options: QueryOptions): Promise<Song[]> {
  let favz: Song[] | undefined;
  const isFavz = options.filter === "favorites";
  if (isFavz) {
    favz = await getFavoriteSongs();
  }

  const isPlaylist = options.filter === "playlist" && options.playlistId;
  let playlist_song_ids: string[] = [];
  if (isPlaylist) {
    playlist_song_ids = (
      await db.playlist_songs
        .where({ playlistId: options.playlistId })
        .toArray()
    )?.map((ps) => ps.songId);
  }

  const matchSong = (song: Song) => {
    // so if favz filter andand this isn't in the favz,
    // bail before query check.
    if (isFavz && favz?.every((f) => f.id !== song.id)) {
      return false;
    }
    // same for playlist, if this song isn't in the playlist, bail.
    if (
      isPlaylist &&
      playlist_song_ids.every((psid) => psid !== `${song.id}`)
    ) {
      return false;
    }

    const matchesSearch =
      !options.search ||
      Object.values(song).some(
        (v) =>
          typeof v === "string" &&
          v.toLowerCase().includes(options.search.toLowerCase()),
      );

    return matchesSearch;
  };

  const songs = await db.songs
    .orderBy(options.sortKey)
    .filter(matchSong)
    .offset(options.offset)
    .limit(options.limit)
    .toArray();

  console.log("zomg querySongs results songs.length", songs.length);
  return songs;
}

export async function resetDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const dbName = "freqhole";

    const deleteRequest = indexedDB.deleteDatabase(dbName);

    deleteRequest.onsuccess = () => {
      console.log(`deleted database "${dbName}"`);
      resolve();
    };

    deleteRequest.onerror = () => {
      console.error(
        `❌ Failed to delete database "${dbName}"`,
        deleteRequest.error,
      );
      reject(deleteRequest.error);
    };

    deleteRequest.onblocked = () => {
      console.warn(
        `⚠️ Delete blocked. Make sure all tabs are closed using the "${dbName}" database.`,
      );
    };
  });
}
```
