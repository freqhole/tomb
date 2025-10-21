# Offline‑First Media App Blueprint (Solid.js) — Full Guide

**Updated for your constraints and layout**

- **No `localforage`**, raw IndexedDB only.
- **No import aliases** (relative imports only).
- **Primary model = `Song`**. All collections (Albums/Artists/Genres/Playlists/Queue/Selections) are **derived** from songs.
- **Solid Router for scroll restoration** (no session/local storage needed).
- **Composable collections** with paging, reactivity, A–Z anchors, and **windowed data cache**.
- **Pluggable remotes** (HTTP + WebSocket) via interface in `lib/music/api`.
- **Album‑first** browsing: materialized `albums` table for pagination & sort; tracks sorted by disc+track within album.
- **Offline cache** (images/audio) managed via SW Cache Storage + purge/size reporting.
- **Event bus** vs. **invalidation tags** patterns discussed; unsubscribe safety + desktop/mobile compositions addressed.
- **New folder layout** (no packages/monorepo): see below.

---

## Folder Layout (final)

```
views/                  # presentation layer
  core/                 # main Solid app (Vite) + service worker
    components/
    context/
    hooks/
    routes/
    theme/
  music/                # music-specific views
    components/
    context/
    hooks/
    routes/
    services/
    store/
lib/                    # business logic + data
  sync/                 # cross-domain sync base (ws+http, SW messaging, generic helpers)
  api/                  # cross-domain api base (and generic helpers)
  data/                 # cross-domain indexdb base helpers
  music/                # music domain
    api/                # music-domain specific api impl; remote provider interfaces + implementations
    sync/               # music-domain specific sync impl
    data/               # IndexedDB, queries, mutations, collections infra, normalize, filters, sorters, aggregations
    schemas/            # zod schemas
  utils/                # tiny pure helpers
testing/                # playwright stuff
```

> All imports are **relative**, e.g. `import { normalizeSong } from "../../../lib/music/domain/normalize"`

---

## Core `Song` Type (lib/music/types/song.ts)

```ts
import { z } from "zod";

export const Song = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  album_artist: z.string(),
  track_number: z.number().int().nullable(),
  disc_number: z.number().int().nullable(),
  duration_seconds: z.number().int(),
  genre: z.string().nullable().default(null),
  sub_genres: z.array(z.string()).default([]),
  year: z.number().int().nullable(),
  bpm: z.number().int().nullable(),
  key_signature: z.string().nullable(),
  tags: z.array(z.string()).default([]),
  created_at: z.string(), // ISO
  media_blob_id: z.string(),
  thumbnail_blob_id: z.string().nullable().default(null),
  waveform_blob_id: z.string().nullable().default(null),
  thumbnail_blob_ids: z.array(z.string()).default([]),
  user_rating: z.number().int().min(0).max(5).nullable().default(null),
  user_is_favorite: z.boolean().default(false),
  // multi-remote
  remote_id: z.string().default("default"),
});
export type Song = z.infer<typeof Song>;
```

### Normalize at ingest (lib/music/domain/normalize.ts)

```ts
import { Song as SongSchema, type Song } from "../../types/song";

export type SongRow = Song & {
  title_lower: string;
  artist_lower: string;
  album_lower: string;
  genre_lower: string | null;
};

export function normalizeSong(s: unknown): SongRow {
  const v = SongSchema.parse(s);
  return {
    ...v,
    title_lower: v.title.toLowerCase(),
    artist_lower: v.artist.toLowerCase(),
    album_lower: v.album.toLowerCase(),
    genre_lower: v.genre ? v.genre.toLowerCase() : null,
  };
}
```

### Sorters/Filters/Aggregations (lib/music/domain)

```ts
// sort.ts
import type { SongRow } from "./normalize";
export const byTitle = (a: SongRow, b: SongRow) =>
  a.title_lower.localeCompare(b.title_lower);
export const byAlbumDiscTrack = (a: SongRow, b: SongRow) => {
  if (a.album_lower === b.album_lower) {
    const d = (a.disc_number ?? 0) - (b.disc_number ?? 0);
    return d !== 0 ? d : (a.track_number ?? 0) - (b.track_number ?? 0);
  }
  return a.album_lower.localeCompare(b.album_lower);
};
export const byRecentlyCreated = (a: SongRow, b: SongRow) =>
  new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
```

```ts
// filters.ts
import type { SongRow } from "./normalize";
export const titlePrefix = (q: string) => (t: SongRow) =>
  t.title_lower.startsWith(q.toLowerCase());
export const hasGenre = (g: string) => (t: SongRow) =>
  t.genre_lower === g.toLowerCase() ||
  (t.sub_genres ?? []).some((s) => s.toLowerCase() === g.toLowerCase());
export const isFavorite = (t: SongRow) => !!t.user_is_favorite;
```

```ts
// albums.ts  (materialization from songs)
import type { SongRow } from "./normalize";
export type AlbumRow = {
  id: string; // `${album}::${album_artist}::${remote_id}`
  remote_id: string;
  name: string;
  name_lower: string;
  album_artist: string;
  year: number | null;
  song_ids: string[];
  song_count: number;
  duration_seconds_total: number;
  created_at: string; // earliest or latest among songs
  thumbnail_blob_id: string | null;
};
export function reduceAlbums(songs: SongRow[]): AlbumRow[] {
  const m = new Map<string, AlbumRow>();
  for (const s of songs) {
    const id = `${s.album}::${s.album_artist}::${s.remote_id}`;
    const cur = m.get(id);
    if (!cur) {
      m.set(id, {
        id,
        remote_id: s.remote_id,
        name: s.album,
        name_lower: s.album_lower,
        album_artist: s.album_artist,
        year: s.year ?? null,
        song_ids: [s.id],
        song_count: 1,
        duration_seconds_total: s.duration_seconds ?? 0,
        created_at: s.created_at,
        thumbnail_blob_id:
          s.thumbnail_blob_id ?? s.thumbnail_blob_ids?.[0] ?? null,
      });
    } else {
      cur.song_ids.push(s.id);
      cur.song_count++;
      cur.duration_seconds_total += s.duration_seconds ?? 0;
      if (new Date(s.created_at) < new Date(cur.created_at))
        cur.created_at = s.created_at;
      if (
        !cur.thumbnail_blob_id &&
        (s.thumbnail_blob_id || s.thumbnail_blob_ids?.length)
      )
        cur.thumbnail_blob_id =
          s.thumbnail_blob_id ?? s.thumbnail_blob_ids?.[0] ?? null;
      if (!cur.year && s.year) cur.year = s.year;
    }
  }
  return [...m.values()];
}
```

---

## IndexedDB (lib/music/data/idb)

- DB: `media-db`
- Stores: `songs`, `albums`, `offline_blobs`
- Indexes:
  - `songs`: `title_lower`, `artist_lower`, `album_lower`, `genre_lower`, `created_at`, `remote_id`
  - `albums`: `name_lower`, `year`, `created_at`, `remote_id`
  - `offline_blobs`: keyPath `["song_id","type"]`, indexes `song_id`, `type`

