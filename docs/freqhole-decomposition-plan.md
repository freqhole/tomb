# Freqhole Audio Player - Modular Decomposition Plan

## 🎯 Current Focus: Authentication Integration

### Phase 0: Auth Integration (IMMEDIATE NEXT)

**Goal**: Adapt existing WebAuthn component to use Modal system and integrate auth flow into Freqhole

#### 0.1 Extract Auth Logic (`client/js/src/hooks/auth/index.ts`)

- Extract auth state management from webauthn-component.tsx:
  - `checkAuthStatus()`, `handleLogin()`, `handleRegister()`, `handleLogout()`
  - Auth signals: `isAuthenticated`, `currentUser`, `isLoading`
  - API client integration with existing ApiClient
- Create composable hook that returns auth state and actions

#### 0.2 Auth Modal Component (`client/js/src/views/freqhole/components/auth/AuthModal.tsx`)

- Adapt webauthn UI to use our Modal component system
- Login/Register forms with Tailwind styling (Metro UI theme)
- Loading states, error handling, form validation
- Props: `isOpen`, `onClose`, `onAuthSuccess`

#### 0.3 User Menu Component (`client/js/src/views/freqhole/components/auth/UserMenu.tsx`)

- Small square fuchsia button in header (top-right)
- Popover with user info and logout option
- Use existing Popover component with proper positioning
- Props: `currentUser`, `onLogout`

#### 0.4 Auth Hook Pattern (RECOMMENDED)

**Strategy**: Use composable hooks instead of prop drilling for cleaner architecture

Create `useAuth()` hook that can be called from any component that needs auth state:

- **Main Freqhole component**: `const { isAuthenticated, checkAuth } = useAuth()`
- **Header component**: `const { currentUser, logout } = useAuth()`
- **Any other component**: Just import and call `useAuth()`

This avoids prop drilling while keeping state management simple and testable.

#### 0.5 Integration into Freqhole (`client/js/src/views/freqhole/index.tsx`)

- Add auth check on component mount
- Show AuthModal if not authenticated
- Header component uses `useAuth()` hook directly
- Handle auth success/logout events

### Phase A: Setup In-Place Decomposition Strategy

**Goal**: Temporarily switch to zoony.tsx while we decompose it, then migrate back

#### A.1 Switch Main Entry Point (`client/js/src/views/freqhole/main.tsx`)

- Change from rendering `<Freqhole />` to `<Zoony />`
- Keep all existing dev environment working
- This gives us a working baseline to decompose from

#### A.2 Decomposition Strategy (In-Place)

**New Approach**: Extract components but render them within zoony.tsx

- Extract Header → still render extracted Header in zoony.tsx
- Extract Player → still render extracted Player in zoony.tsx
- Extract Sidebar → still render extracted Sidebar in zoony.tsx
- Keep zoony.tsx working throughout entire process
- Test each extraction thoroughly before moving to next

#### A.3 Final Migration (Last Step)

After all components extracted:

- Switch main.tsx back to render `<Freqhole />`
- Adapt extracted components for Panel-based layout
- Delete zoony.tsx completely

### Phase B: API Types & Interfaces Extraction

**Goal**: Extract all TypeScript interfaces and types from zoony.tsx into shared lib files

#### A.1 Core Data Types (`client/js/src/lib/types/music.ts`)

- Extract interfaces: `Song`, `Album`, `ArtistSummary`, `Playlist`, `PlaylistSong`, `QueueItem`
- Move API response types and data structures
- Add proper JSDoc comments for each interface

#### B.2 Component Props Types (`client/js/src/lib/types/components.ts`)

- Extract component-specific interfaces like `ZoonyProps`
- Add any UI state types that will be reused
- Create union types for view states (`"music" | "artists" | "albums" | "playlists"`)

### Phase C: Icon Components Extraction

**Goal**: Move all SVG icon components to reusable components

#### C.1 Icon Library (`client/js/src/views/freqhole/components/ui/icons/`)

- Extract all icon components: `PlayIcon`, `PauseIcon`, `CloseIcon`, `EditIcon`, `AddIcon`, `PrevIcon`, `NextIcon`, `VolumeIcon`, `MusicIcon`, `FreqholeIcon`
- Create index file for easy imports
- Standardize icon props (size, color, className)

