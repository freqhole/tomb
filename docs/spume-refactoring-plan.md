# spume refactoring plan: from monolithic client to modular pwa

## executive summary

this document outlines a comprehensive plan to refactor the existing `client/js/` codebase from a tangled monolithic structure into a clean, modular, offline-first pwa. the goal is to systematically review every file, eliminate dead code, extract reusable components, and establish a foundation for multi-domain media applications starting with music.

## areas requiring further consideration

the following areas need deeper analysis and concrete decisions before implementation:

### **1. data synchronization & conflict resolution**

**questions to resolve:**

- what happens when the same song exists on multiple remotes with different metadata?
- how do you handle offline mutations that conflict with server updates?
- should there be a "primary remote" concept for conflict resolution?
- how do you merge user data (favorites, ratings) across remotes?

**decision needed:** [ ]
**conclusion:**

songs and all remote data should be bifurcated in the user's browser indexed db. however, if a user chooses to "save offline" any songs, then they should (generally) be distinct songs (but still track which remote they came from).

offline conflicts-- i think should probably defer to remote server version, probably notify the user. but probably, no remote server mutations while offline. however, the user's local cache of songs and metadata don't really need to sync with the server (can dig into this more in the distant future).

"primary remote"-- maybe? i'll deal with this in the future.

same with merging things across remotes; would like to get to a place where user can choose to sync things between remote servers, but that's a ways off.

---

### **2. search architecture & cross-remote querying**

**questions to resolve:**

- will search be purely client-side in indexeddb or hybrid with remote queries?
- how will you handle search across multiple remotes with different capabilities?
- what about search result ranking and relevance scoring?
- how do you handle search when some remotes are offline?

**decision needed:** [ ]
**conclusion:**

oh, probably hybrid. right now it's mostly server-side. i think i can probably do most of it client side.

search across multiple remotes, and ranking relevance/score, is a distant future feature consideration, don't want to worry about that now.

if a remote is offline, then it's offline. so either the user has some stuff from that remote cached offline, or they need to wait until it's online again.

---

### **3. audio streaming & playback strategy**

**questions to resolve:**

- how will you handle progressive download for large audio files?
- what about gapless playback between tracks from different remotes?
- how do crossfade and audio processing fit into the architecture?
- what's the strategy for handling different audio formats across remotes?

**decision needed:** [ ]
**conclusion:**

progressive download should just use byte range requests, i think the browser's audio element should handle most of this?

gapless playback, crossfades not a concern right now.

modern browsers play a lot of different formats, so not trying to re-encode my music collection. if the browser can't play a song, it should just get skipped and the next thing in the queue should get played.

---

### **4. migration validation & rollback strategy**

**questions to resolve:**

- how will you verify that extracted functionality still works correctly?
- what's the concrete rollback plan if a migration breaks something?
- how do you ensure ui components don't lose functionality during refactoring?
- what's the testing strategy for partially migrated state?

**decision needed:** [ ]
**conclusion:**

i will test it myself locally; i hope that playwright tests will help us collaborate during development.

we don't really need to worry about rolling back, we're moving forward.

i guess i'll just know when ui components lose functionality? i guess i should inventory the current list of features.

playwright testing is gonna be the focus.

---

### **5. error handling & recovery patterns**

**questions to resolve:**

- what happens if indexeddb becomes corrupted or unavailable?
- how do you recover from service worker failures?
- what's the fallback strategy when all remotes are unreachable?
- how do you handle partial sync failures gracefully?

**decision needed:** [ ]
**conclusion:**

well, indexed db is ephemeral, so if it corrupts or is unavailable, then that's that. user should be able to easily enough get data from remote server to start again.

if all remotes are unreachable, user could still play and interact with offline cache!

handle partial sync failures gracefully-- hmm, hopefully the user should get ui to help fix. ideally it mostly just "works" and i really want to avoid ui when the user doesn't need to anything, or can't do anything. less is more (well, generally).

---

### **6. performance budgets & constraints**

**questions to resolve:**

- what are acceptable indexeddb query time limits?
- what virtual scroll frame rate targets should be maintained?
- what audio latency requirements need to be met?
- how do you balance storage quotas across multiple remotes?

**decision needed:** [ ]
**conclusion:**

indexeddb query time limits-- under 100ms for queries that drive ui. probably only matters for really large datasets like thousands of songs? so probably not gonna be a huge consideration.

60fps for virtual scrolling.

audio latency-- as low as possible, but honestly not sure there's much control here, the browsers audio element / web audio api should handle most of this.

storage quotas-- not a real consideration, it's the user's disk and they choose what to cache offline.
**conclusion:**

really need to get this all built and working before i worry about this stuff.

---

### **7. development workflow during migration**

**questions to resolve:**

- can you develop new music features while refactoring is ongoing?
- how do you handle dependencies between old and new code?
- what's the testing strategy for partially migrated state?
- how do you maintain development velocity during the transition?

**decision needed:** [ ]
**conclusion:**

probably won't develop new music features during migration; focusing on the refactor is the priority.

old vs new code dependencies-- will handle case by case. might have some duplication for a period of time.

playwright testing strategy should help with partially migrated state.

development velocity during transition-- probably will be quite slow, but that's okay, the goal is to get to a much better foundation.
**conclusion:**

i hope so?

we're moving forward, and forward we will go. playwright will help us test.

---

### **8. user experience & accessibility standards**

**questions to resolve:**

- what are the specific wcag 2.1 aa compliance requirements?
- how will keyboard navigation work across virtualized lists?
- what screen reader support is needed for audio controls?
- how do you handle reduced motion preferences in animations?

**decision needed:** [ ]
**conclusion:**

wcag 2.1 aa-- keyboard navigation, screen reader support, color contrast, reduced motion.

keyboard navigation for virtualized lists-- arrow keys, home/end, page up/down. should be pretty standard.

screen reader support for audio controls-- proper aria labels, live regions for playback status.

reduced motion-- `prefers-reduced-motion` css media query to disable animations.
**conclusion:**

this is important! but it has to come later.

---

## current state analysis

### problems identified

- **massive code accumulation**: years of development have created a sprawling codebase with extensive duplication
- **dead/legacy code**: many files contain outdated examples, unused components, and experimental code
- **duplication**: similar functionality implemented multiple times across different files
- **tight coupling**: ui, business logic, and data access are intermingled
- **single remote limitation**: architecture assumes one api server
- **no offline strategy**: limited indexeddb usage, no service worker implementation
- **inconsistent patterns**: multiple approaches to data loading, state management, and virtualization

### existing asset inventory

from preliminary analysis of `client/js/`, key areas to evaluate:

**core infrastructure:**