```ts
// idb-db.ts
import type { SongRow } from "../domain/normalize";
import type { AlbumRow } from "../domain/albums";

const DB_NAME = "media-db";
const DB_VERSION = 2;
let db: IDBDatabase | null = null;

export async function openDb(): Promise<IDBDatabase> {
  if (db) return db;
  db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("songs")) {
        const s = d.createObjectStore("songs", { keyPath: "id" });
        s.createIndex("title_lower", "title_lower", { unique: false });
        s.createIndex("artist_lower", "artist_lower", { unique: false });
        s.createIndex("album_lower", "album_lower", { unique: false });
        s.createIndex("genre_lower", "genre_lower", { unique: false });
        s.createIndex("created_at", "created_at", { unique: false });
        s.createIndex("remote_id", "remote_id", { unique: false });
      }
      if (!d.objectStoreNames.contains("albums")) {
        const a = d.createObjectStore("albums", { keyPath: "id" });
        a.createIndex("name_lower", "name_lower", { unique: false });
        a.createIndex("year", "year", { unique: false });
        a.createIndex("created_at", "created_at", { unique: false });
        a.createIndex("remote_id", "remote_id", { unique: false });
      }
      if (!d.objectStoreNames.contains("offline_blobs")) {
        const o = d.createObjectStore("offline_blobs", {
          keyPath: ["song_id", "type"],
        });
        o.createIndex("song_id", "song_id", { unique: false });
        o.createIndex("type", "type", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return db;
}

export async function tx<T>(
  stores: string[],
  mode: IDBTransactionMode,
  run: (s: Record<string, IDBObjectStore>) => Promise<T>,
): Promise<T> {
  const d = await openDb();
  const t = d.transaction(stores, mode);
  const s: any = {};
  for (const name of stores) s[name] = t.objectStore(name);
  const out = await run(s);
  await new Promise((res, rej) => {
    t.oncomplete = () => res(null);
    t.onerror = () => rej(t.error);
  });
  return out;
}
```

### Queries (lib/music/data/queries.ts)

```ts
import { tx } from "./idb-db";
import type { SongRow } from "../domain/normalize";

export async function getSongsByTitlePrefix(
  prefix: string,
  limit = 200,
  offset = 0,
): Promise<SongRow[]> {
  return tx(["songs"], "readonly", async ({ songs }) => {
    const idx = songs.index("title_lower");
    const q = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
    return collect(idx.openCursor(q), limit, offset);
  });
}
export async function getSongsByArtistLower(
  artistLower: string,
  limit = 200,
  offset = 0,
): Promise<SongRow[]> {
  return tx(["songs"], "readonly", async ({ songs }) =>
    collect(songs.index("artist_lower").openCursor(artistLower), limit, offset),
  );
}
export async function getAllSongs(limit = 200, offset = 0): Promise<SongRow[]> {
  return tx(["songs"], "readonly", async ({ songs }) =>
    collect(songs.openCursor(), limit, offset),
  );
}

async function collect(
  req: IDBRequest<IDBCursorWithValue>,
  limit: number,
  offset: number,
) {
  const rows: any[] = [];
  let skipped = 0;
  return new Promise<any[]>((resolve, reject) => {
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(rows);
      if (skipped < offset) {
        skipped++;
        c.continue();
        return;
      }
      rows.push(c.value);
      if (rows.length >= limit) return resolve(rows);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
```

### Albums queries (lib/music/data/album-queries.ts)

```ts
import { tx } from "./idb-db";
export async function getAlbumsByName(
  limit = 60,
  offset = 0,
  remoteId?: string | null,
) {
  return tx(["albums"], "readonly", async (s: any) => {
    const idx = s.albums.index("name_lower");
    return collect(idx.openCursor(), limit, offset, remoteId);
  });
}
async function collect(
  req: IDBRequest<IDBCursorWithValue>,
  limit: number,
  offset: number,
  remoteId?: string | null,
) {
  const rows: any[] = [];
  let skipped = 0;
  return new Promise<any[]>((resolve, reject) => {
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(rows);
      const v = c.value;
      const pass = !remoteId || v.remote_id === remoteId;
      if (pass) {
        if (skipped < offset) {
          skipped++;
          c.continue();
          return;
        }
        rows.push(v);
        if (rows.length >= limit) return resolve(rows);
      }
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
```

---

## Invalidation Bus (lib/music/data/invalidate.ts)

```ts
type Tag = "songs" | "albums" | "offline";
const listeners = new Map<Tag, Set<() => void>>();
export function invalidate(...tags: Tag[]) {
  tags.forEach((t) => listeners.get(t)?.forEach((fn) => fn()));
}
export function subscribe(tag: Tag, fn: () => void) {
  const set = listeners.get(tag) ?? new Set();
  listeners.set(tag, set);
  set.add(fn);
  return () => set.delete(fn);
}
```

> Prefer this over a global app‑wide UI event bus for data changes. If you still want a UI bus, scope it per route via context so it’s disposed on unmount (safe for desktop/mobile switches).

---

## Collections Infra (lib/music/data/collection)

- **Types**: as above.
- **Sources**: one per view origin (Albums, Genre, Queue, Playlist, Selected, Search).
- **Hook**: `useCollectionRouter` — router‑state restore, page bitmap, windowed page cache, invalidation.

(See code above in this doc.)

---

## Views: Desktop vs Mobile Composition (views/music/routes)

Keep two separate trees and pick at the route level.

```tsx
// views/music/routes/Albums.route.tsx
import { isMobileNarrow } from "../../core/hooks/useViewport";
import Desktop from "./Albums.desktop";
import Mobile from "./Albums.mobile";
export default function AlbumsRoute() {
  return isMobileNarrow() ? <Mobile /> : <Desktop />;
}
```

This keeps files clean and avoids tangled conditionals. Hooks/services are shared.

---

## Edit Modal & Context Menu (views/music/components)

- **EditSongModal** → calls `patchSongs(ids, patch)` → `invalidate("songs","albums")`.
- **SongRow** and **AlbumTile** share a **ContextMenu**. Menu items call data‑layer mutations (toggle favorite, add to playlist, queue, edit, delete).

---

## Offline Cache (SW + hooks)

- Service Worker registers routes for images/audio and exposes a message API for info/purge.
- `offline_blobs` IDB store lets UI show **Downloaded** songs and filter by offline status.

---

## Remotes & Sync

- `lib/music/api/provider.ts`: `RemoteProvider` (HTTP+WS) swappable implementations.
- `lib/sync/sync.ts`: backfill + live updates → write to IDB (`normalizeSong`) → `invalidate(...)`.
- Multi‑remote: set `remote_id` on all rows; filter via `filters.remoteId` in sources.

---

## A–Z Anchors

- Build **letter→pageIndex** map when (re)building albums, or compute on demand with IDB key‑range counts.
- `jumpToLetter("M")` → `ensureIndex(globalIndex)` → `virtualizer.scrollToIndex(...)`.

---

## Final Notes

- Album‑first logic stays centralized in **albums materialization** + sources.
- Data changes travel through **mutations → IDB → invalidate(tags) → collections refresh**.
- Desktop and mobile **compositions** live in different files; data hooks handle the wiring.

---

# updating data

Short version: when you update a record in an IndexedDB object store and call put() with the updated object, all indexes whose keyPath read from that object are automatically updated by the browser. You don’t manually “reindex” a row. You only need to do manual work for derived tables (like your albums materialization) or if you change the DB schema (add/remove an index → bump version).

Here’s how each case plays out.

1. Plain song updates (artist/genre/title/etc.)

Your songs store has indexes like artist_lower, title_lower, album_lower, genre_lower, etc.

When you change a song’s artist or genre:

Build the next object (we already do this in applyPatch() which also refreshes the lowercase fields).

