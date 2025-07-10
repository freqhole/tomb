# Freqhole Audio Player - Modular Decomposition Plan

## 🎯 Current Focus: Phase B - API Types & Interfaces Extraction

### Phase B: API Types & Zod Schema Extraction (NEXT PRIORITY)

**Goal**: Extract all fetch() calls from zoony.tsx and integrate with existing ApiClient patterns using Zod schemas

#### B.1 Extend ApiClient with Music Methods (`client/js/src/lib/music/`)

- Extract all fetch() calls from zoony.tsx and add as methods to existing ApiClient
- Create Zod schemas as source of truth for types (using z.infer)
- Implement graceful collection parsing (omit invalid items, don't fail whole collection)
- Add verbose logging for parse failures with configurable log levels
- Follow existing ApiClient patterns (searchMusic, searchSongs, etc.)

**File structure**:

```
client/js/src/lib/music/
├── schemas/
│   ├── song.ts           # Song schema + z.infer types
│   ├── album.ts          # Album schema + z.infer types
│   ├── artist.ts         # Artist schema + z.infer types
│   ├── playlist.ts       # Playlist schema + z.infer types
│   ├── queue.ts          # Queue schema + z.infer types
│   └── index.ts          # Re-export all schemas & types
├── validation.ts         # Graceful parsing utilities (like search/validation.ts)
├── api-methods.ts        # Music API methods to extend ApiClient
├── types.ts              # Re-export all z.infer types
└── index.ts              # Main barrel export
```

#### B.2 Extend ApiClient Class

- Add music methods to existing ApiClient class in `api-client.ts`
- Follow existing patterns from `searchMusic`, `searchSongs`, etc.
- Use graceful validation like existing search methods
- Maintain consistency with existing error handling and timeout patterns

#### B.3 Fetch Call Extraction

**Extract all fetch() calls from zoony.tsx**:

- Search for all `fetch("/api/...` calls in zoony.tsx
- Add corresponding methods to ApiClient class
- Replace with typed API client methods
- Follow existing ApiClient patterns and error handling

**Before (zoony.tsx)**:

```typescript
const response = await fetch("/api/songs");
const songsData = await response.json();
```

**After (using extended ApiClient)**:

```typescript
import { apiClient } from "../../lib/api-client.js";
const songs = await apiClient.getSongs(); // Returns Song[] with runtime validation
```

#### B.4 Graceful Collection Parsing Pattern

```typescript
// music/validation.ts (following existing search/validation.ts pattern)
export const musicValidation = {
  validateResponse<T>(
    schema: z.ZodSchema<T>,
    data: unknown,
    context: string,
  ): T {
    const result = schema.safeParse(data);
    if (result.success) {
      return result.data;
    }

    console.error(`${context} validation failed:`, result.error);
    throw new Error(`Invalid ${context} response format`);
  },

  parseCollection<T>(
    schema: z.ZodSchema<T>,
    data: unknown[],
    context: string,
  ): T[] {
    const results: T[] = [];

    data.forEach((item, index) => {
      const parsed = schema.safeParse(item);
      if (parsed.success) {
        results.push(parsed.data);
      } else {
        console.warn(`Failed to parse ${context} at index ${index}:`, {
          error: parsed.error,
          data: item,
        });
      }
    });

    return results;
  },
};
```

#### B.5 Schema Examples

```typescript
// schemas/song.ts
export const SongSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string().nullish(),
  duration: z.number(),
  genre: z.string().nullish(),
  year: z.number().nullish(),
  bitrate: z.number().nullish(),
  playCount: z.number().default(0),
  url: z.string().url(),
});

export type Song = z.infer<typeof SongSchema>;
```

**Benefits**:

- 🔍 Runtime validation with compile-time types
- 🛡️ Graceful error handling in collections
- 📊 Detailed logging for debugging data issues
- 🎯 Single source of truth for data structures
- 🚀 Better developer experience with IntelliSense
- 🔄 Easy schema evolution and migration

### Phase C: Icon Components Extraction

**Goal**: Create reusable icon components for consistent styling

#### C.1 Icon Library (`client/js/src/views/freqhole/components/ui/icons/`)

- Extract SVG icons into individual components
- Consistent sizing, theming, and hover states
- Props for customization (size, color, className)

### Phase D: State Management Extraction

**Goal**: Extract all state management logic into custom hooks

#### D.1 Music State Hook (`client/js/src/views/freqhole/hooks/useMusicState.ts`)

- Extract: Track management, playlist operations, library state
- Return: `{ tracks, playlists, addToPlaylist, removeTrack, ... }`

#### D.2 Player State Hook (`client/js/src/views/freqhole/hooks/usePlayerState.ts`)

- Extract: Playback state, queue management, audio controls
- Return: `{ currentTrack, isPlaying, progress, queue, play, pause, next, ... }`

#### D.3 View State Hook (`client/js/src/views/freqhole/hooks/useViewState.ts`)

- Extract: UI state, modal states, view switching
- Return: `{ currentView, showModal, toggleSidebar, ... }`

#### D.4 Update Components

- Replace direct state access with hook calls
- Maintain all existing functionality

### Phase E: API Client Integration

**Goal**: Complete integration of music API methods with existing ApiClient

#### E.1 Music API Integration (`client/js/src/lib/api-client.ts`)

- Integrate music methods into existing ApiClient class
- Update all components to use extended ApiClient methods
- Replace direct fetch() calls in zoony.tsx with API client methods
- Ensure backward compatibility during transition

**Integration Examples**:

```typescript
// Before (in zoony.tsx):
const response = await fetch("/api/songs");
const songs = await response.json();

// After (using extended ApiClient):
import { apiClient } from "../../lib/api-client.js";
const songs = await apiClient.getSongs();
```

#### E.2 Error Handling & Logging

- Use existing ApiError class and error handling patterns
- Leverage existing timeout and validation infrastructure
- Follow existing logging patterns from search methods
- Graceful degradation when API calls fail

### Phase F: Styles Extraction

**Goal**: Organize component styles for maintainability

#### F.1 Component Styles (`client/js/src/views/freqhole/styles/`)

- Extract component-specific styles
- Maintain existing Metro UI theme
- Organize CSS for better maintainability

### Phase G: IndexedDB Persistence (MOVED FROM A.4)

**Goal**: Add persistent state management for seamless user experience

#### G.1 Player State Persistence (`client/js/src/views/freqhole/hooks/usePersistedPlayer.ts`)

- Save current song, playback position, volume, and queue to IndexedDB
- Restore player state on page refresh/reload
- Handle edge cases (song no longer available, corrupted data)
- Background sync to prevent data loss during playback

#### G.2 Queue Persistence (`client/js/src/views/freqhole/hooks/usePersistedQueue.ts`)

- Persist entire play queue and current index
- Save queue context (playlist, artist, album that generated the queue)
- Handle queue restoration with proper fallbacks
- Smart queue updates (avoid overwriting user changes)

#### G.3 User Preferences Persistence

- Save volume preferences, repeat/shuffle modes
- UI state (sidebar visibility, queue visibility)
- Last viewed section (music/artists/albums/playlists)
- Search history and preferences

**File structure**:

```
client/js/src/views/freqhole/hooks/
├── persistence/
│   ├── usePersistedPlayer.ts    # Player state persistence
│   ├── usePersistedQueue.ts     # Queue state persistence
│   ├── useUserPreferences.ts    # UI preferences
│   └── indexedDbUtils.ts        # IndexedDB utilities
└── index.ts                     # Updated barrel export
```

### Phase H: State Management Hooks (OPTIONAL)

**Goal**: Further extract state management into custom hooks

- Extract player/queue logic into `usePlayerQueue` hook
- Create `useMusicLibrary` hook for data management
- Simplify component props and state management
- Improve testability and reusability

## Execution Strategy

### Priority Order

1. **Phase B**: API Types & Zod Schema Extraction (IMMEDIATE NEXT)
   - B.1: Create Zod schemas and music validation utilities
   - B.2: Extract fetch() calls from zoony.tsx
   - B.3: Add music methods to existing ApiClient class
   - B.4: Replace zoony.tsx fetch calls with ApiClient methods
2. **Phase C**: Icon components
3. **Phase D**: State management hooks
4. **Phase E**: API integration and cleanup
5. **Phase F**: Styles organization
6. **Phase G**: IndexedDB persistence
7. **Phase H**: Advanced state management hooks

### Key Principles

- **Never break existing functionality**
- **Test thoroughly after each extraction**
- **Keep zoony.tsx working throughout**
- **Maintain all existing features**
- **Gradual, incremental changes**
- **Schemas as single source of truth**
- **Graceful error handling in collections**
- **Verbose logging for debugging**
- **Integrate with existing ApiClient patterns**
- **Maintain consistency with existing search methods**

### Testing Strategy

- Manual testing after each component extraction
- Verify all player functionality works
- Test responsive behavior
- Ensure no visual regressions

### Success Metrics

- **Functional Parity**: All existing features work identically
- **Code Organization**: Clear separation of concerns and modular architecture
- **Performance**: No regression in load times or runtime performance
- **Developer Experience**: Easier to understand, modify, and extend
- **Maintainability**: Easier to add new features and fix bugs

## Project Goals

**Primary Goal**: Transform the monolithic zoony.tsx into a modular, maintainable component architecture while preserving all existing functionality and integrating with the established Metro UI theme.

## Current State Analysis

### Existing Assets

- **zoony.tsx**: Complete music player implementation (~2000+ lines)
- **Metro UI Components**: Panel, Modal, Popover, Context Menu systems
- **Infinite Data Grid**: Reusable virtualized grid for large datasets
- **API Integration**: WebAuthn authentication, music API endpoints
- **Responsive Layout**: Tailwind CSS with custom Metro theme

### Infinite Data Grid Reusability Assessment

**Current Implementation** (in data-grid-test.tsx):

```typescript
type ListItem = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: string;
  genre: string;
};

const columns = [
  { key: "title", header: "Title", width: 200 },
  { key: "artist", header: "Artist", width: 150 },
  { key: "album", header: "Album", width: 150 },
  { key: "duration", header: "Duration", width: 80 },
  { key: "genre", header: "Genre", width: 100 },
];
```

**Freqhole Requirements**:

```typescript
type GridItem = Track | Album | Artist | Playlist;

const renderGridItem = (
  item: GridItem,
  type: "track" | "album" | "artist" | "playlist",
) => {
  // Custom rendering logic for each type
  // Album covers, play buttons, context menus
  // Rich metadata display
};

const columns = {
  track: [
    { key: "title", header: "Title", width: 250 },
    { key: "artist", header: "Artist", width: 200 },
    { key: "album", header: "Album", width: 200 },
    { key: "duration", header: "Duration", width: 100 },
    { key: "genre", header: "Genre", width: 120 },
    { key: "year", header: "Year", width: 80 },
    { key: "bitrate", header: "Quality", width: 100 },
  ],
  // ... other types
};
```

## Risks and Mitigation

### Technical Risks

1. **Performance Regression**: Large component tree could impact performance
   - _Mitigation_: Implement proper memoization and lazy loading

2. **State Management Complexity**: Complex state sharing between components
   - _Mitigation_: Use proven patterns (hooks, context) and keep state localized

3. **Testing Complexity**: More components mean more testing surface area
   - _Mitigation_: Focus on integration tests and critical user flows

### Project Risks

1. **Scope Creep**: Temptation to add new features during refactoring
   - _Mitigation_: Strict focus on decomposition, feature additions come later

2. **Timeline Pressure**: Stakeholder expectations for quick delivery
   - _Mitigation_: Incremental delivery with working versions at each phase

---

## ✅ Completed Phases

### Phase A.3: Final Migration (COMPLETE) ✅

**Goal**: Complete migration to Panel-based Freqhole layout and cleanup

**Completed Tasks**:

1. ✅ **Integrated all components** into Panel layout with FreqholeProvider
2. ✅ **Implemented context-based state management** (no more prop drilling!)
3. ✅ **Full Tailwind conversion** with minimal custom CSS
4. ✅ **Auth integration** working with Header component
5. ✅ **Player/queue functionality** working with context hooks
6. ✅ **Clean component architecture** with separation of concerns
7. ✅ **FreqholeProvider context** - eliminates prop drilling, scales for future state
8. ✅ **Consolidated hooks** - complete usePlayerQueue with all utility functions

**Migration Status**: ✅ Complete and ready for production!

#### A.3.1 Switch Main Entry Point ✅

- ✅ Updated `client/js/src/views/freqhole/main.tsx` to render `<Freqhole />` instead of `<Zoony />`
- ✅ Successfully switched from zoony.tsx to Panel-based layout

#### A.3.2 Component Integration ✅

- ✅ Integrated Header component into Freqhole Panel layout
- ✅ Integrated Player component with Panel responsive design
- ✅ Added usePlayerQueue hook integration for state management
- ✅ Connected auth system with Header component
- ✅ Maintained all existing functionality

#### A.3.3 Tailwind Conversion ✅

**Completed**: Full conversion from CSS classes to Tailwind utilities

- ✅ Converted Header component to Tailwind classes
- ✅ Converted Player component to Tailwind classes
- ✅ Converted QueueViewer component to Tailwind classes
- ✅ Removed all custom CSS except minimal animations and slider styles
- ✅ Maintained responsive design and Metro UI aesthetic
- ✅ Added proper SearchBox styling integration

#### A.3.4 FreqholeProvider Context Architecture ✅

**Completed**: Scalable context-based state management

- ✅ Created FreqholeProvider wrapping entire app
- ✅ Eliminated 15+ props from Player component
- ✅ Context-aware components (Player, QueueViewer use `useMusicPlayer()`)
- ✅ Future-ready for additional global state (search, library, preferences)
- ✅ Type-safe context with proper error handling

**File structure**:

```
client/js/src/views/freqhole/components/
├── header/
│   ├── Header.tsx          # Full Tailwind conversion
│   └── index.ts
├── player/
│   ├── Player.tsx          # Context-aware, no props needed
│   ├── QueueViewer.tsx     # Context-aware, no props needed
│   └── index.ts
└── icons/
    └── index.tsx          # Centralized icons with class prop support
```

**Benefits Achieved**:

- 🎨 Consistent Tailwind utility classes throughout
- 📱 Maintained responsive design patterns
- ⚡ Reduced CSS bundle size
- 🔧 Easier maintenance and customization
- 🎯 Better integration with Panel layout system
- 🧹 Clean components with no prop drilling
- 🔄 Reusable hooks accessible anywhere in app
- 📈 Scalable architecture ready for future features

### Phase A.2: Decomposition Strategy ✅

**Goal**: Extract Header and Player components while keeping zoony.tsx working

#### A.2.1 Header Component Extraction ✅

**Completed**: `client/js/src/views/freqhole/components/header/Header.tsx`

- ✅ Extracted header section (logo, navigation, search, user menu)
- ✅ Maintained all existing functionality
- ✅ Props: `currentView`, `onViewChange`, `searchQuery`, `onSearch`, `onClearSearch`, `searchContext`
- ✅ Integrated auth system (UserMenu component)
- ✅ Updated zoony.tsx to use Header component
- ✅ All functionality tested and working

**File structure**:

```
client/js/src/views/freqhole/components/header/
├── Header.tsx          # Main header component
└── index.ts           # Barrel export
```

#### A.2.2 Player Component Extraction ✅

**Completed**: `client/js/src/views/freqhole/components/player/Player.tsx`

- ✅ Extracted player section (controls, progress, volume, now playing)
- ✅ Maintained all existing functionality
- ✅ Props: `currentSong`, `isPlaying`, `currentTime`, `duration`, `volume`, `currentQueueIndex`, `playQueue`, etc.
- ✅ Updated zoony.tsx to use Player component
- ✅ All player functionality tested and working

**File structure**:

```
client/js/src/views/freqhole/components/player/
├── Player.tsx          # Main player component
├── QueueViewer.tsx     # Queue display and management
└── index.ts           # Barrel export
```

#### A.2.3 Icons Centralization ✅

**Completed**: `client/js/src/views/freqhole/components/icons/index.tsx`

- ✅ Centralized all SVG icons into single file
- ✅ Updated all components to use centralized icons
- ✅ Removed duplicate icon definitions
- ✅ Improved maintainability and consistency

**File structure**:

```
client/js/src/views/freqhole/components/icons/
└── index.tsx          # All SVG icons
```

#### A.2.4 Player Queue Hooks ✅

**Completed**: Consolidated hook architecture for optimal state management

- ✅ `usePlayerQueue.ts` - Complete player + queue functionality (consolidated from 3 hooks)
- ✅ All utility functions restored: `stop()`, `toggleMute()`, `seekToTime()`, `moveToNext()`, etc.
- ✅ Context integration with FreqholeProvider
- ✅ Type-safe interfaces for Song, QueueItem, Playlist, etc.
- ✅ Eliminated redundant code (removed duplicate useQueue.ts and usePlayer.ts)

**File structure**:

```
client/js/src/views/freqhole/
├── hooks/
│   ├── usePlayerQueue.ts   # Complete solution (30+ functions)
│   └── index.ts           # Barrel export
└── context/
    ├── FreqholeContext.tsx # Global state provider
    └── index.ts           # Context exports
```

#### A.2.5 Code Quality & TypeScript Compliance ✅

**Completed**: Fixed all TypeScript errors and cleaned up code

- ✅ Fixed undefined array access in `usePlayerQueue.ts`
- ✅ Corrected type definitions for `onViewChange` prop
- ✅ Added missing `canGoNext` and `canGoPrevious` props to Player
- ✅ Removed unused imports (`SearchBox`, `DragIcon`, `MoreIcon`)
- ✅ Removed unused functions (`openAddSongsModal`, `reorderPlaylistSongs`)
- ✅ All TypeScript strict mode compliant

### Phase 0: Auth Integration ✅

**Goal**: Adapt existing WebAuthn component to use Modal system and integrate auth flow into Freqhole

#### 0.1 Extract Auth Logic (`client/js/src/hooks/auth/index.ts`) ✅

- Extracted auth state management from webauthn-component.tsx:
  - `checkAuthStatus()`, `handleLogin()`, `handleRegister()`, `handleLogout()`
  - Auth signals: `isAuthenticated`, `currentUser`, `isLoading`
  - API client integration with existing ApiClient
- Created composable hook that returns auth state and actions

#### 0.2 Auth Modal Component (`client/js/src/views/freqhole/components/auth/AuthModal.tsx`) ✅

- Adapted webauthn UI to use Modal component system
- Login/Register forms with Tailwind styling (Metro UI theme)
- Loading states, error handling, form validation
- Props: `isOpen`, `onClose`, `onAuthSuccess`

#### 0.3 User Menu Component (`client/js/src/views/freqhole/components/auth/UserMenu.tsx`) ✅

- Small square fuchsia button in header (top-right)
- Popover with user info and logout option
- Uses existing Popover component with proper positioning
- Props: `currentUser`, `onLogout`

#### 0.4 Auth Hook Pattern (RECOMMENDED) ✅

**Strategy**: Use composable hooks instead of prop drilling for cleaner architecture

Created `useAuth()` hook that can be called from any component that needs auth state:

- **Main Freqhole component**: `const { isAuthenticated, checkAuth } = useAuth()`
- **Header component**: `const { currentUser, logout } = useAuth()`
- **Any other component**: Just import and call `useAuth()`

This avoids prop drilling while keeping state management simple and testable.

#### 0.5 Integration into Freqhole (`client/js/src/views/freqhole/index.tsx`) ✅

- Added auth check on component mount
- Shows AuthModal if not authenticated
- Header component uses `useAuth()` hook directly
- Handles auth success/logout events

### Phase A.1: Switch Main Entry Point ✅

**Goal**: Temporarily switch to zoony.tsx while we decompose it, then migrate back

#### A.1 Switch Main Entry Point (`client/js/src/views/freqhole/main.tsx`) ✅

- Changed from rendering `<Freqhole />` to `<Zoony />`
- Kept all existing dev environment working
- This gives us a working baseline to decompose from

## ✅ Completed Components

### 🎨 **Panel System**

- Responsive grid layout with breakpoint-aware column spans
- Drag-and-drop panel reordering
- Panel minimize/maximize functionality
- Integrated with existing Metro UI theme

### 🖱️ **Context Menu System**

- Right-click context menus for tracks, playlists, albums
- Keyboard navigation support
- Proper z-index management and positioning
- Integrated with existing action system

### 📱 **Modal & Popover System**

- Reusable Modal component with backdrop and animations
- Popover component for tooltips and dropdown menus
- Proper focus management and accessibility
- Used by auth system and context menus

### 🎯 **Metro UI Foundation**

- Consistent color scheme and typography
- Responsive design patterns
- Component library integration
- Tailwind CSS optimization

## Previous Planning Phases

### Phase 1: Vite Development Setup ✅

#### 1.1 Create Traditional Vite Config ✅

**File**: `vite.config.freqhole.ts`

```typescript
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import { resolve } from "path";

export default defineConfig({
  plugins: [solidPlugin()],
  root: "client/js",
  build: {
    outDir: "../../dist/freqhole",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "client/js/src/views/freqhole/main.tsx"),
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "client/js/src"),
    },
  },
  server: {
    port: 3001,
    host: true,
  },
});
```

#### 1.2 Entry Point Setup ✅

**File**: `client/js/src/views/freqhole/main.tsx`

```typescript
import { render } from "solid-js/web";
import { Freqhole } from "./index";
import "./styles.css";
```

#### 1.3 Package.json Scripts ✅

```json
{
  "scripts": {
    "dev:freqhole": "vite --config vite.config.freqhole.ts",
    "build:freqhole": "vite build --config vite.config.freqhole.ts",
    "preview:freqhole": "vite preview --config vite.config.freqhole.ts"
  }
}
```

### Phase 2: Tailwind CSS Integration ✅

#### 2.1 Install Tailwind Dependencies ✅

```bash
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

#### 2.2 Tailwind Configuration ✅

**File**: `tailwind.config.js`

```javascript
module.exports = {
  content: ["./client/js/src/views/freqhole/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        "metro-blue": "#0078d4",
        "metro-purple": "#8764b8",
        "metro-teal": "#00bcb4",
        "metro-orange": "#ff8c00",
        "metro-red": "#e74c3c",
        "metro-green": "#00cc88",
        "metro-gray": "#666666",
        "metro-dark": "#1a1a1a",
        "metro-light": "#f4f4f4",
      },
    },
  },
  plugins: [],
};
```

#### 2.3 CSS Entry Point ✅

**File**: `client/js/src/views/freqhole/styles.css`

```css
@import "tailwindcss/base";
@import "tailwindcss/components";
@import "tailwindcss/utilities";

