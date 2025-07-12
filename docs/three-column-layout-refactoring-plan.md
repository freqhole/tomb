# Three-Column Layout Refactoring Plan (Clean Start Edition)

## Overview

This document outlines a comprehensive refactoring plan to transform Freqhole from its current full-width header layout to a three-column Apple Music-inspired layout. The approach **starts with cleanup**, uses **Solid Store** for state management, and integrates **Solid Router** for navigation.

## Core Philosophy

### Cleanup First + Solid Store + Router + Events

- **Phase 0**: Identify and rip out dead code before building new features
- **Solid Store**: Single store instead of nested context providers
- **Router**: Manages navigation state, URLs, browser history
- **Events**: Handle actions and cross-component communication
- **Component Composition**: Self-contained components with clear responsibilities

### State Architecture: Solid Store

Instead of complex nested contexts, use a single Solid Store:

```jsx
// store.ts
export const [store, setStore] = createStore({
  layout: {
    queueOpen: false,
    breakpoint: "desktop",
    sidebarCollapsed: false,
  },
  navigation: {
    currentView: "songs",
    selectedArtist: null,
    selectedAlbum: null,
  },
  player: {
    currentSong: null,
    isPlaying: false,
    volume: 0.8,
    repeat: false,
    shuffle: false,
  },
  queue: {
    items: [],
    currentIndex: 0,
    history: [],
  },
  search: {
    query: "",
    results: { songs: [], artists: [], albums: [] },
    isActive: false,
  },
});
```

## Phase 0: Cleanup & Inventory (Week 1)

### 0.1 Identify Keepers

**Keep (Working Well):**

- `components/player/` - Player components are working great
- `components/auth/` - User auth system is solid
- `components/ui/` - Context menus, modals working well
- `components/icons/` - Icon system is good
- `components/search/` - Search components mostly good
- `hooks/usePersistedPlayer.ts` - Player persistence
- `hooks/usePersistedQueue.ts` - Queue persistence
- `context/FreqholeContext.tsx` - May need modification but core logic is good

**Delete/Rip Out:**

- Most of `index.tsx` - Complex view switching logic
- `hooks/useMusicState.ts` - Replace with store
- `hooks/usePlayerState.ts` - Replace with store
- `hooks/useViewState.ts` - Replace with store
- `hooks/useFreqholeState.ts` - Replace with store
- `styles/utils.ts` - No more utils files
- Redundant CSS classes and styles
- Dead code from previous iterations

### 0.2 Tailwind Config Setup

**Add custom magenta color palette to `tailwind.config.js`:**

```javascript
module.exports = {
  content: [
    "./client/js/src/**/*.{js,jsx,ts,tsx}",
    "./client/js/src/views/freqhole/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        magenta: {
          50: "#fdf4ff",
          100: "#fae8ff",
          200: "#f5d0fe",
          300: "#f0abfc",
          400: "#e879f9",
          500: "#d946ef", // Primary magenta
          600: "#c026d3",
          700: "#a21caf",
          800: "#86198f",
          900: "#701a75",
        },
      },
    },
  },
  plugins: [],
};
```

**Alternative pure magenta palette (if wanting more saturated):**

```javascript
magenta: {
  50: '#fff0ff',
  100: '#ffe0ff',
  200: '#ffc0ff',
  300: '#ff80ff',
  400: '#ff40ff',
  500: '#ff00ff',  // Pure magenta
  600: '#e000e0',
  700: '#c000c0',
  800: '#a000a0',
  900: '#800080',
},
```

### 0.3 Create Minimal index.tsx

**New index.tsx structure:**

```jsx
import { Router } from "@solidjs/router";
import { routes } from "./routes";
import { StoreProvider } from "./store";

export default function Freqhole() {
  return (
    <StoreProvider>
      <Router>{routes}</Router>
    </StoreProvider>
  );
}
```

### 0.4 Audit Current Code

**Files to audit and clean:**

