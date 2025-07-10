# Freqhole Audio Player - Modular Decomposition Plan

## Overview

This document outlines the plan to decompose the monolithic Zune-inspired audio player (`zune-demo.tsx`, ~3100 lines) into a modular, maintainable Freqhole application with proper separation of concerns, Tailwind CSS styling, and reusable components.

## Project Goals

- **Modularity**: Break down the large single file into focused, reusable components
- **Modern Styling**: Replace inline styles and CSS files with Tailwind CSS classes
- **Infinite Scrolling**: Integrate existing `infinite-data-grid` component for performance
- **Layout System**: Create flexible 3-4 column layout with independent scrolling
- **Hot Reloading**: Set up traditional Vite dev environment alongside existing web component system
- **Dark Theme**: Implement black/white/magenta (fuchsia) color scheme
- **UI Design**: Use SVG icons (no emoji in UI), but emoji acceptable in documentation for progress tracking

## Current State Analysis

### Existing Assets

- **Zune Demo**: `client/js/src/web-components/zune-demo.tsx` (~3100 lines)
- **Infinite Grid**: `client/js/src/components/infinite-data-grid/` (sophisticated, reusable)
- **Web Component Build**: `vite.wc.config.ts` (keep for existing components)
- **Started Structure**: `client/js/src/views/freqhole/` with basic index.tsx

### Infinite Data Grid Reusability Assessment

**Effort Level: LOW-MEDIUM** ⭐⭐⭐

The existing `infinite-data-grid` component is well-architected and highly reusable:

**Strengths:**

- Generic TypeScript implementation with `<T>`
- Comprehensive props interface (`GridProps<T>`)
- Built-in features: sorting, selection, drag selection, virtualization
- Theme support with dark theme already defined
- Row/column customization via render functions
- Event handling for clicks, double-clicks, context menus
- Performance optimized with virtualization threshold

**Integration Requirements:**

- Already supports magenta accent color (`selected: "#ff00ff"`)
- Need to adapt theme colors to use Tailwind CSS classes
- May need custom cell renderers for music metadata (artwork, duration, etc.)
- Should work well for all three view types (list, grid, table)
- Requires enhancement for grouped data display in search results

## Phase 1: Vite Development Setup

### 1.1 Create Traditional Vite Config

Create `client/js/vite.config.ts` for the main Freqhole app (separate from `vite.wc.config.ts`):

```typescript
// New file: client/js/vite.config.ts
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  root: "src/views/freqhole",
  build: {
    outDir: "dist/",
    emptyOutDir: true,
  },
  server: {
    port: 3003,
    host: true,
  },
});
```

### 1.2 Entry Point Setup

Create files:

- `client/js/src/views/freqhole/index.html` - Main HTML template
- `client/js/src/views/freqhole/main.tsx` - Application entry point
- Update `client/js/src/views/freqhole/index.tsx` - Root component

### 1.3 Package.json Scripts

Add new scripts to `client/js/package.json`:

```json
{
  "scripts": {
    "dev:freqhole": "vite --config vite.config.ts",
    "build:freqhole": "vite build --config vite.config.ts",
    "preview:freqhole": "vite preview --config vite.config.ts"
  }
}
```

## Phase 2: Tailwind CSS Integration

### 2.1 Install Tailwind Dependencies

```bash
npm install -D tailwindcss postcss autoprefixer @tailwindcss/forms
npx tailwindcss init -p
```

### 2.2 Tailwind Configuration

Configure `tailwind.config.js` with custom theme:

```javascript
// tailwind.config.js
export default {
  content: ["./src/views/freqhole/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Primary palette: black, white, magenta
        primary: {
          50: "#fdf4ff",
          500: "#d946ef", // fuchsia-500
          600: "#c026d3", // fuchsia-600
          700: "#a21caf", // fuchsia-700
          900: "#701a75", // fuchsia-900
        },
        // Dark theme grays
        dark: {
          100: "#1a1a1a",
          200: "#2a2a2a",
          300: "#3a3a3a",
          400: "#4a4a4a",
          800: "#0a0a0a",
          900: "#000000",
        },
      },
      fontFamily: {
        metro: ["Segoe UI", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
  darkMode: "class",
};
```