body {
  font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
  background-color: #1a1a1a;
  color: #ffffff;
}
```

### Phase 3: Core Layout Structure ✅

#### 3.1 Layout Components Architecture ✅

**File**: `client/js/src/views/freqhole/components/layout/`

- `MainLayout.tsx`: Overall app container
- `Header.tsx`: Top navigation and search
- `Sidebar.tsx`: Left navigation panel
- `ContentArea.tsx`: Main content display
- `PlayerFooter.tsx`: Bottom player controls

**Features**:

- Responsive grid layout
- Flexible panel system
- Integrated with Metro UI theme
- Keyboard navigation support

#### 3.2 Responsive Grid System ✅

```typescript
const layouts = {
  lg: { cols: 12, rows: 8 },
  md: { cols: 8, rows: 6 },
  sm: { cols: 4, rows: 4 },
};

const columnSpans = {
  header: { lg: 12, md: 8, sm: 4 },
  sidebar: { lg: 2, md: 2, sm: 4 },
  content: { lg: 10, md: 6, sm: 4 },
  player: { lg: 12, md: 8, sm: 4 },
};
```

#### 3.3 Player Footer Integration ✅

Integrated player controls with:

- Play/pause/next/previous buttons
- Progress bar with scrubbing
- Volume controls
- Queue management
- Now playing display

### Phase 5: Music-Specific Data Grid

#### 5.1 Infinite Grid Adaptations

**Track List View**:

```typescript
type ListItem = Track;