### Phase D: Header Component Extraction (In-Place)

**Goal**: Extract the top navigation/header section (lines ~1047-1100) but keep it working in zoony.tsx

#### D.1 Header Component (`client/js/src/views/freqhole/components/layout/Header.tsx`)

- Extract the entire `zune-header` div and its contents
- Include logo/branding section
- Include navigation buttons (music, artists, albums, playlists)
- Include search box integration
- Include UserMenu component from Phase 0
- UserMenu uses `useAuth()` hook internally
- Props: `currentView`, `onViewChange`, `searchQuery`, `onSearchQueryChange`, `onSearch`, `onClearSearch`

#### D.2 Navigation Component (`client/js/src/views/freqhole/components/ui/Navigation.tsx`)

- Extract just the nav section with view buttons
- Props: `currentView`, `onViewChange`

#### D.3 Logo/Branding Component (`client/js/src/views/freqhole/components/ui/Logo.tsx`)

- Extract logo and FreqholeIcon
- Make responsive (hidden-sm classes)

#### D.4 Update Zoony.tsx

- Import extracted Header component
- Replace existing header JSX with `<Header {...headerProps} />`
- Verify everything still works before proceeding

### Phase E: Player Component Extraction (In-Place)

**Goal**: Extract the bottom player controls (lines ~1663-1750) but keep it working in zoony.tsx

#### E.1 Player Component (`client/js/src/views/freqhole/components/player/Player.tsx`)

- Extract entire `zune-player` section
- Include artwork, song info, controls, progress, volume
- Props: `currentSong`, `isPlaying`, `currentTime`, `duration`, `volume`, `onTogglePlayback`, `onSeekTo`, `onVolumeChange`, `onPrevious`, `onNext`, `onToggleQueue`

#### E.2 Player Controls (`client/js/src/views/freqhole/components/player/PlayerControls.tsx`)

- Extract just the control buttons section
- Props: `isPlaying`, `onTogglePlayback`, `onPrevious`, `onNext`, `onToggleQueue`, `canGoNext`, `canGoPrevious`

#### E.3 Progress Bar (`client/js/src/views/freqhole/components/player/ProgressBar.tsx`)

- Extract progress bar with time display
- Props: `currentTime`, `duration`, `onSeekTo`

#### E.4 Update Zoony.tsx

- Import extracted Player component
- Replace existing player JSX with `<Player {...playerProps} />`
- Verify everything still works

### Phase F: Sidebar Component Extraction (In-Place)

**Goal**: Extract left sidebar (lines ~1150-1200) but keep it working in zoony.tsx

#### F.1 Sidebar Component (`client/js/src/views/freqhole/components/layout/Sidebar.tsx`)

- Extract `zune-sidebar` section
- Handle playlist filtering and actions
- Props: `currentView`, `playlists`, `currentPlaylist`, `onPlaylistSelect`, `onEditPlaylist`, `onDeletePlaylist`

#### F.2 Update Zoony.tsx

- Import extracted Sidebar component
- Replace existing sidebar JSX with `<Sidebar {...sidebarProps} />`
- Verify everything still works

### Phase G: Main Content Area Extraction (In-Place)

**Goal**: Extract center content section (lines ~1200-1600) but keep it working in zoony.tsx

#### G.1 ContentHeader Component (`client/js/src/views/freqhole/components/layout/ContentHeader.tsx`)

- Extract `zune-content-header` with stats and action buttons
- Props: `currentView`, `isSearchActive`, `searchResults`, `currentSongs`, `playlists`, `albums`, `artists`, `currentPlaylist`, `currentArtist`, `currentAlbum`, `onPlayAll`, `onCreatePlaylist`

#### G.2 ContentArea Component (`client/js/src/views/freqhole/components/layout/ContentArea.tsx`)

- Extract main content rendering logic
- Handle loading states, error states
- Include all table/grid rendering
- Props: All necessary data and handlers

#### G.3 Update Zoony.tsx

- Import extracted ContentHeader and ContentArea components
- Replace existing content JSX with extracted components
- Verify everything still works

### Phase H: State Management Extraction

**Goal**: Extract all state logic and API calls (zoony.tsx still works)