- `src/lib/api-client.ts` - main api communication layer
- `src/lib/websocket-*.ts` - real-time communication
- `src/sync/` - data synchronization logic (complex, needs simplification)

**music domain:**

- `src/views/freqhole/` - main music application
- `src/lib/music/` - music business logic
- player components, collection management, analytics

**supporting systems:**

- `src/components/` - shared ui components
- `src/hooks/` - react-style hooks for solid.js
- test files, examples, and utilities

## target architecture overview

### folder structure

```
spume/
├── lib/                          # core business logic & data
│   ├── core/                     # cross-domain foundations
│   │   ├── storage/              # indexeddb abstractions
│   │   ├── sync/                 # multi-remote synchronization
│   │   ├── api/                  # base api client patterns
│   │   ├── cache/                # service worker & caching
│   │   └── types/                # shared type definitions
│   ├── music/                    # music domain logic
│   │   ├── data/                 # music-specific data access
│   │   ├── api/                  # music api providers
│   │   ├── sync/                 # music synchronization
│   │   ├── domain/               # pure business logic
│   │   ├── schemas/              # zod validation schemas
│   │   ├── audio-player/         # playback engine
│   │   ├── collections/          # collection browsing
│   │   ├── playlists/            # playlist management
│   │   ├── search/               # search & filtering
│   │   └── analytics/            # usage analytics
│   └── utils/                    # pure utility functions
├── views/                        # presentation layer
│   ├── core/                     # application shell
│   │   ├── components/           # shell ui components
│   │   ├── context/              # global app context
│   │   ├── hooks/                # app-level hooks
│   │   ├── routes/               # root routing
│   │   └── themes/               # theming system (tailwind-based)
│   └── music/                    # music-specific views (/music/ base route)
│       ├── components/           # music ui components
│       │   ├── desktop/          # desktop-specific compositions
│       │   ├── mobile/           # mobile-specific compositions
│       │   └── shared/           # shared components
│       ├── context/              # music domain context
│       ├── hooks/                # music-specific hooks
│       ├── routes/               # music hash routing with scroll restoration
│       └── store/                # music state management
├── testing/                      # test infrastructure
│   ├── playwright/               # e2e tests
│   ├── fixtures/                 # test data
│   └── utils/                    # test utilities
└── public/                       # static assets
    ├── sw.js                     # service worker
    ├── manifest.json             # pwa manifest
    └── icons/                    # pwa icons
```

### core architectural principles

1. **multi-remote first**: support multiple heterogeneous music servers
2. **offline-first**: full functionality without network connectivity
3. **indexeddb foundation**: all data flows through structured local storage
4. **progressive loading**: lazy-load modules and data as needed
5. **type safety**: zod-based schemas for all data models
6. **functional approach**: prefer pure functions over classes
7. **clean separation**: strict boundaries between data, business logic, and ui
8. **user-controlled caching**: explicit user control over offline storage
9. **remote server clarity**: clean, well-documented api interface for easy integration
10. **responsive without branching**: separate mobile/desktop components, not conditional rendering
11. **scroll restoration**: preserve navigation state across route changes
12. **batch operations**: multi-select and bulk editing capabilities

## phase-by-phase implementation plan

### phase 0: current state inventory & feature audit

**objective**: catalog all existing functionality to ensure nothing is lost during refactoring

**current feature inventory:**

**core infrastructure:**

- [ ] **api client**: http requests, authentication, error handling
- [ ] **websocket client**: real-time updates, connection management
- [ ] **sync engine**: data synchronization logic (complex, needs simplification)
- [ ] **blob storage**: audio file and image handling
- [ ] **analytics**: usage tracking and metrics

**music domain features:**

- [ ] **audio player**: play/pause, seek, volume, queue management
- [ ] **player persistence**: queue and currently playing persisted to indexeddb
- [ ] **media session**: browser controls, lock screen integration
- [ ] **collections**: songs, albums, artists, genres browsing
- [ ] **search**: full-text search across music library
- [ ] **playlists**: create, edit, delete, reorder tracks
- [ ] **favorites**: mark songs/albums as favorites
- [ ] **ratings**: 5-star rating system for songs
- [ ] **play history**: track listening history, persisted to indexeddb
- [ ] **virtualized lists**: infinite scrolling for large collections
- [ ] **sorting**: multiple sort options for collections
- [ ] **filtering**: filter by genre, year, etc.
- [ ] **musicbrainz integration**: metadata lookup and enrichment
- [ ] **batch editing**: select multiple songs (ctrl/shift) and edit metadata
- [ ] **hash routing**: `/music/` base route with detail routes for artists, albums, playlists

**ui components:**

- [ ] **player controls**: transport controls, progress bar, volume
- [ ] **song rows**: track listing with metadata
- [ ] **album tiles**: grid view for albums
- [ ] **context menus**: right-click actions
- [ ] **modals**: edit song metadata, create playlist
- [ ] **batch edit modal**: edit multiple songs at once
- [ ] **navigation**: sidebar, breadcrumbs, hash routing
- [ ] **scroll restoration**: preserve scroll position across navigation
- [ ] **responsive design**: separate mobile/desktop compositions, not branching
- [ ] **tailwind css**: utility-first styling system

**user features:**

- [ ] **profile management**: user settings and preferences
- [ ] **theme system**: dark theme (light theme future consideration)
- [ ] **keyboard shortcuts**: hotkeys for common actions, ctrl/shift multi-select
- [ ] **drag and drop**: reorder playlists, add to queue
- [ ] **selection state**: multi-select with keyboard modifiers

**tasks:**

- [ ] **complete inventory**: review every component and feature in current codebase
- [ ] **categorize features**: group by domain (core, music, ui, user)
- [ ] **identify dependencies**: map how features interact with each other
- [ ] **assess complexity**: mark which features will be easy/hard to migrate
- [ ] **document api surface**: catalog current remote server interactions
- [ ] **responsive patterns**: catalog mobile vs desktop component variations
- [ ] **routing inventory**: map current hash routes and scroll positions

### phase 1: foundation infrastructure & remote server interface

#### 1.1 remote server api specification & reference implementation

**objective**: define clear, well-documented interface for remote server integration

**remote server api specification:**

