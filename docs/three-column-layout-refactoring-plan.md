# Three-Column Layout Refactoring Plan

## 🎵 Current Progress Summary

### ✅ COMPLETED TASKS (1-9):

1. **Context Menu Add to Playlist** ✅ - Working with playlist selector UI
2. **Artists List Infinite Scroll** ✅ - Loads 50 at a time with scroll loading
3. **Context Menus in All Views** ✅ - Shared songInteractions service with context-aware menus and multi-selection
4. **Back Navigation & Layout** ✅ - Inline back buttons with titles, album art moved to right side
5. **Fixed "Created Invalid Date"** ✅ - Robust date parsing with server format handling
6. **Playlist Edit UI** ✅ - Delete only shows when not in edit mode, edit button is pencil icon, cancel button is X icon
7. **Empty Playlist Descriptions** ✅ - Work fine, saved as null
8. **Removed UI Clutter** ✅ - "drag to reorder" text and songs header row removed
9. **Playlist Photo Upload** ✅ - New HTTP endpoint `/api/media/upload_media_blob` for files <10MB, photo upload UI in edit mode, background images with `cover` positioning from top, thumbnails in playlist lists and navigation

### ✅ COMPLETED TASKS (10-12):

10. **macOS/iOS Media Controls Integration** ✅ - Updated window/document page title and Media Session API so media player controls in macOS/iOS show currently playing song + art
11. **Player Layout Fix** ✅ - Shifted all controls to the right, made song title/artist cells expand and fill empty space (no more shifting with different song title lengths)
12. **Reduce Magenta Overuse** ✅ - Reduced magenta font color usage, changed artist names and data to gray text (artist names in song lists, artist names in album grids, song artist + album in playlists)
13. **Responsive Layout Improvements** ✅ - Added mobile-responsive player with stacked progress bar, hamburger menu navigation, single-column mobile layout with sticky header

### 🚀 NEXT PRIORITY TASK (14):

14. **IndexedDB Persistence Planning** - Consider Dexie.js for indexed DB persistence for queue and player state. Research liveQuery integration before implementation.

---

## 📋 Implementation Details (Task #9 Complete)

### Playlist Photo Upload System:

- **New HTTP endpoint**: `/api/media/upload_media_blob` for files <10MB (stores in database vs filesystem)
- **Server-side**: Added proper multipart parsing, size validation, SHA256 hashing, thumbnail generation
- **Client-side**: New `uploadMediaBlob()` method in FileUploadHandler, photo upload UI in playlist edit mode
- **Background images**: Playlist photos display as full backgrounds with `background-size: cover` positioned from top
- **Thumbnails everywhere**: Small thumbnails in playlist lists and navigation sidebar
- **Database schema**: Updated to include `media_blob_id` and `thumbnail_blob_id` fields in playlists
- **TypeScript fixes**: Comprehensive cleanup of 22+ TS errors across the codebase

### Key Files & Patterns:

- **Photo upload**: `server/src/media/songs.rs` (`upload_media_blob` handler), `client/js/src/lib/file-upload.ts` (`uploadMediaBlob` method)
- **Background styling**: `PlaylistDetailView.tsx` with dynamic background-image styles
- **Multi-selection**: `hooks/useSelection.ts` - reusable across views
- **Song interactions**: `services/songInteractions.ts` - shared context menu logic
- **Media Session API**: `Player.tsx` with updateMediaSession() and updatePageTitle() functions
- **Player layout**: Fixed flexbox layout with `flex-1` for song info, `flex-shrink-0` for controls
- **Color consistency**: Changed magenta data text to gray across all views (AlbumGridView, ArtistSplitView, PlaylistDetailView, SearchResultsView)
- **Responsive player**: Mobile layout with stacked progress bar under controls, smaller button sizes, compact spacing
- **Mobile navigation**: Hamburger menu with slide-in navigation overlay, sticky header with integrated search
- **Single column layout**: Mobile devices show one column at a time (nav overlay, content, or queue) with proper view switching
- **MobileSongList component**: Dedicated mobile song list with stacked artist/title layout, album art, and touch-friendly interactions
- **Artist mobile navigation**: Mobile-specific artist view with back button navigation and responsive song display
- **TypeScript compliance**: All responsive layout components pass type checking with proper null checks and type safety

---

## 📋 Responsive Layout Implementation (Task #13 Complete)

### Mobile Player Layout:

- **Stacked design**: Song info + controls on top row, progress bar + times on bottom row
- **Compact controls**: Smaller button sizes (w-8 h-8 vs w-10 h-10), reduced spacing
- **Responsive text**: Smaller font sizes for mobile (text-sm/text-xs vs text-base)
- **Touch-friendly**: Proper touch targets and hover states
- **Queue toggle**: Integrated queue toggle in player controls (removed from header)