```bash
# Audit these files - keep what works, delete what doesn't
client/js/src/views/freqhole/
├── index.tsx              # ⚠️  MOSTLY DELETE - keep minimal wrapper
├── components/
│   ├── player/           # ✅ KEEP - working well
│   ├── auth/             # ✅ KEEP - working well
│   ├── ui/               # ✅ KEEP - modals, context menus
│   ├── icons/            # ✅ KEEP - icon system
│   ├── header/           # ⚠️  AUDIT - may need parts for nav
│   └── layout/           # ⚠️  AUDIT - Panel.tsx might be useful
├── hooks/
│   ├── usePersistedPlayer.ts  # ✅ KEEP - modify for store
│   ├── usePersistedQueue.ts   # ✅ KEEP - modify for store
│   ├── useMusicState.ts       # ❌ DELETE - replace with store
│   ├── usePlayerState.ts      # ❌ DELETE - replace with store
│   ├── useViewState.ts        # ❌ DELETE - replace with store
│   └── useFreqholeState.ts    # ❌ DELETE - replace with store
├── context/
│   └── FreqholeContext.tsx    # ⚠️  AUDIT - keep useful parts
└── styles/
    ├── utils.ts          # ❌ DELETE - no more utils
    └── *.css             # ⚠️  AUDIT - keep what's needed
```

## Phase 1: Solid Store + Basic Layout (Week 2)

### 1.1 Create Solid Store

**store/index.ts:**

```jsx
import { createStore } from "solid-js/store";
import { createContext, useContext } from "solid-js";

const [store, setStore] = createStore({
  layout: {
    queueOpen: false,
    breakpoint: "desktop",
  },
  navigation: {
    currentView: "songs",
  },
  player: {
    currentSong: null,
    isPlaying: false,
    volume: 0.8,
  },
  queue: {
    items: [],
    currentIndex: 0,
  },
  search: {
    query: "",
    results: { songs: [], artists: [], albums: [] },
    isActive: false,
  },
});

const StoreContext = createContext(store);

export function StoreProvider(props) {
  return (
    <StoreContext.Provider value={[store, setStore]}>
      {props.children}
    </StoreContext.Provider>
  );
}

export const useStore = () => useContext(StoreContext);
```

### 1.2 Create Basic Three-Column Layout

**components/layout/ThreeColumnLayout.tsx:**

```jsx
import { Show } from "solid-js";
import { useStore } from "../../store";
import { Navigation } from "../navigation/Navigation";
import { Content } from "../content/Content";
import { Queue } from "../queue/Queue";
import { Player } from "../player/Player"; // Keep existing player

export function ThreeColumnLayout(props) {
  const [store] = useStore();

  const columnClasses = () => {
    const queueOpen = store.layout.queueOpen;
    const breakpoint = store.layout.breakpoint;

    if (breakpoint === "mobile") return "grid-cols-1";
    if (breakpoint === "tablet")
      return "grid-cols-12 [&>*:nth-child(1)]:col-span-4 [&>*:nth-child(2)]:col-span-8";

    return queueOpen
      ? "grid-cols-12 [&>*:nth-child(1)]:col-span-3 [&>*:nth-child(2)]:col-span-6 [&>*:nth-child(3)]:col-span-3"
      : "grid-cols-12 [&>*:nth-child(1)]:col-span-4 [&>*:nth-child(2)]:col-span-8";
  };

  return (
    <div class="h-screen flex flex-col bg-black">
      <div class={`grid flex-1 ${columnClasses()}`}>
        <Navigation />
        <Content />
        <Show when={store.layout.queueOpen}>
          <Queue />
        </Show>
      </div>
      <div class="min-h-16 bg-black">
        <Player /> {/* Keep existing player component */}
      </div>
      {props.children}
    </div>
  );
}
```

### 1.3 Router Setup

**routes/index.tsx:**