const columns = [
  { key: "title", header: "Title", width: 250 },
  { key: "artist", header: "Artist", width: 200 },
  { key: "album", header: "Album", width: 200 },
  { key: "duration", header: "Duration", width: 100 },
  { key: "genre", header: "Genre", width: 120 },
  { key: "year", header: "Year", width: 80 },
  { key: "bitrate", header: "Quality", width: 100 },
  { key: "playCount", header: "Plays", width: 80 },
  { key: "dateAdded", header: "Added", width: 120 },
  { key: "rating", header: "Rating", width: 100 },
];
```

**Album Grid View**:

```typescript
type GridItem = Album;

const renderGridItem = (album: Album) => (
  <div class="album-card">
    <img src={album.coverUrl} alt={album.title} />
    <h3>{album.title}</h3>
    <p>{album.artist}</p>
    <p>{album.year}</p>
  </div>
);

const columns = [
  { key: 'cover', header: '', width: 200 },
  { key: 'title', header: 'Album', width: 200 },
  { key: 'artist', header: 'Artist', width: 150 },
  { key: 'year', header: 'Year', width: 80 },
  { key: 'trackCount', header: 'Tracks', width: 80 },
  { key: 'duration', header: 'Duration', width: 100 }
];
```

#### 5.2 Grouped Data Support

```typescript
interface GroupedDataSection {
  title: string;
  items: Track[];
  type: "album" | "artist" | "genre" | "year";
  sortKey?: string;
}

