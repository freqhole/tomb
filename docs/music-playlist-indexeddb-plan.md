# Music Playlist Application with IndexedDB and SolidJS

## Overview

This document outlines a comprehensive plan for building a music playlist application using IndexedDB for local persistence and SolidJS for reactive UI components. The application will support file upload, drag-and-drop functionality, playlist management, song metadata editing, and audio playback.

## Architecture Overview

### Core Technologies

- **SolidJS**: Reactive UI framework for component-based architecture
- **IndexedDB**: Browser-native database for persistent local storage (using native browser APIs)
- **Web Audio API**: For audio playback functionality
- **Tailwind CSS**: For styling with black, white, and magenta color scheme
- **File API**: For handling music file uploads and metadata extraction

### Dependencies

We'll minimize external dependencies and use browser-native APIs where possible:

- **idb package**: Optional - we can use native IndexedDB APIs, but idb provides better Promise-based interface
- **microdiff**: Optional - we can implement simple array diffing or use SolidJS's built-in reactivity
- **Music metadata libraries**: Consider `music-metadata-browser` for extracting ID3 tags and cover art

The existing demo shows we can build the reactive system with minimal dependencies.

### Data Models

#### Playlist Schema

```typescript
interface Playlist {
  id: string; // UUID
  title: string; // User-editable playlist name
  description?: string; // Optional description
  image?: string; // Base64 encoded image or blob URL
  createdAt: number; // Timestamp
  updatedAt: number; // Timestamp
  songIds: string[]; // Ordered array of song IDs
}
```

#### Song Schema

```typescript
interface Song {
  id: string; // UUID
  file: File; // Original audio file
  title: string; // User-editable song title
  artist: string; // User-editable artist name
  album: string; // User-editable album name
  duration: number; // Length in seconds
  position: number; // Position within playlist (0-based)
  image?: string; // Base64 encoded cover art
  createdAt: number; // Timestamp
  updatedAt: number; // Timestamp
  playlistId: string; // Reference to parent playlist
}
```

## Component Structure

### 1. Playlistz (Root Component)

**Location**: `client/js/src/views/playlistz/components/index.tsx`

**Responsibilities**:

- Initialize IndexedDB connection
- Handle global drag-and-drop events
- Manage application state (current playlist, audio context)
- Render drop overlay when files are dragged over the window

**Key Features**:

- Full-window drop zone with visual feedback
- Global audio player state management
- Playlist selection and creation

### 2. PlaylistManager

**Location**: `client/js/src/views/playlistz/components/PlaylistManager.tsx`

**Responsibilities**:

- Display list of all playlists
- Handle playlist creation, deletion, and selection
- Provide playlist metadata editing

**Key Features**:

- Playlist thumbnail display
- Create new playlist button
- Playlist search/filter functionality

### 3. PlaylistDetail

**Location**: `client/js/src/views/playlistz/components/PlaylistDetail.tsx`

**Responsibilities**:

- Display and manage individual playlist
- Show song list with drag-and-drop reordering
- Handle playlist-level playback controls

**Key Features**:

- Editable playlist title and description
- Playlist cover image upload
- Play all button
- Song reordering via drag-and-drop

### 4. SongRow

**Location**: `client/js/src/views/playlistz/components/SongRow.tsx`

**Responsibilities**:

- Display individual song information
- Handle song-level playback controls
- Provide inline editing for song metadata

**Key Features**:

- Play/pause button for individual song
- Editable title, artist, album fields
- Duration display
- Cover art thumbnail
- Drag handle for reordering

### 5. AudioPlayer

**Location**: `client/js/src/views/playlistz/components/AudioPlayer.tsx`

**Responsibilities**:

- Manage Web Audio API instance
- Handle playback state and controls
- Coordinate with playlist for sequential playback

**Key Features**:

- Single audio element for the entire app
- Progress tracking and seeking
- Auto-advance to next song in playlist
- No volume controls needed, (just set volume to 100%)

### 6. FileUploadZone

**Location**: `client/js/src/views/playlistz/components/FileUploadZone.tsx`

**Responsibilities**:

- Handle file input and drag-and-drop uploads
- Extract metadata from audio files
- Process multiple files simultaneously

**Key Features**:

- Traditional file input button
- Drag-and-drop zone
- File type validation (audio files only)
- Metadata extraction using Web Audio API or libraries

## IndexedDB Schema and Operations

### Database Structure

```typescript
// Database: "musicPlaylistDB"
// Version: 1
// Object Stores:
// - "playlists" (keyPath: "id")
// - "songs" (keyPath: "id", index on "playlistId")
```

### Core Database Operations

#### 1. Database Setup

```typescript
// Option 1: Using idb package (recommended for cleaner Promise API)
import { openDB } from "idb";

async function setupDB() {
  return await openDB("musicPlaylistDB", 1, {
    upgrade(db) {
      // Playlists store
      if (!db.objectStoreNames.contains("playlists")) {
        db.createObjectStore("playlists", { keyPath: "id" });
      }

      // Songs store with playlist index
      if (!db.objectStoreNames.contains("songs")) {
        const songStore = db.createObjectStore("songs", { keyPath: "id" });
        songStore.createIndex("playlistId", "playlistId", { unique: false });
      }
    },
  });
}

// Option 2: Native IndexedDB (if avoiding dependencies)
async function setupDBNative() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("musicPlaylistDB", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      // Store creation logic here
    };
  });
}
```

#### 2. Reactive Query System

Building on the existing `createLiveQuery` pattern from the demo:

```typescript
// Get all playlists with live updates
const playlistsSignal = createLiveQuery({
  dbName: "musicPlaylistDB",
  storeName: "playlists",
  fields: [
    "title",
    "description",
    "image",
    "createdAt",
    "updatedAt",
    "songIds",
  ],
});

// Get songs for specific playlist with live updates
const createPlaylistSongsQuery = (playlistId: string) => {
  return createLiveQuery({
    dbName: "musicPlaylistDB",
    storeName: "songs",
    queryFn: (song) => song.playlistId === playlistId,
    fields: [
      "title",
      "artist",
      "album",
      "duration",
      "position",
      "image",
      "createdAt",
      "updatedAt",
    ],
  });
};

// This ensures that when a playlist title is updated in PlaylistDetail,
// the PlaylistManager sidebar automatically reflects the change
```

#### 3. Mutation Operations

```typescript
// Add song to playlist
async function addSongToPlaylist(
  playlistId: string,
  file: File,
  metadata: Partial<Song>,
) {
  const songId = crypto.randomUUID();
  const now = Date.now();

  // Create song record
  await mutateAndNotify({
    dbName: "musicPlaylistDB",
    storeName: "songs",
    key: songId,
    updateFn: () => ({
      id: songId,
      file,
      title: metadata.title || file.name,
      artist: metadata.artist || "Unknown Artist",
      album: metadata.album || "Unknown Album",
      duration: metadata.duration || 0,
      position: metadata.position || 0,
      playlistId,
      createdAt: now,
      updatedAt: now,
      ...metadata,
    }),
  });

  // Update playlist's song list
  await mutateAndNotify({
    dbName: "musicPlaylistDB",
    storeName: "playlists",
    key: playlistId,
    updateFn: (playlist) => ({
      ...playlist,
      songIds: [...(playlist.songIds || []), songId],
      updatedAt: now,
    }),
  });
}

// Reorder songs in playlist
async function reorderSongs(
  playlistId: string,
  fromIndex: number,
  toIndex: number,
) {
  // Implementation for drag-and-drop reordering
}
```

## UI Design System

### Color Scheme

- **Primary Black**: `#000000`
- **Primary White**: `#ffffff`
- **Accent Magenta**: `#ff00ff` (for play buttons, active states)
- **Grays**: `#1a1a1a`, `#333333`, `#666666`, `#cccccc`

### Tailwind Configuration

```typescript
// Color palette extensions
colors: {
  magenta: {
    500: '#ff00ff',
    400: '#ff33ff',
    600: '#cc00cc'
  }
}
```

### Layout Patterns