```jsx
import { Route } from "@solidjs/router";
import { ThreeColumnLayout } from "../components/layout/ThreeColumnLayout";

export const routes = (
  <Route path="/" component={ThreeColumnLayout}>
    <Route path="/" component={() => <div />} />
    <Route path="/songs" component={() => <div />} />
    <Route path="/song/:id" component={() => <div />} />
    <Route path="/artists" component={() => <div />} />
    <Route path="/artist/:id" component={() => <div />} />
    <Route path="/albums" component={() => <div />} />
    <Route path="/album/:id" component={() => <div />} />
    <Route path="/playlists" component={() => <div />} />
    <Route path="/playlist/:id" component={() => <div />} />
    <Route path="/search" component={() => <div />} />
  </Route>
);
```

## Phase 2: Navigation + Songs View (Week 3)

### 2.1 Navigation Component

**components/navigation/Navigation.tsx:**

```jsx
import { useNavigate, useLocation } from "@solidjs/router";
import { useStore } from "../../store";
import { NavigationHeader } from "./NavigationHeader";
import { NavigationSections } from "./NavigationSections";

export function Navigation() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div class="flex flex-col h-full bg-black/80">
      <NavigationHeader />
      <div class="flex-1 overflow-y-auto">
        <NavigationSections
          currentPath={location.pathname}
          onNavigate={navigate}
        />
        <PlaylistsNavigation
          currentPath={location.pathname}
          onNavigate={navigate}
        />
      </div>
    </div>
  );
}
```

**components/navigation/NavigationHeader.tsx:**

```jsx
import { FreqholeIcon } from "../icons"; // Keep existing icons
import { SearchBox } from "../search/SearchBox"; // Keep existing search
import { useNavigate } from "@solidjs/router";
import { useStore } from "../../store";

export function NavigationHeader() {
  const navigate = useNavigate();
  const [store, setStore] = useStore();

  const handleSearch = (query) => {
    setStore("search", "query", query);
    setStore("search", "isActive", true);
    navigate(`/search?q=${encodeURIComponent(query)}`);
  };

  return (
    <div class="p-4 bg-black/90">
      <div class="mb-4">
        <FreqholeIcon />
      </div>
      <SearchBox
        query={store.search.query}
        onSearch={handleSearch}
        placeholder="search music..."
      />
    </div>
  );
}
```

### 2.2 Songs View (Default)

**components/content/Content.tsx:**

```jsx
import { useLocation, useParams } from "@solidjs/router";
import { Switch, Match } from "solid-js";
import { SongTableView } from "./views/songs/SongTableView";

export function Content() {
  const location = useLocation();

  return (
    <div class="flex flex-col h-full bg-black">
      <Switch>
        <Match
          when={location.pathname === "/" || location.pathname === "/songs"}
        >
          <SongTableView />
        </Match>
        <Match when={location.pathname.startsWith("/song/")}>
          <div class="p-4 text-white">Song detail view coming soon...</div>
        </Match>
        <Match when={location.pathname === "/artists"}>
          <div class="p-4 text-white">Artists view coming soon...</div>
        </Match>
        <Match when={location.pathname === "/albums"}>
          <div class="p-4 text-white">Albums view coming soon...</div>
        </Match>
        <Match when={location.pathname.startsWith("/album/")}>
          <div class="p-4 text-white">Album detail view coming soon...</div>
        </Match>
        <Match when={location.pathname === "/playlists"}>
          <div class="p-4 text-white">All playlists view coming soon...</div>
        </Match>
        <Match when={location.pathname.startsWith("/playlist/")}>
          <div class="p-4 text-white">Playlist detail view coming soon...</div>
        </Match>
      </Switch>
    </div>
  );
}
```

**components/content/views/songs/SongTableView.tsx:**