### Mobile Navigation System:

- **Hamburger menu**: MenuIcon button in sticky header triggers slide-in navigation
- **Slide-in overlay**: 320px width navigation panel with backdrop blur and smooth slideInLeft animation
- **Auto-close**: Navigation closes when selecting items or clicking outside overlay
- **Clean header**: Simplified header with freqhole branding and hamburger menu only

### Mobile Song Lists:

- **MobileSongList component**: Dedicated component for mobile song display
- **Stacked layout**: Song title, artist, and album info stacked vertically for readability
- **Album art**: 48x48px album artwork with music note fallback
- **Touch interactions**: Optimized for mobile touch with proper spacing and feedback
- **Context menus**: Full context menu and multi-selection support on mobile

### Artist View Mobile Navigation:

- **Mobile view switching**: Toggle between artist list and song list views
- **Back button navigation**: Proper back button with arrow icon to return to artist list
- **Responsive artist list**: Mobile-optimized artist list with touch-friendly tap targets
- **Artist header**: Clean artist name display with song/album counts

### Single Column Layout:

- **Hidden desktop grid**: `hidden md:grid` for three-column layout on mobile
- **Mobile-only sections**: Separate mobile layout with `md:hidden` responsive classes
- **Queue display**: Simple toggle between content and queue on mobile
- **Sticky header**: Fixed position header with integrated search

### Technical Implementation:

- **TypeScript compliant**: All components pass type checking with proper null checks
- **CSS animations**: Smooth slideInLeft animation for mobile navigation
- **Responsive breakpoints**: Uses Tailwind's `md:` prefix for desktop/mobile switching
- **Infinite scroll**: Mobile song lists support infinite scrolling with load more functionality
- **Selection state**: Maintains selection state across mobile/desktop views

---

## 📋 IndexedDB Persistence Planning (Task #14)

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

- `client/js/src/lib/persistence.ts` - Database setup and operations
- `client/js/src/hooks/usePersistentStore.ts` - Store wrapper with persistence
- `client/js/src/utils/storage.ts` - Storage utilities and fallbacks

**Research Questions:**

- How to handle liveQuery with SolidJS reactivity system?
- Should we persist full queue or just queue metadata + rebuild from API?
- How to handle schema migrations for future updates?
- Performance impact of frequent currentTime updates?

---

## 🚀 Phase 5: Advanced Features (NEXT)

### 5.1 Enhanced Playlist Features

- Context menu for "+ add to playlist" buttons on song rows
- Drag & drop reordering within playlists
- Create playlist modals with song selection interface
- Playlist search results integration
- Bulk operations (select multiple songs, add to playlist)

### 5.2 Enhanced Navigation & Detail Pages

- Album detail pages with `/album/:id` routes
- Artist detail pages with `/artist/:id` routes
- Improved search result → view navigation with deep linking
- Breadcrumb navigation for better UX

### 5.3 Mobile & Polish

- Responsive breakpoints for mobile/tablet devices
- Touch-friendly interactions and gestures
- Mobile navigation patterns (hamburger menu, swipe gestures)
- Progressive Web App (PWA) capabilities

### 5.4 Performance & Accessibility

- Virtual scrolling for large song lists
- Keyboard navigation improvements throughout the app
- Screen reader support and ARIA labels
- Loading optimizations and code splitting
- Image lazy loading and optimization

### 5.5 Advanced Audio Features

- Audio visualization (waveform display)
- Equalizer controls
- Crossfade between tracks
- Gapless playback
- Audio effects and filters

---

## 🎯 Current Status: Phase 4 COMPLETE! ✅

**✅ Complete music player application with full audio playback and polished UI**

| Component          | Status      | Features                                     |
| ------------------ | ----------- | -------------------------------------------- |
| Audio Playback     | ✅ Complete | Real HTML5 audio, progress tracking, seeking |
| Player UI          | ✅ Complete | Beautiful design, volume, queue management   |
| Search System      | ✅ Complete | Real-time suggestions, filtered results      |
| SearchResultsView  | ✅ Complete | Filter tabs, song/artist/album results       |
| Search Suggestions | ✅ Complete | Real-time flyout, keyboard navigation        |
| ArtistSplitView    | ✅ Complete | Real API, song listings, play/queue actions  |
| AlbumGridView      | ✅ Complete | Artwork grid, album detail, track listings   |
| PlaylistDetailView | ✅ Complete | CRUD operations, song management             |
| SongTableView      | ✅ Complete | Real API, infinite scroll, double-click play |
| Song Interactions  | ✅ Complete | Consistent double-click behavior everywhere  |
| UI Polish          | ✅ Complete | Clean design, proper spacing, hover states   |

**Key Achievements:**