- **Minimal borders**: Use subtle shadows and background color changes instead
- **Background images**: Low opacity (10-20%) background patterns
- **Spacing**: Generous whitespace with consistent padding/margins
- **Typography**: Clean, readable fonts with proper hierarchy

### Relative Date Display

Enhanced relative date function with broader time windows:

```typescript
function createRelativeTimeSignal(timestamp: number) {
  const signal = createSignal("");

  function update() {
    const now = Date.now();
    const diff = now - timestamp;
    let label;

    if (diff < 60000) label = "just now";
    else if (diff < 3600000) label = `${Math.floor(diff / 60000)} minutes ago`;
    else if (diff < 86400000) label = `${Math.floor(diff / 3600000)} hours ago`;
    else if (diff < 604800000)
      label = `${Math.floor(diff / 86400000)} days ago`;
    else if (diff < 2629746000)
      label = `${Math.floor(diff / 604800000)} weeks ago`;
    else if (diff < 31556952000)
      label = `${Math.floor(diff / 2629746000)} months ago`;
    else label = `${Math.floor(diff / 31556952000)} years ago`;

    signal.set(label);
  }

  update();
  const interval = setInterval(update, 60000); // Update every minute

  return {
    signal,
    destroy: () => clearInterval(interval),
  };
}

// Global time update system for all relative dates
const createGlobalTimeUpdater = () => {
  const timeSignals = new Set();

  // Update all registered time signals every minute
  setInterval(() => {
    timeSignals.forEach((signal) => signal.update());
  }, 60000);

  return {
    register: (signal) => timeSignals.add(signal),
    unregister: (signal) => timeSignals.delete(signal),
  };
};
```

## File Upload and Processing

### Supported File Types

We'll be as liberal as possible with audio file support:

- MP3 (.mp3)
- WAV (.wav)
- AAC (.aac)
- OGG (.ogg)
- M4A (.m4a)
- FLAC (.flac)
- AIFF (.aiff)
- AIF (.aif)
- WMA (.wma)
- And any other audio/\* MIME types

The check `file.type.startsWith('audio/')` will catch all audio files that browsers recognize.

### Metadata Extraction

```typescript
async function extractMetadata(file: File): Promise<Partial<Song>> {
  // Use Web Audio API to get duration
  const audioContext = new AudioContext();
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  return {
    duration: audioBuffer.duration,
    // Additional metadata extraction using libraries like music-metadata
  };
}
```

### Drag and Drop Implementation

```typescript
// Global drop zone on root element
const handleGlobalDrop = async (event: DragEvent) => {
  event.preventDefault();
  const files = Array.from(event.dataTransfer?.files || []);
  const audioFiles = files.filter((file) => file.type.startsWith("audio/"));

  // Process files and add to current or new playlist
  await processUploadedFiles(audioFiles);
};
```

## Audio Playback System

### Web Audio Setup (Functional Style)

```typescript
// Audio state management with signals
const createAudioManager = () => {
  const audio = new Audio();
  const [currentSong, setCurrentSong] = createSignal<Song | null>(null);
  const [playlist, setPlaylist] = createSignal<Song[]>([]);
  const [currentIndex, setCurrentIndex] = createSignal(0);
  const [isPlaying, setIsPlaying] = createSignal(false);

  // Auto-advance to next song
  audio.addEventListener("ended", () => playNext());

  const playSong = async (song: Song, startFromHere = false) => {
    // Implementation for playing individual songs
    setCurrentSong(song);
    setIsPlaying(true);
  };

  const playPlaylist = async (songs: Song[], startIndex = 0) => {
    setPlaylist(songs);
    setCurrentIndex(startIndex);
    if (songs[startIndex]) {
      await playSong(songs[startIndex]);
    }
  };

  const playNext = () => {
    const songs = playlist();
    const index = currentIndex();
    if (songs && index < songs.length - 1) {
      setCurrentIndex(index + 1);
      playSong(songs[index + 1]);
    } else {
      setIsPlaying(false);
    }
  };

  return {
    audio,
    currentSong,
    playlist,
    currentIndex,
    isPlaying,
    playSong,
    playPlaylist,
    playNext,
  };
};
```

## Implementation Phases

