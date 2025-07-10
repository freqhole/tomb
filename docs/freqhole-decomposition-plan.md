# Freqhole Audio Player - Modular Decomposition Plan

## 🎯 Current Focus: UI Refinements & Polish

### Phase D: State Management Extraction ✅ (COMPLETE)

**Goal**: Extract all state management logic into custom hooks for better organization and reusability

#### D.1 Music State Hook (`client/js/src/views/freqhole/hooks/useMusicState.ts`) ✅

- ✅ Extract: Track management, playlist operations, library state
- ✅ Return: `{ state: { songs, playlists, albums, artists, loading, error, ... }, actions: { fetchData, createPlaylist, viewPlaylist, ... } }`
- ✅ Features: Current view management, data collections, CRUD operations, search functionality

#### D.2 Player State Hook (`client/js/src/views/freqhole/hooks/usePlayerState.ts`) ✅

- ✅ Extract: High-level playback operations that combine music data with player queue
- ✅ Return: All `usePlayerQueue` functionality plus `playPlaylist()`, `playArtist()`, `playAlbum()`
- ✅ Features: Data transformation, error handling, seamless integration with existing player

#### D.3 View State Hook (`client/js/src/views/freqhole/hooks/useViewState.ts`) ✅

- ✅ Extract: UI state, modal states, view switching
- ✅ Return: `{ state: { showPlaylistModal, selectedSongs, viewTransition, ... }, actions: { openCreatePlaylistModal, togglePlaylistDropdown, ... } }`
- ✅ Features: Modal management, song selection, form state, animation states

#### D.4 Combined State Hook (`client/js/src/views/freqhole/hooks/useFreqholeState.ts`) ✅

- ✅ Integrates all three state hooks into comprehensive interface
- ✅ Provides cross-domain actions: `playAndQueue()`, `playPlaylistAndView()`, `addToPlaylistWithModal()`
- ✅ Unified error handling and initialization

#### D.5 Updated Context & Sample Component ✅

- ✅ Enhanced FreqholeProvider with comprehensive state system
- ✅ Backwards compatible `useMusicPlayer()` + new `useFreqhole()` hooks
- ✅ Sample MusicView component demonstrating usage patterns
- ✅ Type system simplification (no conversion overhead)

### Phase E: API Client Integration ✅ (COMPLETE)

**Goal**: Complete integration of music API methods with existing ApiClient

#### E.1 Music API Integration (`client/js/src/lib/api-client.ts`) ✅

- ✅ Integrate music methods into existing ApiClient class
- ✅ Update all components to use extended ApiClient methods
- ✅ Replace direct fetch() calls in zoony.tsx with API client methods
- ✅ Ensure backward compatibility during transition

#### E.2 Error Handling & Logging ✅

- ✅ Enhanced error handling with MusicApiError class and retry logic
- ✅ Comprehensive logging system with configurable levels
- ✅ Graceful degradation for collection endpoints
- ✅ User-friendly error messages and automatic retry for server errors
- ✅ Created comprehensive FreqholeView component demonstrating integration

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

1. **Phase D**: State Management Extraction (IMMEDIATE NEXT)
   - D.1: Extract state management hooks from zoony.tsx
   - D.2: Create reusable player, music, and view state hooks
   - D.3: Update components to use new hook patterns
   - D.4: Test and validate all functionality
2. **Phase E**: API integration and cleanup
3. **Phase F**: Styles organization
4. **Phase G**: IndexedDB persistence
5. **Phase H**: Advanced state management hooks

### Key Principles

- **Never break existing functionality**
- **Test thoroughly after each extraction**
- **Keep zoony.tsx working throughout**
- **Maintain all existing features**
- **Gradual, incremental changes**
- **Modular state management**
- **Reusable hook patterns**
- **Clean component separation**
- **Maintain all existing functionality**

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
- **Hook Reusability**: State logic can be shared across components

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

---

## ✅ Completed Phases

### Phase G: Integration & Implementation (COMPLETE) ✅

**Goal**: Integrate state management system into existing freqhole structure

**Completed Components:**

