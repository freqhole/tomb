# Offline-First Solid.js Architecture with IndexedDB, SWR, and Service Worker

Love this direction. Here’s a tidy, offline-first architecture you can drop in, with Solid’s `createResource` + `storage`, a service worker (Workbox) using stale-while-revalidate, an IndexedDB data layer, and a tiny “reactive query” system for live UI updates + virtualization.

## High-level shape

- **Data layer (IndexedDB):** typed stores for `tracks`, `albums`, `artists`, `playlists`, `playlist_items`, `favorites`, `play_history`.
- **Cache & persistence:** `localForage` for small key/value blobs (resource caches, app settings), IndexedDB tables for queryable data. `createResource({ storage })` bridges disk ↔ UI.
- **SWR fetcher:** read-through cache: return *stale* immediately (from disk), then revalidate against server and write back.
- **Mutations:** optimistic apply to IndexedDB + invalidate tags; queue network write via service worker Background Sync; reconcile on success/failure.
- **Reactivity:** a tiny invalidation bus + query helpers so components subscribe to “dimensions” (by artist, by playlist, by search term, etc).
- **Assets:** images via `staleWhileRevalidate`, audio via `CacheFirst` (with Range request support).
- **Virtualized lists:** render huge libraries with a small DOM using a Solid virtualizer.

---

## 1) Central storage module (one place)

```ts
// src/lib/storage.ts
import localforage from "localforage";

export const kv = localforage.createInstance({
  name: "music-app",
  storeName: "kv",
});

export type IDBTableSpec = { keyPath: string; indexes?: string[] };

const DB_NAME = "music-db";
const DB_VERSION = 1;

const schema: Record<string, IDBTableSpec> = {
  tracks: { keyPath: "id", indexes: ["albumId", "artistId", "title", "favorited"] },
  albums: { keyPath: "id", indexes: ["artistId", "title"] },
  artists: { keyPath: "id", indexes: ["name"] },
  playlists: { keyPath: "id", indexes: ["title"] },
  playlist_items: { keyPath: "id", indexes: ["playlistId", "trackId", "addedAt"] },
  play_history: { keyPath: "id", indexes: ["trackId", "playedAt"] },
};

let _db: IDBDatabase;
export async function db(): Promise<IDBDatabase> {
  if (_db) return _db;
  await kv.ready();
  _db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, spec] of Object.entries(schema)) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: spec.keyPath });
          spec.indexes?.forEach((ix) => store.createIndex(ix, ix));
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _db;
}

export async function tx<T>(
  storeNames: (keyof typeof schema)[],
  mode: IDBTransactionMode,
  run: (stores: Record<string, IDBObjectStore>) => Promise<T>
): Promise<T> {
  const d = await db();
  const t = d.transaction(storeNames as string[], mode);
  const stores: Record<string, IDBObjectStore> = {};
  for (const n of storeNames) stores[n] = t.objectStore(n as string);
  const res = await run(stores);
  await new Promise((r, j) => { t.oncomplete = () => r(null); t.onerror = () => j(t.error); });
  return res;
}
```

---

## 2) SWR resource helper (stale-while-revalidate)

```ts
// src/lib/swrResource.ts
import { createResource, onCleanup } from "solid-js";
import { makePersisted } from "@solid-primitives/storage";
import { kv } from "./storage";

export function createSWRResource<T>(
  key: () => string | undefined,
  fetcher: (key: string) => Promise<T>,
  opts?: { ttlMs?: number; cacheName?: string }
) {
  const ttl = opts?.ttlMs ?? 60_000;
  const cacheName = opts?.cacheName ?? "resource";

  const storage = makePersisted(
    () => {
      const [get, set] = (() => {
        let v: { value?: T; ts?: number } | undefined;
        return [
          () => v,
          (nv: { value?: T; ts?: number } | undefined) => (v = nv),
        ];
      })();
      return [get, set] as const;
    },
    { storage: kv, name: `swr:${cacheName}` }
  );

  const [data, { mutate, refetch }] = createResource(
    key,
    async (k) => {
      const cached = await kv.getItem<{ value: T; ts: number }>(`swr:${cacheName}:${k}`);
      if (cached?.value && Date.now() - cached.ts < ttl) return cached.value;
      const fresh = await fetcher(k);
      await kv.setItem(`swr:${cacheName}:${k}`, { value: fresh, ts: Date.now() });
      return fresh;
    },
    { storage }
  );

  const id = setInterval(() => key() && refetch(), ttl);
  onCleanup(() => clearInterval(id));

  return [data, { mutate, refetch }] as const;
}
```

---

## 3) Reactive queries over IndexedDB (live updates)