- **Full Audio Playback**: Real HTML5 audio with progress tracking, seeking, and volume control
- **Beautiful Player UI**: Sleek bottom player with album artwork, controls, and queue management
- **Complete Search System**: Real-time suggestions with comprehensive filtered results
- **Consistent Interactions**: Double-click to play, proper queue management throughout
- **Real Content Views**: All major music library sections working with live data
- **Type-Safe Architecture**: Comprehensive TypeScript coverage with error-free compilation
- **Performance Optimized**: Clean effects, no memory leaks, efficient re-renders

---

## Core Architecture (Implemented)

### Solid Store

Single store managing all application state:

```tsx
const [store, setStore] = createStore({
  layout: { queueOpen, breakpoint, sidebarCollapsed },
  player: {
    currentSong,
    isPlaying,
    volume,
    shuffle,
    repeat,
    duration,
    currentTime,
  },
  queue: { items, currentIndex, history },
  navigation: { currentView, selectedArtist, selectedAlbum, selectedPlaylist },
  search: { query, results, isActive, loading },
  auth: { isAuthenticated, currentUser, token },
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
events.emit("player:pause", {});
events.emit("player:volume", { volume });
events.emit("player:seek", { time });

// Navigation
events.emit("artist:selected", { artist });
events.emit("album:selected", { album });
events.emit("playlist:selected", { playlist });
```

### Audio System

Real HTML5 audio playback integration:

```tsx
// Audio element management
const audio = new Audio();
audio.src = `${apiClient.getBaseUrl()}/api/blobs/${song.media_blob_id}`;
audio.addEventListener("timeupdate", () => updateProgress());
audio.addEventListener("ended", () => playNext());
```

### Three-Column Layout