Call songs.put(next) inside a transaction.

The browser updates the B-Tree for any indexes that point at those fields. No extra steps.

Arrays (sub_genres, tags)

If you want to query/filter by elements inside arrays, define multiEntry indexes. For example:

// during DB upgrade
const s = d.createObjectStore("songs", { keyPath: "id" });
s.createIndex("sub_genres", "sub_genres", { unique: false, multiEntry: true });
s.createIndex("tags", "tags", { unique: false, multiEntry: true });

Updating a song’s sub_genres array and calling put() updates those multiEntry indexes automatically.

2. When do you need to “reindex”?

Only when you change the database schema (e.g., add a new index). Then you:

Bump DB_VERSION.

In onupgradeneeded, create the new index.

The browser runs a rebuild pass and populates that index for existing rows.

(That’s the only time you’ll see “reindexing,” and it’s automatic during the upgrade.)

3. Album materialization must be updated by you

Because albums is a derived table, IndexedDB won’t maintain it. You need an incremental updater.

Recommended composite index

To quickly recompute a single album row, add a composite index on songs by album key:

// songs store — composite index for fast album grouping
s.createIndex(
"album_key",
["album_lower", "album_artist", "remote_id"],
{ unique: false }
);

Now you can fetch all songs for one album via:

const key = [song.album_lower, song.album_artist, song.remote_id] as const;
const range = IDBKeyRange.only(key);
const cursor = songs.index("album_key").openCursor(range);

Incremental update on patch

When a song is edited, figure out the old album key (from the current record) and the new album key (from the patched record). In one transaction over ["songs","albums"]:

await tx(["songs","albums"], "readwrite", async ({ songs, albums }) => {
// 1) load current, compute keys
const cur = await get(songs, id); // helper that wraps .get()
const oldKey = [cur.album_lower, cur.album_artist, cur.remote_id] as const;

// 2) build next record (applyPatch() re-derives lowercased fields)
const next = applyPatch(cur, patch);
const newKey = [next.album_lower, next.album_artist, next.remote_id] as const;

// 3) write the song — this updates all songs indexes automatically
await put(songs, next);

// 4) update albums affected
const touched: Array<readonly [string,string,string]> = [oldKey];
if (oldKey[0] !== newKey[0] || oldKey[1] !== newKey[1] || oldKey[2] !== newKey[2]) {
touched.push(newKey);
}

for (const key of dedupeTupleKeys(touched)) {
const songsInAlbum = await collectByAlbumKey(songs, key); // uses album_key index, range = only(key)
if (songsInAlbum.length === 0) {
await del(albums, makeAlbumIdFromKey(key));
continue;
}
const albumRow = reduceOneAlbumFromSongs(songsInAlbum); // same logic as reduceAlbums, but for one key
await put(albums, albumRow);
}
});
invalidate("songs","albums");

Helpers sketched:

function makeAlbumIdFromKey([album_lower, album_artist, remote_id]: readonly [string,string,string]) {
// Store your album id as `${album}::${album_artist}::${remote_id}` or store a separate `album_key`.
// If you keep only lowers in the key, you may need to pull a display name from one of the songs.
return `${album_lower}::${album_artist}::${remote_id}`;
}

async function collectByAlbumKey(songs: IDBObjectStore, key: readonly [string,string,string]) {
const rows:any[] = [];
const range = IDBKeyRange.only(key);
const req = songs.index("album_key").openCursor(range);
await new Promise<void>((res, rej) => {
req.onsuccess = () => { const c = req.result; if (!c) return res(); rows.push(c.value); c.continue(); };
req.onerror = () => rej(req.error);
});
return rows;
}

This makes album updates O(size of the album), not O(total songs). For bulk imports/WS bursts, collect all touched keys and update them once at the end.

When genre changes

If your albums view is independent of genre, you don’t need to touch albums for genre-only changes.

If you have genre-based album collections, you can compute those on the fly from songs (via reduceAlbums(filteredSongs)) or introduce a separate materialized table if you need stronger paging on those views too.

4. Bulk upserts/deletes (sync)

When the sync engine receives many upserts/deletes:

Put all songs with songs.put() / songs.delete(). (Indexes update automatically.)

Track the set of affected album_keys (from both old and new versions).

After writes, recompute those album rows (as above) in the same or a follow-up transaction.

Finally invalidate("songs","albums") to refresh UI collections.

5. What if I change which fields are indexed?

Add or change indexes → bump DB version and create the index in onupgradeneeded. The browser rebuilds it.

Removing an index → also a version bump; just don’t use it afterwards.

6. Gotchas & tips

Always update the denormalized lowercased fields (title_lower, artist_lower, etc.) in your applyPatch() path so the indexes stay correct for prefix searches.

For array filters you plan to query, use multiEntry indexes (sub_genres, tags).

Use composite indexes for the most common multi-field filters. We used album_key = [album_lower, album_artist, remote_id] to make album maintenance fast; you might also add [remote_id, name_lower] on albums if you frequently page albums per remote in name order.

Keep related updates atomic by putting them in the same transaction over multiple stores (["songs","albums"]).

TL;DR flow for “change artist” / “change genre”

Build next = applyPatch(cur, patch) (refresh derived lowercased fields).

songs.put(next) → all songs indexes update automatically.

If album keys changed (album/album_artist/remote), recompute only those album rows using the album_key composite index and write to albums.

invalidate("songs","albums") so collections refresh.

---

# Monorepo Blueprint for an Offline‑First Media App (Solid.js + IndexedDB + SWR + SW)

**Constraints applied:**

- **No `localforage`**; use a tiny IndexedDB-backed KV adapter instead.
- **No import aliases** (only relative imports like `"../../types/music"`).
- **Single primary model = `Song`**; **Artist/Album/Genre** collections are _derived_ from `Song` props.
- **Pluggable remote backends** (HTTP + WebSocket) that can be swapped without touching UI/feature code.

---

## Goals

- Small, focused packages with strict one-way dependencies.
- Offline‑first: IndexedDB is the local DB, server is source of truth (SWR-esque behavior).
- Reactive queries + virtualized infinite lists via `@solid-primitives/virtual`.
- Pluggable remote providers (HTTP/WS), encapsulated in the data layer.
- CI rules that enforce the one‑way dependency flow.

---

## Monorepo Layout (pnpm + Turborepo)

```
apps/
  web/                        # main Solid app (Vite)
  demo-music/                 # demo app for e2e tests
  sw/                         # service worker build (outputs to web/public/sw.js)
packages/
  types/                      # shared types (Song only) & zod schema
  utils/                      # tiny helpers (pure fns only)
  domain-music/               # pure domain: normalization, comparators, filters, aggregations
  data-client/                # data access: IndexedDB, sync engine, queries, mutations, remote provider
  feature-player/             # queue, playback engine, controls
  feature-library/            # library browsing: collections (songs, artists, albums, genres)
  feature-playlists/          # playlist CRUD + views (optional for future)
  feature-user/               # favorites, ratings, history
  ui-kit/                     # shared UI components
```

```
views/                  # mainly presentation layer
  core/                 # core media application, main Solid app (Vite) + sw.js service worker stuff
    components/         # shared UI components
    context/
    hooks/
    routes/
  music/                # music domain views
    components/
    context/
    hooks/
    routes/
    services/
    store/
lib/                    # biz logic
  sync/                 # websocket + http sync stuff
  music/                # pure domain: normalization, comparators, filters, aggregations
    api/                # remote server providers (websockets, http)
    data/               # data access: IndexedDB, sync engine, queries, mutations,
    types/              # shared types (Song only) & zod schema
  utils/                # tiny helpers (pure fns only, utils)
```