- ✅ Full integration into `client/js/src/views/freqhole/index.tsx`
- ✅ Removed redundant components (FreqholeView, FreqholeNavigation)
- ✅ Uses existing Header component with state management integration
- ✅ Comprehensive music browsing interface (songs, artists, albums, playlists)
- ✅ Search functionality with live results
- ✅ Playlist management with modal interface
- ✅ Player integration with queue management
- ✅ Error handling with user-friendly messages
- ✅ Fixed circular import issues with error handling system

**Key Features:**

- Music library browsing with play/queue/playlist actions
- Artist and album browsing with batch playback
- Playlist creation, editing, and management
- Live search across all music content
- Seamless integration with existing player components
- Responsive design with Metro UI styling
- Comprehensive error handling and recovery

**Technical Achievements:**

- Zero breaking changes to existing components
- Maintained existing Header and Player components
- Clean integration without component duplication
- Fixed CSS utility class issues (font-metro, bg-opacity)
- Resolved circular import dependencies
- Optimized bundle size by removing redundant code

**Files Enhanced:**

- `client/js/src/views/freqhole/index.tsx` - Complete integration
- `client/js/src/views/freqhole/styles.css` - Fixed utility classes
- `client/js/src/lib/music/error-handling.ts` - Fixed circular imports

### Phase F: Styles Extraction (COMPLETE) ✅

**Goal**: Organize component styles for maintainability

**Completed Components:**

- ✅ `components.css` - Comprehensive component styles (buttons, inputs, items, navigation)
- ✅ `layout.css` - Complete layout system (grid, flex, panels, responsive)
- ✅ `index.css` - Main styles entry point with CSS custom properties
- ✅ `utils.ts` - TypeScript utilities for dynamic styling
- ✅ Integration with existing Metro UI theme

**Key Features:**

- Modular CSS architecture with organized component styles
- Comprehensive utility classes for common UI patterns
- Responsive design patterns and mobile-first approach
- TypeScript utilities for conditional and dynamic styling
- Accessibility features and focus management
- Performance optimizations and smooth animations

**Files Created:**

- `client/js/src/views/freqhole/styles/components.css`
- `client/js/src/views/freqhole/styles/layout.css`
- `client/js/src/views/freqhole/styles/index.css`
- `client/js/src/views/freqhole/styles/utils.ts`

**Files Enhanced:**

- `client/js/src/views/freqhole/styles.css`

### Phase E: API Client Integration (COMPLETE) ✅

**Goal**: Complete integration of music API methods with existing ApiClient

**Completed Components:**

- ✅ Enhanced music API methods with comprehensive error handling
- ✅ MusicApiError class with retry logic and user-friendly messages
- ✅ Configurable logging system with different log levels
- ✅ Graceful degradation for collection endpoints
- ✅ FreqholeView component demonstrating full integration
- ✅ FreqholeNavigation component with search and view switching

**Key Features:**

- Automatic retry with exponential backoff for server errors
- Graceful collection parsing that handles invalid items
- User-friendly error messages with appropriate retry behavior
- Comprehensive logging for debugging and monitoring
- Seamless integration with existing state management hooks

**Files Created:**

- `client/js/src/lib/music/error-handling.ts`
- `client/js/src/views/freqhole/FreqholeView.tsx`
- `client/js/src/views/freqhole/components/FreqholeNavigation.tsx`

**Files Enhanced:**

- `client/js/src/lib/music/api-methods.ts`
- `client/js/src/lib/music/index.ts`

### Phase D: State Management Extraction (COMPLETE) ✅

**Goal**: Extract all state management logic into custom hooks for better organization and reusability

**Completed Components:**

- ✅ `useMusicState.ts` - Track management, playlist operations, library state
- ✅ `usePlayerState.ts` - High-level playback operations combining music data with player queue
- ✅ `useViewState.ts` - UI state, modal states, view switching
- ✅ `useFreqholeState.ts` - Combined state hook integrating all three domains
- ✅ Enhanced FreqholeProvider with comprehensive state system
- ✅ Sample MusicView component demonstrating usage patterns
- ✅ Type system simplification avoiding conversion overhead