interface GroupedGridProps {
  sections: GroupedDataSection[];
  onItemSelect: (item: Track) => void;
  groupBy: "album" | "artist" | "genre" | "year";
}
```

#### 5.3 Integration Effort Estimate

**Immediate** (Current Phase):

- Basic track list rendering
- Album grid view
- Selection and playback integration

**Next Phase**:

- Grouped data display
- Advanced sorting/filtering
- Context menu integration
- Drag-and-drop playlist management

## Phase 6: API and State Management Extraction

### 6.1 API Client Separation

**File**: `client/js/src/lib/api/musicApi.ts`

```typescript
class MusicApiClient {
  constructor(private baseUrl: string) {}

  async getSongs(): Promise<Track[]> {
    /* ... */
  }
  async getAlbums(): Promise<Album[]> {
    /* ... */
  }
  async getArtists(): Promise<Artist[]> {
    /* ... */
  }
  async getPlaylists(): Promise<Playlist[]> {
    /* ... */
  }
  async createPlaylist(name: string): Promise<Playlist> {
    /* ... */
  }
}
```

### 6.2 State Management

**File**: `client/js/src/views/freqhole/hooks/usePlayerState.ts`

```typescript
interface PlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  progress: number;
  volume: number;
  queue: Track[];
  shuffle: boolean;
  repeat: "none" | "one" | "all";
}