**Dependency direction (hard rule):**
`types → utils → domain-* → data-client → feature-* → apps`

No package may import code from a layer to its **left** (upstream) or any **apps/** folder.

---

## Core Type: `Song` (`packages/types/src/music.ts`)

```ts
// packages/types/src/music.ts
import { z } from "zod";

export const Song = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  album_artist: z.string(),
  track_number: z.number().int().nullable(),
  disc_number: z.number().int().nullable(),
  duration_seconds: z.number().int(),
  genre: z.string().nullable().default(null),
  sub_genres: z.array(z.string()).default([]),
  year: z.number().int().nullable(),
  bpm: z.number().int().nullable(),
  key_signature: z.string().nullable(),
  tags: z.array(z.string()).default([]),
  created_at: z.string(), // ISO timestamp
  media_blob_id: z.string(),
  thumbnail_blob_id: z.string().nullable().default(null),
  waveform_blob_id: z.string().nullable().default(null),
  thumbnail_blob_ids: z.array(z.string()).default([]),
  user_rating: z.number().int().min(0).max(5).nullable().default(null),
  user_is_favorite: z.boolean().default(false),
});
export type Song = z.infer<typeof Song>;
```

> Domain will **normalize** a few derived lowercase fields for fast prefix queries (e.g., `title_lower`, `artist_lower`, `album_lower`, `genre_lower`). Those are added _during ingest_ and stored in IDB.

---

## Domain (pure) — `packages/domain-music`

### Normalize at ingest

```ts
// packages/domain-music/src/normalize.ts
import { Song as SongSchema, type Song } from "../../types/src/music";

export type SongRow = Song & {
  title_lower: string;
  artist_lower: string;
  album_lower: string;
  genre_lower: string | null;
};

export function normalizeSong(s: unknown): SongRow {
  const v = SongSchema.parse(s);
  return {
    ...v,
    title_lower: v.title.toLocaleLowerCase(),
    artist_lower: v.artist.toLocaleLowerCase(),
    album_lower: v.album.toLocaleLowerCase(),
    genre_lower: v.genre ? v.genre.toLocaleLowerCase() : null,
  };
}
```

### Comparators & Filters

```ts
// packages/domain-music/src/sort.ts
import type { SongRow } from "./normalize";

export const byTitle = (a: SongRow, b: SongRow) =>
  a.title_lower.localeCompare(b.title_lower);

export const byAlbumDiscTrack = (a: SongRow, b: SongRow) => {
  if (a.album_lower === b.album_lower) {
    const ad = (a.disc_number ?? 0) - (b.disc_number ?? 0);
    if (ad !== 0) return ad;
    return (a.track_number ?? 0) - (b.track_number ?? 0);
  }
  return a.album_lower.localeCompare(b.album_lower);
};

export const byRecentlyCreated = (a: SongRow, b: SongRow) =>
  new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
```

```ts
// packages/domain-music/src/filters.ts
import type { SongRow } from "./normalize";

export const titlePrefix = (q: string) => (t: SongRow) =>
  t.title_lower.startsWith(q.toLocaleLowerCase());

export const hasGenre = (g: string) => (t: SongRow) =>
  t.genre_lower === g.toLocaleLowerCase() ||
  (t.sub_genres ?? []).some(
    (sg) => sg.toLocaleLowerCase() === g.toLocaleLowerCase(),
  );

export const isFavorite = (t: SongRow) => t.user_is_favorite === true;
```

### Derived Collections FROM `Song`

```ts
// packages/domain-music/src/collections.ts
import type { SongRow } from "./normalize";

export function deriveArtists(songs: SongRow[]) {
  // { artist -> count }
  const m = new Map<string, number>();
  for (const s of songs) m.set(s.artist, (m.get(s.artist) ?? 0) + 1);
  return [...m.entries()].map(([name, count]) => ({ name, count }));
}

export function deriveAlbums(songs: SongRow[]) {
  // { album + album_artist -> count, year? }
  const m = new Map<
    string,
    { name: string; album_artist: string; count: number; year: number | null }
  >();
  for (const s of songs) {
    const k = `${s.album}::${s.album_artist}`;
    const cur = m.get(k);
    if (!cur)
      m.set(k, {
        name: s.album,
        album_artist: s.album_artist,
        count: 1,
        year: s.year ?? null,
      });
    else
      m.set(k, {
        ...cur,
        count: cur.count + 1,
        year: cur.year ?? s.year ?? null,
      });
  }
  return [...m.values()];
}

export function deriveGenres(songs: SongRow[]) {
  const m = new Map<string, number>();
  for (const s of songs) {
    if (s.genre) m.set(s.genre, (m.get(s.genre) ?? 0) + 1);
    for (const sg of s.sub_genres ?? []) m.set(sg, (m.get(sg) ?? 0) + 1);
  }
  return [...m.entries()].map(([name, count]) => ({ name, count }));
}
```

> All **pure** — unit test with Vitest in milliseconds.

---

## Data Client — `packages/data-client`

**All storage and network IO lives here.** No DOM, no Solid components.

### Tiny IndexedDB Adapters (no localForage)

```ts
// packages/data-client/src/idb-kv.ts
// async key-value store on top of IndexedDB (for metadata/ETags/etc.)
const KV_DB = "media-kv";
const KV_STORE = "kv";
let kvDb: IDBDatabase | null = null;

export async function kvOpen(): Promise<IDBDatabase> {
  if (kvDb) return kvDb;
  kvDb = await new Promise((resolve, reject) => {
    const req = indexedDB.open(KV_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(KV_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return kvDb;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await kvOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KV_STORE, "readonly");
    const req = tx.objectStore(KV_STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  const db = await kvOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KV_STORE, "readwrite");
    tx.objectStore(KV_STORE).put(value as any, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
```

```ts
// packages/data-client/src/idb-db.ts
// main tables for songs (plus any fan-out tables later)
import type { SongRow } from "../../domain-music/src/normalize";

const DB_NAME = "media-db";
const DB_VERSION = 1;
let db: IDBDatabase | null = null;

export async function openDb(): Promise<IDBDatabase> {
  if (db) return db;
  db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("songs")) {
        const s = d.createObjectStore("songs", { keyPath: "id" });
        s.createIndex("title_lower", "title_lower", { unique: false });
        s.createIndex("artist_lower", "artist_lower", { unique: false });
        s.createIndex("album_lower", "album_lower", { unique: false });
        s.createIndex("genre_lower", "genre_lower", { unique: false });
        s.createIndex("created_at", "created_at", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return db;
}

export async function tx<T>(
  stores: "songs"[],
  mode: IDBTransactionMode,
  run: (s: { songs: IDBObjectStore }) => Promise<T>,
): Promise<T> {
  const d = await openDb();
  const t = d.transaction(stores, mode);
  const s = { songs: t.objectStore("songs") };
  const out = await run(s);
  await new Promise((res, rej) => {
    t.oncomplete = () => res(null);
    t.onerror = () => rej(t.error);
  });
  return out;
}
```

### SWR-ish Resource (no alias imports, no localforage)

```ts
// packages/data-client/src/swr.ts
// simple stale-while-revalidate keyed by string
import { createResource } from "solid-js";
import { kvGet, kvSet } from "./idb-kv";

export function createSWRResource<T>(
  key: () => string | undefined,
  fetcher: (k: string) => Promise<T>,
  opts?: { ttlMs?: number; cacheName?: string },
) {
  const ttl = opts?.ttlMs ?? 60_000;
  const cacheName = opts?.cacheName ?? "swr";

  const [data, { refetch, mutate }] = createResource(key, async (k) => {
    const cacheKey = `swr:${cacheName}:${k}`;
    const cached = await kvGet<{ value: T; ts: number }>(cacheKey);
    if (cached?.value && Date.now() - cached.ts < ttl) return cached.value;
    const fresh = await fetcher(k);
    await kvSet(cacheKey, { value: fresh, ts: Date.now() });
    return fresh;
  });

  return [data, { refetch, mutate }] as const;
}
```

### Reactive Query Bus

```ts
// packages/data-client/src/invalidate.ts
type Tag = "songs";
const listeners = new Map<Tag, Set<() => void>>();
export function invalidate(...tags: Tag[]) {
  tags.forEach((t) => listeners.get(t)?.forEach((fn) => fn()));
}
export function subscribe(tag: Tag, fn: () => void) {
  const set = listeners.get(tag) ?? new Set();
  listeners.set(tag, set);
  set.add(fn);
  return () => set.delete(fn);
}
```

```ts
// packages/data-client/src/useQuery.ts
import { createSignal, onCleanup } from "solid-js";
import { subscribe } from "./invalidate";

export function useQuery<T>(tags: string[], run: () => Promise<T>) {
  const [data, setData] = createSignal<T | undefined>();
  let stopped = false;
  async function exec() {
    const v = await run();
    if (!stopped) setData(v);
  }
  const unsubs = tags.map((t) => subscribe(t as any, exec));
  exec();
  onCleanup(() => {
    stopped = true;
    unsubs.forEach((u) => u());
  });
  return data;
}
```

### IndexedDB Queries & Pagination (derived collections from `Song`)

```ts
// packages/data-client/src/queries.ts
import { tx } from "./idb-db";
import type { SongRow } from "../../domain-music/src/normalize";

export async function getSongsByTitlePrefix(
  prefix: string,
  limit = 200,
  offset = 0,
): Promise<SongRow[]> {
  return tx(["songs"], "readonly", async ({ songs }) => {
    const idx = songs.index("title_lower");
    const q = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
    return collect(idx.openCursor(q), limit, offset);
  });
}

export async function getSongsByArtist(
  artistLower: string,
  limit = 200,
  offset = 0,
): Promise<SongRow[]> {
  return tx(["songs"], "readonly", async ({ songs }) => {
    const idx = songs.index("artist_lower");
    return collect(idx.openCursor(artistLower), limit, offset);
  });
}

export async function getAllSongs(limit = 200, offset = 0): Promise<SongRow[]> {
  return tx(["songs"], "readonly", async ({ songs }) =>
    collect(songs.openCursor(), limit, offset),
  );
}

async function collect(
  req: IDBRequest<IDBCursorWithValue>,
  limit: number,
  offset: number,
) {
  const rows: any[] = [];
  let skipped = 0;
  return new Promise<any[]>((resolve, reject) => {
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve(rows);
      if (skipped < offset) {
        skipped++;
        cur.continue();
        return;
      }
      rows.push(cur.value);
      if (rows.length >= limit) return resolve(rows);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
```

### Hook Facades for Features

```ts
// packages/data-client/src/hooks.ts
import { useQuery } from "./useQuery";
import {
  getSongsByTitlePrefix,
  getSongsByArtist,
  getAllSongs,
} from "./queries";
import {
  byTitle,
  byAlbumDiscTrack,
  byRecentlyCreated,
} from "../../domain-music/src/sort";
import {
  titlePrefix,
  hasGenre,
  isFavorite,
} from "../../domain-music/src/filters";
import type { SongRow } from "../../domain-music/src/normalize";

export function useSongsSearch(
  prefix: string,
  sort: "title" | "albumTrack" | "recent" = "title",
) {
  return useQuery(["songs"], async () => {
    const rows = prefix
      ? await getSongsByTitlePrefix(prefix)
      : await getAllSongs();
    const cmp =
      sort === "title"
        ? byTitle
        : sort === "recent"
          ? byRecentlyCreated
          : byAlbumDiscTrack;
    return rows.sort(cmp);
  });
}

export function useSongsByArtist(artist: string) {
  return useQuery(["songs"], async () =>
    getSongsByArtist(artist.toLocaleLowerCase()),
  );
}
```

### Pluggable Remote Providers

```ts
// packages/data-client/src/remote/provider.ts
import type { Song } from "../../types/src/music";
import type { SongRow } from "../../domain-music/src/normalize";

export type SyncEvent =
  | { type: "upsert"; songs: Song[] } // server sent upserts
  | { type: "delete"; ids: string[] }; // server sent deletions

export interface RemoteProvider {
  name: string;
  // initial / paginated fetch (for cold start or backfill)
  fetchSongsPage(args: {
    cursor?: string;
    limit: number;
  }): Promise<{ songs: Song[]; nextCursor?: string }>;
  // push channel for live updates (WS or SSE)
  connectStream(onEvent: (ev: SyncEvent) => void): () => void; // returns unsubscribe
  // server mutations (optional – favorites/ratings/etc.)
  mutate(
    cmd:
      | { kind: "favorite"; id: string; value: boolean }
      | { kind: "rate"; id: string; value: number },
  ): Promise<void>;
}
```

Two example implementations (in separate files) that both satisfy `RemoteProvider`:

- `packages/data-client/src/remote/httpws.ts` (HTTP + WebSocket)
- `packages/data-client/src/remote/demo.ts` (local timer emitting fake events)

### Sync Engine (fits your existing HTTP + WebSocket)

```ts
// packages/data-client/src/sync.ts
import { RemoteProvider } from "./remote/provider";
import { normalizeSong } from "../../domain-music/src/normalize";
import { tx } from "./idb-db";
import { invalidate } from "./invalidate";

export function startSync(remote: RemoteProvider) {
  // 1) backfill / initial load (paged)
  (async () => {
    let cursor: string | undefined;
    for (;;) {
      const { songs, nextCursor } = await remote.fetchSongsPage({
        cursor,
        limit: 500,
      });
      if (songs.length === 0) break;
      await bulkUpsertSongs(songs);
      cursor = nextCursor;
      if (!cursor) break;
    }
    invalidate("songs");
  })();

  // 2) live updates
  const stop = remote.connectStream(async (ev) => {
    if (ev.type === "upsert") {
      await bulkUpsertSongs(ev.songs);
    } else if (ev.type === "delete") {
      await bulkDeleteSongs(ev.ids);
    }
    invalidate("songs");
  });

  return stop;
}

async function bulkUpsertSongs(songs: any[]) {
  const rows = songs.map(normalizeSong);
  await tx(["songs"], "readwrite", async ({ songs }) => {
    await Promise.all(
      rows.map(
        (r) =>
          new Promise<void>((res, rej) => {
            const req = songs.put(r);
            req.onsuccess = () => res();
            req.onerror = () => rej(req.error);
          }),
      ),
    );
    return;
  });
}

async function bulkDeleteSongs(ids: string[]) {
  await tx(["songs"], "readwrite", async ({ songs }) => {
    await Promise.all(
      ids.map(
        (id) =>
          new Promise<void>((res, rej) => {
            const req = songs.delete(id);
            req.onsuccess = () => res();
            req.onerror = () => rej(req.error);
          }),
      ),
    );
  });
}
```

### Mutations (optimistic → queue → remote)

```ts
// packages/data-client/src/mutations.ts
import { tx } from "./idb-db";
import { invalidate } from "./invalidate";
import type { RemoteProvider } from "./remote/provider";

export async function setFavorite(
  id: string,
  value: boolean,
  remote?: RemoteProvider,
) {
  // optimistic local write
  await tx(["songs"], "readwrite", async ({ songs }) => {
    const cur = await new Promise<any>((res, rej) => {
      const r = songs.get(id);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const next = { ...cur, user_is_favorite: value };
    await new Promise<void>((res, rej) => {
      const r = songs.put(next);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  });
  invalidate("songs");

  // enqueue to service worker OR call remote directly
  if (remote) {
    try {
      await remote.mutate({ kind: "favorite", id, value });
    } catch {
      /* enqueue for retry via SW Background Sync if desired */
    }
  }
}
```

---

## Features — `packages/feature-library`

### Virtualized infinite list (Songs)

```tsx
// packages/feature-library/src/SongCollection.tsx
import { createSignal, createMemo } from "solid-js";
import { createVirtualizer } from "@solid-primitives/virtual";
import { useSongsSearch } from "../../data-client/src/hooks";
import { isFavorite, hasGenre } from "../../domain-music/src/filters";