```typescript
// lib/core/api/remote-server-spec.ts

// server info endpoint: GET /api/info
export const ServerInfo = z.object({
  id: z.string(), // unique server identifier
  name: z.string(), // human-readable server name
  version: z.string(), // api version
  features: z.array(
    z.enum([
      "music-library", // basic music browsing
      "search", // full-text search
      "playlists", // playlist management
      "user-data", // favorites, ratings, history
      "real-time", // websocket updates
      "analytics", // usage tracking
      "upload", // file upload
      "transcoding", // audio format conversion
      "musicbrainz", // metadata enrichment
    ]),
  ),
  auth: z.object({
    required: z.boolean(),
    methods: z.array(z.enum(["passkey", "password", "oauth"])),
  }),
  endpoints: z.object({
    base: z.string(), // base url for api
    websocket: z.string().optional(), // websocket url if supported
  }),
});

// authentication: POST /api/auth
export const AuthRequest = z.object({
  method: z.enum(["passkey", "password"]),
  credentials: z.record(z.string()), // flexible credential format
});

export const AuthResponse = z.object({
  token: z.string(),
  expires: z.string(), // iso date
  user: z.object({
    id: z.string(),
    name: z.string(),
  }),
});

// music library: GET /api/music/songs
export const SongQueryParams = z.object({
  limit: z.number().optional(),
  offset: z.number().optional(),
  artist: z.string().optional(),
  album: z.string().optional(),
  genre: z.string().optional(),
  search: z.string().optional(),
});

export const Song = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  track_number: z.number().optional(),
  disc_number: z.number().optional(),
  duration_seconds: z.number(),
  genre: z.string().optional(),
  year: z.number().optional(),
  musicbrainz_id: z.string().optional(), // musicbrainz integration
  user_rating: z.number().min(0).max(5).optional(),
  user_is_favorite: z.boolean().default(false),
  // ... rest of song schema
});
```

**reference server implementation:**

```javascript
// reference-server/server.js (simple express server)
const express = require("express");
const app = express();

// server info endpoint
app.get("/api/info", (req, res) => {
  res.json({
    id: "reference-music-server",
    name: "reference music server",
    version: "1.0.0",
    features: ["music-library", "search", "musicbrainz"],
    auth: { required: false, methods: [] },
    endpoints: { base: "http://localhost:3000/api" },
  });
});

// basic music library endpoint
app.get("/api/music/songs", (req, res) => {
  // return sample songs for testing
  res.json({ songs: sampleSongs, total: sampleSongs.length });
});
```

**tasks:**

- [ ] **complete api specification**: define all endpoints with zod schemas
- [ ] **reference server**: build simple javascript implementation for testing
- [ ] **api documentation**: generate docs from zod schemas
- [ ] **integration tests**: test client against reference server

#### 1.2 project setup & build system

**objective**: establish clean build pipeline for modern pwa

**tasks:**

- [ ] **vite configuration**: set up optimized build with proper chunking
  - single js bundle for main app
  - separate css bundle
  - service worker as standalone file
  - asset optimization (images, icons)
- [ ] **pwa manifest**: complete manifest.json with proper metadata
- [ ] **simple ci/cd pipeline**: github actions for build, test, deploy
  - version management with semantic versioning
  - automated deployment to cloudflare pages
  - basic build artifact caching
- [ ] **typescript configuration**: strict types, proper paths
- [ ] **eslint/prettier**: code quality enforcement
- [ ] **bundle analysis**: size monitoring and optimization
- [ ] **tailwind css**: utility-first styling configuration

**key deliverables:**

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["solid-js"],
          utils: ["src/lib/utils"],
        },
      },
    },
  },
  plugins: [
    solidPlugin(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
    }),
  ],
});
```

#### 1.3 indexeddb foundation with solid-js resources

**objective**: create robust, typed indexeddb layer with reactive queries

**core types:**

```typescript
// lib/core/types/storage.ts
export interface RemoteConfig {
  id: string;
  name: string;
  baseUrl: string;
  capabilities: RemoteCapabilities;
  auth: AuthConfig;
  syncStrategy: "full" | "incremental" | "manual";
  lastSync: Date | null;
  enabled: boolean;
}

export interface RemoteCapabilities {
  modules: ("search" | "playlists" | "analytics" | "social")[];
  dataTypes: ("songs" | "albums" | "artists" | "genres")[];
  streaming: boolean;
  upload: boolean;
  realtime: boolean;
}

export interface StorageSchema {
  // core application data
  remotes: RemoteConfig;
  sync_log: SyncLogEntry;

  // music domain (remote-partitioned)
  songs: Song & { remote_id: string };
  albums: Album & { remote_id: string };
  playlists: Playlist & { remote_id: string };

  // user data (cross-remote)
  user_favorites: UserFavorite;
  user_ratings: UserRating;
  play_history: PlayHistory;

  // player state persistence
  player_queue: PlayerQueueEntry;
  player_state: PlayerState;

  // ui state persistence
  scroll_positions: ScrollPosition;
}
```

**reactive storage implementation:**

```typescript
// lib/core/storage/reactive-storage.ts
export function createStorageResource<T>(
  storeName: keyof StorageSchema,
  query?: QueryOptions,
) {
  const [data, { mutate, refetch }] = createResource(
    () => ({ storeName, query }),
    async ({ storeName, query }) => {
      return await queryStore(storeName, query);
    },
  );

  // subscribe to changes for this store
  const cleanup = subscribeToStoreChanges(storeName, () => {
    refetch();
  });

  onCleanup(cleanup);

  return [data, { mutate, refetch }] as const;
}

// invalidation bus for triggering updates
const storeListeners = new Map<string, Set<() => void>>();

export function invalidateStore(storeName: string) {
  const listeners = storeListeners.get(storeName);
  if (listeners) {
    listeners.forEach((fn) => fn());
  }
}

export function subscribeToStoreChanges(
  storeName: string,
  callback: () => void,
): () => void {
  if (!storeListeners.has(storeName)) {
    storeListeners.set(storeName, new Set());
  }

  const listeners = storeListeners.get(storeName)!;
  listeners.add(callback);

  return () => listeners.delete(callback);
}
```

**user-controlled caching:**

```typescript
// lib/core/cache/user-cache-control.ts
export interface CacheEntry {
  id: string;
  type: "audio" | "image" | "data";
  remoteId: string;
  size: number;
  cachedAt: Date;
  userSaved: boolean; // user explicitly saved this offline
}