const [playerState, setPlayerState] = createSignal<PlayerState>(initialState);
```

### 6.3 Hook Extraction

Extract state management into composable hooks:

- `usePlayerState()`: Playback controls and state
- `useMusicLibrary()`: Library data and operations
- `usePlaylistManager()`: Playlist CRUD operations

## Phase 7: Feature Components and Complex UI

### 7.1 Complex Playlist Management

```typescript
interface PlaylistManagerProps {
  playlists: Playlist[];
  onCreatePlaylist: (name: string) => void;
  onUpdatePlaylist: (id: string, updates: Partial<Playlist>) => void;
  onDeletePlaylist: (id: string) => void;
  onAddToPlaylist: (playlistId: string, trackIds: string[]) => void;
}
```

**Features**:

- Drag-and-drop track reordering
- Batch operations (add/remove multiple tracks)
- Playlist sharing and collaboration
- Smart playlist creation with rules

### 7.2 Search Results Rendering

```typescript
interface SearchResultsProps {
  query: string;
  results: {
    tracks: Track[];
    albums: Album[];
    artists: Artist[];
    playlists: Playlist[];
  };
  onSelectTrack: (track: Track) => void;
  onSelectAlbum: (album: Album) => void;
  onSelectArtist: (artist: Artist) => void;
  onSelectPlaylist: (playlist: Playlist) => void;
}
```

### 7.3 Audio Playback Components

```typescript
interface VolumeControlProps {
  volume: number;
  onVolumeChange: (volume: number) => void;
  muted: boolean;
  onMuteToggle: () => void;
}

interface QueueViewerProps {
  queue: Track[];
  currentIndex: number;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onRemoveFromQueue: (index: number) => void;
  onJumpToTrack: (index: number) => void;
}

interface NowPlayingCardProps {
  track: Track;
  isPlaying: boolean;
  progress: number;
  onTogglePlay: () => void;
  onSeek: (position: number) => void;
  onNext: () => void;
  onPrevious: () => void;
}
```

## Phase 8: Component Decomposition Strategy

### 8.1 Icon Components

Extract SVG icons into reusable components:

- `PlayIcon`, `PauseIcon`, `NextIcon`, `PrevIcon`
- `ShuffleIcon`, `RepeatIcon`, `VolumeIcon`
- `SearchIcon`, `MenuIcon`, `CloseIcon`
- Consistent sizing and theming

### 8.2 Legacy Component Migration

Migrate existing components to new architecture:

- Update import paths
- Maintain backward compatibility
- Gradual migration strategy