```jsx
import { createSignal, onMount } from "solid-js";
import { useStore } from "../../../../store";
import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { apiClient } from "../../../../lib/api-client"; // Keep existing API client

export function SongTableView() {
  const [songs, setSongs] = createSignal([]);
  const [loading, setLoading] = createSignal(false);
  const [store, setStore] = useStore();
  const events = useGlobalEvents();

  const loadSongs = async () => {
    setLoading(true);
    const data = await apiClient.getSongs({ limit: 50 });
    setSongs(data.songs);
    setLoading(false);
  };

  const handlePlaySong = (song) => {
    events.emit("song:play", song);
  };

  onMount(() => loadSongs());

  return (
    <div class="flex flex-col h-full">
      <div class="p-4 bg-black/90">
        <h1 class="text-xl font-semibold text-white">songs</h1>
      </div>
      <div class="flex-1 overflow-y-auto">
        {/* Use existing song rendering components if available */}
        <div class="space-y-1">
          {songs().map((song) => (
            <div
              class="flex items-center p-3 hover:bg-magenta-500/20 cursor-pointer rounded-lg"
              onClick={() => handlePlaySong(song)}
            >
              <div class="flex-1">
                <div class="text-white font-medium">{song.title}</div>
                <div class="text-gray-400 text-sm">{song.artist}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

## Phase 3: Event System + Queue Integration (Week 4)

### 3.1 Event System

**hooks/useGlobalEvents.ts:**

```jsx
import { onCleanup } from "solid-js";

const eventBus = new EventTarget();

export function useGlobalEvents() {
  const emit = (event, data) => {
    console.log(`🔄 Event: ${event}`, data);
    eventBus.dispatchEvent(new CustomEvent(event, { detail: data }));
  };

  const on = (event, handler) => {
    eventBus.addEventListener(event, handler);
    onCleanup(() => eventBus.removeEventListener(event, handler));
  };

  return { emit, on };
}
```

### 3.2 Integrate Existing Player with Store

**Modify existing Player component to use store:**

```jsx
// In existing Player component
import { useStore } from "../../store";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";

export function Player() {
  const [store, setStore] = useStore();
  const events = useGlobalEvents();

  // Listen for play events
  events.on("song:play", (e) => {
    const song = e.detail;
    setStore("player", "currentSong", song);
    setStore("player", "isPlaying", true);
  });

  // Rest of existing player logic...
}
```

### 3.3 Queue Component

**components/queue/Queue.tsx:**

```jsx
import { useStore } from "../../store";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import { QueueHeader } from "./QueueHeader";
import { QueueList } from "./QueueList";

export function Queue() {
  const [store, setStore] = useStore();
  const events = useGlobalEvents();

  // Listen for queue events
  events.on("song:queue", (e) => {
    const song = e.detail;
    setStore("queue", "items", [...store.queue.items, song]);
  });

  return (
    <div class="flex flex-col h-full bg-black/80">
      <QueueHeader />
      <div class="flex-1 overflow-y-auto">
        <QueueList
          items={store.queue.items}
          currentIndex={store.queue.currentIndex}
        />
      </div>
    </div>
  );
}
```

## Phase 4: Complete Navigation Views (Week 5)

### 4.1 Complete Route Structure

**Full URL Structure:**

```
/                     → Default (songs)
/songs               → Song table view
/song/:id            → Song detail view (metadata, lyrics, etc.)
/artists             → Artist split view (list + detail)
/artist/:id          → Artist detail view (full page)
/albums              → Album grid view
/album/:id           → Album detail view (tracklist, metadata)
/playlists           → All playlists view (paginated)
/playlist/:id        → Single playlist view (with CRUD)
/search?q=foo        → Search results
```

### 4.2 Navigation Column Playlist Strategy

**components/navigation/PlaylistsNavigation.tsx:**

```jsx
import { createSignal, onMount, For } from "solid-js";
import { useStore } from "../../store";
import { apiClient } from "../../lib/api-client";