### Phase 1: Core Infrastructure

1. Set up IndexedDB schema and connection
2. Create basic reactive query system
3. Implement PlaylistApp root component
4. Basic playlist creation and selection

### Phase 2: File Upload and Processing

1. Implement FileUploadZone component
2. Add drag-and-drop functionality
3. Metadata extraction from audio files
4. Song creation and storage

### Phase 3: Playlist Management

1. PlaylistDetail component
2. Song list display and basic editing
3. Playlist metadata editing
4. Song deletion and playlist management

### Phase 4: Audio Playback

1. AudioManager service
2. Individual song playback
3. Playlist sequential playback
4. Progress tracking and controls

### Phase 5: Advanced Features

1. Drag-and-drop song reordering
2. Cover art upload and display
3. Search and filtering
4. Import/export functionality

### Phase 6: Polish and Optimization

1. Performance optimizations
2. Error handling and validation
3. Responsive design improvements
4. Accessibility features

## File Organization

```
client/js/src/views/playlistz/
├── components/
│   ├── index.tsx                # Root Playlistz component
│   ├── PlaylistManager.tsx      # Playlist list and management
│   ├── PlaylistDetail.tsx       # Individual playlist view
│   ├── SongRow.tsx              # Individual song component
│   ├── AudioPlayer.tsx          # Audio playback controls
│   ├── FileUploadZone.tsx       # File upload handling
│   └── DropOverlay.tsx          # Full-screen drop feedback
├── services/
│   ├── indexedDBService.ts      # Database operations
│   ├── audioService.ts          # Audio playback management
│   └── fileProcessingService.ts # File upload and metadata
├── types/
│   └── playlist.ts              # TypeScript interfaces
├── utils/
│   ├── audioMetadata.ts         # Metadata extraction utilities
│   └── playlistHelpers.ts       # Playlist manipulation helpers
└── web-components/
    └── playlistz.tsx            # Web component wrapper
```

## Testing Strategy

### Unit Tests

- Database operations (CRUD operations)
- Audio metadata extraction
- File validation and processing
- Playlist manipulation utilities

### Integration Tests

- File upload end-to-end workflow
- Playlist creation and song addition
- Audio playback functionality
- Component interaction and state management

### Manual Testing Scenarios

- Large file uploads (100+ MB audio files)
- Multiple simultaneous file uploads
- Drag-and-drop from various sources
- Playlist playback across different audio formats
- Browser refresh and data persistence

## Future Considerations

### Backend Integration Preparation

- Design API interfaces that match IndexedDB operations
- Plan for data synchronization between local and server storage
- Consider offline-first architecture with sync capabilities

### Performance Optimizations

- Virtual scrolling for large playlists
- Lazy loading of audio metadata
- Efficient thumbnail generation and caching
- Web Workers for file processing

### Additional Features

- Playlist sharing and collaboration
- Audio effects and equalizer
- Crossfade between tracks
- Keyboard shortcuts and accessibility
- Mobile-responsive design optimizations

## Key Reactive Features

### Live Query Benefits

The `createLiveQuery` system ensures real-time updates across all UI components:

1. **Cross-Component Updates**: When a playlist title is edited in `PlaylistDetail`, the `PlaylistManager` sidebar automatically updates
2. **Song Metadata Changes**: Editing song info in `SongRow` immediately updates any other views showing that song
3. **Playlist Image Updates**: Cover art changes propagate to all playlist references instantly
4. **Real-time Sync**: All components stay synchronized without manual refresh or prop drilling

### Relative Time Updates

- **Global Polling**: Single `setInterval` updates all relative timestamps every minute
- **Efficient Updates**: Only recalculates dates that are actually visible
- **Lifecycle Management**: Proper cleanup when components unmount
- **Extended Time Windows**: Supports "just now" through "years ago" with appropriate granularity

### Functional Architecture

- **No Classes**: All services use functional patterns with closures and signals
- **Immutable Updates**: State changes through SolidJS signals, not object mutation
- **Composable Services**: Audio, database, and file processing as separate functional modules
- **Signal-Based Reactivity**: Leverages SolidJS's fine-grained reactivity system