#### H.1 Music State Hook (`client/js/src/views/freqhole/hooks/useMusicState.ts`)

- Extract all `createSignal` calls for data: songs, playlists, albums, artists
- Extract all fetch functions: `fetchSongs`, `fetchPlaylists`, etc.
- Return state and actions

#### H.2 Player State Hook (`client/js/src/views/freqhole/hooks/usePlayerState.ts`)

- Extract player-related signals: `currentSong`, `isPlaying`, `currentTime`, `duration`, `volume`, `audioElement`, `playQueue`
- Extract player functions: `playSong`, `togglePlayback`, `seekTo`, etc.
- Handle audio element lifecycle

#### H.3 View State Hook (`client/js/src/views/freqhole/hooks/useViewState.ts`)

- Extract UI state: `currentView`, `loading`, `error`, `searchQuery`, `isSearchActive`
- Extract view management functions

#### H.4 Update Zoony.tsx

- Replace all inline state with hook calls
- Verify everything still works with extracted state management

### Phase I: API Client Integration

**Goal**: Move API calls to centralized client

#### I.1 Music API Client (`client/js/src/lib/api/musicApi.ts`)

- Extract all API endpoint calls from zoony.tsx
- Create typed methods for each endpoint
- Handle error states consistently

### Phase J: Styles Extraction

**Goal**: Move all CSS to external files or Tailwind classes

#### J.1 Component Styles (`client/js/src/views/freqhole/styles/`)

- Extract the massive `<style>` tag (lines ~1800-3100)
- Split into component-specific CSS files
- Convert to Tailwind classes where possible

### Phase K: Final Migration to Freqhole

**Goal**: Migrate all extracted components to Panel-based Freqhole layout

#### K.1 Switch Back to Freqhole (`client/js/src/views/freqhole/main.tsx`)

- Change from rendering `<Zoony />` back to `<Freqhole />`
- Now we have working components to integrate

#### K.2 Adapt Components for Panel Layout (`client/js/src/views/freqhole/index.tsx`)

- Import all extracted components from zoony decomposition
- Adapt Header component for Panel system layout
- Adapt extracted components to work with Panel-based responsive design
- Use extracted hooks for state management
- Integrate auth components and flow

#### K.3 Delete zoony.tsx

- Remove the original file once Panel-based version is working
- Update any remaining imports
- Celebrate! 🎉

## Execution Strategy

1. **Start with Phase 0 (Auth)** - Add auth before decomposition
2. **Then Phase A (Setup)** - Switch to zoony.tsx temporarily
3. **Phases B-C** - Extract types and icons
4. **Phases D-G** - Extract major UI components (Header, Player, Sidebar, Content)
5. **Phases H-J** - Extract state management, API calls, styles
6. **Phase K** - Migrate everything to Panel-based Freqhole layout

**Key Principles**:

- **Always keep zoony.tsx working** throughout phases A-J
- **Extract and import** - don't replace until final migration
- **Test each extraction** thoroughly before moving to next phase
- **Auth integration first** - foundational requirement
- **Panel migration last** - big integration step at the end

Each phase should:

- Maintain existing functionality in zoony.tsx
- Test extracted components work in isolation
- Update zoony.tsx to use extracted components
- Keep Panel-based Freqhole development separate until Phase K

---

## ✅ Completed Components

### 🎨 **Panel System**

- **File**: `client/js/src/views/freqhole/components/layout/Panel.tsx`
- **Features**: Loading states, empty states, Metro animations, 12-column responsive layout
- **Status**: Complete and ready for music content

### 🖱️ **Context Menu System**

- **File**: `client/js/src/views/freqhole/components/ui/ContextMenu.tsx`
- **Features**: Viewport-aware positioning, click-outside handling, keyboard navigation
- **Status**: Complete with proper event management

### 📱 **Modal & Popover System**

- **Files**: `client/js/src/views/freqhole/components/ui/Modal.tsx`, `Popover.tsx`
- **Features**: Global overlay management, no event conflicts, proper z-indexing
- **Status**: Complete with backdrop management

### 🎯 **Metro UI Foundation**

- **Features**: Flat black backgrounds, fuchsia hover effects, no borders, consistent spacing
- **Status**: Established design system ready for content components