### 2.3 CSS Entry Point

Create `client/js/src/views/freqhole/styles.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    @apply bg-black text-white font-metro;
  }
}
```

## Phase 3: Core Layout Structure

### 3.1 Layout Components Architecture

```
src/views/freqhole/
├── components/
│   ├── layout/
│   │   ├── AppHeader.tsx         # Navigation, search, user menu
│   │   ├── AppFooter.tsx         # Player controls (collapsible)
│   │   ├── MainLayout.tsx        # 3-4 column container
│   │   ├── Panel.tsx             # Generic scrollable panel (left/middle/queue)
│   │   └── ResizablePane.tsx     # Drag-to-resize functionality
│   ├── ui/
│   │   ├── Popover.tsx           # Modal overlays with X button
│   │   ├── Menu.tsx              # Dropdown/context menus
│   │   ├── Button.tsx            # Tailwind button variants
│   │   └── ScrollArea.tsx        # Custom scrollbar styling
│   ├── panels/
│   │   ├── ListPanel.tsx         # Generic list display (artists, albums, etc)
│   │   ├── FilterPanel.tsx       # Search filters and controls
│   │   ├── QueuePanel.tsx        # Dedicated playback queue
│   │   └── MainPanel.tsx         # Primary content area
│   └── player/
│       ├── PlayerControls.tsx    # Play/pause/skip/volume
│       ├── ProgressBar.tsx       # Seek bar with time
│       └── NowPlaying.tsx        # Current track info
```

### 3.2 Responsive Grid System

Use a 12-column CSS Grid system for maximum flexibility:

```typescript
// MainLayout.tsx structure
const layouts = {
  // 12-column grid with sidebar panels spanning fixed columns, main content spanning remainder
  default: "grid-cols-12", // Base 12-column grid
};

// Column span utilities
const columnSpans = {
  "left-panel": "col-span-2", // Left panel: 2 columns (browse, search, filters, etc)
  "middle-panel": "col-span-2", // Middle panel: 2 columns (context, filters, details, etc)
  "queue-panel": "col-span-2", // Queue: 2 columns (dedicated queue when visible)
  "main-content": "col-span-8", // Main: 8 columns (primary content area)
  "main-with-queue": "col-span-6", // Main: 6 columns when queue visible
};
```

### 3.3 Player Footer Integration

Dynamic padding system:

- When player visible: `pb-24` (96px) for content areas
- When player hidden: `pb-0`
- Smooth transitions with Tailwind's `transition-all`

### 5.1 Infinite Grid Adaptations

**List View** (Artists, Albums, Playlists)

```typescript
// components/views/ListView.tsx
import type { Song, Artist, Album, Playlist } from '../../lib/api/types';

// Use actual types from lib, no local interface definitions
type ListItem = Artist | Album | Playlist;

const columns: GridColumn<ListItem>[] = [
  {
    key: 'item',
    title: '',
    render: (item) => (
      <div class="flex items-center space-x-3 p-3">
        <img
          src={item.imageUrl || '/placeholder.png'}
          class="w-12 h-12 bg-dark-300 rounded"
        />
        <div>
          <div class="text-white font-medium">{item.name}</div>
          {item.description && (
            <div class="text-gray-400 text-sm">{item.description}</div>
          )}
        </div>
      </div>
    )
  }
];
```

**Grid View** (Album artwork, Artist photos)

```typescript
// components/views/GridView.tsx
import type { Album, Artist } from '../../lib/api/types';

// Use actual types from lib
type GridItem = Album | Artist;

// Custom grid renderer with square tiles
const renderGridItem = (item: GridItem) => (
  <div class="aspect-square bg-dark-200 rounded-lg overflow-hidden relative group cursor-pointer hover:bg-dark-100 transition-colors">
    <img
      src={item.imageUrl || '/placeholder.png'}
      class="w-full h-full object-cover"
    />
    <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
      <div class="text-white font-medium text-sm truncate">{item.name}</div>
    </div>
  </div>
);
```

**Table View** (Songs with metadata)