## Web Component Integration

### Standalone Web Component Wrapper

**Location**: `client/js/src/web-components/playlistz.tsx`

This creates a minimal web component wrapper that integrates with the existing build system:

```typescript
/* @jsxImportSource solid-js */
import { render } from "solid-js/web";
import { Playlistz } from "../views/playlistz/components/index.js";

interface PlaylistzWebComponentProps {
  // No props needed for this standalone component
}

function PlaylistzWebComponent(props: PlaylistzWebComponentProps) {
  return <Playlistz />;
}

// Web component registration
customElements.define("playlistz-app", class extends HTMLElement {
  connectedCallback() {
    render(() => <PlaylistzWebComponent />, this);
  }
});
```

### Vite Configuration Updates

The component will be added to `vite.wc.config.ts`:

1. **Add to COMPONENT_TEMPLATES**:

```typescript
"playlistz-demo": {
  name: "playlistz-demo",
  title: "Playlistz Demo - Music Playlist Manager",
  description: "🎵 Music Playlist Manager with IndexedDB and Audio Playback",
  element: "playlistz-app",
  attributes: {},
  instructions: [
    "Drag and drop audio files anywhere on the page",
    "Create and manage playlists with metadata editing",
    "Play songs individually or entire playlists",
    "All data stored locally in IndexedDB",
    "Supports MP3, WAV, FLAC, AIFF, and other audio formats",
  ],
  styles: `
    body { margin: 0; padding: 0; overflow: hidden; }
    .container { max-width: none; margin: 0; height: 100vh; }
  `,
},
```

2. **Add to rollupOptions.input**:

```typescript
"playlistz-demo": "./src/web-components/playlistz.tsx",
```

3. **Add to nameMap**:

```typescript
"playlistz-demo": "playlistz-demo.js",
```

### Build Outputs

This will generate:

- `playlistz-demo-standalone.html` - Complete HTML page with embedded component
- `playlistz-demo-standalone.js` - Standalone JavaScript bundle
- Integration with the existing `all-components.js` bundle

### Usage

Once built, the component can be used in any HTML page:

```html
<playlistz-app></playlistz-app>
<script src="playlistz-demo-standalone.js"></script>
```

Or integrated into the existing development server alongside other components.

This plan provides a solid foundation for building a comprehensive music playlist application that leverages IndexedDB for persistent storage and SolidJS for reactive UI components, with seamless integration into the existing web component architecture.

## CURRENT IMPLEMENTATION STATUS & CRITICAL ISSUES

### ✅ What's Working

1. **IndexedDB Setup**: Database initialization works correctly with `idb` package
2. **Tailwind CSS**: Fixed by adding CSS inclusion to vite config HTML generator
3. **File Processing**: Audio files are being processed and metadata extracted
4. **Data Persistence**: Data IS being saved to IndexedDB (13 playlists, songs created)
5. **Web Component Build**: Builds successfully and generates standalone HTML

### 🔥 CRITICAL BUGS BLOCKING FUNCTIONALITY

#### 1. REACTIVE UI NOT UPDATING (HIGHEST PRIORITY)

**Problem**: Database shows 13 playlists, UI shows "found 0 playlists"
**Root Cause**: The `playlistsQuery.get()` call in JSX is not reactive
**Evidence**:

```
🔄 Updated signal for playlists with 13 items  // Backend working
found 0 playlists                             // UI not updating
```

**Files Affected**:

- `client/js/src/views/playlistz/components/index.tsx` (lines ~244)
- `client/js/src/views/playlistz/services/indexedDBService.ts` (signal implementation)

**Attempted Fixes That Failed**:

- Using `createMemo()` - didn't work
- Manual subscription - caused infinite loops
- Direct signal calls - not reactive in JSX

**Next Steps**: Need to investigate why SolidJS signals aren't triggering re-renders

#### 2. DATABASE CONNECTION OVERUSE

**Problem**: `🗄️ Setting up IndexedDB` called excessively (6+ times per operation)
**Impact**: Performance issues, potential race conditions
**Evidence**: Every database operation creates new connection
**Files Affected**: `indexedDBService.ts` - `setupDB()` called in every function