```ts
// src/lib/query.ts
import { createSignal, onCleanup } from "solid-js";
import { tx } from "./storage";

type Tag = "tracks" | "albums" | "artists" | "playlists" | "playlist_items" | "favorites" | "play_history";

const listeners = new Map<Tag, Set<() => void>>();
function ping(tag: Tag) { listeners.get(tag)?.forEach((fn) => fn()); }
export function invalidate(...tags: Tag[]) { tags.forEach(ping); }

export function useQuery<T>(tags: Tag[], run: () => Promise<T>) {
  const [data, setData] = createSignal<T | undefined>(undefined);
  let cancelled = false;
  async function exec() { const v = await run(); if (!cancelled) setData(v); }

  const subs = tags.map((t) => {
    const set = listeners.get(t) ?? new Set(); listeners.set(t, set);
    const fn = () => exec(); set.add(fn); return () => set.delete(fn);
  });

  exec();
  onCleanup(() => { cancelled = true; subs.forEach((u) => u()); });

  return data;
}
```

---

## 4) Mutations: optimistic → queue → reconcile

```ts
// src/lib/mutations.ts
import { tx } from "./storage";
import { invalidate } from "./query";

export async function favoriteTrack(trackId: string, yes: boolean) {
  await tx(["tracks"] as any, "readwrite", async (s) => {
    const cur = await new Promise<any>((resolve, reject) => {
      const r = s["tracks"].get(trackId); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const r = s["tracks"].put({ ...cur, favorited: yes }); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error);
    });
  });
  invalidate("tracks");

  navigator.serviceWorker?.controller?.postMessage({
    type: "enqueue-mutation",
    payload: { url: `/api/tracks/${trackId}/favorite`, method: "POST", body: { favorited: yes } }
  });
}
```

---

## 5) Service Worker (Workbox)

```js
// public/sw.js
import { registerRoute, setCatchHandler } from "workbox-routing";
import { StaleWhileRevalidate, CacheFirst } from "workbox-strategies";
import { BackgroundSyncPlugin } from "workbox-background-sync";
import { ExpirationPlugin } from "workbox-expiration";

const mutationQueue = new BackgroundSyncPlugin("mutation-queue", {
  maxRetentionTime: 24 * 60,
});

registerRoute(
  ({ url, request }) => request.method === "GET" && url.pathname.startsWith("/api/"),
  new StaleWhileRevalidate({
    cacheName: "api-cache",
    plugins: [new ExpirationPlugin({ maxEntries: 500, purgeOnQuotaError: true })],
  })
);

registerRoute(
  ({ url, request }) =>
    ["POST", "PUT", "DELETE", "PATCH"].includes(request.method) && url.pathname.startsWith("/api/"),
  new StaleWhileRevalidate({ plugins: [mutationQueue] })
);

registerRoute(
  ({ request }) => request.destination === "image",
  new StaleWhileRevalidate({
    cacheName: "img-cache",
    plugins: [new ExpirationPlugin({ maxEntries: 1000, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  })
);

registerRoute(
  ({ request }) => request.destination === "audio",
  new CacheFirst({
    cacheName: "audio-cache",
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  })
);

setCatchHandler(({ event }) => caches.match("/offline.html"));
```

---

## 6) UI hooks (Solid)

```ts
// src/features/library/useLibrary.ts
import { createSWRResource } from "@/lib/swrResource";

export const [library, { refetch: refetchLibrary }] = createSWRResource(
  () => "library-v1",
  async () => {
    const res = await fetch("/api/library");
    if (!res.ok) throw new Error("fetch library failed");
    return res.json();
  },
  { ttlMs: 5 * 60_000, cacheName: "library" }
);
```

### Virtualized list

```tsx
import { createSignal, onMount } from "solid-js";
import { createVirtualizer } from "@solid-primitives/virtual";
import { getByIndex } from "@/lib/query";

export default function TrackListByArtist(props: { artistId: string }) {
  const [rows, setRows] = createSignal<any[]>([]);
  const [offset, setOffset] = createSignal(0);
  const PAGE = 200;

  async function loadMore() {
    const chunk = await getByIndex<any>("tracks", "artistId", props.artistId, PAGE, offset());
    setRows((r) => r.concat(chunk));
    setOffset((o) => o + chunk.length);
  }

  onMount(loadMore);

  const container = document.getElementById("scroll-container")!;
  const virtualizer = createVirtualizer({
    count: () => rows().length,
    estimateSize: () => 56,
    parentRef: () => container,
  });

  return (
    <div id="scroll-container" class="h-[80vh] overflow-auto" onScroll={loadMore}>
      <div
        style={{
          height: `${virtualizer.totalSize}px`,
          position: "relative",
        }}
      >
        {virtualizer.virtualItems().map((item) => {
          const track = rows()[item.index];
          return (
            <div
              style={{
                position: "absolute",
                top: `${item.start}px`,
                height: "56px",
                left: 0,
                right: 0,
              }}
              class="flex items-center px-3 border-b border-neutral-700"
            >
              {track?.title}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

---

## 7) Putting it together

- `src/lib/storage.ts` – KV + IndexedDB helper
- `src/lib/query.ts` – invalidation + live queries
- `src/lib/swrResource.ts` – SWR persistence
- `src/lib/mutations.ts` – optimistic mutations
- `public/sw.js` – Workbox cache and background sync

---

## Extras

- Cross-tab updates via `BroadcastChannel('db')`
- Denormalize common fields for performance
- ETag / 304 handling inside SWR fetcher
- Background Sync for offline mutations
- Range requests for audio