```typescript
// components/views/TableView.tsx
import type { Song } from '../../lib/api/types';
import { formatDuration } from '../../lib/utils/format';

// Use actual Song type from lib
const columns: GridColumn<Song>[] = [
  { key: 'track', title: '#', width: 50, sortable: true },
  { key: 'title', title: 'Title', sortable: true },
  { key: 'artist', title: 'Artist', sortable: true },
  { key: 'album', title: 'Album', sortable: true },
  {
    key: 'duration',
    title: 'Duration',
    width: 100,
    render: (song) => formatDuration(song.duration)
  },
  {
    key: 'actions',
    title: '',
    width: 100,
    render: (song) => (
      <div class="flex space-x-2">
        <Button variant="ghost" size="sm">
          <LikeIcon />
        </Button>
        <Button variant="ghost" size="sm">
          <MoreIcon />
        </Button>
      </div>
    )
  }
];
```

### 5.2 Grouped Data Support

The infinite-data-grid needs enhancement for grouped data display:

```typescript
// Enhanced infinite-grid for grouped data
interface GroupedDataSection<T> {
  groupKey: string;
  groupTitle: string;
  items: T[];
  isCollapsed?: boolean;
}

interface GroupedGridProps<T> extends GridProps<T> {
  sections: GroupedDataSection<T>[];
  renderGroupHeader?: (section: GroupedDataSection<T>) => JSX.Element;
  onGroupToggle?: (groupKey: string) => void;
}
```

**Use Cases**:

- Search results grouped by type (Songs, Artists, Albums, Playlists)
- Album tracks grouped by disc
- Playlist contents with custom sections
- Artist discography grouped by year

### 5.3 Integration Effort Estimate

| Component             | Effort | Notes                            |
| --------------------- | ------ | -------------------------------- |
| **List View**         | Low    | Direct infinite-grid usage       |
| **Grid View**         | Medium | Custom tile renderer needed      |
| **Table View**        | Low    | Perfect infinite-grid fit        |
| **Grouped Data**      | Medium | Enhance grid for section headers |
| **Theme Integration** | Low    | Update DARK_THEME colors         |
| **Event Handling**    | Medium | Map grid events to audio actions |

**Total Estimated Time: 3-4 days**

## Phase 6: API and State Management Extraction

### 6.1 API Client Separation

Extract from `zoony.tsx` into `client/js/src/lib/`:

```
src/lib/
├── api/
│   ├── client.ts              # Base fetch client
│   ├── songs.ts               # Song endpoints
│   ├── artists.ts             # Artist endpoints
│   ├── albums.ts              # Album endpoints
│   ├── playlists.ts           # Playlist endpoints
│   └── types.ts               # API type definitions
├── audio/
│   ├── player.ts              # Audio playback logic
│   ├── queue.ts               # Playback queue management
│   └── progress.ts            # Progress tracking
└── utils/
    ├── format.ts              # Duration, date formatting
    ├── storage.ts             # LocalStorage helpers
    └── debounce.ts            # Performance utilities
```

### 6.2 State Management

Use SolidJS signals and stores:

```typescript
// stores/playerStore.ts
export interface PlayerState {
  currentSong: Song | null;
  isPlaying: boolean;
  volume: number;
  queue: QueueItem[];
  currentIndex: number;
  progress: number;
  duration: number;
}

export const [playerState, setPlayerState] = createStore<PlayerState>({...});
```

### 6.3 Hook Extraction

Create reusable hooks:

- `usePlayer()` - Playback controls
- `useQueue()` - Queue management
- `useSearch()` - Search functionality
- `useKeyboard()` - Keyboard shortcuts

## Phase 7: Feature Components and Complex UI

### 7.1 Complex Playlist Management

Build comprehensive playlist CRUD functionality:

```typescript
// components/features/PlaylistManager.tsx
interface PlaylistManagerProps {
  playlist: Playlist;
  onUpdate: (playlist: Playlist) => void;
  onDelete: (playlistId: string) => void;
}

// Features:
// - Inline editing of playlist name/description
// - Drag and drop reordering of songs
// - Bulk operations (select multiple, remove, reorder)
// - Add songs from search results
// - Playlist sharing and export
```

### 7.2 Search Results Rendering

Handle grouped search results in main panel:

```typescript
// components/features/SearchResults.tsx
import type { SearchResponse } from "../../lib/api/types";

interface SearchResultsProps {
  results: SearchResponse;
  onItemSelect: (item: Song | Artist | Album | Playlist) => void;
  onGroupToggle: (groupKey: string) => void;
}

// Renders grouped sections:
// - Songs (with play buttons, add to queue)
// - Artists (with follow buttons, view profile)
// - Albums (with play album, add to library)
// - Playlists (with follow, view contents)
```

### 7.3 Audio Playback Components

```typescript
// components/features/VolumeControl.tsx
interface VolumeControlProps {
  volume: number;
  isMuted: boolean;
  onVolumeChange: (volume: number) => void;
  onMuteToggle: () => void;
}

// components/features/QueueViewer.tsx
interface QueueViewerProps {
  queue: QueueItem[];
  currentIndex: number;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onRemove: (index: number) => void;
  onJumpTo: (index: number) => void;
}

// components/features/NowPlayingCard.tsx
interface NowPlayingCardProps {
  currentSong: Song | null;
  isPlaying: boolean;
  progress: number;
  duration: number;
  onSeek: (position: number) => void;
}
```

## Phase 8: Component Decomposition Strategy

### 8.1 Icon Components

Extract all SVG icons into `components/icons/`:

- Use consistent sizing props
- Tailwind color classes
- TypeScript interfaces

### 8.2 Legacy Component Migration

Migrate remaining components from zoony.tsx:

- **SearchBox**: With autocomplete
- **VolumeControl**: Slider with mute
- **QueueViewer**: Draggable song list
- **NowPlayingCard**: Current track display

## Phase 9: Migration Execution Plan

### 7.1 Week 1: Foundation & UI Library

- [ ] Set up Vite dev environment
- [ ] Install and configure Tailwind CSS
- [ ] Create 12-column responsive grid layout

### 7.2 Week 2: UI Library Foundation

- [ ] Build foundational UI components (Button, Input, Modal, Loading)
- [ ] Implement Metro UI animations and transitions
- [ ] Create generic Panel and ResizablePane components
- [ ] Build player controls and footer with UI components

### 7.3 Week 3: API & Views Integration

- [ ] Extract API client and types from zoony.tsx to lib/
- [ ] Extract and adapt state management from zoony.tsx
- [ ] Enhance infinite-data-grid with grouped data support
- [ ] Create list, grid, and table view components using lib/ types

### 7.4 Week 4: Advanced Features

- [ ] Implement search results rendering in main panel
- [ ] Complete playlist CRUD functionality
- [ ] Add keyboard shortcuts and accessibility
- [ ] Implement drag and drop for queue/playlist management
- [ ] Context menus and right-click actions
- [ ] Performance optimization and testing

## Risks and Mitigation

### Technical Risks

1. **State Migration Complexity**
   - _Mitigation_: Incremental migration, maintain interfaces
2. **Performance Regression**
   - _Mitigation_: Leverage existing infinite-grid optimizations
3. **Styling Inconsistency**
   - _Mitigation_: Design system with Tailwind utilities

### Project Risks

1. **Scope Creep**
   - _Mitigation_: Phase-based approach, MVP first
2. **Breaking Changes**
   - _Mitigation_: Keep original zune-demo intact during development

## Success Metrics

- [ ] **Performance**: Smooth scrolling with 10,000+ items
- [ ] **Modularity**: No component over 200 lines
- [ ] **Styling**: 100% Tailwind CSS, zero inline styles, SVG icons only
- [ ] **Type Safety**: Import all data types from lib/, no local duplicates
- [ ] **Functionality**: Feature parity with original zune-demo
- [ ] **Developer Experience**: Hot reload under 1s, TypeScript strict mode

## Next Steps

1. **Immediate**: Set up Phase 1 (Vite + basic structure)
2. **Short-term**: Implement Phase 2 (Tailwind integration)
3. **Medium-term**: Execute Phase 3-4 (Layout + Views)
4. **Long-term**: Complete Phase 5-6 (Full migration)

---

_This plan provides a structured approach to decomposing the monolithic audio player while maintaining functionality and improving maintainability. The phases can be executed incrementally with regular testing and validation._