export function createUserCacheControl() {
  const [cacheEntries] = createStorageResource("cache_entries");

  const saveOffline = async (itemId: string, type: CacheEntry["type"]) => {
    // mark as user-saved, prevent automatic eviction
    await updateCacheEntry(itemId, { userSaved: true });

    // if not already cached, trigger download
    if (!(await isCached(itemId))) {
      await downloadForOffline(itemId, type);
    }
  };

  const removeFromOffline = async (itemId: string) => {
    await updateCacheEntry(itemId, { userSaved: false });
    // note: actual removal happens during cache maintenance
  };

  const purgeRemote = async (remoteId: string) => {
    const entries =
      cacheEntries()?.filter((e) => e.remoteId === remoteId) || [];
    await Promise.all(entries.map((entry) => removeCacheEntry(entry.id)));
  };

  const purgeAll = async () => {
    await clearAllCaches();
    await clearIndexedDB();
  };

  return {
    cacheEntries,
    saveOffline,
    removeFromOffline,
    purgeRemote,
    purgeAll,
  };
}
```

**tasks:**

- [ ] **schema design**: define all tables with proper indexes
- [ ] **migration system**: version-based schema upgrades
- [ ] **remote partitioning**: data isolation by remote source
- [ ] **reactive queries**: solid-js resources with automatic invalidation
- [ ] **transaction management**: proper error handling and rollbacks
- [ ] **user cache control**: explicit offline storage management

#### 1.4 service worker & user-controlled caching

**objective**: implement offline-first caching with user control

**cache strategy matrix:**
| resource type | strategy | user control | size limit |
|---------------|----------|--------------|------------|
| audio files | cache first | explicit save/remove | 2gb |
| images | stale while revalidate | automatic + user override | 500mb |
| api data | network first w/ fallback | automatic | 100mb |
| app shell | precache | automatic | 10mb |

**service worker implementation:**

```typescript
// public/sw.ts
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import {
  CacheFirst,
  StaleWhileRevalidate,
  NetworkFirst,
} from "workbox-strategies";

declare let self: ServiceWorkerGlobalScope;

// precache app shell
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// audio caching with user control
registerRoute(
  ({ request, url }) => {
    return (
      request.destination === "audio" &&
      url.searchParams.has("cache") === "user"
    );
  },
  new CacheFirst({
    cacheName: "user-audio-cache",
    plugins: [
      {
        cacheKeyWillBeUsed: async ({ request }) => {
          // handle range requests properly
          return new URL(request.url).pathname;
        },
      },
    ],
  }),
);

// handle user cache control messages
self.addEventListener("message", async (event) => {
  if (event.data.type === "CACHE_AUDIO") {
    const { url } = event.data;
    await caches.open("user-audio-cache").then((cache) => cache.add(url));
  }

  if (event.data.type === "REMOVE_FROM_CACHE") {
    const { url } = event.data;
    await caches.open("user-audio-cache").then((cache) => cache.delete(url));
  }
});
```

**tasks:**

- [ ] **audio range requests**: proper http 206 support for streaming
- [ ] **user cache control**: explicit save/remove functionality
- [ ] **cache management**: size limits, user-controlled eviction
- [ ] **update notifications**: detect new app versions
- [ ] **offline fallbacks**: meaningful offline pages and error states

#### 1.5 multi-remote architecture

**objective**: create flexible system for connecting to multiple music servers

**remote provider interface:**

```typescript
// lib/core/api/remote-provider.ts
export interface RemoteProvider {
  readonly id: string;
  readonly capabilities: RemoteCapabilities;

  // connection management
  connect: (config: RemoteConfig) => Promise<void>;
  disconnect: () => Promise<void>;
  isConnected: () => boolean;

  // data synchronization
  sync: (strategy: SyncStrategy) => Promise<SyncResult>;

  // real-time updates (if supported)
  subscribe: (callback: (event: RemoteEvent) => void) => () => void;

  // data access
  query: <T>(endpoint: string, params?: any) => Promise<T>;
  mutate: <T>(endpoint: string, data: any) => Promise<T>;
}
```

**remote registry:**

```typescript
// lib/core/api/remote-registry.ts
const providers = new Map<string, RemoteProvider>();

export const registerProvider = (provider: RemoteProvider) => {
  providers.set(provider.id, provider);
};

export const getProvider = (id: string): RemoteProvider | null => {
  return providers.get(id) || null;
};

export const getAllProviders = (): RemoteProvider[] => {
  return Array.from(providers.values());
};

// capability-based querying
export const findByCapability = (capability: string): RemoteProvider[] => {
  return getAllProviders().filter((p) =>
    p.capabilities.modules.includes(capability as any),
  );
};

export const supportsModule = (remoteId: string, module: string): boolean => {
  const provider = getProvider(remoteId);
  return provider?.capabilities.modules.includes(module as any) || false;
};
```

**tasks:**

- [ ] **provider implementations**: http rest, websocket, local file system
- [ ] **capability negotiation**: module detection and graceful fallbacks
- [ ] **connection health**: monitor and retry failed connections
- [ ] **data conflicts**: handle overlapping data from multiple sources
- [ ] **user management**: ui for adding/configuring remotes

### phase 2: application shell & remote setup ui

**completion criteria:**

- app shows loading animation during initialization
- user can add/remove remote server configurations
- app validates remote server connectivity and capabilities
- remote configurations persist in indexeddb
- app gracefully handles connection failures

#### 2.1 application initialization with remote setup

**objective**: create robust app startup sequence with proper loading states

**initialization flow:**

```typescript
// views/core/context/app-initialization.tsx
export interface InitializationStep {
  id: string;
  label: string;
  execute: () => Promise<void>;
  optional?: boolean;
  timeout?: number;
}

export function createAppInitializer() {
  const steps: InitializationStep[] = [
    {
      id: "storage",
      label: "initializing storage...",
      execute: async () => {
        await initStorage();
        await migrateStorage();
      },
    },
    {
      id: "remotes",
      label: "connecting to music servers...",
      execute: async () => {
        const configs = await queryEnabledRemotes();
        await Promise.allSettled(
          configs.map((config) => connectRemote(config)),
        );
      },
    },
    {
      id: "sync",
      label: "synchronizing music library...",
      execute: async () => {
        await performInitialSync();
      },
      optional: true,
    },
  ];

  const [status, setStatus] = createSignal<"initializing" | "ready" | "error">(
    "initializing",
  );
  const [progress, setProgress] = createSignal(0);
  const [currentStep, setCurrentStep] = createSignal<string>("");

  const initialize = async () => {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      setCurrentStep(step.label);

      try {
        await step.execute();
        setProgress(((i + 1) / steps.length) * 100);
      } catch (error) {
        if (!step.optional) {
          setStatus("error");
          throw error;
        }
      }
    }

    setStatus("ready");
  };

  return { initialize, status, progress, currentStep };
}

