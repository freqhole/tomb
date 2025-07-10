# Freqhole Audio Player - Modular Decomposition Plan

## 🎯 Current Focus: A.2 Decomposition Strategy

### Phase A.2: Decomposition Strategy (In-Place) - NEXT

**Goal**: Extract Header and Player components while keeping zoony.tsx working

#### A.2.1 Header Component Extraction (`client/js/src/views/freqhole/components/header/Header.tsx`)

**Strategy**: Extract header JSX and logic from zoony.tsx into separate component

- Extract header section (logo, navigation, search, user menu)
- Keep all existing functionality intact
- Props: `currentTrack`, `onSearch`, `onViewChange`, `currentView`
- Use existing auth integration from Phase 0
- Test thoroughly before moving to player

**File structure**:

```
client/js/src/views/freqhole/components/header/
├── Header.tsx          # Main header component
├── Navigation.tsx      # Navigation buttons (optional sub-component)
├── SearchBar.tsx       # Search input (optional sub-component)
└── index.ts           # Barrel export
```

#### A.2.2 Player Component Extraction (`client/js/src/views/freqhole/components/player/Player.tsx`)

**Strategy**: Extract player JSX and logic from zoony.tsx into separate component

- Extract player section (controls, progress, queue, now playing)
- Keep all existing functionality intact
- Props: `currentTrack`, `isPlaying`, `progress`, `queue`, `onPlayPause`, `onNext`, `onPrevious`, `onSeek`
- Handle all player state management
- Test thoroughly after extraction

**File structure**:

```
client/js/src/views/freqhole/components/player/
├── Player.tsx          # Main player component
├── PlayerControls.tsx  # Play/pause/next/prev buttons
├── ProgressBar.tsx     # Progress bar and time display
├── QueueViewer.tsx     # Queue display and management
├── NowPlayingCard.tsx  # Current track display
└── index.ts           # Barrel export
```

#### A.2.3 Integration Testing

After each extraction:

1. Verify zoony.tsx still works exactly the same
2. Test all functionality in extracted components
3. Ensure no regressions in existing features
4. Update imports in zoony.tsx to use new components

### Phase A.3: Final Migration (Last Step)

After all components extracted:

- Switch main.tsx back to render `<Freqhole />`
- Adapt extracted components for Panel-based layout
- Delete zoony.tsx completely

### Phase B: API Types & Interfaces Extraction

**Goal**: Extract all TypeScript interfaces and types from zoony.tsx into shared lib files

#### B.1 Core Data Types (`client/js/src/lib/types/music.ts`)

- Extract: `Track`, `Album`, `Artist`, `Playlist`, `Queue` interfaces
- Music-related enums and utility types

#### B.2 Component Props Types (`client/js/src/lib/types/components.ts`)

- Extract: Component prop interfaces
- UI state types, event handler types

### Phase C: Icon Components Extraction

**Goal**: Create reusable icon components for consistent styling

#### C.1 Icon Library (`client/js/src/views/freqhole/components/ui/icons/`)

- Extract SVG icons into individual components
- Consistent sizing, theming, and hover states

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

**Goal**: Integrate with existing API infrastructure

#### E.1 Music API Client (`client/js/src/lib/api/musicApi.ts`)

- Integrate with existing ApiClient pattern
- Music-specific endpoints and data fetching

### Phase F: Styles Extraction

**Goal**: Organize component styles for maintainability

#### F.1 Component Styles (`client/js/src/views/freqhole/styles/`)

- Extract component-specific styles
- Maintain existing Metro UI theme

## Execution Strategy

### Priority Order

1. **Phase A.2**: Header and Player extraction (IMMEDIATE NEXT)
2. **Phase A.3**: Final migration to Freqhole layout
3. **Phase B**: Types extraction
4. **Phase C**: Icon components
5. **Phase D**: State management hooks
6. **Phase E**: API integration
7. **Phase F**: Styles organization

### Key Principles

- **Never break existing functionality**
- **Test thoroughly after each extraction**
- **Keep zoony.tsx working throughout**
- **Maintain all existing features**
- **Gradual, incremental changes**

### Testing Strategy

- Manual testing after each component extraction
- Verify all player functionality works
- Test responsive behavior
- Ensure no visual regressions

## ✅ Completed Phases

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

### Grouped Data Support

```typescript
interface GroupedDataSection {
  title: string;
  items: GridItem[];
  type: "track" | "album" | "artist" | "playlist";
}

interface GroupedGridProps {
  sections: GroupedDataSection[];
  onItemSelect: (item: GridItem) => void;
}
```

### Integration Effort Estimate

**Low Effort** (1-2 days):

- Column configuration adaptation
- Basic item rendering
- Selection handling

**Medium Effort** (3-5 days):

- Custom item renderers for each type
- Context menu integration
- Drag-and-drop support

**High Effort** (1-2 weeks):

- Grouped data display
- Advanced filtering/sorting
- Performance optimization for large libraries

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

## Success Metrics

- **Functional Parity**: All existing features work identically
- **Code Organization**: Clear separation of concerns and modular architecture
- **Performance**: No regression in load times or runtime performance
- **Developer Experience**: Easier to understand, modify, and extend
- **Test Coverage**: Comprehensive testing of all components