export function PlaylistsNavigation(props) {
  const [recentPlaylists, setRecentPlaylists] = createSignal([]);
  const [loading, setLoading] = createSignal(false);
  const [store, setStore] = useStore();

  onMount(() => {
    loadRecentPlaylists();
  });

  const loadRecentPlaylists = async () => {
    setLoading(true);
    // Load only recent/favorite playlists for sidebar (limit 25)
    const data = await apiClient.getPlaylists({ limit: 25, orderBy: "recent" });
    setRecentPlaylists(data.playlists);
    setLoading(false);
  };

  return (
    <div class="p-4">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-sm font-medium text-gray-400">playlists</h3>
        <button
          onClick={() => props.onNavigate("/playlists")}
          class="text-xs text-gray-500 hover:text-magenta-400"
        >
          view all
        </button>
      </div>

      <div class="space-y-1">
        <For each={recentPlaylists()}>
          {(playlist) => (
            <div
              class={`p-2 rounded-lg cursor-pointer text-sm hover:bg-magenta-500/20 ${
                props.currentPath === `/playlist/${playlist.id}`
                  ? "bg-magenta-500/30 text-magenta-300"
                  : "text-gray-300"
              }`}
              onClick={() => props.onNavigate(`/playlist/${playlist.id}`)}
            >
              <div class="truncate">{playlist.name}</div>
              <div class="text-xs text-gray-500">
                {playlist.song_count} songs
              </div>
            </div>
          )}
        </For>
      </div>

      <button
        onClick={handleCreatePlaylist}
        class="w-full mt-2 p-2 bg-gray-800 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-magenta-500/20"
      >
        + create playlist
      </button>
    </div>
  );
}
```

### 4.3 Artist Views

**components/content/views/artists/ArtistSplitView.tsx:**

```jsx
import { createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useStore } from "../../../../store";
import { ArtistList } from "./ArtistList";
import { ArtistDetail } from "./ArtistDetail";

export function ArtistSplitView() {
  const [selectedArtist, setSelectedArtist] = createSignal(null);
  const navigate = useNavigate();
  const [store, setStore] = useStore();

  const handleArtistSelect = (artist) => {
    setSelectedArtist(artist);
    navigate(`/artist/${artist.id}`, { state: { artist } });
  };

  return (
    <div class="flex h-full">
      <div class="w-1/2 border-r border-white/10">
        <ArtistList onArtistSelect={handleArtistSelect} />
      </div>
      <div class="w-1/2">
        <ArtistDetail artist={selectedArtist()} />
      </div>
    </div>
  );
}
```

### 4.4 Song Detail View

**components/content/views/songs/SongDetailView.tsx:**

```jsx
import { createSignal, createEffect, onMount } from "solid-js";
import { useParams, useLocation, useNavigate } from "@solidjs/router";
import { useStore } from "../../../../store";
import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { apiClient } from "../../../../lib/api-client";