// first-time setup flow for adding remotes
export function createFirstTimeSetup() {
  const [remotes, setRemotes] = createSignal<RemoteConfig[]>([]);
  const [currentStep, setCurrentStep] = createSignal<
    "welcome" | "add-remote" | "validate" | "complete"
  >("welcome");

  const addRemote = async (url: string, name?: string) => {
    try {
      // validate server by fetching /api/info
      const response = await fetch(`${url}/api/info`);
      const serverInfo = ServerInfo.parse(await response.json());

      const config: RemoteConfig = {
        id: crypto.randomUUID(),
        serverId: serverInfo.id,
        name: name || serverInfo.name,
        baseUrl: url,
        capabilities: {
          modules: serverInfo.features,
          dataTypes: ["songs", "albums", "artists", "genres"],
          streaming: true,
          upload: serverInfo.features.includes("upload"),
          realtime: serverInfo.features.includes("real-time"),
        },
        auth: {
          required: serverInfo.auth.required,
          token: null,
        },
        syncStrategy: "incremental",
        lastSync: null,
        enabled: true,
      };

      setRemotes((prev) => [...prev, config]);
      await saveRemoteConfig(config);
    } catch (error) {
      throw new Error(`failed to connect to server: ${error.message}`);
    }
  };

  return { remotes, currentStep, setCurrentStep, addRemote };
}
```

**loading animation:**

```typescript
// views/core/components/loading-animation.tsx
export function LoadingAnimation(props: {
  status: 'initializing' | 'ready' | 'error';
  progress: number;
  currentStep: string;
  error?: Error;
}) {
  return (
    <div class="loading-container">
      <div class="logo-animation">
        {/* custom svg animation */}
      </div>
      <div class="progress-bar">
        <div
          class="progress-fill"
          style={{ width: `${props.progress}%` }}
        />
      </div>
      <div class="status-text">{props.currentStep}</div>
      {props.error && (
        <div class="error-state">
          <div class="error-message">
            {props.error.message}
          </div>
          <button onClick={() => window.location.reload()}>
            retry
          </button>
        </div>
      )}
    </div>
  );
}
```

**tasks:**

- [ ] **initialization orchestrator**: manage startup sequence with proper error handling
- [ ] **loading ui**: clean, responsive loading animation with dark theme
- [ ] **error recovery**: graceful handling of initialization failures
- [ ] **progress tracking**: real-time feedback on startup progress
- [ ] **timeout handling**: prevent hanging on network issues

#### 2.2 routing & scroll restoration

**objective**: implement hash routing with scroll position persistence

**routing setup:**

```typescript
// views/music/routes/music-routes.tsx
import { Router, Route, Routes } from '@solidjs/router';

export function MusicRoutes() {
  return (
    <Routes>
      <Route path="/music" component={MusicLayout}>
        <Route path="/albums" component={AlbumsListPage} />
        <Route path="/albums/:id" component={AlbumDetailPage} />
        <Route path="/artists" component={ArtistsListPage} />
        <Route path="/artists/:id" component={ArtistDetailPage} />
        <Route path="/playlists" component={PlaylistsListPage} />
        <Route path="/playlists/:id" component={PlaylistDetailPage} />
        <Route path="/genres" component={GenresListPage} />
        <Route path="/search" component={SearchPage} />
      </Route>
    </Routes>
  );
}
```

**scroll restoration:**

```typescript
// lib/core/hooks/use-scroll-restoration.ts
export function useScrollRestoration(routeKey: string) {
  const [scrollPosition, setScrollPosition] = createSignal(0);
  let containerRef: HTMLElement;

  // restore scroll position when component mounts
  onMount(async () => {
    const stored = await getStoredScrollPosition(routeKey);
    if (stored && containerRef) {
      containerRef.scrollTop = stored;
      setScrollPosition(stored);
    }
  });

  // save scroll position on navigation
  const saveScrollPosition = debounce(async (position: number) => {
    await storeScrollPosition(routeKey, position);
    setScrollPosition(position);
  }, 150);

  const onScroll = (e: Event) => {
    const target = e.target as HTMLElement;
    saveScrollPosition(target.scrollTop);
  };

  return {
    scrollPosition,
    onScroll,
    containerRef: (el: HTMLElement) => {
      containerRef = el;
    },
  };
}
```

#### 2.3 responsive design patterns

**objective**: separate mobile/desktop compositions without conditional branching

**responsive component pattern:**

```typescript
// views/music/components/albums-list.tsx
export function AlbumsList() {
  const [isMobile] = useMediaQuery('(max-width: 768px)');

  return (
    <Switch>
      <Match when={isMobile()}>
        <MobileAlbumsList />
      </Match>
      <Match when={!isMobile()}>
        <DesktopAlbumsList />
      </Match>
    </Switch>
  );
}

// separate components for each layout
// views/music/components/mobile/mobile-albums-list.tsx
export function MobileAlbumsList() {
  const scroll = useScrollRestoration('albums-mobile');

  return (
    <div ref={scroll.containerRef} onScroll={scroll.onScroll}>
      {/* mobile-specific layout */}
    </div>
  );
}

// views/music/components/desktop/desktop-albums-list.tsx
export function DesktopAlbumsList() {
  const scroll = useScrollRestoration('albums-desktop');

  return (
    <div ref={scroll.containerRef} onScroll={scroll.onScroll}>
      {/* desktop-specific layout */}
    </div>
  );
}
```

#### 2.4 remote management ui

**objective**: create ui for managing remote server connections

**remote setup components:**

```typescript
// views/core/components/remote-setup.tsx
export function RemoteSetupWizard() {
  const setup = createFirstTimeSetup();

  return (
    <div class="setup-wizard">
      <Switch>
        <Match when={setup.currentStep() === 'welcome'}>
          <WelcomeStep onNext={() => setup.setCurrentStep('add-remote')} />
        </Match>
        <Match when={setup.currentStep() === 'add-remote'}>
          <AddRemoteStep
            onAddRemote={setup.addRemote}
            onNext={() => setup.setCurrentStep('validate')}
          />
        </Match>
        <Match when={setup.currentStep() === 'validate'}>
          <ValidateRemotesStep
            remotes={setup.remotes()}
            onComplete={() => setup.setCurrentStep('complete')}
          />
        </Match>
        <Match when={setup.currentStep() === 'complete'}>
          <SetupCompleteStep />
        </Match>
      </Switch>
    </div>
  );
}