## Project Goals

**Create a modular, maintainable audio player** that separates concerns, enables testing, and provides a solid foundation for future features while maintaining the distinctive Zune Metro UI aesthetic.

## Current State Analysis

### Existing Assets

- **3100-line zoony.tsx** - Contains complete audio player with all features
- **Vite dev environment** - Hot reloading, Tailwind CSS v4, TypeScript
- **Panel-based layout system** - 12-column responsive grid ready for content
- **UI component library** - Modal, Context Menu, Popover systems

### Infinite Data Grid Reusability Assessment

The infinite data grid component from the main app can be adapted for music content:

```typescript
type ListItem = {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
  // ... other music-specific fields
};

const columns = [
  { key: "title", label: "Title", width: "300px" },
  { key: "artist", label: "Artist", width: "200px" },
  { key: "album", label: "Album", width: "200px" },
  { key: "duration", label: "Duration", width: "80px", render: formatDuration },
  // ... additional columns
];
```

**Music-specific adaptations needed:**

```typescript
type GridItem = Song | Album | Artist | Playlist;

const renderGridItem = (item: GridItem, type: 'songs' | 'albums' | 'artists' | 'playlists') => {
  switch (type) {
    case 'songs': return <SongRow song={item as Song} />;
    case 'albums': return <AlbumCard album={item as Album} />;
    // ... other types
  }
};

const columns = {
  songs: [
    { key: "title", label: "Title", sortable: true },
    { key: "artist", label: "Artist", sortable: true },
    { key: "album", label: "Album", sortable: true },
    { key: "duration", label: "Duration", render: formatTime },
    { key: "actions", label: "", render: (song) => <SongActions song={song} /> }
  ],
  albums: [
    { key: "album", label: "Album", sortable: true },
    { key: "artist", label: "Artist", sortable: true },
    { key: "year", label: "Year", sortable: true },
    { key: "track_count", label: "Tracks", render: (count) => `${count} tracks` }
  ],
  // ... other view types
};
```

### Grouped Data Support

```typescript
interface GroupedDataSection {
  label: string;
  items: GridItem[];
  metadata?: { total: number; duration?: number };
}

interface GroupedGridProps {
  sections: GroupedDataSection[];
  renderItem: (item: GridItem) => JSX.Element;
  onItemSelect?: (item: GridItem) => void;
}
```

### Integration Effort Estimate

- **Adaptation time**: 2-3 days
- **Testing**: 1 day
- **Integration with Panel system**: 1 day
- **Total**: ~1 week for full infinite grid integration

## Previous Planning Phases

### Phase 1: Vite Development Setup ✅

#### 1.1 Create Traditional Vite Config ✅

```javascript
// vite.config.js for freqhole
import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: "./client/js",
  build: {
    outDir: "../../dist/freqhole",
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "client/js/src/views/freqhole/index.tsx"),
      name: "FreqholePlayer",
      fileName: "freqhole",
      formats: ["es", "iife"],
    },
  },
  server: {
    port: 3001,
    host: true,
  },
});
```

#### 1.2 Entry Point Setup ✅

```typescript
// client/js/src/views/freqhole/index.tsx
export { default as FreqholePlayer } from "./components/FreqholePlayer";
```

#### 1.3 Package.json Scripts ✅

```json
{
  "scripts": {
    "dev:freqhole": "vite --config vite.freqhole.config.js",
    "build:freqhole": "vite build --config vite.freqhole.config.js",
    "preview:freqhole": "vite preview --config vite.freqhole.config.js"
  }
}
```

### Phase 2: Tailwind CSS Integration ✅

#### 2.1 Install Tailwind Dependencies ✅

```bash
npm install -D tailwindcss@next @tailwindcss/vite@next
```

#### 2.2 Tailwind Configuration ✅

```javascript
// tailwind.config.js
export default {
  content: ["./client/js/src/views/freqhole/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        "zune-purple": "#6B46C1",
        "zune-pink": "#EC4899",
        "zune-blue": "#3B82F6",
        "zune-green": "#10B981",
        "zune-orange": "#F59E0B",
      },
      animation: {
        "slide-in": "slideIn 0.3s ease-out",
        "fade-in": "fadeIn 0.2s ease-out",
      },
    },
  },
  plugins: [],
};
```