#### 3. BLOB URL ERRORS (INFINITE LOOP)

**Problem**: Infinite `GET blob:http://localhost:8080/xxx net::ERR_FILE_NOT_FOUND`
**Root Cause**: File blobs not being stored/retrieved correctly
**Impact**: Prevents audio playback, clogs console
**Files Affected**: Audio file storage in songs

### 📁 Current File Structure

```
client/js/src/views/playlistz/
├── components/
│   ├── index.tsx                # ❌ MAIN ISSUES HERE
│   ├── PlaylistManager.tsx      # ⏸️  Not currently used
│   ├── PlaylistDetail.tsx       # ⏸️  Not currently used
│   └── AudioPlayer.tsx          # ⏸️  Not currently used
├── services/
│   ├── indexedDBService.ts      # ⚠️  Working but inefficient
│   ├── audioService.ts          # ⏸️  Not integrated
│   └── fileProcessingService.ts # ✅ Working
├── types/
│   └── playlist.ts              # ✅ Working
├── utils/
│   └── timeUtils.ts             # ✅ Working
└── styles.css                   # ✅ Working
web-components/
└── playlistz.tsx                # ✅ Working wrapper
```

### 🐛 Debugging Console Output Pattern

```
// ON PAGE LOAD - THIS IS WRONG (should show existing playlists)
🔍 Playlists query result: []
🔍 Playlist count: 0            // UI shows this
📊 Fetched 13 items from playlists  // DB actually has 13!
📊 Filtered to 13 items for playlists
🔄 Updated signal for playlists with 13 items  // Signal updates but UI doesn't

// ON CREATE PLAYLIST - THIS WORKS
🔨 Creating new playlist...
💾 Playlist saved to IndexedDB: {...}
✅ Created playlist: {...}

// ON FILE DROP - PARTIAL SUCCESS
🎵 Song saved to IndexedDB: P 25  // Saves to DB
✅ Added 1/1 files to playlist   // Reports success
// BUT: No songs show in UI
```

### 🔧 IMMEDIATE NEXT STEPS FOR NEW THREAD

#### Priority 1: Fix Reactive UI

1. **Debug Signal Reactivity**:
   - Add `console.log` in JSX to see if `playlistsQuery.get()` is even being called
   - Test if other signals work (like `selectedPlaylist`)
   - Try wrapping in `createMemo` properly

2. **Check Signal Implementation**:
   - Verify `createLiveQuery` signal is compatible with SolidJS
   - May need to convert custom signal to SolidJS `createSignal`

#### Priority 2: Fix Database Efficiency

1. **Singleton DB Connection**: Cache database connection instead of creating new one each time
2. **Reduce setupDB Calls**: Only call once on app init

#### Priority 3: Fix Blob Storage

1. **File Storage**: Verify File objects are being stored correctly in IndexedDB
2. **Blob URL Management**: Fix blob URL creation/cleanup in audio service

### 🎯 Expected Behavior vs Actual

**Expected**: Click "+ playlist" → see "found 1 playlists", drop file → see song in list
**Actual**: Always shows "found 0 playlists", no songs appear after drop

### 🗂️ Key Code Locations

- **Main UI Component**: `client/js/src/views/playlistz/components/index.tsx:244` (playlist count display)
- **Signal Creation**: `client/js/src/views/playlistz/services/indexedDBService.ts:415` (`createPlaylistsQuery`)
- **Database Setup**: `client/js/src/views/playlistz/services/indexedDBService.ts:54` (`setupDB` - called too often)
- **Web Component**: `client/js/src/web-components/playlistz.tsx` (working)
- **Vite Config**: `client/js/vite.wc.config.ts:379` (Tailwind fixed)

### 💡 Debugging Commands for New Thread

```bash
cd client/js
npm run build:web-components  # Build component
npm run type-check            # Check TS errors
# Open: dist/playlistz-demo-standalone.html
```

The core issue appears to be that the custom signal implementation isn't properly integrating with SolidJS's reactivity system, causing the UI to never re-render despite database updates working correctly.