export function AddRemoteStep(props: {
  onAddRemote: (url: string, name?: string) => Promise<void>;
  onNext: () => void;
}) {
  const [url, setUrl] = createSignal('');
  const [name, setName] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const handleAdd = async () => {
    if (!url()) return;

    setLoading(true);
    setError(null);

    try {
      await props.onAddRemote(url(), name() || undefined);
      setUrl('');
      setName('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="add-remote-step">
      <h2>add music server</h2>
      <div class="form-fields">
        <input
          type="url"
          placeholder="server url (e.g., https://myserver.com)"
          value={url()}
          onInput={(e) => setUrl(e.target.value)}
        />
        <input
          type="text"
          placeholder="server name (optional)"
          value={name()}
          onInput={(e) => setName(e.target.value)}
        />
      </div>

      {error() && <div class="error-message">{error()}</div>}

      <div class="actions">
        <button onClick={handleAdd} disabled={loading() || !url()}>
          {loading() ? 'connecting...' : 'add server'}
        </button>
        <button onClick={props.onNext}>
          continue
        </button>
      </div>
    </div>
  );
}
```

#### 2.5 application shell architecture

**objective**: create flexible shell that can accommodate multiple domains

**shell structure:**

```typescript
// views/core/components/app-shell.tsx
export interface AppShellProps {
  domains: DomainConfig[];
  currentDomain: string;
  user?: User;
}

export interface DomainConfig {
  id: string;
  name: string;
  icon: JSX.Element;
  routes: RouteDefinition[];
  modules: string[];
  enabled: boolean;
}

export function AppShell(props: AppShellProps) {
  return (
    <div class="app-shell">
      <Navigation
        domains={props.domains}
        current={props.currentDomain}
      />
      <MainContent>
        <Router>
          <Routes>
            {props.domains
              .filter(d => d.enabled)
              .flatMap(d => d.routes)
              .map(route => (
                <Route
                  path={route.path}
                  component={route.component}
                />
              ))}
          </Routes>
        </Router>
      </MainContent>
      <GlobalModals />
      <Notifications />
    </div>
  );
}
```

**tasks:**

- [ ] **domain registration**: plugin system for adding new domains (video, photos, etc.)
- [ ] **responsive layout**: mobile-first design with desktop enhancements
- [ ] **navigation system**: contextual navigation with proper state management
- [ ] **global state**: user preferences, theme, active domain
- [ ] **modal management**: global modal system with proper z-index management

### phase 3: code migration & cleanup

#### 3.1 file-by-file analysis & migration

**objective**: systematically review every file in `client/js/` and migrate to new architecture

**migration decision matrix:**
for each file, determine:

1. **delete**: dead code, outdated examples, unused components
2. **move**: working code that fits new structure with minimal changes
3. **refactor**: important functionality that needs restructuring

**categories to review:**

**core infrastructure files:**

- `src/lib/api-client.ts` → refactor into `lib/core/api/`
- `src/lib/websocket-*.ts` → integrate into remote providers
- `src/sync/` → simplify and move to `lib/core/sync/`

**music domain files:**

- `src/lib/music/` → move to `lib/music/domain/`
- `src/views/freqhole/components/player/` → extract to `modules/audio-player/`
- collection management → `modules/collections/`

**ui components:**

- `src/components/` → evaluate for `views/core/components/`
- duplicate components → consolidate into single implementations

**test & example files:**

- `tests/`, `examples/` → most likely delete, keep useful fixtures

**migration process:**

```bash
# for each file in client/js/src/
1. analyze dependencies and usage
2. categorize (delete/move/refactor)
3. create migration ticket with:
   - current location
   - target location (if applicable)
   - required changes
   - dependencies to handle
   - tests to update
```

#### 3.2 batch editing & musicbrainz integration

**objective**: implement multi-select and metadata enrichment features

**batch editing pattern:**

```typescript
// lib/music/batch-editing/selection-manager.ts
export function createSelectionManager<T extends { id: string }>() {
  const [selectedItems, setSelectedItems] = createStore<Set<string>>(new Set());
  const [lastSelected, setLastSelected] = createSignal<string | null>(null);

  const toggleSelection = (id: string, event?: MouseEvent) => {
    if (event?.ctrlKey || event?.metaKey) {
      // ctrl+click: toggle individual item
      setSelectedItems((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(id)) {
          newSet.delete(id);
        } else {
          newSet.add(id);
        }
        return newSet;
      });
    } else if (event?.shiftKey && lastSelected()) {
      // shift+click: select range
      selectRange(lastSelected()!, id);
    } else {
      // regular click: select only this item
      setSelectedItems(new Set([id]));
    }
    setLastSelected(id);
  };

  const selectAll = (items: T[]) => {
    setSelectedItems(new Set(items.map((item) => item.id)));
  };

  const clearSelection = () => {
    setSelectedItems(new Set());
    setLastSelected(null);
  };

  return {
    selectedItems: () => selectedItems,
    toggleSelection,
    selectAll,
    clearSelection,
    hasSelection: () => selectedItems.size > 0,
  };
}
```

**musicbrainz integration:**

```typescript
// lib/music/musicbrainz/metadata-enrichment.ts
export async function enrichSongMetadata(song: Song): Promise<Partial<Song>> {
  const searchQuery = `${song.artist} ${song.title}`;

  try {
    const response = await fetch(
      `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(searchQuery)}&fmt=json`,
    );

    const data = await response.json();
    const recording = data.recordings?.[0];

    if (recording) {
      return {
        musicbrainz_id: recording.id,
        title: recording.title || song.title,
        artist: recording["artist-credit"]?.[0]?.name || song.artist,
        // additional enrichment...
      };
    }
  } catch (error) {
    console.warn("musicbrainz enrichment failed:", error);
  }

  return {};
}
```

#### 3.3 player persistence

**objective**: persist player state and queue to indexeddb

```typescript
// lib/music/audio-player/player-persistence.ts
export function createPlayerPersistence() {
  const savePlayerState = async (state: {
    currentTrack: Track | null;
    position: number;
    volume: number;
    queue: Track[];
    queueIndex: number;
  }) => {
    await updateStore("player_state", "current", state);
  };

  const restorePlayerState = async () => {
    return await queryStore("player_state", { id: "current" });
  };

  const savePlayHistory = async (track: Track, playedAt: Date) => {
    await insertIntoStore("play_history", {
      id: crypto.randomUUID(),
      track_id: track.id,
      played_at: playedAt.toISOString(),
      remote_id: track.remote_id,
    });
  };

  return {
    savePlayerState,
    restorePlayerState,
    savePlayHistory,
  };
}
```

#### 3.4 module extraction

**objective**: extract cohesive modules from the monolithic codebase

**audio player module:**

```typescript
// modules/audio-player/index.ts
export interface AudioPlayerModule {
  // core playback
  play: (track: Track) => Promise<void>;
  pause: () => void;
  seek: (position: number) => void;
  setVolume: (volume: number) => void;

  // queue management
  queue: QueueManager;

  // state
  currentTrack: Accessor<Track | null>;
  isPlaying: Accessor<boolean>;
  position: Accessor<number>;
  duration: Accessor<number>;
  volume: Accessor<number>;

  // events
  onTrackChange: (callback: (track: Track) => void) => void;
  onPlayStateChange: (callback: (playing: boolean) => void) => void;
}
```

**collections module:**

```typescript
// modules/collections/index.ts
export interface CollectionsModule {
  // data access
  songs: CollectionProvider<Song>;
  albums: CollectionProvider<Album>;
  artists: CollectionProvider<Artist>;
  genres: CollectionProvider<Genre>;

  // search & filtering
  search: (query: string, filters?: Filter[]) => Promise<SearchResults>;
  filter: <T>(collection: T[], filters: Filter[]) => T[];
  sort: <T>(collection: T[], sorter: Sorter<T>) => T[];

  // virtualization
  createVirtualCollection: <T>(
    provider: CollectionProvider<T>,
    container: HTMLElement,
  ) => VirtualCollection<T>;
}
```

**tasks:**

- [ ] **player extraction**: complete audio playback system with queue
- [ ] **collections extraction**: unified collection browsing with virtualization
- [ ] **search extraction**: full-text search with faceted filtering
- [ ] **playlist extraction**: crud operations and ui components
- [ ] **analytics extraction**: usage tracking and insights

#### 3.5 virtualized infinite scrolling with solid-js resources

**objective**: create sound abstraction for virtualized lists with reactive data

**virtualized collection pattern:**

```typescript
// modules/collections/virtualized-collection.ts
import { createVirtualizer } from '@solid-primitives/virtual';

export function createVirtualizedCollection<T>(
  resourceQuery: () => QueryOptions,
  container: Accessor<HTMLElement | undefined>
) {
  // solid-js resource for data
  const [data] = createStorageResource('songs', resourceQuery);

  // virtualization setup using @solid-primitives/virtual
  const virtualizer = createVirtualizer({
    count: () => data()?.length || 0,
    getScrollElement: container,
    estimateSize: () => 56, // row height
    overscan: 10
  });

  // automatic cleanup when component unmounts
  onCleanup(() => {
    // solid-js resources handle their own cleanup
  });

  return {
    data,
    virtualizer,
    items: () => virtualizer.getVirtualItems()
  };
}

// usage in component
export function SongList() {
  let containerRef: HTMLDivElement;

  const collection = createVirtualizedCollection(
    () => ({ artist: 'some artist' }), // query params
    () => containerRef
  );

  return (
    <div ref={containerRef!} class="song-list">
      <div style={{ height: `${collection.virtualizer.getTotalSize()}px` }}>
        <For each={collection.items()}>
          {(virtualItem) => {
            const song = collection.data()?.[virtualItem.index];
            return (
              <div
                style={{
                  position: 'absolute',
                  top: `${virtualItem.start}px`,
                  height: '56px',
                  width: '100%'
                }}
              >
                <SongRow song={song} />
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
```

**tasks:**

- [ ] **resource patterns**: consistent patterns for reactive data queries
- [ ] **virtualization abstraction**: reusable virtual scrolling with cleanup using `@solid-primitives/virtual`
- [ ] **infinite loading**: progressive data loading as user scrolls
- [ ] **search integration**: virtualized search results with highlighting
- [ ] **performance optimization**: efficient rendering for large datasets

#### 3.6 state management consolidation

**objective**: establish consistent patterns for state management across modules

**state architecture:**

```typescript
// lib/core/state/create-module-store.ts
export interface StoreConfig<T> {
  name: string;
  initialState: T;
  persist?: boolean;
  remote?: boolean;
}

export function createModuleStore<T>(config: StoreConfig<T>) {
  const [state, setState] = createStore(config.initialState);

  // persistence layer
  const persisted = config.persist
    ? makePersisted(() => [state, setState], {
        storage: indexedDBStorage,
        name: config.name,
      })
    : null;

  // remote synchronization
  const sync = config.remote
    ? createSyncedResource(config.name, setState)
    : null;

  // action creators
  const actions = createActions(setState);

  return {
    state: () => state,
    setState,
    actions,
    sync,
  };
}

// pure action creators
const createActions = <T>(setState: SetStoreFunction<T>) => ({
  update: (path: string[], value: any) => {
    setState(path as any, value);
  },

  merge: (updates: Partial<T>) => {
    setState(produce(updates));
  },

  reset: (initialState: T) => {
    setState(initialState);
  },
});
```

**tasks:**

- [ ] **store patterns**: consistent patterns for local, persisted, and synced state
- [ ] **action creators**: type-safe action patterns with optimistic updates
- [ ] **selectors**: efficient state selection and memoization
- [ ] **middleware**: logging, persistence, and sync middleware
- [ ] **testing**: store testing utilities and patterns

### phase 4: testing & quality

#### 4.1 playwright test suite

**objective**: comprehensive e2e testing covering critical user flows

**test architecture:**

```typescript
// testing/playwright/utils/app-utils.ts
export async function setupTestApp(page: Page) {
  // clear any existing data
  await page.evaluate(() => {
    return window.testUtils?.clearAllData();
  });

  // populate with test data
  await page.evaluate(() => {
    return window.testUtils?.seedDatabase({
      songs: testSongs,
      albums: testAlbums,
      remotes: testRemotes,
    });
  });

  await page.goto("/");

  // wait for initialization to complete
  await page.waitForSelector(".app-shell", { timeout: 10000 });
}

export async function playTrack(page: Page, trackId: string) {
  await page.click(`[data-track-id="${trackId}"] .play-button`);
  await page.waitForSelector(".player-controls");
}

export async function searchLibrary(page: Page, query: string) {
  await page.fill(".search-input", query);
  await page.press(".search-input", "Enter");
  await page.waitForSelector(".search-results");
}
```

**critical test scenarios:**

```typescript
// testing/playwright/specs/core-flows.spec.ts
import { test, expect } from "@playwright/test";
import { setupTestApp, playTrack, searchLibrary } from "../utils/app-utils";

test.describe("core application flows", () => {
  test("app initialization and loading", async ({ page }) => {
    await page.goto("/");

    // verify loading sequence
    await expect(page.locator(".loading-animation")).toBeVisible();
    await expect(page.locator(".progress-bar")).toBeVisible();

    // wait for initialization to complete
    await expect(page.locator(".app-shell")).toBeVisible();
    await expect(page.locator(".loading-animation")).not.toBeVisible();
  });

  test("music library browsing with virtualization", async ({ page }) => {
    await setupTestApp(page);
    await page.goto("/music/library");

    // test virtual scrolling performance
    const songsList = page.locator(".songs-list");
    await expect(songsList).toBeVisible();

    // scroll through list
    await songsList.evaluate((el) => {
      el.scrollTop = 1000;
    });

    // verify items are rendered dynamically
    const renderedItems = await page.locator(".song-row").count();
    expect(renderedItems).toBeLessThan(50); // should not render all items
  });

  test("offline functionality", async ({ page, context }) => {
    await setupTestApp(page);

    // go offline
    await context.setOffline(true);
    await page.reload();

    // verify app still works
    await expect(page.locator(".offline-indicator")).toBeVisible();
    await expect(page.locator(".app-shell")).toBeVisible();

    // test cached music playback
    await playTrack(page, "test-track-1");
    await expect(page.locator(".player-controls")).toBeVisible();
  });

  test("user-controlled caching", async ({ page }) => {
    await setupTestApp(page);
    await page.goto("/music/library");

    // save track for offline
    await page.click('[data-track-id="test-track-1"] .menu-button');
    await page.click(".save-offline-option");

    // verify saved status
    await expect(
      page.locator('[data-track-id="test-track-1"] .offline-indicator'),
    ).toBeVisible();

    // test cache management
    await page.goto("/settings/cache");
    await expect(
      page.locator('.cache-entry[data-item-id="test-track-1"]'),
    ).toBeVisible();

    // remove from cache
    await page.click(
      '.cache-entry[data-item-id="test-track-1"] .remove-button',
    );
    await expect(
      page.locator('.cache-entry[data-item-id="test-track-1"]'),
    ).not.toBeVisible();
  });
});
```

**test categories:**

- [ ] **initialization**: app startup, error recovery, migration
- [ ] **data flow**: indexeddb operations, sync, caching
- [ ] **user interface**: navigation, modals, responsive design
- [ ] **audio playback**: player controls, queue management, crossfade
- [ ] **collections**: browsing, searching, filtering, sorting
- [ ] **offline**: service worker, cache management, offline playback
- [ ] **multi-remote**: connection management, data conflicts, failover

#### 4.2 code quality & maintainability

**objective**: establish maintainable codebase with clear patterns

**quality targets:**

- **typescript**: strict mode, no `any` types
- **test coverage**: focus on critical paths rather than percentage
- **accessibility**: wcag 2.1 aa compliance
- **bundle size**: < 500kb initial, < 2mb total
- **file size**: < 500 lines per file (create new modules when exceeding)

**quality gates:**

```typescript
// eslint configuration emphasizing functional patterns
module.exports = {
  extends: ["@typescript-eslint/recommended", "plugin:solid/typescript"],
  rules: {
    // prefer functions over classes
    "prefer-arrow-callback": "error",
    "func-style": ["error", "expression"],

    // enforce lowercase for ui text
    "no-uppercase-in-jsx": "error",

    // file size limits
    "max-lines": ["error", { max: 500 }],

    // no classes unless absolutely necessary
    "no-restricted-syntax": [
      "error",
      {
        selector: "ClassDeclaration",
        message: "prefer functional patterns over classes",
      },
    ],
  },
};
```

**tasks:**

- [ ] **linting rules**: enforce functional patterns and style guidelines
- [ ] **type safety**: comprehensive typescript coverage
- [ ] **accessibility**: keyboard navigation, screen reader support
- [ ] **dark theme**: consistent dark ui across all components
- [ ] **documentation**: inline code comments and module documentation

## migration methodology

### file review process

for each file in `client/js/src/`, follow this systematic approach:

1. **static analysis**
   - identify imports and exports
   - check for external dependencies
   - look for typescript errors or warnings
   - assess code complexity and maintainability

2. **usage analysis**
   - find all references across codebase
   - identify if code is actually used
   - check for duplicate functionality elsewhere

3. **categorization decision**
   - **delete**: unused, example, or obsolete code
   - **move**: working code that fits new structure
   - **refactor**: important code needing restructuring

4. **migration planning**
   - map new location in target architecture
   - identify required changes
   - plan dependency updates
   - estimate effort and risk

### consolidation patterns

**duplicate detection:**

- search for similar component names across directories
- identify repeated patterns in hooks and utilities
- look for copied business logic with minor variations

**consolidation strategy:**

- create canonical implementation with all needed functionality
- use configuration for optional behaviors
- provide migration guides for api changes
- deprecate old implementations gradually

### separation of concerns

**presentational vs business logic:**

- `.tsx` files contain only ui components and rendering logic
- business logic lives in separate `.ts` files
- data access through solid-js resources and stores
- pure functions for data transformation and validation

**module boundaries:**

- each module is self-contained with clear interfaces
- no circular dependencies between modules
- shared utilities in `lib/utils/`
- domain-specific logic in appropriate domain folders

## risk management

### technical risks

- **data loss**: robust backup strategy for indexeddb migrations
- **performance regression**: continuous monitoring during development
- **breaking changes**: careful api versioning and migration paths
- **browser compatibility**: progressive enhancement for older browsers

### migration risks

- **lost functionality**: comprehensive testing to ensure no regression
- **user experience**: minimal disruption during transition
- **development velocity**: maintain ability to ship improvements during refactor

### mitigation strategies

- **incremental migration**: old and new systems coexist during transition
- **automated testing**: prevent regressions during migration
- **rollback plans**: quick recovery if issues arise
- **documentation**: clear migration guides for each phase

## success metrics

### technical metrics

- **bundle size reduction**: target 50% reduction in main bundle size
- **performance improvement**: 25% faster load times
- **code quality**: eliminate all typescript errors, improve maintainability
- **test coverage**: comprehensive coverage of critical user flows

### developer experience metrics

- **build time**: faster incremental builds with better caching
- **development velocity**: easier to add new modules
- **bug reduction**: fewer production issues due to better typing and testing
- **onboarding**: new developers can contribute more quickly

### user experience metrics

- **offline functionality**: full app functionality without network
- **reliability**: reduced crashes and error states
- **performance**: smoother animations and interactions
- **user control**: granular control over offline storage and caching

## conclusion

this plan provides a comprehensive roadmap for transforming the existing monolithic music application into a modern, modular, offline-first pwa. the phase-based approach ensures steady progress while maintaining the ability to deliver value throughout the refactoring process.

the focus on foundation-first development (indexeddb, service worker, multi-remote support) provides a solid base for the systematic code migration that follows. the emphasis on functional patterns, solid-js resources, and user-controlled caching ensures the refactored application will be more maintainable and user-friendly than the original.

by following this plan, we will achieve:

- a clean, modular codebase ready for multi-domain expansion
- full offline functionality with user-controlled caching
- support for multiple music servers with different capabilities
- sound abstractions for virtualized infinite scrolling
- comprehensive test coverage and quality assurance
- a solid foundation for years of future development

the systematic file-by-file review ensures that no functionality is lost while eliminating the accumulated technical debt that has made the current codebase difficult to maintain and extend.