#### 2.3 CSS Entry Point ✅

```css
/* client/js/src/views/freqhole/styles/main.css */
@import "tailwindcss";

/* Zune Metro UI Base Styles */
body {
  background: #000;
  color: #fff;
  font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
}
```

### Phase 3: Core Layout Structure ✅

#### 3.1 Layout Components Architecture ✅

```
client/js/src/views/freqhole/
├── components/
│   ├── layout/
│   │   ├── FreqholePlayer.tsx     # Main container
│   │   ├── Panel.tsx              # Reusable panel component
│   │   ├── Header.tsx             # Top navigation
│   │   ├── Sidebar.tsx            # Left navigation
│   │   └── PlayerFooter.tsx       # Bottom player controls
│   ├── ui/
│   │   ├── Button.tsx
│   │   ├── Modal.tsx
│   │   └── ContextMenu.tsx
│   └── music/
│       ├── SongList.tsx
│       ├── AlbumGrid.tsx
│       └── PlaylistManager.tsx
└── hooks/
    ├── useAudioPlayer.tsx
    └── useMusicLibrary.tsx
```

#### 3.2 Responsive Grid System ✅

```typescript
const layouts = {
  desktop: { left: 3, center: 3, right: 6 }, // 3+3+6
  tablet: { left: 3, center: 9 }, // 3+9
  mobile: { main: 12 }, // 12
};

const columnSpans = {
  desktop: {
    sidebar: "col-span-3",
    main: "col-span-3",
    detail: "col-span-6",
  },
  tablet: {
    sidebar: "col-span-3",
    main: "col-span-9",
  },
  mobile: {
    main: "col-span-12",
  },
};
```

#### 3.3 Player Footer Integration ✅

Fixed player footer that works with the 12-column layout and doesn't interfere with scrolling content.

### Phase 5: Music-Specific Data Grid

#### 5.1 Infinite Grid Adaptations

Adapt the existing infinite-data-grid for music content:

```typescript
type ListItem = Song | Album | Artist | Playlist;

const columns = [
  {
    key: "title",
    label: "Title",
    width: "300px",
    render: (item: Song) => (
      <div class="song-title-cell">
        <span class="title">{item.title}</span>
        <span class="artist">{item.artist}</span>
      </div>
    )
  },
  { key: "album", label: "Album", width: "200px" },
  { key: "duration", label: "Duration", width: "80px", render: formatDuration },
  {
    key: "actions",
    label: "",
    width: "100px",
    render: (item: Song) => <SongActionMenu song={item} />
  }
];
```

**Grid variations for different content types:**

```typescript
type GridItem = Song | Album | Artist | Playlist;

const renderGridItem = (item: GridItem, type: ViewType) => {
  switch (type) {
    case 'songs':
      return <SongRow song={item as Song} onPlay={playSong} />;
    case 'albums':
      return <AlbumCard album={item as Album} onClick={viewAlbum} />;
    case 'artists':
      return <ArtistCard artist={item as Artist} onClick={viewArtist} />;
    case 'playlists':
      return <PlaylistCard playlist={item as Playlist} onClick={viewPlaylist} />;
  }
};

const columns = {
  songs: [
    { key: "title", label: "Title", sortable: true },
    { key: "artist", label: "Artist", sortable: true },
    { key: "album", label: "Album", sortable: true },
    { key: "duration", label: "Duration", render: formatTime },
    { key: "actions", label: "", render: (song) => <SongActions song={song} /> }
  ],
  albums: [
    { key: "album", label: "Album", sortable: true },
    { key: "artist", label: "Artist", sortable: true },
    { key: "year", label: "Year", sortable: true },
    { key: "track_count", label: "Tracks" }
  ]
  // ... other configurations
};
```

#### 5.2 Grouped Data Support

```typescript
interface GroupedDataSection {
  label: string;
  items: Song[];
  metadata?: {
    total: number;
    duration?: number;
  };
}

interface GroupedGridProps {
  sections: GroupedDataSection[];
  renderItem: (item: Song) => JSX.Element;
  onItemSelect?: (item: Song) => void;
}
```

#### 5.3 Integration Effort Estimate