**Key Benefits Achieved:**

- Better organization with proper state separation by domain
- Reusability - hooks can be used independently or combined
- Maintainability with clear separation of concerns
- Type safety with consistent type system
- Centralized error handling and efficient state updates

**Files Created:**

- `client/js/src/views/freqhole/hooks/useMusicState.ts`
- `client/js/src/views/freqhole/hooks/usePlayerState.ts`
- `client/js/src/views/freqhole/hooks/useViewState.ts`
- `client/js/src/views/freqhole/hooks/useFreqholeState.ts`
- `client/js/src/views/freqhole/components/MusicView.tsx`

**Files Updated:**

- `client/js/src/views/freqhole/hooks/index.ts`
- `client/js/src/views/freqhole/context/FreqholeContext.tsx`
- `client/js/src/views/freqhole/context/index.ts`

### Phase C: Icon Components Extraction (COMPLETE) ✅

**Goal**: Create reusable icon components for consistent styling

**Completed Tasks**:

1. ✅ **Enhanced Icon Architecture** - BaseIcon wrapper with customizable props
2. ✅ **Modular Organization** - Separate files for player, navigation, and utility icons
3. ✅ **50+ High-Quality Icons** - Comprehensive icon library with consistent design
4. ✅ **Dynamic Icon System** - Registry-based usage with `<Icon name="play" />`
5. ✅ **Interactive Components** - `IconButton` with variants and hover states
6. ✅ **Accessibility Support** - Built-in ARIA labels and semantic markup
7. ✅ **TypeScript Integration** - Full type safety with `IconProps` interface
8. ✅ **Backward Compatibility** - Legacy import paths still work
9. ✅ **Theming Support** - Consistent sizing, colors, and transitions
10. ✅ **Fixed Circular Imports** - Resolved "Cannot access before initialization" error

**File Structure**:

```
components/ui/icons/
├── index.tsx        # Main exports + type definitions
├── player.tsx       # Player control icons (Play, Pause, Volume, etc.)
├── navigation.tsx   # Navigation icons (Music, Albums, Search, etc.)
└── registry.tsx     # Dynamic registry + utility icons
```

**Key Features**:

- **Customizable Props**: `size`, `color`, `className`, `aria-label`
- **Preset Sizes**: `IconSizes.xs` (12px) through `IconSizes["2xl"]` (32px)
- **Interactive Buttons**: `<IconButton name="favorite" onClick={handleClick} />`
- **Dynamic Usage**: `<Icon name="shuffle" size={20} color="#FF00FF" />`
- **Performance**: Tree-shaking friendly with individual exports

### Phase B: API Types & Zod Schema Extraction (COMPLETE) ✅

**Goal**: Extract all fetch() calls from zoony.tsx and integrate with existing ApiClient patterns using Zod schemas

**Completed Tasks**:

1. ✅ **Zod Schemas Created** - Song, Album, Artist, Playlist schemas with z.infer types
2. ✅ **API Client Extended** - Added 11 music methods to existing ApiClient
3. ✅ **Fetch Calls Extracted** - Replaced all 17 fetch() calls in zoony.tsx
4. ✅ **Graceful Validation** - Collections omit invalid items instead of failing
5. ✅ **Runtime Type Safety** - Zod validation with compile-time TypeScript types
6. ✅ **Server Alignment** - Schemas match actual server response structures
7. ✅ **Logging Infrastructure** - Verbose logging for parse failures
8. ✅ **Error Handling** - Consistent with existing ApiClient patterns

**API Methods Available**:

- `apiClient.getSongs()`, `apiClient.getArtists()`, `apiClient.getAlbums()`
- `apiClient.getPlaylists()`, `apiClient.createPlaylist()`, `apiClient.updatePlaylist()`
- `apiClient.getPlaylistSongs()`, `apiClient.addSongsToPlaylist()`, etc.

**File Structure**:

```
client/js/src/lib/music/
├── schemas/          # Zod schemas + z.infer types
├── validation.ts     # Graceful parsing utilities
├── api-methods.ts    # Music API methods
└── types.ts          # Re-exported types
```

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
