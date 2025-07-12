# Three-Column Layout Refactoring Plan

## 🚀 Phase 3: Artist & Album Views (NEXT)

### 3.1 Artist Detail View

- Real API integration with `getArtists()` and `getArtistSongs()`
- Replace mock data in `ArtistSplitView`
- Add `/artist/:id` detail pages
- Artist bio, top songs, albums grid

### 3.2 Album Grid View

- Create `AlbumGridView` component with artwork grid
- Album detail page with track listings
- Connect to `getAlbums()` and `getAlbumTracks()` APIs
- Play album, shuffle, add to queue actions

### 3.3 Playlist Management

- Create/edit/delete playlist modals
- `PlaylistDetailView` with song management
- Drag & drop reordering in playlists
- Real API integration with playlist endpoints

### 3.4 Search Results View

- Search results page layout
- Filter by songs/artists/albums
- Search suggestions and autocomplete

---

## 📋 Phase 4: Mobile & Polish (Future)

- Responsive breakpoints for mobile/tablet
- Mobile navigation patterns
- Performance optimizations
- Accessibility improvements

---

## 🎯 Current Status: Phase 2 COMPLETE!

**✅ Real data fetching, song interactions, polished UI**

| Component             | Status       | Features                                     |
| --------------------- | ------------ | -------------------------------------------- |
| SongTableView         | ✅ Complete  | Real API, infinite scroll, double-click play |
| ArtistSplitView       | ✅ Structure | Two-panel layout, selection state            |
| Song Interactions     | ✅ Complete  | Play, queue, favorite, context menus         |
| UI Polish             | ✅ Complete  | White/gray/magenta colors, hover states      |
| Independent Scrolling | ✅ Complete  | All three columns scroll separately          |

**Key Files:**

- `components/content/views/SongTableView.tsx` - Full-featured song table
- `services/songInteractions.ts` - Song action handlers
- `components/content/views/ArtistSplitView.tsx` - Artist view structure
- Color system working with proper Tailwind config

---

## Core Architecture (Implemented)

### Solid Store

Single store replacing nested contexts:

```tsx
const [store, setStore] = createStore({
  layout: { queueOpen, breakpoint, sidebarCollapsed },
  player: { currentSong, isPlaying, volume, shuffle, repeat },
  queue: { items, currentIndex, history },
  navigation: { currentView, selectedArtist, selectedAlbum },
  search: { query, results, isActive },
  auth: { isAuthenticated, currentUser },
  ui: { modals, contextMenu, notifications },
});
```

### Event System

Type-safe cross-component communication:

```tsx
// Song actions
events.emit("song:play", { song, replaceQueue });
events.emit("song:queue", { song });
events.emit("song:favorite", { song });

// Player controls
events.emit("player:play", {});
events.emit("queue:next", {});
```

### Three-Column Layout

```
┌─────────────────────────────────────────┐
│ Navigation │   Content    │ Queue (opt) │
│ (4 cols)   │   (6-8 cols) │ (3 cols)    │
│            │              │             │
│ - Search   │ - SongTable  │ - Up Next   │
│ - Nav      │ - ArtistView │ - History   │
│ - Playlists│ - AlbumView  │ - Clear     │
│            │              │             │
└─────────────────────────────────────────┘
│              Player Bar                 │
└─────────────────────────────────────────┘
```

---

## ✅ Completed Phases

### Phase 0: Cleanup ✅

- Removed 710-line monolithic `index.tsx`
- Deleted unused hooks and contexts
- Preserved working components (player, auth, icons)
- Set up Solid Router with complete route structure

### Phase 1: Foundation ✅

- Created Solid Store with all state domains
- Built ThreeColumnLayout with responsive grid
- Implemented event system with useGlobalEvents
- Working Navigation, Content, Queue, PlayerWrapper

### Phase 2: Content & Data ✅

- SongTableView with real `getSongs()` API integration
- Infinite scroll with `useInfiniteScroll` hook
- Song interactions: double-click play, single-click queue
- Context menus with comprehensive actions
- ArtistSplitView structure for future Phase 3
- UI polish: white/gray text, magenta accents, transparent borders
- Independent scrolling in all three columns
- Fixed player positioning (no overlap)

**Ready for Phase 3!** 🎵