```
┌─────────────────────────────────────────┐
│ Navigation │   Content    │ Queue (opt) │
│ (288px)    │   (flexible) │ (3 cols)    │
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

### Phase 4: Audio Playback & Interaction Polish ✅

#### 4.3 Audio Playback Integration ✅

- **Real Audio Playback**: HTML5 Audio element with full lifecycle management
- **Progress Tracking**: Real-time currentTime updates with seeking functionality
- **Volume Control**: Audio volume synced with UI slider controls
- **Auto-Next**: Automatic advancement to next song when current song ends
- **Error Handling**: Graceful handling of audio loading and playback errors
- **Resource Cleanup**: Proper audio element cleanup on component unmount

#### 4.4 Enhanced Player UI ✅

- **Beautiful Design**: Sleek bottom player with album artwork and gradients
- **Full Controls**: Play/pause, previous/next, volume, progress seeking
- **Queue Integration**: Queue toggle with live count badge
- **Keyboard Shortcuts**: Space (play/pause), Q (queue), Shift+arrows (nav), arrows (seek)
- **Visual Feedback**: Playing states, progress indication, hover effects
- **Responsive Layout**: Fixed bottom position that doesn't interfere with content

#### 4.5 Interaction Consistency ✅

- **Double-Click Behavior**: Consistent across all views (songs table, artists, albums, search)
- **Queue Management**: Songs table double-click adds to queue (doesn't replace)
- **Artist/Album Views**: Removed single-click, only double-click to play
- **Play All/Shuffle Fixed**: Now properly adds all songs to queue, not just first song
- **Direct Service Calls**: Using songInteractions service directly for reliable queue operations

### Phase 4: Search System ✅

#### 4.1 Search Results View ✅

- **Created `SearchResultsView.tsx`** with comprehensive search functionality
- Real API integration with `searchMusic()` and `searchSongs()`
- Filter tabs: All, Songs, Artists, Albums with live result counts
- Smart extraction of artists/albums from song results (server API enhancement needed)
- Song playback: double-click to play, + button to add to queue
- Smart navigation: artist/album results link to respective views with pre-selection
- Loading states, empty states, and error handling
- Type-safe search result handling and Song conversion
- Consistent styling with magenta/white/gray theme

#### 4.2 Search Suggestions ✅

- **Enhanced `NavigationHeader.tsx`** with real-time search suggestions
- Integrated existing `SearchSuggestions` component with custom styling
- Flyout menu with keyboard navigation (arrow keys, enter, escape)
- Real-time API suggestions with `useSearchSuggestions` hook
- Debounced search queries for performance
- Focus/blur handling with click-outside detection
- Custom dark theme styling for freqhole interface

### Phase 3: Artist & Album Views ✅

#### 3.1 Artist Detail View ✅

- **Updated `ArtistSplitView.tsx`** with real API integration
- Real API integration with `getArtists()` and `getArtistSongs()`
- Two-panel layout: 288px artist list + flexible detail area
- Artist info cards (song count, album count, genres)
- Song listings with double-click to play and hover actions
- Play all, shuffle, add to queue functionality working correctly
- Proper text truncation to prevent horizontal overflow

#### 3.2 Album Grid View ✅

- **Created `AlbumGridView.tsx`** with artwork grid layout
- Real API integration with `getAlbums()` and `getAlbumTracks()`
- Responsive grid (2-5 columns based on screen size)
- Album artwork with proper image URLs via `apiClient.getBaseUrl()`
- Album detail view with large artwork and track listings
- Play album, shuffle, add to queue actions working correctly
- Back navigation between grid and detail views

#### 3.3 Playlist Management ✅

- **Created `PlaylistDetailView.tsx`** with full CRUD capabilities
- Real API integration with all playlist endpoints
- Playlist listing with create button
- Edit playlist title/description inline
- Delete playlists with confirmation
- Remove songs from playlists
- Play/shuffle/queue playlist functionality working correctly
- Song interaction within playlists

#### 3.4 Route Integration ✅

- Updated `routes/index.tsx` with new components:
  - `/artists` → `ArtistSplitView` (real data)
  - `/albums` → `AlbumGridView` (new)
  - `/playlists` → `PlaylistDetailView` (new)
  - `/playlist/:id` → `PlaylistDetailView` (new)
  - `/search` → `SearchResultsView` (new)

### Phase 2: Content & Data ✅

- SongTableView with real `getSongs()` API integration
- Infinite scroll with `useInfiniteScroll` hook
- Song interactions: double-click to add to queue and play
- Context menus with comprehensive actions
- UI polish: white/gray text, magenta accents, transparent borders
- Independent scrolling in all three columns
- Fixed player positioning (no overlap)

### Phase 1: Foundation ✅

- Created Solid Store with all state domains
- Built ThreeColumnLayout with responsive grid
- Implemented event system with useGlobalEvents
- Working Navigation, Content, Queue, PlayerWrapper

### Phase 0: Cleanup ✅

- Removed 710-line monolithic `index.tsx`
- Deleted unused hooks and contexts
- Preserved working components (player, auth, icons)
- Set up Solid Router with complete route structure

## ✅ Recent Completed Tasks (Latest Session):

**Context Menus & Multi-Selection Complete:**

- ✅ **#1**: Add to playlist from context menu - Working with playlist selector UI
- ✅ **#2**: Artists list infinite scroll - Loads 50 at a time with scroll loading
- ✅ **#3**: Context menus in all views - ArtistSplitView, AlbumGridView, PlaylistDetailView all use shared songInteractions service with context-aware menus and multi-selection
- ✅ **#4**: Fixed back navigation - Inline back buttons with titles, album art moved to right side
- ✅ **#5**: Fixed "Created Invalid Date" bug - Robust date parsing with server format handling
- ✅ **#6**: Updated playlist buttons - Delete only shows when not in edit mode, edit button is pencil icon, cancel button is X icon
- ✅ **#7**: Empty playlist descriptions - Work fine, saved as null
- ✅ **#8**: Removed UI clutter - "drag to reorder" text and songs header row removed
- ✅ **#9**: Playlist photo upload complete - New HTTP endpoint `/api/media/upload_media_blob` for files <10MB, photo upload UI in edit mode, background images with `cover` positioning from top, thumbnails in playlist lists and navigation

**Key Infrastructure Added:**

- ✅ **Multi-selection** working in all song views (Ctrl/Cmd+Click, Shift+Click range)
- ✅ **Context menus** with bulk operations across all views
- ✅ **Shared date utilities** in `utils/dateUtils.ts` with relative formatting ("2 hours ago", "yesterday", etc.)
- ✅ **Playlist selector menu** with smart naming and recent playlists list
- ✅ **Auto-clearing selections** after successful operations
- ✅ **Media upload system** with new HTTP endpoint for small files, integrated with playlist management
- ✅ **Enhanced TypeScript** with comprehensive error fixes and proper type definitions

**Ready for Phase 5: Advanced Features!** 🎵

---

## Server API Enhancement Recommendations

### Search API Improvements

Currently the search API only returns songs and playlists. Consider enhancing it to return:

```json
{
  "results": [
    {
      "id": "artist-123",
      "result_type": "artist",
      "title": "Artist Name",
      "subtitle": "12 albums, 145 songs",
      "thumbnail_blob_id": "artist-thumb-id",
      "metadata": {
        "song_count": 145,
        "album_count": 12,
        "genres": ["rock", "alternative"]
      }
    },
    {
      "id": "album-456",
      "result_type": "album",
      "title": "Album Name",
      "subtitle": "Artist Name",
      "thumbnail_blob_id": "album-thumb-id",
      "metadata": {
        "year": 2023,
        "track_count": 12,
        "duration": "45:32"
      }
    }
  ]
}
```

This would eliminate the need for client-side artist/album extraction from song results.

### Playlist Search Integration

Consider adding playlist results to the search API for comprehensive music discovery.