export function SongDetailView() {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [song, setSong] = createSignal(null);
  const [lyrics, setLyrics] = createSignal("");
  const [similarSongs, setSimilarSongs] = createSignal([]);
  const [loading, setLoading] = createSignal(false);
  const events = useGlobalEvents();

  createEffect(() => {
    if (params.id) {
      loadSongData(params.id);
    }
  });

  // Try to use song data from history state if available
  createEffect(() => {
    const songFromState = location.state?.song;
    if (songFromState) {
      setSong(songFromState);
    }
  });

  const loadSongData = async (songId) => {
    setLoading(true);
    const [songData, lyricsData, similarData] = await Promise.all([
      apiClient.getSong(songId),
      apiClient.getSongLyrics(songId).catch(() => ""),
      apiClient.getSimilarSongs(songId).catch(() => []),
    ]);
    setSong(songData);
    setLyrics(lyricsData);
    setSimilarSongs(similarData);
    setLoading(false);
  };

  const handlePlaySong = () => {
    events.emit("song:play", song());
  };

  const handleAddToQueue = () => {
    events.emit("song:queue", song());
  };

  return (
    <div class="flex flex-col h-full">
      <div class="p-6 border-b border-white/10">
        <div class="flex items-start gap-4">
          <img
            src={song()?.album_cover_url}
            alt={song()?.album}
            class="w-32 h-32 rounded-lg object-cover"
          />
          <div class="flex-1">
            <h1 class="text-2xl font-bold text-white mb-2">
              {song()?.title || "loading..."}
            </h1>
            <p class="text-gray-400 mb-2">
              <span
                class="hover:text-magenta-400 cursor-pointer"
                onClick={() => navigate(`/artist/${song()?.artist_id}`)}
              >
                {song()?.artist}
              </span>
              {song()?.album && (
                <>
                  {" • "}
                  <span
                    class="hover:text-magenta-400 cursor-pointer"
                    onClick={() => navigate(`/album/${song()?.album_id}`)}
                  >
                    {song()?.album}
                  </span>
                </>
              )}
            </p>
            <p class="text-gray-500 text-sm mb-4">
              {song()?.year} • {song()?.duration}
            </p>
            <div class="flex gap-2">
              <button
                onClick={handlePlaySong}
                class="px-4 py-2 bg-magenta-500 text-white rounded-lg hover:bg-magenta-600 focus:bg-magenta-700"
              >
                play
              </button>
              <button
                onClick={handleAddToQueue}
                class="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 focus:bg-gray-600"
              >
                add to queue
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto">
        <div class="p-6">
          {lyrics() && (
            <div class="mb-8">
              <h2 class="text-lg font-semibold text-white mb-4">lyrics</h2>
              <div class="text-gray-300 whitespace-pre-line leading-relaxed">
                {lyrics()}
              </div>
            </div>
          )}

          {similarSongs().length > 0 && (
            <div>
              <h2 class="text-lg font-semibold text-white mb-4">
                similar songs
              </h2>
              <div class="space-y-2">
                {similarSongs().map((similarSong) => (
                  <div
                    class="flex items-center p-3 hover:bg-magenta-500/20 cursor-pointer rounded-lg"
                    onClick={() => navigate(`/song/${similarSong.id}`)}
                  >
                    <img
                      src={similarSong.album_cover_url}
                      alt={similarSong.album}
                      class="w-10 h-10 rounded object-cover"
                    />
                    <div class="flex-1 ml-3">
                      <div class="text-white font-medium">
                        {similarSong.title}
                      </div>
                      <div class="text-gray-400 text-sm">
                        {similarSong.artist}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

### 4.5 Album Views

**components/content/views/albums/AlbumDetailView.tsx:**

```jsx
import { createSignal, createEffect, onMount } from "solid-js";
import { useParams, useLocation } from "@solidjs/router";
import { useStore } from "../../../../store";
import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { apiClient } from "../../../../lib/api-client";

export function AlbumDetailView() {
  const params = useParams();
  const location = useLocation();
  const [album, setAlbum] = createSignal(null);
  const [songs, setSongs] = createSignal([]);
  const [loading, setLoading] = createSignal(false);
  const events = useGlobalEvents();

  createEffect(() => {
    if (params.id) {
      loadAlbumData(params.id);
    }
  });

  // Try to use album data from history state if available
  createEffect(() => {
    const albumFromState = location.state?.album;
    if (albumFromState) {
      setAlbum(albumFromState);
    }
  });

  const loadAlbumData = async (albumId) => {
    setLoading(true);
    const [albumData, songsData] = await Promise.all([
      apiClient.getAlbum(albumId),
      apiClient.getAlbumSongs(albumId),
    ]);
    setAlbum(albumData);
    setSongs(songsData);
    setLoading(false);
  };

  const handlePlayAlbum = () => {
    if (songs().length > 0) {
      events.emit("song:play", songs()[0]);
      events.emit("queue:replace", songs());
    }
  };

  return (
    <div class="flex flex-col h-full">
      <div class="p-6 border-b border-white/10">
        <div class="flex items-start gap-4">
          <img
            src={album()?.cover_url}
            alt={album()?.title}
            class="w-32 h-32 rounded-lg object-cover"
          />
          <div class="flex-1">
            <h1 class="text-2xl font-bold text-white mb-2">
              {album()?.title || "loading..."}
            </h1>
            <p class="text-gray-400 mb-4">
              {album()?.artist} • {album()?.year}
            </p>
            <button
              onClick={handlePlayAlbum}
              class="px-4 py-2 bg-magenta-500 text-white rounded-lg hover:bg-magenta-600 focus:bg-magenta-700"
            >
              play album
            </button>
          </div>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto">
        <div class="p-4">
          <h2 class="text-lg font-semibold text-white mb-4">tracks</h2>
          <div class="space-y-1">
            {songs().map((song, index) => (
              <div
                class="flex items-center p-3 hover:bg-magenta-500/20 cursor-pointer rounded-lg"
                onClick={() => events.emit("song:play", song)}
              >
                <div class="w-8 text-center text-gray-400 text-sm">
                  {index + 1}
                </div>
                <div class="flex-1 ml-3">
                  <div class="text-white font-medium">{song.title}</div>
                  <div class="text-gray-400 text-sm">{song.duration}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

### 4.5 Playlist Views

**components/content/views/playlists/AllPlaylistsView.tsx:**

```jsx
import { createSignal, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useStore } from "../../../../store";
import { apiClient } from "../../../../lib/api-client";

export function AllPlaylistsView() {
  const [playlists, setPlaylists] = createSignal([]);
  const [loading, setLoading] = createSignal(false);
  const navigate = useNavigate();
  const [store, setStore] = useStore();

  onMount(() => {
    loadAllPlaylists();
  });

  const loadAllPlaylists = async () => {
    setLoading(true);
    const data = await apiClient.getPlaylists({ limit: 100 }); // All playlists
    setPlaylists(data.playlists);
    setLoading(false);
  };

  const handleCreatePlaylist = () => {
    // Open create playlist modal or navigate to create page
    navigate("/playlists/create");
  };

  return (
    <div class="flex flex-col h-full">
      <div class="p-4 border-b border-white/10">
        <div class="flex items-center justify-between">
          <h1 class="text-xl font-semibold text-white">all playlists</h1>
          <button
            onClick={handleCreatePlaylist}
            class="px-4 py-2 bg-magenta-500 text-white rounded-lg hover:bg-magenta-600 focus:bg-magenta-700"
          >
            create playlist
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-4">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {playlists().map((playlist) => (
            <div
              class="p-4 bg-gray-800 rounded-lg cursor-pointer hover:bg-magenta-500/20"
              onClick={() => navigate(`/playlist/${playlist.id}`)}
            >
              <h3 class="text-white font-medium mb-2">{playlist.name}</h3>
              <p class="text-gray-400 text-sm">
                {playlist.song_count} songs • {playlist.duration}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

**components/content/views/playlists/PlaylistDetailView.tsx:**

```jsx
import { createSignal, createEffect, onMount } from "solid-js";
import { useParams, useLocation } from "@solidjs/router";
import { useStore } from "../../../../store";
import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { apiClient } from "../../../../lib/api-client";

export function PlaylistDetailView() {
  const params = useParams();
  const location = useLocation();
  const [playlist, setPlaylist] = createSignal(null);
  const [songs, setSongs] = createSignal([]);
  const [loading, setLoading] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const events = useGlobalEvents();

  createEffect(() => {
    if (params.id) {
      loadPlaylistData(params.id);
    }
  });

  const loadPlaylistData = async (playlistId) => {
    setLoading(true);
    const [playlistData, songsData] = await Promise.all([
      apiClient.getPlaylist(playlistId),
      apiClient.getPlaylistSongs(playlistId),
    ]);
    setPlaylist(playlistData);
    setSongs(songsData);
    setLoading(false);
  };

  const handlePlayPlaylist = () => {
    if (songs().length > 0) {
      events.emit("song:play", songs()[0]);
      events.emit("queue:replace", songs());
    }
  };

  const handleRemoveSong = async (songId) => {
    await apiClient.removeFromPlaylist(params.id, songId);
    setSongs(songs().filter((song) => song.id !== songId));
  };

  const handleReorderSongs = async (newOrder) => {
    await apiClient.reorderPlaylist(params.id, newOrder);
    setSongs(newOrder);
  };

  return (
    <div class="flex flex-col h-full">
      <div class="p-6 border-b border-white/10">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-2xl font-bold text-white mb-2">
              {playlist()?.name || "loading..."}
            </h1>
            <p class="text-gray-400">
              {songs().length} songs • {playlist()?.duration}
            </p>
          </div>
          <div class="flex gap-2">
            <button
              onClick={handlePlayPlaylist}
              class="px-4 py-2 bg-magenta-500 text-white rounded-lg hover:bg-magenta-600 focus:bg-magenta-700"
            >
              play
            </button>
            <button
              onClick={() => setEditing(true)}
              class="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 focus:bg-gray-600"
            >
              edit
            </button>
          </div>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto">
        <div class="p-4">
          <div class="space-y-1">
            {songs().map((song, index) => (
              <div
                class="flex items-center p-3 hover:bg-magenta-500/20 cursor-pointer rounded-lg group"
                onClick={() => events.emit("song:play", song)}
              >
                <div class="w-8 text-center text-gray-400 text-sm">
                  {index + 1}
                </div>
                <div class="flex-1 ml-3">
                  <div class="text-white font-medium">{song.title}</div>
                  <div class="text-gray-400 text-sm">{song.artist}</div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveSong(song.id);
                  }}
                  class="opacity-0 group-hover:opacity-100 p-2 text-red-400 hover:text-red-300 rounded-lg"
                >
                  remove
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

## Phase 5: Mobile & Polish (Week 6)

### 5.1 Responsive Design

**hooks/useResponsiveLayout.ts:**

```jsx
import { createSignal, onMount, onCleanup } from "solid-js";
import { useStore } from "../store";

export function useResponsiveLayout() {
  const [store, setStore] = useStore();

  const updateBreakpoint = () => {
    const width = window.innerWidth;
    let breakpoint = "desktop";
    if (width < 768) breakpoint = "mobile";
    else if (width < 1024) breakpoint = "tablet";

    setStore("layout", "breakpoint", breakpoint);
  };

  onMount(() => {
    updateBreakpoint();
    window.addEventListener("resize", updateBreakpoint);
    onCleanup(() => window.removeEventListener("resize", updateBreakpoint));
  });

  return store.layout.breakpoint;
}
```

## Migration Strategy

### Week 1: Cleanup

1. **Audit all files** - identify keep vs delete
2. **Rip out complex logic** from index.tsx
3. **Delete unused hooks and utils**
4. **Keep working components** (player, auth, search, icons)

### Week 2: Foundation

1. **Set up Solid Store** instead of nested contexts
2. **Create basic three-column layout**
3. **Integrate existing Player component**
4. **Set up Solid Router with basic routes**

### Week 3: Navigation + Songs

1. **Build Navigation component** with router integration
2. **Create SongTableView** as default view
3. **Integrate existing search components**
4. **Add event system for communication**

### Week 4: Queue + Events

1. **Create Queue component** with store integration
2. **Set up event-driven communication**
3. **Integrate existing player with new architecture**
4. **Add queue management features**

### Week 5: Complete Views

1. **Add Artist views** (split view + detail)
2. **Add Album views** (grid + detail)
3. **Add Search results view**
4. **Complete all routing**

### Week 6: Polish

1. **Add responsive design**
2. **Performance optimization**
3. **Final cleanup and testing**
4. **Remove any remaining dead code**

## Key Benefits

### Solid Store vs Nested Contexts

- **Simpler**: Single store vs multiple providers
- **Performant**: Solid Store is optimized for updates
- **Debuggable**: All state in one place
- **Flexible**: Easy to add new state without new contexts

### Clean Start Approach

- **No dead code**: Remove everything we don't need
- **Fresh architecture**: Build on solid foundation
- **Reuse what works**: Keep player, auth, search, icons
- **Gradual migration**: Add features incrementally

This approach ensures we end up with a clean, maintainable codebase without the baggage of previous iterations.