export function SongCollection() {
  const [q, setQ] = createSignal("");
  const [sort, setSort] = createSignal<"title" | "albumTrack" | "recent">(
    "title",
  );
  const [favOnly, setFavOnly] = createSignal(false);
  const [genre, setGenre] = createSignal<string | null>(null);

  const rows = () => useSongsSearch(q(), sort())(); // unwrap signal from useQuery

  const filtered = createMemo(() => {
    const base = rows() ?? [];
    return base
      .filter((s) => (favOnly() ? isFavorite(s) : true))
      .filter((s) => (genre() ? hasGenre(genre()!)(s) : true));
  });

  let container!: HTMLDivElement;
  const v = createVirtualizer({
    count: () => filtered().length,
    estimateSize: () => 56,
    parentRef: () => container,
  });

  return (
    <div class="h-full flex flex-col">
      {/* toolbar: inputs for q/sort/fav/genre */}
      <div ref={container} class="grow overflow-auto">
        <div style={{ position: "relative", height: `${v.totalSize}px` }}>
          {v.virtualItems().map((item) => {
            const s = filtered()[item.index];
            return (
              <div
                style={{
                  position: "absolute",
                  top: `${item.start}px`,
                  height: "56px",
                  left: 0,
                  right: 0,
                }}
                data-row
              >
                {s.title} — {s.artist} ({s.album})
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

### Artists/Albums/Genres are _derived_ collections

- Get **songs** from IDB (via hooks), then derive counts/groups in **domain** (`deriveArtists`, `deriveAlbums`, `deriveGenres`).
- For detail pages (Artist/Album/Genre), use the songs hook filtered by that dimension and display a virtualized song list.

---

## App wiring (choose a RemoteProvider)

```ts
// apps/web/src/main.ts
import { startSync } from "../../../packages/data-client/src/sync";
import { makeHttpWsRemote } from "../../../packages/data-client/src/remote/httpws";

const remote = makeHttpWsRemote({ baseUrl: "/api", wsUrl: "wss://example/ws" });
const stop = startSync(remote);
// on cleanup: stop();
```

---

## Service Worker (Workbox outline)

- API GET: Stale‑While‑Revalidate
- Mutations: Background Sync queue (POST/PUT/PATCH)
- Images: Stale‑While‑Revalidate
- Audio: CacheFirst with Range support
- Post‑write: broadcast `{ tag: "songs" }` to tabs via `BroadcastChannel('db')` → tabs call `invalidate('songs')` (you can also write to IDB inside SW and let UI just re-read).

---

## CI: Enforce One‑Way Dependencies

### dependency-cruiser (no aliases needed)

**.dependency-cruiser.js**

```js
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  options: {
    tsConfig: { fileName: "tsconfig.base.json" },
    doNotFollow: { path: "node_modules" },
  },
  forbidden: [
    { name: "no-cycles", severity: "error", from: {}, to: { circular: true } },
    {
      name: "no-import-apps",
      severity: "error",
      from: {},
      to: { path: "^apps/" },
    },
    // domain cannot import data/feature/apps
    {
      name: "domain-downstream",
      severity: "error",
      from: { path: "^packages/domain-" },
      to: { path: "^(packages/data-client|packages/feature-|apps/)" },
    },
    // data cannot import feature/apps
    {
      name: "data-downstream",
      severity: "error",
      from: { path: "^packages/data-client" },
      to: { path: "^(packages/feature-|apps/)" },
    },
    // feature cannot import apps
    {
      name: "feature-downstream",
      severity: "error",
      from: { path: "^packages/feature-" },
      to: { path: "^apps/" },
    },
  ],
};
```

**package.json (root)**

```json
{
  "scripts": {
    "dep:check": "depcruise --ts-config tsconfig.base.json --exclude '^node_modules' ."
  }
}
```

### eslint-plugin-boundaries (developer feedback in editor)

**eslint.config.js**

```js
import boundaries from "eslint-plugin-boundaries";

export default [
  { ignores: ["dist/**", "node_modules/**"] },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { boundaries },
    rules: {
      "boundaries/element-types": [
        2,
        {
          default: "disallow",
          rules: [
            {
              from: ["apps"],
              allow: [
                "packages/feature-*",
                "packages/ui-kit",
                "packages/types",
              ],
            },
            {
              from: ["packages/feature-*"],
              allow: [
                "packages/data-client",
                "packages/domain-*",
                "packages/utils",
                "packages/ui-kit",
                "packages/types",
              ],
            },
            {
              from: ["packages/data-client"],
              allow: ["packages/domain-*", "packages/utils", "packages/types"],
            },
            {
              from: ["packages/domain-*"],
              allow: ["packages/utils", "packages/types"],
            },
            { from: ["packages/utils"], allow: ["packages/types"] },
            { from: ["packages/types"], allow: [] },
          ],
        },
      ],
    },
    settings: {
      "boundaries/include": ["packages/*/src", "apps/*/src"],
      "boundaries/elements": [
        { type: "apps", pattern: "apps/*" },
        { type: "packages/feature-*", pattern: "packages/feature-*/**" },
        { type: "packages/data-client", pattern: "packages/data-client/**" },
        { type: "packages/domain-*", pattern: "packages/domain-*/**" },
        { type: "packages/utils", pattern: "packages/utils/**" },
        { type: "packages/types", pattern: "packages/types/**" },
        { type: "packages/ui-kit", pattern: "packages/ui-kit/**" },
      ],
    },
  },
];
```

> Since you **don’t use path aliases**, boundaries/dep-cruiser rely purely on folder paths. Keep imports **relative** (e.g., `"../../domain-music/src/normalize"`).

---

## Turborepo Pipelines

```json
// turbo.json
{
  "pipeline": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "lint": {},
    "test": { "dependsOn": ["^build"] },
    "e2e": { "dependsOn": ["build"], "cache": false },
    "check:deps": {}
  }
}
```

**Root scripts**

```json
{
  "scripts": {
    "build": "turbo run build",
    "lint": "eslint .",
    "test": "turbo run test",
    "e2e": "turbo run e2e --filter=apps/demo-music",
    "dep:check": "depcruise --ts-config tsconfig.base.json --exclude '^node_modules' .",
    "prepush": "pnpm run lint && pnpm run test && pnpm run dep:check"
  }
}
```

---

## Incremental Migration Plan

1. Lock the schema: move your `Song` schema into `packages/types`.
2. Route all ingest through `normalizeSong` → write to IDB (`songs` store).
3. Port your existing HTTP + WebSocket sync to a `RemoteProvider` implementation, then `startSync()` in `apps/web`.
4. Replace any direct `fetch` or IDB calls in features with `data-client` hooks.
5. Introduce virtualized lists for songs first; then add derived Artist/Album/Genre views using domain aggregations.
6. Turn on **dep-cruiser** + **boundaries** in CI; fix violations.
7. Add Playwright tests in `apps/demo-music` to lock scrolling/filter/sort behavior.

---

## Appendix: Minimal Virtualizer Helper

```tsx
// packages/feature-library/src/VirtualList.tsx
import { createVirtualizer } from "@solid-primitives/virtual";

export function VirtualList(props: {
  count: () => number;
  height?: number;
  row: (i: number) => JSX.Element;
}) {
  let el!: HTMLDivElement;
  const est = () => props.height ?? 56;
  const v = createVirtualizer({
    count: props.count,
    estimateSize: est,
    parentRef: () => el,
  });

  return (
    <div ref={el} class="h-[80vh] overflow-auto">
      <div style={{ position: "relative", height: `${v.totalSize}px` }}>
        {v.virtualItems().map((item) => (
          <div
            style={{
              position: "absolute",
              top: `${item.start}px`,
              height: `${est()}px`,
              left: 0,
              right: 0,
            }}
          >
            {props.row(item.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
```

Use it in Song/Artist/Album/Genre screens by passing `count` and `row` lambdas.

---

### Final Notes

- Keep **no aliases** and **no localforage**—this doc’s examples are all relative imports and raw IndexedDB.
- The **data-client** is your seam: switch remote backends by swapping the `RemoteProvider` without touching features.
- Collections (Artists/Albums/Genres) are **derived** from `Song` and computed in **domain**.
- With **one-way deps enforced in CI**, your codebase stays clean as it grows.

# Monorepo Blueprint (Expanded): Editing, Context Menus, Offline Cache, Album Materialization, Multi‑Remote

**Constraints carried over**

- No `localforage`.
- No import aliases (relative imports only).
- Primary DB model = **`Song`**; Artist/Album/Genre derived from song props.
- Pluggable remotes (HTTP + WebSocket) via a `RemoteProvider` interface.
- Solid.js + IndexedDB + `@solid-primitives/virtual`.

This addendum deepens the blueprint with:

1. An **Edit Song Modal** that can batch‑edit and re-render lists behind it.
2. **Reusable row / tile components + context menus** that mutate data.
3. **Offline cache** (images/audio) management: size, purge by age/size, and “Downloaded” view.
4. **Album materialization** in IndexedDB, including album-first sorting rules.
5. **Multi‑remote** data handling and browsing/queueing across remotes.

---

## 1) Edit Song Modal (batch edits + behind-the-modal updates)

### Domain: Patch shape (pure)

```ts
// packages/domain-music/src/patch.ts
import type { SongRow } from "./normalize";

export type SongPatch = Partial<
  Pick<
    SongRow,
    | "title"
    | "artist"
    | "album"
    | "album_artist"
    | "track_number"
    | "disc_number"
    | "duration_seconds"
    | "genre"
    | "sub_genres"
    | "year"
    | "bpm"
    | "key_signature"
    | "tags"
    | "user_rating"
    | "user_is_favorite"
  >
>;

export function applyPatch(song: SongRow, patch: SongPatch): SongRow {
  const next = { ...song, ...patch };
  // re-derive denormalized fields if primary props changed
  if (patch.title) next.title_lower = next.title.toLocaleLowerCase();
  if (patch.artist) next.artist_lower = next.artist.toLocaleLowerCase();
  if (patch.album) next.album_lower = next.album.toLocaleLowerCase();
  if (patch.genre !== undefined)
    next.genre_lower = next.genre ? next.genre.toLocaleLowerCase() : null;
  return next;
}
```

### Data‑client: Batch update + invalidation

```ts
// packages/data-client/src/batch.ts
import { tx } from "./idb-db";
import { invalidate } from "./invalidate";
import { applyPatch, type SongPatch } from "../../domain-music/src/patch";

export async function patchSongs(ids: string[], patch: SongPatch) {
  await tx(["songs"], "readwrite", async ({ songs }) => {
    await Promise.all(
      ids.map(
        (id) =>
          new Promise<void>((res, rej) => {
            const get = songs.get(id);
            get.onsuccess = () => {
              const cur = get.result;
              if (!cur) return res(); // skip missing
              const next = applyPatch(cur, patch);
              const put = songs.put(next);
              put.onsuccess = () => res();
              put.onerror = () => rej(put.error);
            };
            get.onerror = () => rej(get.error);
          }),
      ),
    );
  });
  invalidate("songs"); // lists behind modal re-run their queries
}
```

### Feature: EditSongModal

```tsx
// packages/feature-library/src/EditSongModal.tsx
import { createSignal } from "solid-js";
import { patchSongs } from "../../data-client/src/batch";

export function EditSongModal(props: { ids: string[]; onClose: () => void }) {
  const [form, setForm] = createSignal({
    title: "",
    artist: "",
    album: "",
    genre: "",
    tags: "", // simple example
  });

  async function onSave() {
    const patch: any = {};
    if (form().title) patch.title = form().title;
    if (form().artist) patch.artist = form().artist;
    if (form().album) patch.album = form().album;
    if (form().genre) patch.genre = form().genre;
    if (form().tags)
      patch.tags = form()
        .tags.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    await patchSongs(props.ids, patch);
    props.onClose(); // any virtualized lists using useQuery invalidate → repaint
  }

  return (
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center">
      <div class="bg-neutral-900 p-4 rounded-xl w-[560px]">
        <h3 class="text-lg mb-3">Edit {props.ids.length} song(s)</h3>
        {/* inputs omitted for brevity */}
        <div class="mt-4 flex gap-2 justify-end">
          <button
            class="px-3 py-1 rounded bg-neutral-700"
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button class="px-3 py-1 rounded bg-blue-600" onClick={onSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
```

> Because lists read through `useQuery(["songs"], ...)`, the `invalidate("songs")` call guarantees re-rendering of any views showing those songs.

---

## 2) Reusable Song Row + Album/Playlist Tile + Context Menus

### Data‑client: common mutations

```ts
// packages/data-client/src/mutations.ts
import { tx } from "./idb-db";
import { invalidate } from "./invalidate";

export async function toggleFavorite(id: string) {
  await tx(["songs"], "readwrite", async ({ songs }) => {
    const cur = await new Promise<any>((res, rej) => {
      const r = songs.get(id);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    if (!cur) return;
    const next = { ...cur, user_is_favorite: !cur.user_is_favorite };
    await new Promise<void>((res, rej) => {
      const r = songs.put(next);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  });
  invalidate("songs");
}

// minimal stubs—wire to RemoteProvider or SW queue if desired
export async function addToPlaylist(ids: string[], playlistId: string) {
  /* ... */
}
export async function queueSongs(ids: string[]) {
  /* ... */
}
export async function deleteSongs(ids: string[]) {
  /* ... */
}
```

### Feature: Context Menu

```tsx
// packages/feature-library/src/ContextMenu.tsx
import { createSignal, Show } from "solid-js";

export type MenuItem = { label: string; action: () => void };

export function useContextMenu() {
  const [isOpen, setOpen] = createSignal(false);
  const [pos, setPos] = createSignal({ x: 0, y: 0 });
  const [items, setItems] = createSignal<MenuItem[]>([]);

  function open(e: MouseEvent, its: MenuItem[]) {
    e.preventDefault();
    setItems(its);
    setPos({ x: e.clientX, y: e.clientY });
    setOpen(true);
    const onEsc = (ev: KeyboardEvent) => ev.key === "Escape" && setOpen(false);
    const onClickAway = () => setOpen(false);
    window.addEventListener("keydown", onEsc, { once: true });
    window.addEventListener("click", onClickAway, { once: true });
  }

  return { isOpen, pos, items, open, close: () => setOpen(false) };
}

export function ContextMenu(props: {
  isOpen: () => boolean;
  pos: () => { x: number; y: number };
  items: () => MenuItem[];
}) {
  return (
    <Show when={props.isOpen()}>
      <div
        class="fixed z-50 bg-neutral-900 border border-neutral-700 rounded shadow"
        style={{ left: `${props.pos().x}px`, top: `${props.pos().y}px` }}
      >
        {props.items().map((item) => (
          <button
            class="block w-full text-left px-3 py-2 hover:bg-neutral-800"
            onClick={item.action}
          >
            {item.label}
          </button>
        ))}
      </div>
    </Show>
  );
}
```

### Reusable components

```tsx
// packages/feature-library/src/SongRow.tsx
import { useContextMenu, ContextMenu } from "./ContextMenu";
import { toggleFavorite } from "../../data-client/src/mutations";

export function SongRow(props: {
  song: any;
  onOpenEdit: (id: string) => void;
  onAddToQueue: (id: string) => void;
}) {
  const menu = useContextMenu();
  const items = () => [
    {
      label: props.song.user_is_favorite ? "Unfavorite" : "Favorite",
      action: () => toggleFavorite(props.song.id),
    },
    { label: "Add to queue", action: () => props.onAddToQueue(props.song.id) },
    { label: "Edit metadata", action: () => props.onOpenEdit(props.song.id) },
  ];

  return (
    <div
      class="h-14 flex items-center px-3 hover:bg-neutral-800"
      onContextMenu={(e) => menu.open(e, items())}
    >
      <div class="w-6 text-center">
        {props.song.user_is_favorite ? "★" : "☆"}
      </div>
      <div class="flex-1">{props.song.title}</div>
      <div class="w-64 truncate">{props.song.artist}</div>
      <div class="w-64 truncate">{props.song.album}</div>
      <ContextMenu isOpen={menu.isOpen} pos={menu.pos} items={menu.items} />
    </div>
  );
}
```

```tsx
// packages/feature-library/src/AlbumTile.tsx
import { useContextMenu, ContextMenu } from "./ContextMenu";
import { queueSongs } from "../../data-client/src/mutations";

export function AlbumTile(props: {
  album: {
    name: string;
    album_artist: string;
    year?: number | null;
    song_ids: string[];
    thumbnail_blob_id?: string | null;
  };
  onOpen: () => void;
}) {
  const menu = useContextMenu();
  const items = () => [
    { label: "Play album", action: () => queueSongs(props.album.song_ids) },
    { label: "Open album", action: props.onOpen },
  ];

  return (
    <div class="w-44" onContextMenu={(e) => menu.open(e, items())}>
      <div class="aspect-square bg-neutral-800 rounded overflow-hidden">
        {/* image render via <img src={...}/> */}
      </div>
      <div class="mt-2 text-sm font-medium truncate">{props.album.name}</div>
      <div class="text-xs text-neutral-400 truncate">
        {props.album.album_artist}
        {props.album.year ? ` • ${props.album.year}` : ""}
      </div>
      <ContextMenu isOpen={menu.isOpen} pos={menu.pos} items={menu.items} />
    </div>
  );
}
```

Because mutations go through **data‑client** and call `invalidate("songs")`, any view that depends on songs or derived collections will update.

---

## 3) Offline Cache: size, purge, and “Downloaded” view

Uses **Cache Storage API** via the **Service Worker** for images/audio and an **IDB `offline_blobs`** table to track which songs have cached files + sizes/timestamps.

### SW cache routes + message API

```js
// apps/sw/src/sw.js
import { registerRoute } from "workbox-routing";
import { StaleWhileRevalidate, CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

const IMG_CACHE = "img-cache-v1";
const AUDIO_CACHE = "audio-cache-v1";

registerRoute(
  ({ request }) => request.destination === "image",
  new StaleWhileRevalidate({
    cacheName: IMG_CACHE,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 1200,
        maxAgeSeconds: 60 * 60 * 24 * 30,
      }),
    ],
  }),
);

registerRoute(
  ({ request }) => request.destination === "audio",
  new CacheFirst({
    cacheName: AUDIO_CACHE,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 400,
        maxAgeSeconds: 60 * 60 * 24 * 90,
      }),
    ],
  }),
);

self.addEventListener("message", (event) => {
  const { type, payload } = event.data || {};
  if (type === "cache:get-info")
    (async () => event.ports[0]?.postMessage(await getCacheUsageDetails()))();
  if (type === "cache:purge")
    (async () =>
      event.ports[0]?.postMessage(await purgeCaches(payload || {})))();
});

async function getCacheUsageDetails() {
  /* as in addendum */
}
async function purgeCaches({ olderThanMs, maxBytes } = {}) {
  /* as in addendum */
}
```

### UI hooks

```ts
// packages/data-client/src/cache.ts
export async function getCacheInfo() {
  /* message channel to SW, as above */
}
export async function purgeCache(opts: {
  olderThanMs?: number;
  maxBytes?: number;
}) {
  /* as above */
}
```

### Tracking offline songs

```ts
// packages/data-client/src/idb-offline.ts
// composite key ["song_id","type"]; helpers offlineUpsert/offlineListByType
```

```ts
// packages/data-client/src/offline-hooks.ts
// useDownloadedSongs(): joins offline entries → songs by id
```

---

## 4) Album Materialization & Sorting

- Maintain **`albums`** store with derived stats and `song_ids` pointers.
- Always render lists by **albums first**, individual album detail sorts tracks `(disc_number, track_number)`.

Implementation snippets: **`reduceAlbums`**, **`rebuildAlbumsIndex`**, **album queries** shown above.

---

## 5) Multi‑Remote Strategy

- Add `remote_id` to `SongRow` and `AlbumRow` and index on it.
- A global signal `activeRemoteId` filters queries to the chosen remote.
- Sync engine runs per remote (or on-demand).
- Queue items carry `{ remote_id, song_id }`; player resolves audio via the mapped `RemoteProvider`.
- Offline downloads from any remote are shown together (Downloaded tab joins by `offline_blobs`).

---

## Done

These patterns slot into the original monorepo blueprint without aliases, keep all IO in **data‑client**, and let your UI stay thin, reusable, and reactive.