- **Component adaptation**: 2-3 days
- **Music-specific rendering**: 1-2 days
- **Testing and refinement**: 1 day
- **Integration with Panel system**: 1 day

**Total estimated effort**: 5-7 days

## Phase 6: API and State Management Extraction

### 6.1 API Client Separation

Extract API calls from the monolithic component into a dedicated music API client:

```typescript
// client/js/src/lib/api/musicApi.ts
export class MusicApiClient {
  constructor(private baseUrl: string) {}

  async getSongs(options?: SearchOptions): Promise<Song[]> {}
  async getAlbums(): Promise<Album[]> {}
  async getArtists(): Promise<ArtistSummary[]> {}
  async getPlaylists(): Promise<Playlist[]> {}
  async createPlaylist(playlist: CreatePlaylistRequest): Promise<Playlist> {}
  // ... other endpoints
}
```

### 6.2 State Management

Extract state management into composable hooks:

```typescript
interface PlayerState {
  currentSong: Song | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  queue: Song[];
  currentIndex: number;
}

const [playerState, setPlayerState] = createStore<PlayerState>(initialState);
```

### 6.3 Hook Extraction

Create focused hooks for different concerns:

- `useAudioPlayer()` - Audio element control
- `useMusicLibrary()` - Library data management
- `usePlaylistManager()` - Playlist CRUD operations

## Phase 7: Feature Components and Complex UI

### 7.1 Complex Playlist Management

```typescript
interface PlaylistManagerProps {
  playlists: Playlist[];
  onCreatePlaylist: (playlist: CreatePlaylistRequest) => void;
  onEditPlaylist: (id: string, updates: Partial<Playlist>) => void;
  onDeletePlaylist: (id: string) => void;
}
```

**Features to extract:**

- Playlist creation modal with form validation
- Drag-and-drop song reordering
- Playlist sharing and collaboration controls

### 7.2 Search Results Rendering

Advanced search with multiple result types:

```typescript
interface SearchResultsProps {
  query: string;
  results: {
    songs: Song[];
    albums: Album[];
    artists: ArtistSummary[];
    playlists: Playlist[];
  };
  onResultSelect: (item: Song | Album | Artist | Playlist) => void;
}
```

### 7.3 Audio Playback Components

```typescript
interface VolumeControlProps {
  volume: number;
  onVolumeChange: (volume: number) => void;
  muted?: boolean;
  onMuteToggle?: () => void;
}

interface QueueViewerProps {
  queue: Song[];
  currentIndex: number;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onRemove: (index: number) => void;
  onJumpTo: (index: number) => void;
}

interface NowPlayingCardProps {
  song: Song;
  isPlaying: boolean;
  progress: number;
  onSeek: (position: number) => void;
  onTogglePlayback: () => void;
  onNext: () => void;
  onPrevious: () => void;
}
```

## Phase 8: Component Decomposition Strategy

### 8.1 Icon Components

Extract and standardize all SVG icons used throughout the player:

- PlayIcon, PauseIcon, SkipIcon, ShuffleIcon, RepeatIcon
- VolumeIcon, MuteIcon, QueueIcon
- Standardize sizing, coloring, and interaction states

### 8.2 Legacy Component Migration

Identify reusable patterns from the existing codebase and create modern equivalents using our new component architecture.

## Risks and Mitigation

### Technical Risks

1. **State synchronization complexity** - Mitigate with clear data flow patterns
2. **Audio element lifecycle management** - Create dedicated hook for audio handling
3. **Performance with large music libraries** - Implement virtualization and pagination
4. **Cross-browser audio compatibility** - Test extensively, provide fallbacks

### Project Risks

1. **Scope creep during extraction** - Stick to planned phases, document future enhancements separately
2. **Breaking existing functionality** - Maintain parallel development, comprehensive testing
3. **Timeline pressure** - Prioritize core functionality over nice-to-have features

## Success Metrics

- **Maintainability**: Component count <50, average component size <200 lines
- **Performance**: Initial load <2s, smooth scrolling with 10k+ songs
- **Test Coverage**: >80% for core components
- **Bundle Size**: <500KB total JavaScript

---

_This incremental approach ensures we never break existing functionality while systematically decomposing the 3100-line monolith into maintainable, reusable components that fit our Panel-based architecture._
